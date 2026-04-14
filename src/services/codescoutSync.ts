/**
 * Keeps `.codescout/*` on disk in sync after the agent changes the repo.
 *
 * - project.json, skills.md, context.md — rewritten by indexProject (debounced)
 * - memory.json — agentMemoryStore.scheduleAgentMemoryDiskWrite on memory changes
 * - installs.json — installTracker / agentExecutor on install commands
 * - environment.json — environmentProbe on project open + stale re-probe
 */

import { useWorkbenchStore } from '@/store/workbenchStore';
import { useProjectMemoryStore } from '@/store/projectMemoryStore';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 2500;

/**
 * Queue a full project re-index so Code Scout regenerates `.codescout` metadata.
 * Debounced so many rapid writes (plan steps, tool loop) produce one pass.
 */
export function scheduleCodescoutIndexAfterFileMutation(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void (async () => {
      const wb = useWorkbenchStore.getState();
      const { files, projectName, projectPath } = wb;
      if (!files.length || !projectName) return;
      const { indexProject } = await import('@/services/memoryManager');
      useProjectMemoryStore.getState().markStale(projectName);
      useProjectMemoryStore.getState().setIndexing(true);
      try {
        indexProject(files, projectName, projectPath || undefined);
      } finally {
        useProjectMemoryStore.getState().setIndexing(false);
      }
    })();
  }, DEBOUNCE_MS);
}
