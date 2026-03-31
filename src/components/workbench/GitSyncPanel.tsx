/**
 * GitSyncPanel — Dropdown panel for GitHub connection, repo creation, and sync.
 * Shows from the TopBar GitHub button.
 */
import { useState, useEffect, useRef } from 'react';
import {
  GitBranch, Github, Upload, Loader2, X, Check, Plus, ExternalLink, RefreshCw, AlertCircle, Lock, Globe,
} from 'lucide-react';
import { useGitStore } from '@/store/gitStore';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { connectGithubWithToken, createGithubRepo, gitCommitAll, gitPush, refreshGitStatus } from '@/services/gitService';
import { executeCommand, isTauri } from '@/lib/tauri';
import type { FileNode } from '@/store/workbenchStore';

// Resolve actual project root (same as TerminalPanel / agentExecutor)
const PROJECT_MARKERS = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'setup.py', 'Makefile', 'pom.xml', 'build.gradle'];
function resolveProjectRoot(path: string, files: FileNode[]): string {
  const topFiles = files.filter(f => f.type === 'file').map(f => f.name);
  if (PROJECT_MARKERS.some(m => topFiles.includes(m))) return path;
  const sep = path.includes('\\') ? '\\' : '/';
  const subdirs = files.filter(f => f.type === 'folder' && f.children);
  for (const dir of subdirs) {
    const childFiles = (dir.children ?? []).filter(f => f.type === 'file').map(f => f.name);
    if (PROJECT_MARKERS.some(m => childFiles.includes(m))) return `${path}${sep}${dir.name}`;
  }
  if (subdirs.length === 1) return `${path}${sep}${subdirs[0].name}`;
  return path;
}

interface GitSyncPanelProps {
  onClose: () => void;
}

