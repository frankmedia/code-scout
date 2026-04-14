/**
 * agentExecutorValidation.ts
 *
 * Validation helpers, repair-fix application, syntax pre-check, and stop diagnostics.
 */

import { useWorkbenchStore, Plan } from '@/store/workbenchStore';
import { isTauri, writeProjectFile } from '@/lib/tauri';
import { writeFileToFS } from './fileSystemService';
import { verifyStep, VerificationResult, VerificationInput } from './verifierAgent';
import { normalizePath } from './pathResolution';
import {
  resolveProjectRoot,
  runProjectValidation,
  formatValidationFailure,
  normalizeValidationCommand,
  ValidationRunResult,
} from './validationRunner';
import { RepairFix } from './repairAgent';
import type { ExecutionCallbacks } from './agentExecutorContext';
import { executeRepairCommand } from './agentExecutorPort';

export type { ValidationRunResult, VerificationResult, VerificationInput };

// ─── Verifier → Validation bridge ───────────────────────────────────────────

export function verifierToValidationResult(verification: VerificationResult): ValidationRunResult | null {
  if (verification.result === 'fail') {
    return {
      pass: false,
      command: '(step verifier)',
      stdout: '',
      stderr: verification.summary,
      skipped: false,
    };
  }
  if (verification.result === 'partial') {
    return {
      pass: false,
      command: '(step verifier)',
      stdout: '',
      stderr: `Verification partial: ${verification.summary}`,
      skipped: false,
    };
  }
  return null;
}

export async function runPostStepValidation(
  plan: Plan,
  verification: VerificationResult,
  /** Skip the full project build/lint — only use the lightweight step verifier. */
  skipProjectBuild: boolean,
): Promise<ValidationRunResult> {
  const failed = verifierToValidationResult(verification);
  if (failed) return failed;

  if (skipProjectBuild) {
    return { pass: true, command: '(deferred to last step)', stdout: '', stderr: '', skipped: true };
  }

  const { projectPath, files, getFileContent } = useWorkbenchStore.getState();
  const project = await runProjectValidation({
    validationCommand: plan.validationCommand,
    projectPath,
    files,
    getFileContent,
  });

  if (project.skipped) {
    return { ...project, pass: true };
  }
  return project;
}

// ─── Repair path resolution ─────────────────────────────────────────────────

/** Map common wrong paths from the model to files that exist in the workbench. */
export function resolveRepairEditPath(
  normalizedPath: string,
  getFileContent: (path: string) => string | undefined,
): string {
  if (getFileContent(normalizedPath) !== undefined) return normalizedPath;

  const tryAlts = (wrong: string, alts: string[]) => {
    if (normalizedPath === wrong || normalizedPath.endsWith(`/${wrong}`)) {
      for (const a of alts) {
        if (getFileContent(a) !== undefined) return a;
      }
    }
    return null;
  };

  return (
    tryAlts('vite.config.js', ['vite.config.ts', 'vite.config.mjs', 'vite.config.cjs']) ??
    tryAlts('main.js', ['src/main.tsx', 'src/main.jsx', 'src/main.ts']) ??
    tryAlts('src/main.js', ['src/main.tsx', 'src/main.jsx']) ??
    normalizedPath
  );
}

// ─── Stop diagnostic helpers ────────────────────────────────────────────────

/**
 * Map a FailureFingerprint category to the legacy UI-facing kind.
 */
export function classifyValidationFailure(
  validation: ValidationRunResult,
  repeatedError: boolean,
): 'model' | 'infra' | 'stuck' {
  if (repeatedError) return 'stuck';
  const text = (validation.stderr + ' ' + validation.stdout).toLowerCase();
  const infraPatterns = [
    'no such file or directory', 'command not found', 'enoent', 'os error',
    'ebadplatform', 'unsupported platform', 'cannot find native binding',
    'npm has a bug related to optional dependencies',
    'please try `npm i` again after removing both package-lock',
    'shell execution requires', 'timed out after', 'econnrefused',
    'failed to fetch', 'permission denied', 'npm error 404',
    '404 not found', 'is not in this registry', 'e404',
  ];
  if (infraPatterns.some(p => text.includes(p))) return 'infra';
  return 'model';
}

export function buildStopDiagnostic(
  step: import('@/store/workbenchStore').PlanStep,
  validation: ValidationRunResult,
  attempts: number,
  kind: 'model' | 'infra' | 'stuck',
): string {
  const failText = formatValidationFailure(validation);
  const failLower = (validation.stderr + ' ' + validation.stdout).toLowerCase();
  const isNpm404 = failLower.includes('npm error 404') || failLower.includes('is not in this registry');
  const isBadPlatform = failLower.includes('ebadplatform') || failLower.includes('unsupported platform');
  const isMissingBinding = failLower.includes('cannot find native binding');

  const header =
    kind === 'infra'
      ? isNpm404
        ? `Stopped — the model tried to install a package that does not exist on npm (404).`
        : isMissingBinding
        ? `Stopped — a native arm64 binding could not be installed after repair attempts.`
        : isBadPlatform
        ? `Stopped — npm tried to install an x64 binary on this Apple Silicon (arm64) machine.`
        : `Stopped — infrastructure problem prevented validation.`
      : kind === 'stuck'
        ? `Stopped — the same error persisted after ${attempts} repair attempt(s).`
        : `Stopped — code changes did not build after ${attempts} repair attempt(s).`;

  const suggestion =
    kind === 'infra'
      ? 'Ensure the project folder is open, dependencies are installed, and the validation command is correct.'
      : 'Fix the error above manually, or switch to a more capable model and retry.';

  return [
    header,
    `Step: ${step.description}`,
    step.path ? `File involved: ${step.path}` : '',
    step.command ? `Command: ${step.command}` : '',
    `Still failing:\n${failText.slice(0, 2000)}`,
    suggestion,
  ].filter(Boolean).join('\n');
}

