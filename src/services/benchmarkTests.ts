import type { BenchmarkTest } from '@/types/benchmark';

// ─── 1. Code Generation — HumanEval-style ────────────────────────────────────

export const CODE_GEN_TEST: BenchmarkTest = {
  id: 'code-gen',
  category: 'code-gen',
  name: 'Function Implementation',
  description: 'Implement romanToInt() from a specification with 7 unit tests.',
  rationale:
    'Measures pass@1 functional correctness — the gold-standard metric used by HumanEval and MBPP. ' +
    'Given a function signature and specification, can the model produce code that actually runs ' +
    'and passes unit tests on the first try? This is how the industry evaluates coding LLMs.',
  systemPrompt:
    'You are a coding assistant. Implement the requested function in JavaScript. ' +
    'Output the complete function. You may include brief explanations, but the code must be correct.',
  userPrompt: `Implement the following JavaScript function:

\`\`\`
function romanToInt(s)
\`\`\`

Convert a Roman numeral string to an integer.

Rules:
- Symbol values: I=1, V=5, X=10, L=50, C=100, D=500, M=1000
- Subtraction rule: When a smaller value appears before a larger one, subtract it.
  Examples: IV=4, IX=9, XL=40, XC=90, CD=400, CM=900
- Input is always a valid Roman numeral in the range [1, 3999].

Examples:
- romanToInt("III") → 3
- romanToInt("LVIII") → 58
- romanToInt("MCMXCIV") → 1994`,
  evaluationHints: [
    'function romanToInt',
    'return',
    '1000|M',
    '500|D',
    '100|C',
  ],
  minHitsRequired: 3,
  functionalTests: [
    { call: 'romanToInt("III")',     expected: '3',    description: 'Simple addition: III = 3' },
    { call: 'romanToInt("IV")',      expected: '4',    description: 'Subtraction: IV = 4' },
    { call: 'romanToInt("IX")',      expected: '9',    description: 'Subtraction: IX = 9' },
    { call: 'romanToInt("LVIII")',   expected: '58',   description: 'Mixed: LVIII = 58' },
    { call: 'romanToInt("MCMXCIV")', expected: '1994', description: 'Complex: MCMXCIV = 1994' },
    { call: 'romanToInt("XLII")',    expected: '42',   description: 'Mixed subtraction: XLII = 42' },
    { call: 'romanToInt("MMXXVI")',  expected: '2026', description: 'Current year: MMXXVI = 2026' },
  ],
};

// ─── 2. Code Editing — Aider-style ──────────────────────────────────────────

const IMPERATIVE_CODE = `
function flattenObject(obj) {
  var result = {};
  function recurse(current, prefix) {
    for (var key in current) {
      if (current.hasOwnProperty(key)) {
        var newKey = prefix ? prefix + '.' + key : key;
        if (typeof current[key] === 'object' && current[key] !== null && !Array.isArray(current[key])) {
          recurse(current[key], newKey);
        } else {
          result[newKey] = current[key];
        }
      }
    }
  }
  recurse(obj, '');
  return result;
}
`.trim();

export const CODE_EDIT_TEST: BenchmarkTest = {
  id: 'code-edit',
  category: 'code-edit',
  name: 'Code Refactoring',
  description: 'Refactor flattenObject() to modern JS; verify functional equivalence via 5 tests.',
  rationale:
    'Modeled after the Aider Polyglot benchmark. Most real coding work is editing, not greenfield. ' +
    'This tests whether the model can modernize code (var→const/let, closures→pure functions) ' +
    'while preserving identical behavior — verified by running the same inputs through both versions.',
  systemPrompt:
    'You are an expert JavaScript developer. Refactor the code as requested. ' +
    'The refactored function MUST be named flattenObject and produce identical output for all inputs. ' +
    'Output the complete refactored function.',
  userPrompt: `Refactor the following JavaScript function to modern, clean code:
- Replace \`var\` with \`const\`/\`let\`
- Eliminate the closure over \`result\` — make it a pure function
- Use modern iteration (for...of, Object.entries, etc.)
- Keep the same function name: \`flattenObject\`
- The output must be identical for all inputs.

\`\`\`javascript
${IMPERATIVE_CODE}
\`\`\``,
  evaluationHints: [
    'function flattenObject|const flattenObject',
    'const |let ',
    'Object\\.entries|Object\\.keys|for.*of',
    'return',
  ],
  minHitsRequired: 3,
  functionalTests: [
    {
      call: 'flattenObject({ a: 1, b: { c: 2, d: { e: 3 } } })',
      expected: '({ "a": 1, "b.c": 2, "b.d.e": 3 })',
      description: 'Nested object flattening with dot notation',
    },
    {
      call: 'flattenObject({})',
      expected: '({})',
      description: 'Empty object returns empty object',
    },
    {
      call: 'flattenObject({ x: [1, 2, 3] })',
      expected: '({ "x": [1, 2, 3] })',
      description: 'Array values are preserved, not recursed into',
    },
    {
      call: 'flattenObject({ a: null, b: { c: null } })',
      expected: '({ "a": null, "b.c": null })',
      description: 'Null values handled correctly (not treated as objects)',
    },
    {
      call: 'flattenObject({ level1: { level2: { level3: { value: 42 } } } })',
      expected: '({ "level1.level2.level3.value": 42 })',
      description: 'Deeply nested (3 levels) flattens correctly',
    },
  ],
};

