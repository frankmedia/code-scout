import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface RepoMap {
  projectName: string;
  primaryLanguage: string;
  framework: string;
  packageManager: string;
  entryPoints: string[];
  importantFiles: string[];
  topLevelFolders: string[];
  runCommands: Record<string, string>;
  architectureNotes: string[];
}

export interface FileSummary {
  purpose: string;
  exports: string[];
  dependsOn: string[];
  riskLevel: 'low' | 'medium' | 'high';
  hash: string;
}

export interface Conventions {
  styling: string;
  routingStyle: string;
  componentPattern: string;
  apiPattern: string;
  notes: string[];
}

export interface ProjectMemory {
  repoMap: RepoMap;
  fileSummaries: Record<string, FileSummary>;
  conventions: Conventions;
  skillMd: string;
  /** Compact skeleton text for all code files (no function bodies) */
  skeletonText: string;
  /** Approximate token count for the skeleton */
  skeletonTokens: number;
  lastIndexed: number;
  isStale: boolean;
}

interface ProjectMemoryState {
  memories: Record<string, ProjectMemory>; // keyed by projectName
  isIndexing: boolean;

  setMemory: (projectName: string, memory: ProjectMemory) => void;
  getMemory: (projectName: string) => ProjectMemory | undefined;
  setIndexing: (indexing: boolean) => void;
  markStale: (projectName: string) => void;
}

export const useProjectMemoryStore = create<ProjectMemoryState>()(
  persist(
    (set, get) => ({
      memories: {},
      isIndexing: false,

      setMemory: (projectName, memory) => set(s => ({
        memories: { ...s.memories, [projectName]: memory },
      })),

      getMemory: (projectName) => get().memories[projectName],

      setIndexing: (isIndexing) => set({ isIndexing }),

      markStale: (projectName) => set(s => {
        const existing = s.memories[projectName];
        if (!existing) return s;
        return {
          memories: { ...s.memories, [projectName]: { ...existing, isStale: true } },
        };
      }),
    }),
    {
      name: 'coder-scout-project-memory',
    }
  )
);