// ─── Syntax pre-check ───────────────────────────────────────────────────────

/**
 * Fast in-process checks for the most common model-caused file corruptions.
 * Returns an array of human-readable problem descriptions, empty if all clear.
 */
export function syntaxPreCheck(content: string, filePath: string): string[] {
  const problems: string[] = [];
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const isJs = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext);
  if (!isJs) return problems;

  const lines = content.split('\n');

  // 1. Duplicate import lines
  const importLines = lines
    .map((l, i) => ({ line: l.trim(), idx: i + 1 }))
    .filter(l => /^import\s+/.test(l.line));

  const seen = new Map<string, number>();
  for (const { line, idx } of importLines) {
    const prev = seen.get(line);
    if (prev !== undefined) {
      problems.push(`Duplicate import on lines ${prev} and ${idx}: ${line}`);
    } else {
      seen.set(line, idx);
    }
  }

  // 2. Import / export statements after `export default`
  let defaultExportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^export\s+default\s+/.test(trimmed) || trimmed === 'export default') {
      defaultExportLine = i + 1;
    }
  }
  if (defaultExportLine > 0) {
    for (let i = defaultExportLine; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (/^import\s+/.test(trimmed) || /^export\s+/.test(trimmed)) {
        problems.push(
          `Statement after \`export default\` on line ${i + 1} (must be at top of file): ${trimmed}`,
        );
      }
    }
  }

  return problems;
}

// ─── Apply repair fix ───────────────────────────────────────────────────────

export async function applyRepairFix(fix: RepairFix, callbacks: ExecutionCallbacks): Promise<void> {
  const store = useWorkbenchStore.getState();

  if (fix.kind === 'run_command') {
    // executeRepairCommand imported at top of file
    const cmd =
      normalizeValidationCommand(fix.command, (p) => store.getFileContent(p), store.files) || fix.command.trim();
    if (cmd !== fix.command.trim()) {
      callbacks.onLog(`Repair: using \`${cmd}\` instead of \`${fix.command.trim()}\``, 'info');
    }
    callbacks.onLog(`Repair: running ${cmd}`, 'info');
    callbacks.onTerminal(`$ ${cmd}`);
    if (!isTauri()) {
      throw new Error('Repair command requires Code Scout desktop app with a project folder open.');
    }
    const { projectPath, files } = store;
    const cwd = projectPath ? resolveProjectRoot(projectPath, files) : undefined;
    const result = await executeRepairCommand(cmd, cwd);
    if (result.stdout) result.stdout.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(l));
    if (result.stderr) result.stderr.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(`! ${l}`));
    if (result.code !== 0) {
      throw new Error(`Repair command failed (exit ${result.code}): ${result.stderr || cmd}`);
    }
    callbacks.onLog(`Repair: ran ${cmd}`, 'success');
    return;
  }

  if (fix.kind === 'create_file') {
    const createPath = normalizePath(fix.path);
    callbacks.onLog(`Repair: writing full file ${createPath}`, 'info');
    store.updateFileContent(createPath, fix.content);
    const { projectPath, files: createFiles } = useWorkbenchStore.getState();
    const createRoot = projectPath ? resolveProjectRoot(projectPath, createFiles) : null;
    if (isTauri() && createRoot) {
      try {
        await writeProjectFile(createRoot, createPath, fix.content);
      } catch (e) {
        callbacks.onLog(`FS write warning for ${createPath}: ${e instanceof Error ? e.message : e}`, 'warning');
      }
    }
    callbacks.onLog(`Repair: wrote full file ${createPath}`, 'success');
    return;
  }

  const rawPath = normalizePath(fix.path);
  const path = resolveRepairEditPath(rawPath, (p) => store.getFileContent(p));
  const content = store.getFileContent(path);
  if (content === undefined) {
    throw new Error(`Repair: file not found: ${rawPath}${rawPath !== path ? ` (also tried ${path})` : ''}`);
  }
  if (path !== rawPath) {
    callbacks.onLog(`Repair: using ${path} instead of ${rawPath}`, 'info');
  }

  store.pushSnapshot({ path, content, action: 'edited' });

  let newContent: string;
  if (!fix.before.trim()) {
    newContent = content + (fix.after ? `\n${fix.after}` : '');
  } else if (content.includes(fix.before)) {
    newContent = content.replace(fix.before, fix.after);
  } else {
    throw new Error(`Repair: could not find the pattern to replace in ${path}`);
  }

  store.updateFileContent(path, newContent);

  const { dirHandle, projectPath, files: repairFiles } = useWorkbenchStore.getState();
  const repairRoot = projectPath ? resolveProjectRoot(projectPath, repairFiles) : null;
  if (isTauri() && repairRoot) {
    try {
      await writeProjectFile(repairRoot, path, newContent);
    } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  } else if (dirHandle) {
    try {
      await writeFileToFS(dirHandle, path, newContent);
    } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  }

  const currentPlan = useWorkbenchStore.getState().currentPlan;
  if (currentPlan) {
    const steps2 = currentPlan.steps.map(s =>
      normalizePath(s.path ?? '') === path ? { ...s, diff: { before: content, after: newContent } } : s,
    );
    useWorkbenchStore.setState({
      currentPlan: { ...currentPlan, steps: steps2 },
    });
  }

  callbacks.onLog(`Repair: edited ${path}`, 'success');
}
