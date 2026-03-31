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
