/** Fallback context window (tokens) when model has no explicit `contextTokens` and id doesn't match. */
export const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Heuristic map from model id substrings → typical context size.
 * Order matters: first match wins.
 */
const MODEL_ID_CONTEXT_RULES: { pattern: RegExp; tokens: number }[] = [
  { pattern: /llama3\.1|llama-3\.1/i, tokens: 128_000 },
  { pattern: /gpt-4o|gpt-4-turbo|o1|o3/i, tokens: 128_000 },
  { pattern: /gpt-3\.5|gpt-35/i, tokens: 16_385 },
  { pattern: /claude-sonnet|claude-opus|claude-haiku/i, tokens: 200_000 },
  { pattern: /gemini-2|gemini-1\.5|gemini-pro/i, tokens: 1_000_000 },
  // Kimi / Moonshot models — very large context windows
  { pattern: /kimi|moonshot|kimi-k2|minimax/i, tokens: 128_000 },
  { pattern: /qwen2\.5-coder-32b|32k/i, tokens: 32_768 },
  { pattern: /deepseek-v3/i, tokens: 163_840 },        // DeepInfra provider on OpenRouter: 163.8K
  { pattern: /deepseek-r1/i, tokens: 128_000 },
  { pattern: /deepseek|codellama|qwen|mistral|llama/i, tokens: 32_768 },
  { pattern: /:7b|:8b|7b-|8b-/i, tokens: 8_192 },
];

export function guessContextWindowFromModelId(modelId: string): number | undefined {
  const id = modelId.trim();
  if (!id) return undefined;
  for (const { pattern, tokens } of MODEL_ID_CONTEXT_RULES) {
    if (pattern.test(id)) return tokens;
  }
  return undefined;
}

export function resolveContextWindowTokens(
  explicit: number | undefined,
  modelId: string,
): number {
  if (explicit != null && explicit > 0 && Number.isFinite(explicit)) return Math.floor(explicit);
  return guessContextWindowFromModelId(modelId) ?? DEFAULT_CONTEXT_WINDOW;
}
