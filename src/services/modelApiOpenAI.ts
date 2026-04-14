import type { AssistantToolCall } from '@/services/chatTools';
import {
  isOpenAiResponsesApiOnlyModel,
  OPENAI_CHAT_COMPLETIONS_HINT,
} from '@/utils/openAiModelCompat';
import type {
  ModelRequest, ModelRequestMessage, StreamCallback, DoneCallback, ErrorCallback, TokensCallback,
} from './modelApiTypes';
import { pushStreamLines } from './modelApiTypes';

// ─── OpenAI message serialization ────────────────────────────────────────────

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

// ─── Tool call accumulation ──────────────────────────────────────────────────

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

function requestHasImageParts(req: ModelRequest): boolean {
  return req.messages.some(m => {
    if (m.role === 'tool') return false;
    const c = m.content;
    return Array.isArray(c) && c.some(p => p.type === 'image');
  });
}

// ─── OpenAI-compatible streaming adapter ─────────────────────────────────────

export async function callOpenAICompatible(
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

  if (
    isOpenAiResponsesApiOnlyModel(req.modelId) &&
    (req.provider === 'openai' || req.provider === 'openrouter')
  ) {
    onError(new Error(`${OPENAI_CHAT_COMPLETIONS_HINT} (model: ${req.modelId})`));
    return;
  }

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
      const usesCompletionTokens = /^(o\d|gpt-[45]\.\d|gpt-5)/i.test(req.modelId);
      body[usesCompletionTokens ? 'max_completion_tokens' : 'max_tokens'] = req.maxOutputTokens;
    }
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.topP != null) body.top_p = req.topP;
    if (req.frequencyPenalty != null) body.frequency_penalty = req.frequencyPenalty;
    if (req.presencePenalty != null) body.presence_penalty = req.presencePenalty;
    if (req.seed != null) body.seed = req.seed;
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
      const responsesOnly =
        /v1\/responses|only supported in v1\/responses|not in v1\/chat\/completions/i.test(errorBody);
      if (responsesOnly) {
        throw new Error(`${OPENAI_CHAT_COMPLETIONS_HINT}\n\nAPI error ${res.status}: ${errorBody}`);
      }
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

    const toolCalls = finalizeStreamedToolCalls(toolAcc);
    onDone(fullText, toolCalls?.length ? { toolCalls } : undefined);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
