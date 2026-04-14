import type { AssistantToolCall } from '@/services/chatTools';
import type {
  ModelRequest, StreamCallback, DoneCallback, ErrorCallback, TokensCallback,
  ModelRequestMessage, MultimodalContentPart,
} from './modelApiTypes';
import { pushStreamLines, joinTextParts } from './modelApiTypes';

// ─── Streaming tool_calls merge (Ollama / Qwen) ───────────────────────────────
// Docs: when stream=true, gather every chunk of tool_calls — do NOT replace each line.
// See https://docs.ollama.com/capabilities/tool-calling — `tool_calls.extend(chunk...)`.

type OllamaStreamFn = {
  index?: number;
  name?: string;
  arguments?: string | Record<string, unknown>;
};

function mergeOllamaStreamToolChunks(
  acc: Map<number, { name: string; arguments: string }>,
  toolCalls: Array<{ function?: OllamaStreamFn }>,
): void {
  toolCalls.forEach((tc, arrIdx) => {
    const fn = tc.function;
    if (!fn) return;
    const idx = typeof fn.index === 'number' ? fn.index : arrIdx;
    let cur = acc.get(idx);
    if (!cur) {
      cur = { name: '', arguments: '' };
      acc.set(idx, cur);
    }
    if (fn.name) cur.name = fn.name;
    if (fn.arguments !== undefined && fn.arguments !== null) {
      if (typeof fn.arguments === 'string') {
        cur.arguments += fn.arguments;
      } else {
        cur.arguments = JSON.stringify(fn.arguments);
      }
    }
  });
}

function finalizeOllamaStreamTools(
  acc: Map<number, { name: string; arguments: string }>,
): AssistantToolCall[] | undefined {
  if (acc.size === 0) return undefined;
  return Array.from(acc.entries())
    .sort(([a], [b]) => a - b)
    .map(([_, v], j) => ({
      id: `call_ollama_${Date.now()}_${j}`,
      type: 'function' as const,
      function: {
        name: v.name.trim() || 'unknown_tool',
        arguments: v.arguments.trim() || '{}',
      },
    }));
}

// ─── Ollama message serialization ────────────────────────────────────────────

function ollamaPayloadMessage(m: ModelRequestMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'user', content: `[tool result ${m.tool_call_id}]\n${m.content}` };
  }
  if (m.role === 'assistant' && m.tool_calls?.length) {
    const summary = m.tool_calls
      .map(tc => `${tc.function.name}(${tc.function.arguments})`)
      .join('\n');
    const baseText =
      typeof m.content === 'string' && m.content.trim()
        ? m.content
        : '(used tools)';
    return { role: 'assistant', content: `${baseText}\n[tool_calls]\n${summary}` };
  }
  if (m.role === 'system' || m.role === 'user' || m.role === 'assistant') {
    const c = m.content;
    if (typeof c === 'string') {
      return { role: m.role, content: c };
    }
    if (!c) {
      return { role: m.role, content: '' };
    }
    const images = c.filter((p): p is MultimodalContentPart & { type: 'image' } => p.type === 'image');
    const text = joinTextParts(c).trim() || (images.length ? '(see images)' : '');
    const base: Record<string, unknown> = { role: m.role, content: text };
    if (images.length) base.images = images.map(i => i.dataBase64);
    return base;
  }
  return { role: 'user', content: '' };
}

// ─── Ollama tags cache ───────────────────────────────────────────────────────

const ollamaTagsCache = new Map<string, { names: string[]; at: number }>();
const OLLAMA_TAGS_TTL_MS = 20_000;

/** Clears cached `/api/tags` responses (e.g. after pulling a new model). */
export function clearOllamaTagsCache(): void {
  ollamaTagsCache.clear();
}

