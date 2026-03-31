import type { ToolInvocation } from '@/store/workbenchStore';

// ─── Tool definitions ────────────────────────────────────────────────────────

/** OpenAI-compatible tool definition — `run_terminal_cmd` (Cursor-style). */
export const RUN_TERMINAL_CMD_TOOL = {
  type: 'function' as const,
  function: {
    name: 'run_terminal_cmd',
    description:
      'Execute a shell command in the user\'s opened project root using `sh -c`. Use for npm, pnpm, yarn, git, cargo, builds, tests, linters, curl, mkdir, etc. Prefer one clear command per call; chain with && when needed. For long-running dev servers, set is_background to true.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Full shell command for POSIX sh (e.g. npm test, git status).',
        },
        is_background: {
          type: 'boolean',
          description:
            'If true, the command is treated as a long-running process (dev servers, watchers).',
        },
      },
      required: ['command'],
    },
  },
};

export const WRITE_TO_FILE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'write_to_file',
    description:
      'Create or overwrite a file at the given path relative to the project root. Use for creating new files, writing code, configs, etc.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path from project root (e.g. src/components/Button.tsx).',
        },
        content: {
          type: 'string',
          description: 'Full file content to write.',
        },
      },
      required: ['path', 'content'],
    },
  },
};

export const READ_FILE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    description:
      'Read a file\'s content from the project. Use to inspect existing code before editing.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative file path from project root.',
        },
      },
      required: ['path'],
    },
  },
};

export const LIST_DIR_TOOL = {
  type: 'function' as const,
  function: {
    name: 'list_directory',
    description:
      'List files and folders in a directory relative to the project root. Use to explore project structure.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative directory path (use "." or "" for project root).',
        },
      },
      required: ['path'],
    },
  },
};

export const SEARCH_FILES_TOOL = {
  type: 'function' as const,
  function: {
    name: 'search_files',
    description:
      'Search for a text pattern (regex) across project files. Use to find usages, definitions, imports.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for (e.g. "import.*React", "function handleSubmit").',
        },
        path: {
          type: 'string',
          description: 'Optional: limit search to this subdirectory (e.g. "src/components").',
        },
      },
      required: ['pattern'],
    },
  },
};

export const SAVE_MEMORY_TOOL = {
  type: 'function' as const,
  function: {
    name: 'save_memory',
    description:
      'Persist a learning, preference, or important fact to agent memory so it is remembered in future sessions. Use whenever you discover something important: the correct package manager, a working command, an environment fact, a coding preference, or a past failure to avoid.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title (max 80 chars) describing what is being remembered.',
        },
        content: {
          type: 'string',
          description: 'Full detail to remember. Be specific: include commands, file paths, versions, and why this matters.',
        },
        category: {
          type: 'string',
          enum: ['preference', 'decision', 'error', 'install', 'build_outcome', 'context', 'fix'],
          description: 'Category: "preference" for user preferences, "error" for known failures, "install" for package install outcomes, "fix" for working solutions, "decision" for architecture choices.',
        },
      },
      required: ['title', 'content', 'category'],
    },
  },
};

/** All tools the agent has access to in chat mode. */
export const ALL_CHAT_TOOLS = [
  RUN_TERMINAL_CMD_TOOL,
  WRITE_TO_FILE_TOOL,
  READ_FILE_TOOL,
  LIST_DIR_TOOL,
  SEARCH_FILES_TOOL,
  SAVE_MEMORY_TOOL,
];

// ─── Auto-execute safety ─────────────────────────────────────────────────────

/**
 * Commands considered safe to auto-execute without user approval.
 * Matched against the start of the command string (after trimming).
 */
const SAFE_COMMAND_PREFIXES = [
  'ls', 'cat ', 'head ', 'tail ', 'find ', 'grep ', 'rg ',
  'pwd', 'echo ', 'which ', 'type ',
  'git status', 'git log', 'git diff', 'git branch', 'git remote',
  'npm list', 'npm ls', 'npm info', 'npm view', 'npm outdated',
  'npm install', 'npm i ', 'npm ci',
  'npm run build', 'npm run dev', 'npm run start', 'npm run test', 'npm test', 'npm run lint',
  'npx ', 'pnpm install', 'pnpm add', 'pnpm dev', 'pnpm build', 'pnpm test',
  'yarn install', 'yarn add', 'yarn dev', 'yarn build', 'yarn test',
  'bun install', 'bun add', 'bun dev', 'bun build', 'bun test',
  'cargo build', 'cargo test', 'cargo run', 'cargo check', 'cargo clippy',
  'pip install', 'pip3 install', 'python ', 'python3 ',
  'mkdir ', 'touch ', 'cp ', 'mv ',
  'curl ', 'wget ',
  'tree', 'wc ', 'sort ', 'uniq ', 'diff ',
  'node ', 'deno ', 'tsx ',
  'docker ps', 'docker images', 'docker compose',
];

