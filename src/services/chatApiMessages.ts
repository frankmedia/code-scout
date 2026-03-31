import type { ChatMessage, ToolInvocation } from '@/store/workbenchStore';
import type { ModelRequestMessage, MultimodalContentPart } from '@/services/modelApi';
import { formatToolResultForModel } from '@/services/chatTools';

function userToApi(m: ChatMessage): ModelRequestMessage {
  if (!m.images?.length) {
    return { role: 'user', content: m.content };
  }
  const parts: MultimodalContentPart[] = [
    { type: 'text', text: m.content.trim() || '(see images)' },
  ];
  for (const img of m.images) {
    parts.push({ type: 'image', mediaType: img.mediaType, dataBase64: img.dataBase64 });
  }
  return { role: 'user', content: parts };
}

function allInvocationsResolved(inv: ToolInvocation[] | undefined): boolean {
  if (!inv?.length) return true;
  return inv.every(t =>
    t.status === 'completed' || t.status === 'failed' || t.status === 'rejected',
  );
}

/** Check if any invocations are still pending or running. */
function hasActiveInvocations(inv: ToolInvocation[] | undefined): boolean {
  if (!inv?.length) return false;
  return inv.some(t =>
    t.status === 'pending_user' || t.status === 'auto_queued' || t.status === 'running',
  );
}

/**
 * Convert stored chat to API messages. Stops before an assistant message that still has pending tool approvals.
 */
export function chatMessagesToApiMessages(messages: ChatMessage[]): ModelRequestMessage[] {
  const out: ModelRequestMessage[] = [];

  for (const m of messages) {
    if (m.role === 'user') {
      out.push(userToApi(m));
      continue;
    }

    if (!m.toolInvocations?.length) {
      out.push({ role: 'assistant', content: m.content });
      continue;
    }

    if (!allInvocationsResolved(m.toolInvocations) || hasActiveInvocations(m.toolInvocations)) {
      break;
    }

    out.push({
      role: 'assistant',
      content: m.content.trim() ? m.content : null,
      tool_calls: m.toolInvocations.map(t => ({
        id: t.id,
        type: 'function' as const,
        function: { name: t.name, arguments: t.argsJson },
      })),
    });

    for (const t of m.toolInvocations) {
      out.push({
        role: 'tool',
        tool_call_id: t.id,
        content: formatToolResultForModel(t),
      });
    }
  }

  return out;
}
