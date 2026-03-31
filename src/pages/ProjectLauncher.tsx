import { useState } from 'react';
import {
  Zap, Plus, FolderOpen, GitBranch, Trash2, ArrowRight,
  Clock, Loader2, AlertCircle, X,
} from 'lucide-react';
import { useProjectStore } from '@/store/projectStore';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { useProjectMemoryStore } from '@/store/projectMemoryStore';
import { useAgentMemoryStore } from '@/store/agentMemoryStore';
import {
  indexProject,
  readAgentMemoryFromDisk,
  readIndexFromDisk,
  resolveEffectiveRoot,
} from '@/services/memoryManager';
import {
  openDirectory,
  createProjectDirectory,
  cloneRepository,
  isFSAccessSupported,
  CloneProgress,
} from '@/services/fileSystemService';
import { isTauri, openDirectoryNative, cloneRepositoryNative } from '@/lib/tauri';

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── Clone Modal ──────────────────────────────────────────────────────────────

interface CloneModalProps {
  onClose: () => void;
  onCloned: (projectName: string) => void;
}

const CloneModal = ({ onClose, onCloned }: CloneModalProps) => {
  const { createProject, setProjectAbsolutePath: setProjAbsPath } = useProjectStore();
  const { setProjectName, setDirHandle, setFiles, setProjectPath } = useWorkbenchStore();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [progress, setProgress] = useState<CloneProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cloning, setCloning] = useState(false);

  const handleClone = async () => {
    if (!url.trim()) return;
    const repoName = name.trim() || url.split('/').pop()?.replace(/\.git$/, '') || 'cloned-repo';
    setError(null);
    setCloning(true);
    setProgressLines([]);
    try {
      if (isTauri()) {
        // Native git clone — no CORS proxy, any path on disk
        const result = await cloneRepositoryNative(url.trim(), repoName, (line) => {
          setProgressLines(prev => [...prev, line]);
          setProgress({ phase: line, loaded: 0, total: 0 });
        });
        const project = createProject(result.projectName);
        setProjAbsPath(project.id, result.absolutePath);
        setProjectName(result.projectName);
        setProjectPath(result.absolutePath);
        setFiles(result.files);
        // Auto-index cloned project
        if (result.files.length > 0) {
          useProjectMemoryStore.getState().setIndexing(true);
          queueMicrotask(() => {
            try { indexProject(result.files, result.projectName, result.absolutePath); }
            finally { useProjectMemoryStore.getState().setIndexing(false); }
          });
        }
        onCloned(project.id);
      } else {
        // Browser fallback — isomorphic-git via CORS proxy
        const result = await cloneRepository(url.trim(), repoName, setProgress);
        const project = createProject(result.projectName);
        setProjectName(result.projectName);
        setDirHandle(result.handle);
        setFiles(result.files);
        onCloned(project.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Clone failed');
      setCloning(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Clone Git Repository</span>
          </div>
          <button
            onClick={onClose}
            disabled={cloning}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">Repository URL</label>
            <input
              autoFocus
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !cloning && handleClone()}
              placeholder="https://github.com/username/repo"
              disabled={cloning}
              className="w-full bg-input text-foreground text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground disabled:opacity-60"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground font-medium">
              Project name <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={url.split('/').pop()?.replace(/\.git$/, '') || 'my-project'}
              disabled={cloning}
              className="w-full bg-input text-foreground text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground disabled:opacity-60"
            />
          </div>

          {cloning && isTauri() && progressLines.length > 0 && (
            <div className="rounded-md bg-secondary/50 p-2 max-h-24 overflow-y-auto font-mono text-[10px] text-muted-foreground space-y-0.5">
              {progressLines.slice(-10).map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}

          {progress && !isTauri() && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{progress.phase}</span>
                {progress.total > 0 && (
                  <span>{Math.round((progress.loaded / progress.total) * 100)}%</span>
                )}
              </div>
              <div className="h-1 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{
                    width: progress.total > 0
                      ? `${Math.round((progress.loaded / progress.total) * 100)}%`
                      : '100%',
                    animation: progress.total === 0 ? 'pulse 1.5s infinite' : undefined,
                  }}
                />
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={cloning}
            className="px-4 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleClone}
            disabled={!url.trim() || cloning}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/80 transition-colors disabled:opacity-40"
          >
            {cloning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
            {cloning ? 'Cloning...' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Launcher ────────────────────────────────────────────────────────────

const ProjectLauncher = () => {
  const { projects, createProject, setActiveProject, deleteProject, setProjectAbsolutePath } = useProjectStore();
  const { setProjectName, setDirHandle, setFiles, setProjectPath } = useWorkbenchStore();
  const [newName, setNewName] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [showClone, setShowClone] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [fsError, setFsError] = useState<string | null>(null);

  const fsSupported = isTauri() || isFSAccessSupported();

  const handleCreate = async () => {
    const name = newName.trim() || 'My Project';
    setFsError(null);

    if (isTauri()) {
      // Tauri: use native dialog to pick parent dir, create subdirectory, set projectPath
      setLoading('Creating project directory...');
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const { invoke } = await import('@tauri-apps/api/core');
        const parentDir = await open({ directory: true, multiple: false });
        if (!parentDir || typeof parentDir !== 'string') {
          // User cancelled — fall back to in-memory
          const project = createProject(name);
          setProjectName(project.name);
          setNewName('');
          setShowInput(false);
          setLoading(null);
          return;
        }
        const sep = parentDir.includes('\\') ? '\\' : '/';
        const projectDir = `${parentDir}${sep}${name}`;
        await invoke('create_dir', { path: projectDir });
        const entries = await invoke<any[]>('read_project_dir', { path: projectDir });
        const project = createProject(name);
        setProjectAbsolutePath(project.id, projectDir);
        setProjectName(name);
        setProjectPath(projectDir);
        setFiles(entries);
        setActiveProject(project.id);
      } catch (e) {
        if ((e as any)?.name === 'AbortError') {
          const project = createProject(name);
          setProjectName(project.name);
        } else {
          setFsError(e instanceof Error ? e.message : 'Failed to create directory');
        }
      } finally {
        setLoading(null);
      }
    } else if (fsSupported) {
      setLoading('Creating project directory...');
      try {
        const result = await createProjectDirectory(name);
        const project = createProject(result.projectName);
        setProjectName(result.projectName);
        setDirHandle(result.handle);
        setFiles([]);
      } catch (e) {
        if ((e as any)?.name === 'AbortError') {
          const project = createProject(name);
          setProjectName(project.name);
        } else {
          setFsError(e instanceof Error ? e.message : 'Failed to create directory');
        }
      } finally {
        setLoading(null);
      }
    } else {
      const project = createProject(name);
      setProjectName(project.name);
    }

    setNewName('');
    setShowInput(false);
  };

  const handleOpenFolder = async () => {
    setFsError(null);
    setLoading('Opening folder...');
    try {
      if (isTauri()) {
        const result = await openDirectoryNative();
        const proj = createProject(result.projectName);
        setProjectAbsolutePath(proj.id, result.absolutePath);
        setProjectName(result.projectName);
        setProjectPath(result.absolutePath);
        setFiles(result.files);
        // Auto-index immediately and write .codescout/project.json
        if (result.files.length > 0) {
          useProjectMemoryStore.getState().setIndexing(true);
          queueMicrotask(() => {
            try { indexProject(result.files, result.projectName, result.absolutePath); }
            finally { useProjectMemoryStore.getState().setIndexing(false); }
          });
        }
        const effectiveRoot = resolveEffectiveRoot(result.absolutePath, result.files);
        void readAgentMemoryFromDisk(effectiveRoot).then(disk => {
          if (disk?.length) useAgentMemoryStore.getState().mergeMemoriesFromDisk(disk);
        });
      } else {
        if (!isFSAccessSupported()) {
          setFsError('File System Access API not supported — install the desktop app for full filesystem access.');
          return;
        }
        const result = await openDirectory();
        createProject(result.projectName);
        setProjectName(result.projectName);
        setDirHandle(result.handle);
        setFiles(result.files);
      }
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') {
        setFsError(e instanceof Error ? e.message : 'Failed to open folder');
      }
    } finally {
      setLoading(null);
    }
  };

  const handleOpen = async (id: string) => {
    const project = projects.find(p => p.id === id);
    if (!project) return;
    setActiveProject(id);
    setProjectName(project.name);

    // Restore projectPath and reload files from disk if we have an absolute path
    if (project.absolutePath && isTauri()) {
      setProjectPath(project.absolutePath);
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const entries = await invoke<any[]>('read_project_dir', { path: project.absolutePath });
        setFiles(entries);

        const effectiveRoot = resolveEffectiveRoot(project.absolutePath, entries);
        const diskIndex = await readIndexFromDisk(effectiveRoot);
        const needsCodescoutOnDisk = diskIndex === null;

        // Auto-index when stale OR when .codescout/project.json is missing (create + populate on disk)
        if (entries.length > 0) {
          const existingMemory = useProjectMemoryStore.getState().getMemory(project.name);
          const isStale = !existingMemory || existingMemory.isStale || (Date.now() - existingMemory.lastIndexed > 30 * 60 * 1000);
          if (isStale || needsCodescoutOnDisk) {
            useProjectMemoryStore.getState().setIndexing(true);
            queueMicrotask(() => {
              try { indexProject(entries, project.name, project.absolutePath); }
              finally { useProjectMemoryStore.getState().setIndexing(false); }
            });
          }
        }
        void readAgentMemoryFromDisk(effectiveRoot).then(disk => {
          if (disk?.length) useAgentMemoryStore.getState().mergeMemoriesFromDisk(disk);
        });
      } catch (e) {
        console.warn('[ProjectLauncher] Could not reload files from', project.absolutePath, e);
        // Path may no longer exist — clear it so the user knows to re-open
        setProjectPath(null as any);
      }
    }
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteProject(id);
  };

  const handleCloned = (projectId: string) => {
    setShowClone(false);
    setActiveProject(projectId);
  };

  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <>
      {showClone && <CloneModal onClose={() => setShowClone(false)} onCloned={handleCloned} />}

      <div className="h-screen bg-background flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="h-11 border-b border-border flex items-center px-6 shrink-0">
          <div className="flex items-center gap-1.5">
            <Zap className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm text-foreground tracking-tight">Code Scout</span>
            <span className="text-xs text-primary font-medium">AI</span>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left — Start section */}
          <div className="w-80 shrink-0 border-r border-border flex flex-col p-6 gap-4 overflow-y-auto">
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Start</h2>

              <div className="space-y-1.5">
                {/* New Project */}
                <div>
                  {showInput ? (
                    <div className="rounded-lg border border-primary/50 bg-card p-3 space-y-2">
                      <p className="text-xs text-muted-foreground font-medium">Project name</p>
                      <input
                        autoFocus
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleCreate();
                          if (e.key === 'Escape') { setShowInput(false); setNewName(''); }
                        }}
                        placeholder="My Project"
                        className="w-full bg-input text-foreground text-sm rounded-md px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                      />
                      {fsSupported && (
                        <p className="text-[10px] text-muted-foreground">
                          You'll be asked to choose where to create this folder on your PC.
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={handleCreate}
                          className="flex-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/80 transition-colors"
                        >
                          Create
                        </button>
                        <button
                          onClick={() => { setShowInput(false); setNewName(''); }}
                          className="px-3 py-1.5 rounded-md bg-secondary text-secondary-foreground text-xs hover:bg-surface-hover transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowInput(true)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-hover transition-colors group text-left"
                    >
                      <div className="w-8 h-8 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
                        <Plus className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">New Project</p>
                        <p className="text-[10px] text-muted-foreground">Create a project folder on your PC</p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  )}
                </div>

                {/* Open Folder */}
                <button
                  onClick={handleOpenFolder}
                  disabled={!!loading}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-hover transition-colors group text-left disabled:opacity-60"
                >
                  <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center shrink-0">
                    {loading === 'Opening folder...'
                      ? <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />
                      : <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    }
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Open Folder</p>
                    <p className="text-[10px] text-muted-foreground">
                      {fsSupported ? 'Open an existing directory from your PC' : 'Requires Chrome or Edge'}
                    </p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>

                {/* Clone Repository */}
                <button
                  onClick={() => setShowClone(true)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-hover transition-colors group text-left"
                >
                  <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center shrink-0">
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Clone Git Repo</p>
                    <p className="text-[10px] text-muted-foreground">Download a repo to your PC</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </div>

              {fsError && (
                <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">{fsError}</p>
                </div>
              )}
            </div>

            {/* Version info */}
            <div className="mt-auto pt-4 border-t border-border">
              <p className="text-[10px] text-muted-foreground">Code Scout AI · v0.1.0</p>
              {!fsSupported && (
                <p className="text-[10px] text-warning mt-1">
                  Use Chrome or Edge for full filesystem access
                </p>
              )}
            </div>
          </div>

          {/* Right — Recent projects */}
          <div className="flex-1 flex flex-col p-6 overflow-hidden">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 shrink-0">Recent</h2>

            {sorted.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center">
                  <Zap className="h-6 w-6 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">No recent projects</p>
                  <p className="text-xs text-muted-foreground mt-1">Create or open a project to get started</p>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-0.5">
                {sorted.map(project => (
                  <button
                    key={project.id}
                    onClick={() => handleOpen(project.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-hover transition-colors group text-left"
                  >
                    <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center shrink-0">
                      <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{project.name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Clock className="h-2.5 w-2.5 text-muted-foreground/60" />
                        <p className="text-[10px] text-muted-foreground">{timeAgo(project.updatedAt)}</p>
                      </div>
                    </div>
                    <button
                      onClick={e => handleDelete(e, project.id)}
                      className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete project"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default ProjectLauncher;
