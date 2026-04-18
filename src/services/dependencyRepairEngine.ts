/**
 * dependencyRepairEngine.ts
 *
 * Single owner of all dependency repair logic.
 * Uses evidence-gated persistence: the loop continues as long as each round
 * adds new information. It stops only when it can prove it is repeating itself.
 *
 * Responsibilities:
 *   1. Maintain a repair ledger with progress tracking per attempt
 *   2. Decide the next repair action using progress-gated continuation
 *   3. Enforce wall-clock + absolute attempt cap (no dumb fingerprint hard-stop)
 *   4. Escalate to search / PM reassessment / LLM / user in priority order
 *   5. Pass the full ledger to the LLM so it never repeats what already failed
 *
 * NOT a responsibility of this module:
 *   - Executing commands (done by agentExecutor)
 *   - Writing .npmrc or mutating node_modules
 *   - LLM calls or web searches (the caller handles those after receiving the action)
 */

import type {
  FailureFingerprint,
  RepairAttempt,
  RepairLedger,
  RepairAction,
  RepairProgress,
  StrategyFamily,
  PackageManager,
} from './repairTypes';

// ─── Configuration ────────────────────────────────────────────────────────────

export interface RepairEngineConfig {
  /** Max deterministic (non-LLM) repair attempts before escalating to LLM. Default: 2 */
  maxDeterministicAttempts: number;
  /** Absolute max attempts including all kinds. Default: 10 */
  maxTotalAttempts: number;
  /** Wall-clock budget in ms. Default: 600_000 (10 min) */
  wallClockBudgetMs: number;
  /**
   * How many consecutive zero-progress rounds before forcing a source change.
   * Default: 2. After this, the engine must escalate_to_search, run_pm_reassessment,
   * or escalate_to_user — it cannot keep running the same family of strategies.
   */
  maxZeroProgressRounds: number;
}

const DEFAULT_CONFIG: RepairEngineConfig = {
  maxDeterministicAttempts: 2,
  maxTotalAttempts: 10,
  wallClockBudgetMs: 600_000,
  maxZeroProgressRounds: 2,
};

// ─── Ledger management ────────────────────────────────────────────────────────

const _ledgerConfigs = new WeakMap<RepairLedger, RepairEngineConfig>();

export function createRepairLedger(
  stepId: string,
  config?: Partial<RepairEngineConfig>,
): RepairLedger {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const ledger: RepairLedger = {
    stepId,
    attempts: [],
    startedAt: new Date().toISOString(),
    wallClockBudgetMs: cfg.wallClockBudgetMs,
    webSearchDone: false,
    pmReassessmentDone: false,
    strategiesTried: new Set(),
    lastFingerprint: null,
    zeroProgressRounds: 0,
  };
  _ledgerConfigs.set(ledger, cfg);
  return ledger;
}

export function recordAttempt(ledger: RepairLedger, attempt: RepairAttempt): void {
  ledger.attempts.push(attempt);
  ledger.strategiesTried.add(attempt.strategyFamily);
  ledger.lastFingerprint = attempt.fingerprint.errorSignature;
  if (attempt.progressScore === 0) {
    ledger.zeroProgressRounds += 1;
  } else {
    ledger.zeroProgressRounds = 0;
  }
}

export function shouldStop(ledger: RepairLedger): { stop: boolean; reason?: string } {
  const cfg = _ledgerConfigs.get(ledger) ?? DEFAULT_CONFIG;

  const elapsed = Date.now() - new Date(ledger.startedAt).getTime();
  if (elapsed > ledger.wallClockBudgetMs) {
    const mins = Math.round(elapsed / 60_000);
    return { stop: true, reason: `Repair budget exhausted after ${mins} minute${mins !== 1 ? 's' : ''}.` };
  }

  if (ledger.attempts.length >= cfg.maxTotalAttempts) {
    return { stop: true, reason: `Maximum repair attempts (${cfg.maxTotalAttempts}) reached.` };
  }

  return { stop: false };
}

/**
 * Extend the repair budget after user intervention (continue / hint / replan).
 */
export function bumpBudget(ledger: RepairLedger, extraAttempts: number): void {
  const cfg = _ledgerConfigs.get(ledger);
  if (cfg) {
    cfg.maxTotalAttempts += extraAttempts;
  }
  // Reset all escalation gates so the engine goes through the full evidence cycle again
  // before re-escalating to the user. Without this, webSearchDone/pmReassessmentDone
  // staying true causes immediate re-escalation after just 2 more zero-progress rounds.
  ledger.zeroProgressRounds = 0;
  ledger.webSearchDone = false;
  ledger.pmReassessmentDone = false;
}

