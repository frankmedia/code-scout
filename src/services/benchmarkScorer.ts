import type { ModelConfig } from '@/store/modelStore';
import { PROVIDER_OPTIONS } from '@/store/modelStore';
import type {
  TestRunResult,
  ModelBenchmarkScore,
  CategoryScore,
  ScoreCategory,
} from '@/types/benchmark';
import { getTestById } from '@/services/benchmarkTests';

// ─── Category weights (must sum to 1.0) ──────────────────────────────────────

const WEIGHTS: Record<ScoreCategory, number> = {
  'code-gen':   0.15,
  'code-edit':  0.12,
  'debug':      0.15,
  'reasoning':  0.15,
  'context':    0.10,
  'tool-use':   0.10,
  'speed':      0.13,
  'cost':       0.10,
};

// ─── Hint matching (secondary signal) ─────────────────────────────────────────

function countHits(output: string, hints: string[]): number {
  let hits = 0;
  for (const hint of hints) {
    try {
      if (new RegExp(hint, 'i').test(output)) hits++;
    } catch {
      if (output.toLowerCase().includes(hint.toLowerCase())) hits++;
    }
  }
  return hits;
}

// ─── Functional correctness scoring ───────────────────────────────────────────

/**
 * Score a test result that has functional tests.
 * Functional pass rate is the primary signal (0–8 pts).
 * Hint matching is the secondary signal (0–2 pts bonus).
 */
function scoreFunctional(result: TestRunResult): number {
  if (result.status === 'error' || result.status === 'skipped') return 0;

  const fr = result.functionalResults;
  if (!fr || fr.total === 0) return scoreLegacyQuality(result);

  const passRate = fr.passed / fr.total;
  const functionalScore = Math.round(passRate * 8);

  const test = getTestById(result.testId);
  let hintBonus = 0;
  if (test && test.evaluationHints.length > 0) {
    const hits = countHits(result.rawOutput, test.evaluationHints);
    hintBonus = hits >= (test.minHitsRequired ?? Math.ceil(test.evaluationHints.length / 2)) ? 2 : 0;
  }

  return Math.min(10, functionalScore + hintBonus);
}

/**
 * Legacy quality scorer for tests without functional tests (context, tool-use).
 */
function scoreLegacyQuality(result: TestRunResult): number {
  if (result.status === 'error' || result.status === 'skipped') return 0;
  if (!result.rawOutput || result.rawOutput.trim().length < 50) return 0;

  const test = getTestById(result.testId);
  if (!test) return 5;

  const hits = countHits(result.rawOutput, test.evaluationHints);
  const total = test.evaluationHints.length;
  const minRequired = test.minHitsRequired ?? Math.ceil(total / 2);

  if (hits === 0) return 0;
  if (hits < minRequired) return Math.round((hits / minRequired) * 4);
  const above = hits - minRequired;
  const range = total - minRequired;
  return range > 0 ? Math.min(10, 5 + Math.round((above / range) * 5)) : 10;
}

/** Score tool usage: did the model call tools AND mention expected content? */
function scoreToolUse(result: TestRunResult): number {
  if (result.status === 'error' || result.status === 'skipped') return 0;
  let score = 0;

  if (result.toolCallsMade >= 2) score += 6;
  else if (result.toolCallsMade === 1) score += 4;
  else if (result.rawOutput.toLowerCase().includes('read_file')) score += 2;

  const test = getTestById(result.testId);
  if (test) {
    const hits = countHits(result.rawOutput, test.evaluationHints);
    score += Math.min(4, Math.round((hits / test.evaluationHints.length) * 4));
  }
  return Math.min(10, score);
}

// ─── Speed scoring (normalized across all results for the same test) ──────────

function scoreSpeed(
  result: TestRunResult,
  allResultsForTest: TestRunResult[],
): number {
  if (result.status === 'error' || result.status === 'skipped') return 0;
  const valid = allResultsForTest.filter(r => r.status === 'done' && r.totalMs > 0);
  if (valid.length === 0) return 5;
  const times = valid.map(r => r.totalMs);
  const min = Math.min(...times);
  const max = Math.max(...times);
  if (max === min) return 7;
  const norm = (max - result.totalMs) / (max - min);
  return Math.round(norm * 10);
}

