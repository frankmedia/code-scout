/**
 * Context Compressor — auto-trims chat history for small-model context windows.
 *
 * Strategies:
 * 1. Sliding window — keep N most recent messages
 * 2. Tool result truncation — shorten verbose tool outputs
 * 3. Old message summarization — collapse early messages into a summary
 * 4. System prompt budget — reserve tokens for system prompt + skeleton
 *
 * Cross-platform: pure logic, no OS-specific code.
 */

import type { ModelRequestMessage } from '@/services/modelApi';
import { roughTokensFromText, roughTokensFromMessageContent, roughTokensFromRequestMessages } from '@/utils/tokenEstimate';

// ─── Config ──────────────────────────────────────────────────────────────────

/** Reserve for model generation (don't fill entire context) */
const GENERATION_RESERVE_RATIO = 0.2; // 20% of context for output
/** Minimum messages to always keep (even if over budget) */
const MIN_RECENT_MESSAGES = 4;
/** Max chars for a single tool result in compressed mode */
const TOOL_RESULT_MAX_CHARS = 2000;
/** Max chars for old user/assistant messages in compressed mode */
const OLD_MESSAGE_MAX_CHARS = 500;

// ─── Token estimation ────────────────────────────────────────────────────────

function messageTokens(msg: ModelRequestMessage): number {
  if (msg.role === 'tool') {
    return roughTokensFromText(msg.content) + 10; // overhead for tool_call_id etc
  }
  if (msg.content === null || msg.content === undefined) return 5;
  return roughTokensFromMessageContent(msg.content) + 5; // role overhead
}

// ─── Truncation helpers ──────────────────────────────────────────────────────

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return text.slice(0, half) + '\n...(truncated)...\n' + text.slice(-half);
}

function truncateToolResult(msg: ModelRequestMessage): ModelRequestMessage {
  if (msg.role !== 'tool') return msg;
  if (msg.content.length <= TOOL_RESULT_MAX_CHARS) return msg;
  return { ...msg, content: truncateText(msg.content, TOOL_RESULT_MAX_CHARS) };
}

function truncateOldMessage(msg: ModelRequestMessage): ModelRequestMessage {
  if (msg.role === 'tool') return truncateToolResult(msg);
  if (msg.content === null || msg.content === undefined) return msg;
  if (typeof msg.content === 'string') {
    if (msg.content.length <= OLD_MESSAGE_MAX_CHARS) return msg;
    return { ...msg, content: truncateText(msg.content, OLD_MESSAGE_MAX_CHARS) };
  }
  // Multimodal — drop images, keep text truncated
  const textParts = msg.content.filter(p => p.type === 'text');
  const combined = textParts.map(p => p.text).join('\n');
  return {
    ...msg,
    content: truncateText(combined, OLD_MESSAGE_MAX_CHARS),
  };
}

// ─── Summarize dropped messages ──────────────────────────────────────────────

function summarizeDropped(messages: ModelRequestMessage[]): string {
  const userMsgs = messages.filter(m => m.role === 'user');
  const assistantMsgs = messages.filter(m => m.role === 'assistant');
  const toolMsgs = messages.filter(m => m.role === 'tool');

  const parts: string[] = ['[Earlier conversation summary]'];
  parts.push(`${userMsgs.length} user messages, ${assistantMsgs.length} assistant responses, ${toolMsgs.length} tool results.`);

  // Extract key topics from user messages
  for (const m of userMsgs.slice(-3)) {
    const text = typeof m.content === 'string' ? m.content
      : Array.isArray(m.content) ? m.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
      : '';
    if (text) {
      const snippet = text.slice(0, 100).replace(/\n/g, ' ').trim();
      parts.push(`- User asked: "${snippet}${text.length > 100 ? '...' : ''}"`);
    }
  }

  // Note tool actions
  const toolNames = new Set<string>();
  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls?.length) {
      for (const tc of m.tool_calls) toolNames.add(tc.function.name);
    }
  }
  if (toolNames.size) {
    parts.push(`Tools used: ${[...toolNames].join(', ')}`);
  }

  return parts.join('\n');
}

// ─── Main compressor ─────────────────────────────────────────────────────────

