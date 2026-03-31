import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { randomUuid } from '@/utils/randomId';
import { ChatMessage, useWorkbenchStore } from './workbenchStore';
import { useProjectStore } from './projectStore';

export interface SavedChat {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export function createWelcomeMessages(): ChatMessage[] {
  return [
    {
      id: randomUuid(),
      role: 'assistant',
      agent: 'orchestrator',
      content:
        "Describe what you want to build and I'll create a step-by-step plan.\n\nI can search the web, fetch docs, write code, and run commands.",
      timestamp: Date.now(),
    },
  ];
}

interface ChatHistoryState {
  chatsByProject: Record<string, SavedChat[]>;
  activeChatByProject: Record<string, string | null>;
  /** True once Zustand persist has finished rehydrating from localStorage. */
  _hasHydrated: boolean;
  _setHasHydrated: (v: boolean) => void;

  saveCurrentChat: (messages: ChatMessage[]) => string;
  loadChat: (id: string) => SavedChat | undefined;
  deleteChat: (id: string) => void;
  renameChat: (id: string, title: string) => void;
  updateChat: (id: string, messages: ChatMessage[]) => void;
  setActiveChatId: (id: string | null) => void;
  /** When opening / switching projects — load that project's active session or welcome. */
  hydrateWorkbenchForProject: (projectId: string) => void;
  /** Wipe saved sessions for a project (call when the project is deleted). */
  removeChatHistoryForProject: (projectId: string) => void;
  /** Empty session list + no active saved chat — call for every newly created project id. */
  initChatHistoryForNewProject: (projectId: string) => void;
}

function requireProjectId(): string | null {
  return useProjectStore.getState().activeProjectId;
}

function chatsForProject(state: ChatHistoryState, projectId: string): SavedChat[] {
  return state.chatsByProject[projectId] ?? [];
}

function generateTitle(messages: ChatMessage[]): string {
  const firstUserMsg = messages.find(m => m.role === 'user');
  if (firstUserMsg) {
    const text = firstUserMsg.content.slice(0, 60);
    return text.length < firstUserMsg.content.length ? text + '...' : text;
  }
  return 'New Chat';
}

function messagesForStorage(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (!m.images?.length) return m;
    const n = m.images.length;
    return {
      ...m,
      images: undefined,
      content: `${m.content.trimEnd()}\n\n_[${n} image(s) not stored in chat history]_`.trim(),
    };
  });
}

