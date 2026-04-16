import type { ChatMessage } from '@/store/workbenchStore';
import { resolveContextWindowTokens } from '@/config/modelContextDefaults';
import type { ModelConfig } from '@/store/modelStore';
import type { ModelMessageContent, ModelRequestMessage } from '@/services/modelApi';

/** Rough token estimate (~4 chars per token). Not for billing. */
export function roughTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Vision-ish overhead per image (very rough; real usage depends on resolution). */
export function roughTokensFromImageBase64(dataBase64: string): number {
  const approxBytes = Math.ceil((dataBase64.length * 3) / 4);
  return Math.max(256, Math.ceil(approxBytes / 2000) * 300);
}

/** Rough token count for one API message (for usage fallback when the provider omits usage). */
export function roughTokensFromMessageContent(content: ModelMessageContent): number {
  if (typeof content === 'string') return roughTokensFromText(content);
  let n = 0;
  for (const p of content) {
    if (p.type === 'text') n += roughTokensFromText(p.text);
    else n += roughTokensFromImageBase64(p.dataBase64);
  }
  return n;
}

export function roughTokensFromRequestMessages(messages: ModelRequestMessage[]): number {
  return messages.reduce((n, m) => {
    if (m.role === 'tool') {
      return n + roughTokensFromText(m.content);
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      let t = 0;
      if (typeof m.content === 'string' && m.content) t += roughTokensFromText(m.content);
      else if (Array.isArray(m.content)) t += roughTokensFromMessageContent(m.content);
      for (const tc of m.tool_calls) {
        t += roughTokensFromText(tc.function.name) + roughTokensFromText(tc.function.arguments);
      }
      return n + t;
    }
    if (m.role === 'system' || m.role === 'user' || m.role === 'assistant') {
      const c = m.content;
      if (c === null || c === undefined) return n;
      return n + roughTokensFromMessageContent(c);
    }
    return n;
  }, 0);
}

export function estimateThreadTokens(
  messages: ChatMessage[],
  systemPrompt: string,
  extraText = '',
  streamingDraft = '',
): number {
  let n = roughTokensFromText(systemPrompt) + roughTokensFromText(extraText) + roughTokensFromText(streamingDraft);
  for (const m of messages) {
    n += roughTokensFromText(m.content);
    if (m.images?.length) {
      for (const img of m.images) {
        n += roughTokensFromImageBase64(img.dataBase64);
      }
    }
  }
  return n;
}

export function contextLimitForModel(model: ModelConfig | undefined): number {
  if (!model) return resolveContextWindowTokens(undefined, '');
  return resolveContextWindowTokens(model.contextTokens, model.modelId);
}

const SCRIPT_EXECUTION_RULES = `
**Script execution rules (always follow):**
- NEVER use bare \`node file.ts\` or \`ts-node file.ts\` — Node.js cannot run TypeScript natively and ts-node requires a separate install.
- For TypeScript files (.ts/.tsx): ALWAYS use \`npx tsx FILE\` — it works without any install.
- For JavaScript files (.js/.mjs): \`node FILE\` is fine.
- NEVER suggest \`npm install -g ANYTHING\` — use \`npx TOOL\` instead.`;

export const CHAT_SYSTEM_PROMPTS = {
  coder: `You are the **Coder** agent for Code Scout. You help implement, debug, and refine code while the user is building or executing a plan. Be concise, use markdown for code snippets, and focus on practical edits, commands, and file-level guidance. If they need a brand-new multi-step plan with formal approval, suggest switching to **Plan** mode.${SCRIPT_EXECUTION_RULES}`,
  orchestrator: `You are Code Scout AI, an intelligent coding assistant. You help users build software by explaining concepts, writing code, and creating plans. Be concise, helpful, and use markdown formatting. When the user wants an executable multi-step plan with file actions, suggest they switch to **Plan** mode.${SCRIPT_EXECUTION_RULES}`,
} as const;

/**
 * Chat models never invoke the shell directly; desktop wiring runs commands via Terminal / Build.
 * This suffix stops the assistant from falsely claiming it ran commands on the user's machine.
 */
