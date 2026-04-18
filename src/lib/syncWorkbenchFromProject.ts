import { useProjectStore } from '@/store/projectStore';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { useProjectMemoryStore } from '@/store/projectMemoryStore';
import { isTauri } from '@/lib/tauri';
import {
  indexProject,
  readIndexFromDisk,
  readAgentMemoryFromDisk,
  resolveEffectiveRoot,
} from '@/services/memoryManager';
import { useAgentMemoryStore } from '@/store/agentMemoryStore';
import {
  probeEnvironment,
  readOrReprobeEnvironment,
  writeEnvironmentCache,
} from '@/services/environmentProbe';
import type { FileNode } from '@/store/workbenchStore';

/**
 * Binds the workbench (file tree, terminal cwd, agent FS root) to the active
 * project's saved folder path. Call when `activeProjectId` is set — including
 * after app restart (project path lives in persisted projectStore; workbench does not).
 *
 * Also triggers project indexing (framework, language, structure detection)
 * so agents are immediately context-aware.
 *
 * Browser: directory handles are not persisted; if the user already picked a folder
 * this session (`dirHandle`), we leave the in-memory tree untouched.
 */
export async function syncWorkbenchRootFromActiveProject(
  projectId: string,
  isCancelled?: () => boolean,
): Promise<void> {
  const project = useProjectStore.getState().projects.find(p => p.id === projectId);
  if (!project) return;

  const wb = useWorkbenchStore.getState();
  wb.setProjectName(project.name);

  const tauriProjectRoot = project.absolutePath || (isTauri() ? wb.projectPath : null) || undefined;

  if (isTauri() && tauriProjectRoot) {
    wb.setProjectPath(tauriProjectRoot);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const entries = await invoke<FileNode[]>('read_project_dir', { path: tauriProjectRoot });
      if (isCancelled?.()) return;
      wb.setFiles(entries);
      await triggerProjectIndex(entries, project.name, tauriProjectRoot);
      // Probe environment immediately on project open — agents need this from the start.
      // Run in background so it doesn't block UI; result stored in workbenchStore.
      triggerEnvironmentProbe(tauriProjectRoot).catch(() => {});
    } catch {
      if (isCancelled?.()) return;
      wb.setProjectPath(null);
      wb.setFiles([]);
    }
    return;
  }

  // Browser path — index whatever files are already loaded
  if (wb.dirHandle) {
    const { files, projectName } = useWorkbenchStore.getState();
    if (files.length > 0) await triggerProjectIndex(files, projectName);
    return;
  }

  wb.setProjectPath(null);
  if (isCancelled?.()) return;
  wb.setFiles([]);
}

/**
 * Probe the environment in the background immediately when a project is opened.
 * Uses cached data if still fresh (<4h); re-probes if stale or missing.
 * Stores result in workbenchStore so all agents can access it without probing again.
 */
async function triggerEnvironmentProbe(projectPath: string): Promise<void> {
  const wb = useWorkbenchStore.getState();
  try {
    const cached = await readOrReprobeEnvironment(projectPath);
    if (cached) {
      wb.setEnvInfo(cached);
      return;
    }
    const fresh = await probeEnvironment(projectPath);
    wb.setEnvInfo(fresh);
    writeEnvironmentCache(projectPath, fresh).catch(() => {});
  } catch {
    // Non-fatal — agents will just have less context
  }
}

/**
 * Kick off project indexing in the background.
 * Sets isIndexing flag so the UI can show an indicator.
 *
 * Desktop (Tauri + projectPath): resolve effective root and `readIndexFromDisk` — if
 * `.codescout/project.json` is missing, always run `indexProject`. If present, skip only when
 * in-memory project memory is still fresh; otherwise reindex.
 *
 * Browser: only reindex when memory is stale or missing (no disk path).
 */
async function triggerProjectIndex(
  files: FileNode[],
  projectName: string,
  projectPath?: string,
): Promise<void> {
  if (!files.length || !projectName) return;
  const memStore = useProjectMemoryStore.getState();

  if (projectPath && isTauri()) {
    const existing = memStore.getMemory(projectName);
    const isStale =
      !existing ||
      existing.isStale ||
      Date.now() - existing.lastIndexed > 30 * 60 * 1000;

    const effectiveRoot = resolveEffectiveRoot(projectPath, files);
    const diskIndex = await readIndexFromDisk(effectiveRoot);
    const codescoutPresentOnDisk =
      diskIndex !== null && typeof diskIndex === 'object';

    // Load agent memory from .codescout/memory.json — always, regardless of index staleness
    readAgentMemoryFromDisk(effectiveRoot).then(disk => {
      if (disk?.length) {
        useAgentMemoryStore.getState().mergeMemoriesFromDisk(disk);
        console.log(`[sync] loaded ${disk.length} agent memories from .codescout/memory.json`);
      }
    }).catch(() => { /* non-fatal */ });

    if (codescoutPresentOnDisk && !isStale) return;

    memStore.setIndexing(true);
    queueMicrotask(() => {
      try {
        indexProject(files, projectName, projectPath);
      } finally {
        useProjectMemoryStore.getState().setIndexing(false);
      }
    });
    return;
  }

  const existing = memStore.getMemory(projectName);
  const isStale =
    !existing ||
    existing.isStale ||
    Date.now() - existing.lastIndexed > 30 * 60 * 1000;
  if (!isStale) return;

  memStore.setIndexing(true);
  queueMicrotask(() => {
    try {
      indexProject(files, projectName, projectPath);
    } finally {
      useProjectMemoryStore.getState().setIndexing(false);
    }
  });
}
