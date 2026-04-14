/**
 * UpdateBanner — auto-update system for Code Scout.
 *
 * On startup, checks a remote manifest for the latest version.
 * If newer, automatically downloads, installs, and prompts to restart.
 * Works like Claude Code's auto-updater.
 *
 * Remote JSON (default: https://llmscout.co/code-scout/download/version.json):
 *   { "version": "0.2.0", "url": "https://…/Code-Scout.app.tar.gz", "notes": "…" }
 */
import { useState, useEffect, useCallback } from 'react';
import { X, Download, ArrowUpCircle, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  notes: string;
  downloadUrl: string;
}

type UpdateStage = 'checking' | 'available' | 'downloading' | 'installed' | 'error' | 'up-to-date';

// ─── Tauri invoke helper ─────────────────────────────────────────────────────

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as Record<string, unknown>).isTauri || '__TAURI_INTERNALS__' in window);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UpdateBanner() {
  const [stage, setStage] = useState<UpdateStage>('checking');
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState('');

  // Check for updates on mount
  useEffect(() => {
    if (!isTauri()) {
      setStage('up-to-date');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await tauriInvoke<UpdateCheckResult>('check_for_update');
        if (cancelled) return;

        if (result.updateAvailable) {
          setUpdate(result);
          setStage('available');
        } else {
          setStage('up-to-date');
        }
      } catch (err) {
        if (cancelled) return;
        // Silent fail — update check is not critical
        setStage('up-to-date');
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleAutoUpdate = useCallback(async () => {
    if (!update) return;
    setStage('downloading');
    setProgress('Downloading update…');

    try {
      setProgress('Downloading and installing…');
      await tauriInvoke<string>('download_and_install_update', {
        downloadUrl: update.downloadUrl,
      });
      setStage('installed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStage('error');
    }
  }, [update]);

  const handleRelaunch = useCallback(async () => {
    try {
      await tauriInvoke<void>('relaunch_app');
    } catch {
      // If relaunch fails, tell the user to restart manually
      setError('Please close and reopen Code Scout to use the new version.');
    }
  }, []);

  // Don't show anything for these states
  if (stage === 'checking' || stage === 'up-to-date' || dismissed) return null;

  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-2 border-b shrink-0 ${
      stage === 'error'
        ? 'bg-red-500/10 border-red-500/20'
        : stage === 'installed'
          ? 'bg-green-500/10 border-green-500/20'
          : 'bg-blue-500/10 border-blue-500/20'
    }`}>
      <div className={`flex items-center gap-2 text-xs min-w-0 ${
        stage === 'error'
          ? 'text-red-700 dark:text-red-300'
          : stage === 'installed'
            ? 'text-green-700 dark:text-green-300'
            : 'text-blue-700 dark:text-blue-300'
      }`}>
        {/* Icon */}
        {stage === 'available' && <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />}
        {stage === 'downloading' && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
        {stage === 'installed' && <CheckCircle className="h-3.5 w-3.5 shrink-0" />}
        {stage === 'error' && <AlertCircle className="h-3.5 w-3.5 shrink-0" />}

        {/* Message */}
        <span className="truncate">
          {stage === 'available' && (
            <>
              <strong>v{update!.latestVersion}</strong> is available
              {update!.notes ? ` — ${update!.notes}` : ''}
              {` (you have v${update!.currentVersion})`}
            </>
          )}
          {stage === 'downloading' && progress}
          {stage === 'installed' && (
            <>
              <strong>v{update!.latestVersion}</strong> installed successfully — restart to apply
            </>
          )}
          {stage === 'error' && (error || 'Update failed')}
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Action buttons */}
        {stage === 'available' && (
          <button
            onClick={handleAutoUpdate}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium
              bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <Download className="h-2.5 w-2.5" />
            Update now
          </button>
        )}

        {stage === 'installed' && (
          <button
            onClick={handleRelaunch}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium
              bg-green-600 text-white hover:bg-green-700 transition-colors"
          >
            <RefreshCw className="h-2.5 w-2.5" />
            Restart
          </button>
        )}

        {stage === 'error' && (
          <button
            onClick={handleAutoUpdate}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium
              bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        )}

        {/* Dismiss (available on all stages) */}
        {(stage === 'available' || stage === 'error') && (
          <button
            onClick={() => setDismissed(true)}
            className={`p-0.5 rounded opacity-60 hover:opacity-100 transition-opacity ${
              stage === 'error'
                ? 'text-red-700 dark:text-red-300'
                : 'text-blue-700 dark:text-blue-300'
            }`}
            title="Dismiss"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