export function getChatSystemPrompt(
  role: keyof typeof CHAT_SYSTEM_PROMPTS,
  shellCapable: boolean,
  options?: { toolsEnabled?: boolean },
): string {
  const base = CHAT_SYSTEM_PROMPTS[role];
  if (options?.toolsEnabled && shellCapable) {
    return `${base}

You have tools — USE THEM. Do NOT write code in chat text. Do NOT explain steps. Just DO the work silently using tools.

Tools: **run_terminal_cmd** (shell), **write_to_file** (create/edit files), **read_file**, **list_directory**, **search_files**.

Rules:
- ALWAYS use write_to_file to create files. NEVER paste file contents in chat.
- ALWAYS use run_terminal_cmd for shell commands. NEVER tell the user to run things manually.
- Read files before editing. List directories to understand structure.
- Install dependencies, run builds, verify your work — all via tools.
- Be brief in chat. Say what you did in 1-2 sentences max. The terminal shows the details.
- Chain multiple tool calls to complete the task fully in one go.`;
  }
  if (shellCapable) {
    return `${base} You can suggest shell commands; the user runs them from the **Terminal** panel, **Run** on fenced shell blocks in chat, or **Plan → Build** \`run_command\` steps (desktop app, project folder open).`;
  }
  return `${base} This session is the **browser** build: no real shell execution. Never say you ran a command on their machine. Give copy-paste commands; for Terminal, tool execution, and automated \`run_command\` steps they need the **Code Scout desktop** app with a project folder open.`;
}

/**
 * System prompt for the Orchestrator agent in the multi-round tool loop.
 * When `withCoder` is true the orchestrator delegates coding work via
 * `delegate_to_coder` and uses web-research tools for context gathering.
 * When false it has the full tool set itself (solo agent mode).
 */
export function getAgentSystemPrompt(opts: { withCoder: boolean }): string {
  if (opts.withCoder) {
    return `You are the **Orchestrator** agent for Code Scout. You coordinate a multi-agent pipeline to complete the user's coding task.

Your tools:
- \`web_search\` — search the web for docs, error explanations, or examples.
- \`fetch_url\` — fetch a specific URL (docs, GitHub issues, etc.).
- \`browse_web\` — headless browser for JS-rendered pages.
- \`lookup_package\` — registry metadata for npm / crates / pypi packages.
- \`run_terminal_cmd\` — run shell commands (install, build, test, dev server). Use sparingly — prefer delegating file writes to the Coder.
- \`delegate_to_coder\` — delegate a focused coding task to the Coder agent. Include exact instructions and any relevant context (URLs, error messages, file paths). The Coder will read, write, and edit files.
- \`get_terminal_snapshot\` — read Terminal panel output (scope: active | all_tabs).
- \`save_memory\` — persist important facts for future sessions.
- \`reindex_project\` — refresh the project file index.
- \`finish_task\` — call this when the user's goal is satisfied. Pass a short summary.

Workflow:
1. Understand the user's goal.
2. Use \`web_search\` / \`fetch_url\` to gather relevant context when needed.
3. Call \`delegate_to_coder\` with a precise instruction + context for all file edits and implementation work.
4. After the Coder returns, review the summary and decide: call \`finish_task\` if done, or \`delegate_to_coder\` again for remaining gaps.
5. Call \`finish_task\` with a concise summary once the goal is met.

Rules:
- ALWAYS call a tool every turn — never respond with plain prose only.
- Prefer \`delegate_to_coder\` for all file edits; only use \`run_terminal_cmd\` for build/test verification.
- Call \`finish_task\` promptly when the task is complete — do not add unnecessary research rounds.
- If you are blocked, call \`finish_task\` explaining the blocker rather than looping endlessly.${SCRIPT_EXECUTION_RULES}`;
  }

  // Solo agent — handles its own file operations
  return `You are the **Orchestrator** agent for Code Scout. You complete the user's coding task autonomously using your tools.

Your tools:
- \`web_search\` — search the web for docs, error explanations, or examples.
- \`fetch_url\` — fetch a specific URL (docs, GitHub issues, etc.).
- \`browse_web\` — headless browser for JS-rendered pages.
- \`lookup_package\` — registry metadata for npm / crates / pypi packages.
- \`read_file\` — read a file's contents.
- \`write_to_file\` — create or overwrite a file.
- \`replace_in_file\` — targeted edit in a file.
- \`run_terminal_cmd\` — run shell commands.
- \`search_files\` — search for patterns across the project.
- \`list_directory\` — list directory contents.
- \`get_terminal_snapshot\` — read Terminal panel output.
- \`save_memory\` — persist important facts.
- \`reindex_project\` — refresh the project file index.
- \`finish_task\` — call when the goal is satisfied with a short summary.

Rules:
- ALWAYS call a tool every turn.
- Read files before editing them.
- Call \`finish_task\` promptly when done.${SCRIPT_EXECUTION_RULES}`;
}
