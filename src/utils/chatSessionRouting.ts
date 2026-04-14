import { randomUuid } from '@/utils/randomId';
import { useChatHistoryStore } from '@/store/chatHistoryStore';
import { useProjectStore } from '@/store/projectStore';
import { useWorkbenchStore, type ChatMessage } from '@/store/workbenchStore';

export function getActiveChatIdForProject(): string | null {
  const projectId = useProjectStore.getState().activeProjectId;
  if (!projectId) return null;
  return useChatHistoryStore.getState().activeChatByProject[projectId] ?? null;
}

/** Messages for API/UI context for a session (workbench vs saved chat). */
export function getChatTranscriptForSession(sessionId: string | null | undefined): ChatMessage[] {
  const st = useWorkbenchStore.getState();
  if (!sessionId) return st.messages;
  if (isWorkbenchShowingSession(sessionId)) return st.messages;
  return useChatHistoryStore.getState().loadChat(sessionId)?.messages ?? st.messages;
}

/** True if the given session is the one currently shown in the workbench chat. */
export function isWorkbenchShowingSession(sessionId: string | null | undefined): boolean {
  if (!sessionId) return true;
  return getActiveChatIdForProject() === sessionId;
}

/**
 * Append an assistant/user message to the correct transcript — active workbench vs background saved chat.
 */
export function appendChatMessageForSession(
  sessionId: string | null,
  msg: Omit<ChatMessage, 'id' | 'timestamp'>,
): void {
  if (!sessionId) {
    useWorkbenchStore.getState().addMessage(msg);
    return;
  }
  const activeId = getActiveChatIdForProject();
  if (activeId === sessionId) {
    useWorkbenchStore.getState().addMessage(msg);
    return;
  }
  const chat = useChatHistoryStore.getState().loadChat(sessionId);
  if (!chat) return;
  const row: ChatMessage = {
    ...msg,
    id: randomUuid(),
    timestamp: Date.now(),
  };
  useChatHistoryStore.getState().updateChat(sessionId, [...chat.messages, row]);
}

export function getLastChatMessageForSession(sessionId: string | null): ChatMessage | undefined {
  if (!sessionId || isWorkbenchShowingSession(sessionId)) {
    return useWorkbenchStore.getState().messages.at(-1);
  }
  const chat = useChatHistoryStore.getState().loadChat(sessionId);
  return chat?.messages.at(-1);
}

export function patchMessageInSession(
  sessionId: string | null,
  messageId: string,
  fn: (prev: ChatMessage) => ChatMessage,
): void {
  if (!sessionId) {
    useWorkbenchStore.getState().updateMessage(messageId, fn);
    return;
  }
  const activeId = getActiveChatIdForProject();
  if (activeId === sessionId) {
    useWorkbenchStore.getState().updateMessage(messageId, fn);
    return;
  }
  const chat = useChatHistoryStore.getState().loadChat(sessionId);
  if (!chat) return;
  const next = chat.messages.map(m => (m.id === messageId ? fn(m) : m));
  useChatHistoryStore.getState().updateChat(sessionId, next);
}
