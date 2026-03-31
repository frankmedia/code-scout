/**
 * Tauri bridge — wraps Tauri v2 APIs with browser fallbacks.
 *
 * All functions check `isTauri()` first. When running in the browser
 * the original File System Access API / browser behavior is used.
 * When running inside the Tauri desktop shell, native APIs are used.
 */

import { FileNode } from '@/store/workbenchStore';

// ─── Detection ────────────────────────────────────────────────────────────────

/** True inside the Tauri desktop shell (v2 sets `window.isTauri`; internals always exist). */
export const isTauri = (): boolean => {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { isTauri?: boolean };
  return Boolean(w.isTauri || '__TAURI_INTERNALS__' in window);
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OpenDirResult {
  /** Absolute path on disk — only available in Tauri, empty string in browser */
  absolutePath: string;
  files: FileNode[];
  projectName: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

// ─── Directory open ───────────────────────────────────────────────────────────

/**
 * Open a directory picker and return the FileNode tree.
 * In Tauri: uses native dialog + custom Rust command (full filesystem access).
 * In browser: uses File System Access API.
 */
export async function openDirectoryNative(): Promise<OpenDirResult> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');

    const selected = await open({ directory: true, multiple: false, recursive: false });
    if (!selected || typeof selected !== 'string') {
      throw new Error('No directory selected');
    }

    const entries = await invoke<FileNode[]>('read_project_dir', { path: selected });
    const projectName = selected.split('/').pop() || selected.split('\\').pop() || 'project';

    return { absolutePath: selected, files: entries, projectName };
  }

  // Browser fallback — caller should use fileSystemService.openDirectory() instead
  throw new Error('openDirectoryNative called in browser — use fileSystemService.openDirectory()');
}

// ─── File write ───────────────────────────────────────────────────────────────

/**
 * Write a file at an absolute path (Tauri only).
 */
export async function writeFileNative(absolutePath: string, content: string): Promise<void> {
  if (!isTauri()) throw new Error('writeFileNative requires Tauri desktop');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('write_file', { path: absolutePath, content });
}

/**
 * Write a project file by joining the project root + relative path.
 */
export async function writeProjectFile(
  projectRoot: string,
  relativePath: string,
  content: string,
): Promise<void> {
  if (!isTauri()) throw new Error('writeProjectFile requires Tauri desktop');
  const sep = projectRoot.includes('\\') ? '\\' : '/';
  const abs = `${projectRoot}${sep}${relativePath}`;
  await writeFileNative(abs, content);
}

// ─── Directory create ─────────────────────────────────────────────────────────

export async function createDirNative(absolutePath: string): Promise<void> {
  if (!isTauri()) throw new Error('createDirNative requires Tauri desktop');
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('create_dir', { path: absolutePath });
}

// ─── Shell detection ──────────────────────────────────────────────────────────

/**
 * Detect if running on Windows.
 * Uses navigator.platform (works in Tauri webview) with userAgent fallback.
 */
export function isWindows(): boolean {
  if (typeof navigator !== 'undefined') {
    // navigator.platform is deprecated but widely supported; userAgent as fallback
    if (navigator.platform) return navigator.platform.startsWith('Win');
    return /Windows/i.test(navigator.userAgent);
  }
  return false;
}

/**
 * Cached user shell name (e.g. "zsh", "bash", "powershell").
 * Resolved once from the Rust side via $SHELL (Unix) or falls back to
 * "powershell" on Windows, "zsh" on macOS.
 */
let _shellBin: string | null = null;

export async function getUserShell(): Promise<string> {
  if (_shellBin) return _shellBin;
  if (!isTauri()) return isWindows() ? 'powershell' : 'bash';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const shell = await invoke<string>('get_user_shell');
    if (isWindows()) {
      // On Windows, trust powershell or cmd
      _shellBin = ['powershell', 'pwsh', 'cmd'].includes(shell.toLowerCase()) ? shell : 'powershell';
    } else {
      // On macOS/Linux, trust zsh, bash, sh
      _shellBin = ['zsh', 'bash', 'sh'].includes(shell) ? shell : 'zsh';
    }
  } catch {
    _shellBin = isWindows() ? 'powershell' : 'zsh';
  }
  return _shellBin;
}

// ─── Shell command execution ──────────────────────────────────────────────────

/**
 * Execute a shell command and return its output (non-streaming).
 *
 * Uses the user's login shell (`zsh -l -c` / `bash -l -c`) so that the full
 * developer PATH is available — Homebrew, nvm, pyenv, curl, git, npm, etc.
 */
/**
 * Build a shell command that ensures full PATH is available.
 * macOS GUI apps don't inherit terminal PATH — we explicitly source profiles.
 */
function wrapWithPathSetup(cmd: string, shell: string, cwd?: string): string {
  const lowerShell = shell.toLowerCase();

  // Windows: PowerShell or cmd — no profile sourcing needed, PATH is inherited
  if (lowerShell === 'powershell' || lowerShell === 'pwsh') {
    return cwd ? `Set-Location '${cwd}'; ${cmd}` : cmd;
  }
  if (lowerShell === 'cmd') {
    return cwd ? `cd /d "${cwd}" && ${cmd}` : cmd;
  }

  // macOS / Linux: Add common binary paths and source profile for nvm/pyenv/etc.
  // Use NONINTERACTIVE=1 to prevent zsh plugins from prompting.
  const pathFix = 'export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.nvm/current/bin:$HOME/.cargo/bin:$HOME/.local/bin:$PATH"; export NONINTERACTIVE=1;';
  // Only source profile if needed (e.g. nvm). Keep it lightweight — skip full .zshrc
  // which can load heavy plugins (oh-my-zsh, etc.) that hang in non-interactive shells.
  const profiles = shell === 'zsh'
    ? '[ -f ~/.zprofile ] && . ~/.zprofile 2>/dev/null;'
    : '[ -f ~/.bash_profile ] && . ~/.bash_profile 2>/dev/null; [ -f ~/.bashrc ] && . ~/.bashrc 2>/dev/null;';
  // Inject cd into the command itself — guarantees correct cwd even if Tauri's
  // Command.create cwd option doesn't take effect (e.g. with shell -c wrapping).
  const cdPrefix = cwd ? `cd "${cwd}" && ` : '';
  return `${pathFix} ${profiles} ${cdPrefix}${cmd}`;
}

