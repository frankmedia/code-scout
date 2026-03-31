import { executeCommand } from '@/lib/tauri';

export interface EnvironmentInfo {
  nodeVersion: string | null;
  npmVersion: string | null;
  bunVersion: string | null;
  yarnVersion: string | null;
  pnpmVersion: string | null;
  pythonVersion: string | null;
  rustVersion: string | null;
  goVersion: string | null;
  gitVersion: string | null;
  /** tsx transpiler — preferred way to run .ts files (npx tsx) */
  tsxAvailable: boolean;
  /** ts-node availability (fallback, tsx is preferred) */
  tsNodeAvailable: boolean;
  /** Playwright CLI availability */
  playwrightAvailable: boolean;
  packageManager: 'bun' | 'pnpm' | 'yarn' | 'npm' | null;
  /** Lockfile detected in the project (wins over installed PM) */
  detectedLockfile: 'package-lock.json' | 'bun.lockb' | 'bun.lock' | 'yarn.lock' | 'pnpm-lock.yaml' | null;
  /** Scripts from package.json (e.g. { dev: "vite", build: "vite build" }) */
  projectScripts: Record<string, string> | null;
  /** e.g. "darwin", "linux", "win32" */
  os: string | null;
  /** e.g. "arm64", "x64" */
  arch: string | null;
  /** e.g. "Apple M2 Pro", "Apple M1", "Intel Core i9" */
  chipModel: string | null;
  /** raw one-liner summary for the prompt */
  summary: string;
}

function parseVersion(output: string): string | null {
  const line = output.trim().split('\n')[0].trim();
  return line.length > 0 && line.length < 80 ? line : null;
}

/**
 * Run a command using the user's real shell PATH (sourced from login shell).
 * Without this, Tauri's shell only has /usr/bin:/bin:/usr/sbin:/sbin — missing
 * Homebrew, bun, cargo, pyenv, nvm, etc.
 */
async function tryVersionWithPath(cmd: string, resolvedPath: string, cwd?: string): Promise<string | null> {
  try {
    const wrapped = `env PATH="${resolvedPath}" ${cmd}`;
    const result = await executeCommand(wrapped, cwd);
    if (result.code === 0) return parseVersion(result.stdout || result.stderr);
  } catch {
    // tool not available
  }
  return null;
}

/**
 * Resolve the user's actual shell PATH by sourcing their login shell.
 * Tries zsh first (macOS default since Catalina), then bash.
 * Falls back to a comprehensive hardcoded path list if the shell probe fails.
 */