// ─── 3. Debugging — SWE-bench style ──────────────────────────────────────────

const BUGGY_CODE = `
// Function 1: Check if a string is a palindrome (case-insensitive, alphanumeric only)
function isPalindrome(s) {
  const cleaned = s.replace(/[^a-zA-Z0-9]/g, '');
  let left = 0, right = cleaned.length - 1;
  while (left < right) {
    if (cleaned[left] !== cleaned[right]) return false;
    left++;
    right--;
  }
  return true;
}

// Function 2: Compute the digital root (repeated digit sum until single digit)
function digitalRoot(n) {
  while (n > 9) {
    let sum = 0;
    while (n > 0) {
      sum += n % 10;
      n = Math.floor(n / 10);
    }
  }
  return n;
}

// Function 3: Rotate an array to the right by k positions
function rotateArray(arr, k) {
  if (arr.length === 0) return arr;
  k = k % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}
`.trim();

export const DEBUG_TEST: BenchmarkTest = {
  id: 'debug',
  category: 'debug',
  name: 'Bug Fixing',
  description: 'Find and fix 3 bugs so all 12 unit tests pass.',
  rationale:
    'Inspired by SWE-bench — can the model diagnose real bugs and produce working fixes? ' +
    'Unlike keyword-matching, we run the fixed code against 12 test cases. A model that describes ' +
    'the bug but outputs broken code scores zero. Only functional correctness counts.',
  systemPrompt:
    'You are a debugging expert. The code below has bugs. Find and fix ALL bugs. ' +
    'Output the complete corrected JavaScript code for all three functions. ' +
    'You may briefly explain each bug, but the code must be correct and complete.',
  userPrompt: `The following JavaScript code has bugs — some functions produce wrong results.
Find and fix ALL the bugs. Output the corrected code for ALL three functions.

\`\`\`javascript
${BUGGY_CODE}
\`\`\`

Test cases that should pass after your fixes:
- isPalindrome("A man, a plan, a canal: Panama") → true
- isPalindrome("Madam") → true
- isPalindrome("race a car") → false
- digitalRoot(16) → 7   (1+6=7)
- digitalRoot(942) → 6  (9+4+2=15 → 1+5=6)
- digitalRoot(0) → 0
- rotateArray([1,2,3,4,5], 2) → [4,5,1,2,3]
- rotateArray([1,2,3], 1) → [3,1,2]`,
  evaluationHints: [
    'toLowerCase|toLocaleLowerCase',
    'n = sum|n=sum',
    'arr\\.length - k|n - k|length-k',
  ],
  minHitsRequired: 2,
  functionalTests: [
    // isPalindrome — Bug: missing toLowerCase(), so "Madam" fails
    {
      call: 'isPalindrome("A man, a plan, a canal: Panama")',
      expected: 'true',
      description: 'isPalindrome: classic palindrome with spaces & punctuation',
    },
    {
      call: 'isPalindrome("Madam")',
      expected: 'true',
      description: 'isPalindrome: mixed case palindrome',
    },
    {
      call: 'isPalindrome("race a car")',
      expected: 'false',
      description: 'isPalindrome: not a palindrome',
    },
    {
      call: 'isPalindrome("")',
      expected: 'true',
      description: 'isPalindrome: empty string is a palindrome',
    },
    // digitalRoot — Bug: missing `n = sum` reassignment, returns 0 instead of root
    {
      call: 'digitalRoot(16)',
      expected: '7',
      description: 'digitalRoot: 1+6 = 7',
    },
    {
      call: 'digitalRoot(942)',
      expected: '6',
      description: 'digitalRoot: 9+4+2=15, 1+5=6',
    },
    {
      call: 'digitalRoot(0)',
      expected: '0',
      description: 'digitalRoot: zero stays zero',
    },
    {
      call: 'digitalRoot(999)',
      expected: '9',
      description: 'digitalRoot: 9+9+9=27, 2+7=9',
    },
    // rotateArray — Bug: rotates left instead of right (slice order inverted)
    {
      call: 'JSON.stringify(rotateArray([1,2,3,4,5], 2))',
      expected: 'JSON.stringify([4,5,1,2,3])',
      description: 'rotateArray: rotate right by 2',
    },
    {
      call: 'JSON.stringify(rotateArray([1,2,3], 1))',
      expected: 'JSON.stringify([3,1,2])',
      description: 'rotateArray: rotate right by 1',
    },
    {
      call: 'JSON.stringify(rotateArray([1], 5))',
      expected: 'JSON.stringify([1])',
      description: 'rotateArray: single element, any k',
    },
    {
      call: 'JSON.stringify(rotateArray([1,2], 0))',
      expected: 'JSON.stringify([1,2])',
      description: 'rotateArray: k=0 returns original',
    },
  ],
};

