/**
 * agentExecutorSteps.ts
 *
 * Individual step executors: create_file, edit_file, delete_file, run_command.
 * Also the step action router (executeStepAction) and smart action detection.
 */

import { useWorkbenchStore, PlanStep } from '@/store/workbenchStore';
import { ModelConfig } from '@/store/modelStore';
import { isTauri, writeProjectFile, executeCommand, spawnCommand } from '@/lib/tauri';
import { writeFileToFS, deleteFileFromFS } from './fileSystemService';
import { resolveProjectRoot, ensureShellCwdForPlan } from './validationRunner';
import { setLastDevServerUrl } from '@/store/workbenchStoreTypes';
import { normalizePath, resolveFilePath, isBackgroundCommand, normalizeCommandPaths } from './pathResolution';
import { useAgentMemoryStore } from '@/store/agentMemoryStore';
import { isInstallCommand, buildInstallRecord, recordInstall } from './installTracker';
import type { ExecutionCallbacks } from './agentExecutorContext';
import { addWebResearchContext, WEB_CONTENT_MAX_CHARS } from './agentExecutorContext';
import {
  generateCodeWithModel,
  generateFallbackCode,
  gatherSiblingContext,
  buildFileHints,
  MAX_GENERATED_FILE_LINES,
  WARN_GENERATED_FILE_LINES,
} from './agentExecutorCodeGen';
import { executeWebSearch, executeFetchUrl, executeBrowseWeb } from './agentExecutorWebResearch';
import { appendShellCommandHints, sanitizeRmCommaSeparatedPaths } from './agentExecutorUtils';
import { detectDevServerPort, freePortIfOccupied } from './agentExecutorPort';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Max time (ms) to wait for a normal command before considering it timed out. */
const CMD_TIMEOUT_MS = 120_000;

/** For background commands, wait this long to collect initial output then move on. */
const BACKGROUND_SETTLE_MS = 5_000;

/** Known CLI tools — if the command starts with one of these, it's a real shell command. */
export const KNOWN_CLI_TOOLS = /^(npm|npx|node|pnpm|yarn|bun|cargo|pip|pip3|python|python3|git|curl|wget|make|cmake|mkdir|rm|rmdir|mv|cp|cat|ls|cd|echo|find|grep|rg|chmod|chown|brew|apt|apt-get|yum|dnf|pacman|rustc|rustup|go|java|javac|mvn|gradle|docker|kubectl|terraform|ssh|scp|tar|unzip|zip|sed|awk|sort|head|tail|wc|diff|touch|ln|open|pbcopy|xdg-open|code|subl|vim|nano|less|more|env|export|source|which|whereis|type|man|sudo|su|deno|tsc|tsx|jest|vitest|eslint|prettier)\b/;

// ─── Helper ─────────────────────────────────────────────────────────────────

/** Flatten all files from a FileNode tree into a flat list. */
export function flattenAllFiles(nodes: import('@/store/workbenchStore').FileNode[]): { path: string; name: string }[] {
  const result: { path: string; name: string }[] = [];
  for (const n of nodes) {
    if (n.type === 'file') result.push({ path: n.path, name: n.name });
    if (n.children) result.push(...flattenAllFiles(n.children));
  }
  return result;
}

// ─── File step executors ────────────────────────────────────────────────────

