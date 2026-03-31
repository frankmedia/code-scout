import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { randomUuid } from '@/utils/randomId';

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Absolute disk path — set when opened via Tauri native dialog */
  absolutePath?: string;
}

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;

  createProject: (name: string) => Project;
  setActiveProject: (id: string) => void;
  closeProject: () => void;
  deleteProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  setProjectAbsolutePath: (id: string, absolutePath: string) => void;
  getActiveProject: () => Project | null;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,

      createProject: (name: string) => {
        const project: Project = {
          id: randomUuid(),
          name: name.trim() || 'Untitled Project',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set(s => ({ projects: [project, ...s.projects], activeProjectId: project.id }));
        void import('@/store/chatHistoryStore').then(({ useChatHistoryStore }) => {
          useChatHistoryStore.getState().initChatHistoryForNewProject(project.id);
        });
        return project;
      },

      setActiveProject: (id: string) => {
        set(s => ({
          activeProjectId: id,
          projects: s.projects.map(p => p.id === id ? { ...p, updatedAt: Date.now() } : p),
        }));
      },

      closeProject: () => set({ activeProjectId: null }),

      deleteProject: (id: string) => {
        set(s => ({
          projects: s.projects.filter(p => p.id !== id),
          activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
        }));
        void import('@/store/chatHistoryStore').then(({ useChatHistoryStore }) => {
          useChatHistoryStore.getState().removeChatHistoryForProject(id);
        });
      },

      renameProject: (id: string, name: string) => {
        set(s => ({
          projects: s.projects.map(p =>
            p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p
          ),
        }));
      },

      setProjectAbsolutePath: (id: string, absolutePath: string) => {
        set(s => ({
          projects: s.projects.map(p =>
            p.id === id ? { ...p, absolutePath, updatedAt: Date.now() } : p
          ),
        }));
      },

      getActiveProject: () => {
        const { projects, activeProjectId } = get();
        return projects.find(p => p.id === activeProjectId) ?? null;
      },
    }),
    { name: 'coder-scout-projects' }
  )
);