const GitSyncPanel = ({ onClose }: GitSyncPanelProps) => {
  const { githubToken, githubUser, branch, isDirty, aheadCount, remoteUrl, hasRemote, setGithubToken, setGithubUser, setGithubTokenValid } = useGitStore();
  const rawProjectPath = useWorkbenchStore(s => s.projectPath);
  const files = useWorkbenchStore(s => s.files);
  const projectName = useWorkbenchStore(s => s.projectName);

  // Resolve to actual project root (handles parent-dir case)
  const projectPath = rawProjectPath ? resolveProjectRoot(rawProjectPath, files) : null;

  const [tokenInput, setTokenInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [newRepoName, setNewRepoName] = useState(projectName || '');
  const [isPrivate, setIsPrivate] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const [refreshing, setRefreshing] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleConnect = async () => {
    if (!tokenInput.trim()) return;
    setConnecting(true);
    setConnectError(null);
    const result = await connectGithubWithToken(tokenInput.trim());
    if (result) {
      setGithubToken(tokenInput.trim());
      setGithubUser(result.login);
      setGithubTokenValid(true);
      setTokenInput('');
    } else {
      setConnectError('Invalid token. Make sure it has "repo" scope.');
    }
    setConnecting(false);
  };

  const handleDisconnect = () => {
    setGithubToken(null);
    setGithubUser(null);
    setGithubTokenValid(null);
  };

  const handleCreateRepo = async () => {
    if (!githubToken || !newRepoName.trim() || !projectPath) return;
    setCreating(true);
    setCreateError(null);
    try {
      const cloneUrl = await createGithubRepo(newRepoName.trim(), githubToken, isPrivate);
      // Init git if needed, add remote, and push
      await executeCommand('git init', projectPath);
      await executeCommand(`git remote add origin ${cloneUrl}`, projectPath);
      await gitCommitAll(projectPath, 'Initial commit via Code Scout');
      await gitPush(projectPath, githubToken, cloneUrl);
      // Refresh status
      await refreshGitStatus(projectPath);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleSync = async () => {
    if (!projectPath) return;
    setSyncing(true);
    setSyncError(null);
    setSyncSuccess(false);
    try {
      if (isDirty) {
        const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
        await gitCommitAll(projectPath, `Code Scout sync at ${timestamp}`);
      }
      if (remoteUrl && githubToken) {
        await gitPush(projectPath, githubToken, remoteUrl);
      } else if (remoteUrl) {
        const result = await executeCommand('git push origin HEAD', projectPath);
        if (result.code !== 0) throw new Error(result.stderr || 'git push failed');
      } else {
        throw new Error('No remote configured');
      }
      await refreshGitStatus(projectPath);
      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 3000);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const handleRefresh = async () => {
    if (!projectPath) return;
    setRefreshing(true);
    await refreshGitStatus(projectPath);
    setRefreshing(false);
  };

  const isGitRepo = branch !== null;
  const canSync = isGitRepo && hasRemote && (isDirty || aheadCount > 0);

  return (
    <div
      ref={panelRef}
      className="absolute right-16 top-11 w-80 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <Github className="h-4 w-4 text-foreground" />
          <span className="text-xs font-semibold text-foreground">GitHub Sync</span>
        </div>
        <button onClick={onClose} className="p-0.5 rounded text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-3 max-h-[400px] overflow-y-auto">
        {/* --- Connection section --- */}
        {!githubToken ? (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Connect your GitHub account to sync code.
            </p>
            <a
              href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=Code+Scout+AI"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Create a Classic token (needs "repo" scope)
            </a>
            <p className="text-[9px] text-muted-foreground/60">
              Fine-grained tokens need "Administration: Write" to create repos.
            </p>
            <div className="flex gap-1.5">
              <input
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConnect()}
                placeholder="ghp_xxxxxxxxxxxx"
                type="password"
                className="flex-1 bg-input text-xs text-foreground rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              />
              <button
                onClick={handleConnect}
                disabled={!tokenInput.trim() || connecting}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 disabled:opacity-40"
              >
                {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Connect'}
              </button>
            </div>
            {connectError && (
              <p className="text-[10px] text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" /> {connectError}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-success/20 flex items-center justify-center">
                <Check className="h-3 w-3 text-success" />
              </div>
              <div>
                <p className="text-[11px] font-medium text-foreground">{githubUser || 'Connected'}</p>
                <p className="text-[10px] text-muted-foreground">GitHub connected</p>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              className="text-[10px] text-muted-foreground hover:text-destructive"
            >
              Disconnect
            </button>
          </div>
        )}

        {/* --- Git status section --- */}
        {isTauri() && projectPath && (
          <>
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-foreground">Repository</span>
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="p-0.5 rounded text-muted-foreground hover:text-foreground"
                  title="Refresh git status"
                >
                  <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {isGitRepo ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-4 text-[11px]">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <GitBranch className="h-3 w-3" /> {branch}
                    </span>
                    {isDirty && (
                      <span className="flex items-center gap-1 text-yellow-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" /> uncommitted
                      </span>
                    )}
                    {aheadCount > 0 && (
                      <span className="text-yellow-500">↑{aheadCount} ahead</span>
                    )}
                  </div>

                  {remoteUrl && (
                    <p className="text-[10px] font-mono text-muted-foreground truncate" title={remoteUrl}>
                      {remoteUrl}
                    </p>
                  )}

                  {!hasRemote && githubToken && (
                    <div className="space-y-2 p-2.5 rounded-md bg-secondary/50 border border-border">
                      <p className="text-[10px] text-muted-foreground">No remote. Create a GitHub repo:</p>
                      <input
                        value={newRepoName}
                        onChange={e => setNewRepoName(e.target.value)}
                        placeholder="repo-name"
                        className="w-full bg-input text-xs text-foreground rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                      />
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                          <input type="radio" checked={isPrivate} onChange={() => setIsPrivate(true)} className="accent-primary" />
                          <Lock className="h-3 w-3" /> Private
                        </label>
                        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                          <input type="radio" checked={!isPrivate} onChange={() => setIsPrivate(false)} className="accent-primary" />
                          <Globe className="h-3 w-3" /> Public
                        </label>
                      </div>
                      <button
                        onClick={handleCreateRepo}
                        disabled={!newRepoName.trim() || creating}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 disabled:opacity-40"
                      >
                        {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        Create & Push
                      </button>
                      {createError && (
                        <p className="text-[10px] text-destructive">{createError}</p>
                      )}
                    </div>
                  )}

                  {/* Sync button */}
                  {hasRemote && (
                    <button
                      onClick={handleSync}
                      disabled={syncing || (!isDirty && aheadCount === 0)}
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
                    >
                      {syncing ? (
                        <><Loader2 className="h-3 w-3 animate-spin" /> Syncing...</>
                      ) : syncSuccess ? (
                        <><Check className="h-3 w-3" /> Synced!</>
                      ) : (
                        <><Upload className="h-3 w-3" /> {isDirty ? 'Commit & Push' : aheadCount > 0 ? `Push ${aheadCount} commit${aheadCount > 1 ? 's' : ''}` : 'Up to date'}</>
                      )}
                    </button>
                  )}
                  {syncError && (
                    <p className="text-[10px] text-destructive flex items-center gap-1">
                      <AlertCircle className="h-3 w-3 shrink-0" /> {syncError}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] text-muted-foreground">
                    Not a git repository yet.
                  </p>
                  {githubToken && (
                    <div className="space-y-2 p-2.5 rounded-md bg-secondary/50 border border-border">
                      <p className="text-[10px] text-muted-foreground">Create a GitHub repo and push:</p>
                      <input
                        value={newRepoName}
                        onChange={e => setNewRepoName(e.target.value)}
                        placeholder="repo-name"
                        className="w-full bg-input text-xs text-foreground rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                      />
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                          <input type="radio" checked={isPrivate} onChange={() => setIsPrivate(true)} className="accent-primary" />
                          <Lock className="h-3 w-3" /> Private
                        </label>
                        <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                          <input type="radio" checked={!isPrivate} onChange={() => setIsPrivate(false)} className="accent-primary" />
                          <Globe className="h-3 w-3" /> Public
                        </label>
                      </div>
                      <button
                        onClick={handleCreateRepo}
                        disabled={!newRepoName.trim() || creating}
                        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90 disabled:opacity-40"
                      >
                        {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        Create & Push
                      </button>
                      {createError && (
                        <p className="text-[10px] text-destructive">{createError}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default GitSyncPanel;
