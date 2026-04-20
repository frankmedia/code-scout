/**
 * webSessionStore.ts — Persists web automation sessions similar to chat history
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WebSession {
  id: string;
  title: string;
  task: string;
  url?: string;
  status: 'running' | 'done' | 'error' | 'stopped';
  stepsCount: number;
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
    { name: 'code-scout-web-sessions' },
  ),
);
