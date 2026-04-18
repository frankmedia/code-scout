/**
 * repairTypes.ts
 *
 * Shared types for the unified dependency repair engine.
 * Used by dependencyRepairEngine, validationRunner, agentExecutor, and repairAgent.
 * Kept in a separate module to avoid circular imports.
 */

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | null;

export type FailureCategory =
  | 'none'
  | 'bad_platform'
  | 'missing_native_binding'
  | 'peer_dep_conflict'
  | 'missing_dependency'
  | 'lockfile_conflict'
  | 'command_not_found'
  | 'timeout'
  | 'network'
  | 'permission'
  | 'npm_404'
  | 'build_error'
  | 'edit_not_applied'   // verifier detected file content unchanged after an edit step
  | 'user_input_required'
  | 'unknown';

/**
 * Strategy family — broad category of what the repair is doing.
 * Used to detect when the system is repeating itself at a family level,
 * not just at the individual command level.
 */
export type StrategyFamily =
  | 'local_deterministic'   // rm lockfile, reinstall, flag changes
  | 'pm_switch'             // change package manager assumption
  | 'web_search'            // external evidence gathering (no attempt counter increment)
  | 'llm_targeted'          // LLM with local context only
  | 'llm_with_search'       // LLM with web search evidence
  | 'orchestrator_replan'   // full strategy replacement
  | 'user_hint';            // user-provided direction

/**
 * Per-iteration progress score.
 * Zero on every dimension = the agent is repeating itself and must change source.
 */
export interface RepairProgress {
  fingerprintChanged: boolean;
  pmChanged: boolean;
  newStrategyFamily: boolean;
  newSearchSources: number;
  repoStateChanged: boolean;
  /** Sum of all boolean/count contributions — 0 means no new evidence */
  score: number;
}

/**
 * Structured, semantically-normalized failure fingerprint.
 * Used to de-duplicate repair strategies and prevent the agent from
 * retrying approaches that have already been tried for the same root cause.
 */
export interface FailureFingerprint {
  category: FailureCategory;
  packageManager: PackageManager;
  /** e.g. "@rollup/rollup-darwin-x64" or "lightningcss" */
  failingPackage: string | null;
  /** e.g. "arm64" */
  arch: string | null;
  /** e.g. "darwin" */
  os: string | null;
  /** e.g. "package-lock.json" or "bun.lockb" */
  lockfile: string | null;
  /**
   * Normalized, deterministic error signature.
   * Derived from structured fields — NOT from raw first-400-chars.
   * Example: "bad_platform:npm:@rollup/rollup-darwin-x64:arm64"
   */
  errorSignature: string;
}

/** A single repair attempt entry in the repair ledger. */
export interface RepairAttempt {
  timestamp: string;
  /** Human-readable strategy identifier, e.g. "npm-omit-optional-pass1" */
  strategyId: string;
  command: string;
  packageManager: PackageManager;
  result: 'success' | 'failed' | 'cancelled';
  fingerprint: FailureFingerprint;
  /** Exit code from the repair command itself (not the build), null if it threw */
  exitCode: number | null;
  /** Last 500 chars of stderr from the repair attempt */
  errorSnippet: string;
  /** Broad strategy family — used to detect family-level repetition */
  strategyFamily: StrategyFamily;
  /** Progress score at the time this attempt was made */
  progressScore: number;
}

/**
 * Shared repair ledger for a single failing plan step.
 * Passed to all repair layers (deterministic engine + LLM) so every layer
 * can see exactly what was already tried.
 */
export interface RepairLedger {
  stepId: string;
  attempts: RepairAttempt[];
  /** ISO timestamp when repair started for this step */
  startedAt: string;
  /** Wall-clock budget in ms. Repair stops when elapsed > this. */
  wallClockBudgetMs: number;
  /** Whether a web search has been performed for this failure */
  webSearchDone: boolean;
  /** Whether a PM re-assessment from the validation command has been done */
  pmReassessmentDone: boolean;
  /** Strategy families already tried — used for progress gating */
  strategiesTried: Set<StrategyFamily>;
  /** Error signature from the previous iteration — for change detection */
  lastFingerprint: string | null;
  /** How many consecutive zero-progress rounds have occurred */
  zeroProgressRounds: number;
}

/**
 * The next action the repair engine wants to take.
 * Returned by nextRepairAction() and consumed by executePlan().
 */
export type RepairAction =
  | {
      kind: 'run_command';
      command: string;
      /** Human-readable strategy ID for ledger recording */
      strategyId: string;
      strategyFamily: StrategyFamily;
      /** Environment variables to set for this command only (not written to .npmrc) */
      env?: Record<string, string>;
    }
  | { kind: 'stop'; reason: string }
  | { kind: 'escalate_to_llm'; context: string; strategyFamily: StrategyFamily }
  | { kind: 'escalate_to_user'; context: string }
  | { kind: 'escalate_to_search'; query: string }
  | { kind: 'run_pm_reassessment'; reason: string }
  | { kind: 'escalate_to_orchestrator'; context: string; strategyFamily: 'orchestrator_replan' };

/** Canonical empty fingerprint for passing validations. */
export function noneFingerprint(): FailureFingerprint {
  return {
    category: 'none',
    packageManager: null,
    failingPackage: null,
    arch: null,
    os: null,
    lockfile: null,
    errorSignature: 'none',
  };
}
