/**
 * Agent Tool Loop — imperative multi-round orchestrator loop.
 *
 * The orchestrator drives the whole task using tools (read, write, shell, search)
 * instead of generating a one-shot JSON plan. Rounds continue until the model
 * calls `finish_task` (or produces no tool calls).
 * After rounds that mutate files or run shell commands, an optional verification
 * step runs the project build command and injects the result as a user message
 * so the model can self-correct.
 */

import { callModel, modelToRequest, type ModelRequestMessage, type TokenUsage } from './modelApi';
import {
  DEFAULT_AGENT_MAX_NO_TOOL_ROUNDS,
  DEFAULT_AGENT_MAX_ROUNDS,
  DEFAULT_AGENT_REPETITION_NUDGE_AT,
  DEFAULT_AGENT_REPETITION_EXIT_AT,
  DEFAULT_AGENT_MAX_CODER_ROUNDS,
  DEFAULT_AGENT_MAX_CODER_NO_TOOL_ROUNDS,
  DEFAULT_AGENT_MAX_JSON_PARSE_ERRORS,
  DEFAULT_AGENT_MAX_CONTEXT_ERRORS,
  DEFAULT_AGENT_VERIFY_FAIL_WEB_NUDGE_AFTER,
} from '@/config/agentBehaviorDefaults';
import type { ModelConfig } from '@/store/modelStore';
import type { ToolInvocation } from '@/store/workbenchStore';
import { isTauri, executeCommand } from '@/lib/tauri';
import {
  ALL_CHAT_TOOLS,
  type AssistantToolCall,
  parseTextToolCalls,
  formatToolResultForModel,
} from './chatTools';
import { roughTokensFromRequestMessages } from '@/utils/tokenEstimate';
import {
  FINISH_TASK_TOOL,
  DELEGATE_TO_CODER_TOOL,
  buildAgentTools,
  ALL_AGENT_TOOLS,
} from './agentToolDefinitions';
import {
  executeAgentToolCall,
  statusForToolCall,
} from './agentToolExecutor';
import { resolveProjectRoot } from './validationRunner';
import { formatEnvForPrompt, type EnvironmentInfo } from './environmentProbe';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { setLastDevServerUrl } from '@/store/workbenchStoreTypes';

// Re-export the definition and executor symbols so existing imports keep working
export { FINISH_TASK_TOOL, DELEGATE_TO_CODER_TOOL, buildAgentTools, ALL_AGENT_TOOLS };
export { executeAgentToolCall };

// ─── Activity timeline (shown in Agent panel feed) ───────────────────────────

function clipTimelineText(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return '∅';
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Re-fire `onStatus` while the HTTP stream has not completed — keeps UI heartbeat from false "stalled" during long TTFT (common on free APIs). */
const MODEL_WAIT_KEEPALIVE_MS = 20_000;

/**
 * Returns true when the API server rejected the model's response because the
 * tool-call arguments contained malformed JSON (e.g. unescaped double quotes
 * inside a write_to_file content string).  This is a recoverable error — we
 * inject a repair message and continue rather than crashing the whole session.
 */
function isToolCallJsonParseError(err: Error): boolean {
  const m = err.message;
  return (
    (m.includes('API error 5') || m.includes('status 5')) &&
    (m.includes('parse tool call') || m.includes('parse_error') || m.includes('Failed to parse'))
  );
}

const TOOL_CALL_JSON_REPAIR_MSG =
  'Your previous tool call contained malformed JSON — the file content had unescaped double-quote characters. ' +
  'The server rejected it. To fix this:\n' +
  '1. Use ONLY single quotes for all JavaScript string literals in the code you write (e.g. \'react\' not "react").\n' +
  '2. In JSX attributes use single-quoted strings: className={\'my-class\'} or template literals.\n' +
  '3. Split the file into smaller pieces — write at most 60–80 lines per write_to_file call.\n' +
  '4. If you must include a literal " character in the content, escape it as \\".\n' +
  'Try again now with the corrected approach.';

/**
 * Detect a 400 context-window-exceeded error from the model API.
 * Fired when the prompt is too long for the model's context window.
 * Recoverable by pruning old messages and retrying.
 */
function isContextLimitError(err: Error): boolean {
  const m = err.message;
  // Most reliable: provider sets type = exceed_context_size_error
  if (m.includes('exceed_context_size_error')) return true;
  return (
    (m.includes('400') || m.includes('status 4')) &&
    (m.includes('exceed') || m.includes('context size') || m.includes('context_size') || m.includes('too long'))
  );
}

/**
 * Extract the model's actual n_ctx from a context-limit error message.
 * e.g. "...n_ctx\":16384..." → 16384.  Returns null if not parseable.
 */
function extractNCtxFromError(err: Error): number | null {
  const m = err.message.match(/"n_ctx"\s*:\s*(\d+)/);
  if (m) return parseInt(m[1], 10);
  // fallback: look for "(16384 tokens)" pattern
  const m2 = err.message.match(/context size[^)]*\((\d+)\s*tokens\)/i);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

/**
 * Prune conversation history to fit within `targetTokens`.
 * Strategy: always keep the system message + the last `keepTail` messages.
 * Drop oldest non-system messages one-by-one until we're under budget.
 * Also hard-truncates any single tool result that exceeds `maxToolResultChars`.
 */
function pruneMessagesForContext(
  messages: ModelRequestMessage[],
  targetTokens: number,
  keepTail = 6,
  maxToolResultChars = 2000,
): ModelRequestMessage[] {
  // Truncate oversized tool results first (they're often npm output noise)
  const capped = messages.map(m => {
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > maxToolResultChars) {
      return {
        ...m,
        content: m.content.slice(0, maxToolResultChars) + '\n…(truncated for context)',
      } as ModelRequestMessage;
    }
    return m;
  });

  const systemMsgs = capped.filter(m => m.role === 'system');
  const nonSystem = capped.filter(m => m.role !== 'system');

  // Always keep the tail (most recent messages)
  const mustKeep = nonSystem.slice(-keepTail);
  let middle = nonSystem.slice(0, nonSystem.length - keepTail);

  let candidate = [...systemMsgs, ...middle, ...mustKeep];
  let tokens = roughTokensFromRequestMessages(candidate);

  // Drop from oldest until under budget
  while (tokens > targetTokens && middle.length > 0) {
    middle = middle.slice(1);
    candidate = [...systemMsgs, ...middle, ...mustKeep];
    tokens = roughTokensFromRequestMessages(candidate);
  }

  return candidate;
}

function formatToolTimelineLine(inv: ToolInvocation): string {
  const name = inv.name;
  const ec = inv.exitCode;
  const failed = inv.status === 'failed' || (ec !== null && ec !== undefined && ec !== 0);
  if (name === 'run_terminal_cmd' && inv.command) {
    const cmdShort = clipTimelineText(inv.command, 72);
    if (failed) {
      const err = clipTimelineText(inv.stderr || inv.errorMessage || '', 130);
      return `→ $ ${cmdShort} · exit ${ec ?? '?'} · ${err || 'failed'}`;
    }
    return `→ $ ${cmdShort} · exit ${ec ?? 0} · ok`;
  }
  if (failed) {
    return `→ ${name} · failed · ${clipTimelineText(inv.stderr || inv.errorMessage || '', 110)}`;
  }
  return `→ ${name} · ok`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentToolLoopCallbacks {
  /** Streaming text chunk from the current model call. */
  onChunk: (chunk: string) => void;
  /**
   * Called after each model round completes with its prose and resolved tool
   * invocations. These are already executed; the UI should render them as
   * completed tool cards (not re-run them).
   * `agent` indicates whether the round came from the orchestrator or the delegated coder.
   */
  onRoundComplete: (content: string, invocations: ToolInvocation[], agent?: 'orchestrator' | 'coder') => void;
  /**
   * Loop finished — optional epilog not already shown via `onRoundComplete`.
   * After `finish_task`, pass only the tool's `summary` field (not fallback prose);
   * the UI already recorded the last round's text + invocations.
   */
  onFinished: (summary: string) => void;
  onLog: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  onTerminal: (line: string) => void;
  onTokens: (usage: TokenUsage, agent: 'orchestrator' | 'coder') => void;
  onStatus: (status: string) => void;
  /**
   * Short lines for the Agent activity feed: model reply summary, tool outcomes, verify results.
   * Unlike onStatus, each call should append (caller may emit multiple per round).
   */
  onTimeline?: (line: string) => void;
  /**
   * Called when the model repeatedly fails to use tools despite having them available.
   * The UI can show a prominent banner suggesting a different model or rephrasing.
   * `attempt` is the current consecutive no-tool round (1-indexed), `limit` is the max.
   */
  onNoToolWarning?: (attempt: number, limit: number, agent: 'orchestrator' | 'coder') => void;
}

export const MAX_AGENT_ROUNDS = 200;

// ─── Batch dependency scanner ─────────────────────────────────────────────────

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads',
  'zlib',
]);

