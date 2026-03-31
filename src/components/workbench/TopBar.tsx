import { useState, useEffect } from 'react';
import { Cpu, Settings, Brain, Code, TestTube, Wifi, WifiOff, Loader2, Github, Palette, FlaskConical } from 'lucide-react';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { useModelStore } from '@/store/modelStore';
import { useTaskStore } from '@/store/taskStore';
import { useGitStore } from '@/store/gitStore';
import { useWorkbenchStore, CENTER_TAB_BENCHMARK } from '@/store/workbenchStore';
import { useProjectStore } from '@/store/projectStore';
import { checkConnection } from '@/services/modelApi';
import { refreshGitStatus, connectGithubWithToken } from '@/services/gitService';
import { isTauri } from '@/lib/tauri';
import CodeScoutLogo from '@/components/CodeScoutLogo';
import GitStatusBar from '@/components/workbench/GitStatusBar';
import GitSyncPanel from '@/components/workbench/GitSyncPanel';

type ConnectionStatus = 'checking' | 'connected' | 'disconnected';

const THEME_OPTIONS: { id: Theme; label: string; dot: string }[] = [
  { id: 'dark',   label: 'Dark',       dot: 'bg-slate-700' },
  { id: 'blue',   label: 'Light Blue', dot: 'bg-sky-300' },
  { id: 'pink',   label: 'Light Grey', dot: 'bg-slate-300' },
  { id: 'yellow', label: 'Cream',      dot: 'bg-amber-200 border border-amber-300' },
];