export const useChatHistoryStore = create<ChatHistoryState>()(
  persist(
    (set, get) => ({
      chatsByProject: {},
      activeChatByProject: {},
      _hasHydrated: false,
      _setHasHydrated: (v: boolean) => set({ _hasHydrated: v }),

      hydrateWorkbenchForProject: (projectId: string) => {
        const { activeChatByProject, chatsByProject } = get();
        const chats = chatsByProject[projectId] ?? [];
        const chatId = activeChatByProject[projectId] ?? null;
        const wb = useWorkbenchStore.getState();

        if (chatId) {
          const chat = chats.find(c => c.id === chatId);
          if (chat) {
            wb.setMessages(chat.messages);
            wb.setCurrentPlan(null);
            wb.bumpChatSession();
            return;
          }
          set(s => ({
            activeChatByProject: { ...s.activeChatByProject, [projectId]: null },
          }));
        }

        set(s => ({
          activeChatByProject: { ...s.activeChatByProject, [projectId]: null },
        }));
        wb.setMessages(createWelcomeMessages());
        wb.setCurrentPlan(null);
        wb.bumpChatSession();
      },

      removeChatHistoryForProject: (projectId: string) =>
        set(s => {
          const { [projectId]: _chats, ...restChats } = s.chatsByProject;
          const { [projectId]: _active, ...restActive } = s.activeChatByProject;
          return { chatsByProject: restChats, activeChatByProject: restActive };
        }),

      initChatHistoryForNewProject: (projectId: string) =>
        set(s => ({
          chatsByProject: { ...s.chatsByProject, [projectId]: [] },
          activeChatByProject: { ...s.activeChatByProject, [projectId]: null },
        })),

      saveCurrentChat: (messages) => {
        const projectId = requireProjectId();
        if (!projectId) return '';

        const { activeChatByProject, chatsByProject } = get();
        const savedChats = chatsForProject(get(), projectId);
        const activeChatId = activeChatByProject[projectId] ?? null;

        if (activeChatId) {
          const existing = savedChats.find(c => c.id === activeChatId);
          if (existing) {
            const stored = messagesForStorage(messages);
            set({
              chatsByProject: {
                ...chatsByProject,
                [projectId]: savedChats.map(c =>
                  c.id === activeChatId
                    ? { ...c, messages: stored, updatedAt: Date.now(), title: generateTitle(stored) }
                    : c,
                ),
              },
            });
            return activeChatId;
          }
        }

        const id = randomUuid();
        const stored = messagesForStorage(messages);
        const chat: SavedChat = {
          id,
          title: generateTitle(stored),
          messages: stored,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        set({
          chatsByProject: {
            ...chatsByProject,
            [projectId]: [chat, ...savedChats],
          },
          activeChatByProject: {
            ...activeChatByProject,
            [projectId]: id,
          },
        });
        return id;
      },

      loadChat: (id) => {
        const projectId = requireProjectId();
        if (!projectId) return undefined;
        return chatsForProject(get(), projectId).find(c => c.id === id);
      },

      deleteChat: (id) => {
        const projectId = requireProjectId();
        if (!projectId) return;
        const { chatsByProject, activeChatByProject } = get();
        const savedChats = chatsForProject(get(), projectId);
        set({
          chatsByProject: {
            ...chatsByProject,
            [projectId]: savedChats.filter(c => c.id !== id),
          },
          activeChatByProject: {
            ...activeChatByProject,
            [projectId]: activeChatByProject[projectId] === id ? null : activeChatByProject[projectId],
          },
        });
      },

      renameChat: (id, title) => {
        const projectId = requireProjectId();
        if (!projectId) return;
        const { chatsByProject } = get();
        const savedChats = chatsForProject(get(), projectId);
        set({
          chatsByProject: {
            ...chatsByProject,
            [projectId]: savedChats.map(c => (c.id === id ? { ...c, title } : c)),
          },
        });
      },

      updateChat: (id, messages) => {
        const projectId = requireProjectId();
        if (!projectId) return;
        const { chatsByProject } = get();
        const savedChats = chatsForProject(get(), projectId);
        const stored = messagesForStorage(messages);
        set({
          chatsByProject: {
            ...chatsByProject,
            [projectId]: savedChats.map(c =>
              c.id === id
                ? { ...c, messages: stored, updatedAt: Date.now(), title: generateTitle(stored) }
                : c,
            ),
          },
        });
      },

      setActiveChatId: (id) => {
        const projectId = requireProjectId();
        if (!projectId) return;
        set(s => ({
          activeChatByProject: { ...s.activeChatByProject, [projectId]: id },
        }));
      },
    }),
    {
      name: 'coder-scout-chat-history',
      version: 1,
      onRehydrateStorage: () => (state) => {
        state?._setHasHydrated(true);
      },
      migrate: (persisted: unknown, version: number) => {
        const p = persisted as {
          savedChats?: SavedChat[];
          activeChatId?: string | null;
          chatsByProject?: Record<string, SavedChat[]>;
          activeChatByProject?: Record<string, string | null>;
        };
        if (version === 0 && p?.savedChats && Array.isArray(p.savedChats)) {
          let targetProjectId: string | null = null;
          try {
            const raw = localStorage.getItem('coder-scout-projects');
            if (raw) {
              const parsed = JSON.parse(raw) as { state?: { projects?: { id: string; updatedAt?: number }[] } };
              const projects = parsed.state?.projects ?? [];
              if (projects.length > 0) {
                const sorted = [...projects].sort(
                  (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
                );
                targetProjectId = sorted[0].id;
              }
            }
          } catch {
            /* ignore */
          }
          const chatsByProject: Record<string, SavedChat[]> = {};
          const activeChatByProject: Record<string, string | null> = {};
          if (p.savedChats.length > 0) {
            if (targetProjectId) {
              chatsByProject[targetProjectId] = p.savedChats;
              activeChatByProject[targetProjectId] = p.activeChatId ?? null;
            }
          }
          return { chatsByProject, activeChatByProject };
        }
        return {
          chatsByProject: p.chatsByProject ?? {},
          activeChatByProject: p.activeChatByProject ?? {},
        };
      },
      partialize: (state) => ({
        chatsByProject: state.chatsByProject,
        activeChatByProject: state.activeChatByProject,
        // _hasHydrated and _setHasHydrated are intentionally excluded
      }),
    },
  ),
);
