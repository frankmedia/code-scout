import { useCallback, useEffect } from 'react';
import { Loader2, Play, XCircle, FileText, FolderOpen, Search, Terminal, FilePlus } from 'lucide-react';
import type { ToolInvocation } from '@/store/workbenchStore';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { executeCommand, spawnCommand, isWindows } from '@/lib/tauri';
import {
  parseRunTerminalCommand,
  parseWriteToFile,
  parseReadFile,
  parseListDir,
  parseSearchFiles,
  parseSaveMemory,
  describeToolAction,
} from '@/services/chatTools';
import { useAgentMemoryStore } from '@/store/agentMemoryStore';
import type { MemoryCategory } from '@/store/agentMemoryStore';
import {
  resolveFilePath,
  isBackgroundCommand,
  detectDevServerPort,
  freePortIfOccupied,
  BACKGROUND_SETTLE_MS_EXPORT,
} from '@/services/agentExecutor';
import { getForegroundCommandTimeoutMs } from '@/services/agentCommandTimeouts';
import type { FileNode } from '@/store/workbenchStore';

function flattenFilePaths(nodes: FileNode[]): { path: string }[] {
  const out: { path: string }[] = [];
  for (const n of nodes) {
    if (n.type === 'file') out.push({ path: n.path });
    if (n.children) out.push(...flattenFilePaths(n.children));
  }
  return out;
}

/** Project root markers — if projectPath doesn't contain one, look one level deeper. */
const PROJECT_MARKERS = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'setup.py', 'Makefile', 'pom.xml', 'build.gradle'];

function resolveEffectiveProjectRoot(projectPath: string, files: FileNode[]): string {
  const topFiles = files.filter(f => f.type === 'file').map(f => f.name);
  if (PROJECT_MARKERS.some(m => topFiles.includes(m))) return projectPath;
  const sep = projectPath.includes('\\') ? '\\' : '/';
  const subdirs = files.filter(f => f.type === 'folder' && f.children);
  for (const dir of subdirs) {
    const childFiles = (dir.children ?? []).filter(f => f.type === 'file').map(f => f.name);
    if (PROJECT_MARKERS.some(m => childFiles.includes(m))) return `${projectPath}${sep}${dir.name}`;
  }
  if (subdirs.length === 1) return `${projectPath}${sep}${subdirs[0].name}`;
  return projectPath;
}

type Props = {
  messageId: string;
  invocations: ToolInvocation[];
  onChainMaybeContinue: (messageId: string) => void;
};

const TOOL_ICONS: Record<string, React.ReactNode> = {
  run_terminal_cmd: <Terminal className="h-3 w-3" />,
  write_to_file: <FilePlus className="h-3 w-3" />,
  read_file: <FileText className="h-3 w-3" />,
  list_directory: <FolderOpen className="h-3 w-3" />,
  search_files: <Search className="h-3 w-3" />,
};

