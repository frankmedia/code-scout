/**
 * OpenAI serves some newer models only on POST /v1/responses.
 * Code Scout uses /v1/chat/completions (OpenAI-compatible streaming).
 */

/** True if this model id is known to reject chat/completions (Responses API only). */
export function isOpenAiResponsesApiOnlyModel(modelId: string): boolean {
  const raw = modelId.trim().toLowerCase();
  if (!raw) return false;
  const id = raw.includes('/') ? (raw.split('/').pop() ?? raw) : raw;
  // Codex variants (gpt-5.x-codex, gpt-5-codex) are confirmed chat/completions 404.
  // gpt-5.4, gpt-5.4-mini, gpt-5.4-nano, gpt-4.1, gpt-4.1-mini work fine.
  if (!id.startsWith('gpt-5')) return false;
  return id.includes('codex');
}

export const OPENAI_CHAT_COMPLETIONS_HINT =
  "This model only works on OpenAI's Responses API, not Chat Completions. " +
  'Use gpt-5.4, gpt-5.4-mini, gpt-5.4-nano, gpt-4.1, or gpt-4.1-mini ' +
  '(all confirmed on chat/completions with 1M context), or another non-codex model.';
