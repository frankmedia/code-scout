/**
 * agentToolExecutor — single-tool execution and status helpers for the agent loop.
 *
 * Extracted from agentToolLoop.ts so the execution logic (one tool call → result)
 * is isolated from round orchestration.  This file handles shell, file, search,
 * and memory tools.  Tool schema definitions live in agentToolDefinitions.ts.
 *
 * agentToolLoop.ts re-exports everything from here for backward compat.
 */

import {
  DEFAULT_AGENT_MAX_FILE_READ_CHARS,
  DEFAULT_AGENT_BACKGROUND_SETTLE_MS,
  DEFAULT_AGENT_WARN_WRITE_FILE_CHARS,
  DEFAULT_AGENT_MAX_WRITE_FILE_CHARS,
} from '@/config/agentBehaviorDefaults';
import type { MemoryCategory } from '@/store/agentMemoryStore';
import { useAgentMemoryStore } from '@/store/agentMemoryStore';
import type { ToolInvocation, FileNode } from '@/store/workbenchStore';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { executeCommand, writeProjectFile, spawnCommand, isWindows, isTauri } from '@/lib/tauri';
import type { AssistantToolCall } from './chatTools';
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
  parseGetTerminalSnapshot,
  parseReplaceInFile,
} from './chatToolParsers';
import { resolveFilePath, isBackgroundCommand, suggestSimilarPaths } from './pathResolution';
import {
  runWebSearchForAgentTool,
  runFetchUrlForAgentTool,
  runBrowseWebForAgentTool,
} from './agentExecutorWebResearch';
import { lookupPackageMarkdown } from './agentRegistryLookup';
import { formatTerminalContextForAgent } from '@/utils/terminalContextForAgent';
import { appendShellCommandHints } from './agentExecutorUtils';
import { resolveProjectRoot } from './validationRunner';
import { setLastDevServerUrl } from '@/store/workbenchStoreTypes';

