import { PlanStep, useWorkbenchStore } from '@/store/workbenchStore';
import { ModelConfig } from '@/store/modelStore';
import { callModel, modelToRequest, ModelRequestMessage } from './modelApi';
import { ValidationRunResult, formatValidationFailure } from './validationRunner';
import type { RepairLedger } from './repairTypes';
import { formatLedgerForPrompt } from './dependencyRepairEngine';
import type { EnvironmentInfo } from './environmentProbe';

// ─── Orchestrator Re-planning ─────────────────────────────────────────────────

export interface ReplanInput {
  step: PlanStep;
  attemptCount: number;
  errorSummary: string;
  attemptHistory: string[];
  /** Full repair ledger so the orchestrator doesn't repeat exhausted strategies */
  ledger?: RepairLedger;
  projectContext?: RepairProjectContext;
  /** e.g. vite.config.ts, src/main.tsx … */
  projectFileHints?: string;
  /** Persistent agent memory — past repair outcomes for this project */
  agentMemory?: string;
  /** Full probed environment — gives the orchestrator tsx/playwright/scripts/PM awareness */
  envInfo?: EnvironmentInfo;
  model: ModelConfig;
  signal?: AbortSignal;
}

/**
 * Ask the orchestrator model to generate 1–3 fresh replacement steps for a
 * failing step. Unlike the repair agent (which tweaks the existing step), this
 * generates an entirely new strategy: different commands, different file layout,
 * different approach. Returns an ordered list of PlanStep-compatible objects to
 * execute in place of the original failing step.
 */
export function requestOrchestratorReplanning(input: ReplanInput): Promise<OrchestratorReplanStep[]> {
  const { step, attemptCount, errorSummary, attemptHistory, ledger, projectContext, projectFileHints, agentMemory, envInfo, model, signal } = input;

  const platformBlock = projectContext?.arch === 'arm64'
    ? `\nPLATFORM: macOS arm64 — use --no-package-lock --omit=optional for npm installs, never --save-optional for native binaries, use --no-save instead.\n`
    : '';

  const memoryBlock = agentMemory
    ? `\nPAST REPAIR MEMORY (what worked and failed on this project in previous sessions — use this to avoid repeating past failures and to reuse past solutions):\n${agentMemory.slice(0, 2000)}\n`
    : '';

  const envRunbookBlock = envInfo ? `\nENVIRONMENT: tsx=${envInfo.tsxAvailable ? 'available' : 'use npx tsx'}, ts-node=${envInfo.tsNodeAvailable ? 'installed' : 'NOT installed'}, playwright=${envInfo.playwrightAvailable ? 'installed' : 'not installed'}, PM=${projectContext?.packageManager ?? envInfo.packageManager ?? 'npm'}, lockfile=${envInfo.detectedLockfile ?? 'none'}\n` : '';

  const system = `You are the orchestrator agent. A step in the plan has failed after ${attemptCount} repair attempts.
Your job is to generate a COMPLETELY NEW STRATEGY — not a tweak, but a fresh approach that avoids whatever was broken.
${projectContext ? `PROJECT: ${projectContext.framework} / ${projectContext.language} / ${projectContext.packageManager}` : ''}${platformBlock}${envRunbookBlock}${memoryBlock}
Output ONLY a JSON array of 1–3 steps. No markdown fences, no explanation.
Each step must be one of:
  {"action":"run_command","description":"...","command":"single shell command"}
  {"action":"create_file","description":"...","path":"relative/path","content":"full file content"}
  {"action":"edit_file","description":"...","path":"relative/path","before":"exact text to replace","after":"replacement text"}

Rules:
- NEVER repeat any approach from the attempt history below.
- Return the minimal number of steps that could plausibly resolve the error.
- For install failures: try a different package manager, different flags, or skip the package entirely and use an alternative.
- For build failures: consider a different file structure, different imports, or a simpler implementation.
- For missing binding / native module errors: the canonical fix is rm -rf the x64 dir + reinstall without lockfile.
- Paths must exist in PROJECT_FILES or be newly created by your steps.
- Return an empty array [] ONLY if you are completely certain no alternative approach exists.`;

  const ledgerSection = ledger && ledger.attempts.length > 0
    ? `\nREPAIR HISTORY (all strategies already tried — your replacement steps MUST avoid ALL of these):\n${formatLedgerForPrompt(ledger)}\n`
    : (attemptHistory.length > 0
      ? `\nAttempts already tried (DO NOT repeat these):\n${attemptHistory.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n`
      : '');

  const user = `Failing step: ${step.action} — ${step.description}
${step.command ? `Command was: ${step.command}` : ''}
${step.path ? `File was: ${step.path}` : ''}

Error after ${attemptCount} attempts:
${errorSummary.slice(0, 2000)}
${ledgerSection}
${projectFileHints ? `PROJECT_FILES:\n${projectFileHints.slice(0, 3000)}` : ''}

Generate 1–3 replacement steps with a completely different strategy.`;

  return new Promise((resolve) => {
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    let full = '';
    callModel(
      modelToRequest(model, messages, signal ? { signal } : undefined),
      (chunk) => { full += chunk; },
      (text) => {
        try {
          const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
          const raw = (fence ? fence[1] : text).trim();
          const arrMatch = raw.match(/\[[\s\S]*\]/);
          if (!arrMatch) { resolve([]); return; }
          const arr = JSON.parse(arrMatch[0]) as OrchestratorReplanStep[];
          if (!Array.isArray(arr)) { resolve([]); return; }
          // Validate each step has at minimum action + description
          const valid = arr.filter(s =>
            s && typeof s.action === 'string' && typeof s.description === 'string',
          ).slice(0, 3);
          resolve(valid);
        } catch {
          resolve([]);
        }
      },
      () => resolve([]),
      (usage) => {
        const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
        if (total > 0) useWorkbenchStore.getState().addAiSessionTokens(total);
      },
    );
  });
}