function extractPackageName(importPath: string): string | null {
  if (!importPath) return null;
  if (importPath.startsWith('.') || importPath.startsWith('/') || importPath.startsWith('~')) return null;
  if (importPath.startsWith('virtual:') || importPath.startsWith('node:')) return null;
  // Common path aliases in Vite/TS projects
  if (importPath.startsWith('@/') || importPath.startsWith('@@/')) return null;

  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    if (parts.length < 2) return null;
    const scope = parts[0].slice(1);
    if (!scope) return null;
    return `${parts[0]}/${parts[1]}`;
  }

  const name = importPath.split('/')[0];
  if (NODE_BUILTINS.has(name)) return null;
  return name;
}

/**
 * Scan source files for all external imports, compare against package.json,
 * and batch-install any missing packages in a single command.
 * Returns the list of package names that were installed.
 */
async function scanAndInstallMissingDeps(
  verifyCwd: string,
  pm: string,
  callbacks: Pick<AgentToolLoopCallbacks, 'onLog' | 'onTerminal' | 'onStatus' | 'onTimeline'>,
): Promise<string[]> {
  const scanResult = await executeCommand(
    "grep -rhoE \"from ['\\\"][^'\\\"]+['\\\"]\" --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build . 2>/dev/null || true",
    verifyCwd,
  );
  if (!scanResult.stdout.trim()) return [];

  const importPaths = scanResult.stdout.trim().split('\n')
    .map(line => {
      const m = line.match(/from\s+['"]([^'"]+)['"]/);
      return m ? m[1] : null;
    })
    .filter((p): p is string => p !== null);

  const importedPackages = new Set<string>();
  for (const p of importPaths) {
    const pkg = extractPackageName(p);
    if (pkg) importedPackages.add(pkg);
  }
  if (importedPackages.size === 0) return [];

  const pkgResult = await executeCommand('cat package.json 2>/dev/null', verifyCwd);
  if (pkgResult.code !== 0 || !pkgResult.stdout.trim()) return [];

  let pkg: Record<string, unknown>;
  try { pkg = JSON.parse(pkgResult.stdout); } catch { return []; }

  const existingDeps = new Set([
    ...Object.keys((pkg.dependencies ?? {}) as Record<string, string>),
    ...Object.keys((pkg.devDependencies ?? {}) as Record<string, string>),
    ...Object.keys((pkg.peerDependencies ?? {}) as Record<string, string>),
  ]);

  const missing = [...importedPackages].filter(p => !existingDeps.has(p));
  if (missing.length === 0) return [];

  const addCmd = pm === 'pnpm' ? 'pnpm add' : pm === 'yarn' ? 'yarn add' : pm === 'bun' ? 'bun add' : 'npm install';
  const installCmd = `${addCmd} ${missing.join(' ')}`;

  callbacks.onLog(`Auto-installing ${missing.length} missing dep(s): ${missing.join(', ')}`, 'info');
  callbacks.onStatus?.(`Auto-installing: ${installCmd}`);
  callbacks.onTimeline?.(`Auto-install missing deps: ${missing.join(', ')}`);

  const result = await executeCommand(installCmd, verifyCwd);
  result.stdout.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(l));
  result.stderr.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(`! ${l}`));

  if (result.code !== 0) {
    callbacks.onLog(`Auto-install failed (exit ${result.code}): ${result.stderr.slice(0, 200)}`, 'warning');
    callbacks.onTimeline?.(`→ auto-install · exit ${result.code} · failed`);
    return [];
  }

  callbacks.onLog(`Installed ${missing.length} missing dep(s): ${missing.join(', ')}`, 'success');
  callbacks.onTimeline?.(`→ auto-install · ${missing.length} package(s) installed`);
  return missing;
}

// ─── Coder sub-loop ───────────────────────────────────────────────────────────

const CODER_SYSTEM_PROMPT = `You are the **Coder** agent. The Orchestrator has delegated a coding task to you.

IMPORTANT: You MUST use tool calls to do your work. NEVER respond with plain text — always call a tool.

Your tools:
- \`read_file\` — inspect files BEFORE editing them.
- \`write_to_file\` — create or overwrite a file (full contents).
- \`replace_in_file\` — targeted edit: unique \`old_string\` → \`new_string\` (optional \`replace_all\`).
- \`run_terminal_cmd\` — install packages, run builds, verify syntax.
- \`search_files\` — locate functions or patterns in the codebase.
- \`web_search\` — search the web (arguments: \`{"query":"your search terms"}\`). Built in — never \`npm install\` a search CLI or run fake shell commands like \`web_search\`.
- \`fetch_url\` — fetch an http(s) URL (arguments: \`{"url":"https://..."}\`). Built in — do not use curl in the shell unless the user explicitly asked for a shell workflow.
- \`browse_web\` — headless browser for JS-rendered pages (desktop); optional \`browse_actions_json\`.
- \`lookup_package\` — registry metadata: \`{"ecosystem":"npm"|"crates"|"pypi","name":"..."}\` — prefer over \`npm view\` / curl.
- \`get_terminal_snapshot\` — read Terminal panel output (\`scope\`: active | all_tabs).
- \`save_memory\` — persist important facts.

Workflow:
1. Start by calling \`read_file\` or \`search_files\` to understand the current code.
2. Use \`replace_in_file\` for small edits, \`write_to_file\` for new files or full rewrites.
3. **After writing or editing package.json (or any dependency manifest), ALWAYS run the appropriate install command** (\`npm install\`, \`pnpm install\`, \`yarn install\`, etc.) before any build or dev commands.
4. Use \`run_terminal_cmd\` to verify your work if needed.
5. Stop when done — no extra tool calls needed.

Rules:
- ALWAYS read a file before editing it so you know its current content.
- Prefer \`replace_in_file\` for small localized changes; use \`write_to_file\` for new files or when rewriting most of a file.
- Fix the root cause, not just the symptom.
- Your FIRST response MUST be a tool call — never start with plain text.
- NEVER run \`npm run build\`, \`npm run dev\`, or similar without first ensuring dependencies are installed.
- **Shell grammar — mv**: \`mv SRC DEST\` already removes SRC (it is a move, not a copy). NEVER chain \`mv SRC DEST && rm SRC\` — the \`rm\` always fails with exit 1 because mv already deleted the source, making the agent think the move failed and loop endlessly. Just use \`mv SRC DEST\`.
- **macOS ARM64 — \`Cannot find module @rollup/rollup-darwin-arm64\`** (or esbuild, lightningcss, sharp): stale lockfile from wrong arch. Fix: \`rm -rf node_modules && rm -f package-lock.json && npm install\`. NEVER use \`--omit=optional\` for Vite/Rollup projects — that flag strips the arm64 binaries.

New project setup:
- The orchestrator's context includes a SCAFFOLD REFERENCE with exact file templates for the detected stack. Follow it exactly.
- WRITE ALL FILES DIRECTLY — do NOT run scaffolding commands (npm create, cargo init, etc.).
- After writing all files, run the install command before any build or dev command.
- For Vite projects: index.html goes in PROJECT ROOT, not src/. Requires "type": "module" in package.json.
- NEVER use Tailwind classes without configuring the full pipeline (plugin in vite.config + @import in CSS + import CSS in entry point).

Small-file rules (CRITICAL):
- Keep every file you write under 200 lines. If a file would be longer, split it.
- Never write more than 10 000 characters in a single write_to_file call.
- One component or module per file.

write_to_file JSON safety (CRITICAL — ignoring this crashes the session):
File content is transmitted as a JSON string. NEVER put bare double-quote characters (") in write_to_file without escaping them as \\". The safest approach:
- Use single quotes ('react') for ALL JavaScript string literals in the written code.
- In JSX attributes use single-quoted strings: className={'my-class'} — or template literals.
- If you absolutely must use double quotes in the file content you are writing, escape each one as \\" in your output.
- Keep every write_to_file call under 80 lines — shorter calls have fewer escaping opportunities to fail.`;

