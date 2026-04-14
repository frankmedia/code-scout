import type { ChatImagePart, ChatMessage } from '@/store/workbenchStore';
import type { ModelRequestMessage, MultimodalContentPart } from '@/services/modelApi';
import { formatToolResultForModel } from '@/services/chatTools';

/** Total serialized payload cap — planner requests can be large; trim oldest turns first. */
const DEFAULT_MAX_TOTAL_CHARS = 320_000;
const PER_MESSAGE_MAX_CHARS = 52_000;

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…(truncated)`;
}

/** Flatten tool rounds into assistant-readable text (planner is not continuing tool protocol). */
function assistantPlainText(m: ChatMessage): string {
  let t = m.content.replace(/\r\n/g, '\n').trim();
  if (m.toolInvocations?.length) {
    const blocks = m.toolInvocations.map(inv => {
      const res = formatToolResultForModel(inv);
      return `### ${inv.name} (${inv.status})\n\`\`\`\n${clip(inv.argsJson, 4_000)}\n\`\`\`\n\`\`\`\n${clip(res, 14_000)}\n\`\`\``;
    });
    t = (t ? `${t}\n\n` : '') + '**Tool / action trace (for context)**\n\n' + blocks.join('\n\n');
  }
  if (m.showPlanCard && t.length > 28_000) {
    t = clip(t, 28_000) + '\n…(plan UI message truncated)';
  }
  return t || '(assistant turn — no text)';
}

/**
 * Full Agent session as OpenAI-style messages: user/assistant alternation, multimodal user turns,
 * tool history inlined into assistant text so any provider accepts the sequence.
 */
export function buildPlannerConversationMessages(
  chatMessages: ChatMessage[],
  options?: {
    maxTotalChars?: number;
    /** When the last user message had images but store uses separate `userImages`, merge here. */
    extraImagesForLastUser?: ChatImagePart[];
  },
): ModelRequestMessage[] {
  const maxTotal = options?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const out: ModelRequestMessage[] = [];

  for (const m of chatMessages) {
    if (m.role === 'user') {
      const raw = m.content.replace(/\r\n/g, '\n').trim() || '(see images)';
      const text = clip(raw, PER_MESSAGE_MAX_CHARS);
      const imgs = m.images?.length
        ? m.images
        : undefined;
      if (imgs?.length) {
        const parts: MultimodalContentPart[] = [
          { type: 'text', text },
          ...imgs.map(img => ({
            type: 'image' as const,
            mediaType: img.mediaType,
            dataBase64: img.dataBase64,
          })),
        ];
        out.push({ role: 'user', content: parts });
      } else {
        out.push({ role: 'user', content: text });
      }
    } else {
      out.push({
        role: 'assistant',
        content: clip(assistantPlainText(m), PER_MESSAGE_MAX_CHARS),
      });
    }
  }

  const extra = options?.extraImagesForLastUser;
  if (extra?.length && out.length > 0) {
    const last = out[out.length - 1];
    if (last.role === 'user') {
      const alreadyHasImages =
        typeof last.content !== 'string' &&
        (last.content as MultimodalContentPart[]).some(p => p.type === 'image');
      if (!alreadyHasImages) {
        const text =
          typeof last.content === 'string'
            ? last.content
            : (last.content as MultimodalContentPart[]).find(p => p.type === 'text')?.text ?? '(see images)';
        out[out.length - 1] = {
          role: 'user',
          content: [
            { type: 'text', text },
            ...extra.map(img => ({
              type: 'image' as const,
              mediaType: img.mediaType,
              dataBase64: img.dataBase64,
            })),
          ],
        };
      }
    }
  }

  while (out.length > 0 && out[0].role === 'assistant') {
    out.shift();
  }

  while (out.length > 1) {
    const size = out.reduce((n, msg) => {
      if (typeof msg.content === 'string') return n + msg.content.length;
      return n + JSON.stringify(msg.content).length;
    }, 0);
    if (size <= maxTotal) break;
    out.shift();
    while (out.length > 0 && out[0].role === 'assistant') {
      out.shift();
    }
    // Ensure we always keep at least one user message
    if (out.length === 0) break;
  }

  return out;
}
