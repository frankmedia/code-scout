/**
 * modeStore.ts — Tracks the current agent mode (Code vs Web)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AgentMode = 'code' | 'web' | 'auto';

export interface ModeStoreState {
  mode: AgentMode;
  setMode: (mode: AgentMode) => void;

  /** Whether web mode tab is enabled/visible */
  webModeEnabled: boolean;
  setWebModeEnabled: (enabled: boolean) => void;
  /** Whether web mode has been set up (dependencies installed) */
  webModeSetupComplete: boolean;
  setWebModeSetupComplete: (complete: boolean) => void;

  /** Browser session state */
  browserActive: boolean;
  setBrowserActive: (active: boolean) => void;
  currentBrowserUrl: string | null;
  setCurrentBrowserUrl: (url: string | null) => void;
  currentBrowserTitle: string | null;
  setCurrentBrowserTitle: (title: string | null) => void;
  lastScreenshot: string | null;
  setLastScreenshot: (screenshot: string | null) => void;
}

export const useModeStore = create<ModeStoreState>()(
  persist(
    (set) => ({
      mode: 'code',
      setMode: (mode) => set({ mode }),

      webModeEnabled: false,
      setWebModeEnabled: (enabled) => set({ webModeEnabled: enabled }),
      webModeSetupComplete: false,
      setWebModeSetupComplete: (complete) => set({ webModeSetupComplete: complete }),

      browserActive: false,
      setBrowserActive: (active) => set({ browserActive: active }),
      currentBrowserUrl: null,
      setCurrentBrowserUrl: (url) => set({ currentBrowserUrl: url }),
      currentBrowserTitle: null,
      setCurrentBrowserTitle: (title) => set({ currentBrowserTitle: title }),
      lastScreenshot: null,
      setLastScreenshot: (screenshot) => set({ lastScreenshot: screenshot }),
    }),
    {
      name: 'code-scout-mode',
      version: 2,
      partialize: (state) => ({
        mode: state.mode,
        webModeEnabled: state.webModeEnabled,
        webModeSetupComplete: state.webModeSetupComplete,
      }),
    }
  )
);
