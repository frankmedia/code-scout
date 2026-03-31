import { callModel, modelToRequest } from '@/services/modelApi';
import { WRITE_TO_FILE_TOOL, READ_FILE_TOOL } from '@/services/chatTools';
import { runFunctionalTests } from '@/services/benchmarkEval';
import type { ModelConfig } from '@/store/modelStore';
import type { BenchmarkTest, TestRunResult, RunProgress, FunctionalResult } from '@/types/benchmark';

/** Stops a single (model × test) call from hanging forever if the API never ends the stream. */
const BENCHMARK_SINGLE_TEST_TIMEOUT_MS = 15 * 60 * 1000;

/** Enough for long “explain + three functions” answers without unbounded generation. */
const BENCHMARK_MAX_OUTPUT_TOKENS = 12_288;

function benchmarkRequestSignal(user: AbortSignal): AbortSignal {
  if (BENCHMARK_SINGLE_TEST_TIMEOUT_MS <= 0) return user;
  const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') {
    try {
      return anyFn([user, AbortSignal.timeout(BENCHMARK_SINGLE_TEST_TIMEOUT_MS)]);
    } catch {
      /* ignore */
    }
  }
  return user;
}

function abortErrorMessage(error: Error): string {
  if (error.name !== 'AbortError') return error.message;
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof DOMException && cause.name === 'TimeoutError') {
    return `Timed out after ${Math.round(BENCHMARK_SINGLE_TEST_TIMEOUT_MS / 60_000)} min (benchmark per-test limit)`;
  }
  return 'Aborted';
}

// ─── Concurrency helpers ─────────────────────────────────────────────────────

async function withConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// ─── Single test runner ───────────────────────────────────────────────────────

function runSingleTest(
  model: ModelConfig,
  test: BenchmarkTest,
  signal: AbortSignal,
  onProgress: (p: RunProgress) => void,
): Promise<TestRunResult> {
  return new Promise(resolve => {
    const t0 = performance.now();
    let ttft = -1;
    let fullText = '';
    let toolCallsMade = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    onProgress({ modelConfigId: model.id, testId: test.id, status: 'running' });

    const messages = [
      { role: 'system' as const, content: test.systemPrompt },
      { role: 'user' as const, content: test.userPrompt },
    ];

    const tools = test.requiresTools
      ? [WRITE_TO_FILE_TOOL, READ_FILE_TOOL]
      : undefined;

    const testSignal = benchmarkRequestSignal(signal);

    const extras = test.requiresTools
      ? {
          tools,
          tool_choice: 'auto' as const,
          signal: testSignal,
          maxOutputTokens: BENCHMARK_MAX_OUTPUT_TOKENS,
        }
      : { signal: testSignal, maxOutputTokens: BENCHMARK_MAX_OUTPUT_TOKENS };

    const req = modelToRequest(model, messages, extras);
    const requestBaseUrl = req.endpoint?.replace(/\/+$/, '');
    let providerModelUsed = model.modelId;

    const finish = (error?: string) => {
      const totalMs = performance.now() - t0;
      const tps = outputTokens > 0 && totalMs > 0
        ? (outputTokens / totalMs) * 1000
        : 0;

      // Detect when a model simply doesn't support tool calling (OpenRouter 404,
      // or similar "no endpoints found" responses). This is a capability gap, not
      // a test failure — mark as skipped so it shows "skip" instead of a red ✗.
      const errorLower = (error ?? '').toLowerCase();
      const isToolNotSupported = !!error && !!test.requiresTools && (
        errorLower.includes('no endpoints found') ||
        errorLower.includes('tool use') ||
        errorLower.includes('tool_choice') ||
        errorLower.includes('does not support tool') ||
        errorLower.includes('api error 404')
      );

      let functionalResults: FunctionalResult | undefined;
      if (!error && test.functionalTests && test.functionalTests.length > 0) {
        try {
          functionalResults = runFunctionalTests(fullText, test.functionalTests);
        } catch {
          functionalResults = {
            passed: 0,
            total: test.functionalTests.length,
            details: test.functionalTests.map(tc => ({
              description: tc.description,
              passed: false,
              error: 'Evaluation engine error',
            })),
          };
        }
      }

      const result: TestRunResult = {
        modelId: model.id,
        modelName: model.name,
        configuredModelId: model.modelId,
        actualModelId: providerModelUsed,
        testId: test.id,
        category: test.category,
        status: isToolNotSupported ? 'skipped' : (error ? 'error' : 'done'),
        ttft: ttft >= 0 ? ttft : totalMs,
        totalMs,
        inputTokens,
        outputTokens,
        tokensPerSecond: tps,
        rawOutput: fullText,
        toolCallsMade,
        error: isToolNotSupported ? 'Model does not support tool use (skipped)' : error,
        requestBaseUrl,
        functionalResults,
      };

      onProgress({
        modelConfigId: model.id,
        testId: test.id,
        status: result.status,
        result,
      });
      resolve(result);
    };

    callModel(
      req,
      (chunk) => {
        if (ttft < 0) ttft = performance.now() - t0;
        fullText += chunk;
        onProgress({
          modelConfigId: model.id,
          testId: test.id,
          status: 'running',
          partial: chunk,
        });
      },
      (_fullText, meta) => {
        fullText = _fullText;
        toolCallsMade = meta?.toolCalls?.length ?? 0;
        if (meta?.providerModelUsed) providerModelUsed = meta.providerModelUsed;
        finish();
      },
      (error) => {
        finish(abortErrorMessage(error));
      },
      (usage) => {
        inputTokens = usage.inputTokens;
        outputTokens = usage.outputTokens;
      },
    );
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface BenchmarkRunnerOptions {
  /** Max parallel (model × test) pairs. Default 3. */
  concurrencyLimit?: number;
  onProgress: (p: RunProgress) => void;
}

export async function runBenchmark(
  models: ModelConfig[],
  tests: BenchmarkTest[],
  abortSignal: AbortSignal,
  options: BenchmarkRunnerOptions,
): Promise<TestRunResult[]> {
  const { concurrencyLimit = 3, onProgress } = options;

  const pairs: { model: ModelConfig; test: BenchmarkTest }[] = [];
  for (const model of models) {
    for (const test of tests) {
      pairs.push({ model, test });
    }
  }

  for (const { model, test } of pairs) {
    onProgress({ modelConfigId: model.id, testId: test.id, status: 'pending' });
  }

  const tasks = pairs.map(({ model, test }) => () => {
    if (abortSignal.aborted) {
      const skipped: TestRunResult = {
        modelId: model.id,
        modelName: model.name,
        configuredModelId: model.modelId,
        actualModelId: model.modelId,
        testId: test.id,
        category: test.category,
        status: 'skipped',
        ttft: 0,
        totalMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        tokensPerSecond: 0,
        rawOutput: '',
        toolCallsMade: 0,
        error: 'Aborted before start',
      };
      onProgress({
        modelConfigId: model.id,
        testId: test.id,
        status: 'skipped',
        result: skipped,
      });
      return Promise.resolve(skipped);
    }
    return runSingleTest(model, test, abortSignal, onProgress);
  });

  return withConcurrencyLimit(tasks, concurrencyLimit);
}