async function resolveUserPath(cwd?: string): Promise<string> {
  // Common install locations to always include regardless of shell config
  const extraPaths = [
    '/opt/homebrew/bin',      // Apple Silicon Homebrew
    '/opt/homebrew/sbin',
    '/usr/local/bin',         // Intel Homebrew / manual installs
    '/usr/local/sbin',
    `${process?.env?.HOME ?? '/Users/' + (process?.env?.USER ?? 'user')}/.bun/bin`,  // Bun
    `${process?.env?.HOME ?? '/Users/' + (process?.env?.USER ?? 'user')}/.cargo/bin`, // Rust/Cargo
    `${process?.env?.HOME ?? '/Users/' + (process?.env?.USER ?? 'user')}/.local/bin`, // pip --user installs
    '/usr/local/go/bin',      // Go (standard install)
    '/usr/local/opt/python@3.12/bin', // Homebrew Python 3.12
    '/usr/local/opt/python@3.11/bin', // Homebrew Python 3.11
    '/opt/homebrew/opt/python@3.12/bin',
    '/opt/homebrew/opt/python@3.11/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].join(':');

  // Try to get the actual shell PATH (login shell sources ~/.zshrc, ~/.zprofile, etc.)
  for (const shellCmd of ['/bin/zsh -l -c \'echo $PATH\'', '/bin/bash -l -c \'echo $PATH\'']) {
    try {
      const result = await executeCommand(shellCmd, cwd);
      if (result.code === 0 && result.stdout?.trim()) {
        const shellPath = result.stdout.trim().split('\n')[0].trim();
        if (shellPath.length > 10) {
          // Merge shell PATH with our extras to catch anything not in the shell config
          const combined = [...new Set([...shellPath.split(':'), ...extraPaths.split(':')])].join(':');
          return combined;
        }
      }
    } catch {
      // try next shell
    }
  }

  return extraPaths;
}

/**
 * Probe the runtime environment by running version-check commands.
 * Resolves the user's real login-shell PATH first so that tools installed
 * via Homebrew, bun, cargo, pyenv, etc. are all visible.
 * Called once before plan generation so the AI knows what's actually installed.
 */
export async function probeEnvironment(projectPath?: string): Promise<EnvironmentInfo> {
  const cwd = projectPath;

  // Resolve OS and chip via uname — no Node.js dependency, always works
  let osName: string | null = null;
  let archName: string | null = null;
  try {
    const [osResult, archResult] = await Promise.all([
      executeCommand('uname -s', cwd),
      executeCommand('uname -m', cwd),
    ]);
    if (osResult.code === 0 && osResult.stdout?.trim()) {
      const raw = osResult.stdout.trim().toLowerCase();
      // Normalise to Node-style platform names for compatibility
      osName = raw === 'darwin' ? 'darwin' : raw.startsWith('linux') ? 'linux' : raw;
    }
    if (archResult.code === 0 && archResult.stdout?.trim()) {
      const raw = archResult.stdout.trim().toLowerCase();
      // arm64 / aarch64 → arm64; x86_64 → x64
      archName = (raw === 'arm64' || raw === 'aarch64') ? 'arm64'
               : (raw === 'x86_64' || raw === 'amd64') ? 'x64'
               : raw;
    }
  } catch {
    // Non-fatal — leave null
  }

  // Detect chip model — macOS: "Apple M2 Pro" via system_profiler or sysctl
  // Linux: CPU model from /proc/cpuinfo. Falls back to null gracefully.
  let chipModel: string | null = null;
  try {
    if (osName === 'darwin') {
      // system_profiler is authoritative on macOS — returns "Apple M2 Pro" etc.
      const spResult = await executeCommand(
        "system_profiler SPHardwareDataType | awk -F': ' '/Chip/{print $2; exit} /CPU/{print $2; exit}'",
        cwd,
      );
      if (spResult.code === 0 && spResult.stdout?.trim()) {
        chipModel = spResult.stdout.trim().split('\n')[0].trim() || null;
      }
      // Fallback: sysctl machdep.cpu.brand_string (works for Intel Macs)
      if (!chipModel) {
        const sysctlResult = await executeCommand('sysctl -n machdep.cpu.brand_string', cwd);
        if (sysctlResult.code === 0 && sysctlResult.stdout?.trim()) {
          chipModel = sysctlResult.stdout.trim() || null;
        }
      }
    } else if (osName === 'linux') {
      const cpuResult = await executeCommand(
        "grep 'model name' /proc/cpuinfo | head -1 | awk -F': ' '{print $2}'",
        cwd,
      );
      if (cpuResult.code === 0 && cpuResult.stdout?.trim()) {
        chipModel = cpuResult.stdout.trim() || null;
      }
    }
  } catch { /* non-fatal */ }

  // Resolve the user's real shell PATH before running any tool probes
  const resolvedPath = await resolveUserPath(cwd);
  const tv = (cmd: string) => tryVersionWithPath(cmd, resolvedPath, cwd);

  const [node, npm, bun, yarn, pnpm, python, rust, go, git, tsx, tsNode, playwright] = await Promise.all([
    tv('node --version'),
    tv('npm --version'),
    tv('bun --version'),
    tv('yarn --version'),
    tv('pnpm --version'),
    tv('python3 --version').then(v => v ?? tv('python --version')),
    tv('rustc --version'),
    tv('go version'),
    tv('git --version'),
    // tsx — the correct way to run .ts files without a global install
    tv('npx --yes tsx --version').then(v => v ?? tv('tsx --version')),
    // ts-node — legacy, prefer tsx
    tv('npx ts-node --version').then(v => v ?? tv('ts-node --version')),
    // Playwright
    tv('npx playwright --version').then(v => v ?? tv('playwright --version')),
  ]);

  // Detect project lockfile — lockfile takes priority over installed PM versions
  let detectedLockfile: EnvironmentInfo['detectedLockfile'] = null;
  let projectScripts: Record<string, string> | null = null;
  if (cwd) {
    try {
      const lockfileChecks = await Promise.all([
        executeCommand(`test -f package-lock.json && echo yes || echo no`, cwd),
        executeCommand(`test -f pnpm-lock.yaml && echo yes || echo no`, cwd),
        executeCommand(`test -f yarn.lock && echo yes || echo no`, cwd),
        executeCommand(`test -f bun.lockb && echo yes || echo no`, cwd),
        executeCommand(`test -f bun.lock && echo yes || echo no`, cwd),
      ]);
      if (lockfileChecks[0].stdout?.trim() === 'yes') detectedLockfile = 'package-lock.json';
      else if (lockfileChecks[1].stdout?.trim() === 'yes') detectedLockfile = 'pnpm-lock.yaml';
      else if (lockfileChecks[2].stdout?.trim() === 'yes') detectedLockfile = 'yarn.lock';
      else if (lockfileChecks[3].stdout?.trim() === 'yes') detectedLockfile = 'bun.lockb';
      else if (lockfileChecks[4].stdout?.trim() === 'yes') detectedLockfile = 'bun.lock';
    } catch { /* non-fatal */ }

    try {
      const pkgResult = await executeCommand(`cat package.json 2>/dev/null | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(JSON.stringify(d.scripts||{}))}catch{console.log('{}')}"`, cwd);
      if (pkgResult.code === 0 && pkgResult.stdout?.trim()) {
        const parsed = JSON.parse(pkgResult.stdout.trim());
        if (parsed && typeof parsed === 'object') projectScripts = parsed as Record<string, string>;
      }
    } catch { /* non-fatal */ }
  }

  // Decide preferred package manager: lockfile WINS over installed versions
  let packageManager: EnvironmentInfo['packageManager'] = null;
  if (detectedLockfile === 'pnpm-lock.yaml') packageManager = 'pnpm';
  else if (detectedLockfile === 'yarn.lock') packageManager = 'yarn';
  else if (detectedLockfile === 'bun.lockb' || detectedLockfile === 'bun.lock') packageManager = 'bun';
  else if (detectedLockfile === 'package-lock.json') packageManager = 'npm';
  // Fallback to installed versions if no lockfile
  else if (bun) packageManager = 'bun';
  else if (pnpm) packageManager = 'pnpm';
  else if (yarn) packageManager = 'yarn';
  else if (npm) packageManager = 'npm';

  const parts: string[] = [];
  if (chipModel) parts.push(chipModel);
  else if (osName && archName) parts.push(`${osName}/${archName}`);
  if (node) parts.push(`Node ${node}`);
  if (packageManager) parts.push(`${packageManager} ${bun ?? pnpm ?? yarn ?? npm}`);
  if (python) parts.push(`Python ${python}`);
  if (rust) parts.push(`Rust ${rust}`);
  if (go) parts.push(`Go ${go}`);
  if (git) parts.push(`Git ${git}`);
  if (tsx) parts.push('tsx');
  if (playwright) parts.push('playwright');

  const summary = parts.length > 0 ? parts.join(' · ') : 'No tools detected';

  return {
    nodeVersion: node,
    npmVersion: npm,
    bunVersion: bun,
    yarnVersion: yarn,
    pnpmVersion: pnpm,
    pythonVersion: python,
    rustVersion: rust,
    goVersion: go,
    gitVersion: git,
    tsxAvailable: !!tsx,
    tsNodeAvailable: !!tsNode,
    playwrightAvailable: !!playwright,
    packageManager,
    detectedLockfile,
    projectScripts,
    os: osName,
    arch: archName,
    chipModel,
    summary,
  };
}

const CODESCOUT_DIR = '.codescout';
const ENVIRONMENT_FILE = 'environment.json';

/**
 * Persist the probed environment to `.codescout/environment.json`.
 * Called by the orchestrator after a successful probe — NOT by the probe itself.
 * Renamed from writeEnvironmentToDisk to make clear it is a caller responsibility.
 */
export async function writeEnvironmentCache(projectPath: string, env: EnvironmentInfo): Promise<void> {
  if (!projectPath) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const sep = projectPath.includes('\\') ? '\\' : '/';
    const dirPath = `${projectPath}${sep}${CODESCOUT_DIR}`;
    const filePath = `${dirPath}${sep}${ENVIRONMENT_FILE}`;
    try { await invoke('create_dir', { path: dirPath }); } catch { /* already exists */ }
    const payload = {
      _comment: 'Auto-generated by Code Scout — system environment detected at project open time',
      os: env.os,
      arch: env.arch,
      chipModel: env.chipModel,
      nodeVersion: env.nodeVersion,
      npmVersion: env.npmVersion,
      bunVersion: env.bunVersion,
      yarnVersion: env.yarnVersion,
      pnpmVersion: env.pnpmVersion,
      pythonVersion: env.pythonVersion,
      rustVersion: env.rustVersion,
      goVersion: env.goVersion,
      gitVersion: env.gitVersion,
      tsxAvailable: env.tsxAvailable,
      tsNodeAvailable: env.tsNodeAvailable,
      playwrightAvailable: env.playwrightAvailable,
      packageManager: env.packageManager,
      detectedLockfile: env.detectedLockfile,
      projectScripts: env.projectScripts,
      detectedAt: new Date().toISOString(),
    };
    await invoke('write_file', { path: filePath, content: JSON.stringify(payload, null, 2) });
  } catch (e) {
    console.warn('[environmentProbe] failed to write .codescout/environment.json:', e);
  }
}