export interface OrchestratorReplanStep {
  action: 'run_command' | 'create_file' | 'edit_file';
  description: string;
  command?: string;
  path?: string;
  content?: string;
  before?: string;
  after?: string;
}

export type RepairFix =
  | { kind: 'edit_file'; path: string; before: string; after: string }
  | { kind: 'run_command'; command: string }
  | { kind: 'create_file'; path: string; content: string };

/** Structured project context so the repair agent knows what it's working with. */
export interface RepairProjectContext {
  framework: string;
  packageManager: string;
  language: string;
  entryPoints?: string[];
  runCommands?: Record<string, string>;
  /** e.g. "darwin", "linux", "win32" */
  os?: string | null;
  /** e.g. "arm64", "x64" */
  arch?: string | null;
}

function buildRepairSystem(ctx?: RepairProjectContext, envInfo?: EnvironmentInfo): string {
  const pm = ctx?.packageManager ?? envInfo?.packageManager ?? 'npm';
  const projectBlock = ctx ? `
PROJECT CONTEXT (use this to make correct repair decisions):
  FRAMEWORK: ${ctx.framework}
  LANGUAGE: ${ctx.language}
  PACKAGE_MANAGER: ${pm}
  ${ctx.os ? `PLATFORM: ${ctx.os} / ${ctx.arch ?? 'unknown'} — ensure all commands, binaries, and packages are compatible with this OS and CPU architecture.` : ''}
  ${ctx.entryPoints?.length ? `ENTRY_POINTS: ${ctx.entryPoints.join(', ')}` : ''}
  ${ctx.runCommands ? `SCRIPTS: ${Object.entries(ctx.runCommands).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}
  IMPORTANT: Use "${pm}" for install commands (not npm/yarn/bun unless that IS the package manager).
  IMPORTANT: Use "${ctx.runCommands?.build || `${pm} run build`}" for build validation (not bare "vite build").
` : '';

  // Full environment runbook — tells the repair agent exactly what tools are installed
  const envRunbook = envInfo ? `
ENVIRONMENT (auto-detected on this machine):
  tsx available: ${envInfo.tsxAvailable ? 'YES — use "npx tsx FILE.ts" for TypeScript' : 'use "npx tsx FILE.ts" (works via npx without install)'}
  ts-node: ${envInfo.tsNodeAvailable ? 'installed (but PREFER tsx)' : 'NOT installed — NEVER suggest ts-node'}
  Playwright: ${envInfo.playwrightAvailable ? 'installed' : 'NOT installed — must install before using'}
  Node: ${envInfo.nodeVersion ?? 'unknown'}
  Lockfile detected: ${envInfo.detectedLockfile ?? 'none'}
  PM choice: ${pm} (based on ${envInfo.detectedLockfile ? `lockfile ${envInfo.detectedLockfile}` : 'installed versions'})
  ${envInfo.projectScripts && Object.keys(envInfo.projectScripts).length ? `package.json scripts: ${Object.entries(envInfo.projectScripts).map(([k, v]) => `"${k}": "${v}"`).join(', ')}` : ''}
` : '';

  const arm64Block = ctx?.arch === 'arm64' ? `
ARM64 / APPLE SILICON:
- This machine is arm64. All npm install commands must be compatible.
- NEVER suggest strategies that appear in the REPAIR HISTORY block (those were already tried).
- For npm: use npm_config_arch=arm64 as env prefix, --no-package-lock to bypass stale lockfiles.
- For native binding errors ("Cannot find native binding", "npm has a bug related to optional dependencies"): the ONLY reliable fix is rm -rf node_modules package-lock.json && npm install. Do NOT try to install individual binding packages.
- NEVER write to .npmrc files — pass configuration as env vars (npm_config_arch=arm64 npm install ...).
- NEVER use --save-optional. Use --no-save for native binaries.
` : '';

  const scriptExecBlock = `
SCRIPT EXECUTION RULES (mandatory — no exceptions):
- NEVER use bare "node file.ts" or "node file.tsx" — Node.js cannot run TypeScript natively.
- NEVER suggest "ts-node" or "npm install -g ts-node" or any global install whatsoever.
- For TypeScript files (.ts/.tsx): ALWAYS use "npx tsx FILE" (tsx is always available via npx, zero install needed).
- For JavaScript files (.js/.mjs): "node FILE" is fine.
- NEVER use "npm install -g ANYTHING" — use "npx TOOL" or install locally instead.
- If the error says "ts-node: command not found" or "ts-node is not installed": the fix is replacing the command with "npx tsx FILE", NOT installing ts-node.
`;

  return `You are a repair agent. The user's project failed validation. You must output ONLY valid JSON, no markdown fences, no explanation.
${projectBlock}${envRunbook}${arm64Block}${scriptExecBlock}
Schema:
{"kind":"edit_file","path":"relative/path","before":"exact snippet to find","after":"replacement"}
OR
{"kind":"run_command","command":"single shell command"}
OR
{"kind":"create_file","path":"relative/path","content":"entire file content"}

Rules:
- Fix ONLY what the error indicates. Do not refactor or add features.
- For edit_file: "before" must match the file exactly (copy from the excerpt). Keep the change minimal.
- CRITICAL: If the error says "content unchanged" or "Verification partial: File ... content unchanged", your edit_file had no effect. Do NOT try edit_file again. Switch to create_file and write the ENTIRE correct file content from scratch. This is the only way to guarantee the file changes.
- If the error is a missing dependency, prefer run_command with ${ctx?.packageManager ?? 'npm'} install / cargo add etc.
- Use ONLY paths that appear under PROJECT_FILES below. Do not invent vite.config.js if vite.config.ts is listed. Vite + React apps usually use src/main.tsx or src/main.jsx — not main.js at repo root.
- Prefer run_command "${ctx?.runCommands?.build || 'npm run build'}" over bare "vite build" when package.json has a build script.
- If the error is "Identifier X has already been declared" (e.g. App): the file often both imports X from another module and defines X again — remove the duplicate definition or the redundant import so only one binding exists.
- You MAY use run_command to discover system information needed to fix the error: e.g. "find ~/.cargo/registry -path '*plugin-name*' -name '*.toml' | head -10", "cat /path/to/schema.json | python3 -m json.tool | head -50", "rustc --version", "find node_modules/.../permissions -name '*.toml'". Use these when the error involves missing permissions, unknown API schemas, or system-level configuration outside the project tree.
- If you cannot fix it, respond with: {"kind":"edit_file","path":"","before":"","after":""} (empty path) to signal no safe fix.`;
}

function extractJSON(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const raw = fence ? fence[1].trim() : text;
  const m = raw.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

export interface RepairAgentInput {
  step: PlanStep;
  attempt: number;
  maxAttempts: number;
  validation: ValidationRunResult;
  fileExcerpt?: { path: string; content: string };
  /** Newline-separated paths that exist in the project (vite.config.ts, index.html, …) */
  projectFileHints?: string;
  /** Structured project context so repair knows the framework/PM/language */
  projectContext?: RepairProjectContext;
  /** Web search / fetch results gathered during repair escalation */
  researchContext?: string;
  /** Descriptions of what previous attempts tried (to avoid repeating them) */
  previousAttempts?: string[];
  /**
   * Full repair ledger — the LLM sees exactly which deterministic + LLM strategies
   * have already been tried so it cannot repeat them.
   */
  ledger?: RepairLedger;
  /** Free-form hint provided by the user during escalation */
  userHint?: string;
  /** Persistent agent memory — past repair outcomes for this project from previous sessions */
  agentMemory?: string;
  /** Full probed environment — gives the repair agent tsx/playwright/scripts/PM awareness */
  envInfo?: EnvironmentInfo;
  model: ModelConfig;
  signal?: AbortSignal;
}

/**
 * Ask the coder model for a single targeted fix from validation output.
 */
export function requestRepairFix(input: RepairAgentInput): Promise<RepairFix | null> {
  const { step, attempt, maxAttempts, validation, fileExcerpt, projectFileHints, projectContext, researchContext, previousAttempts, ledger, userHint, agentMemory, envInfo, model, signal } = input;
  const failure = formatValidationFailure(validation);

  // The ledger provides the authoritative history. If present, use it as the primary
  // "already tried" source so the LLM cannot repeat deterministic strategies.
  const ledgerBlock = ledger && ledger.attempts.length > 0
    ? `\nREPAIR HISTORY (all strategies already tried — you MUST suggest a COMPLETELY DIFFERENT approach):\n${formatLedgerForPrompt(ledger)}\n`
    : '';

  const previousAttemptsBlock = !ledgerBlock && previousAttempts && previousAttempts.length > 0
    ? `\nPREVIOUS ATTEMPTS (already tried — DO NOT repeat these exact fixes):\n${previousAttempts.join('\n')}\nYou MUST try a DIFFERENT approach from all of the above.\n`
    : '';

  const researchBlock = researchContext
    ? `\nRESEARCH CONTEXT (web search results and docs gathered for this error):\n${researchContext.slice(0, 3000)}\n`
    : '';

  const memoryBlock = agentMemory
    ? `\nPAST REPAIR MEMORY (what worked and failed on this project in previous sessions):\n${agentMemory.slice(0, 1500)}\n`
    : '';

  const hintBlock = userHint
    ? `\nUSER HINT (the user has reviewed the situation and suggests): ${userHint}\nFollow this hint — it takes priority over your own analysis.\n`
    : '';

  const user = `Attempt ${attempt} of ${maxAttempts} (each attempt must be narrower than broad rewrites).${ledgerBlock}${previousAttemptsBlock}${hintBlock}${memoryBlock}${researchBlock}
Failed step: ${step.action}
Description: ${step.description}
${step.path ? `Path: ${step.path}` : ''}
${step.command ? `Command: ${step.command}` : ''}

Validation output:
${failure.slice(0, 6000)}

${projectFileHints?.trim()
  ? `PROJECT_FILES (paths that exist — edit only these unless run_command is clearly needed):\n${projectFileHints.slice(0, 4000)}`
  : ''}

${fileExcerpt
  ? `File excerpt (${fileExcerpt.path}, first 8000 chars):\n${fileExcerpt.content.slice(0, 8000)}`
  : 'No file excerpt — use run_command if the fix is installing packages or running codegen.'}

Return ONLY the JSON object for one fix.`;

  return new Promise((resolve) => {
    const messages: ModelRequestMessage[] = [
      { role: 'system', content: buildRepairSystem(projectContext, envInfo) },
      { role: 'user', content: user },
    ];
    let full = '';
    callModel(
      modelToRequest(model, messages, signal ? { signal } : undefined),
      (chunk) => { full += chunk; },
      (text) => {
        const jsonStr = extractJSON(text);
        if (!jsonStr) {
          resolve(null);
          return;
        }
        try {
          const p = JSON.parse(jsonStr) as Record<string, unknown>;
          const kind = p.kind as string;
          if (kind === 'run_command' && typeof p.command === 'string' && p.command.trim()) {
            resolve({ kind: 'run_command', command: p.command.trim() });
            return;
          }
          if (kind === 'edit_file' && typeof p.path === 'string') {
            const path = p.path.trim();
            if (!path) {
              resolve(null);
              return;
            }
            const before = typeof p.before === 'string' ? p.before : '';
            const after = typeof p.after === 'string' ? p.after : '';
            resolve({ kind: 'edit_file', path, before, after });
            return;
          }
          if (kind === 'create_file' && typeof p.path === 'string' && typeof p.content === 'string') {
            const path = p.path.trim();
            if (!path) {
              resolve(null);
              return;
            }
            resolve({ kind: 'create_file', path, content: p.content });
            return;
          }
        } catch {
          /* fallthrough */
        }
        resolve(null);
      },
      () => resolve(null),
      (usage) => {
        const total = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
        if (total > 0) useWorkbenchStore.getState().addAiSessionTokens(total);
      },
    );
  });
}
