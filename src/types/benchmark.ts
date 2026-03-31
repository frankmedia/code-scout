// ─── Test Categories ─────────────────────────────────────────────────────────

export type TestCategory = 'code-gen' | 'code-edit' | 'debug' | 'reasoning' | 'context' | 'tool-use';

export type ScoreCategory = TestCategory | 'speed' | 'cost';

// ─── Functional Test Infrastructure ─────────────────────────────────────────

export interface FunctionalTestCase {
  /** Full function call expression, e.g. "romanToInt('IV')" */
  call: string;
  /** JS expression for the expected return value, e.g. "4" or "[1,6]" */
  expected: string;
  /** Short description of what this case checks */
  description: string;
}

export interface FunctionalResult {
  passed: number;
  total: number;
  details: {
    description: string;
    passed: boolean;
    actual?: string;
    expected?: string;
    error?: string;
  }[];
}

// ─── Test Definition ─────────────────────────────────────────────────────────

export interface BenchmarkTest {
  id: string;
  category: TestCategory;
  name: string;
  description: string;
  /**
   * Why this test exists — tied to real-world coding benchmark methodology.
   * Shown in the Setup UI so users understand what they're measuring.
   */
  rationale: string;
  systemPrompt: string;
  userPrompt: string;
  /** Strings / regex patterns the scorer checks in the output (secondary signal). */
  evaluationHints: string[];
  /** How many hints must match for a passing score (defaults to half). */
  minHitsRequired?: number;
  /**
   * Runnable unit tests for functional correctness (primary signal).
   * Code is extracted from the model's output and executed against these cases.
   * Pass@1 = did the model get it right on the first try?
   */
  functionalTests?: FunctionalTestCase[];
  requiresTools?: boolean;
  /** Rough input token estimate (used to skip test if model context is too small). */
  contextTokenEstimate?: number;
}

// ─── Raw Run Result ───────────────────────────────────────────────────────────

export type TestRunStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface TestRunResult {
  /** Internal config ID (ModelConfig.id) — used for grouping/matching. */
  modelId: string;
  /** Human-readable model name (ModelConfig.name). */
  modelName: string;
  /** Model ID from Settings (before any Ollama remapping). Omitted on older saved runs. */
  configuredModelId?: string;
  /** Model identifier actually sent to the provider (after Ollama /api/tags resolution). */
  actualModelId: string;
  testId: string;
  category: TestCategory;
  status: TestRunStatus;
  /** Milliseconds to first token (streaming latency). */
  ttft: number;
  /** Total wall-clock ms from request start to done callback. */
  totalMs: number;
  inputTokens: number;
  outputTokens: number;
  tokensPerSecond: number;
  rawOutput: string;
  /** Number of tool call objects returned by the model. */
  toolCallsMade: number;
  error?: string;
  /** Base URL used for the provider request (same resolution as chat/agent). */
  requestBaseUrl?: string;
  /** Functional test results — the primary correctness signal. */
  functionalResults?: FunctionalResult;
}

// ─── Per-Category Score ───────────────────────────────────────────────────────

export interface CategoryScore {
  /** Raw 0–10 score before weighting. */
  raw: number;
  /** After multiplying by category weight; contributes to totalScore. */
  weighted: number;
  /** True when every test result in this category was skipped (e.g. model lacks tool-use support). Excluded from scoring. */
  skipped?: boolean;
}

// ─── Per-Model Aggregate Score ────────────────────────────────────────────────

export interface ModelBenchmarkScore {
  /** Matches ModelConfig.id */
  modelConfigId: string;
  modelName: string;
  provider: string;
  /** 0–100 composite score. */
  totalScore: number;
  /** Pass@1: fraction of functional tests passed on first attempt (0–1). */
  passAt1: number;
  categories: Record<ScoreCategory, CategoryScore>;
  strengths: string[];
  weaknesses: string[];
  /** Task-type labels e.g. "fast autocomplete", "deep debugging". */
  bestFor: string[];
  runAt: string;
}

// ─── Benchmark Run (container) ────────────────────────────────────────────────

export type BenchmarkRunStatus = 'idle' | 'running' | 'done' | 'aborted';

export interface BenchmarkRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: BenchmarkRunStatus;
  selectedModelIds: string[];
  selectedTestIds: string[];
  results: TestRunResult[];
  scores: ModelBenchmarkScore[];
}

// ─── Progress callback payload ────────────────────────────────────────────────

export interface RunProgress {
  modelConfigId: string;
  testId: string;
  status: TestRunStatus;
  partial?: string;
  /** Set when this (model, test) cell finishes — drives live Results while the run is still going */
  result?: TestRunResult;
}
