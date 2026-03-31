import { useState } from 'react';
import { GitBranch, Upload, Loader2 } from 'lucide-react';
import { useGitStore } from '@/store/gitStore';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { gitCommitAll, gitPush } from '@/services/gitService';
import { isTauri } from '@/lib/tauri';

const GitStatusBar = () => {
  const { branch, isDirty, aheadCount, remoteUrl, githubToken } = useGitStore();
  const projectPath = useWorkbenchStore((s) => s.projectPath);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only show in Tauri and when there is an active git branch
  if (!isTauri() || branch === null) return null;

  const handlePush = async () => {
    if (!projectPath) return;
    setPushing(true);
    setError(null);
    try {
      // Stage & commit if there are dirty changes
      if (isDirty) {
        const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
        await gitCommitAll(projectPath, `Auto-commit via Code Scout at ${timestamp}`);
      }
      // Push if we have a remote and a token
      if (remoteUrl && githubToken) {
        await gitPush(projectPath, githubToken, remoteUrl);
      } else if (remoteUrl) {
        // No token — attempt plain push (works for SSH or previously authenticated remotes)
        const { executeCommand } = await import('@/lib/tauri');
        const result = await executeCommand('git push origin HEAD', projectPath);
        if (result.code !== 0) {
          throw new Error(result.stderr || 'git push failed');
        }
      } else {
        throw new Error('No remote configured. Add a remote with git remote add origin <url>.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPushing(false);
    }
  };

  const showPushButton = isDirty || aheadCount > 0;

  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary text-xs" title={error ?? undefined}>
      <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-foreground/70 font-mono max-w-[120px] truncate">{branch}</span>

      {isDirty && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0"
          title="Uncommitted changes"
        />
      )}

      {aheadCount > 0 && (
        <span className="text-yellow-400 text-[10px] shrink-0">↑{aheadCount}</span>
      )}

      {showPushButton && (
        <button
          onClick={handlePush}
          disabled={pushing}
          title={pushing ? 'Pushing…' : 'Commit & Push'}
          className="ml-0.5 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors disabled:opacity-50"
        >
          {pushing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
        </button>
      )}

      {error && (
        <span className="text-destructive text-[10px] max-w-[140px] truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
};

export default GitStatusBar;
