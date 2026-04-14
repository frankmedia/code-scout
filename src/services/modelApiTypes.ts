import type { AssistantToolCall } from '@/services/chatTools';
import type { ModelProvider } from '@/store/modelStore';

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

/** Wall-clock cap for an entire model stream (planning, chat, repair). Prevents infinite hangs when the server never closes SSE. */
export const DEFAULT_MODEL_STREAM_TIMEOUT_MS = 15 * 60 * 1000;

export interface ModelRequest {
  messages: ModelRequestMessage[];
  modelId: string;
  provider: ModelProvider;
  endpoint?: string;
  apiKey?: string;
  /** OpenAI-compatible chat tools (ignored by Ollama adapter unless flattened). */
  tools?: ChatToolDefinition[];
  /** OpenAI-compatible: `required` forces at least one tool call on this request (agent loop uses it after a no-tool reply). */
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  /** When aborted, streaming stops and onError receives an AbortError. */
  signal?: AbortSignal;
  /** OpenAI-compatible / Ollama: cap completion length (benchmarks use this to avoid runaway streams). */
  maxOutputTokens?: number;
  /**
   * Max time (ms) for the full request+stream. Merged with `signal`.
   * Set to `0` to disable (e.g. benchmarks). Default: DEFAULT_MODEL_STREAM_TIMEOUT_MS.
   */
  streamTimeoutMs?: number;
  /** Sampling temperature: 0 = deterministic, higher = more creative. */
  temperature?: number;
  /** Nucleus sampling probability threshold. */
  topP?: number;
  /** Only sample from the top K most likely tokens. */
  topK?: number;
  /** Penalise repeated tokens by frequency. 0 = off. */
  frequencyPenalty?: number;
  /** Penalise tokens that have appeared at all. 0 = off. */
  presencePenalty?: number;
  /** Fixed seed for reproducible outputs. */
  seed?: number;
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

// ─── Shared stream utilities ─────────────────────────────────────────────────

/** Append a chunk; invoke `emit` for each complete \n-terminated line. Returns trailing partial line. */
export function pushStreamLines(buffer: string, chunk: string, emit: (line: string) => void): string {
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

export function joinTextParts(parts: MultimodalContentPart[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('\n');
}

export function anthropicBlocks(content: ModelMessageContent): unknown[] {
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
