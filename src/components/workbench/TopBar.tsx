import { useState, useEffect } from 'react';
import { Cpu, Brain, Code, TestTube, Loader2, Github, Palette, FlaskConical, Heart, Globe } from 'lucide-react';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { useModelStore } from '@/store/modelStore';
import { useTaskStore } from '@/store/taskStore';
import { useGitStore } from '@/store/gitStore';
import { useWorkbenchStore, CENTER_TAB_BENCHMARK } from '@/store/workbenchStore';
import { useModeStore } from '@/store/modeStore';

const CENTER_TAB_WEB = ':web';
import { useProjectStore } from '@/store/projectStore';
import { checkConnection } from '@/services/modelApi';
import { refreshGitStatus, connectGithubWithToken } from '@/services/gitService';
import { isTauri } from '@/lib/tauri';
import CodeScoutLogo from '@/components/CodeScoutLogo';
import GitStatusBar from '@/components/workbench/GitStatusBar';
import GitSyncPanel from '@/components/workbench/GitSyncPanel';
import { AgentHeartbeatPopover } from '@/components/workbench/AgentHeartbeatPopover';

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
  const [showHeartbeat, setShowHeartbeat] = useState(false);
  const [showWebSetup, setShowWebSetup] = useState(false);
  const aiIsStreaming = useWorkbenchStore(s => s.aiIsStreaming);
  const { webModeEnabled, setWebModeEnabled } = useModeStore();

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

        {/* Web / Browser mode button */}
        <div className="relative">
          <button
            onClick={() => {
              if (!webModeEnabled) {
                setShowWebSetup(true);
              } else {
                setActiveCenterTab(activeCenterTab === CENTER_TAB_WEB ? 'chat' : CENTER_TAB_WEB);
              }
            }}
            title="Browser automation"
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-colors ${
              activeCenterTab === CENTER_TAB_WEB
                ? 'text-primary bg-primary/10'
                : webModeEnabled
                ? 'text-muted-foreground hover:text-foreground hover:bg-surface-hover'
                : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-surface-hover'
            }`}
          >
            <Globe className="h-3 w-3" />
            <span className="hidden lg:inline">Web</span>
          </button>
          {showWebSetup && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-4 w-[320px]">
              <h3 className="font-semibold text-sm mb-2">Enable Browser Automation?</h3>
              <p className="text-xs text-muted-foreground mb-3">
                This feature lets the AI control a browser to research, fill forms, and automate web tasks.
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                <strong>First run only:</strong> Downloads Chromium (~150MB) and installs browser dependencies.
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowWebSetup(false)}
                  className="px-3 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setWebModeEnabled(true);
                    setShowWebSetup(false);
                    setActiveCenterTab(CENTER_TAB_WEB);
                  }}
                  className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Enable Web Mode
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Heartbeat — agent loop settings */}
        <div className="relative">
          <button
            onClick={() => setShowHeartbeat(p => !p)}
            title="Agent heartbeat & loop settings"
            className={`p-1.5 rounded-lg transition-colors ${
              showHeartbeat ? 'text-red-500 bg-red-500/10' : 'text-muted-foreground hover:text-red-500 hover:bg-surface-hover'
            }`}
          >
            <Heart className={`h-4 w-4 ${aiIsStreaming ? 'animate-pulse text-red-500' : ''}`} />
          </button>
          {showHeartbeat && (
            <AgentHeartbeatPopover
              onOpenModelSettings={() => {
                setShowHeartbeat(false);
                setSettingsOpen(true);
              }}
            />
          )}
        </div>

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

      </div>

      {/* GitHub sync dropdown panel */}
      {showGitSync && <GitSyncPanel onClose={() => setShowGitSync(false)} />}
    </div>
  );
};

export default TopBar;
