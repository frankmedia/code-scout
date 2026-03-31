/**
 * installTracker.ts
 *
 * Records every package installation to .codescout/installs.json so future
 * agent sessions can learn what was tried, what worked, and what failed.
 * Integrated into agentExecutor after every successful install command, and
 * exposed via buildInstallContext for injecting history into plan generation.
 */

// Uses Tauri v2 invoke pattern — same as memoryManager.ts and environmentProbe.ts.
// No @tauri-apps/api/fs or @tauri-apps/api/path — those are Tauri v1 APIs.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstallRecord {
  id: string;
  timestamp: string;
  command: string;
  packages: string[];
  exitCode: number;
  success: boolean;
  /** Last 2000 chars of stdout */
  stdout: string;
  /** Last 2000 chars of stderr */
  stderr: string;
  /** How many retries were needed (e.g. --omit=optional, --force) */
  retries: number;
  /** What ultimately fixed it if it initially failed */
  resolution?: string;
  stepId: string;
  taskGoal: string;
}

// ─── Detection ────────────────────────────────────────────────────────────────

const INSTALL_PATTERNS = [
  /^npm\s+(install|i|add)\b/i,
  /^npx\s+.*(install|add)\b/i,
  /^yarn\s+(install|add)\b/i,
  /^pnpm\s+(install|add|i)\b/i,
  /^bun\s+(install|add|i)\b/i,
  /^pip\s+(install)\b/i,
  /^pip3\s+(install)\b/i,
  /^cargo\s+(add|install)\b/i,
  /^go\s+(get|install)\b/i,
  /^gem\s+(install)\b/i,
  /^brew\s+(install)\b/i,
];

/** Returns true if the command is a package installation command. */
export function isInstallCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  return INSTALL_PATTERNS.some(p => p.test(trimmed));
}

/** Extract individual package names from an install command. */
export function parsePackagesFromCommand(cmd: string): string[] {
  const trimmed = cmd.trim();

  // Strip common flags
  const withoutFlags = trimmed
    .replace(/--[\w-]+=?\S*/g, '')
    .replace(/-[a-zA-Z]+/g, '')
    .trim();

  // Remove the manager + verb (e.g. "npm install", "pip install", "cargo add")
  const withoutVerb = withoutFlags
    .replace(/^(npm|npx|yarn|pnpm|bun)\s+(install|i|add|ci)\s*/i, '')
    .replace(/^(pip3?|cargo|go|gem|brew)\s+(install|add|get)\s*/i, '')
    .trim();

  return withoutVerb
    .split(/\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('-') && !s.startsWith('@types/') || s.startsWith('@'));
}

// ─── Record construction ──────────────────────────────────────────────────────

/** Build an InstallRecord from the outcome of a completed install command. */
export function buildInstallRecord(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  retries: number,
  stepId: string,
  taskGoal: string,
  resolution?: string,
): InstallRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    command,
    packages: parsePackagesFromCommand(command),
    exitCode,
    success: exitCode === 0,
    stdout: (stdout ?? '').slice(-2000),
    stderr: (stderr ?? '').slice(-2000),
    retries,
    resolution,
    stepId,
    taskGoal,
  };
}

// ─── Disk I/O ─────────────────────────────────────────────────────────────────

const CODESCOUT_DIR = '.codescout';
const INSTALLS_FILE = 'installs.json';
const MAX_RECORDS = 200;

function sep(root: string): string {
  return root.includes('\\') ? '\\' : '/';
}

/** Write an InstallRecord to .codescout/installs.json in the project root. */
export async function recordInstall(record: InstallRecord, projectRoot: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  const s = sep(projectRoot);
  const dir = `${projectRoot}${s}${CODESCOUT_DIR}`;
  const file = `${dir}${s}${INSTALLS_FILE}`;

  try { await invoke('create_dir', { path: dir }); } catch { /* already exists */ }

  let history: InstallRecord[] = [];
  try {
    const raw = await invoke<string>('read_file_text', { path: file });
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) history = parsed;
  } catch {
    // File doesn't exist yet — start fresh
  }

  history.push(record);

  // Keep the most recent MAX_RECORDS entries
  if (history.length > MAX_RECORDS) {
    history = history.slice(history.length - MAX_RECORDS);
  }

  await invoke('write_file', { path: file, content: JSON.stringify(history, null, 2) });
}

/** Read the install history from .codescout/installs.json. */
export async function readInstallHistory(projectRoot: string): Promise<InstallRecord[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  const s = sep(projectRoot);
  const file = `${projectRoot}${s}${CODESCOUT_DIR}${s}${INSTALLS_FILE}`;
  try {
    const raw = await invoke<string>('read_file_text', { path: file });
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Context builder for prompts ─────────────────────────────────────────────

/**
 * Build a concise, prompt-ready summary of past installations for the given project.
 * Returns undefined if there's no history or it's trivially empty.
 */
export async function buildInstallContext(projectRoot: string): Promise<string | undefined> {
  const history = await readInstallHistory(projectRoot);
  if (history.length === 0) return undefined;

  const recent = history.slice(-30); // last 30 installs
  const lines: string[] = [
    `INSTALL HISTORY (last ${recent.length} installations in this project):`,
  ];

  for (const r of recent) {
    const status = r.success ? '✓' : '✗';
    const pkg = r.packages.length > 0 ? r.packages.join(', ') : r.command.slice(0, 60);
    const note = r.resolution ? ` [fixed via: ${r.resolution}]` : '';
    const retries = r.retries > 0 ? ` (${r.retries} retries needed)` : '';
    lines.push(`  ${status} ${pkg}${retries}${note}`);
  }

  const failures = history.filter(r => !r.success);
  if (failures.length > 0) {
    lines.push('');
    lines.push('KNOWN FAILURES (avoid repeating these approaches):');
    for (const f of failures.slice(-10)) {
      lines.push(`  ✗ ${f.command.slice(0, 100)}`);
      if (f.stderr) lines.push(`    Error: ${f.stderr.slice(0, 200)}`);
    }
  }

  return lines.join('\n');
}
