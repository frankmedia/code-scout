/**
 * agentToolDefinitions — OpenAI-compatible tool schemas for the agent loop.
 *
 * Extracted from agentToolLoop.ts so tool schemas live in a focused module that
 * small models can read and reason about without ingesting execution logic.
 * agentToolLoop.ts re-exports everything from here for backward compat.
 */

import { ALL_CHAT_TOOLS } from './chatTools';

// ─── finish_task ──────────────────────────────────────────────────────────────

export const FINISH_TASK_TOOL = {
  type: 'function' as const,
  function: {
    name: 'finish_task',
    description:
      'Signal that the task is fully complete. Call this after you have verified your work. Include a plain-text summary of what was done.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'Concise summary of what was done and the current state of the work.',
        },
      },
      required: ['summary'],
    },
  },
};

// ─── delegate_to_coder ────────────────────────────────────────────────────────

export const DELEGATE_TO_CODER_TOOL = {
  type: 'function' as const,
  function: {
    name: 'delegate_to_coder',
    description:
      'Delegate a coding task to the local Coder agent. The Coder can read files, write files, search, and run commands. You just need to describe what to do. Keep it concise — the Coder is capable.',
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description:
            'What to do: name the target files, describe the problem or feature, and what the fix/change should achieve. The Coder will read the files itself.',
        },
        context: {
          type: 'string',
          description:
            'Optional: paste error output, verification logs, or **summaries from your own web_search/fetch_url** (URLs + key excerpts) so the Coder can apply an informed fix. Do NOT paste whole file contents — the Coder reads files itself.',
        },
      },
      required: ['instruction'],
    },
  },
};

// ─── reindex_project ──────────────────────────────────────────────────────────

export const REINDEX_PROJECT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'reindex_project',
    description:
      'Re-scan all project files and rebuild the Code Scout context index (.codescout/). ' +
      'Call this after significant files have been added, removed, or modified so the ' +
      'project context reflects the current state of the codebase.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Optional: why the reindex is being triggered (e.g. "files added in src/").',
        },
      },
      required: [],
    },
  },
};

// ─── Tool selection ───────────────────────────────────────────────────────────

/**
 * When a dedicated Coder model is configured, the Orchestrator gets a lean set:
 * shell verify/install, web/registry research, terminal snapshot, memory, reindex,
 * plus `delegate_to_coder` / `finish_task` (appended in `buildAgentTools`). File I/O
 * stays on the Coder.
 */
const ORCHESTRATOR_LEAN_TOOL_NAMES = new Set([
  'run_terminal_cmd',
  'web_search',
  'fetch_url',
  'browse_web',
  'lookup_package',
  'get_terminal_snapshot',
  'save_memory',
  'reindex_project',
]);

/**
 * Build the full tool list for agent mode.
 * When a dedicated Coder model is configured, include `delegate_to_coder` so the
 * Orchestrator can hand off file-writing work and avoid paying token costs for raw
 * file content in the orchestrator context window.
 */
export function buildAgentTools(withCoder: boolean) {
  if (!withCoder) return [...ALL_CHAT_TOOLS, REINDEX_PROJECT_TOOL, FINISH_TASK_TOOL];
  const leanTools = ALL_CHAT_TOOLS.filter(t =>
    ORCHESTRATOR_LEAN_TOOL_NAMES.has(t.function.name),
  );
  return [...leanTools, REINDEX_PROJECT_TOOL, DELEGATE_TO_CODER_TOOL, FINISH_TASK_TOOL];
}

/** All tools available in agent mode — chat tools plus finish_task (no delegation). */
export const ALL_AGENT_TOOLS = buildAgentTools(false);