/** Commands that are never auto-executed regardless of settings. */
const DANGEROUS_PATTERNS = [
  'rm -rf /', 'rm -rf ~', 'rm -rf *',
  'sudo ', ':(){', 'mkfs', 'dd if=',
  '> /dev/', 'chmod 777',
  'DROP TABLE', 'DROP DATABASE',
];

export function isCommandSafeToAutoExecute(command: string): boolean {
  const trimmed = command.trim();
  // Block dangerous commands
  if (DANGEROUS_PATTERNS.some(p => trimmed.includes(p))) return false;
  // Check if command starts with a safe prefix
  return SAFE_COMMAND_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}

// Tools that always auto-execute (no shell risk)
// save_memory is always auto-executed — it writes to in-memory store (no shell, no disk risk)
const AUTO_EXECUTE_TOOL_NAMES = new Set(['read_file', 'list_directory', 'search_files', 'save_memory']);
// Tools that auto-execute with content (write operations)
const AUTO_WRITE_TOOL_NAMES = new Set(['write_to_file']);

// ─── Parsing helpers ─────────────────────────────────────────────────────────

export type AssistantToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export function parseRunTerminalCommand(argsJson: string): { command: string; is_background?: boolean } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.command !== 'string' || !a.command.trim()) return null;
    return {
      command: a.command.trim(),
      is_background: typeof a.is_background === 'boolean' ? a.is_background : undefined,
    };
  } catch {
    return null;
  }
}

export function parseWriteToFile(argsJson: string): { path: string; content: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.path !== 'string' || typeof a.content !== 'string') return null;
    return { path: a.path.trim(), content: a.content };
  } catch {
    return null;
  }
}

export function parseReadFile(argsJson: string): { path: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.path !== 'string') return null;
    return { path: a.path.trim() };
  } catch {
    return null;
  }
}

export function parseListDir(argsJson: string): { path: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    return { path: typeof a.path === 'string' ? a.path.trim() : '.' };
  } catch {
    return null;
  }
}

export function parseSaveMemory(argsJson: string): { title: string; content: string; category: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.title !== 'string' || typeof a.content !== 'string') return null;
    return {
      title: a.title.trim().slice(0, 80),
      content: a.content.trim(),
      category: typeof a.category === 'string' ? a.category : 'context',
    };
  } catch {
    return null;
  }
}

export function parseSearchFiles(argsJson: string): { pattern: string; path?: string } | null {
  try {
    const a = JSON.parse(argsJson || '{}') as Record<string, unknown>;
    if (typeof a.pattern !== 'string') return null;
    return {
      pattern: a.pattern,
      path: typeof a.path === 'string' ? a.path.trim() : undefined,
    };
  } catch {
    return null;
  }
}

/** Build tool result messages for the model from resolved invocations. */
export function formatToolResultForModel(t: ToolInvocation): string {
  if (t.status === 'rejected') {
    return t.errorMessage || 'User declined to run this command.';
  }
  // Generic completed result
  const parts: string[] = [];
  if (t.stdout?.trim()) parts.push(`stdout:\n${t.stdout.trim()}`);
  if (t.stderr?.trim()) parts.push(`stderr:\n${t.stderr.trim()}`);
  if (t.errorMessage) parts.push(`error: ${t.errorMessage}`);
  if (typeof t.exitCode === 'number') parts.push(`exit_code: ${t.exitCode}`);
  return parts.length > 0 ? parts.join('\n\n') : 'Done (no output).';
}

/**
 * Describe what a tool invocation is doing — used for progress display.
 */
export function describeToolAction(t: ToolInvocation): string {
  const { name, argsJson, command } = t;
  switch (name) {
    case 'run_terminal_cmd': {
      const cmd = command || parseRunTerminalCommand(argsJson)?.command || '';
      const short = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
      return `Running \`${short}\``;
    }
    case 'write_to_file': {
      const parsed = parseWriteToFile(argsJson);
      return parsed ? `Writing \`${parsed.path}\`` : 'Writing file';
    }
    case 'read_file': {
      const parsed = parseReadFile(argsJson);
      return parsed ? `Reading \`${parsed.path}\`` : 'Reading file';
    }
    case 'list_directory': {
      const parsed = parseListDir(argsJson);
      return parsed ? `Listing \`${parsed.path}\`` : 'Listing directory';
    }
    case 'search_files': {
      const parsed = parseSearchFiles(argsJson);
      return parsed ? `Searching for \`${parsed.pattern}\`` : 'Searching files';
    }
    case 'save_memory': {
      const parsed = parseSaveMemory(argsJson);
      return parsed ? `Saving memory: ${parsed.title}` : 'Saving to memory';
    }
    default:
      return `Running ${name}`;
  }
}

// Known tool names for text-format parsing
const KNOWN_TOOL_NAMES = [
  'run_terminal_cmd',
  'write_to_file',
  'read_file',
  'list_directory',
  'search_files',
  'save_memory',
];

