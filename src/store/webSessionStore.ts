/**
 * webSessionStore.ts — Persists web automation sessions similar to chat history
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WebSessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  screenshot?: string;
  taskCard?: {
    id: string;
    task: string;
    status: 'running' | 'done' | 'error' | 'stopped';
    steps: Array<{
      id: string;
      action: string;
      description: string;
      detail?: string;
      output?: string;
      status: 'pending' | 'running' | 'done' | 'error';
      reason?: string;
    }>;
    result?: string;
    screenshot?: string;
    thinking?: string;
  };
}

export interface WebSession {
  id: string;
  title: string;
  task: string;
  url?: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  stepsCount: number;
  messages: WebSessionMessage[];
  createdAt: number;
  updatedAt: number;
}

interface WebSessionState {
  /** Sessions keyed by project ID */
  sessionsByProject: Record<string, WebSession[]>;
  /** Currently active session per project */
  activeSessionByProject: Record<string, string | null>;
  
  // Actions
  createSession: (projectId: string, task: string) => string;
  updateSession: (projectId: string, sessionId: string, updates: Partial<WebSession>) => void;
  saveMessages: (projectId: string, sessionId: string, messages: WebSessionMessage[]) => void;
  getMessages: (projectId: string, sessionId: string) => WebSessionMessage[];
  deleteSession: (projectId: string, sessionId: string) => void;
  setActiveSession: (projectId: string, sessionId: string | null) => void;
  getSessionsForProject: (projectId: string) => WebSession[];
  clearAllForProject: (projectId: string) => void;
}

function generateId(): string {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateTitle(task: string): string {
  const clean = task.trim().slice(0, 40);
  return clean + (task.length > 40 ? '...' : '');
}

export const useWebSessionStore = create<WebSessionState>()(
  persist(
    (set, get) => ({
      sessionsByProject: {},
      activeSessionByProject: {},

      createSession: (projectId, task) => {
        const id = generateId();
        const session: WebSession = {
          id,
          title: generateTitle(task),
          task,
          status: 'running',
          stepsCount: 0,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        
        set(s => ({
          sessionsByProject: {
            ...s.sessionsByProject,
            [projectId]: [...(s.sessionsByProject[projectId] || []), session],
          },
          activeSessionByProject: {
            ...s.activeSessionByProject,
            [projectId]: id,
          },
        }));
        
        return id;
      },

      updateSession: (projectId, sessionId, updates) => {
        set(s => {
          const sessions = s.sessionsByProject[projectId] || [];
          const idx = sessions.findIndex(sess => sess.id === sessionId);
          if (idx === -1) return s;
          
          const updated = { ...sessions[idx], ...updates, updatedAt: Date.now() };
          const newSessions = [...sessions];
          newSessions[idx] = updated;
          
          return {
            sessionsByProject: {
              ...s.sessionsByProject,
              [projectId]: newSessions,
            },
          };
        });
      },

      saveMessages: (projectId, sessionId, messages) => {
        // Trim heavy data before persisting to avoid localStorage quota errors.
        // Keep only the last 50 messages and strip large output/content from steps.
        const MAX_PERSISTED_MESSAGES = 50;
        const MAX_STEP_OUTPUT = 200;
        const trimmed = messages.slice(-MAX_PERSISTED_MESSAGES).map(m => {
          if (!m.taskCard) return m;
          return {
            ...m,
            taskCard: {
              ...m.taskCard,
              steps: m.taskCard.steps.map(step => ({
                ...step,
                output: step.output && step.output.length > MAX_STEP_OUTPUT
                  ? step.output.slice(0, MAX_STEP_OUTPUT) + '…'
                  : step.output,
              })),
              // Strip large result text
              result: m.taskCard.result && m.taskCard.result.length > 2000
                ? m.taskCard.result.slice(0, 2000) + '…'
                : m.taskCard.result,
              // Never persist screenshots — they're huge base64 strings
              screenshot: undefined,
            },
            screenshot: undefined,
          };
        });

        set(s => {
          const sessions = s.sessionsByProject[projectId] || [];
          const idx = sessions.findIndex(sess => sess.id === sessionId);
          if (idx === -1) return s;

          const newSessions = [...sessions];
          newSessions[idx] = { ...newSessions[idx], messages: trimmed, updatedAt: Date.now() };

          return {
            sessionsByProject: {
              ...s.sessionsByProject,
              [projectId]: newSessions,
            },
          };
        });
      },

      getMessages: (projectId, sessionId) => {
        const sessions = get().sessionsByProject[projectId] || [];
        const session = sessions.find(s => s.id === sessionId);
        return session?.messages || [];
      },

      deleteSession: (projectId, sessionId) => {
        set(s => {
          const sessions = (s.sessionsByProject[projectId] || []).filter(sess => sess.id !== sessionId);
          const activeId = s.activeSessionByProject[projectId];
          
          return {
            sessionsByProject: {
              ...s.sessionsByProject,
              [projectId]: sessions,
            },
            activeSessionByProject: {
              ...s.activeSessionByProject,
              [projectId]: activeId === sessionId ? null : activeId,
            },
          };
        });
      },

      setActiveSession: (projectId, sessionId) => {
        set(s => ({
          activeSessionByProject: {
            ...s.activeSessionByProject,
            [projectId]: sessionId,
          },
        }));
      },

      getSessionsForProject: (projectId) => {
        return get().sessionsByProject[projectId] || [];
      },

      clearAllForProject: (projectId) => {
        set(s => ({
          sessionsByProject: {
            ...s.sessionsByProject,
            [projectId]: [],
          },
          activeSessionByProject: {
            ...s.activeSessionByProject,
            [projectId]: null,
          },
        }));
      },
    }),
    {
      name: 'code-scout-web-sessions',
      storage: {
        getItem: (name) => {
          try {
            const v = localStorage.getItem(name);
            return v ? JSON.parse(v) : null;
          } catch { return null; }
        },
        setItem: (name, value) => {
          try {
            localStorage.setItem(name, JSON.stringify(value));
          } catch (err) {
            // Quota exceeded — prune oldest sessions and retry
            console.warn('[webSessionStore] Storage quota exceeded, pruning old sessions…', err);
            try {
              const raw = localStorage.getItem(name);
              if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed?.state?.sessionsByProject) {
                  for (const pid of Object.keys(parsed.state.sessionsByProject)) {
                    const sessions = parsed.state.sessionsByProject[pid];
                    if (sessions.length > 5) {
                      parsed.state.sessionsByProject[pid] = sessions.slice(-5);
                    }
                  }
                  localStorage.setItem(name, JSON.stringify(parsed));
                }
              }
            } catch { /* give up silently */ }
          }
        },
        removeItem: (name) => { localStorage.removeItem(name); },
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const projectId of Object.keys(state.sessionsByProject)) {
          const sessions = state.sessionsByProject[projectId];
          let changed = false;
          const fixed = sessions.map(s => {
            if (s.status === 'running') {
              changed = true;
              return { ...s, status: 'stopped' as const, updatedAt: Date.now() };
            }
            return s;
          });
          if (changed) {
            state.sessionsByProject[projectId] = fixed;
          }
        }
      },
    },
  ),
);