// ─── 4. Algorithmic Reasoning — LiveCodeBench style ─────────────────────────

export const REASONING_TEST: BenchmarkTest = {
  id: 'reasoning',
  category: 'reasoning',
  name: 'Algorithm: Merge Intervals',
  description: 'Implement mergeIntervals() — a non-trivial algorithm verified by 7 unit tests.',
  rationale:
    'Modeled after LiveCodeBench (LeetCode/Codeforces-style evaluation). This tests genuine ' +
    'algorithmic reasoning — sorting, edge-case handling, and merge logic — not pattern recall. ' +
    'A model that memorized solutions may pass, but one that truly reasons will handle all edge cases. ' +
    'This separates capable coding models from chatbots.',
  systemPrompt:
    'You are a coding assistant solving an algorithm problem. ' +
    'Implement the requested function in JavaScript. Output the complete function.',
  userPrompt: `Implement the following JavaScript function:

\`\`\`
function mergeIntervals(intervals)
\`\`\`

Given an array of intervals where each interval is [start, end], merge all overlapping intervals
and return an array of non-overlapping intervals sorted by start time.

Rules:
- Two intervals overlap if one starts before or when the other ends: [1,3] and [2,6] → [1,6]
- Adjacent intervals should merge: [1,4] and [4,5] → [1,5]
- A fully contained interval gets absorbed: [1,10] and [2,3] → [1,10]
- Return the result sorted by start time.

Examples:
- mergeIntervals([[1,3],[2,6],[8,10],[15,18]]) → [[1,6],[8,10],[15,18]]
- mergeIntervals([[1,4],[4,5]]) → [[1,5]]
- mergeIntervals([[1,4],[0,4]]) → [[0,4]]`,
  evaluationHints: [
    'function mergeIntervals',
    'sort',
    'return',
  ],
  minHitsRequired: 2,
  functionalTests: [
    {
      call: 'JSON.stringify(mergeIntervals([[1,3],[2,6],[8,10],[15,18]]))',
      expected: 'JSON.stringify([[1,6],[8,10],[15,18]])',
      description: 'Standard case: merge first two, keep rest',
    },
    {
      call: 'JSON.stringify(mergeIntervals([[1,4],[4,5]]))',
      expected: 'JSON.stringify([[1,5]])',
      description: 'Adjacent intervals merge (boundary touching)',
    },
    {
      call: 'JSON.stringify(mergeIntervals([[1,4],[0,4]]))',
      expected: 'JSON.stringify([[0,4]])',
      description: 'Unsorted input: second interval starts earlier',
    },
    {
      call: 'JSON.stringify(mergeIntervals([[1,4],[2,3]]))',
      expected: 'JSON.stringify([[1,4]])',
      description: 'Fully contained interval gets absorbed',
    },
    {
      call: 'JSON.stringify(mergeIntervals([[1,10],[2,3],[4,5],[6,7]]))',
      expected: 'JSON.stringify([[1,10]])',
      description: 'One large interval absorbs all smaller ones',
    },
    {
      call: 'JSON.stringify(mergeIntervals([]))',
      expected: 'JSON.stringify([])',
      description: 'Edge case: empty input',
    },
    {
      call: 'JSON.stringify(mergeIntervals([[5,5]]))',
      expected: 'JSON.stringify([[5,5]])',
      description: 'Edge case: single point interval',
    },
  ],
};