const TopBar = () => {
  const { models, setSettingsOpen } = useModelStore();
  const { theme, setTheme } = useTheme();
  const [showThemePicker, setShowThemePicker] = useState(false);
  const getModelForRole = useModelStore(s => s.getModelForRole);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('checking');
  const [connError, setConnError] = useState<string | null>(null);
  const { githubToken, githubUser, githubTokenValid, setGithubTokenValid } = useGitStore();
  const projectPath = useWorkbenchStore((s) => s.projectPath);
  const { activeCenterTab, setActiveCenterTab } = useWorkbenchStore();
  const closeProject = useProjectStore(s => s.closeProject);
  const [showGitSync, setShowGitSync] = useState(false);

  const orchestratorModel = getModelForRole('orchestrator');
  const coder = getModelForRole('coder');
  const tester = getModelForRole('tester');
  const activeCount = models.filter(m => m.enabled).length;
  const { orchestratorState, goal, repairAttemptCount } = useTaskStore();

  // Check connection to primary model on mount and when models change
  useEffect(() => {
    const checkPrimary = async () => {
      const model = getModelForRole('orchestrator') || getModelForRole('coder');
      if (!model) {
        setConnStatus('disconnected');
        setConnError('No model configured');
        return;
      }

      setConnStatus('checking');
      const result = await checkConnection(model.provider, model.endpoint, model.apiKey);
      setConnStatus(result.ok ? 'connected' : 'disconnected');
      if (!result.ok) {
        const raw = result.error || 'Connection failed';
        // Humanise common browser network errors
        const friendly = raw.includes('timed out') || raw.includes('TimeoutError')
          ? `Endpoint unreachable (timeout) — click to configure`
          : raw.includes('Failed to fetch') || raw.includes('NetworkError')
          ? `Can't reach endpoint — click to configure`
          : raw;
        setConnError(friendly);
      } else {
        setConnError(null);
      }
    };

    checkPrimary();
    const interval = setInterval(checkPrimary, 30000);
    return () => clearInterval(interval);
  }, [models, getModelForRole]);

  // Validate the stored GitHub token on mount (and whenever it changes)
  useEffect(() => {
    if (!githubToken) {
      setGithubTokenValid(null);
      return;
    }
    let cancelled = false;
    connectGithubWithToken(githubToken).then(result => {
      if (!cancelled) setGithubTokenValid(result !== null);
    });
    return () => { cancelled = true; };
  }, [githubToken, setGithubTokenValid]);

  const files = useWorkbenchStore(s => s.files);

  // Refresh git status whenever the project path changes — use resolved project root
  useEffect(() => {
    if (!isTauri() || !projectPath) return;
    // Resolve to actual project root (handles parent-dir case)
    const markers = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'setup.py', 'Makefile', 'pom.xml', 'build.gradle'];
    let effectivePath = projectPath;
    const topFiles = files.filter(f => f.type === 'file').map(f => f.name);
    if (!markers.some(m => topFiles.includes(m))) {
      const sep = projectPath.includes('\\') ? '\\' : '/';
      const subdirs = files.filter(f => f.type === 'folder' && f.children);
      for (const dir of subdirs) {
        const childFiles = (dir.children ?? []).filter(f => f.type === 'file').map(f => f.name);
        if (markers.some(m => childFiles.includes(m))) { effectivePath = `${projectPath}${sep}${dir.name}`; break; }
      }
      if (effectivePath === projectPath && subdirs.length === 1) effectivePath = `${projectPath}${sep}${subdirs[0].name}`;
    }
    refreshGitStatus(effectivePath);
  }, [projectPath, files]);

  const statusColors: Record<ConnectionStatus, string> = {
    checking: 'text-muted-foreground',
    connected: 'text-success',
    disconnected: 'text-destructive',
  };

  const statusLabels: Record<ConnectionStatus, string> = {
    checking: 'Checking...',
    connected: 'Connected',
    disconnected: 'Disconnected',
  };

  return (
    <div className="h-11 bg-surface-panel border-b border-border flex items-center justify-between px-4">
      {/* Left — Logo (click to go home) + task state */}
      <div className="flex items-center gap-2">
        <button
          onClick={closeProject}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          title="Back to projects"
        >
          <CodeScoutLogo size={22} className="text-primary" />
          <span className="font-semibold text-sm text-foreground tracking-tight">Code Scout</span>
        </button>
        {orchestratorState !== 'IDLE' && orchestratorState !== 'COMPLETED' && orchestratorState !== 'CANCELLED' && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
            <Loader2 className="h-2.5 w-2.5 text-primary animate-spin" />
            <span className="text-[10px] text-primary font-medium capitalize">
              {orchestratorState.replace(/_/g, ' ').toLowerCase()}
            </span>
            {orchestratorState === 'REPAIRING' && repairAttemptCount > 0 && (
              <span className="text-[10px] text-warning font-mono">
                · repairing… attempt {repairAttemptCount}
              </span>
            )}
            {goal && <span className="text-[10px] text-primary/60 truncate max-w-32">— {goal.slice(0, 30)}</span>}
          </div>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        {/* Git status bar */}
        <GitStatusBar />

        {/* GitHub sync button — green only when token is present AND validated */}
        {isTauri() && (
          <button
            onClick={() => setShowGitSync(prev => !prev)}
            title={
              githubToken && githubTokenValid === true
                ? `GitHub · ${githubUser ?? 'connected'}`
                : githubToken && githubTokenValid === false
                ? 'GitHub token invalid — click to reconnect'
                : 'Connect GitHub'
            }
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
              githubToken && githubTokenValid === true
                ? 'text-success hover:bg-success/10'
                : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'
            }`}
          >
            <Github className="h-3 w-3" />
            <span className="hidden lg:inline">
              {githubToken && githubTokenValid === true ? 'Sync' : 'GitHub'}
            </span>
          </button>
        )}

        {/* Benchmark button */}
        <button
          onClick={() => setActiveCenterTab(
            activeCenterTab === CENTER_TAB_BENCHMARK ? 'chat' : CENTER_TAB_BENCHMARK
          )}
          title="Benchmark models"
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
            activeCenterTab === CENTER_TAB_BENCHMARK
              ? 'text-primary bg-primary/10'
              : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'
          }`}
        >
          <FlaskConical className="h-3 w-3" />
          <span className="hidden lg:inline">Benchmark</span>
        </button>

        {/* Connection status */}
        <button
          onClick={() => connStatus === 'disconnected' && setSettingsOpen(true)}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${statusColors[connStatus]} ${connStatus === 'disconnected' ? 'hover:bg-destructive/10 cursor-pointer' : 'cursor-default'}`}
          title={connError || statusLabels[connStatus]}
        >
          {connStatus === 'connected' ? (
            <Wifi className="h-3 w-3" />
          ) : connStatus === 'checking' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <WifiOff className="h-3 w-3" />
          )}
          <span className="hidden lg:inline">
            {connStatus === 'disconnected' && connError
              ? connError.length > 28 ? connError.slice(0, 28) + '…' : connError
              : statusLabels[connStatus]}
          </span>
        </button>

        {/* Active model — only show the orchestrator (the one actually used) */}
        {orchestratorModel && (
          <div
            className="hidden md:flex items-center gap-1.5 bg-secondary px-2.5 py-1 rounded-lg cursor-default"
            title={`Active model: ${orchestratorModel.name}\nEndpoint: ${orchestratorModel.endpoint ?? 'default'}\n\nCoder (${coder?.modelId ?? 'none'}) and Tester (${tester?.modelId ?? 'none'}) are configured but not yet dispatched.`}
          >
            <Brain className="h-3 w-3 text-accent shrink-0" />
            <span className="text-[10px] text-foreground/70 max-w-[120px] truncate font-mono">
              {orchestratorModel.modelId}
            </span>
            {/* Dim indicators that coder + tester are configured but idle */}
            {coder && <Code className="h-3 w-3 text-foreground/20 shrink-0" />}
            {tester && <TestTube className="h-3 w-3 text-foreground/20 shrink-0" />}
          </div>
        )}

        {/* Model count badge (mobile) */}
        <button
          onClick={() => setSettingsOpen(true)}
          className="md:hidden flex items-center gap-1 bg-secondary px-2.5 py-1.5 rounded-lg text-xs text-secondary-foreground"
        >
          <Cpu className="h-3.5 w-3.5" />
          <span>{activeCount}</span>
        </button>

        {/* Theme picker */}
        <div className="relative">
          <button
            onClick={() => setShowThemePicker(p => !p)}
            title="Change colour theme"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <Palette className="h-4 w-4" />
          </button>
          {showThemePicker && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-1.5 flex flex-col gap-0.5 min-w-[130px]">
              {THEME_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => { setTheme(opt.id); setShowThemePicker(false); }}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors w-full text-left ${
                    theme === opt.id
                      ? 'bg-primary/15 text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'
                  }`}
                >
                  <span className={`w-3 h-3 rounded-full shrink-0 ${opt.dot}`} />
                  {opt.label}
                  {theme === opt.id && <span className="ml-auto text-primary">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => setSettingsOpen(true)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* GitHub sync dropdown panel */}
      {showGitSync && <GitSyncPanel onClose={() => setShowGitSync(false)} />}
    </div>
  );
};

export default TopBar;
