import type { AssistantToolCall } from '@/services/chatTools';
import type {
  ModelRequest, ModelRequestMessage, StreamCallback, DoneCallback, ErrorCallback, TokensCallback,
  ModelMessageContent,
} from './modelApiTypes';
import { pushStreamLines, anthropicBlocks, joinTextParts } from './modelApiTypes';

// ─── Anthropic streaming adapter ─────────────────────────────────────────────

export async function callAnthropic(
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
    if (req.temperature != null) body.temperature = req.temperature;
    if (req.topP != null) body.top_p = req.topP;
    if (req.topK != null) body.top_k = req.topK;
    if (systemMsg) {
      body.system = typeof systemMsg.content === 'string'
        ? systemMsg.content
        : joinTextParts(systemMsg.content as any);
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
    const toolUseBlocks: { id: string; name: string; inputJson: string }[] = [];
    let currentToolBlockIndex = -1;

    const handleLine = (line: string) => {
      if (!line.startsWith('data: ')) return;
      try {
        const parsed = JSON.parse(line.slice(6)) as {
          type?: string;
          index?: number;
          content_block?: { type?: string; id?: string; name?: string };
          delta?: { type?: string; text?: string; partial_json?: string };
          message?: { usage?: { input_tokens?: number; output_tokens?: number } };
          usage?: { output_tokens?: number };
        };
        if (parsed.type === 'content_block_start' && parsed.content_block?.type === 'tool_use') {
          currentToolBlockIndex = parsed.index ?? toolUseBlocks.length;
          toolUseBlocks.push({
            id: parsed.content_block.id ?? `call_anthropic_${Date.now()}_${toolUseBlocks.length}`,
            name: parsed.content_block.name ?? 'unknown_tool',
            inputJson: '',
          });
        }
        if (parsed.type === 'content_block_delta') {
          if (parsed.delta?.type === 'text_delta' && parsed.delta.text) {
            fullText += parsed.delta.text;
            onChunk(parsed.delta.text);
          }
          if (parsed.delta?.type === 'input_json_delta' && parsed.delta.partial_json != null) {
            const block = toolUseBlocks[toolUseBlocks.length - 1];
            if (block) block.inputJson += parsed.delta.partial_json;
          }
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

    if (onTokens && (inputTokens || outputTokens)) {
      onTokens({ inputTokens, outputTokens });
    }

    const anthropicToolCalls: AssistantToolCall[] | undefined = toolUseBlocks.length > 0
      ? toolUseBlocks.map(b => ({
          id: b.id,
          type: 'function' as const,
          function: { name: b.name, arguments: b.inputJson || '{}' },
        }))
      : undefined;
    onDone(fullText, anthropicToolCalls ? { toolCalls: anthropicToolCalls } : undefined);
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
  }
}
