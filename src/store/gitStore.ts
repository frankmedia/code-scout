import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface GitState {
  // GitHub PAT (Personal Access Token) stored locally
  githubToken: string | null;
  githubUser: string | null;
  /** null = unknown (not yet validated), true = valid, false = invalid/expired */
  githubTokenValid: boolean | null;
  // Live git status for the open project
  branch: string | null;
  isDirty: boolean;
  aheadCount: number;
  hasRemote: boolean;
  remoteUrl: string | null;
  // Actions
  setGithubToken: (token: string | null) => void;
  setGithubUser: (user: string | null) => void;
  setGithubTokenValid: (valid: boolean | null) => void;
  setGitStatus: (status: Partial<Pick<GitState, 'branch' | 'isDirty' | 'aheadCount' | 'hasRemote' | 'remoteUrl'>>) => void;
  clearGitStatus: () => void;
}

export const useGitStore = create<GitState>()(
  persist(
    (set) => ({
      githubToken: null,
      githubUser: null,
      githubTokenValid: null,
      branch: null,
      isDirty: false,
      aheadCount: 0,
      hasRemote: false,
      remoteUrl: null,
      setGithubToken: (githubToken) => set({ githubToken, githubTokenValid: null }),
      setGithubUser: (githubUser) => set({ githubUser }),
      setGithubTokenValid: (githubTokenValid) => set({ githubTokenValid }),
      setGitStatus: (status) => set(status),
      clearGitStatus: () => set({ branch: null, isDirty: false, aheadCount: 0, hasRemote: false, remoteUrl: null }),
    }),
    {
      name: 'coder-scout-git',
      partialize: (state) => ({
        githubToken: state.githubToken,
        githubUser: state.githubUser,
        githubTokenValid: state.githubTokenValid,
      }),
    }
  )
);
