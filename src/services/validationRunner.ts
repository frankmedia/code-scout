import { FileNode } from '@/store/workbenchStore';
import { executeCommand, isTauri } from '@/lib/tauri';
import type { FailureFingerprint, PackageManager } from './repairTypes';

const PROJECT_MARKERS = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'setup.py', 'Makefile', 'pom.xml', 'build.gradle'];

/** Normalise error text for “same error twice” detection */
export function normalizeValidationError(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 400);
}

export function resolveProjectRoot(projectPath: string, files: FileNode[]): string {
  const sep = projectPath.includes('\\') ? '\\' : '/';

  // Check root level first
  const topFiles = files.filter(f => f.type === 'file').map(f => f.name);
  const rootHasMarker = PROJECT_MARKERS.some(m => topFiles.includes(m));

  // Check subdirectories for project markers
  const subdirs = files.filter(f => f.type === 'folder' && f.children && !f.name.startsWith('.'));
  const subdirsWithMarker: FileNode[] = [];
  for (const dir of subdirs) {
    const childFiles = (dir.children ?? []).filter(f => f.type === 'file').map(f => f.name);
    if (PROJECT_MARKERS.some(m => childFiles.includes(m))) {
      subdirsWithMarker.push(dir);
    }
  }

  // If root has a marker AND a subdirectory also has one, prefer the subdir
  // that has package.json with scripts (the real project, not a wrapper dir)
  if (rootHasMarker && subdirsWithMarker.length > 0) {
    // Check if the root package.json has actual build/dev scripts
    const rootPkg = files.find(f => f.type === 'file' && f.name === 'package.json');
    let rootHasScripts = false;
    if (rootPkg?.content) {
      try {
        const data = JSON.parse(rootPkg.content) as { scripts?: Record<string, string> };
        rootHasScripts = !!(data.scripts?.build || data.scripts?.dev || data.scripts?.start);
      } catch { /* ignore */ }
    }

    if (rootHasScripts) {
      return projectPath; // Root has real scripts — use it
    }
    // Root has package.json but no scripts — prefer subdirectory
    return `${projectPath}${sep}${subdirsWithMarker[0].name}`;
  }

  if (rootHasMarker) {
    return projectPath;
  }

  if (subdirsWithMarker.length > 0) {
    return `${projectPath}${sep}${subdirsWithMarker[0].name}`;
  }

  if (subdirs.length === 1) {
    return `${projectPath}${sep}${subdirs[0].name}`;
  }

  return projectPath;
}

/**
 * Shell `run_command` steps need a resolved on-disk project root.
 * Without it, `executeCommand` would run in the wrong directory or fail opaquely.
 */
export function ensureShellCwdForPlan(
  effectivePath: string | undefined,
  callbacks: {
    onLog: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
    onTerminal: (line: string) => void;
    onActivityComplete?: (activityId: string) => void;
  },
  cmdActId: string | undefined,
): void {
  if (effectivePath?.trim()) return;
  if (cmdActId) callbacks.onActivityComplete?.(cmdActId);
  const msg =
    'Shell steps require a project folder on disk. Use **File → Open Folder…** (or reopen the project), then run the plan again.';
  callbacks.onLog(msg, 'error');
  callbacks.onTerminal(`! ${msg}`);
  throw new Error(msg);
}

interface PackageScripts {
  [key: string]: string | undefined;
}

function pickNpmScript(scripts: PackageScripts): string | null {
  const order = ['build', 'typecheck', 'check', 'lint', 'test'];
  for (const name of order) {
    if (typeof scripts[name] === 'string' && scripts[name]!.trim()) {
      return `npm run ${name}`;
    }
  }
  return null;
}

/**
 * Find the package.json content, checking both root and nested project paths.
 * In nested projects (user opened parent dir), the file might be at e.g. "website/package.json".
 */
function findPackageJson(
  getFileContent: (path: string) => string | undefined,
  files?: FileNode[],
): string | undefined {
  // Try bare path first
  const root = getFileContent('package.json');
  if (root) return root;
  // Try nested: look for a subdirectory containing package.json
  if (files) {
    for (const f of files) {
      if (f.type === 'folder' && f.children) {
        const nested = getFileContent(`${f.name}/package.json`);
        if (nested) return nested;
      }
    }
  }
  return undefined;
}

function parsePackageScripts(
  getFileContent: (path: string) => string | undefined,
  files?: FileNode[],
): PackageScripts {
  const pkg = findPackageJson(getFileContent, files);
  if (!pkg) return {};
  try {
    return (JSON.parse(pkg) as { scripts?: PackageScripts }).scripts ?? {};
  } catch {
    return {};
  }
}