/** Minimal callback surface required by the executor — avoids circular import. */
export type ExecutorCallbacks = {
  onLog: (msg: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  onTerminal: (line: string) => void;
  /** Optional keepalive for the heartbeat — call periodically during long operations. */
  onStatus?: (status: string) => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function flattenFilePaths(nodes: FileNode[]): { path: string }[] {
  const out: { path: string }[] = [];
  for (const n of nodes) {
    if (n.type === 'file') out.push({ path: n.path });
    if (n.children) out.push(...flattenFilePaths(n.children));
  }
  return out;
}

function countNonOverlapping(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let i = 0;
  while (i <= haystack.length - needle.length) {
    const j = haystack.indexOf(needle, i);
    if (j === -1) break;
    count += 1;
    i = j + needle.length;
  }
  return count;
}

// ─── Shell file-write detection ───────────────────────────────────────────────

const SHELL_WRITE_PATTERNS = [
  /\bfs\.writeFileSync\b/i,
  /\bfs\.writeFile\b/i,
  /\bwriteFileSync\b/,
  /\bwriteFile\b.*\bfs\b/,
  /\becho\b.+>\s*\S/,
  /\bcat\b.+>\s*\S/,
  /\bprintf\b.+>\s*\S/,
  /\btee\b\s+\S/,
  /\bsed\b\s+-i/,
  /\bnode\b.*-e\b.*write/i,
  /\bnode\b\s+-\s*<</,
  /\bpython\b.*open\(.*['"]\bw\b/i,
  /\bperl\b\s+-[pi]/,
];

export function isShellFileWrite(cmd: string): boolean {
  return SHELL_WRITE_PATTERNS.some(re => re.test(cmd));
}

// ─── Status description (activity log + inline progress) ─────────────────────
/** Longer clips so the activity log shows full search queries, URLs, and commands. */
function clipStatus(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export function statusForToolCall(tc: AssistantToolCall): string {
  const { name, arguments: argsJson } = tc.function;
  switch (name) {
    case 'run_terminal_cmd': {
      const p = parseRunTerminalCommand(argsJson);
      const cmd = p?.command?.trim() ?? '';
      return `$ ${clipStatus(cmd, 220)}`;
    }
    case 'write_to_file': {
      const p = parseWriteToFile(argsJson);
      const path = p?.path ?? 'file';
      return `Writing ${clipStatus(path, 180)}`;
    }
    case 'read_file': {
      const p = parseReadFile(argsJson);
      return p ? `Reading ${clipStatus(p.path, 180)}` : 'Reading file';
    }
    case 'list_directory': {
      const p = parseListDir(argsJson);
      const dir = p?.path || '.';
      return `Listing ${clipStatus(dir, 120)}`;
    }
    case 'search_files': {
      const p = parseSearchFiles(argsJson);
      const pat = p?.pattern ?? '';
      const short = clipStatus(pat, 160);
      return short ? `Search in files: "${short}"` : 'Search in files';
    }
    case 'save_memory': {
      const p = parseSaveMemory(argsJson);
      return p ? `Save memory: ${clipStatus(p.title, 120)}` : 'Save memory';
    }
    case 'web_search': {
      const p = parseWebSearch(argsJson);
      const q = p?.query ?? '';
      const short = clipStatus(q, 320);
      return short ? `Web search: ${short}` : 'Web search';
    }
    case 'fetch_url': {
      const p = parseFetchUrl(argsJson);
      const u = p?.url ?? '';
      const short = clipStatus(u, 280);
      return short ? `Fetch URL: ${short}` : 'Fetch URL';
    }
    case 'browse_web': {
      const p = parseBrowseWeb(argsJson);
      const u = p?.url ?? '';
      const short = clipStatus(u, 260);
      return short ? `Browse page: ${short}` : 'Browse page';
    }
    case 'lookup_package': {
      const p = parseLookupPackage(argsJson);
      return p ? `Package lookup: ${p.ecosystem}:${p.name}` : 'Package lookup';
    }
    case 'get_terminal_snapshot':
      return 'Read terminal output';
    case 'replace_in_file': {
      const p = parseReplaceInFile(argsJson);
      const path = p?.path ?? 'file';
      return `Edit in file: ${clipStatus(path, 180)}`;
    }
    case 'delegate_to_coder': {
      let instr = '';
      try {
        instr = (JSON.parse(argsJson || '{}') as { instruction?: string }).instruction ?? '';
      } catch { /* ignore */ }
      const short = clipStatus(instr, 240);
      return `Delegate to coder: ${short || '…'}`;
    }
    case 'reindex_project':
      return 'Re-indexing project…';
    case 'finish_task':
      return 'Wrapping up…';
    default:
      return name;
  }
}

// ─── Imperative tool execution ────────────────────────────────────────────────

/**
 * Execute one tool call and return a completed ToolInvocation.
 * Does NOT use React — safe to call from any async context.
 * When `withCoder` is true, shell commands that attempt to write files are
 * rejected — the model must use `delegate_to_coder` instead.
 */
export async function executeAgentToolCall(
  tc: AssistantToolCall,
  projectPath: string,
  callbacks: ExecutorCallbacks,
  withCoder = false,
  toolOpts: { maxFileReadChars?: number; backgroundSettleMs?: number } = {},
): Promise<ToolInvocation> {
  const state = useWorkbenchStore.getState();
  const { name, id, arguments: argsJson } = tc.function;
  const base = { id, name, argsJson };
  const maxFileReadChars = toolOpts.maxFileReadChars ?? DEFAULT_AGENT_MAX_FILE_READ_CHARS;
  const backgroundSettleMs = toolOpts.backgroundSettleMs ?? DEFAULT_AGENT_BACKGROUND_SETTLE_MS;
  /** Opened folder in Code Scout — all `writeProjectFile` paths are relative to this. */
  const workspaceRoot = projectPath;
  /** Where package.json / app root lives (may be a subfolder if user opened a parent directory). */
  const shellCwd = resolveProjectRoot(workspaceRoot, state.files);

  if (name === 'finish_task') {
    return { ...base, status: 'completed', stdout: '', exitCode: 0 };
  }

  // ── web_search ──────────────────────────────────────────────────────────────
  if (name === 'web_search') {
    const parsed = parseWebSearch(argsJson);
    if (!parsed) {
      return { ...base, status: 'failed', errorMessage: 'Invalid arguments for web_search (need query string).', exitCode: 1 };
    }
    const stdout = await runWebSearchForAgentTool(parsed.query, {
      onLog: (msg, type) => callbacks.onLog(msg, type ?? 'info'),
      onTerminal: callbacks.onTerminal,
    });
    return { ...base, status: 'completed', stdout, exitCode: 0 };
  }

  // ── fetch_url ───────────────────────────────────────────────────────────────
  if (name === 'fetch_url') {
    const parsed = parseFetchUrl(argsJson);
    if (!parsed) {
      return { ...base, status: 'failed', errorMessage: 'Invalid arguments for fetch_url (need url string).', exitCode: 1 };
    }
    const stdout = await runFetchUrlForAgentTool(parsed.url, {
      onLog: (msg, type) => callbacks.onLog(msg, type ?? 'info'),
      onTerminal: callbacks.onTerminal,
    });
    return { ...base, status: 'completed', stdout, exitCode: 0 };
  }

  // ── browse_web ──────────────────────────────────────────────────────────────
  if (name === 'browse_web') {
    const parsed = parseBrowseWeb(argsJson);
    if (!parsed) {
      return { ...base, status: 'failed', errorMessage: 'Invalid arguments for browse_web (need url).', exitCode: 1 };
    }
    if (!isTauri()) {
      const msg =
        'browse_web is only available in the Code Scout **desktop** app (Playwright via Tauri). ' +
        'This session is the web build: use **fetch_url** for static/HTML responses or **web_search** instead. Do not retry browse_web.';
      callbacks.onLog(msg, 'warning');
      callbacks.onTerminal(`! ${msg}`);
      return { ...base, status: 'failed', stderr: msg, errorMessage: msg, exitCode: 1 };
    }
    const stdout = await runBrowseWebForAgentTool(parsed.url, parsed.browse_actions, {
      onLog: (msg, type) => callbacks.onLog(msg, type ?? 'info'),
      onTerminal: callbacks.onTerminal,
    });
    return { ...base, status: 'completed', stdout, exitCode: 0 };
  }

  // ── lookup_package ───────────────────────────────────────────────────────────
  if (name === 'lookup_package') {
    const parsed = parseLookupPackage(argsJson);
    if (!parsed) {
      return { ...base, status: 'failed', errorMessage: 'Invalid lookup_package (need ecosystem + name).', exitCode: 1 };
    }
    callbacks.onTerminal(`[Registry] ${parsed.ecosystem} ${parsed.name}${parsed.version ? `@${parsed.version}` : ''}`);
    const stdout = await lookupPackageMarkdown(parsed.ecosystem, parsed.name, parsed.version);
    if (stdout.startsWith('Error:')) callbacks.onLog(stdout, 'warning');
    else callbacks.onLog(`Registry: ${parsed.ecosystem}/${parsed.name}`, 'success');
    return { ...base, status: 'completed', stdout, exitCode: 0 };
  }

  // ── get_terminal_snapshot ────────────────────────────────────────────────────
  if (name === 'get_terminal_snapshot') {
    const parsed =
      parseGetTerminalSnapshot(argsJson || '{}') ?? { scope: 'active' as const, max_chars: 8000 };
    const { scope, max_chars } = parsed;
    let text: string;
    if (scope === 'active') {
      const tab = state.terminalTabs.find(t => t.id === state.activeTerminalId);
      const lines = tab?.output ?? state.terminalOutput;
      text = formatTerminalContextForAgent(lines, max_chars) || '(no terminal output yet)';
    } else {
      const parts: string[] = [];
      for (const tab of state.terminalTabs) {
        const block = formatTerminalContextForAgent(tab.output, Math.min(max_chars, 6000));
        if (block.trim()) parts.push(`### ${tab.name}\n${block}`);
      }
      text = parts.length ? parts.join('\n\n') : '(no terminal output yet)';
      if (text.length > max_chars) {
        text = `…(truncated)\n${text.slice(text.length - max_chars)}`;
      }
    }
    callbacks.onTerminal('[Terminal snapshot]');
    return { ...base, status: 'completed', stdout: text, exitCode: 0 };
  }

  // ── run_terminal_cmd ──────────────────────────────────────────────────────
  if (name === 'run_terminal_cmd') {
    const parsed = parseRunTerminalCommand(argsJson);
    if (!parsed) return { ...base, status: 'failed', stderr: 'Invalid arguments for run_terminal_cmd.', exitCode: 1 };
    const rawCmd = parsed.command.replace(/\s*&\s*$/, '').trim();

    // ── Intercept web_search / fetch_url used as shell commands ─────────
    // Weak models sometimes run `web_search 'query'` or `web-search query`
    // as bash commands instead of calling the built-in web_search tool.
    const webSearchShellMatch = rawCmd.match(
      /^(?:web[-_]search|websearch)\s+['"]?(.+?)['"]?\s*$/i,
    );
    if (webSearchShellMatch) {
      const query = webSearchShellMatch[1];
      callbacks.onLog(`Intercepted shell web_search → redirecting to built-in web_search tool`, 'warning');
      callbacks.onTerminal(`! web_search is a built-in tool, not a shell command. Redirecting: "${query}"`);
      const stdout = await runWebSearchForAgentTool(query, {
        onLog: (msg, type) => callbacks.onLog(msg, type ?? 'info'),
        onTerminal: callbacks.onTerminal,
      });
      return { ...base, command: rawCmd, status: 'completed', stdout, exitCode: 0 };
    }

    // Also intercept `npm install -g web-search-cli` and similar futile installs
    const webSearchInstallMatch = /npm\s+install\s+(?:-g\s+)?(?:@codescout\/)?web[-_]?(?:search|tools|utils)/i.test(rawCmd);
    if (webSearchInstallMatch) {
      const msg = 'web_search is a built-in Code Scout tool — you do not need to install anything. ' +
        'Call the `web_search` tool directly with {"query": "your search terms"}.';
      callbacks.onLog(`Blocked unnecessary install: ${rawCmd.slice(0, 80)}`, 'warning');
      callbacks.onTerminal(`! ${msg}`);
      return { ...base, command: rawCmd, status: 'failed', stderr: msg, exitCode: 1 };
    }

    if (withCoder && isShellFileWrite(rawCmd)) {
      const msg = 'REJECTED: Do not use shell commands to write/edit files. Use `delegate_to_coder` with detailed instructions instead.';
      callbacks.onLog(`Blocked shell file write: ${rawCmd.slice(0, 80)}`, 'warning');
      callbacks.onTerminal(`! ${msg}`);
      return { ...base, command: rawCmd, status: 'failed', stderr: msg, exitCode: 1 };
    }
    const background = parsed.is_background === true || isBackgroundCommand(rawCmd);
    callbacks.onTerminal(`$ ${rawCmd}`);

    if (background) {
      let stdoutBuf = '';
      let serverUrl = '';
      const URL_REGEX = /https?:\/\/[^\s'">\])+,;]+/gi;
      // eslint-disable-next-line no-control-regex
      const ANSI = /\x1b\[[0-9;]*m/g;
      const detectUrl = (raw: string) => {
        const clean = raw.replace(ANSI, '');
        const m = clean.match(URL_REGEX);
        if (m && !serverUrl) {
          const preferred = m.find(u => /localhost|127\.0\.0\.1/i.test(u)) ?? m[0];
          const candidate = preferred.replace(/[/,;:]+$/, '');
          // Only treat as dev server if it's a local address — ignore external URLs
          // embedded in error messages (e.g. github.com links in rollup errors).
          if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(candidate)) {
            serverUrl = candidate;
            setLastDevServerUrl(serverUrl);
            callbacks.onLog(`Dev server detected: ${serverUrl}`, 'success');
          }
        }
      };
      await new Promise<void>((resolve) => {
        spawnCommand(
          rawCmd,
          shellCwd,
          (line) => {
            stdoutBuf += line + '\n';
            callbacks.onTerminal(line);
            detectUrl(line);
          },
          (line) => {
            callbacks.onTerminal(`! ${line}`);
            detectUrl(line);
          },
          () => {},
        ).catch((err) => {
          callbacks.onLog(
            `Background process failed: ${err instanceof Error ? err.message : err}`,
            'warning',
          );
        });
        setTimeout(resolve, backgroundSettleMs);
      });
      const stdout = serverUrl
        ? `Running at ${serverUrl}\n${stdoutBuf.slice(0, 1000)}`
        : stdoutBuf.slice(0, 1000) || '(background process started)';
      return { ...base, command: rawCmd, status: 'completed', stdout, exitCode: 0 };
    }

    try {
      // Keepalive: ping onStatus every 5s so the heartbeat knows we're running a command
      const keepalive = callbacks.onStatus
        ? setInterval(() => callbacks.onStatus!(`$ ${rawCmd.slice(0, 60)}…`), 5000)
        : null;
      if (shellCwd !== workspaceRoot) {
        callbacks.onTerminal(`# cwd: ${shellCwd}`);
      }
      const result = await executeCommand(rawCmd, shellCwd);
      if (keepalive) clearInterval(keepalive);
      result.stdout.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(l));
      result.stderr.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(`! ${l}`));
      const ok = result.code === 0 || result.code === null;
      if (!ok) callbacks.onLog(`Command exited ${result.code}: ${rawCmd.slice(0, 100)}`, 'warning');

      // Detect dev-server URLs in stdout/stderr (vite, next, etc.)
      const URL_FG = /https?:\/\/[^\s'">\])+,;]+/gi;
      // eslint-disable-next-line no-control-regex
      const allOutput = (result.stdout + '\n' + result.stderr).replace(/\x1b\[[0-9;]*m/g, '');
      const urlMatches = allOutput.match(URL_FG);
      if (urlMatches) {
        const preferred = urlMatches.find(u => /localhost|127\.0\.0\.1/i.test(u)) ?? urlMatches[0];
        const cleanUrl = preferred.replace(/[/,;:]+$/, '');
        if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(cleanUrl)) {
          setLastDevServerUrl(cleanUrl);
          callbacks.onLog(`Dev server detected: ${cleanUrl}`, 'success');
        }
      }

      const pn = state.projectName.trim();
      if (pn) {
        useAgentMemoryStore.getState().recordCommandOutcome(
          pn, rawCmd, result.code === 0, result.stderr.slice(-500) || undefined,
        );
      }
      const stderr = !ok ? appendShellCommandHints(result.stderr, rawCmd) : result.stderr;
      return {
        ...base, command: rawCmd,
        status: ok ? 'completed' : 'failed',
        stdout: result.stdout, stderr, exitCode: result.code,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ...base, command: rawCmd, status: 'failed', errorMessage: msg, exitCode: null };
    }
  }

  // ── replace_in_file ─────────────────────────────────────────────────────────
  if (name === 'replace_in_file') {
    const parsed = parseReplaceInFile(argsJson);
    if (!parsed) {
      return { ...base, status: 'failed', errorMessage: 'Invalid arguments for replace_in_file.', exitCode: 1 };
    }
    const { old_string, new_string, replace_all } = parsed;
    if (!old_string) {
      return { ...base, status: 'failed', errorMessage: 'old_string must be non-empty.', exitCode: 1 };
    }
    const allFlat = flattenFilePaths(state.files);
    const { resolved: targetPath } = resolveFilePath(parsed.path, (p) => state.getFileContent(p), allFlat);
    let content: string | undefined = state.getFileContent(targetPath);
    if (content === undefined) {
      try {
        const result = await executeCommand(`cat "${targetPath}"`, workspaceRoot);
        if (result.code === 0) content = result.stdout;
      } catch { /* use undefined */ }
    }
    if (content === undefined) {
      const suggestions = suggestSimilarPaths(targetPath, allFlat);
      const hint = suggestions.length
        ? `\nDid you mean: ${suggestions.join(', ')}?`
        : '';
      return { ...base, status: 'failed', stderr: `File not found: ${targetPath}${hint}`, exitCode: 1 };
    }
    const n = countNonOverlapping(content, old_string);
    if (n === 0) {
      return { ...base, status: 'failed', stderr: `old_string not found in ${targetPath}.`, exitCode: 1 };
    }
    if (n > 1 && !replace_all) {
      return {
        ...base,
        status: 'failed',
        stderr:
          `old_string appears ${n} times in ${targetPath}. Add more context so the match is unique, or set replace_all to true.`,
        exitCode: 1,
      };
    }
    const newContent = replace_all
      ? content.split(old_string).join(new_string)
      : (() => {
          const i = content.indexOf(old_string);
          return content.slice(0, i) + new_string + content.slice(i + old_string.length);
        })();
    if (newContent.length > DEFAULT_AGENT_MAX_WRITE_FILE_CHARS) {
      const msg = `Resulting file exceeds ${DEFAULT_AGENT_MAX_WRITE_FILE_CHARS} chars — use write_to_file with a split or smaller edit.`;
      callbacks.onLog(msg, 'warning');
      return { ...base, status: 'failed', errorMessage: msg, exitCode: 1 };
    }
    callbacks.onTerminal(`✎ replace → ${targetPath}`);
    state.pushSnapshot({ path: targetPath, content, action: 'edited' });
    try {
      await writeProjectFile(workspaceRoot, targetPath, newContent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      callbacks.onLog(`FS replace failed for ${targetPath}: ${msg}`, 'warning');
      return { ...base, status: 'failed', errorMessage: `Failed to write ${targetPath}: ${msg}`, exitCode: 1 };
    }
    state.updateFileContent(targetPath, newContent);
    callbacks.onTerminal(`✓ ${targetPath} updated`);
    callbacks.onLog(`Replaced in ${targetPath}`, 'success');
    const reps = replace_all ? n : 1;
    return {
      ...base,
      status: 'completed',
      stdout: `Updated ${targetPath} (${reps} replacement(s), ${content.length} → ${newContent.length} chars).`,
      exitCode: 0,
    };
  }

  // ── write_to_file ─────────────────────────────────────────────────────────
  if (name === 'write_to_file') {
    const parsed = parseWriteToFile(argsJson);
    if (!parsed) return { ...base, status: 'failed', errorMessage: 'Invalid arguments for write_to_file.', exitCode: 1 };

    // Small-LLM guardrail: warn or reject oversized writes
    const charLen = parsed.content.length;
    if (charLen > DEFAULT_AGENT_MAX_WRITE_FILE_CHARS) {
      const msg =
        `REJECTED: write_to_file content is ${charLen} characters — exceeds the ${DEFAULT_AGENT_MAX_WRITE_FILE_CHARS}-char hard limit. ` +
        `Split this file into two or more smaller modules and write each one separately.`;
      callbacks.onLog(`Blocked oversized write to ${parsed.path} (${charLen} chars)`, 'warning');
      callbacks.onTerminal(`! ${msg}`);
      return { ...base, status: 'failed', errorMessage: msg, exitCode: 1 };
    }
    if (charLen > DEFAULT_AGENT_WARN_WRITE_FILE_CHARS) {
      callbacks.onLog(
        `Large file write: ${parsed.path} is ${charLen} chars — consider splitting into smaller modules.`,
        'warning',
      );
    }

    const allFlat = flattenFilePaths(state.files);
    const { resolved: targetPath } = resolveFilePath(parsed.path, (p) => state.getFileContent(p), allFlat);
    callbacks.onTerminal(`✎ write → ${targetPath} (${charLen} chars)`);
    let fsWriteOk = true;
    try {
      await writeProjectFile(workspaceRoot, targetPath, parsed.content);
    } catch (e) {
      fsWriteOk = false;
      callbacks.onLog(`FS write failed for ${targetPath}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
    if (!fsWriteOk) {
      return { ...base, status: 'failed', errorMessage: `Failed to write ${targetPath} to disk.`, exitCode: 1 };
    }
    state.createFile(targetPath, parsed.content);
    state.pushSnapshot({ path: targetPath, content: null, action: 'created' });
    callbacks.onTerminal(`✓ ${targetPath} written`);
    callbacks.onLog(`Wrote ${targetPath}`, 'success');
    return { ...base, status: 'completed', stdout: `File written: ${targetPath} (${charLen} chars)`, exitCode: 0 };
  }

  // ── read_file ─────────────────────────────────────────────────────────────
  if (name === 'read_file') {
    const parsed = parseReadFile(argsJson);
    if (!parsed) return { ...base, status: 'failed', errorMessage: 'Invalid path for read_file.', exitCode: 1 };
    const allFlatRf = flattenFilePaths(state.files);
    const { resolved: readPath } = resolveFilePath(parsed.path, (p) => state.getFileContent(p), allFlatRf);
    callbacks.onTerminal(`⤓ read → ${readPath}`);
    let content: string | undefined;
    try {
      let result = await executeCommand(`cat "${readPath}"`, workspaceRoot);
      if (result.code !== 0 && shellCwd !== workspaceRoot) {
        const again = await executeCommand(`cat "${readPath}"`, shellCwd);
        if (again.code === 0) result = again;
      }
      if (result.code === 0) content = result.stdout;
    } catch { /* fall through to in-memory */ }
    if (content === undefined) content = state.getFileContent(readPath) ?? state.getFileContent(parsed.path);
    if (content !== undefined) {
      const truncated =
        content.length > maxFileReadChars
          ? content.slice(0, maxFileReadChars) + '\n...(truncated)'
          : content;
      return { ...base, status: 'completed', stdout: truncated, exitCode: 0 };
    }
    const suggestions = suggestSimilarPaths(parsed.path, allFlatRf);
    const hint = suggestions.length
      ? `\nDid you mean: ${suggestions.join(', ')}?`
      : '';
    const ctx =
      shellCwd !== workspaceRoot
        ? `\n(Opened folder: ${workspaceRoot}; npm/app root for shells: ${shellCwd})`
        : `\n(Workspace: ${workspaceRoot})`;
    return {
      ...base,
      status: 'failed',
      stderr: `File not found: ${readPath}${hint}${ctx}`,
      exitCode: 1,
    };
  }

  // ── list_directory ────────────────────────────────────────────────────────
  if (name === 'list_directory') {
    const parsed = parseListDir(argsJson);
    const dir = parsed?.path || '.';
    const listDot = !dir || dir === '.' || dir === './';
    const lsCwd = listDot ? shellCwd : workspaceRoot;
    const lsTarget = listDot ? '.' : dir;
    callbacks.onTerminal(`$ ls -la "${lsTarget}"`);
    try {
      const result = await executeCommand(`ls -la "${lsTarget}"`, lsCwd);
      result.stdout.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(l));
      return {
        ...base,
        status: result.code === 0 ? 'completed' : 'failed',
        stdout: result.stdout, stderr: result.stderr, exitCode: result.code,
      };
    } catch (e) {
      return { ...base, status: 'failed', errorMessage: String(e), exitCode: null };
    }
  }

  // ── search_files ──────────────────────────────────────────────────────────
  if (name === 'search_files') {
    const parsed = parseSearchFiles(argsJson);
    if (!parsed) return { ...base, status: 'failed', errorMessage: 'Invalid pattern for search_files.', exitCode: 1 };
    const searchPath = parsed.path || '.';
    const esc = parsed.pattern.replace(/"/g, '\\"');
    const searchCmd = isWindows()
      ? `rg --no-heading -n "${esc}" "${searchPath}" 2>NUL || findstr /s /n /c:"${esc}" "${searchPath}\\*.*"`
      : `rg --no-heading -n "${esc}" "${searchPath}" 2>/dev/null || grep -rn "${esc}" "${searchPath}" 2>/dev/null | head -50`;
    callbacks.onTerminal(`$ rg "${esc}" ${searchPath}`);
    try {
      const result = await executeCommand(searchCmd, workspaceRoot);
      const output = result.stdout || '(no matches found)';
      output.split('\n').slice(0, 8).filter(Boolean).forEach(l => callbacks.onTerminal(l));
      return { ...base, status: 'completed', stdout: output, exitCode: 0 };
    } catch (e) {
      return { ...base, status: 'failed', errorMessage: String(e), exitCode: null };
    }
  }

  // ── save_memory ───────────────────────────────────────────────────────────
  if (name === 'save_memory') {
    const parsed = parseSaveMemory(argsJson);
    if (!parsed) return { ...base, status: 'failed', errorMessage: 'Invalid arguments for save_memory.', exitCode: 1 };
    const validCats = new Set<string>([
      'decision', 'preference', 'work', 'error', 'context',
      'install', 'build_outcome', 'fix', 'error_fix',
    ]);
    const cat = validCats.has(parsed.category) ? (parsed.category as MemoryCategory) : 'context';
    useAgentMemoryStore.getState().addMemory({
      projectName: state.projectName,
      category: cat,
      title: parsed.title,
      content: parsed.content,
      tags: ['agent_loop', cat],
    });
    return { ...base, status: 'completed', stdout: `Memory saved: "${parsed.title}"`, exitCode: 0 };
  }

  // ── reindex_project ───────────────────────────────────────────────────────
  if (name === 'reindex_project') {
    callbacks.onTerminal('⟳ reindex_project — rebuilding .codescout context…');
    const { files, projectName, projectPath } = state;
    if (!files.length || !projectName) {
      return { ...base, status: 'failed', errorMessage: 'No project loaded — cannot reindex.', exitCode: 1 };
    }
    try {
      const { indexProject } = await import('./memoryManager');
      const { useProjectMemoryStore } = await import('@/store/projectMemoryStore');
      useProjectMemoryStore.getState().markStale(projectName);
      useProjectMemoryStore.getState().setIndexing(true);
      try {
        indexProject(files, projectName, projectPath || undefined);
      } finally {
        useProjectMemoryStore.getState().setIndexing(false);
      }
      const msg = `Project "${projectName}" re-indexed — .codescout context is now up to date.`;
      callbacks.onTerminal(`✓ ${msg}`);
      callbacks.onLog(msg, 'success');
      return { ...base, status: 'completed', stdout: msg, exitCode: 0 };
    } catch (e) {
      const msg = `Reindex failed: ${e instanceof Error ? e.message : String(e)}`;
      callbacks.onLog(msg, 'error');
      return { ...base, status: 'failed', errorMessage: msg, exitCode: 1 };
    }
  }

  return { ...base, status: 'completed', stdout: `Unknown tool "${name}" — skipped.`, exitCode: 0 };
}
