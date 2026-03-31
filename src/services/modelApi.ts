import { ModelConfig, ModelProvider, useModelStore } from '@/store/modelStore';
import type { AssistantToolCall } from '@/services/chatTools';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MultimodalContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; dataBase64: string };

export type ModelMessageContent = string | MultimodalContentPart[];

/** Assistant may include OpenAI-style tool_calls; content may be null when only tools are returned. */
export type ModelRequestMessage =
  | { role: 'system'; content: ModelMessageContent }
  | { role: 'user'; content: ModelMessageContent }
  | {
      role: 'assistant';
      content: ModelMessageContent | null;
      tool_calls?: AssistantToolCall[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export type ChatToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export interface ModelRequest {
  messages: ModelRequestMessage[];
  modelId: string;
  provider: ModelProvider;
  endpoint?: string;
  apiKey?: string;
  /** OpenAI-compatible chat tools (ignored by Ollama adapter unless flattened). */
  tools?: ChatToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** When aborted, streaming stops and onError receives an AbortError. */
  signal?: AbortSignal;
  /** OpenAI-compatible / Ollama: cap completion length (benchmarks use this to avoid runaway streams). */
  maxOutputTokens?: number;
}

export interface ModelResponse {
  content: string;
  done: boolean;
}

export type StreamCallback = (chunk: string) => void;

export interface CallModelDoneMeta {
  toolCalls?: AssistantToolCall[];
  /** Ollama: final model name sent to /api/chat after /api/tags resolution. */
  providerModelUsed?: string;
}

export type DoneCallback = (fullText: string, meta?: CallModelDoneMeta) => void;
export type ErrorCallback = (error: Error) => void;
export type TokensCallback = (usage: TokenUsage) => void;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Append a chunk; invoke `emit` for each complete \\n-terminated line. Returns trailing partial line. */
function pushStreamLines(buffer: string, chunk: string, emit: (line: string) => void): string {
  const combined = buffer + chunk;
  const lastNl = combined.lastIndexOf('\n');
  if (lastNl < 0) return combined;
  const head = combined.slice(0, lastNl);
  const tail = combined.slice(lastNl + 1);
  for (const line of head.split('\n')) {
    if (line.length) emit(line);
  }
  return tail;
}

function mergeStreamedToolCalls(
  acc: Map<number, { id?: string; name?: string; arguments: string }>,
  raw: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[],
): void {
  for (const tc of raw) {
    const idx = typeof tc.index === 'number' ? tc.index : 0;
    let cur = acc.get(idx);
    if (!cur) {
      cur = { arguments: '' };
      acc.set(idx, cur);
    }
    if (tc.id) cur.id = tc.id;
    if (tc.function?.name) cur.name = tc.function.name;
    if (tc.function?.arguments) cur.arguments += tc.function.arguments;
  }
}

function finalizeStreamedToolCalls(
  acc: Map<number, { id?: string; name?: string; arguments: string }>,
): AssistantToolCall[] | undefined {
  if (acc.size === 0) return undefined;
  return Array.from(acc.entries())
    .sort(([a], [b]) => a - b)
    .map(([, v]) => ({
      id: v.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      type: 'function' as const,
      function: {
        name: v.name || 'unknown_tool',
        arguments: v.arguments || '{}',
      },
    }));
}

function emitOpenAIUsage(parsed: { usage?: Record<string, unknown> }, onTokens?: TokensCallback): void {
  if (!onTokens || !parsed.usage) return;
  const u = parsed.usage;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  let inputTokens = num(u.prompt_tokens) || num(u.input_tokens) || 0;
  let outputTokens = num(u.completion_tokens) || num(u.output_tokens) || 0;
  const total = num(u.total_tokens);
  if (!inputTokens && !outputTokens && total) {
    outputTokens = total;
  }
  if (inputTokens || outputTokens) {
    onTokens({ inputTokens, outputTokens });
  }
}

// ─── Serialization ───────────────────────────────────────────────────────────

function joinTextParts(parts: MultimodalContentPart[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}

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

function openAICompatibleMessage(m: ModelRequestMessage): Record<string, unknown> {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
  }
  if (m.role === 'assistant' && m.tool_calls?.length) {
    const o: Record<string, unknown> = {
      role: 'assistant',
      tool_calls: m.tool_calls.map(tc => ({
        id: tc.id,
        type: tc.type,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    };
    if (m.content === null || m.content === undefined) {
      o.content = null;
    } else if (typeof m.content === 'string') {
      o.content = m.content.length ? m.content : null;
    } else {
      o.content = m.content.map((p) => {
        if (p.type === 'text') return { type: 'text', text: p.text };
        return {
          type: 'image_url',
          image_url: { url: `data:${p.mediaType};base64,${p.dataBase64}` },
        };
      });
    }
    return o;
  }
  if (m.role === 'system' || m.role === 'user' || m.role === 'assistant') {
    const c = m.content;
    if (typeof c === 'string') {
      return { role: m.role, content: c };
    }
    if (!c) {
      return { role: m.role, content: '' };
    }
    const content = c.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text };
      return {
        type: 'image_url',
        image_url: { url: `data:${p.mediaType};base64,${p.dataBase64}` },
      };
    });
    return { role: m.role, content };
  }
  return { role: 'user', content: '' };
}

function anthropicBlocks(content: ModelMessageContent): unknown[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  const blocks: unknown[] = [];
  for (const p of content) {
    if (p.type === 'text') blocks.push({ type: 'text', text: p.text });
    else {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: p.mediaType, data: p.dataBase64 },
      });
    }
  }
  return blocks;
}