export interface CompressOptions {
  /** Total context window in tokens */
  contextWindowTokens: number;
  /** Tokens used by system prompt */
  systemPromptTokens: number;
  /** Tokens used by project skeleton/context */
  skeletonTokens: number;
  /** Whether to aggressively compress (for very small models <16k) */
  aggressive?: boolean;
}

/**
 * Compress API messages to fit within the model's context window.
 * Returns the compressed message array ready for the API call.
 */
export function compressMessages(
  messages: ModelRequestMessage[],
  options: CompressOptions,
): ModelRequestMessage[] {
  const { contextWindowTokens, systemPromptTokens, skeletonTokens, aggressive } = options;

  // Available tokens for messages (reserve for generation)
  const availableTokens = Math.floor(
    contextWindowTokens * (1 - GENERATION_RESERVE_RATIO) - systemPromptTokens - skeletonTokens,
  );

  if (availableTokens <= 0) {
    // Context is already full with system prompt — keep only last message
    return messages.slice(-1);
  }

  // First pass: check if everything fits
  const totalTokens = roughTokensFromRequestMessages(messages);
  if (totalTokens <= availableTokens) {
    return messages; // No compression needed
  }

  // Second pass: truncate tool results
  let compressed = messages.map(truncateToolResult);
  if (roughTokensFromRequestMessages(compressed) <= availableTokens) {
    return compressed;
  }

  // Third pass: truncate old messages (keep recent ones intact)
  const recentCount = Math.max(MIN_RECENT_MESSAGES, aggressive ? 2 : 6);
  const recentStart = Math.max(0, compressed.length - recentCount);
  compressed = [
    ...compressed.slice(0, recentStart).map(truncateOldMessage),
    ...compressed.slice(recentStart),
  ];
  if (roughTokensFromRequestMessages(compressed) <= availableTokens) {
    return compressed;
  }

  // Fourth pass: sliding window — drop oldest messages, add summary
  // Keep dropping from the front until we fit
  let dropCount = 0;
  const recent = compressed.slice(recentStart);
  const recentTokens = roughTokensFromRequestMessages(recent);

  if (recentTokens > availableTokens) {
    // Even recent messages are too big — keep only last MIN_RECENT_MESSAGES
    const minimal = compressed.slice(-MIN_RECENT_MESSAGES);
    const summary = summarizeDropped(compressed.slice(0, -MIN_RECENT_MESSAGES));
    return [
      { role: 'user', content: summary },
      { role: 'assistant', content: 'Understood, continuing from where we left off.' },
      ...minimal,
    ];
  }

  // Binary search for how many old messages to drop
  const older = compressed.slice(0, recentStart);
  let lo = 0;
  let hi = older.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = [...older.slice(mid), ...recent];
    if (roughTokensFromRequestMessages(candidate) <= availableTokens) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  dropCount = lo;

  const dropped = older.slice(0, dropCount);
  const kept = older.slice(dropCount);

  if (dropped.length > 0) {
    const summary = summarizeDropped(dropped);
    const summaryTokens = roughTokensFromText(summary) + 30;
    // Only add summary if it fits
    if (roughTokensFromRequestMessages([...kept, ...recent]) + summaryTokens <= availableTokens) {
      return [
        { role: 'user', content: summary },
        { role: 'assistant', content: 'Understood, continuing from the earlier context.' },
        ...kept,
        ...recent,
      ];
    }
    return [...kept, ...recent];
  }

  return compressed;
}

/**
 * Check if compression is needed for a given model context.
 */
export function needsCompression(
  messagesTokens: number,
  systemTokens: number,
  skeletonTokens: number,
  contextWindowTokens: number,
): boolean {
  const available = contextWindowTokens * (1 - GENERATION_RESERVE_RATIO) - systemTokens - skeletonTokens;
  return messagesTokens > available;
}

/**
 * Estimate how much context budget is available for messages.
 */
export function availableMessageBudget(
  systemTokens: number,
  skeletonTokens: number,
  contextWindowTokens: number,
): number {
  return Math.max(
    0,
    Math.floor(contextWindowTokens * (1 - GENERATION_RESERVE_RATIO) - systemTokens - skeletonTokens),
  );
}