export async function executeCreateFile(
  step: PlanStep,
  model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const path = normalizePath(step.path ?? '');
  if (!path) throw new Error('No file path specified');
  step.path = path;

  const store = useWorkbenchStore.getState();
  store.pushSnapshot({ path, content: null, action: 'created' });

  let content: string;

  const actId = callbacks.onActivity?.('creating_file', `Creating ${path}`, step.description.slice(0, 80));

  if (model) {
    callbacks.onLog(`Generating code for ${path}...`, 'info');
    const fileHints = buildFileHints(path);
    const siblingCtx = gatherSiblingContext(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
    try {
      content = await generateCodeWithModel(
        model,
        `Create a file at "${path}". Purpose: ${step.description}.${fileHints}\nWrite the complete file content.`,
        callbacks.signal,
        siblingCtx,
      );
    } catch {
      callbacks.onLog(`AI generation failed for ${path}, using template`, 'warning');
      content = generateFallbackCode(step);
    }
  } else {
    content = generateFallbackCode(step);
  }

  const lineCount = content.split('\n').length;
  if (lineCount > MAX_GENERATED_FILE_LINES) {
    callbacks.onLog(
      `Generated file "${path}" is ${lineCount} lines — exceeds the ${MAX_GENERATED_FILE_LINES}-line hard limit. Split into smaller modules.`,
      'warning',
    );
  } else if (lineCount > WARN_GENERATED_FILE_LINES) {
    callbacks.onLog(
      `Large file: "${path}" is ${lineCount} lines — small LLMs work best with files under 200 lines. Consider splitting.`,
      'warning',
    );
  }

  store.createFile(path, content);

  const { dirHandle, projectPath, files: currentFiles } = useWorkbenchStore.getState();
  const resolvedRoot = projectPath ? resolveProjectRoot(projectPath, currentFiles) : null;
  if (isTauri() && resolvedRoot) {
    try { await writeProjectFile(resolvedRoot, path, content); } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  } else if (dirHandle) {
    try { await writeFileToFS(dirHandle, path, content); } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  }

  if (actId) callbacks.onActivityComplete?.(actId);
  callbacks.onLog(`Created: ${path}`, 'success');
}

export async function executeEditFile(
  step: PlanStep,
  model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  let path = normalizePath(step.path ?? '');
  if (!path) throw new Error('No file path specified');

  const editActId = callbacks.onActivity?.('writing_code', `Editing ${path}`, step.description.slice(0, 80));

  const store = useWorkbenchStore.getState();

  const { resolved, changed } = resolveFilePath(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
  if (changed) {
    callbacks.onLog(`Path resolved: "${path}" → "${resolved}"`, 'warning');
    path = resolved;
  }
  step.path = path;

  const currentContent = store.getFileContent(path);

  if (currentContent === undefined) {
    callbacks.onLog(`File not found for edit: "${path}" — falling back to create`, 'warning');
    if (step.diff?.after) {
      store.createFile(path, step.diff.after);
      const { dirHandle: dh2, projectPath: pp2, files: f2 } = useWorkbenchStore.getState();
      const root2 = pp2 ? resolveProjectRoot(pp2, f2) : null;
      if (isTauri() && root2) {
        try { await writeProjectFile(root2, path, step.diff.after); } catch { /* non-fatal */ }
      } else if (dh2) {
        try { await writeFileToFS(dh2, path, step.diff.after); } catch { /* non-fatal */ }
      }
      callbacks.onLog(`Created (fallback): ${path}`, 'success');
      return;
    }
    if (model) {
      callbacks.onLog(`AI generating content for new file ${path}...`, 'info');
      const siblingCtx = gatherSiblingContext(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
      try {
        const generated = await generateCodeWithModel(
          model,
          `Create a file at "${path}". Purpose: ${step.description}. Write the complete file content.`,
          callbacks.signal,
          siblingCtx,
        );
        store.createFile(path, generated);
        const { dirHandle: dh3, projectPath: pp3, files: f3 } = useWorkbenchStore.getState();
        const root3 = pp3 ? resolveProjectRoot(pp3, f3) : null;
        if (isTauri() && root3) {
          try { await writeProjectFile(root3, path, generated); } catch { /* non-fatal */ }
        } else if (dh3) {
          try { await writeFileToFS(dh3, path, generated); } catch { /* non-fatal */ }
        }
        callbacks.onLog(`Created (AI fallback): ${path}`, 'success');
        return;
      } catch {
        callbacks.onLog(`AI generation also failed for ${path}`, 'warning');
      }
    }
    throw new Error(`File not found: ${path}`);
  }

  store.pushSnapshot({ path, content: currentContent, action: 'edited' });

  let newContent: string;

  if (step.diff?.after) {
    if (step.diff.before && currentContent.includes(step.diff.before)) {
      newContent = currentContent.replace(step.diff.before, step.diff.after);
    } else if (model) {
      callbacks.onLog(`Diff "before" did not match "${path}" — asking model with full file...`, 'warning');
      const siblingCtx = gatherSiblingContext(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
      try {
        newContent = await generateCodeWithModel(
          model,
          `Current file "${path}":\n\n${currentContent}\n\nThe plan wanted this change but the exact "before" snippet was not found in the file: ${step.description}\n\nApply the intended change. Return the COMPLETE updated file content only.`,
          callbacks.signal,
          siblingCtx,
        );
      } catch {
        callbacks.onLog(`AI edit failed for ${path}, appending planned diff as last resort`, 'warning');
        newContent = currentContent + '\n' + step.diff.after;
      }
    } else {
      newContent = currentContent + '\n' + step.diff.after;
    }
  } else if (model) {
    callbacks.onLog(`AI editing ${path}...`, 'info');
    const siblingCtx = gatherSiblingContext(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
    try {
      newContent = await generateCodeWithModel(
        model,
        `Here is the current content of "${path}":\n\n${currentContent}\n\nEdit this file to: ${step.description}\n\nReturn the COMPLETE updated file content.`,
        callbacks.signal,
        siblingCtx,
      );
    } catch {
      callbacks.onLog(`AI edit failed for ${path}, applying basic edit`, 'warning');
      newContent = currentContent + `\n// TODO: ${step.description}\n`;
    }
  } else {
    newContent = currentContent + `\n// TODO: ${step.description}\n`;
  }

  store.updateFileContent(path, newContent);

  const { dirHandle: dh, projectPath: pp, files: editFiles } = useWorkbenchStore.getState();
  const editRoot = pp ? resolveProjectRoot(pp, editFiles) : null;
  if (isTauri() && editRoot) {
    try { await writeProjectFile(editRoot, path, newContent); } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  } else if (dh) {
    try { await writeFileToFS(dh, path, newContent); } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  }

  const currentPlan = useWorkbenchStore.getState().currentPlan;
  if (currentPlan) {
    const updatedSteps = currentPlan.steps.map(s =>
      s.id === step.id
        ? { ...s, diff: { before: currentContent, after: newContent } }
        : s
    );
    useWorkbenchStore.setState({
      currentPlan: { ...currentPlan, steps: updatedSteps },
    });
  }

  if (editActId) callbacks.onActivityComplete?.(editActId);
  callbacks.onLog(`Edited: ${path}`, 'success');
}

export async function executeDeleteFile(
  step: PlanStep,
  _model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  let path = normalizePath(step.path ?? '');
  if (!path) throw new Error('No file path specified');

  const store = useWorkbenchStore.getState();

  const { resolved, changed } = resolveFilePath(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
  if (changed) {
    callbacks.onLog(`Path resolved: "${path}" → "${resolved}"`, 'warning');
    path = resolved;
  }
  step.path = path;

  const currentContent = store.getFileContent(path);

  if (currentContent === undefined) {
    callbacks.onLog(`Delete skipped (file not found): ${path}`, 'warning');
    return;
  }

  store.pushSnapshot({ path, content: currentContent, action: 'deleted' });
  store.deleteFile(path);

  const { dirHandle: dh2, projectPath: pp2, files: delFiles } = useWorkbenchStore.getState();
  const delRoot = pp2 ? resolveProjectRoot(pp2, delFiles) : null;
  if (isTauri() && delRoot) {
    try {
      await executeCommand(`rm -f "${delRoot}/${path}"`);
    } catch (e) {
      callbacks.onLog(`FS delete warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  } else if (dh2) {
    try {
      await deleteFileFromFS(dh2, path);
    } catch (e) {
      callbacks.onLog(`FS delete warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  }

  callbacks.onLog(`Deleted: ${path}`, 'success');
}

// ─── Run command executor ───────────────────────────────────────────────────

export async function executeRunCommand(
  step: PlanStep,
  _model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const command = step.command;
  if (!command) throw new Error('No command specified');

  // Guard: file:// URL as a command
  if (/^file:\/\//i.test(command.trim())) {
    const store = useWorkbenchStore.getState();

    const stripped = command.trim().replace(/^file:\/\//i, '').replace(/\\/g, '/');
    const candidates = [
      stripped,
      stripped.replace(/^\/+/, ''),
      stripped.split('/').slice(1).join('/'),
      stripped.split('/').slice(2).join('/'),
    ];

    let resolvedPath = stripped;
    let content: string | undefined;
    for (const candidate of candidates) {
      content = store.getFileContent(candidate);
      if (content !== undefined) { resolvedPath = candidate; break; }
    }

    if (content !== undefined) {
      callbacks.onTerminal(`[Local · project file] ${resolvedPath} (${content.length} chars)`);
      callbacks.onLog(`Resolved file:// command → served "${resolvedPath}" from store`, 'info');
      addWebResearchContext(`[File read: ${resolvedPath}]\n${content.slice(0, WEB_CONTENT_MAX_CHARS)}`);
      callbacks.onStepOutput?.(step, `=== ${resolvedPath} ===\n${content.slice(0, 2000)}`);
      return;
    }

    throw new Error(
      `Cannot read "${stripped}": file:// is not a valid shell command, and the file was not found ` +
      `in the open project. Ensure the correct project folder is open in Code Scout.`,
    );
  }

  // Auto-correct commands
  let correctedCommand = command;

  const nodeRunsTs = command.match(/^node\s+(["']?)(\S+\.tsx?)\1(\s|$)/);
  if (nodeRunsTs) {
    correctedCommand = command.replace(/^node\s+/, 'npx tsx ');
    callbacks.onLog(`Auto-corrected: "node" cannot run .ts files — using "npx tsx" instead`, 'info');
  }

  const tsNodeRunsTs = correctedCommand.match(/^(?:npx\s+)?ts-node\s+/i);
  if (tsNodeRunsTs) {
    correctedCommand = correctedCommand.replace(/^(?:npx\s+)?ts-node\s+/i, 'npx tsx ');
    callbacks.onLog(`Auto-corrected: "ts-node" → "npx tsx" (tsx is always available via npx)`, 'info');
  }

  const rmCommaFix = sanitizeRmCommaSeparatedPaths(correctedCommand);
  if (rmCommaFix.changed) {
    correctedCommand = rmCommaFix.normalized;
    callbacks.onLog(
      `Auto-corrected rm: use spaces between paths, not commas (e.g. node_modules,lock → separate args)`,
      'warning',
    );
  }

  const cmdActId = callbacks.onActivity?.('running_command', `Running: ${correctedCommand.slice(0, 80)}`, step.description.slice(0, 60));
  callbacks.onTerminal(`[Local · shell] $ ${correctedCommand}`);

  if (!isTauri()) {
    if (cmdActId) callbacks.onActivityComplete?.(cmdActId);
    callbacks.onTerminal(`⚠ Skipped (requires desktop build): ${command}`);
    const msg =
      'Shell steps cannot run in the browser build. Use the Code Scout desktop app with a project folder open, or run this command yourself in the Terminal panel.';
    callbacks.onLog(`${msg} Command: ${command}`, 'warning');
    throw new Error(msg);
  }

  const { projectPath, files } = useWorkbenchStore.getState();
  const effectivePath = projectPath ? resolveProjectRoot(projectPath, files) : undefined;

  ensureShellCwdForPlan(effectivePath, callbacks, cmdActId);

  let resolvedCommand = correctedCommand;

  // Sanitise npm flag typos
  if (/^(npm|npx|yarn|pnpm|bun)\b/.test(resolvedCommand.trim())) {
    resolvedCommand = resolvedCommand
      .replace(/--omit-optional\b/g, '--omit=optional')
      .replace(/--omit optional\b/g, '--omit=optional')
      .replace(/--omit=optional\s+--omit=optional/g, '--omit=optional');
  }

  if (effectivePath) {
    const projectDirName = effectivePath.replace(/\\/g, '/').split('/').filter(Boolean).pop();
    if (projectDirName) {
      const redundantCd = new RegExp(`^cd\\s+\\.?\\/?${projectDirName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*&&\\s*`, 'i');
      const stripped = resolvedCommand.replace(redundantCd, '');
      if (stripped !== resolvedCommand) {
        callbacks.onLog(`Removed redundant 'cd ${projectDirName}' — already in project root`, 'info');
        resolvedCommand = stripped;
      }
    }
  }

  const background = isBackgroundCommand(resolvedCommand);

  if (background) {
    const viteConfig = useWorkbenchStore.getState().getFileContent('vite.config.ts')
      ?? useWorkbenchStore.getState().getFileContent('vite.config.js')
      ?? useWorkbenchStore.getState().getFileContent('vite.config.mjs');
    const devPort = detectDevServerPort(resolvedCommand, viteConfig);
    const cdMatch = resolvedCommand.match(/\bcd\s+([\w.-]+)/);
    const projectHint = cdMatch?.[1]
      ?? (effectivePath ? effectivePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() : undefined);
    if (devPort) {
      await freePortIfOccupied(devPort, effectivePath, callbacks, projectHint);
    }

    callbacks.onLog(`Starting background process: ${resolvedCommand}`, 'info');
    callbacks.onTerminal(`(background) ${resolvedCommand}`);

    let settled = false;
    let errorOutput = '';

    const URL_REGEX = /https?:\/\/[^\s'">\])+,;]+/gi;
    // eslint-disable-next-line no-control-regex
    const ANSI = /\x1b\[[0-9;]*m/g;
    const handleOutputLine = (raw: string, isErr = false) => {
      const line = isErr ? `! ${raw}` : raw;
      callbacks.onTerminal(line);
      callbacks.onStepOutput?.(step, line);
      const stripped = raw.replace(ANSI, '');
      const matches = stripped.match(URL_REGEX);
      if (matches) {
        const preferred = matches.find(u => /localhost|127\.0\.0\.1/i.test(u)) ?? matches[0];
        const clean = preferred.replace(/[/,;:]+$/, '');
        // Only treat as dev server if it's a local address — ignore external URLs
        // embedded in error messages (e.g. github.com links in rollup errors).
        if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(clean)) {
          callbacks.onStepServerUrl?.(step, clean);
          setLastDevServerUrl(clean);
        }
      }
    };

    const kill = await spawnCommand(
      resolvedCommand,
      effectivePath,
      (line) => handleOutputLine(line),
      (line) => { handleOutputLine(line, true); errorOutput += line + '\n'; },
      (code) => {
        if (!settled) {
          settled = true;
          if (code !== 0 && code !== null) {
            callbacks.onTerminal(`! Process exited with code ${code}`);
          }
        }
      },
    );

    useWorkbenchStore.getState().addLog(`Background: ${resolvedCommand} (PID active)`, 'info');

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        settled = true;
        resolve();
      }, BACKGROUND_SETTLE_MS);
    });

    if (errorOutput.trim()) {
      callbacks.onLog(`Background process stderr: ${errorOutput.trim().slice(0, 200)}`, 'warning');
    }
    callbacks.onLog(`Background process started: ${resolvedCommand}`, 'success');
    callbacks.onTerminal(`✓ Background process running. Continuing plan...`);

    (window as Record<string, unknown>).__scout_bg_kill = kill;
    return;
  }

  // Normal (foreground) command with timeout
  const result = await Promise.race([
    executeCommand(resolvedCommand, effectivePath),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Command timed out after ${CMD_TIMEOUT_MS / 1000}s: ${command}`)), CMD_TIMEOUT_MS),
    ),
  ]);

  if (result.stdout) result.stdout.split('\n').filter(Boolean).forEach(l => {
    callbacks.onTerminal(l);
    callbacks.onStepOutput?.(step, l);
  });
  if (result.stderr) result.stderr.split('\n').filter(Boolean).forEach(l => {
    callbacks.onTerminal(`! ${l}`);
    callbacks.onStepOutput?.(step, `! ${l}`);
  });
  if (result.code !== 0) {
    const isSearchTool = /^(grep|rg|ag|ack)\b/.test(resolvedCommand.trim()) ||
                         /\|\s*(grep|rg|ack)\b/.test(resolvedCommand);
    if (isSearchTool && result.code === 1 && !result.stderr.trim()) {
      const noMatchMsg = `(no matches found for: ${resolvedCommand.slice(0, 120)})`;
      callbacks.onTerminal(noMatchMsg);
      callbacks.onStepOutput?.(step, noMatchMsg);
      addWebResearchContext(
        `[Command: ${resolvedCommand.slice(0, 200)}]\nResult: No matches found (exit 1 — empty result). ` +
        `The pattern does not appear in the searched files.`,
      );
      callbacks.onLog(`Ran: ${resolvedCommand} (no matches — not an error)`, 'success');
      return;
    }

    // Auto-retry: "cd: DIRNAME: No such file or directory"
    const cdErrMatch = (result.stderr || '').match(/cd:\s*([^\s:]+):\s*no such file or directory/i);
    if (cdErrMatch) {
      const badDir = cdErrMatch[1];
      const escapedDir = badDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fixedCmd = resolvedCommand.replace(
        new RegExp(`^cd\\s+\\.?\\/?${escapedDir}\\s*&&\\s*`, 'i'), '',
      );
      if (fixedCmd !== resolvedCommand && fixedCmd.trim().length > 0) {
        callbacks.onLog(`Auto-fix: "cd ${badDir}" doesn't exist (already in project root). Retrying without it.`, 'info');
        callbacks.onTerminal(`⚙ Retrying: ${fixedCmd}`);
        const retryResult = await Promise.race([
          executeCommand(fixedCmd, effectivePath),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Command timed out after ${CMD_TIMEOUT_MS / 1000}s`)), CMD_TIMEOUT_MS),
          ),
        ]);
        if (retryResult.stdout) retryResult.stdout.split('\n').filter(Boolean).forEach(l => {
          callbacks.onTerminal(l);
          callbacks.onStepOutput?.(step, l);
        });
        if (retryResult.stderr) retryResult.stderr.split('\n').filter(Boolean).forEach(l => {
          callbacks.onTerminal(`! ${l}`);
          callbacks.onStepOutput?.(step, `! ${l}`);
        });
        if (retryResult.code === 0) {
          callbacks.onLog(`Retried successfully (without redundant cd): ${fixedCmd}`, 'success');
          return;
        }
        throw new Error(
          `Command failed (exit ${retryResult.code}): ${appendShellCommandHints(retryResult.stderr || '', fixedCmd) || fixedCmd}`,
        );
      }
    }

    // Safety net: reroute to web search if it doesn't look like a real CLI command
    const isRealCmd = KNOWN_CLI_TOOLS.test(command) || /[|><;]/.test(command) || /\s+--?\w/.test(command) || /[/\\]/.test(command);
    if (!isRealCmd && command.split(/\s+/).length >= 2) {
      callbacks.onLog(`Command "${command}" failed — looks like a search query, rerouting to web search`, 'info');
      callbacks.onTerminal(`⚠ Not a shell command — searching the web instead...`);
      (step as { action: string }).action = 'web_search';
      await executeWebSearch(step, _model, callbacks);
      return;
    }
    throw new Error(
      `Command failed (exit ${result.code}): ${appendShellCommandHints(result.stderr || '', resolvedCommand) || command}`,
    );
  }

  // Push diagnostic output into coder context
  const isInvestigativeCmd = /^(grep|rg|ag|ls|find|cat|head|tail|wc|file|stat|diff|jq|curl|echo)\b/.test(resolvedCommand.trim()) ||
    /\|\s*(grep|rg|jq|head|tail)\b/.test(resolvedCommand);
  const combinedOut = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (isInvestigativeCmd && combinedOut) {
    const capped = combinedOut.length > 3_000 ? combinedOut.slice(0, 3_000) + '\n... (truncated)' : combinedOut;
    addWebResearchContext(`[Command: ${resolvedCommand.slice(0, 200)}]\n${capped}`);
  }

  // Install tracking
  if (isInstallCommand(command)) {
    const record = buildInstallRecord(
      command,
      0,
      result.stdout ?? '',
      result.stderr ?? '',
      0,
      step.id,
      '',
    );
    const { projectPath, files } = useWorkbenchStore.getState();
    const { resolveEffectiveRoot } = await import('@/services/memoryManager');
    const root = projectPath ? resolveEffectiveRoot(projectPath, files) : '';
    if (root) recordInstall(record, root).catch((err) => { console.warn('[installTracker] Failed to persist install record:', err); });
    useAgentMemoryStore.getState().recordCommandOutcome(
      useWorkbenchStore.getState().projectName,
      command,
      true,
    );

  }

  if (cmdActId) callbacks.onActivityComplete?.(cmdActId);
  callbacks.onLog(`Ran: ${command}`, 'success');
}

// ─── Smart Action Detection ─────────────────────────────────────────────────

/**
 * Detect if a "run_command" is actually a web search query or a URL fetch.
 */
export function detectSmartAction(step: PlanStep): PlanStep['action'] {
  if (step.action !== 'run_command') return step.action;
  const cmd = (step.command ?? '').trim();
  if (!cmd) return step.action;

  if (/^https?:\/\//i.test(cmd)) return 'fetch_url';
  if (/^file:\/\//i.test(cmd)) return 'run_command';

  const desc = (step.description ?? '').toLowerCase();
  const searchInDesc = /\b(search|look\s*up|research|find\s+out|google|browse|web|internet|online|documentation|docs)\b/i;
  if (searchInDesc.test(desc) && !KNOWN_CLI_TOOLS.test(cmd)) return 'web_search';

  const cmdLower = cmd.toLowerCase();
  if (/^(search|find|look\s*up|what\s+is|how\s+to|latest|best|top|list\s+of)\b/.test(cmdLower)) return 'web_search';

  const hasFlags = /\s+--?\w/.test(cmd);
  const hasPipes = /[|><]/.test(cmd);
  const hasPath = /[/\\]/.test(cmd);
  const startsWithTool = KNOWN_CLI_TOOLS.test(cmd);

  const looksLikeCommand = startsWithTool || hasFlags || hasPipes || hasPath;

  if (!looksLikeCommand && cmd.split(/\s+/).length >= 2) {
    return 'web_search';
  }

  return step.action;
}

/**
 * Mutates the step's action in-place if it's misclassified.
 */
export function applySmartDetection(step: PlanStep, callbacks: ExecutionCallbacks): void {
  const detected = detectSmartAction(step);
  if (detected !== step.action) {
    callbacks.onLog(`Auto-rerouted: ${step.action} → ${detected} for "${step.command}"`, 'info');
    (step as { action: string }).action = detected;
  }
}

// ─── Step Action Router ─────────────────────────────────────────────────────

export async function executeStepAction(
  step: PlanStep,
  coderModel: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  applySmartDetection(step, callbacks);

  switch (step.action) {
    case 'create_file':
      await executeCreateFile(step, coderModel, callbacks);
      break;
    case 'edit_file':
      await executeEditFile(step, coderModel, callbacks);
      break;
    case 'delete_file':
      await executeDeleteFile(step, coderModel, callbacks);
      break;
    case 'run_command':
      await executeRunCommand(step, coderModel, callbacks);
      break;
    case 'web_search':
      await executeWebSearch(step, coderModel, callbacks);
      break;
    case 'fetch_url':
      await executeFetchUrl(step, coderModel, callbacks);
      break;
    case 'browse_web':
      await executeBrowseWeb(step, coderModel, callbacks);
      break;
    default:
      throw new Error(`Unknown action: ${step.action}`);
  }
}
