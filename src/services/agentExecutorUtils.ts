/**
 * agentExecutorUtils.ts
 *
 * Small utility functions used across the agent executor pipeline.
 */

import type { FileNode, Plan } from '@/store/workbenchStore';
import { normalizeCommandPaths, resolveFilePath } from './pathResolution';

/** Cap for plan-time file indexing — uncapped recursion can freeze the UI on huge trees. */
export const PLAN_FLATTEN_MAX_FILES = 35_000;

/**
 * Iterative flatten with a hard cap (used before `normalizePlanPaths` in `executePlan`).
 */
/**
 * Race an async operation against a wall clock — used so plan startup (e.g. install
 * history read) cannot block the UI indefinitely.
 */
export async function raceWithTimeout<T>(promise: Promise<T>, ms: number, timeoutValue: T): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>(resolve => setTimeout(() => resolve(timeoutValue), ms)),
  ]);
}

export function flattenAllFilesCapped(
  nodes: FileNode[],
  onTruncated?: (message: string) => void,
): { path: string; name: string }[] {
  const result: { path: string; name: string }[] = [];
  const stack: FileNode[] = [...nodes].reverse();
  while (stack.length > 0) {
    if (result.length >= PLAN_FLATTEN_MAX_FILES) {
      onTruncated?.(
        `Large workspace: indexed the first ${PLAN_FLATTEN_MAX_FILES} file paths only — ` +
          `path auto-fix during this plan may miss rare paths.`,
      );
      break;
    }
    const n = stack.pop()!;
    if (n.type === 'file') result.push({ path: n.path, name: n.name });
    if (n.children) {
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
  }
  return result;
}

/**
 * LLMs often emit `rm -rf node_modules,package-lock.json` — commas create ONE invalid path.
 * Split comma-separated path tokens into separate arguments (space-separated).
 */
export function sanitizeRmCommaSeparatedPaths(command: string): { normalized: string; changed: boolean } {
  if (!/\brm\s+-[A-Za-z]*f[A-Za-z]*\s+/i.test(command)) {
    return { normalized: command, changed: false };
  }
  const normalized = command.replace(
    /\brm\s+(-[A-Za-z]+\s+)([^&|;]+?)(?=\s*(?:&&|\||;|$))/gi,
    (full, flags, pathBlob) => {
      const inner = pathBlob.trim();
      if (!inner.includes(',')) return full;
      const parts = inner.split(',').map(p => p.trim()).filter(Boolean);
      if (parts.length < 2) return full;
      return `rm ${flags}${parts.join(' ')}`;
    },
  );
  return { normalized, changed: normalized !== command };
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TAILWIND_NPX_HINT =
  '\n\n[Code Scout] Tailwind v4 removed the old CLI from the main `tailwindcss` package, so `npx tailwindcss init -p` fails. Either: `npm install -D tailwindcss@3 postcss autoprefixer` then `npx tailwindcss init -p`, OR use Tailwind v4 with `npm install tailwindcss @tailwindcss/vite` and the Vite plugin (no init -p). Prefer `npm create vite@latest . -- --template react-ts` for new React+Vite+TS apps.';

/** When npm/npx fails on tailwind init, append a concrete fix (models often mix v3 docs with v4 installs). */
export function appendTailwindCliNpmHint(stderr: string, command: string): string {
  const err = stderr || '';
  if (!/could not determine executable to run/i.test(err)) return err;
  if (!/tailwindcss/i.test(command)) return err;
  return err + TAILWIND_NPX_HINT;
}

const GIT_NOT_REPO_HINT =
  '\n\n[Code Scout] This working directory is not a Git repository (no `.git`). Run `git init` here first if you want version control, or open a folder that is already a clone.';

/** After `git ...` fails with "not a git repository", explain clearly (models often assume git exists). */
export function appendGitNotARepoHint(stderr: string, command: string): string {
  const err = stderr || '';
  if (!/\bgit\b/i.test(command)) return err;
  if (!/not a git repository/i.test(err)) return err;
  return err + GIT_NOT_REPO_HINT;
}

const SUDO_NONINTERACTIVE_HINT =
  '\n\n[Code Scout] Shell commands run in a **non-interactive** environment (no TTY). `sudo` cannot prompt for a password, so it fails with "a terminal is required" or "a password is required". **Do not use sudo** — keep work inside the opened project folder, use `npx` / local installs, or tell the user to run any privileged command themselves in their own terminal.';

/** After sudo fails because no password/TTY (typical in desktop agent shells). */
export function appendSudoNonInteractiveHint(stderr: string, command: string): string {
  const err = stderr || '';
  if (!/\bsudo\b/i.test(command)) return err;
  if (
    !/a terminal is required/i.test(err) &&
    !/a password is required/i.test(err) &&
    !/askpass helper/i.test(err)
  ) {
    return err;
  }
  return err + SUDO_NONINTERACTIVE_HINT;
}

/** Tailwind + git + sudo hints for failed shell tool runs (stderr shown back to the model). */
export function appendShellCommandHints(stderr: string, command: string): string {
  return appendSudoNonInteractiveHint(appendGitNotARepoHint(appendTailwindCliNpmHint(stderr, command), command), command);
}

/**
 * Pre-process all plan step paths before execution begins.
 * Fixes hallucinated paths (double prefixes, wrong extensions, etc.)
 * against the actual file tree. Also normalizes paths embedded in run_command strings.
 */
export function normalizePlanPaths(
  plan: Plan,
  getFileContent: (path: string) => string | undefined,
  allFiles: { path: string }[],
  onLog: (msg: string, type: 'info' | 'warning') => void,
): void {
  for (const step of plan.steps) {
    if (step.action === 'run_command' && step.command) {
      let cmd = step.command;
      const pathNorm = normalizeCommandPaths(cmd);
      if (pathNorm.changed) {
        onLog(`Command path fix: "${cmd}" → "${pathNorm.normalized}"`, 'warning');
        cmd = pathNorm.normalized;
      }
      const rmFix = sanitizeRmCommaSeparatedPaths(cmd);
      if (rmFix.changed) {
        onLog(`rm fix: comma-separated paths are invalid — "${cmd}" → "${rmFix.normalized}"`, 'warning');
        cmd = rmFix.normalized;
      }
      step.command = cmd;
      continue;
    }

    if (!step.path) continue;

    const { resolved, changed } = resolveFilePath(step.path, getFileContent, allFiles);
    if (changed) {
      onLog(`Path fix: "${step.path}" → "${resolved}"`, 'warning');
      step.path = resolved;
    }
  }
}