/**
 * Fallback parser for models that output tool calls as TEXT instead of
 * structured API tool_calls. Handles the format:
 *
 *   (used tools)
 *   [tool_calls]
 *   run_terminal_cmd({"command": "npm run dev", "is_background": true})
 *
 * Returns null if the text doesn't contain the [tool_calls] marker.
 * Returns { toolCalls, cleanText } where cleanText has the marker stripped.
 */
export function parseTextToolCalls(text: string): {
  toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>;
  cleanText: string;
} | null {
  if (!text.includes('[tool_calls]')) return null;

  const toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = [];

  // Split on the marker; everything before is the prose content
  const markerIdx = text.indexOf('[tool_calls]');
  const afterMarker = text.slice(markerIdx + '[tool_calls]'.length).trim();
  const cleanText = text.slice(0, markerIdx).replace(/\(used tools\)\s*$/, '').trim();

  // Each line after the marker may be a tool call: name({...}) or name({...})
  // We handle multi-line JSON by collecting balanced braces.
  const lines = afterMarker.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    // Check if this line starts with a known tool name
    const match = line.match(/^(\w+)\s*\(/);
    if (!match || !KNOWN_TOOL_NAMES.includes(match[1])) { i++; continue; }

    const name = match[1];
    // Collect characters until we close the outermost paren + JSON object
    let raw = line;
    let depth = 0;
    let started = false;
    let jsonStart = -1;
    let jsonEnd = -1;
    for (let c = 0; c < raw.length; c++) {
      if (raw[c] === '{') { if (!started) { started = true; jsonStart = c; } depth++; }
      if (raw[c] === '}') { depth--; if (depth === 0 && started) { jsonEnd = c; break; } }
    }
    // If JSON isn't closed on this line, pull in subsequent lines
    while (jsonEnd === -1 && i + 1 < lines.length) {
      i++;
      raw += '\n' + lines[i];
      for (let c = jsonStart; c < raw.length; c++) {
        if (raw[c] === '{') depth++;
        if (raw[c] === '}') { depth--; if (depth === 0) { jsonEnd = c; break; } }
      }
    }

    const argsJson = jsonStart !== -1 && jsonEnd !== -1
      ? raw.slice(jsonStart, jsonEnd + 1)
      : '{}';

    toolCalls.push({
      id: crypto.randomUUID(),
      function: { name, arguments: argsJson },
    });
    i++;
  }

  if (toolCalls.length === 0) return null;
  return { toolCalls, cleanText };
}

/**
 * Turn streamed tool_calls into UI/model state.
 * When autoExecute is true, safe commands and read-only tools are auto-executed.
 */
export function invocationsFromToolCalls(
  toolCalls: AssistantToolCall[],
  shellAvailable: boolean,
  autoExecute = false,
): { invocations: ToolInvocation[]; needsUserApproval: boolean } {
  const invocations: ToolInvocation[] = [];
  let needsUserApproval = false;

  for (const tc of toolCalls) {
    const name = tc.function.name;

    // ── run_terminal_cmd ──
    if (name === 'run_terminal_cmd') {
      const parsed = parseRunTerminalCommand(tc.function.arguments);
      if (!shellAvailable) {
        invocations.push({
          id: tc.id, name, argsJson: tc.function.arguments,
          command: parsed?.command,
          status: 'completed',
          stderr: 'Shell execution requires the Code Scout desktop app with a project folder open.',
          exitCode: 127,
        });
        continue;
      }
      if (!parsed) {
        invocations.push({
          id: tc.id, name, argsJson: tc.function.arguments,
          status: 'completed',
          stderr: 'Invalid JSON arguments for run_terminal_cmd (missing command string).',
          exitCode: 1,
        });
        continue;
      }
      const canAuto = autoExecute && isCommandSafeToAutoExecute(parsed.command);
      // Force auto execution — never ask the user
      invocations.push({
        id: tc.id, name, argsJson: tc.function.arguments,
        command: parsed.command,
        status: 'auto_queued',
      });
      continue;
    }

    // ── read-only tools (always auto-execute) ──
    if (AUTO_EXECUTE_TOOL_NAMES.has(name)) {
      invocations.push({
        id: tc.id, name, argsJson: tc.function.arguments,
        status: 'auto_queued',
      });
      continue;
    }

    // ── write_to_file ──
    if (AUTO_WRITE_TOOL_NAMES.has(name)) {
      invocations.push({
        id: tc.id, name, argsJson: tc.function.arguments,
        status: 'auto_queued',
      });
      continue;
    }

    // ── unsupported tool ──
    invocations.push({
      id: tc.id, name, argsJson: tc.function.arguments,
      status: 'completed',
      stdout: `Tool "${name}" is not supported. Available: run_terminal_cmd, write_to_file, read_file, list_directory, search_files.`,
      exitCode: 0,
    });
  }

  return { invocations, needsUserApproval: false };
}