export function ChatToolInvocations({ messageId, invocations, onChainMaybeContinue }: Props) {
  const updateMessage = useWorkbenchStore(s => s.updateMessage);
  const addTerminalOutput = useWorkbenchStore(s => s.addTerminalOutput);
  const addLog = useWorkbenchStore(s => s.addLog);

  const patchInvocation = useCallback(
    (invId: string, patch: Partial<ToolInvocation>) => {
      updateMessage(messageId, m => {
        if (!m.toolInvocations) return m;
        return {
          ...m,
          toolInvocations: m.toolInvocations.map(t => (t.id === invId ? { ...t, ...patch } : t)),
        };
      });
    },
    [messageId, updateMessage],
  );

  const executeToolInvocation = useCallback(
    async (t: ToolInvocation) => {
      const state = useWorkbenchStore.getState();
      const rawPath = state.projectPath;

      // Resolve actual project root (handles case where user opened a parent dir)
      const projectPath = rawPath ? resolveEffectiveProjectRoot(rawPath, state.files) : null;

      if (!projectPath) {
        console.warn('[shell] projectPath is null — commands will run without cwd. Re-open project via Open Folder.');
        addTerminalOutput('⚠ No project path set — use "Open Folder" to set the working directory');
      }

      patchInvocation(t.id, { status: 'running' });

      try {
        switch (t.name) {
          // ── run_terminal_cmd ──
          case 'run_terminal_cmd': {
            const parsed = parseRunTerminalCommand(t.argsJson) || (t.command ? { command: t.command } : null);
            if (!parsed?.command) {
              patchInvocation(t.id, { status: 'failed', stderr: 'Could not parse command.', exitCode: 1 });
              break;
            }

            // Strip trailing shell `&` — spawnCommand manages its own process lifetime.
            // The model sometimes appends `&` on background commands, which forks the
            // process immediately and returns exit 0 before any output is captured.
            const rawCmd = parsed.command.replace(/\s*&\s*$/, '').trim();
            const background = parsed.is_background === true || isBackgroundCommand(rawCmd);

            addTerminalOutput(`$ ${rawCmd.split('\n').join('\n$ ')}`);

            // For background dev-server commands: free any occupied port first,
            // then settle for a few seconds to capture the startup URL.
            if (background) {
              const wbState = useWorkbenchStore.getState();
              const viteConfig = wbState.getFileContent('vite.config.ts')
                ?? wbState.getFileContent('vite.config.js')
                ?? wbState.getFileContent('vite.config.mjs');
              const devPort = detectDevServerPort(rawCmd, viteConfig);
              // Extract project hint for Electron cleanup:
              // 1. Try "cd DIRNAME &&" in the command itself
              // 2. Fall back to the last segment of the open project path
              const cdMatch = rawCmd.match(/\bcd\s+([\w.-]+)/);
              const projectHint = cdMatch?.[1]
                ?? (projectPath ? projectPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() : undefined);
              if (devPort) {
                await freePortIfOccupied(devPort, projectPath || undefined, { onLog: addLog, onTerminal: addTerminalOutput }, projectHint);
              }

              addTerminalOutput(`(background) ${rawCmd}`);
              addLog(`Starting background process: ${rawCmd}`, 'info');

              const URL_REGEX = /https?:\/\/[^\s'">\])+,;]+/gi;
              let stdoutBuf = '';
              let serverUrl = '';

              await new Promise<void>((resolve) => {
                spawnCommand(
                  rawCmd,
                  projectPath || undefined,
                  (line) => {
                    stdoutBuf += line + '\n';
                    addTerminalOutput(line);
                    const matches = line.match(URL_REGEX);
                    if (matches && !serverUrl) {
                      const preferred = matches.find(u => /localhost|127\.0\.0\.1/i.test(u)) ?? matches[0];
                      serverUrl = preferred.replace(/[/,;:]+$/, '');
                    }
                  },
                  (line) => { addTerminalOutput(`! ${line}`); },
                  (_code) => { /* keep running */ },
                ).catch((err) => {
                  const msg = err instanceof Error ? err.message : String(err);
                  patchInvocation(t.id, { status: 'failed', errorMessage: msg, exitCode: null });
                  addTerminalOutput(`! ${msg}`);
                  resolve();
                });

                // Settle: wait for server to emit its startup URL, then continue
                setTimeout(() => resolve(), BACKGROUND_SETTLE_MS_EXPORT);
              });

              patchInvocation(t.id, {
                status: 'completed',
                stdout: serverUrl
                  ? `Running at ${serverUrl}\n${stdoutBuf.slice(0, 1000)}`
                  : stdoutBuf.slice(0, 1000) || '(background process started)',
                exitCode: 0,
              });
              if (serverUrl) addLog(`Server running at ${serverUrl}`, 'success');
              else addLog(`Background process started: ${rawCmd}`, 'success');
              break;
            }

            // Normal foreground command
            const cmdTimeoutMs = getForegroundCommandTimeoutMs(rawCmd);
            let stdoutBuf = '';
            let stderrBuf = '';
            let killFn: (() => void) | null = null;
            let settled = false;

            await new Promise<void>((resolve) => {
              const settle = () => { if (!settled) { settled = true; resolve(); } };

              const timer = setTimeout(() => {
                if (!settled) {
                  killFn?.();
                  patchInvocation(t.id, {
                    status: 'completed',
                    stdout: stdoutBuf,
                    stderr: stderrBuf + `\n(timed out after ${Math.round(cmdTimeoutMs / 1000)}s)`,
                    exitCode: null,
                  });
                  addTerminalOutput(`! Command timed out after ${Math.round(cmdTimeoutMs / 1000)}s`);
                  addLog('Command timed out', 'warning');
                  settle();
                }
              }, cmdTimeoutMs);

              spawnCommand(
                rawCmd,
                projectPath || undefined,
                (line) => { stdoutBuf += line + '\n'; addTerminalOutput(line); },
                (line) => { stderrBuf += line + '\n'; addTerminalOutput(`! ${line}`); },
                (code) => {
                  clearTimeout(timer);
                  const ok = code === 0 || code === null;
                  patchInvocation(t.id, {
                    status: ok ? 'completed' : 'failed',
                    stdout: stdoutBuf, stderr: stderrBuf, exitCode: code,
                  });
                  if (!ok) addLog(`Command exited ${code}`, 'warning');
                  else addLog('Command finished', 'success');
                  settle();
                },
              ).then((kill) => { killFn = kill; }).catch((err) => {
                clearTimeout(timer);
                const msg = err instanceof Error ? err.message
                  : typeof err === 'string' ? err
                  : JSON.stringify(err) || 'Unknown shell error';
                patchInvocation(t.id, { status: 'failed', errorMessage: msg, exitCode: null });
                addTerminalOutput(`! ${msg}`);
                settle();
              });
            });
            break;
          }

          // ── write_to_file ──
          case 'write_to_file': {
            const parsed = parseWriteToFile(t.argsJson);
            if (!parsed) {
              patchInvocation(t.id, { status: 'failed', errorMessage: 'Invalid arguments for write_to_file.', exitCode: 1 });
              break;
            }
            const allFlat = flattenFilePaths(state.files);
            const { resolved: targetPath, changed: pathFixed } = resolveFilePath(
              parsed.path,
              (p) => state.getFileContent(p),
              allFlat,
            );
            if (pathFixed) {
              addTerminalOutput(`Path fix: "${parsed.path}" → "${targetPath}"`);
              addLog(`Path fix for write: ${parsed.path} → ${targetPath}`, 'warning');
            }
            addTerminalOutput(`✎ write → ${targetPath} (${parsed.content.length} chars)`);
            if (projectPath) {
              const { writeProjectFile } = await import('@/lib/tauri');
              await writeProjectFile(projectPath, targetPath, parsed.content);
            }
            // Update in-memory file tree
            state.createFile(targetPath, parsed.content);
            state.pushSnapshot({ path: targetPath, content: null, action: 'created' });
            patchInvocation(t.id, {
              status: 'completed',
              stdout: `File written: ${targetPath} (${parsed.content.length} chars)`,
              exitCode: 0,
            });
            addTerminalOutput(`✓ ${targetPath} written`);
            addLog(`Wrote ${targetPath}`, 'success');
            break;
          }

          // ── read_file ──
          case 'read_file': {
            const parsed = parseReadFile(t.argsJson);
            if (!parsed) {
              patchInvocation(t.id, { status: 'failed', errorMessage: 'Invalid path.', exitCode: 1 });
              break;
            }
            addTerminalOutput(`⤓ read → ${parsed.path}`);
            // Try disk first (Tauri), then in-memory
            let content: string | undefined;
            if (projectPath) {
              try {
                const result = await executeCommand(`cat "${parsed.path}"`, projectPath);
                if (result.code === 0) content = result.stdout;
              } catch { /* fall through to in-memory */ }
            }
            if (content === undefined) {
              content = state.getFileContent(parsed.path);
            }
            if (content !== undefined) {
              const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n... (truncated)' : content;
              patchInvocation(t.id, { status: 'completed', stdout: truncated, exitCode: 0 });
              addTerminalOutput(`✓ ${parsed.path} (${content.length} chars)`);
            } else {
              patchInvocation(t.id, { status: 'failed', stderr: `File not found: ${parsed.path}`, exitCode: 1 });
              addTerminalOutput(`✗ ${parsed.path} not found`);
            }
            break;
          }

          // ── list_directory ──
          case 'list_directory': {
            const parsed = parseListDir(t.argsJson);
            const dir = parsed?.path || '.';
            addTerminalOutput(`$ ls -la "${dir}"`);
            if (projectPath) {
              const result = await executeCommand(`ls -la "${dir}"`, projectPath);
              if (result.stdout) result.stdout.split('\n').filter(Boolean).forEach(l => addTerminalOutput(l));
              patchInvocation(t.id, {
                status: result.code === 0 ? 'completed' : 'failed',
                stdout: result.stdout, stderr: result.stderr, exitCode: result.code,
              });
            } else {
              patchInvocation(t.id, { status: 'failed', errorMessage: 'No project path.', exitCode: 1 });
            }
            break;
          }

          // ── search_files ──
          case 'search_files': {
            const parsed = parseSearchFiles(t.argsJson);
            if (!parsed) {
              patchInvocation(t.id, { status: 'failed', errorMessage: 'Invalid search pattern.', exitCode: 1 });
              break;
            }
            if (projectPath) {
              const searchPath = parsed.path || '.';
              const escapedPattern = parsed.pattern.replace(/"/g, '\\"');
              const searchCmd = `rg --no-heading -n "${escapedPattern}" "${searchPath}"`;
              addTerminalOutput(`$ ${searchCmd}`);
              // Try ripgrep first, fall back to grep (or findstr on Windows)
              const fallback = isWindows()
                ? `${searchCmd} 2>NUL || findstr /s /n "${escapedPattern}" "${searchPath}\\*"`
                : `${searchCmd} 2>/dev/null || grep -rn "${escapedPattern}" "${searchPath}" 2>/dev/null | head -50`;
              const result = await executeCommand(fallback, projectPath);
              const output = result.stdout || '(no matches found)';
              // Show first few results in terminal
              output.split('\n').slice(0, 10).filter(Boolean).forEach(l => addTerminalOutput(l));
              const totalLines = output.split('\n').filter(Boolean).length;
              if (totalLines > 10) addTerminalOutput(`... (${totalLines - 10} more matches)`);
              patchInvocation(t.id, { status: 'completed', stdout: output, exitCode: 0 });
            } else {
              patchInvocation(t.id, { status: 'failed', errorMessage: 'No project path.', exitCode: 1 });
            }
            break;
          }

          // ── save_memory ──
          case 'save_memory': {
            const parsed = parseSaveMemory(t.argsJson);
            if (!parsed) {
              patchInvocation(t.id, { status: 'failed', errorMessage: 'Invalid save_memory arguments.', exitCode: 1 });
              break;
            }
            const validCategories: MemoryCategory[] = ['decision', 'preference', 'work', 'error', 'context', 'install', 'build_outcome', 'fix', 'error_fix'];
            const cat = validCategories.includes(parsed.category as MemoryCategory)
              ? (parsed.category as MemoryCategory)
              : 'context';
            useAgentMemoryStore.getState().addMemory({
              projectName: state.projectName,
              category: cat,
              title: parsed.title,
              content: parsed.content,
              tags: ['chat_agent', cat],
            });
            patchInvocation(t.id, {
              status: 'completed',
              stdout: `Memory saved: "${parsed.title}"`,
              exitCode: 0,
            });
            addLog(`Memory saved: ${parsed.title}`, 'success');
            break;
          }

          default:
            patchInvocation(t.id, { status: 'completed', stdout: `Unknown tool: ${t.name}`, exitCode: 0 });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        patchInvocation(t.id, { status: 'failed', errorMessage: msg, exitCode: null });
        addTerminalOutput(`! ${msg}`);
        addLog(`Tool failed: ${msg}`, 'error');
      }

      onChainMaybeContinue(messageId);
    },
    [addLog, addTerminalOutput, messageId, onChainMaybeContinue, patchInvocation],
  );

  // Auto-execute queued invocations
  useEffect(() => {
    const autoQueued = invocations.filter(t => t.status === 'auto_queued');
    for (const t of autoQueued) {
      void executeToolInvocation(t);
    }
    // Only trigger on status changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invocations.map(t => `${t.id}:${t.status}`).join(',')]);

  const rejectOne = useCallback(
    (t: ToolInvocation) => {
      patchInvocation(t.id, { status: 'rejected', errorMessage: 'User skipped this command.' });
      addLog('Command skipped', 'warning');
      onChainMaybeContinue(messageId);
    },
    [addLog, messageId, onChainMaybeContinue, patchInvocation],
  );

  if (!invocations.length) return null;

  return (
    <div className="mt-2 space-y-2 not-prose">
      {invocations.map(t => {
        const icon = TOOL_ICONS[t.name] || <Terminal className="h-3 w-3" />;
        const actionDesc = describeToolAction(t);
        const displayCmd = t.command || (() => {
          if (t.name === 'write_to_file') {
            const p = parseWriteToFile(t.argsJson);
            return p ? `write → ${p.path}` : t.argsJson;
          }
          if (t.name === 'read_file') {
            const p = parseReadFile(t.argsJson);
            return p ? `read → ${p.path}` : t.argsJson;
          }
          if (t.name === 'list_directory') {
            const p = parseListDir(t.argsJson);
            return p ? `ls → ${p.path}` : t.argsJson;
          }
          if (t.name === 'search_files') {
            const p = parseSearchFiles(t.argsJson);
            return p ? `search → ${p.pattern}` : t.argsJson;
          }
          return parseRunTerminalCommand(t.argsJson)?.command || t.argsJson;
        })();

        return (
          <div
            key={t.id}
            className="rounded-md border border-border bg-secondary/40 text-xs overflow-hidden"
          >
            <div className="px-3 py-1.5 border-b border-border bg-muted/30 flex items-center gap-1.5">
              <span className="text-muted-foreground">{icon}</span>
              <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wide">
                {t.name}
              </span>
            </div>
            <pre className="px-3 py-2 font-mono text-[11px] text-foreground whitespace-pre-wrap break-all max-h-48 overflow-y-auto scrollbar-thin">
              {displayCmd}
            </pre>

            {/* Auto-queued: show progress */}
            {t.status === 'auto_queued' && (
              <div className="flex items-center gap-1.5 px-3 pb-2.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                <span className="text-[11px]">{actionDesc}</span>
              </div>
            )}

            {t.status === 'pending_user' && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
                <button
                  type="button"
                  onClick={() => void executeToolInvocation(t)}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Play className="h-3 w-3" />
                  Run
                </button>
                <button
                  type="button"
                  onClick={() => rejectOne(t)}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-surface-hover"
                >
                  <XCircle className="h-3 w-3" />
                  Skip
                </button>
              </div>
            )}

            {t.status === 'running' && (
              <div className="flex items-center gap-1.5 px-3 pb-2.5 text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="text-[11px]">{actionDesc}</span>
              </div>
            )}

            {(t.status === 'completed' || t.status === 'failed' || t.status === 'rejected') && (
              <div className="px-3 pb-2.5 space-y-1 text-[10px] text-muted-foreground">
                {t.status === 'rejected' && <p className="text-warning">Skipped</p>}
                {t.status === 'failed' && (
                  <p className="text-destructive">Failed{typeof t.exitCode === 'number' ? ` (exit ${t.exitCode})` : ''}</p>
                )}
                {t.status === 'completed' && (
                  <p className="text-success">Done{typeof t.exitCode === 'number' ? ` (exit ${t.exitCode})` : ''}</p>
                )}
                {t.stdout?.trim() && (
                  <pre className="max-h-40 overflow-auto rounded bg-background/50 p-1 font-mono text-foreground/90 scrollbar-thin">
                    {t.stdout.trim()}
                  </pre>
                )}
                {t.stderr?.trim() && (
                  <pre className="max-h-40 overflow-auto rounded bg-destructive/10 p-1 font-mono text-destructive scrollbar-thin">
                    {t.stderr.trim()}
                  </pre>
                )}
                {t.errorMessage && !t.stderr && <p className="text-destructive/90">{t.errorMessage}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
