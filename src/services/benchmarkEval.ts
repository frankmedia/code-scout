/**
 * Benchmark Evaluation Engine
 *
 * Extracts code from LLM output and executes it against real unit tests.
 * This is the functional-correctness backbone — pass@1 is the gold-standard
 * metric used by HumanEval, MBPP, SWE-bench, and LiveCodeBench.
 */

import type { FunctionalTestCase, FunctionalResult } from '@/types/benchmark';

// ─── Code extraction ──────────────────────────────────────────────────────────

/**
 * Extract executable code from an LLM's raw output.
 * Handles markdown fences, mixed prose, and multiple code blocks.
 */
export function extractCode(output: string): string {
  const fenceRegex = /```(?:javascript|js|typescript|ts|jsx|tsx)?\s*\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let m;
  while ((m = fenceRegex.exec(output)) !== null) {
    blocks.push(m[1].trim());
  }

  let code: string;
  if (blocks.length === 1) {
    code = blocks[0];
  } else if (blocks.length > 1) {
    code = blocks.sort((a, b) => b.length - a.length)[0];
  } else {
    const lines = output.split('\n');
    const startIdx = lines.findIndex(l =>
      /^\s*(function\s+|const\s+|let\s+|var\s+|class\s+)/.test(l),
    );
    code = startIdx >= 0 ? lines.slice(startIdx).join('\n') : output;
  }

  code = code
    .replace(/^export\s+(default\s+)?/gm, '')
    .replace(/^import\s+.*;\s*$/gm, '');

  return stripBasicTypeAnnotations(code.trim());
}

/**
 * Strip the most common TypeScript annotations so code can execute
 * in a vanilla JS context. Not a full TS transpiler — handles 90% of cases.
 */
function stripBasicTypeAnnotations(code: string): string {
  return code
    .replace(/^(?:interface|type)\s+\w+[\s\S]*?(?=\n(?:function|const|let|var|\/\/|$))/gm, '')
    .replace(/<[A-Z]\w*(?:\s*,\s*[A-Z]\w*)*>/g, '')
    .replace(/(\w)\s*:\s*(?:number|string|boolean|any|void|never|undefined|null|unknown|object|Record<[^>]+>|Array<[^>]+>|\w+)(\[\])?\s*(?=[,)=;{\n])/g, '$1 ')
    .replace(/\)\s*:\s*(?:number|string|boolean|any|void|never|undefined|null|unknown|object|Record<[^>]+>|Array<[^>]+>|\w+)(\[\])?\s*(?=[{=>])/g, ')')
    .replace(/\s+as\s+\w+(\[\])?/g, '');
}

// ─── Deep equality ────────────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA).sort();
    const keysB = Object.keys(objB).sort();
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k, i) =>
      k === keysB[i] && deepEqual(objA[k], objB[k]),
    );
  }

  return false;
}

// ─── Test execution ───────────────────────────────────────────────────────────

/**
 * Run a single functional test case against the extracted code.
 *
 * Uses `new Function()` for isolated execution. The code is injected once,
 * then the test case's `call` expression is evaluated and compared against
 * the `expected` expression using deep equality.
 */
function executeTestCase(
  code: string,
  tc: FunctionalTestCase,
): { passed: boolean; actual?: string; expected?: string; error?: string } {
  try {
    // eslint-disable-next-line no-new-func
    const actualValue = new Function(`'use strict';\n${code}\nreturn (${tc.call});`)();
    // eslint-disable-next-line no-new-func
    const expectedValue = new Function(`'use strict';\nreturn (${tc.expected});`)();

    const passed = deepEqual(actualValue, expectedValue);
    return {
      passed,
      actual: safeStringify(actualValue),
      expected: safeStringify(expectedValue),
    };
  } catch (err) {
    return {
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Run all functional test cases for a benchmark test against the LLM's output.
 * Returns pass@1 results: how many tests passed on the first (and only) attempt.
 */
export function runFunctionalTests(
  rawOutput: string,
  testCases: FunctionalTestCase[],
): FunctionalResult {
  const code = extractCode(rawOutput);
  const details: FunctionalResult['details'] = [];
  let passed = 0;

  for (const tc of testCases) {
    const result = executeTestCase(code, tc);
    if (result.passed) passed++;
    details.push({
      description: tc.description,
      passed: result.passed,
      actual: result.actual,
      expected: result.expected,
      error: result.error,
    });
  }

  return { passed, total: testCases.length, details };
}
