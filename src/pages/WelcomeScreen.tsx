import { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2, ChevronRight, ChevronLeft, ExternalLink, Loader2, Github,
  Cloud, Network, FolderOpen, Wifi, WifiOff, Eye, EyeOff, X, Sparkles,
} from 'lucide-react';
import CodeScoutLogo from '@/components/CodeScoutLogo';
import { useModelStore, PROVIDER_OPTIONS, ModelProvider } from '@/store/modelStore';
import { useGitStore } from '@/store/gitStore';
import { useProjectStore } from '@/store/projectStore';
import { useWorkbenchStore } from '@/store/workbenchStore';
import { useProjectMemoryStore } from '@/store/projectMemoryStore';
import { connectGithubWithToken } from '@/services/gitService';
import { isTauri, openDirectoryNative } from '@/lib/tauri';
import { openDirectory } from '@/services/fileSystemService';
import { indexProject } from '@/services/memoryManager';
import { ProviderIcon } from '@/components/workbench/AIPanel';
import { DEFAULT_OLLAMA_URL, DEFAULT_LLAMA_CPP_URL } from '@/config/llmNetworkDefaults';

interface WelcomeScreenProps {
  onClose: () => void;
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'cloud',   label: 'Cloud Providers' },
  { id: 'local',   label: 'Local LLMs' },
  { id: 'github',  label: 'GitHub' },
  { id: 'project', label: 'Open Project' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

// Cloud providers shown in onboarding (OpenRouter first, no custom)
const ONBOARDING_CLOUD = PROVIDER_OPTIONS.filter(p => !p.isLocal && p.id !== 'custom');

// Default model hint per provider (used to pre-add a placeholder model)
const PROVIDER_HINTS: Partial<Record<ModelProvider, string>> = {
  openrouter: 'qwen/qwen2.5-coder-32b-instruct',
  deepseek:   'deepseek-chat',
  groq:       'llama-3.3-70b-versatile',
  mistral:    'mistral-large-latest',
  openai:     'gpt-4o',
  anthropic:  'claude-sonnet-4-20250514',
  google:     'gemini-2.5-pro',
};

// Local providers to probe
const LOCAL_PROVIDERS: {
  id: ModelProvider;
  label: string;
  endpoint: string;
  probeUrl: string;
}[] = [
  { id: 'ollama',     label: 'Ollama',    endpoint: DEFAULT_OLLAMA_URL,     probeUrl: `${DEFAULT_OLLAMA_URL}/api/tags` },
  { id: 'lm-studio',  label: 'LM Studio', endpoint: 'http://localhost:1234', probeUrl: 'http://localhost:1234/v1/models' },
  { id: 'llama-cpp',  label: 'llama.cpp', endpoint: DEFAULT_LLAMA_CPP_URL,   probeUrl: `${DEFAULT_LLAMA_CPP_URL}/v1/models` },
];

// ─── WelcomeScreen ────────────────────────────────────────────────────────────

const WelcomeScreen = ({ onClose }: WelcomeScreenProps) => {
  const [stepIdx, setStepIdx] = useState(0);
  const currentStep = STEPS[stepIdx];

  const [cloudDone,   setCloudDone]   = useState(false);
  const [localDone,   setLocalDone]   = useState(false);
  const [githubDone,  setGithubDone]  = useState(false);
  const [projectDone, setProjectDone] = useState(false);

  const completionMap: Record<StepId, boolean> = {
    welcome: true,
    cloud:   cloudDone,
    local:   localDone,
    github:  githubDone,
    project: projectDone,
  };

  const isLast = stepIdx === STEPS.length - 1;

  const handleNext = () => {
    if (isLast) { localStorage.setItem('scout-welcomed', 'true'); onClose(); }
    else setStepIdx(i => i + 1);
  };
  const handleBack = () => setStepIdx(i => Math.max(0, i - 1));
  const handleFinish = () => { localStorage.setItem('scout-welcomed', 'true'); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-3xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex"
        style={{ minHeight: '520px', maxHeight: '90vh' }}
      >
        {/* ── Left sidebar ── */}
        <aside className="w-52 shrink-0 bg-surface-panel border-r border-border flex flex-col p-6 gap-6">
          <div className="flex flex-col items-start gap-2">
            <CodeScoutLogo size={36} className="text-primary" />
            <span className="font-bold text-sm text-foreground tracking-tight leading-tight">Code Scout</span>
            <p className="text-[10px] text-muted-foreground leading-relaxed">Your AI coding partner</p>
          </div>

          <nav className="flex flex-col gap-1 mt-2">
            {STEPS.map((step, i) => {
              const done = completionMap[step.id];
              const active = i === stepIdx;
              return (
                <button
                  key={step.id}
                  onClick={() => setStepIdx(i)}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors text-xs font-medium
                    ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-surface-hover'}`}
                >
                  <span className={`flex items-center justify-center w-5 h-5 rounded-full border text-[10px] shrink-0 transition-colors
                    ${done
                      ? 'border-success bg-success/10 text-success'
                      : active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-secondary text-muted-foreground'}`}>
                    {done ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                  </span>
                  {step.label}
                </button>
              );
            })}
          </nav>

          <div className="mt-auto">
            <button
              onClick={handleFinish}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip setup
            </button>
          </div>
        </aside>

        {/* ── Right main area ── */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-8">
            {currentStep.id === 'welcome' && <StepWelcome />}
            {currentStep.id === 'cloud'   && <StepCloud   onDone={setCloudDone} />}
            {currentStep.id === 'local'   && <StepLocal   onDone={setLocalDone} />}
            {currentStep.id === 'github'  && <StepGitHub  onDone={setGithubDone} />}
            {currentStep.id === 'project' && <StepProject onDone={setProjectDone} onClose={onClose} />}
          </div>

          {/* Navigation footer */}
          <div className="border-t border-border px-8 py-4 flex items-center justify-between bg-surface-panel shrink-0">
            <button
              onClick={handleBack}
              disabled={stepIdx === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back
            </button>
            <div className="flex items-center gap-1.5">
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i === stepIdx ? 'bg-primary' : i < stepIdx ? 'bg-success' : 'bg-border'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              {isLast ? 'Get started' : 'Next'}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </main>
      </div>
    </div>
  );
};

// ─── Step 1: Welcome ──────────────────────────────────────────────────────────

const StepWelcome = () => (
  <div className="flex flex-col gap-6 h-full justify-center py-4">
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <span className="text-xs font-medium text-primary uppercase tracking-wider">Welcome</span>
      </div>
      <h1 className="text-2xl font-bold text-foreground tracking-tight leading-tight">
        Let's get you set up<br />in a few quick steps.
      </h1>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
        Code Scout is an AI-powered coding assistant that runs locally on your machine.
        Connect your favourite AI models, open a project, and start building.
      </p>
    </div>

    <div className="grid grid-cols-2 gap-3">
      {[
        { icon: <Cloud className="h-4 w-4" />,     title: 'Cloud models',  desc: 'OpenRouter, DeepSeek, Groq & more' },
        { icon: <Network className="h-4 w-4" />,   title: 'Local LLMs',    desc: 'Ollama, LM Studio, llama.cpp' },
        { icon: <Github className="h-4 w-4" />,    title: 'GitHub sync',   desc: 'Push code and create repos' },
        { icon: <FolderOpen className="h-4 w-4" />, title: 'Any project',   desc: 'Open any folder on your machine' },
      ].map(item => (
        <div key={item.title} className="flex items-start gap-2.5 p-3 rounded-xl bg-secondary/60 border border-border">
          <span className="text-primary mt-0.5 shrink-0">{item.icon}</span>
          <div>
            <p className="text-xs font-semibold text-foreground">{item.title}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

// ─── Step 2: Cloud Providers ──────────────────────────────────────────────────

const StepCloud = ({ onDone }: { onDone: (v: boolean) => void }) => {
  const { providerApiKeys, setProviderApiKey, addModel, models } = useModelStore();
  const [activeProvider, setActiveProvider] = useState<ModelProvider | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyStatus, setKeyStatus] = useState<Record<string, 'valid' | 'invalid'>>({});

  const configuredProviders = ONBOARDING_CLOUD.filter(p => providerApiKeys[p.id]?.trim());

  useEffect(() => { onDone(configuredProviders.length > 0); }, [configuredProviders.length, onDone]);

  const activeInfo = ONBOARDING_CLOUD.find(p => p.id === activeProvider);
  const currentKey = activeProvider ? (providerApiKeys[activeProvider] ?? '') : '';

  const handleSave = async () => {
    if (!activeProvider || !currentKey.trim() || !activeInfo) return;
    setValidating(true);
    try {
      const url = activeInfo.defaultEndpoint ? `${activeInfo.defaultEndpoint}/models` : null;
      let ok = false;
      if (url) {
        try {
          const r = await fetch(url, {
            headers: { Authorization: `Bearer ${currentKey.trim()}` },
            signal: AbortSignal.timeout(8000),
          });
          ok = r.status !== 401 && r.status !== 403;
        } catch { ok = true; }
      } else {
        ok = true;
      }
      setKeyStatus(prev => ({ ...prev, [activeProvider]: ok ? 'valid' : 'invalid' }));
      if (ok) {
        setProviderApiKey(activeProvider, currentKey.trim());
        const hasModel = models.some(m => m.provider === activeProvider);
        const hint = PROVIDER_HINTS[activeProvider];
        if (!hasModel && activeInfo.defaultEndpoint && hint) {
          addModel({
            name: `${activeInfo.label} — ${hint}`,
            provider: activeProvider,
            modelId: hint,
            role: 'orchestrator',
            endpoint: activeInfo.defaultEndpoint,
            apiKey: currentKey.trim(),
            isDefault: false,
            enabled: true,
          }, false);
        }
        setActiveProvider(null);
      }
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-bold text-foreground">Cloud Providers</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connect a cloud AI provider to power your agents. You can add more later in Settings.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {ONBOARDING_CLOUD.map(p => {
          const isConfigured = !!providerApiKeys[p.id]?.trim();
          const isActive = activeProvider === p.id;
          const invalid = keyStatus[p.id] === 'invalid';
          return (
            <button
              key={p.id}
              onClick={() => setActiveProvider(isActive ? null : p.id)}
              className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors
                ${isActive
                  ? 'border-primary bg-primary/5'
                  : isConfigured
                  ? 'border-success/40 bg-success/5'
                  : 'border-border bg-secondary/40 hover:bg-surface-hover'}`}
            >
              <ProviderIcon
                isLocal={false}
                className={`h-4 w-4 shrink-0 ${isConfigured ? 'text-success' : 'text-muted-foreground'}`}
              />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-semibold text-foreground block truncate">{p.label}</span>
                {isConfigured && (
                  <span className="text-[10px] text-success flex items-center gap-0.5 mt-0.5">
                    <CheckCircle2 className="h-2.5 w-2.5" /> Connected
                  </span>
                )}
              </div>
              {invalid && <X className="h-3.5 w-3.5 text-destructive shrink-0" />}
            </button>
          );
        })}
      </div>

      {activeProvider && activeInfo && (
        <div className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
          <p className="text-xs font-semibold text-foreground">{activeInfo.label} API Key</p>
          {activeInfo.id === 'openrouter' && (
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Get your key at openrouter.ai/keys
            </a>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                autoFocus
                type={showKey ? 'text' : 'password'}
                value={currentKey}
                onChange={e => setProviderApiKey(activeProvider, e.target.value)}
                placeholder={
                  activeProvider === 'openrouter' ? 'sk-or-...' :
                  activeProvider === 'groq' ? 'gsk_...' :
                  activeProvider === 'anthropic' ? 'sk-ant-...' : 'sk-...'
                }
                className="w-full bg-input text-foreground text-xs font-mono rounded-lg px-2.5 py-1.5 pr-8 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                onKeyDown={e => e.key === 'Enter' && handleSave()}
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
            <button
              onClick={handleSave}
              disabled={validating || !currentKey.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
            >
              {validating ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </button>
          </div>
          {keyStatus[activeProvider] === 'invalid' && (
            <p className="text-[11px] text-destructive">Key appears invalid — check scopes and try again.</p>
          )}
        </div>
      )}

      {configuredProviders.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          You can skip this and configure providers later in Settings → Discover.
        </p>
      )}
    </div>
  );
};

// ─── Step 3: Local LLMs ───────────────────────────────────────────────────────

type ProbeStatus = 'idle' | 'checking' | 'online' | 'offline';

/** Build the probe URL from a base endpoint for a given provider. */
function buildProbeUrl(id: ModelProvider, endpoint: string): string {
  const base = endpoint.replace(/\/$/, '');
  if (id === 'ollama') return `${base}/api/tags`;
  return `${base}/v1/models`;
}

const StepLocal = ({ onDone }: { onDone: (v: boolean) => void }) => {
  const { addModel, models, updateModel } = useModelStore();

  // Editable endpoints — initialised from LOCAL_PROVIDERS defaults
  const [endpoints, setEndpoints] = useState<Record<string, string>>(
    () => Object.fromEntries(LOCAL_PROVIDERS.map(p => [p.id, p.endpoint]))
  );
  const [statuses, setStatuses] = useState<Record<string, ProbeStatus>>(
    () => Object.fromEntries(LOCAL_PROVIDERS.map(p => [p.id, 'idle' as ProbeStatus]))
  );
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [probing, setProbing] = useState(false);
  const hasMounted = useRef(false);

  useEffect(() => { onDone(Object.values(connected).some(Boolean)); }, [connected, onDone]);

  const probeOne = async (id: ModelProvider, endpoint: string) => {
    setStatuses(prev => ({ ...prev, [id]: 'checking' }));
    try {
      const r = await fetch(buildProbeUrl(id, endpoint), { signal: AbortSignal.timeout(3000) });
      setStatuses(prev => ({ ...prev, [id]: r.ok ? 'online' : 'offline' }));
    } catch {
      setStatuses(prev => ({ ...prev, [id]: 'offline' }));
    }
  };

  const probeAll = async () => {
    setProbing(true);
    await Promise.all(LOCAL_PROVIDERS.map(lp => probeOne(lp.id, endpoints[lp.id])));
    setProbing(false);
  };

  useEffect(() => {
    if (!hasMounted.current) { hasMounted.current = true; probeAll(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEndpointChange = (id: ModelProvider, value: string) => {
    setEndpoints(prev => ({ ...prev, [id]: value }));
    // Reset status so user knows they need to re-probe
    setStatuses(prev => ({ ...prev, [id]: 'idle' }));
    setConnected(prev => ({ ...prev, [id]: false }));
  };

  const handleConnect = (lp: (typeof LOCAL_PROVIDERS)[number]) => {
    const endpoint = endpoints[lp.id];
    const existing = models.find(m => m.provider === lp.id);
    if (existing) {
      updateModel(existing.id, { enabled: true, endpoint });
    } else {
      addModel({
        name: lp.label,
        provider: lp.id,
        modelId: lp.id === 'ollama' ? 'llama3.1:8b' : 'local-model',
        role: 'orchestrator',
        endpoint,
        isDefault: false,
        enabled: true,
      }, false);
    }
    setConnected(prev => ({ ...prev, [lp.id]: true }));
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-bold text-foreground">Local LLMs</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Run models privately on your own machine. Edit the URL if your server is on a different address.
        </p>
      </div>

      <div className="space-y-3">
        {LOCAL_PROVIDERS.map(lp => {
          const status = statuses[lp.id];
          const isOnline = status === 'online';
          const isConnected = connected[lp.id];
          const endpoint = endpoints[lp.id];
          return (
            <div
              key={lp.id}
              className={`flex flex-col gap-2 p-3 rounded-xl border transition-colors
                ${isConnected ? 'border-success/40 bg-success/5' : 'border-border bg-secondary/40'}`}
            >
              {/* Top row: icon, name, status badge */}
              <div className="flex items-center gap-2.5">
                <ProviderIcon
                  isLocal
                  className={`h-4 w-4 shrink-0 ${isOnline ? 'text-success' : 'text-muted-foreground'}`}
                />
                <p className="text-xs font-semibold text-foreground flex-1">{lp.label}</p>
                <div className="flex items-center gap-2 shrink-0">
                  {status === 'checking' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  ) : isOnline ? (
                    <span className="flex items-center gap-1 text-[10px] text-success font-medium">
                      <Wifi className="h-3 w-3" /> Online
                    </span>
                  ) : status === 'offline' ? (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <WifiOff className="h-3 w-3" /> Offline
                    </span>
                  ) : null}
                  {isConnected && (
                    <span className="text-[10px] text-success flex items-center gap-0.5">
                      <CheckCircle2 className="h-3 w-3" /> Added
                    </span>
                  )}
                </div>
              </div>

              {/* Editable URL row */}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={endpoint}
                  onChange={e => handleEndpointChange(lp.id, e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && probeOne(lp.id, endpoint)}
                  className="flex-1 bg-input text-[11px] font-mono text-foreground rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground border border-border"
                  spellCheck={false}
                />
                <button
                  onClick={() => probeOne(lp.id, endpoint)}
                  disabled={status === 'checking'}
                  className="text-[10px] font-medium px-2 py-1 rounded-md bg-secondary border border-border text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors shrink-0"
                  title="Test connection"
                >
                  {status === 'checking' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Test'}
                </button>
                {!isConnected && isOnline && (
                  <button
                    onClick={() => handleConnect(lp)}
                    className="text-[10px] font-medium px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={probeAll}
        disabled={probing}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors self-start"
      >
        {probing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wifi className="h-3 w-3" />}
        Re-detect all
      </button>

      <p className="text-[11px] text-muted-foreground">
        Not running anything locally? Skip this — you can connect local servers later in Settings.
      </p>
    </div>
  );
};

// ─── Step 4: GitHub ───────────────────────────────────────────────────────────

const StepGitHub = ({ onDone }: { onDone: (v: boolean) => void }) => {
  const { githubToken, githubUser, setGithubToken, setGithubUser, setGithubTokenValid } = useGitStore();
  const [patInput, setPatInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => { onDone(!!githubToken || skipped); }, [githubToken, skipped, onDone]);

  const handleConnect = async () => {
    if (!patInput.trim()) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const result = await connectGithubWithToken(patInput.trim());
      if (result) {
        setGithubToken(patInput.trim());
        setGithubUser(result.login);
        setGithubTokenValid(true);
        setPatInput('');
      } else {
        setConnectError('Invalid token or network error. Make sure it has "repo" scope.');
      }
    } catch {
      setConnectError('Failed to connect to GitHub.');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-bold text-foreground">Connect GitHub</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Link your GitHub account to push code, clone repos, and create repositories.
        </p>
      </div>

      {githubToken && githubUser ? (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-success/40 bg-success/5">
          <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
          <div>
            <p className="text-sm font-semibold text-foreground">Connected</p>
            <p className="text-xs text-muted-foreground">
              Signed in as <span className="font-mono font-medium text-foreground">{githubUser}</span>
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <a
            href="https://github.com/settings/tokens/new?scopes=repo,workflow&description=Code+Scout+AI"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Create a Classic token (needs "repo" scope)
          </a>
          <p className="text-[11px] text-muted-foreground/70">
            Fine-grained tokens need "Administration: Write" to create repos.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={patInput}
              onChange={e => setPatInput(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-input border border-border text-xs font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              onKeyDown={e => e.key === 'Enter' && handleConnect()}
            />
            <button
              onClick={handleConnect}
              disabled={connecting || !patInput.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors shrink-0"
            >
              {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Github className="h-3 w-3" />}
              Connect
            </button>
          </div>
          {connectError && <p className="text-xs text-destructive">{connectError}</p>}
          {!skipped && (
            <button
              onClick={() => setSkipped(true)}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip for now
            </button>
          )}
          {skipped && (
            <p className="text-[11px] text-muted-foreground">Skipped — you can connect later from the toolbar.</p>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Step 5: Open Project ─────────────────────────────────────────────────────

const StepProject = ({ onDone, onClose }: { onDone: (v: boolean) => void; onClose: () => void }) => {
  const { createProject, setProjectAbsolutePath, setActiveProject } = useProjectStore();
  const { setProjectName, setProjectPath, setFiles, setDirHandle } = useWorkbenchStore();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { onDone(done); }, [done, onDone]);

  const handleOpenFolder = async () => {
    setError(null);
    setLoading('Opening folder…');
    try {
      if (isTauri()) {
        const result = await openDirectoryNative();
        const proj = createProject(result.projectName);
        setProjectAbsolutePath(proj.id, result.absolutePath);
        setProjectName(result.projectName);
        setProjectPath(result.absolutePath);
        setFiles(result.files);
        setActiveProject(proj.id);
        if (result.files.length > 0) {
          useProjectMemoryStore.getState().setIndexing(true);
          queueMicrotask(() => {
            try { indexProject(result.files, result.projectName, result.absolutePath); }
            finally { useProjectMemoryStore.getState().setIndexing(false); }
          });
        }
        setDone(true);
        localStorage.setItem('scout-welcomed', 'true');
        onClose();
      } else {
        const result = await openDirectory();
        createProject(result.projectName);
        setProjectName(result.projectName);
        setDirHandle(result.handle);
        setFiles(result.files);
        setDone(true);
        localStorage.setItem('scout-welcomed', 'true');
        onClose();
      }
    } catch (e) {
      if ((e as any)?.name !== 'AbortError') {
        setError(e instanceof Error ? e.message : 'Failed to open folder');
      }
    } finally {
      setLoading(null);
    }
  };

  const handleSkip = () => {
    localStorage.setItem('scout-welcomed', 'true');
    onClose();
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-bold text-foreground">Open a Project</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Open a project folder from your machine to start coding with AI assistance.
        </p>
      </div>

      <button
        onClick={handleOpenFolder}
        disabled={!!loading}
        className="w-full flex items-center gap-3 p-4 rounded-xl border border-border bg-secondary/40 hover:bg-surface-hover transition-colors text-left disabled:opacity-50"
      >
        {loading
          ? <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
          : <FolderOpen className="h-5 w-5 text-primary shrink-0" />
        }
        <div>
          <p className="text-xs font-semibold text-foreground">Open Folder</p>
          <p className="text-[11px] text-muted-foreground">{loading ?? 'Browse for an existing project directory'}</p>
        </div>
      </button>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="border-t border-border pt-4">
        <button
          onClick={handleSkip}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip for now — I'll open a project from the launcher
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export default WelcomeScreen;