/**
 * Read the persisted environment from disk and return it, or null if missing/stale.
 * Re-probe triggers when: file missing, chipModel absent (pre-fix schema), or data > 4h old.
 */
export async function readOrReprobeEnvironment(
  projectPath: string,
): Promise<EnvironmentInfo | null> {
  if (!projectPath) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const s = projectPath.includes('\\') ? '\\' : '/';
    const filePath = `${projectPath}${s}${CODESCOUT_DIR}${s}${ENVIRONMENT_FILE}`;
    const raw = await invoke<string>('read_file_text', { path: filePath });
    const data = JSON.parse(raw);
    const detectedAt = data.detectedAt ? new Date(data.detectedAt).getTime() : 0;
    const ageMs = Date.now() - detectedAt;
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const isStale = ageMs > FOUR_HOURS || !data.chipModel;
    if (isStale) return null; // caller should re-probe
    // Back-fill new fields with safe defaults when loading older cached data
    return {
      tsxAvailable: false,
      tsNodeAvailable: false,
      playwrightAvailable: false,
      detectedLockfile: null,
      projectScripts: null,
      ...data,
    } as EnvironmentInfo;
  } catch {
    return null;
  }
}

/** Format environment info into a compact block for injection into the system prompt. */
export function formatEnvForPrompt(env: EnvironmentInfo): string {
  const lines: string[] = ['## Runtime environment (detected on user\'s machine)'];

  if (env.chipModel) {
    lines.push(`- Chip: ${env.chipModel}`);
  }
  if (env.os || env.arch) {
    lines.push(`- Platform: ${env.os ?? 'unknown'} / ${env.arch ?? 'unknown'}`);
    lines.push('  NOTE: All shell commands, package installs, and binary choices must be compatible with this exact OS and CPU architecture.');
  }
  if (env.nodeVersion) lines.push(`- Node.js: ${env.nodeVersion}`);
  if (env.npmVersion) lines.push(`- npm: ${env.npmVersion}`);
  if (env.bunVersion) lines.push(`- bun: ${env.bunVersion}`);
  if (env.yarnVersion) lines.push(`- yarn: ${env.yarnVersion}`);
  if (env.pnpmVersion) lines.push(`- pnpm: ${env.pnpmVersion}`);
  if (env.pythonVersion) lines.push(`- Python: ${env.pythonVersion}`);
  if (env.rustVersion) lines.push(`- Rust: ${env.rustVersion}`);
  if (env.goVersion) lines.push(`- Go: ${env.goVersion}`);
  if (env.gitVersion) lines.push(`- Git: ${env.gitVersion}`);

  // Script runner availability — critical for TypeScript execution
  lines.push('');
  lines.push('### Available script runners');
  lines.push(`- tsx (TypeScript runner): ${env.tsxAvailable ? 'YES — use \`npx tsx FILE.ts\` to run TypeScript files' : 'available via npx — always use \`npx tsx FILE.ts\` for TypeScript'}`);
  lines.push(`- ts-node: ${env.tsNodeAvailable ? 'installed (but prefer tsx)' : 'NOT installed — do not use ts-node'}`);
  lines.push(`- Playwright: ${env.playwrightAvailable ? 'installed' : 'NOT installed — run \`npx playwright install\` first if needed'}`);

  if (env.detectedLockfile) {
    lines.push('');
    lines.push(`### Project lockfile detected: \`${env.detectedLockfile}\``);
  }

  if (env.packageManager) {
    lines.push('');
    lines.push(`**Preferred package manager: ${env.packageManager}**`);
    const reason = env.detectedLockfile ? `(lockfile \`${env.detectedLockfile}\` detected)` : '(installed version)';
    lines.push(`IMPORTANT: Use \`${env.packageManager}\` ${reason} for all install and run commands.`);
  } else if (!env.nodeVersion) {
    lines.push('');
    lines.push('WARNING: No Node.js detected. Do not generate npm/node steps unless Node is confirmed available.');
  }

  if (env.projectScripts && Object.keys(env.projectScripts).length > 0) {
    lines.push('');
    lines.push('### package.json scripts (use these exact names)');
    for (const [name, cmd] of Object.entries(env.projectScripts)) {
      lines.push(`- \`${env.packageManager ?? 'npm'} run ${name}\` → ${cmd}`);
    }
  }

  return lines.join('\n');
}

/**
 * Select the best package manager for a project given environment info.
 * Priority: lockfile (definitive) > installed PM > npm fallback.
 *
 * Use this everywhere a command needs to decide which PM to call
 * so the choice is consistent across chat, repair, planner, and coder.
 */
export function selectPackageManager(env: EnvironmentInfo | null | undefined): string {
  if (!env) return 'npm';
  // Lockfile is definitive — the project committed to this PM
  if (env.detectedLockfile === 'pnpm-lock.yaml') return 'pnpm';
  if (env.detectedLockfile === 'yarn.lock') return 'yarn';
  if (env.detectedLockfile === 'bun.lockb' || env.detectedLockfile === 'bun.lock') return 'bun';
  if (env.detectedLockfile === 'package-lock.json') return 'npm';
  // Fall back to installed versions
  return env.packageManager ?? 'npm';
}

/**
 * Select the correct runner for a TypeScript file given env info.
 * Always returns "npx tsx" — tsx works via npx even without global install.
 * Never returns "ts-node" since it requires a separate global install.
 */
export function selectTsRunner(_env?: EnvironmentInfo | null): string {
  return 'npx tsx';
}