/** Lists installed models; shares cache with chat/benchmark Ollama calls. */
export async function getOllamaInstalledModelNames(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<string[] | null> {
  return fetchOllamaTagNames(baseUrl.replace(/\/+$/, ''), signal);
}

async function fetchOllamaTagNames(
  endpoint: string,
  signal?: AbortSignal,
): Promise<string[] | null> {
  const now = Date.now();
  const cached = ollamaTagsCache.get(endpoint);
  if (cached && now - cached.at < OLLAMA_TAGS_TTL_MS) {
    return cached.names;
  }
  let res: Response;
  try {
    res = await fetch(`${endpoint}/api/tags`, {
      signal: signal ?? AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const data = (await res.json()) as { models?: { name: string }[] };
    const names = (data.models ?? []).map(m => m.name).filter(Boolean);
    ollamaTagsCache.set(endpoint, { names, at: Date.now() });
    return names;
  } catch {
    return null;
  }
}

/**
 * Match Settings model ID to an installed Ollama tag.
 * Avoids opaque HTTP 404 when the name is close but not exact.
 */
export async function resolveOllamaModelId(
  baseUrl: string,
  requested: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; model: string; verified: boolean }
  | { ok: false; message: string }
> {
  const endpoint = baseUrl.replace(/\/+$/, '');
  const names = await fetchOllamaTagNames(endpoint, signal);
  if (names === null) {
    return { ok: true, model: requested, verified: false };
  }
  if (names.length === 0) {
    return {
      ok: false,
      message: `No models are installed on ${endpoint}. On that machine run: ollama pull <model>`,
    };
  }
  if (names.includes(requested)) {
    return { ok: true, model: requested, verified: true };
  }
  const lower = requested.toLowerCase();
  const caseMatch = names.find(n => n.toLowerCase() === lower);
  if (caseMatch) {
    return { ok: true, model: caseMatch, verified: true };
  }
  const reqBase = requested.includes(':') ? requested.slice(0, requested.indexOf(':')) : requested;
  const reqTag = requested.includes(':') ? requested.slice(requested.indexOf(':') + 1) : '';
  const sameBase = names.filter(
    n => n.split(':')[0].toLowerCase() === reqBase.toLowerCase(),
  );
  if (sameBase.length === 1) {
    return { ok: true, model: sameBase[0], verified: true };
  }
  if (sameBase.length > 1 && reqTag) {
    const want = `${reqBase}:${reqTag}`.toLowerCase();
    const tagged = sameBase.find(n => n.toLowerCase() === want);
    if (tagged) return { ok: true, model: tagged, verified: true };
    return {
      ok: false,
      message:
        `Model "${requested}" is not installed. Same base name exists with different tags: ${sameBase.join(', ')}. ` +
        `Pick one exactly in Settings → Models.`,
    };
  }
  if (sameBase.length > 1) {
    return {
      ok: false,
      message:
        `Model "${requested}" is ambiguous or missing. Matches for "${reqBase}": ${sameBase.join(', ')}. ` +
        `Use the full name including tag in Settings.`,
    };
  }
  if (names.length === 1) {
    return { ok: true, model: names[0], verified: true };
  }

  const sample = names.slice(0, 20).join(', ');
  const more = names.length > 20 ? ` (+${names.length - 20} more)` : '';
  return {
    ok: false,
    message: `Model "${requested}" is not on this server. Installed: ${sample}${more}`,
  };
}

// ─── Ollama streaming adapter ────────────────────────────────────────────────

export async function callOllama(
  req: ModelRequest,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  onTokens?: TokensCallback,
): Promise<void> {
  if (!req.endpoint) {
    onError(new Error('No endpoint configured for Ollama. Set one in Settings → Models.'));
    return;
  }
  const endpoint = req.endpoint.replace(/\/+$/, '');

  try {
    const resolved = await resolveOllamaModelId(endpoint, req.modelId, req.signal);
    if (!resolved.ok) {
      onError(new Error(resolved.message));
      return;
    }
    const chatModelId = resolved.model;

    const payloadMessages = req.messages.map(ollamaPayloadMessage);
    const payload: Record<string, unknown> = {
      model: chatModelId,
      messages: payloadMessages,
      stream: true,
    };
    const ollamaOpts: Record<string, unknown> = {};
    if (req.maxOutputTokens != null && req.maxOutputTokens > 0) ollamaOpts.num_predict = req.maxOutputTokens;
    if (req.temperature != null) ollamaOpts.temperature = req.temperature;
    if (req.topP != null) ollamaOpts.top_p = req.topP;
    if (req.topK != null) ollamaOpts.top_k = req.topK;
    if (req.frequencyPenalty != null) ollamaOpts.frequency_penalty = req.frequencyPenalty;
    if (req.presencePenalty != null) ollamaOpts.presence_penalty = req.presencePenalty;
    if (req.seed != null) ollamaOpts.seed = req.seed;
    if (Object.keys(ollamaOpts).length) payload.options = ollamaOpts;
    if (req.tools?.length) {
      payload.tools = req.tools;
      if (req.tool_choice === 'required') {
        (payload as { tool_choice?: string }).tool_choice = 'required';
      }
    }
    const res = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: req.signal,
    });

    if (!res.ok) {
      let serverMsg = '';
      try {
        const raw = await res.text();
        const j = JSON.parse(raw) as { error?: string };
        if (typeof j.error === 'string' && j.error.trim()) serverMsg = j.error.trim();
        else if (raw.trim()) serverMsg = raw.trim().slice(0, 280);
      } catch {
        /* ignore */
      }
      const modelHint =
        res.status === 404
          ? ` Request used model "${chatModelId}". If this persists, run ollama list on the server and match that string exactly in Settings.`
          : '';
      const suffix = serverMsg ? ` ${serverMsg}` : '';
      throw new Error(`Ollama ${res.status} ${res.statusText}.${suffix}${modelHint}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullText = '';
    let lineBuf = '';
    const streamedToolAcc = new Map<number, { name: string; arguments: string }>();

    const handleLine = (line: string) => {
      try {
        const parsed = JSON.parse(line) as {
          message?: {
            content?: string;
            thinking?: string;
            tool_calls?: Array<{
              type?: string;
              function?: OllamaStreamFn;
            }>;
          };
          done?: boolean;
          prompt_eval_count?: number;
          eval_count?: number;
          prompt_tokens?: number;
          completion_tokens?: number;
        };
        if (parsed.message?.content) {
          fullText += parsed.message.content;
          onChunk(parsed.message.content);
        }
        // Qwen / Ollama stream tool_calls across many NDJSON lines — merge by function.index.
        if (parsed.message?.tool_calls?.length) {
          mergeOllamaStreamToolChunks(streamedToolAcc, parsed.message.tool_calls);
        }
        if (parsed.done && onTokens) {
          const inputTokens = parsed.prompt_eval_count ?? parsed.prompt_tokens ?? 0;
          const outputTokens = parsed.eval_count ?? parsed.completion_tokens ?? 0;
          if (inputTokens || outputTokens) {
            onTokens({ inputTokens, outputTokens });
          }
        }
      } catch {
        // partial / non-JSON line
      }
    };

    try {
      while (true) {
        if (req.signal?.aborted) {
          await reader.cancel().catch(() => {});
          onError(new DOMException('Request aborted', 'AbortError'));
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        lineBuf = pushStreamLines(lineBuf, decoder.decode(value, { stream: true }), handleLine);
      }
    } finally {
      if (lineBuf.trim()) handleLine(lineBuf.trim());
    }

    const mergedTools = finalizeOllamaStreamTools(streamedToolAcc);
    onDone(
      fullText,
      mergedTools
        ? { toolCalls: mergedTools, providerModelUsed: chatModelId }
        : { providerModelUsed: chatModelId },
    );
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