/**
 * Compute progress score for the current iteration.
 * Each dimension that shows new evidence contributes 1 point.
 * Score 0 means the agent is learning nothing new.
 */
export function computeProgress(
  ledger: RepairLedger,
  currentFingerprint: FailureFingerprint,
  currentFamily: StrategyFamily,
  newSearchSources: number,
): RepairProgress {
  const fingerprintChanged = ledger.lastFingerprint !== null &&
    ledger.lastFingerprint !== currentFingerprint.errorSignature;
  const pmChanged = ledger.attempts.length > 0 &&
    ledger.attempts[ledger.attempts.length - 1].packageManager !== currentFingerprint.packageManager;
  const newStrategyFamily = !ledger.strategiesTried.has(currentFamily);
  const repoStateChanged = fingerprintChanged;

  const score =
    (fingerprintChanged ? 1 : 0) +
    (pmChanged ? 1 : 0) +
    (newStrategyFamily ? 1 : 0) +
    newSearchSources +
    (repoStateChanged ? 1 : 0);

  return { fingerprintChanged, pmChanged, newStrategyFamily, newSearchSources, repoStateChanged, score };
}

/** Returns how many times a given strategy has been tried in this ledger. */
function strategyCount(ledger: RepairLedger, strategyId: string): number {
  return ledger.attempts.filter(a => a.strategyId === strategyId).length;
}

/** Count how many deterministic (non-LLM, non-search) attempts have been made. */
function deterministicCount(ledger: RepairLedger): number {
  return ledger.attempts.filter(a => a.strategyFamily === 'local_deterministic').length;
}

// ─── Human-readable ledger summary for LLM prompts ───────────────────────────

export function formatLedgerForPrompt(ledger: RepairLedger): string {
  if (ledger.attempts.length === 0) return 'No repair attempts made yet.';

  const lines = [`REPAIR HISTORY for step "${ledger.stepId}" (${ledger.attempts.length} attempt${ledger.attempts.length !== 1 ? 's' : ''}):`];
  for (const [i, a] of ledger.attempts.entries()) {
    const ts = new Date(a.timestamp).toISOString().slice(11, 19);
    const status = a.result === 'success' ? '✓' : a.result === 'cancelled' ? '⊘' : '✗';
    lines.push(`  ${i + 1}. [${ts}] ${status} [${a.strategyId}] ${a.command.slice(0, 100)}`);
    if (a.result === 'failed' && a.errorSnippet) {
      lines.push(`     Error: ${a.errorSnippet.slice(0, 120)}`);
    }
  }
  lines.push('');
  lines.push('DO NOT suggest any strategy that appears in the list above. Use a completely different approach.');
  return lines.join('\n');
}

// ─── Package-manager-specific command builders ────────────────────────────────

function stripInstallFlags(cmd: string): string {
  return cmd
    .replace(/\s*--omit[= -]optional\b/g, '')
    .replace(/\s*--ignore-optional\b/g, '')
    .replace(/\s*--no-package-lock\b/g, '')
    .replace(/\s*--legacy-peer-deps\b/g, '')
    .replace(/\s*--no-optional\b/g, '')
    .replace(/\s*--force\b/g, '')
    .replace(/\s*--ignore-scripts\b/g, '')
    .trimEnd();
}

interface RepairCommandResult {
  command: string;
  env?: Record<string, string>;
  strategyId: string;
}

function buildBadPlatformRepair(
  originalCommand: string,
  packageManager: PackageManager,
  attemptNumber: number,
  arch: string | null,
): RepairCommandResult | null {
  const base = stripInstallFlags(originalCommand);

  switch (packageManager) {
    case 'npm':
    case null: {
      if (attemptNumber === 1) {
        return { command: `${base} --omit=optional --ignore-optional --no-package-lock`, strategyId: 'npm-bad-platform-pass1' };
      }
      if (attemptNumber === 2) {
        return {
          command: `${base} --omit=optional --ignore-optional --no-package-lock`,
          env: arch === 'arm64' ? { npm_config_arch: 'arm64' } : undefined,
          strategyId: 'npm-bad-platform-pass2-arch-env',
        };
      }
      return null;
    }
    case 'pnpm':
      if (attemptNumber === 1) return { command: `${base} --no-optional`, strategyId: 'pnpm-bad-platform-pass1' };
      return null;
    case 'yarn':
      if (attemptNumber === 1) return { command: `${base} --ignore-optional`, strategyId: 'yarn-bad-platform-pass1' };
      return null;
    case 'bun':
      return null;
  }
}