/**
 * Run a bounded sub-loop with the Coder model to implement a delegated task.
 * Returns a short summary of what was done.
 */
async function runCoderSubLoop(opts: {
  coderModel: ModelConfig;
  instruction: string;
  context?: string;
  projectPath: string;
  signal?: AbortSignal;
  maxCoderRounds?: number;
  /** Pre-resolved scaffold reference — injected into system prompt for empty project tasks */
  scaffoldHint?: string;
  /** Runtime environment info (platform, arch, Node version, package manager, etc.) */
  envInfo?: EnvironmentInfo;
  callbacks: Pick<AgentToolLoopCallbacks, 'onLog' | 'onTerminal' | 'onStatus' | 'onChunk' | 'onTokens' | 'onTimeline'> & {
    onRoundComplete: (content: string, invocations: ToolInvocation[]) => void;
  };
}): Promise<string> {
  const { coderModel, instruction, context, projectPath, signal, callbacks, maxCoderRounds, scaffoldHint, envInfo } = opts;
  const coderRoundLimit = (maxCoderRounds != null && maxCoderRounds > 0) ? maxCoderRounds : DEFAULT_AGENT_MAX_CODER_ROUNDS;

  const envBlock = envInfo ? `\n\n${formatEnvForPrompt(envInfo)}` : '';
  const coderSystemPrompt = scaffoldHint
    ? `${CODER_SYSTEM_PROMPT}${envBlock}\n\n## Scaffold Reference\n${scaffoldHint}`
    : `${CODER_SYSTEM_PROMPT}${envBlock}`;

  const messages: ModelRequestMessage[] = [
    { role: 'system', content: coderSystemPrompt },
    {
      role: 'user',
      content: `${instruction}${context ? `\n\n---\nContext:\n${context}` : ''}`,
    },
  ];

  const coderTools = ALL_CHAT_TOOLS; // write, read, shell, search, memory — no finish_task / delegate
  let summary = 'Coder completed the task.';

  callbacks.onLog(`Coder starting (model: ${coderModel.id})`, 'info');
  let coderConsecutiveNoTools = 0;
  const coderNoToolLimit = DEFAULT_AGENT_MAX_CODER_NO_TOOL_ROUNDS;

  let coderJsonParseErrors = 0;
  let coderContextErrors = 0;
  let coderRequiredFailed = false;
  // Target 80% of the model's declared context window.
  // Default to 16 k — the smallest common window on free/local models.
  // This is updated reactively if we see a smaller n_ctx in an error.
  let coderContextLimit = (coderModel.contextTokens ?? 16384) * 0.80;

  for (let round = 1; round <= coderRoundLimit; round++) {
    if (signal?.aborted) break;
    const coderWaitBase = `Coder · ${coderModel.modelId} · round ${round}/${coderRoundLimit} · waiting for model…`;
    callbacks.onStatus(coderWaitBase);

    // ── Proactive context pruning ─────────────────────────────────────────
    const estimatedTokens = roughTokensFromRequestMessages(messages);
    if (estimatedTokens > coderContextLimit) {
      callbacks.onLog(
        `Coder: context ~${estimatedTokens} tok > ${Math.round(coderContextLimit)} limit — pruning history`,
        'warning',
      );
      const pruned = pruneMessagesForContext(messages, coderContextLimit);
      messages.splice(0, messages.length, ...pruned);
    }

    let fullText = '';
    let toolCalls: AssistantToolCall[] = [];
    let toolCallJsonErr: Error | null = null;
    let contextLimitErr: Error | null = null;
    let coderFirstToken = false;
    let coderRequiredTimedOut = false;

    const coderToolChoice = (coderConsecutiveNoTools > 0 && !coderRequiredFailed) ? ('required' as const) : ('auto' as const);

    const CODER_REQUIRED_TTFT_MS = 120_000;
    let coderDeadlineCtrl: AbortController | undefined;
    let coderDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let coderRoundSignal = signal;

    if (coderToolChoice === 'required') {
      coderDeadlineCtrl = new AbortController();
      coderDeadlineTimer = setTimeout(() => {
        if (!coderFirstToken && coderDeadlineCtrl && !coderDeadlineCtrl.signal.aborted) {
          coderDeadlineCtrl.abort(
            new DOMException(
              `Coder tool_choice=required: no first token in ${CODER_REQUIRED_TTFT_MS / 1000}s`,
              'TimeoutError',
            ),
          );
        }
      }, CODER_REQUIRED_TTFT_MS);
      if (signal) {
        const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
        if (typeof anyFn === 'function') {
          try { coderRoundSignal = anyFn([signal, coderDeadlineCtrl.signal]); }
          catch { signal.addEventListener('abort', () => coderDeadlineCtrl!.abort(signal!.reason), { once: true }); coderRoundSignal = coderDeadlineCtrl.signal; }
        } else {
          signal.addEventListener('abort', () => coderDeadlineCtrl!.abort(signal!.reason), { once: true });
          coderRoundSignal = coderDeadlineCtrl.signal;
        }
      } else {
        coderRoundSignal = coderDeadlineCtrl.signal;
      }
    }

    const coderWaitStarted = Date.now();
    let coderWaitKeepalive: ReturnType<typeof setInterval> | undefined;
    coderWaitKeepalive = setInterval(() => {
      const sec = Math.round((Date.now() - coderWaitStarted) / 1000);
      callbacks.onStatus(`${coderWaitBase} · ${sec}s on provider…`);
    }, MODEL_WAIT_KEEPALIVE_MS);

    try {
      await new Promise<void>((resolve, reject) => {
        callModel(
          modelToRequest(coderModel, messages, { tools: coderTools, signal: coderRoundSignal, tool_choice: coderToolChoice }),
          (chunk) => {
            coderFirstToken = true;
            if (coderDeadlineTimer) { clearTimeout(coderDeadlineTimer); coderDeadlineTimer = undefined; }
            fullText += chunk;
            callbacks.onChunk(chunk);
          },
          (text, meta) => {
            coderFirstToken = true;
            if (coderDeadlineTimer) { clearTimeout(coderDeadlineTimer); coderDeadlineTimer = undefined; }
            fullText = text;
            toolCalls = meta?.toolCalls ?? [];
            if (!toolCalls.length) {
              const textParsed = parseTextToolCalls(text);
              if (textParsed) {
                toolCalls = textParsed.toolCalls as AssistantToolCall[];
                fullText = textParsed.cleanText;
              }
            }
            const inTok = roughTokensFromRequestMessages(messages);
            const outTok = Math.max(1, Math.ceil(text.length / 4));
            callbacks.onTokens({ inputTokens: inTok, outputTokens: outTok }, 'coder');
            resolve();
          },
          (err) => {
            if (coderDeadlineTimer) { clearTimeout(coderDeadlineTimer); coderDeadlineTimer = undefined; }
            if (err.name === 'AbortError' || err.name === 'TimeoutError') {
              if (coderToolChoice === 'required' && !coderFirstToken && !signal?.aborted) {
                coderRequiredTimedOut = true;
                resolve();
              } else {
                resolve();
              }
            } else if (isToolCallJsonParseError(err)) { toolCallJsonErr = err; resolve(); }
            else if (isContextLimitError(err)) { contextLimitErr = err; resolve(); }
            else { reject(err); }
          },
        );
      });
    } finally {
      if (coderWaitKeepalive) clearInterval(coderWaitKeepalive);
      if (coderDeadlineTimer) { clearTimeout(coderDeadlineTimer); coderDeadlineTimer = undefined; }
    }

    // ── Recover from tool_choice=required hang ────────────────────────────
    if (coderRequiredTimedOut) {
      coderRequiredFailed = true;
      callbacks.onLog(
        `Coder: tool_choice=required timed out — switching to auto for remaining rounds.`,
        'warning',
      );
      callbacks.onTimeline?.(`Coder r${round} · tool_choice=required timed out · switching to auto`);
      continue;
    }

    // ── Recover from context-window-exceeded errors ───────────────────────
    if (contextLimitErr) {
      coderContextErrors++;
      // Refine our limit from the actual n_ctx in the error response
      const actualNCtx = extractNCtxFromError(contextLimitErr);
      if (actualNCtx && actualNCtx < coderContextLimit / 0.80) {
        coderContextLimit = actualNCtx * 0.75; // use 75% of actual limit
      }
      callbacks.onLog(
        `Coder r${round}: context window exceeded (attempt ${coderContextErrors}/${DEFAULT_AGENT_MAX_CONTEXT_ERRORS}) — pruning to ${Math.round(coderContextLimit)} tok and retrying.`,
        'warning',
      );
      if (coderContextErrors >= DEFAULT_AGENT_MAX_CONTEXT_ERRORS) {
        callbacks.onLog(`Coder: context too large even after pruning — giving up.`, 'warning');
        break;
      }
      const pruned = pruneMessagesForContext(messages, coderContextLimit, 4);
      messages.splice(0, messages.length, ...pruned);
      continue;
    }

    // Recover from tool-call JSON parse errors without crashing the session
    if (toolCallJsonErr) {
      coderJsonParseErrors++;
      callbacks.onLog(
        `Coder r${round}: tool-call JSON parse error from API (attempt ${coderJsonParseErrors}/${DEFAULT_AGENT_MAX_JSON_PARSE_ERRORS}) — injecting repair message.`,
        'warning',
      );
      callbacks.onTimeline?.(`Coder r${round} · tool-call JSON error · injecting repair hint`);
      if (coderJsonParseErrors >= DEFAULT_AGENT_MAX_JSON_PARSE_ERRORS) {
        callbacks.onLog(`Coder: too many JSON parse errors — giving up.`, 'warning');
        break;
      }
      messages.push({ role: 'user', content: TOOL_CALL_JSON_REPAIR_MSG });
      continue;
    }

    if (signal?.aborted) break;

    const sanitized: AssistantToolCall[] = toolCalls.map(tc => ({
      ...tc,
      id: tc.id || crypto.randomUUID(),
    }));

    messages.push({
      role: 'assistant',
      content: fullText || null,
      tool_calls: sanitized.length > 0
        ? sanitized.map(tc => ({ id: tc.id, type: 'function' as const, function: tc.function }))
        : undefined,
    });

    if (sanitized.length === 0) {
      callbacks.onTimeline?.(
        `Coder r${round} · NO TOOLS · ${(fullText || '').length}c · «${clipTimelineText(fullText || '(empty)', 220)}»`,
      );
      coderConsecutiveNoTools++;
      // If the coder has already done real work (wrote files etc.) in prior rounds,
      // treat a text-only round as "done" — don't nudge.
      const hasDoneWork = messages.some(m => m.role === 'tool');
      if (hasDoneWork) {
        summary = fullText || summary;
        if (fullText) callbacks.onRoundComplete(fullText, []);
        break;
      }
      // Nudge: the coder hasn't done anything yet but responded with text
      if (coderConsecutiveNoTools >= coderNoToolLimit) {
        callbacks.onLog(`Coder produced no tool calls for ${coderConsecutiveNoTools} rounds — giving up.`, 'warning');
        summary = fullText || summary;
        if (fullText) callbacks.onRoundComplete(fullText, []);
        break;
      }
      const toolNames = coderTools.map(t => t.function.name).join(', ');
      const nudge = coderConsecutiveNoTools === 1
        ? 'You MUST use your tools to complete this task. Start by using `read_file` to inspect the relevant files, then use `write_to_file` to make changes. Do not explain — act now with a tool call.'
        : `CRITICAL: You MUST call one of your tools NOW. Available: ${toolNames}. Do NOT write prose. Emit a function call immediately.`;
      messages.push({ role: 'user', content: nudge });
      callbacks.onLog(`Coder: no tool calls (attempt ${coderConsecutiveNoTools}/${coderNoToolLimit}) — nudging.`, 'warning');
      const nextCoderChoice = !coderRequiredFailed ? 'tool_choice=required' : 'tool_choice=auto (required failed)';
      callbacks.onStatus(
        `Coder · ${coderModel.modelId} · no tool call (text-only reply) — re-prompt ${coderConsecutiveNoTools + 1}/${coderNoToolLimit} · next ${nextCoderChoice}`,
      );
      (callbacks as AgentToolLoopCallbacks).onNoToolWarning?.(coderConsecutiveNoTools, coderNoToolLimit, 'coder');
      continue;
    }
    coderConsecutiveNoTools = 0;

    const toolNamesThisRound = sanitized.map(t => t.function.name).join(', ');
    callbacks.onTimeline?.(
      `Coder r${round} · ${sanitized.length} tool(s) [${toolNamesThisRound}] · ` +
        `${(fullText || '').length}c prose · «${clipTimelineText(fullText || '(empty)', 180)}»`,
    );

    const invocations: ToolInvocation[] = [];
    for (const tc of sanitized) {
      if (signal?.aborted) break;
      callbacks.onStatus(`Coder: ${statusForToolCall(tc)}`);
      const result = await executeAgentToolCall(tc, projectPath, callbacks);
      invocations.push(result);
      callbacks.onTimeline?.(formatToolTimelineLine(result));
      messages.push({ role: 'tool', tool_call_id: tc.id, content: formatToolResultForModel(result) });
    }

    if (fullText || invocations.length > 0) {
      callbacks.onRoundComplete(fullText, invocations);
    }

    summary = fullText || summary;
  }

  callbacks.onLog('Coder finished.', 'success');
  return summary;
}