/**
 * Build shell arguments for the given shell and command.
 * Windows: powershell -NoProfile -Command "..." or cmd /C "..."
 * Unix: zsh/bash -l -c "..."
 */
function shellArgs(shell: string, wrappedCmd: string): string[] {
  const lower = shell.toLowerCase();
  if (lower === 'powershell' || lower === 'pwsh') {
    return ['-NoProfile', '-Command', wrappedCmd];
  }
  if (lower === 'cmd') {
    return ['/C', wrappedCmd];
  }
  // Unix: non-login shell (-c) — we handle PATH setup manually in wrapWithPathSetup
  // Using -l causes double profile sourcing which is slow and can hang
  return ['-c', wrappedCmd];
}

export async function executeCommand(
  cmd: string,
  cwd?: string,
): Promise<CommandResult> {
  if (!isTauri()) throw new Error('Shell execution requires Tauri desktop');

  const shell = await getUserShell();
  const { Command } = await import('@tauri-apps/plugin-shell');
  const wrappedCmd = wrapWithPathSetup(cmd, shell, cwd);
  const args = shellArgs(shell, wrappedCmd);
  const options = cwd ? { cwd } : undefined;
  let output;
  try {
    output = await Command.create(shell, args, options).execute();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message
      : typeof err === 'string' ? err
      : typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message)
      : JSON.stringify(err);
    throw new Error(`Shell execute failed: ${msg}`);
  }

  return {
    stdout: output.stdout,
    stderr: output.stderr,
    code: output.code,
  };
}

/**
 * Spawn a shell command and stream stdout/stderr line-by-line.
 * Returns a `kill()` function to terminate the process.
 *
 * Uses the user's login shell for full PATH access (curl, npm, git, etc.).
 */
export async function spawnCommand(
  cmd: string,
  cwd: string | undefined,
  onStdout: (line: string) => void,
  onStderr: (line: string) => void,
  onClose: (code: number | null) => void,
): Promise<() => void> {
  if (!isTauri()) throw new Error('Shell execution requires Tauri desktop');

  const shell = await getUserShell();
  const { Command } = await import('@tauri-apps/plugin-shell');
  const wrappedCmd = wrapWithPathSetup(cmd, shell, cwd);
  const args = shellArgs(shell, wrappedCmd);
  const options = cwd ? { cwd } : undefined;
  const command = Command.create(shell, args, options);

  command.stdout.on('data', onStdout);
  command.stderr.on('data', onStderr);
  command.on('close', data => onClose(data.code));
  command.on('error', err => onStderr(`Process error: ${err}`));

  try {
    const child = await command.spawn();
    return () => child.kill().catch(() => {});
  } catch (err: unknown) {
    // Tauri errors can be strings, objects, or Error instances
    const msg = err instanceof Error ? err.message
      : typeof err === 'string' ? err
      : typeof err === 'object' && err !== null && 'message' in err ? String((err as { message: unknown }).message)
      : JSON.stringify(err);
    throw new Error(`Shell spawn failed: ${msg}`);
  }
}

// ─── HTTP Request (bypasses CORS) ─────────────────────────────────────────────

export interface HttpResponse {
  status: number;
  body: string;
}

/**
 * Make an HTTP GET request via Tauri's native reqwest client (no CORS restrictions).
 * Used for web search, fetching documentation, etc.
 */
export async function makeHttpRequest(url: string): Promise<HttpResponse> {
  if (!isTauri()) throw new Error('HTTP request requires Tauri desktop');
  const { invoke } = await import('@tauri-apps/api/core');
  return await invoke<HttpResponse>('http_request', { url });
}

// ─── Git clone ────────────────────────────────────────────────────────────────

/**
 * Clone a git repository to a user-chosen directory using the native git binary.
 * Only available in Tauri — no CORS proxy, no restrictions on clone path.
 */
export async function cloneRepositoryNative(
  repoUrl: string,
  projectName: string,
  onProgress: (line: string) => void,
): Promise<OpenDirResult> {
  if (!isTauri()) throw new Error('Native git clone requires Tauri desktop');

  const { open } = await import('@tauri-apps/plugin-dialog');
  const { invoke } = await import('@tauri-apps/api/core');

  // Let user pick parent directory
  const parentDir = await open({ directory: true, multiple: false });
  if (!parentDir || typeof parentDir !== 'string') {
    throw new Error('No directory selected');
  }

  const sep = parentDir.includes('\\') ? '\\' : '/';
  const targetPath = `${parentDir}${sep}${projectName}`;

  onProgress(`Cloning into ${targetPath}...`);

  const result = await executeCommand(
    `git clone --depth 1 "${repoUrl}" "${targetPath}"`,
  );

  if (result.stderr) onProgress(result.stderr);
  if (result.stdout) onProgress(result.stdout);

  if (result.code !== 0) {
    throw new Error(`git clone failed (exit ${result.code}): ${result.stderr}`);
  }

  onProgress('Reading project files...');
  const files = await invoke<FileNode[]>('read_project_dir', { path: targetPath });
  const name = projectName || targetPath.split(sep).pop() || 'project';

  return { absolutePath: targetPath, files, projectName: name };
}