// ─── 5. Context Window ──────────────────────────────────────────────────────

function buildContextDocument(): string {
  const sections = [
    {
      title: 'Section 1: Project Overview',
      body: 'This document describes the architecture of the CodeScout platform. CodeScout is a desktop IDE powered by multiple LLM backends. The platform supports local models via Ollama and LM Studio, as well as cloud providers including OpenAI, Anthropic, Google Gemini, Groq, Mistral, DeepSeek, and OpenRouter. The orchestrator selects the best model for each task automatically.',
      functions: ['initPlatform', 'loadConfig', 'validateLicense'],
      secretFact: 'The maximum supported workspace size is 2.4 GB.',
    },
    {
      title: 'Section 2: Model Management',
      body: 'Model management is handled through a Zustand store that persists to localStorage. Each model has a provider, endpoint, API key, context window size, and role assignment (orchestrator, coder, tester). The discovery system probes local endpoints to find running model servers automatically.',
      functions: ['addModel', 'removeModel', 'updateModel', 'toggleModel', 'setDefault', 'getModelForRole', 'resolveModelRequestFields'],
      secretFact: 'The default context window timeout is 45 seconds.',
    },
    {
      title: 'Section 3: Benchmarking Engine',
      body: 'The benchmarking engine runs standardized tests across all enabled models. Tests are grouped into six categories: code generation, code editing, debugging, algorithmic reasoning, context window handling, and tool usage. Results are scored using a weighted rubric with functional correctness as the primary metric. The leaderboard ranks models by composite score. The engine reports pass@1 rates for each model.',
      functions: ['runBenchmark', 'scoreResult', 'buildLeaderboard', 'persistResults', 'loadHistory', 'computeWeightedScore', 'inferStrengths', 'inferWeaknesses', 'labelBestFor'],
      secretFact: 'The benchmark timeout per model per test is 120 seconds.',
    },
    {
      title: 'Section 4: Agent Orchestration',
      body: 'The agent executor runs multi-step plans approved by the user. Each step can create files, edit files, run shell commands, search the web, or fetch URLs. Steps execute sequentially unless parallelism is explicitly declared. The orchestrator produces a plan in JSON and the executor carries it out.',
      functions: ['executePlan', 'runStep', 'repairStep', 'validateStep', 'rollbackAll', 'pushSnapshot'],
      secretFact: 'The maximum plan length is 32 steps.',
    },
    {
      title: 'Section 5: Memory and Indexing',
      body: 'Code Scout maintains a project memory that indexes file summaries, conventions, entry points, and architecture notes. This memory is persisted to .codescout/project.json and .codescout/memory.json. The memory is fed into every system prompt to give the AI complete context about the project without re-reading every file on each request.',
      functions: ['buildProjectMemory', 'writeIndexToDisk', 'readIndexFromDisk', 'writeAgentMemoryToDisk', 'readAgentMemoryFromDisk', 'summarizeFile', 'detectConventions'],
      secretFact: 'The memory index supports up to 10,000 files.',
    },
  ];

  const lines: string[] = ['# CodeScout Technical Reference Document\n'];
  for (const s of sections) {
    lines.push(`## ${s.title}\n`);
    lines.push(s.body + '\n');
    lines.push(`Implementation note: ${s.secretFact}\n`);
    lines.push('Functions in this section:');
    for (const fn of s.functions) lines.push(`  - ${fn}()`);
    lines.push('');
    lines.push(
      Array(6).fill(
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
      ).join(' ') + '\n',
    );
  }
  return lines.join('\n');
}