// ─── Main loop ────────────────────────────────────────────────────────────────

export async function runAgentToolLoop(opts: {
  model: ModelConfig;
  /** Separate model for delegated coding work. When set, the orchestrator can use delegate_to_coder. */
  coderModel?: ModelConfig;
  systemPrompt: string;
  initialMessages: ModelRequestMessage[];
  projectPath: string;
  /** Shell command to run for verification after mutating rounds (e.g. "npm run build"). */
  validationCommand?: string;
  signal?: AbortSignal;
  callbacks: AgentToolLoopCallbacks;
  /**
   * How many consecutive rounds without any tool calls before the loop exits with an explanation.
   * Defaults to {@link DEFAULT_AGENT_MAX_NO_TOOL_ROUNDS}.
   */
  maxNoToolRounds?: number;
  /**
   * Total orchestrator rounds before the loop stops.
   * Defaults to {@link DEFAULT_AGENT_MAX_ROUNDS}.
   */
  maxRounds?: number;
  /** Identical tool-call repeats before injecting a strategy-change nudge. */
  repetitionNudgeAt?: number;
  /** Identical tool-call repeats before force-exiting the loop. */
  repetitionExitAt?: number;
  /** Max rounds the Coder sub-loop may run per delegate_to_coder call. */
  maxCoderRounds?: number;
  /** Max characters returned per read_file call. */
  maxFileReadChars?: number;
  /** Ms to wait after launching a background process before continuing. */
  backgroundSettleMs?: number;
  /** Pre-resolved scaffold hint from scaffoldRegistry — forwarded to the Coder sub-loop */
  scaffoldHint?: string;
  /** Runtime environment info — forwarded to the Coder sub-loop so it always knows the platform */
  envInfo?: EnvironmentInfo;
}): Promise<void> {
  const {
    model, coderModel, systemPrompt, initialMessages, projectPath, validationCommand,
    signal, callbacks, maxNoToolRounds, maxRounds, repetitionNudgeAt, repetitionExitAt,
    maxCoderRounds, maxFileReadChars, backgroundSettleMs, scaffoldHint, envInfo,
  } = opts;
  const noToolLimit = (maxNoToolRounds != null && maxNoToolRounds > 0) ? maxNoToolRounds : DEFAULT_AGENT_MAX_NO_TOOL_ROUNDS;
  const roundLimit = (maxRounds != null && maxRounds > 0) ? maxRounds : DEFAULT_AGENT_MAX_ROUNDS;
  const nudgeAt = (repetitionNudgeAt != null && repetitionNudgeAt > 0) ? repetitionNudgeAt : DEFAULT_AGENT_REPETITION_NUDGE_AT;
  const exitAt = (repetitionExitAt != null && repetitionExitAt > 0) ? repetitionExitAt : DEFAULT_AGENT_REPETITION_EXIT_AT;

  const withCoder = !!coderModel && coderModel.enabled;
  const agentTools = buildAgentTools(withCoder);
  console.log(`[agentToolLoop] withCoder=${withCoder}, orchestrator=${model.id}, coder=${coderModel?.id ?? 'none'}, tools=${agentTools.map(t => t.function.name).join(', ')}`);

  const messages: ModelRequestMessage[] = [
    { role: 'system', content: systemPrompt },
    ...initialMessages,
  ];

  let consecutiveNoTools = 0;
  let orchestratorJsonParseErrors = 0;
  /** How many verification runs in a row have passed — used to escalate the finish_task nudge */
  let consecutivePassingVerifications = 0;
  /** How many verification runs in a row have failed — nudge web research after threshold */
  let consecutiveVerifyFailures = 0;
  let orchestratorContextErrors = 0;
  /** Set to true after tool_choice=required hangs or fails — prevents future required attempts. */
  let orchRequiredFailed = false;
  // Target 80% of the model's declared context window.
  // Orchestrators run on large cloud models (256k+ context) — don't prune
  // proactively unless contextTokens is explicitly set or an error tells us the real limit.
  // The reactive handler will dial it in from n_ctx in any actual overflow error.
  let orchestratorContextLimit = (model.contextTokens ?? 262144) * 0.80;

  // Repetition detection: track (toolName, argsSummary) for recent calls.
  // If the same fingerprint appears >= NUDGE_AT times, inject a strategy-change nudge.
  // If it appears >= EXIT_AT times, force-exit with an explanation.
  const recentCallFingerprints: string[] = [];
  const fingerprintCounts = new Map<string, number>();

  /** Returns a compact fingerprint for a tool call (name + first 200 chars of args). */
  function toolFingerprint(toolName: string, argsJson: string): string {
    const norm = argsJson.replace(/\s+/g, ' ').trim().slice(0, 200);
    return `${toolName}::${norm}`;
  }

  for (let round = 1; round <= roundLimit; round++) {
    if (signal?.aborted) break;

    // ── Proactive context pruning ─────────────────────────────────────────
    const orchTokens = roughTokensFromRequestMessages(messages);
    if (orchTokens > orchestratorContextLimit) {
      callbacks.onLog(
        `Orchestrator: context ~${orchTokens} tok > ${Math.round(orchestratorContextLimit)} limit — pruning history`,
        'warning',
      );
      const pruned = pruneMessagesForContext(messages, orchestratorContextLimit);
      messages.splice(0, messages.length, ...pruned);
    }

    // After any no-tool reply, try tool_choice=required to force tool output.
    // If a previous required attempt hung (no first token), fall back to auto permanently.
    const toolChoice = (consecutiveNoTools > 0 && !orchRequiredFailed) ? ('required' as const) : ('auto' as const);

    const orchWaitBase =
      `Orchestrator · ${model.modelId} · round ${round}/${roundLimit} · waiting for model…` +
      (consecutiveNoTools > 0
        ? ` · prior round had no tools (${consecutiveNoTools}/${noToolLimit}) · next tool_choice=${toolChoice}`
        : '');
    callbacks.onStatus(orchWaitBase);

    // ── Call model (wrap streaming callbacks in a Promise) ────────────────
    let fullText = '';
    let toolCalls: AssistantToolCall[] = [];
    let orchestratorJsonErr: Error | null = null;
    let orchestratorContextErr: Error | null = null;
    let orchFirstToken = false;
    let orchRequiredTimedOut = false;

    // When tool_choice=required, add a 120s first-token deadline.
    // Some models (e.g. Gemma on llama-cpp) hang indefinitely under grammar-
    // constrained decoding — abort fast and switch to auto for future rounds.
    const REQUIRED_TTFT_MS = 120_000;
    let orchDeadlineCtrl: AbortController | undefined;
    let orchDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let orchRoundSignal = signal;

    if (toolChoice === 'required') {
      orchDeadlineCtrl = new AbortController();
      orchDeadlineTimer = setTimeout(() => {
        if (!orchFirstToken && orchDeadlineCtrl && !orchDeadlineCtrl.signal.aborted) {
          orchDeadlineCtrl.abort(
            new DOMException(
              `tool_choice=required: no first token in ${REQUIRED_TTFT_MS / 1000}s — model may not support forced tool calling`,
              'TimeoutError',
            ),
          );
        }
      }, REQUIRED_TTFT_MS);
      // Combine user abort signal + deadline
      if (signal) {
        const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
        if (typeof anyFn === 'function') {
          try { orchRoundSignal = anyFn([signal, orchDeadlineCtrl.signal]); }
          catch { signal.addEventListener('abort', () => orchDeadlineCtrl!.abort(signal!.reason), { once: true }); orchRoundSignal = orchDeadlineCtrl.signal; }
        } else {
          signal.addEventListener('abort', () => orchDeadlineCtrl!.abort(signal!.reason), { once: true });
          orchRoundSignal = orchDeadlineCtrl.signal;
        }
      } else {
        orchRoundSignal = orchDeadlineCtrl.signal;
      }
    }

    const orchWaitStarted = Date.now();
    let orchWaitKeepalive: ReturnType<typeof setInterval> | undefined;
    let orchSlowHintLogged = false;
    orchWaitKeepalive = setInterval(() => {
      const sec = Math.round((Date.now() - orchWaitStarted) / 1000);
      callbacks.onStatus(`${orchWaitBase} · ${sec}s on provider…`);
      if (!orchSlowHintLogged) {
        orchSlowHintLogged = true;
        callbacks.onLog(
          'Still waiting on the model API (no first token yet). Busy or free tiers often need 30–120s; the request aborts automatically after the stream timeout if the server never responds.',
          'info',
        );
      }
    }, MODEL_WAIT_KEEPALIVE_MS);

    try {
      await new Promise<void>((resolve, reject) => {
        callModel(
          modelToRequest(model, messages, {
            tools: agentTools,
            signal: orchRoundSignal,
            tool_choice: toolChoice,
          }),
          (chunk) => {
            orchFirstToken = true;
            if (orchDeadlineTimer) { clearTimeout(orchDeadlineTimer); orchDeadlineTimer = undefined; }
            fullText += chunk;
            callbacks.onChunk(chunk);
          },
          (text, meta) => {
            orchFirstToken = true;
            if (orchDeadlineTimer) { clearTimeout(orchDeadlineTimer); orchDeadlineTimer = undefined; }
            fullText = text;
            toolCalls = meta?.toolCalls ?? [];
            if (!toolCalls.length) {
              const textParsed = parseTextToolCalls(text);
              if (textParsed) {
                toolCalls = textParsed.toolCalls as AssistantToolCall[];
                fullText = textParsed.cleanText;
              }
            }
            console.log(`[agentToolLoop] round ${round}: text=${text.length} chars, toolCalls=${toolCalls.length}${toolCalls.length ? ` [${toolCalls.map(t => t.function.name).join(', ')}]` : ''}`);
            const inTok = roughTokensFromRequestMessages(messages);
            const outTok = Math.max(1, Math.ceil(text.length / 4));
            callbacks.onTokens({ inputTokens: inTok, outputTokens: outTok }, 'orchestrator');
            resolve();
          },
          (err) => {
            if (orchDeadlineTimer) { clearTimeout(orchDeadlineTimer); orchDeadlineTimer = undefined; }
            if (err.name === 'AbortError' || err.name === 'TimeoutError') {
              // Distinguish required-deadline abort from user abort
              if (toolChoice === 'required' && !orchFirstToken && !signal?.aborted) {
                orchRequiredTimedOut = true;
                resolve(); // recoverable — retry with auto
              } else {
                resolve(); // user abort
              }
            } else if (isToolCallJsonParseError(err)) {
              orchestratorJsonErr = err;
              resolve();
            } else if (isContextLimitError(err)) {
              orchestratorContextErr = err;
              resolve();
            } else {
              reject(err);
            }
          },
        );
      });
    } finally {
      if (orchWaitKeepalive) clearInterval(orchWaitKeepalive);
      if (orchDeadlineTimer) { clearTimeout(orchDeadlineTimer); orchDeadlineTimer = undefined; }
    }

    // ── Recover from tool_choice=required hang ────────────────────────────
    if (orchRequiredTimedOut) {
      orchRequiredFailed = true;
      callbacks.onLog(
        `tool_choice=required timed out (${REQUIRED_TTFT_MS / 1000}s, no first token) — this model doesn't support forced tool calling. Switching to auto for remaining rounds.`,
        'warning',
      );
      callbacks.onTimeline?.(`Orchestrator r${round} · tool_choice=required timed out · switching to auto`);
      continue; // retry this round with auto
    }

    // ── Recover from context-window-exceeded errors ───────────────────────
    if (orchestratorContextErr) {
      orchestratorContextErrors++;
      // Refine our limit from the actual n_ctx in the error response
      const actualNCtx = extractNCtxFromError(orchestratorContextErr);
      if (actualNCtx && actualNCtx < orchestratorContextLimit / 0.80) {
        orchestratorContextLimit = actualNCtx * 0.75; // use 75% of actual limit
      }
      callbacks.onLog(
        `Orchestrator r${round}: context window exceeded (attempt ${orchestratorContextErrors}/${DEFAULT_AGENT_MAX_CONTEXT_ERRORS}) — pruning to ${Math.round(orchestratorContextLimit)} tok and retrying.`,
        'warning',
      );
      callbacks.onTimeline?.(`Orchestrator r${round} · context overflow · pruning`);
      if (orchestratorContextErrors >= DEFAULT_AGENT_MAX_CONTEXT_ERRORS) {
        callbacks.onLog(`Orchestrator: context too large even after pruning — giving up.`, 'warning');
        callbacks.onDone('Agent stopped: conversation history too large for this model\'s context window. Try a model with a larger context window, or start a fresh session.');
        return;
      }
      const pruned = pruneMessagesForContext(messages, orchestratorContextLimit, 4);
      messages.splice(0, messages.length, ...pruned);
      continue;
    }

    // ── Recover from tool-call JSON parse error ───────────────────────────
    if (orchestratorJsonErr) {
      orchestratorJsonParseErrors++;
      callbacks.onLog(
        `Orchestrator r${round}: tool-call JSON parse error from API (attempt ${orchestratorJsonParseErrors}/${DEFAULT_AGENT_MAX_JSON_PARSE_ERRORS}) — injecting repair message.`,
        'warning',
      );
      callbacks.onTimeline?.(`Orchestrator r${round} · tool-call JSON error · injecting repair hint`);
      if (orchestratorJsonParseErrors >= DEFAULT_AGENT_MAX_JSON_PARSE_ERRORS) {
        callbacks.onLog(`Orchestrator: too many JSON parse errors — giving up.`, 'warning');
        callbacks.onDone(
          'Agent stopped: repeated tool-call JSON formatting errors. The model may be writing files that are too large or contain unescaped quotes.',
        );
        return;
      }
      messages.push({ role: 'user', content: TOOL_CALL_JSON_REPAIR_MSG });
      continue;
    }

    if (signal?.aborted) break;

    // ── Sanitize tool call IDs — some models return empty/missing ids ────
    // OpenAI rejects any assistant message where tool_calls[].id is absent.
    // We fix this once here; the same sanitized id is used for the matching
    // tool result messages so the pair is always consistent.
    const sanitizedToolCalls: AssistantToolCall[] = toolCalls.map(tc => ({
      ...tc,
      id: tc.id || crypto.randomUUID(),
    }));

    // ── Check for finish_task ─────────────────────────────────────────────
    const finishCall = sanitizedToolCalls.find(tc => tc.function.name === 'finish_task');
    const executableCalls = sanitizedToolCalls.filter(tc => tc.function.name !== 'finish_task');

    // Build the assistant message with sanitized ids
    messages.push({
      role: 'assistant',
      content: fullText || null,
      tool_calls: sanitizedToolCalls.length > 0
        ? sanitizedToolCalls.map(tc => ({ id: tc.id, type: 'function' as const, function: tc.function }))
        : undefined,
    });

    if (sanitizedToolCalls.length > 0) {
      const names = sanitizedToolCalls.map(t => t.function.name).join(', ');
      callbacks.onTimeline?.(
        `Round ${round} · ${sanitizedToolCalls.length} tool call(s) [${names}] · tool_choice=${toolChoice} · ` +
          `${(fullText || '').length}c prose · «${clipTimelineText(fullText || '(empty)', 170)}»`,
      );
    }

    // ── Execute tools imperatively ────────────────────────────────────────
    const invocations: ToolInvocation[] = [];
    let hasMutations = false;

    for (const tc of executableCalls) {
      if (signal?.aborted) break;
      callbacks.onStatus(statusForToolCall(tc));

      // ── delegate_to_coder — run the Coder sub-loop ──────────────────────
      if (tc.function.name === 'delegate_to_coder' && withCoder && coderModel) {
        let args: { instruction?: string; context?: string } = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch { /* ignore */ }
        const instruction = args.instruction?.trim() ?? '';
        const context = args.context?.trim() ?? '';

        callbacks.onLog(`Delegating to Coder: ${instruction.slice(0, 120)}`, 'info');

        const coderSummary = await runCoderSubLoop({
          coderModel,
          instruction,
          context,
          projectPath,
          signal,
          maxCoderRounds,
          scaffoldHint,
          envInfo: envInfo ?? useWorkbenchStore.getState().envInfo ?? undefined,
          callbacks: {
            onLog: callbacks.onLog,
            onTerminal: callbacks.onTerminal,
            onStatus: callbacks.onStatus,
            onChunk: callbacks.onChunk,
            onTokens: callbacks.onTokens,
            onTimeline: callbacks.onTimeline,
            onRoundComplete: (content, coderInvocations) =>
              callbacks.onRoundComplete(content, coderInvocations, 'coder'),
          },
        });

        const delegateInvocation: ToolInvocation = {
          id: tc.id,
          name: 'delegate_to_coder',
          argsJson: tc.function.arguments,
          status: 'completed',
          stdout: coderSummary,
          exitCode: 0,
        };
        invocations.push(delegateInvocation);
        hasMutations = true; // coder likely wrote files — trigger verification
        callbacks.onTimeline?.(`→ delegate_to_coder · summary · «${clipTimelineText(coderSummary, 160)}»`);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: `Coder completed. Summary:\n${coderSummary}`,
        });
        continue;
      }

      const result = await executeAgentToolCall(tc, projectPath, callbacks, withCoder, { maxFileReadChars, backgroundSettleMs });
      invocations.push(result);
      callbacks.onTimeline?.(formatToolTimelineLine(result));
      if (tc.function.name === 'run_terminal_cmd' || tc.function.name === 'write_to_file') {
        hasMutations = true;
      }
      // tool_call_id MUST match the sanitized id we put in the assistant message
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: formatToolResultForModel(result),
      });
    }

    // Also emit finish_task invocation to UI if present
    if (finishCall) {
      invocations.push({ id: finishCall.id, name: 'finish_task', argsJson: finishCall.function.arguments, status: 'completed', stdout: '', exitCode: 0 });
      messages.push({ role: 'tool', tool_call_id: finishCall.id, content: 'Task marked complete.' });
    }

    // ── Repetition detection ──────────────────────────────────────────────────
    // Track fingerprints for all executed tool calls this round and check for
    // repeated identical attempts that indicate the agent is looping.
    let repetitionExitTriggered = false;
    for (const tc of executableCalls) {
      const fp = toolFingerprint(tc.function.name, tc.function.arguments);
      const count = (fingerprintCounts.get(fp) ?? 0) + 1;
      fingerprintCounts.set(fp, count);
      recentCallFingerprints.push(fp);
      // Keep window to last 20 fingerprints
      if (recentCallFingerprints.length > 20) recentCallFingerprints.shift();

      if (count >= exitAt) {
        // Force-exit — agent is clearly spinning on the same approach
        const snippet = tc.function.arguments.slice(0, 300);
        callbacks.onLog(
          `Repetition detected: "${tc.function.name}" called ${count} times with near-identical args — stopping loop.`,
          'warning',
        );
        if (fullText || invocations.length > 0) {
          callbacks.onRoundComplete(fullText, invocations, 'orchestrator');
        }
        callbacks.onFinished(
          `**Agent stopped — repeated the same approach ${count} times without success.**\n\n` +
          `The agent kept calling \`${tc.function.name}\` with the same arguments:\n\`\`\`\n${snippet}\n\`\`\`\n\n` +
          `This usually means the agent is stuck on a problem it cannot solve with the current strategy. ` +
          `Try rephrasing your request, providing more context about the error, or debugging manually.\n\n` +
          `Completed ${round} of ${roundLimit} max rounds.`,
        );
        repetitionExitTriggered = true;
        break;
      }

      if (count === nudgeAt) {
        // Inject a strategy-change nudge into the conversation
        const nudge =
          `You have attempted the same action (${tc.function.name}) with near-identical arguments ${count} times ` +
          `and it has not resolved the problem. **Try a fundamentally different strategy.** ` +
          `Consider reading error output more carefully, checking a different file, searching for the root cause, ` +
          `or calling \`finish_task\` to explain what is blocking you if you cannot proceed.`;
        messages.push({ role: 'user', content: nudge });
        callbacks.onLog(
          `Repetition nudge: "${tc.function.name}" repeated ${count}x — injecting strategy-change prompt.`,
          'warning',
        );
      }
    }
    if (repetitionExitTriggered) return;

    // Emit this round's message to UI
    if (fullText || invocations.length > 0) {
      callbacks.onRoundComplete(fullText, invocations, 'orchestrator');
    }

    // Terminate on finish_task
    if (finishCall) {
      let summary = '';
      try {
        const a = JSON.parse(finishCall.function.arguments || '{}') as { summary?: string };
        summary = a.summary?.trim() ?? '';
      } catch { /* ignore */ }
      // Do not pass fullText — onRoundComplete already added this round's bubble.
      callbacks.onFinished(summary);
      return;
    }

    // If the model produced no tool calls, try to auto-recover before nudging.
    // Some weak models output a JSON summary as plain text instead of calling finish_task.
    if (toolCalls.length === 0) {
      // ── Auto-convert text-only summaries to finish_task ───────────────
      // Many free/small models respond with a JSON object like {"summary": "..."} or
      // plain prose saying "All done" instead of actually calling finish_task.
      // Detect this and auto-finish rather than wasting rounds nudging.
      const trimmed = (fullText || '').trim();
      let autoSummary: string | null = null;

      // Case 1: model outputs a JSON object with a "summary" key
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed) as Record<string, unknown>;
          if (typeof parsed.summary === 'string') {
            autoSummary = parsed.summary;
          }
        } catch { /* not valid JSON — fall through */ }
      }

      // Case 2: model's text clearly signals completion (and we've done real work)
      const hasDoneWork = messages.some(m => m.role === 'tool');
      if (!autoSummary && hasDoneWork) {
        const lower = trimmed.toLowerCase();
        const completionSignals = [
          'task is complete', 'task is fully complete', 'all done', 'all tasks completed',
          'all steps completed', 'all steps done', 'steps completed',
          'implementation is complete', 'project is complete', 'work is done',
          'successfully completed', 'have been implemented', 'have been added',
          'completed successfully', 'is now complete', 'are now complete',
          'everything is set up', 'setup is complete', 'build succeeded',
          'dev server runs', 'dev server is running', 'running successfully',
        ];
        if (completionSignals.some(sig => lower.includes(sig))) {
          autoSummary = trimmed.slice(0, 500);
        }
      }

      if (autoSummary) {
        callbacks.onLog(
          `Orchestrator replied with text summary instead of calling finish_task — auto-finishing.`,
          'info',
        );
        callbacks.onTimeline?.(
          `Round ${round} · auto-converted text summary → finish_task`,
        );
        callbacks.onFinished(autoSummary);
        return;
      }

      consecutiveNoTools++;
      callbacks.onTimeline?.(
        `Round ${round} · NO TOOLS · ${consecutiveNoTools}/${noToolLimit} · ` +
          `«${clipTimelineText(fullText || '(empty)', 260)}»`,
      );
      if (consecutiveNoTools >= noToolLimit) {
        // Last chance: if the model has done work but just can't call finish_task,
        // auto-finish gracefully instead of showing a scary error.
        if (hasDoneWork) {
          callbacks.onLog(
            `Orchestrator could not call finish_task after ${consecutiveNoTools} attempts — auto-finishing with last response.`,
            'warning',
          );
          callbacks.onFinished(trimmed.slice(0, 500) || 'Agent completed work but could not call finish_task.');
          return;
        }
        callbacks.onLog(
          `Orchestrator produced no tool calls for ${consecutiveNoTools} consecutive round(s) — stopping agent loop.`,
          'warning',
        );
        const orchToolList = agentTools.map(t => `\`${t.function.name}\``).join(', ');
        const orchestratorHint = withCoder
          ? `The **Orchestrator** model replied with plain text **${consecutiveNoTools} times in a row** without calling any tools. ` +
            `Registered orchestrator tools: ${orchToolList}. ` +
            `That ends the agent loop even if the **Coder** was working earlier — the Orchestrator must keep issuing tool calls until it calls \`finish_task\`.\n\n` +
            `**Common causes:** the model "summarizes" in prose instead of using tools; weak tool-calling on this provider; or it's stuck after verification messages. ` +
            `Try a stronger orchestrator, shorten the task, or tell it explicitly: "Use web_search if stuck, then delegate_to_coder; call finish_task when done."\n\n` +
            `If the model truly cannot call tools here, switch to **Chat mode** or change provider/model.`
          : 'The model responded with text but did not use any tools after multiple attempts. ' +
            'This usually means the model has weak or no function-calling support for this provider. ' +
            'Try rephrasing your request, switching to a model with reliable tool calling ' +
            '(e.g. GPT-4o, Claude, Qwen-2.5-coder), or using **Chat mode** for a plain conversation.';
        callbacks.onFinished(orchestratorHint);
        return;
      }
      // Escalate nudge strength on repeat offences.
      // Be very explicit about finish_task — many models don't know about it.
      const toolNames = agentTools.map(t => t.function.name).join(', ');
      const nudge = consecutiveNoTools === 1
        ? (withCoder
          ? 'You must use tools every turn. Use `web_search` / `fetch_url` for external docs or error explanations when the Coder is stuck; `delegate_to_coder` for repo work; `run_terminal_cmd` only for install/build/test/dev server; `save_memory` if needed; when DONE call `finish_task` with a summary. Do not explain — emit a tool call now.'
          : 'You must use tools to complete the task. If you are done, call `finish_task` with a summary. Otherwise use your tools now — do not explain what you plan to do.')
        : `CRITICAL: You MUST call one of your tools RIGHT NOW. Available: ${toolNames}. ` +
          `If the task is complete, call \`finish_task\` with arguments {"summary": "what was done"}. ` +
          'Do NOT write prose. Emit a function call immediately.';
      messages.push({ role: 'user', content: nudge });
      callbacks.onLog(
        `Model produced no tool calls (attempt ${consecutiveNoTools}/${noToolLimit}) — nudging to use tools.`,
        'warning',
      );
      const nextChoice = !orchRequiredFailed ? 'tool_choice=required' : 'tool_choice=auto (required failed earlier)';
      callbacks.onStatus(
        `Orchestrator · ${model.modelId} · text-only reply, no tools — re-prompt ${consecutiveNoTools + 1}/${noToolLimit} · next ${nextChoice}`,
      );
      callbacks.onNoToolWarning?.(consecutiveNoTools, noToolLimit, 'orchestrator');
      continue;
    }
    consecutiveNoTools = 0;

    // ── Auto-install dependencies before first verification ─────────────
    if (hasMutations && validationCommand && isTauri() && !signal?.aborted) {
      const verifyCwd = resolveProjectRoot(projectPath, useWorkbenchStore.getState().files);
      const pm = validationCommand.startsWith('pnpm') ? 'pnpm' :
                 validationCommand.startsWith('yarn') ? 'yarn' :
                 validationCommand.startsWith('bun') ? 'bun' : 'npm';
      try {
        const hasPackageJson = useWorkbenchStore.getState().files
          .some(f => f.name === 'package.json' && (f.path === 'package.json' || f.path.split('/').length <= 2));
        if (hasPackageJson) {
          const checkModules = await executeCommand('test -d node_modules && echo exists || echo missing', verifyCwd);
          if (checkModules.stdout.trim() === 'missing') {
            callbacks.onStatus(`Installing dependencies: ${pm} install`);
            callbacks.onTimeline?.(`Auto-install: ${pm} install (node_modules missing)`);
            callbacks.onLog(`Auto-installing dependencies: ${pm} install`, 'info');
            const installResult = await executeCommand(`${pm} install`, verifyCwd);
            installResult.stdout.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(l));
            installResult.stderr.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(`! ${l}`));
            if (installResult.code !== 0) {
              callbacks.onLog(`${pm} install failed (exit ${installResult.code})`, 'warning');
              callbacks.onTimeline?.(`→ ${pm} install · exit ${installResult.code} · failed`);
            } else {
              callbacks.onTimeline?.(`→ ${pm} install · exit 0 · ok`);
            }
          }
          // Scan source files for imports not in package.json and batch-install them
          await scanAndInstallMissingDeps(verifyCwd, pm, callbacks);
        }
      } catch {
        // Non-critical — skip and let verification run anyway
      }
    }

    // ── Verification gate ─────────────────────────────────────────────────
    if (hasMutations && validationCommand && isTauri() && !signal?.aborted) {
      const shortCmd = validationCommand.length > 40 ? validationCommand.slice(0, 37) + '…' : validationCommand;
      callbacks.onStatus(`Verifying: ${shortCmd}`);
      callbacks.onLog(`Verification: ${validationCommand}`, 'info');
      try {
        const verifyCwd = resolveProjectRoot(projectPath, useWorkbenchStore.getState().files);
        let vResult = await executeCommand(validationCommand, verifyCwd);

        // If verification fails with unresolved imports, batch-install missing deps and retry once
        if (vResult.code !== 0) {
          const combinedOutput = vResult.stdout + '\n' + vResult.stderr;
          const isMissingDep = /failed to resolve import|Cannot find module|Module not found|Could not resolve/i.test(combinedOutput);
          if (isMissingDep) {
            const retryPm = validationCommand.startsWith('pnpm') ? 'pnpm' :
                            validationCommand.startsWith('yarn') ? 'yarn' :
                            validationCommand.startsWith('bun') ? 'bun' : 'npm';
            callbacks.onTimeline?.(`Verify failed (missing deps) — scanning imports…`);
            const installed = await scanAndInstallMissingDeps(verifyCwd, retryPm, callbacks);
            if (installed.length > 0) {
              callbacks.onLog(`Re-running verification after installing ${installed.length} dep(s): ${installed.join(', ')}`, 'info');
              callbacks.onTimeline?.(`Re-verify after batch install of ${installed.length} dep(s)`);
              vResult = await executeCommand(validationCommand, verifyCwd);
            }
          }
        }

        vResult.stdout.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(l));
        vResult.stderr.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(`! ${l}`));

        // Pick up dev-server URLs from verification output (strip ANSI color codes)
        const urlRe = /https?:\/\/[^\s'">\])+,;]+/gi;
        // eslint-disable-next-line no-control-regex
        const verifyOut = (vResult.stdout + '\n' + vResult.stderr).replace(/\x1b\[[0-9;]*m/g, '');
        const verifyUrlMatches = verifyOut.match(urlRe);
        if (verifyUrlMatches) {
          const preferred = verifyUrlMatches.find(u => /localhost|127\.0\.0\.1/i.test(u)) ?? verifyUrlMatches[0];
          const cleanUrl = preferred.replace(/[/,;:]+$/, '');
          if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(cleanUrl)) {
            setLastDevServerUrl(cleanUrl);
            callbacks.onLog(`Dev server detected: ${cleanUrl}`, 'success');
            callbacks.onTimeline?.(`Dev server: ${cleanUrl}`);
          }
        }

        const pass = vResult.code === 0;
        if (pass) {
          consecutivePassingVerifications++;
          consecutiveVerifyFailures = 0;
        } else {
          consecutivePassingVerifications = 0;
          consecutiveVerifyFailures++;
        }
        const verifyTail = pass
          ? 'ok'
          : clipTimelineText(vResult.stderr || vResult.stdout || '(no output)', 220);
        callbacks.onTimeline?.(`Verify · exit ${vResult.code} · ${verifyTail}`);
        let verMsg: string;
        if (!pass) {
          verMsg = `Verification failed (exit ${vResult.code}) for \`${validationCommand}\`:\n\nstdout:\n${vResult.stdout.slice(0, 2000)}\n\nstderr:\n${vResult.stderr.slice(0, 2000)}\n\nFix the errors and try again.`;
          if (consecutiveVerifyFailures >= DEFAULT_AGENT_VERIFY_FAIL_WEB_NUDGE_AFTER) {
            const webLine = withCoder
              ? `**Repeated verification failures (${consecutiveVerifyFailures} in a row).** Before another blind edit, call \`web_search\` with the key error line, or \`fetch_url\` on official docs / an issue thread. Then call \`delegate_to_coder\` and put URLs plus short excerpts in the \`context\` field so the Coder applies an evidence-based fix.`
              : `**Repeated verification failures (${consecutiveVerifyFailures} in a row).** Before repeating the same local edits, call \`web_search\` or \`fetch_url\` using the error text above, then fix the code using that research.`;
            verMsg += `\n\n---\n${webLine}`;
            callbacks.onTimeline?.(
              `Verify · web-research nudge · failures=${consecutiveVerifyFailures}`,
            );
          }
        } else if (consecutivePassingVerifications >= 2) {
          verMsg = `Verification passed ✓ again (\`${validationCommand}\` has passed ${consecutivePassingVerifications} times). The project builds successfully — YOU MUST call \`finish_task\` RIGHT NOW. Stop all further checks. The task is done.`;
        } else {
          verMsg = `Verification passed ✓ (\`${validationCommand}\`). The project builds. Call \`finish_task\` now with a summary — do not run more checks.`;
        }
        messages.push({ role: 'user', content: verMsg });
        callbacks.onLog(`Verification ${pass ? 'passed' : 'failed'}`, pass ? 'success' : 'warning');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        callbacks.onLog(`Verification command failed: ${msg}`, 'warning');
      }
    }
  }

  // Max rounds exhausted
  const lastDistinctCalls = [...new Set(recentCallFingerprints.slice(-6))]
    .map(fp => fp.split('::')[0])
    .join(', ');
  callbacks.onFinished(
    `**Agent reached the ${roundLimit}-round limit** without calling \`finish_task\`.\n\n` +
    `Last tool calls: \`${lastDistinctCalls || 'none'}\`.\n\n` +
    `The task may need further work. Continue in a new message, rephrase the request, ` +
    `or increase the "Max agent rounds" limit in the heartbeat settings if the task genuinely requires more steps.`,
  );
}