/**
 * Prefer npm scripts over bare `vite` / `vite build` so local CLI + cwd match the project.
 */
export function normalizeValidationCommand(
  raw: string | undefined,
  getFileContent: (path: string) => string | undefined,
  files?: FileNode[],
): string {
  const trimmed = raw?.trim() ?? '';
  const scripts = parsePackageScripts(getFileContent, files);
  const lower = trimmed.toLowerCase();

  if (trimmed && scripts.build?.trim()) {
    if (lower === 'vite build' || lower.startsWith('vite build ') || lower === 'vite' || lower.startsWith('vite ')) {
      return 'npm run build';
    }
  }

  return trimmed;
}

/** Short list of config entry files present in the tree (for repair prompts). */
export function collectProjectConfigHints(
  files: FileNode[],
  getFileContent: (path: string) => string | undefined,
): string {
  const found = new Set<string>();
  const interesting = (p: string) =>
    /(^|\/)((vite\.config\.(ts|js|mjs|cjs))|index\.html|package\.json|tsconfig(\.app)?\.json)$/i.test(p);

  const walk = (nodes: FileNode[]) => {
    for (const n of nodes) {
      if (n.type === 'file' && interesting(n.path)) found.add(n.path.replace(/\\/g, '/'));
      if (n.children) walk(n.children);
    }
  };
  walk(files);

  for (const key of ['index.html', 'vite.config.ts', 'vite.config.js', 'package.json']) {
    if (getFileContent(key) !== undefined) found.add(key);
  }

  return [...found].sort().slice(0, 24).join('\n');
}

/**
 * Detect a validation command from the virtual file tree (package.json / Cargo.toml).
 */
export function detectValidationCommand(
  files: FileNode[],
  getFileContent: (path: string) => string | undefined,
): string | null {
  const pkg = findPackageJson(getFileContent, files);
  if (pkg) {
    try {
      const data = JSON.parse(pkg) as { scripts?: PackageScripts };
      const cmd = data.scripts ? pickNpmScript(data.scripts) : null;
      if (cmd) return cmd;
    } catch {
      /* ignore */
    }
  }

  const hasCargo = files.some(f => f.path === 'Cargo.toml' || f.name === 'Cargo.toml');
  if (hasCargo || getFileContent('Cargo.toml')) {
    return 'cargo build';
  }

  return null;
}

export interface ValidationRunResult {
  pass: boolean;
  command: string;
  stdout: string;
  stderr: string;
  skipped: boolean;
  /** Human-readable reason when skipped */
  skipReason?: string;
}

/**
 * Pure function: parse stdout+stderr into a structured FailureFingerprint.
 * No side effects. Used by the repair engine to decide the next strategy.
 */