export const CONTEXT_TEST: BenchmarkTest = {
  id: 'context',
  category: 'context',
  name: 'Long Context Retrieval',
  description: 'Retrieve 5 specific, verifiable facts from a ~2k-token technical document.',
  rationale:
    'Tests the model\'s ability to process and accurately recall information from a large context window — ' +
    'critical for working with real codebases where relevant code is scattered across many files. ' +
    'Unlike summarization, every answer is a verifiable fact with exactly one correct value, ' +
    'so scoring is objective.',
  systemPrompt:
    'You are a precise technical assistant. When asked to extract information from a document, ' +
    'be exact and complete. Answer each question with the specific value from the document.',
  userPrompt: `${buildContextDocument()}\n\n---\n\nAnswer these questions using ONLY the document above. Give short, precise answers.\n\n1. How many test categories does the benchmarking engine have? Name them all.\n2. What is the benchmark timeout per model per test?\n3. What is the maximum plan length for the agent orchestrator?\n4. List ALL function names mentioned in Section 3 (with parentheses).\n5. What is the maximum supported workspace size?`,
  evaluationHints: [
    'six|6',
    'code generation',
    'code editing',
    'debugging',
    'algorithmic reasoning|reasoning',
    'context window',
    'tool usage',
    '120 seconds|120s',
    '32 steps|32',
    'runBenchmark',
    'scoreResult',
    'buildLeaderboard',
    'computeWeightedScore',
    'inferStrengths',
    'inferWeaknesses',
    '2\\.4 GB|2\\.4GB',
  ],
  minHitsRequired: 8,
  contextTokenEstimate: 2000,
};

// ─── 6. Tool Usage — Terminal-Bench style ────────────────────────────────────

export const TOOL_USE_TEST: BenchmarkTest = {
  id: 'tool-use',
  category: 'tool-use',
  name: 'Multi-step Tool Usage',
  description: 'Use read_file and write_to_file tools to analyze existing code and produce a test file.',
  rationale:
    'Inspired by Terminal-Bench and SWE-bench agent evaluations. Can the model plan and execute ' +
    'a multi-step workflow using available tools? A model that just outputs text instead of calling ' +
    'tools, or calls the wrong tools, fails — regardless of how "smart" its text response looks. ' +
    'This tests agentic capability: tool selection, argument formatting, and task decomposition.',
  systemPrompt:
    'You are a coding agent with access to file system tools. You MUST use the available tools ' +
    'to complete the task — do not just output text. Think step by step about which tools to use.\n\n' +
    'Available tools:\n' +
    '- read_file(path): Read a file\'s contents\n' +
    '- write_to_file(path, content): Create or overwrite a file\n\n' +
    'When you need to read a file first to understand it, use read_file. ' +
    'When you need to create a file, use write_to_file.',
  userPrompt:
    'Task: Create a unit test file for an existing utility module.\n\n' +
    '1. First, read the file "src/utils/math.js" to understand what functions it exports.\n' +
    '2. Then, create a test file "src/utils/math.test.js" that tests each exported function.\n\n' +
    'The math.js file contains:\n' +
    '```javascript\n' +
    'function add(a, b) { return a + b; }\n' +
    'function multiply(a, b) { return a * b; }\n' +
    'function clamp(value, min, max) { return Math.min(Math.max(value, min), max); }\n' +
    'module.exports = { add, multiply, clamp };\n' +
    '```\n\n' +
    'Use the read_file tool to read "src/utils/math.js", then use write_to_file ' +
    'to create the test file with proper assertions for add, multiply, and clamp.',
  evaluationHints: [
    'read_file',
    'write_to_file',
    'math\\.test\\.js|math\\.test',
    'add',
    'multiply',
    'clamp',
    'assert|expect|toBe|toEqual|===',
  ],
  minHitsRequired: 4,
  requiresTools: true,
};

// ─── Registry ─────────────────────────────────────────────────────────────────

export const ALL_BENCHMARK_TESTS: BenchmarkTest[] = [
  CODE_GEN_TEST,
  CODE_EDIT_TEST,
  DEBUG_TEST,
  REASONING_TEST,
  CONTEXT_TEST,
  TOOL_USE_TEST,
];

export function getTestById(id: string): BenchmarkTest | undefined {
  return ALL_BENCHMARK_TESTS.find(t => t.id === id);
}
