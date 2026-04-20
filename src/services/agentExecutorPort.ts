/**
 * agentExecutorPort.ts
 *
 * Port management, dev-server detection, and repair command execution.
 */

import { executeCommand } from '@/lib/tauri';
import { isBackgroundCommand } from './pathResolution';
import { getLongRunningCommandTimeoutMs } from './agentCommandTimeouts';

// ─── Constants ──────────────────────────────────────────────────────────────

export const BACKGROUND_SETTLE_MS_EXPORT = 6_000;

// ─── Dev server port detection ──────────────────────────────────────────────

/**
 * Guess which port a dev-server command will bind to.
 * Checks: explicit --port flag, vite.config content, then framework defaults.
 */
export function detectDevServerPort(cmd: string, viteConfigContent?: string): number | null {
  const portFlag = cmd.match(/--port[=\s]+(\d{2,5})/);
  if (portFlag) return parseInt(portFlag[1], 10);

  if (viteConfigContent) {
    const cfgPort = viteConfigContent.match(/server\s*:\s*\{[^}]*port\s*:\s*(\d{2,5})/);
    if (cfgPort) return parseInt(cfgPort[1], 10);
  }

  if (/\bnext\b/.test(cmd)) return 3000;
  if (/\bnuxt\b/.test(cmd)) return 3000;
  if (/react-scripts/.test(cmd)) return 3000;
  if (/\bexpo\b/.test(cmd)) return 19000;
  if (/python.*-m\s+http\.server/.test(cmd)) return 8000;
  if (/uvicorn|gunicorn|flask/.test(cmd)) return 8000;
  if (isBackgroundCommand(cmd)) return 5173;

  return null;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export type SimpleCallbacks = {
  onLog: (msg: string, type: 'info' | 'warning' | 'success' | 'error') => void;
  onTerminal: (line: string) => void;
};

// ─── Port management ────────────────────────────────────────────────────────

/**
 * If a process is already bound to `port`, kill it AND its parent process
 * group so the new dev server can claim the port cleanly.
 * Returns true if something was killed.
 */
export async function freePortIfOccupied(
  port: number,
  cwd: string | undefined,
  callbacks: SimpleCallbacks,
  /** Optional hint: subdirectory name to kill related Electron processes */
  projectHint?: string,
): Promise<boolean> {
  try {
    const check = await executeCommand(`lsof -ti :${port} 2>/dev/null`, cwd);
    const pids = check.stdout.trim();

    let killed = false;

    if (pids) {
      callbacks.onLog(`Port ${port} occupied by PID(s) ${pids} — stopping old server`, 'warning');
      callbacks.onTerminal(`⚠ Port ${port} in use (PID ${pids}) — stopping old process...`);

      const killScript = [
        `for PID in ${pids}; do`,
        `  kill -9 $PID 2>/dev/null`,
        `  PPID=$(ps -o ppid= -p $PID 2>/dev/null | tr -d ' ')`,
        `  [ -n "$PPID" ] && [ "$PPID" != "1" ] && kill -9 $PPID 2>/dev/null || true`,
        `  pkill -P $PID 2>/dev/null || true`,
        `done`,
      ].join('; ');

      await executeCommand(killScript, cwd);
      killed = true;
    }

    if (projectHint) {
      const safe = projectHint.replace(/[^a-zA-Z0-9_-]/g, '');
      if (safe) {
        const elCheck = await executeCommand(
          `pgrep -lf "Electron.*${safe}" 2>/dev/null || pgrep -lf "${safe}.*Electron" 2>/dev/null || true`,
          cwd,
        );
        if (elCheck.stdout.trim()) {
          callbacks.onTerminal(`⚠ Closing old Electron window for ${safe}...`);
          await executeCommand(
            `pkill -f "Electron.*${safe}" 2>/dev/null; pkill -f "${safe}.*Electron" 2>/dev/null; true`,
            cwd,
          );
          killed = true;
        }
      }
    }

    if (killed) {
      await executeCommand('sleep 0.8', cwd);
      callbacks.onTerminal(`✓ Cleared — starting new server`);
    }
    return killed;
  } catch {
    return false;
  }
}

// ─── Repair command execution ───────────────────────────────────────────────

export async function executeRepairCommand(
  cmd: string,
  cwd: string | undefined,
): Promise<Awaited<ReturnType<typeof executeCommand>>> {
  return executeCommand(cmd, cwd, {
    timeoutMs: getLongRunningCommandTimeoutMs(),
  });
}
