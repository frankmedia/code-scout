/**
 * Fetches the real context window size from the model's API endpoint.
 *
 * Each provider exposes this differently (or not at all).
 * Returns the token count as a number, or null if it can't be determined.
 *
 * Results are stored in ModelConfig.contextTokens via updateModel so
 * the value persists across sessions and the ContextBar always shows the real limit.
 */

import type { ModelConfig, ModelProvider } from '@/store/modelStore';

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchJson(url: string, opts?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(6000),
    ...opts,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function authHeader(apiKey?: string): HeadersInit {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

// ─── Per-provider fetchers ────────────────────────────────────────────────────

/** Ollama: POST /api/show → model_info contains llama.context_length */
async function ollamaContextWindow(endpoint: string, modelId: string): Promise<number | null> {
  const data = await fetchJson(`${endpoint}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId, verbose: false }),
  }) as Record<string, unknown>;

  // Ollama >= 0.3 returns model_info with keys like "llama.context_length"
  const info = data.model_info as Record<string, unknown> | undefined;
  if (info) {
    // Try common keys
    const candidates = [
      info['llama.context_length'],
      info['context_length'],
      info['phi3.context_length'],
      info['qwen2.context_length'],
      info['mistral.context_length'],
      info['gemma2.context_length'],
      info['gemma.context_length'],
      info['falcon.context_length'],
      info['starcoder.context_length'],
      info['deepseek2.context_length'],
      info['command-r.context_length'],
    ];
    for (const v of candidates) {
      if (typeof v === 'number' && v > 0) return v;
    }
    // Scan all keys for anything ending in .context_length
    for (const [k, v] of Object.entries(info)) {
      if (k.endsWith('.context_length') && typeof v === 'number' && v > 0) return v;
    }
  }

  // Older Ollama: check parameters string (e.g. "num_ctx 8192")
  if (typeof data.parameters === 'string') {
    const m = data.parameters.match(/\bnum_ctx\s+(\d+)/i);
    if (m) return parseInt(m[1], 10);
  }

  return null;
}

/** OpenAI: GET /v1/models/{id} — the public API doesn't return context_window.
 *  Use known values from their docs.  We return null to fall through to the
 *  hardcoded table, but we try anyway in case a compatible endpoint exposes it. */
async function openAiCompatContextWindow(
  endpoint: string,
  modelId: string,
  apiKey?: string,
): Promise<number | null> {
  try {
    const data = await fetchJson(`${endpoint}/models/${modelId}`, {
      headers: authHeader(apiKey),
    }) as Record<string, unknown>;
    // Some compatible servers (e.g. local proxies) include context_window or context_length
    for (const key of ['context_window', 'context_length', 'max_context_length', 'n_ctx', 'max_tokens']) {
      const v = data[key];
      if (typeof v === 'number' && v > 0) return v;
    }
  } catch {
    // ignore — will fall back to heuristic
  }
  return null;
}

interface OpenRouterModelEntry {
  id: string;
  name?: string;
  context_length?: number;
  architecture?: { modality?: string; tokenizer?: string };
  top_provider?: { max_completion_tokens?: number; is_moderated?: boolean };
  pricing?: { prompt?: string; completion?: string };
}

/** OpenRouter: GET /api/v1/models → find model by id → full entry */
async function openRouterModelEntry(modelId: string, apiKey?: string): Promise<OpenRouterModelEntry | null> {
  const data = await fetchJson('https://openrouter.ai/api/v1/models', {
    headers: authHeader(apiKey),
  }) as { data?: OpenRouterModelEntry[] };
  return data.data?.find(m => m.id === modelId) ?? null;
}

async function openRouterContextWindow(modelId: string, apiKey?: string): Promise<number | null> {
  const entry = await openRouterModelEntry(modelId, apiKey);
  if (entry?.context_length && entry.context_length > 0) return entry.context_length;
  return null;
}

/** Google Gemini: GET /v1beta/models/{id}?key=… → input_token_limit */
async function googleContextWindow(modelId: string, apiKey?: string): Promise<number | null> {
  if (!apiKey) return null;
  // modelId may be "gemini-1.5-pro" — API wants "models/gemini-1.5-pro"
  const name = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
  const data = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/${name}?key=${apiKey}`,
  ) as Record<string, unknown>;
  const v = data.inputTokenLimit ?? data.input_token_limit;
  if (typeof v === 'number' && v > 0) return v;
  return null;
}

/** Groq: GET /openai/v1/models → find model → context_window */
async function groqContextWindow(modelId: string, apiKey?: string): Promise<number | null> {
  if (!apiKey) return null;
  const data = await fetchJson('https://api.groq.com/openai/v1/models', {
    headers: authHeader(apiKey),
  }) as { data?: Array<{ id: string; context_window?: number }> };
  const model = data.data?.find(m => m.id === modelId);
  if (model?.context_window && model.context_window > 0) return model.context_window;
  return null;
}

/** Mistral: GET /v1/models → find model → max_context_length */
async function mistralContextWindow(modelId: string, apiKey?: string): Promise<number | null> {
  if (!apiKey) return null;
  const data = await fetchJson('https://api.mistral.ai/v1/models', {
    headers: authHeader(apiKey),
  }) as { data?: Array<{ id: string; max_context_length?: number }> };
  const model = data.data?.find(m => m.id === modelId);
  if (model?.max_context_length && model.max_context_length > 0) return model.max_context_length;
  return null;
}

/** llama.cpp: GET /props returns default_generation_settings.n_ctx */
async function llamaCppContextWindow(endpoint: string): Promise<number | null> {
  const data = await fetchJson(`${endpoint}/props`) as Record<string, unknown>;
  const n_ctx = (data.default_generation_settings as Record<string, unknown> | undefined)?.n_ctx;
  if (typeof n_ctx === 'number' && n_ctx > 0) return n_ctx;
  // Also check top-level
  if (typeof data.n_ctx === 'number' && (data.n_ctx as number) > 0) return data.n_ctx as number;
  return null;
}

// ─── Main exports ─────────────────────────────────────────────────────────────

export interface ModelStats {
  /** Real context window in tokens (null = couldn't fetch, use heuristic). */
  contextTokens: number | null;
  /**
   * Whether the model supports image input.
   * null = couldn't determine from API (keep existing / infer from model id).
   */
  supportsVision: boolean | null;
  /** Human-readable name returned by the provider (null = not available). */
  displayName: string | null;
  /** Per-1M input token price in USD as a string (e.g. "0.32"), null if unknown. */
  inputPricePerM: string | null;
  /** Per-1M output token price in USD as a string (e.g. "0.89"), null if unknown. */
  outputPricePerM: string | null;
}

/**
 * Fetch the real context window for a model.
 * Returns the token count or null if the API doesn't expose it.
 * Never throws — errors are swallowed and null returned.
 */
export async function fetchModelContextWindow(model: ModelConfig): Promise<number | null> {
  const stats = await fetchModelStats(model);
  return stats.contextTokens;
}

/**
 * Fetch ALL live stats for a model from the provider's API.
 * Never throws — failed fields are null.
 */
export async function fetchModelStats(model: ModelConfig): Promise<ModelStats> {
  const empty: ModelStats = { contextTokens: null, supportsVision: null, displayName: null, inputPricePerM: null, outputPricePerM: null };
  const endpoint = (model.endpoint ?? '').replace(/\/$/, '');
  const { modelId, provider, apiKey } = model;

  try {
    switch (provider as ModelProvider) {
      case 'ollama': {
        if (!endpoint) return empty;
        const ctx = await ollamaContextWindow(endpoint, modelId);
        return { ...empty, contextTokens: ctx };
      }

      case 'lm-studio': {
        if (!endpoint) return empty;
        const ctx = await openAiCompatContextWindow(endpoint + '/v1', modelId, apiKey);
        return { ...empty, contextTokens: ctx };
      }

      case 'llama-cpp': {
        if (!endpoint) return empty;
        const ctx = await llamaCppContextWindow(endpoint);
        return { ...empty, contextTokens: ctx };
      }

      case 'openai': {
        const ctx = await openAiCompatContextWindow('https://api.openai.com/v1', modelId, apiKey);
        return { ...empty, contextTokens: ctx };
      }

      case 'openrouter': {
        const entry = await openRouterModelEntry(modelId, apiKey);
        if (!entry) return empty;
        // Vision: modality string contains "image" (e.g. "text+image->text")
        const modality = entry.architecture?.modality ?? '';
        const hasVision = modality.includes('image') ? true : modality ? false : null;
        const price = entry.pricing;
        const toPerM = (v: string | undefined) => {
          if (!v) return null;
          const n = parseFloat(v);
          if (!isFinite(n)) return null;
          return (n * 1_000_000).toFixed(2);
        };
        return {
          contextTokens: entry.context_length && entry.context_length > 0 ? entry.context_length : null,
          supportsVision: hasVision,
          displayName: entry.name ?? null,
          inputPricePerM: toPerM(price?.prompt),
          outputPricePerM: toPerM(price?.completion),
        };
      }

      case 'google': {
        const ctx = await googleContextWindow(modelId, apiKey);
        return { ...empty, contextTokens: ctx };
      }

      case 'groq': {
        const ctx = await groqContextWindow(modelId, apiKey);
        return { ...empty, contextTokens: ctx };
      }

      case 'mistral': {
        const ctx = await mistralContextWindow(modelId, apiKey);
        return { ...empty, contextTokens: ctx };
      }

      default:
        return empty;
    }
  } catch {
    return empty;
  }
}