function buildMissingBindingRepair(
  failingPackage: string | null,
  packageManager: PackageManager,
  attemptNumber: number,
  arch: string | null,
  os: string | null,
): RepairCommandResult | null {
  const pm = packageManager ?? 'npm';
  const archEnv = arch === 'arm64' ? { npm_config_arch: 'arm64' } : undefined;

  if (attemptNumber === 1) {
    const lockfile = pm === 'pnpm' ? 'pnpm-lock.yaml'
      : pm === 'yarn' ? 'yarn.lock'
      : pm === 'bun' ? 'bun.lockb'
      : 'package-lock.json';
    const rmCmd = os === 'win32'
      ? `rmdir /s /q node_modules && del ${lockfile}`
      : `rm -rf node_modules ${lockfile}`;
    const installCmd = pm === 'pnpm' ? 'pnpm install'
      : pm === 'yarn' ? 'yarn install'
      : pm === 'bun' ? 'bun install'
      : 'npm install';
    return {
      command: `${rmCmd} && ${installCmd}`,
      env: archEnv,
      strategyId: `${pm}-clean-reinstall-native-binding`,
    };
  }

  if (attemptNumber === 2 && failingPackage && pm === 'npm') {
    let arm64Pkg = failingPackage;
    if (/-darwin-x64/.test(failingPackage)) {
      arm64Pkg = failingPackage.replace(/-darwin-x64/g, '-darwin-arm64').replace(/^.*node_modules\//, '');
    } else if (/\.darwin-arm64\.node$/.test(failingPackage)) {
      const m = failingPackage.match(/[./]*([\w-]+)\.darwin-arm64\.node$/);
      if (m) arm64Pkg = `${m[1]}-darwin-arm64`;
    } else if (arch === 'arm64' && !/-darwin-arm64/.test(failingPackage)) {
      arm64Pkg = failingPackage.replace(/darwin(?!-arm64)/g, 'darwin-arm64');
    }
    return {
      command: `npm install ${arm64Pkg} --no-save`,
      env: archEnv,
      strategyId: `npm-install-binding-${arm64Pkg.slice(0, 40)}`,
    };
  }

  return null;
}

function buildMissingDepRepair(
  failingPackage: string | null,
  packageManager: PackageManager,
  attemptNumber: number,
): RepairCommandResult | null {
  if (!failingPackage) return null;
  if (attemptNumber !== 1) return null;

  const pm = packageManager ?? 'npm';
  switch (pm) {
    case 'npm': return { command: `npm install ${failingPackage}`, strategyId: `npm-install-missing-${failingPackage.slice(0, 40)}` };
    case 'pnpm': return { command: `pnpm add ${failingPackage}`, strategyId: `pnpm-add-missing-${failingPackage.slice(0, 40)}` };
    case 'yarn': return { command: `yarn add ${failingPackage}`, strategyId: `yarn-add-missing-${failingPackage.slice(0, 40)}` };
    case 'bun': return { command: `bun add ${failingPackage}`, strategyId: `bun-add-missing-${failingPackage.slice(0, 40)}` };
  }
  return null;
}

function buildPeerDepRepair(
  originalCommand: string,
  packageManager: PackageManager,
  attemptNumber: number,
): RepairCommandResult | null {
  if (attemptNumber !== 1) return null;
  const base = stripInstallFlags(originalCommand);
  switch (packageManager ?? 'npm') {
    case 'npm': return { command: `${base} --legacy-peer-deps`, strategyId: 'npm-peer-dep-legacy' };
    case 'pnpm': return { command: `${base} --resolution-only`, strategyId: 'pnpm-peer-dep-resolution' };
    default: return null;
  }
}

/**
 * A project binary (vite, tsc, webpack, etc.) was not found — node_modules is
 * missing or corrupted. The deterministic fix is to reinstall dependencies.
 * This is different from a PM binary missing (which is handled via exit 127 in agentExecutor).
 */
function buildCommandNotFoundRepair(
  missingBin: string | null,
  packageManager: PackageManager,
  attemptNumber: number,
): RepairCommandResult | null {
  const pm = packageManager ?? 'npm';

  // Package manager binaries themselves are handled via exit-127 detection in agentExecutor.
  // If the missing binary IS a PM, skip — that's an infrastructure problem, not a node_modules problem.
  const isPmBinary = missingBin && /^(npm|pnpm|yarn|bun|node)$/.test(missingBin);
  if (isPmBinary) return null;

  if (attemptNumber === 1) {
    const installCmd = pm === 'pnpm' ? 'pnpm install'
      : pm === 'yarn' ? 'yarn install'
      : pm === 'bun' ? 'bun install'
      : 'npm install';
    return {
      command: installCmd,
      strategyId: `${pm}-install-restore-node-modules`,
    };
  }

  if (attemptNumber === 2) {
    // Hard reinstall in case node_modules is partially corrupted
    const lockfile = pm === 'pnpm' ? 'pnpm-lock.yaml'
      : pm === 'yarn' ? 'yarn.lock'
      : pm === 'bun' ? 'bun.lockb'
      : 'package-lock.json';
    return {
      command: `rm -rf node_modules ${lockfile} && npm install`,
      strategyId: 'npm-clean-reinstall-node-modules',
    };
  }

  return null;
}

// ─── Search query builder ─────────────────────────────────────────────────────

/**
 * Build a targeted web search query from the failure fingerprint and environment.
 * Produces a query like: "missing_native_binding @rolldown/binding-darwin-arm64 darwin arm64 npm"
 */
export function buildRepairSearchQuery(
  failure: FailureFingerprint,
  context: RepairContext,
): string {
  const parts = [
    failure.failingPackage ?? failure.errorSignature.split(':').slice(0, 2).join(' '),
    context.os ?? '',
    context.arch ?? '',
    context.packageManager ?? '',
  ].filter(Boolean);
  return parts.join(' ').slice(0, 200);
}

// ─── Main decision function ───────────────────────────────────────────────────

export interface RepairContext {
  packageManager: PackageManager;
  arch: string | null;
  os: string | null;
  lockfilePresent: boolean;
  projectPath: string;
  originalCommand: string;
}

/**
 * Given the current ledger and failure fingerprint, return the next repair action.
 *
 * Decision order (evidence-gated persistence model):
 *   1. Hard stop conditions only (wall clock, absolute attempt cap)
 *   2. Zero-progress check — if stuck, escalate to search → PM reassessment → user
 *   3. Deterministic repair strategies
 *   4. LLM escalation (with or without search context)
 *   5. User escalation as last resort
 */
export function nextRepairAction(
  ledger: RepairLedger,
  failure: FailureFingerprint,
  context: RepairContext,
): RepairAction {
  const cfg = _ledgerConfigs.get(ledger) ?? DEFAULT_CONFIG;

  // ── Hard stop: only wall clock and absolute attempt cap ───────────────────
  const stop = shouldStop(ledger);
  if (stop.stop) {
    return { kind: 'stop', reason: stop.reason ?? 'Repair budget exhausted.' };
  }

  // ── Zero-progress gating ──────────────────────────────────────────────────
  // If we've had maxZeroProgressRounds consecutive rounds with no new evidence,
  // we must change source before attempting more of the same.
  if (ledger.zeroProgressRounds >= cfg.maxZeroProgressRounds) {
    if (!ledger.webSearchDone) {
      return {
        kind: 'escalate_to_search',
        query: buildRepairSearchQuery(failure, context),
      };
    }
    if (!ledger.pmReassessmentDone) {
      return {
        kind: 'run_pm_reassessment',
        reason: `Same error persisted after ${ledger.attempts.length} attempt(s). Re-assessing package manager from validation command.`,
      };
    }
    // All evidence sources tried — reset gates and force another web search before giving up.
    ledger.webSearchDone = false;
    ledger.pmReassessmentDone = false;
    ledger.zeroProgressRounds = 0;
    return {
      kind: 'escalate_to_search',
      query: buildRepairSearchQuery(failure, context),
    };
  }

  // ── Proactive early search for toolchain errors ───────────────────────────
  // Don't wait for zero progress — search immediately for errors where the
  // ecosystem (not the code) is the problem.
  const isToolchainError = (
    failure.category === 'missing_native_binding' ||
    failure.category === 'bad_platform' ||
    failure.category === 'command_not_found'
  );
  // For command_not_found, only trigger early search after deterministic repair was tried
  // (the first attempt is always npm install — search only if that didn't work)
  if (isToolchainError && !ledger.webSearchDone && deterministicCount(ledger) >= 1) {
    return {
      kind: 'escalate_to_search',
      query: buildRepairSearchQuery(failure, context),
    };
  }

  // ── Deterministic repair strategies by category ───────────────────────────
  const deterministicAttempts = deterministicCount(ledger);

  if (deterministicAttempts < cfg.maxDeterministicAttempts) {
    const nextAttempt = deterministicAttempts + 1;

    switch (failure.category) {
      case 'bad_platform': {
        const repair = buildBadPlatformRepair(
          context.originalCommand,
          context.packageManager ?? failure.packageManager,
          nextAttempt,
          context.arch,
        );
        if (repair && strategyCount(ledger, repair.strategyId) === 0) {
          return { kind: 'run_command', command: repair.command, strategyId: repair.strategyId, env: repair.env, strategyFamily: 'local_deterministic' };
        }
        break;
      }

      case 'missing_native_binding': {
        const repair = buildMissingBindingRepair(
          failure.failingPackage,
          context.packageManager ?? failure.packageManager,
          nextAttempt,
          context.arch,
          context.os,
        );
        if (repair && strategyCount(ledger, repair.strategyId) === 0) {
          return { kind: 'run_command', command: repair.command, strategyId: repair.strategyId, env: repair.env, strategyFamily: 'local_deterministic' };
        }
        break;
      }

      case 'missing_dependency': {
        const repair = buildMissingDepRepair(
          failure.failingPackage,
          context.packageManager ?? failure.packageManager,
          nextAttempt,
        );
        if (repair && strategyCount(ledger, repair.strategyId) === 0) {
          return { kind: 'run_command', command: repair.command, strategyId: repair.strategyId, strategyFamily: 'local_deterministic' };
        }
        break;
      }

      case 'peer_dep_conflict': {
        const repair = buildPeerDepRepair(
          context.originalCommand,
          context.packageManager ?? failure.packageManager,
          nextAttempt,
        );
        if (repair && strategyCount(ledger, repair.strategyId) === 0) {
          return { kind: 'run_command', command: repair.command, strategyId: repair.strategyId, strategyFamily: 'local_deterministic' };
        }
        break;
      }

      case 'command_not_found': {
        // A project binary (vite, tsc, webpack…) is missing — restore node_modules
        const repair = buildCommandNotFoundRepair(
          failure.failingPackage,
          context.packageManager ?? failure.packageManager,
          nextAttempt,
        );
        if (repair && strategyCount(ledger, repair.strategyId) === 0) {
          return { kind: 'run_command', command: repair.command, strategyId: repair.strategyId, strategyFamily: 'local_deterministic' };
        }
        break;
      }

      case 'timeout':
      case 'permission':
      case 'network':
      case 'npm_404':
      case 'build_error':
      case 'edit_not_applied':
      case 'lockfile_conflict':
      case 'user_input_required':
      case 'unknown':
        break;

      case 'none':
        return { kind: 'stop', reason: 'Validation passed — no repair needed.' };
    }
  }

  // ── Escalate to orchestrator after 3+ failed LLM attempts ─────────────────
  // If the coder model has tried 3+ times and keeps failing, the problem is
  // likely structural (wrong imports, missing files, bad project layout) —
  // not something a line-level fix can solve. Escalate to the orchestrator
  // which can see the full project, collect ALL errors, and create a
  // comprehensive fix plan.
  const llmAttempts = ledger.attempts.filter(
    a => a.strategyFamily === 'llm_targeted' || a.strategyFamily === 'llm_with_search',
  ).length;
  if (llmAttempts >= 3) {
    return {
      kind: 'escalate_to_orchestrator',
      context: formatLedgerForPrompt(ledger),
      strategyFamily: 'orchestrator_replan',
    };
  }

  // ── Escalate to LLM ───────────────────────────────────────────────────────
  const family: StrategyFamily = ledger.webSearchDone ? 'llm_with_search' : 'llm_targeted';
  return { kind: 'escalate_to_llm', context: formatLedgerForPrompt(ledger), strategyFamily: family };
}

// ─── Project-level mutex ──────────────────────────────────────────────────────

const _projectLocks = new Map<string, Promise<void>>();

export async function withProjectLock<T>(
  projectPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const existing = _projectLocks.get(projectPath);
  if (existing) await existing.catch(() => {});

  let releaseLock!: () => void;
  const lockPromise = new Promise<void>(resolve => { releaseLock = resolve; });
  _projectLocks.set(projectPath, lockPromise);

  try {
    return await fn();
  } finally {
    releaseLock();
    if (_projectLocks.get(projectPath) === lockPromise) {
      _projectLocks.delete(projectPath);
    }
  }
}