function requestHasImageParts(req: ModelRequest): boolean {
  return req.messages.some(m => {
    if (m.role === 'tool') return false;
    const c = m.content;
    return Array.isArray(c) && c.some(p => p.type === 'image');
  });
}

// ─── Provider Adapters ───────────────────────────────────────────────────────

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
 * Match Settings → model ID to an installed Ollama tag (same host as /api/chat).
 * Avoids opaque HTTP 404 when the name is close but not exact (tags, case, :latest).
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
  // Only one model on the host: use it (built-in defaults rarely match real installs)
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

async function callOllama(
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
    if (req.maxOutputTokens != null && req.maxOutputTokens > 0) {
      payload.options = { num_predict: req.maxOutputTokens };
    }
    // Pass tools if provided — Ollama supports OpenAI-style tool calling
    if (req.tools?.length) {
      payload.tools = req.tools;
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
    // Ollama returns tool_calls in the final message when tools are used
    let ollamaToolCalls: AssistantToolCall[] | undefined;

    const handleLine = (line: string) => {
      try {
        const parsed = JSON.parse(line) as {
          message?: {
            content?: string;
            tool_calls?: Array<{
              function: { name: string; arguments: Record<string, unknown> | string };
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
        // Capture tool_calls from Ollama response
        if (parsed.message?.tool_calls?.length) {
          ollamaToolCalls = parsed.message.tool_calls.map((tc, i) => ({
            id: `call_ollama_${Date.now()}_${i}`,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments),
            },
          }));
        }
        if (parsed.done && onTokens) {
          const inputTokens =
            parsed.prompt_eval_count ??
            parsed.prompt_tokens ??
            0;
          const outputTokens =
            parsed.eval_count ??
            parsed.completion_tokens ??
            0;
          if (inputTokens || outputTokens) {
            onTokens({ inputTokens, outputTokens });
          }
        }
      } catch {
        // partial / non-JSON line
      }
    };

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
    if (lineBuf.trim()) handleLine(lineBuf.trim());

    onDone(
      fullText,
      ollamaToolCalls
        ? { toolCalls: ollamaToolCalls, providerModelUsed: chatModelId }
        : { providerModelUsed: chatModelId },
    );
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

async function callOpenAICompatible(
  req: ModelRequest,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  onTokens?: TokensCallback,
): Promise<void> {
  if (req.provider === 'google' && requestHasImageParts(req)) {
    onError(
      new Error(
        'Image attachments are not supported for Google Gemini in this app yet. Use OpenAI-compatible, Anthropic, Ollama, or LM Studio.',
      ),
    );
    return;
  }

  const endpoint = (req.endpoint || 'https://api.openai.com/v1').replace(/\/+$/, '');

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (req.apiKey) headers['Authorization'] = `Bearer ${req.apiKey}`;
    if (req.provider === 'openrouter') {
      headers['HTTP-Referer'] = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
      headers['X-Title'] = 'Code Scout';
    }

    const payloadMessages = req.messages.map(openAICompatibleMessage);

    const body: Record<string, unknown> = {
      model: req.modelId,
      messages: payloadMessages,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.maxOutputTokens != null && req.maxOutputTokens > 0) {
      body.max_tokens = req.maxOutputTokens;
    }
    if (req.tools?.length) {
      body.tools = req.tools;
      body.tool_choice = req.tool_choice ?? 'auto';
    }

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`API error ${res.status}: ${errorBody}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullText = '';
    let lineBuf = '';
    const toolAcc = new Map<number, { id?: string; name?: string; arguments: string }>();

    const handleLine = (line: string) => {
      if (!line.startsWith('data: ')) return;
      const data = line.slice(6).trimStart();
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data) as {
          choices?: {
            delta?: {
              content?: string;
              tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
            };
            message?: {
              tool_calls?: { id: string; type?: string; function: { name: string; arguments: string } }[];
            };
          }[];
          usage?: Record<string, unknown>;
        };
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        const content = delta?.content;
        if (content) {
          fullText += content;
          onChunk(content);
        }
        if (delta?.tool_calls?.length) {
          mergeStreamedToolCalls(toolAcc, delta.tool_calls);
        }
        const msgCalls = choice?.message?.tool_calls;
        if (msgCalls?.length) {
          toolAcc.clear();
          msgCalls.forEach((tc, i) => {
            toolAcc.set(i, {
              id: tc.id,
              name: tc.function.name,
              arguments: tc.function.arguments || '',
            });
          });
        }
        emitOpenAIUsage(parsed, onTokens);
      } catch {
        // partial SSE JSON
      }
    };

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
    if (lineBuf.trim()) handleLine(lineBuf.trim());

    const toolCalls = finalizeStreamedToolCalls(toolAcc);
    onDone(fullText, toolCalls?.length ? { toolCalls } : undefined);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

async function callAnthropic(
  req: ModelRequest,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  onTokens?: TokensCallback,
): Promise<void> {
  const endpoint = (req.endpoint || 'https://api.anthropic.com').replace(/\/+$/, '');

  try {
    if (!req.apiKey) throw new Error('Anthropic API key required');

    const systemMsg = req.messages.find(m => m.role === 'system');
    const conversationMsgs = req.messages.filter(m => m.role !== 'system');

    const anthropicBlocksFromRequest = (m: ModelRequestMessage): unknown[] => {
      if (m.role === 'tool') {
        return [{ type: 'text', text: `[tool ${m.tool_call_id}]\n${m.content}` }];
      }
      if (m.role === 'assistant' && m.tool_calls?.length) {
        const summary = m.tool_calls
          .map(tc => `${tc.function.name}(${tc.function.arguments})`)
          .join('\n');
        const head =
          typeof m.content === 'string' && m.content.trim() ? m.content : '(used tools)';
        return [{ type: 'text', text: `${head}\n[tool_calls]\n${summary}` }];
      }
      if (m.role === 'user' || m.role === 'assistant') {
        const c = m.content;
        if (typeof c === 'string') return anthropicBlocks(c);
        if (!c) return [{ type: 'text', text: '' }];
        return anthropicBlocks(c);
      }
      return [{ type: 'text', text: '' }];
    };

    const body: Record<string, unknown> = {
      model: req.modelId,
      max_tokens: 4096,
      stream: true,
      messages: conversationMsgs.map(m => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: anthropicBlocksFromRequest(m),
      })),
    };
    if (systemMsg) {
      body.system = typeof systemMsg.content === 'string'
        ? systemMsg.content
        : joinTextParts(systemMsg.content);
    }

    const res = await fetch(`${endpoint}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': req.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${errorBody}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let lineBuf = '';

    const handleLine = (line: string) => {
      if (!line.startsWith('data: ')) return;
      try {
        const parsed = JSON.parse(line.slice(6)) as {
          type?: string;
          delta?: { text?: string };
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
          usage?: { output_tokens?: number };
        };
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          fullText += parsed.delta.text;
          onChunk(parsed.delta.text);
        }
        if (parsed.type === 'message_start' && parsed.message?.usage) {
          inputTokens = parsed.message.usage.input_tokens ?? inputTokens;
          const o = parsed.message.usage.output_tokens;
          if (typeof o === 'number') outputTokens = o;
        }
        if (parsed.type === 'message_delta' && parsed.usage?.output_tokens != null) {
          outputTokens = parsed.usage.output_tokens;
        }
      } catch {
        // partial SSE JSON
      }
    };

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
    if (lineBuf.trim()) handleLine(lineBuf.trim());

    if (onTokens && (inputTokens || outputTokens)) {
      onTokens({ inputTokens, outputTokens });
    }
    onDone(fullText);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

function getAdapter(provider: ModelProvider) {
  switch (provider) {
    case 'ollama':
      return callOllama;
    case 'lm-studio':
    case 'llama-cpp':
    case 'openai':
    case 'google':
    case 'openrouter':
    case 'custom':
      return callOpenAICompatible;
    case 'anthropic':
      return callAnthropic;
    default:
      return callOpenAICompatible;
  }
}

export function callModel(
  req: ModelRequest,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  onTokens?: TokensCallback,
): void {
  const adapter = getAdapter(req.provider);
  adapter(req, onChunk, onDone, onError, onTokens);
}

/** Merge persisted Discover URLs / API keys into the request payload */
export function modelToRequest(
  model: ModelConfig,
  messages: ModelRequestMessage[],
  extras?: Pick<ModelRequest, 'tools' | 'tool_choice' | 'signal' | 'maxOutputTokens'>,
): ModelRequest {
  const { endpoint, apiKey } = useModelStore.getState().resolveModelRequestFields(model);
  return {
    messages,
    modelId: model.modelId,
    provider: model.provider,
    endpoint,
    apiKey,
    tools: extras?.tools,
    tool_choice: extras?.tool_choice,
    signal: extras?.signal,
    maxOutputTokens: extras?.maxOutputTokens,
  };
}

// ─── Connection Check ────────────────────────────────────────────────────────

export async function checkConnection(
  provider: ModelProvider,
  endpoint?: string,
  apiKey?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    switch (provider) {
      case 'ollama': {
        if (!endpoint) return { ok: false, error: 'No endpoint — open Settings → Discover to configure' };
        const base = endpoint.replace(/\/+$/, '');
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return { ok: true };
      }
      case 'lm-studio':
      case 'llama-cpp':
      case 'custom': {
        if (!endpoint) return { ok: false, error: 'No endpoint configured' };
        const res = await fetch(`${base}/models`, {
          signal: AbortSignal.timeout(3000),
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        });
        if (!res.ok) throw new Error(`${res.status}`);
        return { ok: true };
      }
      case 'openai': {
        if (!apiKey) return { ok: false, error: 'API key required' };
        const res = await fetch('https://api.openai.com/v1/models', {
          signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(`${res.status}`);
        return { ok: true };
      }
      case 'anthropic': {
        if (!apiKey) return { ok: false, error: 'API key required' };
        return { ok: true };
      }
      case 'google': {
        if (!apiKey) return { ok: false, error: 'API key required' };
        return { ok: true };
      }
      case 'groq': {
        if (!apiKey) return { ok: false, error: 'Groq API key required' };
        const res = await fetch('https://api.groq.com/openai/v1/models', {
          signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(`${res.status}`);
        return { ok: true };
      }
      case 'mistral': {
        if (!apiKey) return { ok: false, error: 'Mistral API key required' };
        const res = await fetch('https://api.mistral.ai/v1/models', {
          signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(`${res.status}`);
        return { ok: true };
      }
      case 'deepseek': {
        if (!apiKey) return { ok: false, error: 'DeepSeek API key required' };
        return { ok: true };
      }
      case 'openrouter': {
        if (!apiKey) return { ok: false, error: 'OpenRouter API key required' };
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          signal: AbortSignal.timeout(8000),
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return { ok: true };
      }
      default:
        return { ok: false, error: 'Unknown provider' };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}
