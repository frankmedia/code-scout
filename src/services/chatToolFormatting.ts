/**
 * chatToolFormatting — result formatting and action description for chat/agent tools.
 *
 * Extracted from chatTools.ts so formatters and display helpers live in a focused
 * module separate from tool schemas and parsers.
 * chatTools.ts re-exports everything from here for backward compat.
 */

import type { ToolInvocation } from '@/store/workbenchStore';
import {
  parseRunTerminalCommand,
  parseWriteToFile,
  parseReadFile,
  parseListDir,
  parseSearchFiles,
  parseSaveMemory,
  parseWebSearch,
  parseFetchUrl,
  parseBrowseWeb,
  parseLookupPackage,
  parseReplaceInFile,
} from './chatToolParsers';

/** Build tool result messages for the model from resolved invocations. */
export function formatToolResultForModel(t: ToolInvocation): string {
  if (t.status === 'rejected') {
    return t.errorMessage || 'User declined to run this command.';
  }
  const parts: string[] = [];
  if (t.stdout?.trim()) parts.push(`stdout:\n${t.stdout.trim()}`);
  if (t.stderr?.trim()) parts.push(`stderr:\n${t.stderr.trim()}`);
  if (t.errorMessage) parts.push(`error: ${t.errorMessage}`);
  if (typeof t.exitCode === 'number') parts.push(`exit_code: ${t.exitCode}`);
  return parts.length > 0 ? parts.join('\n\n') : 'Done (no output).';
}

/** Describe what a tool invocation is doing — used for progress display. */
export function describeToolAction(t: ToolInvocation): string {
  const { name, argsJson, command } = t;
  switch (name) {
    case 'run_terminal_cmd': {
      const cmd = command || parseRunTerminalCommand(argsJson)?.command || '';
      const short = cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
      return `Running \`${short}\``;
    }
    case 'web_search': {
      const parsed = parseWebSearch(argsJson);
      const q = parsed?.query ?? '';
      const short = q.length > 50 ? q.slice(0, 47) + '...' : q;
      return short ? `Web search: ${short}` : 'Web search';
    }
    case 'fetch_url': {
      const parsed = parseFetchUrl(argsJson);
      const u = parsed?.url ?? '';
      const short = u.length > 55 ? u.slice(0, 52) + '...' : u;
      return short ? `Fetch ${short}` : 'Fetch URL';
    }
    case 'browse_web': {
      const parsed = parseBrowseWeb(argsJson);
      const u = parsed?.url ?? '';
      const short = u.length > 48 ? u.slice(0, 45) + '...' : u;
      return short ? `Browse ${short}` : 'Browse web';
    }
    case 'lookup_package': {
      const parsed = parseLookupPackage(argsJson);
      return parsed ? `Lookup ${parsed.ecosystem}:${parsed.name}` : 'Package lookup';
    }
    case 'get_terminal_snapshot':
      return 'Read terminal output';
    case 'replace_in_file': {
      const parsed = parseReplaceInFile(argsJson);
      return parsed ? `Edit \`${parsed.path}\`` : 'Replace in file';
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