export function classifyFailure(
  stdout: string,
  stderr: string,
  exitCode: number,
  context: { packageManager: PackageManager; arch: string | null; os: string | null },
): FailureFingerprint {
  const combined = (stderr + ' ' + stdout).toLowerCase();
  const raw = stderr + ' ' + stdout;
  const { packageManager, arch, os } = context;

  // Detect lockfile presence from error text
  const lockfile =
    combined.includes('package-lock.json') ? 'package-lock.json'
    : combined.includes('bun.lockb') ? 'bun.lockb'
    : combined.includes('yarn.lock') ? 'yarn.lock'
    : combined.includes('pnpm-lock.yaml') ? 'pnpm-lock.yaml'
    : null;

  // Helper: extract failing package name from error text
  function extractPackage(): string | null {
    // "npm error 404 Not Found - GET https://registry.npmjs.org/PACKAGE"
    const npm404 = raw.match(/404 Not Found - GET https?:\/\/[^/]+\/([^\s]+)/i);
    if (npm404) return npm404[1];
    // "is not in this registry" preceded by package name
    const notInReg = raw.match(/['"]?(@?[\w/-]+)['"]?\s+is not in this registry/i);
    if (notInReg) return notInReg[1];
    // EBADPLATFORM / "Unsupported platform" — extract package from context
    const ebad = raw.match(/optional\s+([^\s:]+):\s+Unsupported platform/i)
      || raw.match(/Unsupported platform for ([^\s:]+)/i)
      || raw.match(/EBADPLATFORM.*?([^\s]+darwin-x64[^\s]*)/i);
    if (ebad) return ebad[1];
    // "Cannot find module 'X'"
    const modMatch = raw.match(/Cannot find module ['"]([^'"]+)['"]/i);
    if (modMatch) return modMatch[1];
    return null;
  }

  function buildSignature(category: string, pkg: string | null): string {
    const parts = [category];
    if (packageManager) parts.push(packageManager);
    if (pkg) parts.push(pkg.slice(0, 60));
    if (arch) parts.push(arch);
    return parts.join(':');
  }

  // ── npm 404 ──────────────────────────────────────────────────────────────
  if (combined.includes('npm error 404') || combined.includes('is not in this registry')) {
    const pkg = extractPackage();
    return { category: 'npm_404', packageManager, failingPackage: pkg, arch, os, lockfile, errorSignature: buildSignature('npm_404', pkg) };
  }

  // ── EBADPLATFORM / Unsupported platform ──────────────────────────────────
  if (combined.includes('ebadplatform') || combined.includes('unsupported platform')) {
    const pkg = extractPackage();
    return { category: 'bad_platform', packageManager, failingPackage: pkg, arch, os, lockfile, errorSignature: buildSignature('bad_platform', pkg) };
  }

  // ── Missing native binding ────────────────────────────────────────────────
  if (
    combined.includes('cannot find native binding') ||
    combined.includes('npm has a bug related to optional dependencies') ||
    combined.includes('please try `npm i` again after removing both package-lock') ||
    raw.match(/Cannot find module ['"].*\.node['"]/i)
  ) {
    const pkg = extractPackage();
    return { category: 'missing_native_binding', packageManager, failingPackage: pkg, arch, os, lockfile, errorSignature: buildSignature('missing_native_binding', pkg) };
  }

  // ── Peer dep conflict ─────────────────────────────────────────────────────
  if (combined.includes('peer dep') || combined.includes('eresolve') || combined.includes('peer dependency')) {
    return { category: 'peer_dep_conflict', packageManager, failingPackage: null, arch, os, lockfile, errorSignature: buildSignature('peer_dep_conflict', null) };
  }

  // ── Missing dependency / module not found ─────────────────────────────────
  if (combined.includes('cannot find module') || combined.includes('module not found') || combined.includes('enoent') && combined.includes('node_modules')) {
    const pkg = extractPackage();
    return { category: 'missing_dependency', packageManager, failingPackage: pkg, arch, os, lockfile, errorSignature: buildSignature('missing_dependency', pkg) };
  }

  // ── Lockfile conflict ─────────────────────────────────────────────────────
  if (combined.includes('package-lock.json') && (combined.includes('old lockfile') || combined.includes('cannot update'))) {
    return { category: 'lockfile_conflict', packageManager, failingPackage: null, arch, os, lockfile, errorSignature: buildSignature('lockfile_conflict', null) };
  }

  // ── Command not found / no such file ─────────────────────────────────────
  if (combined.includes('command not found') || (combined.includes('no such file or directory') && !combined.includes('node_modules'))) {
    // Extract the binary name: "sh: vite: command not found" → "vite"
    const missingBin = raw.match(/sh:\s*([^:]+):\s*command not found/i)?.[1]?.trim()
      ?? raw.match(/([^\s]+):\s*command not found/i)?.[1]?.trim()
      ?? null;
    return { category: 'command_not_found', packageManager, failingPackage: missingBin, arch, os, lockfile, errorSignature: buildSignature('command_not_found', missingBin) };
  }

  // ── Network ───────────────────────────────────────────────────────────────
  if (combined.includes('econnrefused') || combined.includes('failed to fetch') || combined.includes('etimedout') || combined.includes('network')) {
    return { category: 'network', packageManager, failingPackage: null, arch, os, lockfile, errorSignature: buildSignature('network', null) };
  }

  // ── Permission ────────────────────────────────────────────────────────────
  if (combined.includes('permission denied') || combined.includes('eacces')) {
    return { category: 'permission', packageManager, failingPackage: null, arch, os, lockfile, errorSignature: buildSignature('permission', null) };
  }

  // ── Timeout ───────────────────────────────────────────────────────────────
  if (combined.includes('timed out') || exitCode === 124) {
    return { category: 'timeout', packageManager, failingPackage: null, arch, os, lockfile, errorSignature: buildSignature('timeout', null) };
  }

  // ── Build/compile error (TypeScript, Vite, Cargo, etc.) ──────────────────
  const isBuildError = combined.includes('type error') || combined.includes('ts error') ||
    combined.includes('✘ [error]') || combined.includes('error[e') ||
    /\berror\b.*(\.ts|\.tsx|\.js|\.jsx|\.rs|\.go)/i.test(raw);
  if (isBuildError) {
    return { category: 'build_error', packageManager, failingPackage: null, arch, os, lockfile, errorSignature: buildSignature('build_error', null) };
  }

  // ── File edit not applied (step verifier detected no change) ─────────────
  // This fires when the verifier reports the target file content did not change.
  // Category is handled separately so the repair engine knows to re-attempt the edit,
  // not run a package manager command.
  if (
    combined.includes('verification partial') ||
    combined.includes('content unchanged') ||
    combined.includes('file') && combined.includes('content unchanged')
  ) {
    const filePath = raw.match(/File\s+([^\s]+)\s+content unchanged/i)?.[1] ?? null;
    return { category: 'edit_not_applied', packageManager, failingPackage: filePath, arch, os, lockfile, errorSignature: buildSignature('edit_not_applied', filePath) };
  }

  // ── Unknown ───────────────────────────────────────────────────────────────
  // Derive a short signature from the first meaningful error line
  const firstErrorLine = (stderr || stdout).split('\n').find(l => l.trim().length > 5)?.trim().slice(0, 80) ?? 'unknown';
  return { category: 'unknown', packageManager, failingPackage: null, arch, os, lockfile, errorSignature: buildSignature('unknown', firstErrorLine) };
}

export interface RunValidationOptions {
  /** Explicit command from the plan */
  validationCommand?: string;
  projectPath: string | null;
  files: FileNode[];
  getFileContent: (path: string) => string | undefined;
}

/**
 * Run build/lint-style validation in the project root. Browser / no shell → skipped pass with file-only responsibility elsewhere.
 */
export async function runProjectValidation(opts: RunValidationOptions): Promise<ValidationRunResult> {
  const { validationCommand, projectPath, files, getFileContent } = opts;

  const fromPlan = normalizeValidationCommand(validationCommand, getFileContent, files);
  const command =
    fromPlan ||
    detectValidationCommand(files, getFileContent) ||
    '';

  if (!command) {
    return {
      pass: true,
      command: '(none)',
      stdout: '',
      stderr: '',
      skipped: true,
      skipReason: 'No validation command configured and none detected (package.json scripts / Cargo.toml).',
    };
  }

  if (!isTauri() || !projectPath) {
    return {
      pass: true,
      command,
      stdout: '',
      stderr: '',
      skipped: true,
      skipReason: 'Validation command not run (browser or no project path). Fix issues in the desktop app or run the command manually.',
    };
  }

  const cwd = resolveProjectRoot(projectPath, files);

  // ── Pre-flight: if the command is "npm run <X>", verify the script exists ──
  // This prevents cascading validation failures when the resolved cwd has a
  // package.json without the expected script.
  const npmRunMatch = command.match(/^npm run (\S+)/);
  if (npmRunMatch) {
    const scriptName = npmRunMatch[1];
    const scripts = parsePackageScripts(getFileContent, files);
    if (!scripts[scriptName]) {
      return {
        pass: true,
        command,
        stdout: '',
        stderr: '',
        skipped: true,
        skipReason: `Validation skipped: package.json does not have a "${scriptName}" script. Add one or configure a different validation command.`,
      };
    }
  }

  // Run the command exactly once — no retries, no pre-flight mutations.
  // The repair engine in dependencyRepairEngine.ts handles all retry logic.
  try {
    const result = await executeCommand(command, cwd);
    const pass = result.code === 0;
    return {
      pass,
      command,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      skipped: false,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // If the shell can't find the directory or binary, skip rather than fail the plan
    if (/no such file or directory/i.test(msg) || /os error 2/i.test(msg)) {
      return {
        pass: true,
        command,
        stdout: '',
        stderr: '',
        skipped: true,
        skipReason: `Validation skipped: working directory or command not found (${cwd}). Ensure the project is set up correctly.`,
      };
    }
    return {
      pass: false,
      command,
      stdout: '',
      stderr: msg,
      skipped: false,
    };
  }
}

export function formatValidationFailure(result: ValidationRunResult): string {
  if (result.skipped) return result.skipReason || 'Validation skipped';
  const parts = [`Command failed: ${result.command}`];
  if (result.stderr.trim()) parts.push(result.stderr.trim());
  if (result.stdout.trim()) parts.push(result.stdout.trim().slice(0, 2000));
  return parts.join('\n\n');
}