// ─── Cost scoring ─────────────────────────────────────────────────────────────

function scoreCost(
  model: ModelConfig,
  result: TestRunResult,
): number {
  if (result.status === 'error' || result.status === 'skipped') return 0;

  const providerMeta = PROVIDER_OPTIONS.find(p => p.id === model.provider);
  const localBonus = providerMeta?.isLocal ? 3 : 0;

  const totalTokens = result.inputTokens + result.outputTokens;
  if (totalTokens === 0) return 5 + localBonus;

  const efficiency = result.outputTokens / totalTokens;
  const effScore = Math.round(efficiency * 7);

  return Math.min(10, effScore + localBonus);
}

// ─── Score dispatcher per category ────────────────────────────────────────────

function scoreResult(result: TestRunResult): number {
  if (result.category === 'tool-use') return scoreToolUse(result);
  if (result.functionalResults && result.functionalResults.total > 0) return scoreFunctional(result);
  return scoreLegacyQuality(result);
}

// ─── Aggregate per model ──────────────────────────────────────────────────────

export function scoreModelResults(
  model: ModelConfig,
  allResults: TestRunResult[],
): ModelBenchmarkScore {
  const modelResults = allResults.filter(r => r.modelId === model.id);

  const categoryRaw: Partial<Record<ScoreCategory, number>> = {};

  const testCategories: Array<Exclude<ScoreCategory, 'speed' | 'cost'>> = [
    'code-gen', 'code-edit', 'debug', 'reasoning', 'context', 'tool-use',
  ];

  const categorySkipped: Partial<Record<ScoreCategory, boolean>> = {};

  for (const cat of testCategories) {
    const catResults = modelResults.filter(r => r.category === cat);
    if (catResults.length === 0) {
      categoryRaw[cat] = 0;
      continue;
    }
    // If every result was skipped (e.g. model has no tool-use support), mark the
    // category as skipped so it is excluded from the weighted total rather than
    // counting as 0 and dragging the overall score down.
    const allSkipped = catResults.every(r => r.status === 'skipped');
    if (allSkipped) {
      categorySkipped[cat] = true;
      categoryRaw[cat] = 0;
      continue;
    }
    const scores = catResults.map(r => scoreResult(r));
    categoryRaw[cat] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  // Speed: average across all tests
  const speedScores = modelResults.map(r => {
    const sibling = allResults.filter(x => x.testId === r.testId);
    return scoreSpeed(r, sibling);
  });
  categoryRaw['speed'] = speedScores.length
    ? speedScores.reduce((a, b) => a + b, 0) / speedScores.length
    : 0;

  // Cost: average across all tests
  const costScores = modelResults.map(r => scoreCost(model, r));
  categoryRaw['cost'] = costScores.length
    ? costScores.reduce((a, b) => a + b, 0) / costScores.length
    : 0;

  // Build CategoryScore objects and compute weighted total.
  // Skipped categories are excluded from the weight sum so the remaining
  // categories are renormalized — a model is not penalized for lacking a
  // capability that the provider simply doesn't expose.
  const categories = {} as Record<ScoreCategory, CategoryScore>;
  let totalScore = 0;

  const activeWeightSum = (Object.entries(WEIGHTS) as [ScoreCategory, number][])
    .filter(([cat]) => !categorySkipped[cat])
    .reduce((sum, [, w]) => sum + w, 0);
  const weightNorm = activeWeightSum > 0 ? 1 / activeWeightSum : 1;

  for (const [cat, weight] of Object.entries(WEIGHTS) as [ScoreCategory, number][]) {
    const raw = categoryRaw[cat] ?? 0;
    const skipped = !!categorySkipped[cat];
    const weighted = skipped ? 0 : raw * weight * weightNorm;
    categories[cat] = { raw: Math.round(raw * 10) / 10, weighted, skipped: skipped || undefined };
    totalScore += weighted;
  }

  const scaledTotal = Math.min(100, Math.round(totalScore * 10));

  // ─── Pass@1 ──────────────────────────────────────────────────────────────
  const allFunctional = modelResults
    .filter(r => r.functionalResults && r.functionalResults.total > 0)
    .map(r => r.functionalResults!);
  const totalFunctionalTests = allFunctional.reduce((s, f) => s + f.total, 0);
  const totalFunctionalPassed = allFunctional.reduce((s, f) => s + f.passed, 0);
  const passAt1 = totalFunctionalTests > 0 ? totalFunctionalPassed / totalFunctionalTests : 0;

  // ─── Strengths / Weaknesses ─────────────────────────────────────────────

  const sortedCats = testCategories
    .map(c => ({ cat: c, raw: categoryRaw[c] ?? 0 }))
    .sort((a, b) => b.raw - a.raw);

  const categoryLabels: Record<string, string> = {
    'code-gen': 'code generation',
    'code-edit': 'code editing',
    'debug': 'debugging',
    'reasoning': 'algorithmic reasoning',
    'context': 'context handling',
    'tool-use': 'tool usage',
  };

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  for (const { cat, raw } of sortedCats) {
    if (raw >= 7) strengths.push(`Strong ${categoryLabels[cat]}`);
    else if (raw <= 3) weaknesses.push(`Weak ${categoryLabels[cat]}`);
  }

  if (passAt1 >= 0.8) strengths.push(`High pass@1 (${Math.round(passAt1 * 100)}%)`);
  else if (passAt1 > 0 && passAt1 < 0.4) weaknesses.push(`Low pass@1 (${Math.round(passAt1 * 100)}%)`);

  const speedRaw = categoryRaw['speed'] ?? 0;
  if (speedRaw >= 7) strengths.push('Fast response time');
  else if (speedRaw <= 3) weaknesses.push('Slow response time');

  const providerMeta = PROVIDER_OPTIONS.find(p => p.id === model.provider);
  if (providerMeta?.isLocal) strengths.push('Runs locally (no API cost)');

  if (strengths.length === 0) strengths.push('Balanced across categories');
  if (weaknesses.length === 0) weaknesses.push('No significant weaknesses detected');

  // ─── Best-for labels ──────────────────────────────────────────────────────

  const bestFor: string[] = [];
  const topCat = sortedCats[0]?.cat;

  if (speedRaw >= 7) bestFor.push('fast autocomplete');
  if (topCat === 'code-gen') bestFor.push('scaffolding new code');
  if (topCat === 'code-edit') bestFor.push('refactoring');
  if (topCat === 'debug') bestFor.push('debugging');
  if (topCat === 'reasoning') bestFor.push('hard algorithmic tasks');
  if (topCat === 'context') bestFor.push('large codebase analysis');
  if (topCat === 'tool-use') bestFor.push('agentic tasks with tools');
  if ((categoryRaw['reasoning'] ?? 0) >= 7) bestFor.push('reasoning-heavy tasks');
  if (passAt1 >= 0.8) bestFor.push('first-try correctness');
  if (bestFor.length === 0) bestFor.push('general-purpose coding');

  return {
    modelConfigId: model.id,
    modelName: model.name,
    provider: model.provider,
    totalScore: scaledTotal,
    passAt1,
    categories,
    strengths,
    weaknesses,
    bestFor,
    runAt: new Date().toISOString(),
  };
}

/** Score all models and return sorted leaderboard (highest first). */
export function buildLeaderboard(
  models: ModelConfig[],
  results: TestRunResult[],
): ModelBenchmarkScore[] {
  return models
    .map(m => scoreModelResults(m, results))
    .sort((a, b) => b.totalScore - a.totalScore);
}

/** Given a task type, find the best model for it. */
export function recommendModel(
  taskType: 'coding' | 'refactoring' | 'debugging' | 'reasoning' | 'research',
  leaderboard: ModelBenchmarkScore[],
): ModelBenchmarkScore | undefined {
  if (leaderboard.length === 0) return undefined;

  const catMap: Record<string, ScoreCategory> = {
    coding: 'code-gen',
    refactoring: 'code-edit',
    debugging: 'debug',
    reasoning: 'reasoning',
    research: 'tool-use',
  };

  const cat = catMap[taskType];
  return [...leaderboard].sort(
    (a, b) => (b.categories[cat]?.raw ?? 0) - (a.categories[cat]?.raw ?? 0),
  )[0];
}
