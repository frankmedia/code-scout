import { useMemo, useState } from 'react';
import { Search, Check, Loader2, AlertCircle, ChevronDown, Wifi, WifiOff, Eye, EyeOff } from 'lucide-react';
import { ProviderIcon } from './AIPanel';
import { DEFAULT_LLAMA_CPP_URL, DEFAULT_OLLAMA_URL } from '@/config/llmNetworkDefaults';
import { fetchDiscoveryJson, formatDiscoveryError, probeUrl } from '@/services/discoveryFetch';
import { useModelStore, AgentRole, ModelProvider, ROLE_OPTIONS } from '@/store/modelStore';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiscoveredModel {
  id: string;         // model ID as returned by the provider
  name: string;       // display name
  provider: ModelProvider;
  endpoint?: string;
  apiKey?: string;
}

function filterModelsByQuery<T extends { id: string; name: string }>(items: T[], query: string): T[] {
  const n = query.trim().toLowerCase();
  if (!n) return items;
  return items.filter(m => m.id.toLowerCase().includes(n) || m.name.toLowerCase().includes(n));
}

// ─── Known cloud model lists ──────────────────────────────────────────────────

const CLOUD_PROVIDERS: {
  provider: ModelProvider;
  label: string;
  icon: string;
  apiKeyPlaceholder: string;
  endpoint: string;
  fetchModels: (apiKey: string) => Promise<string[]>;
  staticModels: string[];
}[] = [
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    icon: '🧭',
    apiKeyPlaceholder: 'sk-or-...',
    endpoint: 'https://openrouter.ai/api/v1',
    fetchModels: async (apiKey: string) => {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      return (data.data as { id: string }[]).map(m => m.id).sort();
    },
    staticModels: [
      'qwen/qwen2.5-coder-32b-instruct',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-r1',
    ],
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    icon: '🔍',
    apiKeyPlaceholder: 'sk-...',
    endpoint: 'https://api.deepseek.com/v1',
    fetchModels: async () => ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
    staticModels: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'],
  },
  {
    provider: 'groq',
    label: 'Groq',
    icon: '⚡',
    apiKeyPlaceholder: 'gsk_...',
    endpoint: 'https://api.groq.com/openai/v1',
    fetchModels: async (apiKey: string) => {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      return (data.data as { id: string }[]).map(m => m.id).sort();
    },
    staticModels: [
      'llama-3.3-70b-versatile', 'llama-3.1-8b-instant',
      'mixtral-8x7b-32768', 'gemma2-9b-it',
    ],
  },
  {
    provider: 'mistral',
    label: 'Mistral AI',
    icon: '🌊',
    apiKeyPlaceholder: '...',
    endpoint: 'https://api.mistral.ai/v1',
    fetchModels: async (apiKey: string) => {
      const res = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      return (data.data as { id: string }[]).map(m => m.id).sort();
    },
    staticModels: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    icon: '🔵',
    apiKeyPlaceholder: 'sk-...',
    endpoint: 'https://api.openai.com/v1',
    fetchModels: async (apiKey: string) => {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      return (data.data as { id: string }[])
        .map(m => m.id)
        .filter(id => id.startsWith('gpt-') || id.startsWith('o1') || id.startsWith('o3'))
        .sort();
    },
    staticModels: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'],
  },
  {
    provider: 'anthropic',
    label: 'Anthropic Claude',
    icon: '🟠',
    apiKeyPlaceholder: 'sk-ant-...',
    endpoint: 'https://api.anthropic.com',
    fetchModels: async () => [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
    ],
    staticModels: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  },
  {
    provider: 'google',
    label: 'Google Gemini',
    icon: '🔴',
    apiKeyPlaceholder: 'AIzaSy...',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    fetchModels: async (apiKey: string) => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      return (data.models as { name: string }[])
        .map(m => m.name.replace('models/', ''))
        .filter(id => id.startsWith('gemini'))
        .sort();
    },
    staticModels: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  },
];

// ─── Role selector chip ───────────────────────────────────────────────────────

const RoleSelect = ({
  value,
  onChange,
}: {
  value: AgentRole;
  onChange: (r: AgentRole) => void;
}) => (
  <div className="relative">
    <select
      value={value}
      onChange={e => onChange(e.target.value as AgentRole)}
      className="appearance-none bg-secondary border border-border rounded px-2 py-1 text-[10px] text-foreground pr-5 focus:outline-none focus:ring-1 focus:ring-primary"
    >
      {ROLE_OPTIONS.map(r => (
        <option key={r.id} value={r.id}>{r.icon} {r.label}</option>
      ))}
    </select>
    <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-muted-foreground pointer-events-none" />
  </div>
);

// ─── Single discovered model row ─────────────────────────────────────────────

const DiscoveredModelRow = ({ model }: { model: DiscoveredModel }) => {
  const { addModel, models, updateModel } = useModelStore();

  const existing = models.find(m => m.modelId === model.id && m.provider === model.provider);
  const selected = existing?.enabled === true;

  // Initialise role from the existing store entry so the dropdown reflects
  // what was previously saved, rather than always defaulting to 'coder'.
  const [role, setRole] = useState<AgentRole>(existing?.role ?? 'coder');

  const handleRoleChange = (newRole: AgentRole) => {
    setRole(newRole);
    // If the model is already selected, apply the role change immediately.
    if (existing) updateModel(existing.id, { role: newRole });
  };

  const handleSelect = () => {
    const st = useModelStore.getState();
    addModel(
      {
        name: model.name,
        provider: model.provider,
        modelId: model.id,
        role,
        endpoint:
          model.endpoint
          ?? st.discoveryEndpoints[model.provider]
          ?? st.models.find(m => m.provider === model.provider && m.endpoint)?.endpoint,
        apiKey: model.apiKey ?? st.providerApiKeys[model.provider],
        isDefault: false,
        enabled: true,
      },
      true,
    );
  };

  const toggleSelection = () => {
    if (selected && existing) {
      updateModel(existing.id, { enabled: false });
      return;
    }
    if (existing && !existing.enabled) {
      // Re-enable AND apply the currently selected role — the user may have
      // changed the role dropdown before clicking Select again.
      updateModel(existing.id, { enabled: true, role });
      return;
    }
    handleSelect();
  };

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-hover group">
      <span className="flex-1 text-xs text-foreground font-mono truncate" title={model.id}>
        {model.name}
      </span>
      <RoleSelect value={role} onChange={handleRoleChange} />
      <button
        type="button"
        onClick={toggleSelection}
        className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium shrink-0 min-w-[4.5rem] justify-center transition-colors ${
          selected
            ? 'bg-success/15 text-success border border-success/30 hover:bg-success/25'
            : 'bg-primary/15 text-primary hover:bg-primary/25 border border-transparent'
        }`}
      >
        {selected ? (
          <>
            <Check className="h-3 w-3" /> Selected
          </>
        ) : (
          'Select'
        )}
      </button>
    </div>
  );
};

// ─── llama.cpp — dedicated discovery section ──────────────────────────────────

/** Turn a .gguf filename into a human-readable display name */
function formatGgufName(filename: string): string {
  const stem = filename.replace(/\.gguf$/i, '');
  return stem
    .replace(/[-_.]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(\w)/g, c => c.toUpperCase())
    .trim();
}

/** Convert bytes to human-readable size */
function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${b} B`;
}

interface RunningLlamaServer {
  port: number;
  endpoint: string;
  modelId: string;    // from /v1/models
  modelPath: string;  // from /props — may be empty
  displayName: string;
}

interface GgufFile {
  path: string;       // absolute path
  filename: string;   // basename e.g. llama-3.2-3b.gguf
  displayName: string;
  sizeBytes: number;
}

const LLAMA_PORTS = [8080, 8081, 8082, 8083, 8084];

function hostFromLlamaBaseUrl(url: string): string {
  try {
    const u = new URL(url.trim().replace(/\/$/, ''));
    return u.hostname || 'localhost';
  } catch {
    return 'localhost';
  }
}

function llamaPortsForScan(baseUrl: string): number[] {
  let customPort = 8080;
  try {
    const u = new URL(baseUrl.trim().replace(/\/$/, ''));
    customPort = u.port ? parseInt(u.port, 10) : 8080;
  } catch {
    /* keep 8080 */
  }
  return [...new Set([...LLAMA_PORTS, customPort])].sort((a, b) => a - b);
}

async function probeLlamaServer(host: string, port: number): Promise<RunningLlamaServer | null> {
  const endpoint = `http://${host}:${port}`;
  try {
    // 1. Health check (probeUrl uses native HTTP in Tauri → no CORS on LAN)
    const health = await probeUrl(`${endpoint}/health`, 1500);
    if (!health.ok) return null;

    let modelId = '';
    let modelPath = '';

    // 2. /props — gives full model path (llama-server specific)
    try {
      const props = await probeUrl(`${endpoint}/props`, 2000);
      if (props.ok && props.body) {
        const p = JSON.parse(props.body) as { model_path?: string; model?: string };
        modelPath = p?.model_path ?? p?.model ?? '';
      }
    } catch { /* optional */ }

    // 3. /v1/models — OpenAI-compat, gives the model ID llama.cpp exposes
    try {
      const mods = await probeUrl(`${endpoint}/v1/models`, 2000);
      if (mods.ok && mods.body) {
        const m = JSON.parse(mods.body) as { data?: { id: string }[] };
        modelId = m?.data?.[0]?.id ?? '';
      }
    } catch { /* optional */ }

    // Derive display name: prefer path-based name → model ID → port
    const basename = modelPath
      ? modelPath.split('/').pop() ?? modelPath.split('\\').pop() ?? ''
      : modelId;
    const displayName = basename ? formatGgufName(basename) : `llama-server :${port}`;

    return {
      port,
      endpoint,
      modelId: modelId || basename || `local-${port}`,
      modelPath,
      displayName,
    };
  } catch {
    return null;
  }
}

const LlamaCppSection = () => {
  const { models, addModel, setDiscoveryEndpoint, updateModel } = useModelStore();
  const customEndpoint = useModelStore(s => {
    const stored = s.discoveryEndpoints['llama-cpp'];
    const fromModel = s.models.find(m => m.provider === 'llama-cpp' && m.endpoint)?.endpoint;
    return stored ?? fromModel ?? DEFAULT_LLAMA_CPP_URL;
  });

  // Live servers
  const [servers, setServers] = useState<RunningLlamaServer[]>([]);
  const [scanningServers, setScanningServers] = useState(false);
  const [serverScanDone, setServerScanDone] = useState(false);

  // GGUF files on disk (Tauri only)
  const [ggufFiles, setGgufFiles] = useState<GgufFile[]>([]);
  const [scanningFiles, setScanningFiles] = useState(false);
  const [fileScanDone, setFileScanDone] = useState(false);
  const [fileScanError, setFileScanError] = useState<string | null>(null);

  // Process list (Tauri only)
  const [processes, setProcesses] = useState<string[]>([]);
  const [resultFilter, setResultFilter] = useState('');

  const isInTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  const scanHost = hostFromLlamaBaseUrl(customEndpoint);
  const scanPorts = useMemo(() => llamaPortsForScan(customEndpoint), [customEndpoint]);

  const needle = resultFilter.trim().toLowerCase();
  const filteredServers = useMemo(() => {
    if (!needle) return servers;
    return servers.filter(
      s =>
        s.displayName.toLowerCase().includes(needle)
        || s.modelId.toLowerCase().includes(needle)
        || s.endpoint.toLowerCase().includes(needle)
        || (s.modelPath && s.modelPath.toLowerCase().includes(needle)),
    );
  }, [servers, needle]);

  const filteredGguf = useMemo(() => {
    if (!needle) return ggufFiles;
    return ggufFiles.filter(
      f =>
        f.displayName.toLowerCase().includes(needle)
        || f.filename.toLowerCase().includes(needle)
        || f.path.toLowerCase().includes(needle),
    );
  }, [ggufFiles, needle]);

  // ── Scan llama-server on host from Server endpoint URL ────────────────────

  const handleScanServers = async () => {
    setScanningServers(true);
    setServerScanDone(false);
    setServers([]);

    const ports = llamaPortsForScan(customEndpoint);
    const host = hostFromLlamaBaseUrl(customEndpoint);

    const results = await Promise.all(ports.map(p => probeLlamaServer(host, p)));
    setServers(results.filter((r): r is RunningLlamaServer => r !== null));
    setScanningServers(false);
    setServerScanDone(true);
  };

  // ── Scan filesystem for .gguf files (Tauri only) ─────────────────────────

  const handleScanFiles = async () => {
    if (!isInTauri) return;
    setScanningFiles(true);
    setFileScanDone(false);
    setFileScanError(null);
    setGgufFiles([]);
    setProcesses([]);

    try {
      const { executeCommand } = await import('@/lib/tauri');

      // Common GGUF storage locations
      const searchDirs = [
        '~/models',
        '~/.cache/lm-studio/models',
        '~/.cache/huggingface/hub',
        '~/Downloads',
        '~/.ollama/models',   // some people store .gguf here too
        '/usr/local/share/models',
      ].join(' ');

      // find: name *.gguf, max depth 6, print size + path
      const findResult = await executeCommand(
        `find ${searchDirs} -name "*.gguf" -maxdepth 6 -printf "%s %p\\n" 2>/dev/null || ` +
        // macOS fallback (no -printf)
        `find ${searchDirs} -name "*.gguf" -maxdepth 6 2>/dev/null | xargs -I{} sh -c 'echo "$(stat -f%z "{}" 2>/dev/null || stat -c%s "{}" 2>/dev/null) {}"'`
      );

      const files: GgufFile[] = [];
      for (const line of findResult.stdout.split('\n').filter(Boolean)) {
        const match = line.match(/^(\d+)\s+(.+\.gguf)$/i);
        if (match) {
          const sizeBytes = parseInt(match[1]);
          const path = match[2];
          const filename = path.split('/').pop() ?? path.split('\\').pop() ?? path;
          files.push({ path, filename, displayName: formatGgufName(filename), sizeBytes });
        }
      }
      setGgufFiles(files.sort((a, b) => b.sizeBytes - a.sizeBytes)); // largest first

      // Also inspect running processes
      const psResult = await executeCommand(`ps aux 2>/dev/null | grep -i 'llama-server\\|llama_server\\|llama.cpp' | grep -v grep`);
      const procs = psResult.stdout.split('\n').filter(l => l.includes('-m ') || l.includes('--model '));
      setProcesses(procs);

    } catch (e) {
      setFileScanError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setScanningFiles(false);
      setFileScanDone(true);
    }
  };

  // ── Add helpers ───────────────────────────────────────────────────────────

  const addServer = (s: RunningLlamaServer, role: AgentRole) => {
    addModel({
      name: s.displayName,
      provider: 'llama-cpp',
      modelId: s.modelId,
      role,
      endpoint: s.endpoint,
      isDefault: false,
      enabled: true,
    }, true);
  };

  const addGguf = (f: GgufFile, role: AgentRole) => {
    // The model ID is the filename without .gguf — llama-server typically uses
    // the file stem or "default" as the ID. User must start server with that file.
    const modelId = f.filename.replace(/\.gguf$/i, '');
    addModel({
      name: f.displayName,
      provider: 'llama-cpp',
      modelId,
      role,
      endpoint: customEndpoint.replace(/\/$/, ''),
      isDefault: false,
      enabled: true,
    }, true);
  };

  // ── Row subcomponent ──────────────────────────────────────────────────────

  const ModelRow = ({
    id,
    name,
    badge,
    onSelect,
  }: {
    id: string;
    name: string;
    badge?: React.ReactNode;
    onSelect: (role: AgentRole) => void;
  }) => {
    const [role, setRole] = useState<AgentRole>('coder');
    const normEp = (e?: string) => e?.replace(/\/$/, '') ?? '';
    const baseEp = normEp(customEndpoint);
    const existing = models.find(m => {
      if (m.provider !== 'llama-cpp') return false;
      if (id.startsWith('file-')) {
        const filePath = id.slice('file-'.length);
        const stem = filePath.split(/[/\\]/).pop()?.replace(/\.gguf$/i, '') ?? '';
        return m.modelId === stem && normEp(m.endpoint) === baseEp;
      }
      return normEp(m.endpoint) === normEp(id);
    });
    const selected = existing?.enabled === true;

    const toggle = () => {
      if (selected && existing) {
        updateModel(existing.id, { enabled: false });
        return;
      }
      if (existing && !existing.enabled) {
        updateModel(existing.id, { enabled: true });
        return;
      }
      onSelect(role);
    };

    return (
      <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-hover">
        <div className="flex-1 min-w-0">
          <span className="text-xs text-foreground font-mono truncate block" title={name}>{name}</span>
          {badge}
        </div>
        <RoleSelect value={role} onChange={setRole} />
        <button
          type="button"
          onClick={toggle}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium shrink-0 min-w-[4.5rem] justify-center transition-colors ${
            selected
              ? 'bg-success/15 text-success border border-success/30 hover:bg-success/25'
              : 'bg-primary/15 text-primary hover:bg-primary/25 border border-transparent'
          }`}
        >
          {selected ? (
            <>
              <Check className="h-3 w-3" /> Selected
            </>
          ) : (
            'Select'
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-panel border-b border-border">
        <span className="text-sm">🔶</span>
        <span className="text-xs font-semibold text-foreground">llama.cpp</span>
        <span className="text-[10px] text-muted-foreground ml-1">— one model per server process</span>
      </div>

      <div className="px-3 py-2.5 space-y-3">
        {/* Custom endpoint */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Server endpoint</label>
          <input
            value={customEndpoint}
            onChange={e => setDiscoveryEndpoint('llama-cpp', e.target.value)}
            placeholder={DEFAULT_LLAMA_CPP_URL}
            className="mt-1 w-full bg-input text-foreground text-xs font-mono rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
          />
        </div>

        {/* ── Live server scan ── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Scan llama-server (host from URL, ports 8080–8084)
            </span>
            <button
              onClick={handleScanServers}
              disabled={scanningServers}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/80 transition-colors disabled:opacity-50"
            >
              {scanningServers ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Search className="h-2.5 w-2.5" />}
              Scan
            </button>
          </div>

          {scanningServers && (
            <p className="text-[10px] text-muted-foreground">
              Probing {scanHost} on ports {scanPorts.join(', ')}…
            </p>
          )}

          {serverScanDone && servers.length === 0 && !scanningServers && (
            <p className="text-[10px] text-muted-foreground">
              No llama-server found. On the machine that runs the model, bind to all interfaces so your Mac can reach it:<br />
              <code className="font-mono bg-secondary px-1 rounded block mt-1">
                llama-server -m model.gguf --host 0.0.0.0 --port 8080
              </code>
              <span className="block mt-1 text-muted-foreground/80">
                Then set Server endpoint above to <code className="font-mono">http://&lt;that-machine-ip&gt;:8080</code> and scan again.
              </span>
            </p>
          )}

          {(servers.length > 0 || ggufFiles.length > 0) && (
            <div className="relative mb-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={resultFilter}
                onChange={e => setResultFilter(e.target.value)}
                placeholder="Filter servers & GGUF files…"
                className="w-full bg-input text-foreground text-xs rounded pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                aria-label="Filter llama.cpp scan results"
              />
            </div>
          )}

          {servers.length > 0 && (
            <div className="space-y-0.5">
              {filteredServers.length === 0 && needle ? (
                <p className="text-[10px] text-muted-foreground py-1">No servers match “{resultFilter.trim()}”.</p>
              ) : (
                filteredServers.map(s => (
                <ModelRow
                  key={s.endpoint}
                  id={s.endpoint}
                  name={s.displayName}
                  badge={
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] text-success">● :{ s.port}</span>
                      {s.modelPath && (
                        <span className="text-[9px] text-muted-foreground truncate max-w-[140px]" title={s.modelPath}>
                          {s.modelPath.split('/').pop()}
                        </span>
                      )}
                    </div>
                  }
                  onSelect={role => addServer(s, role)}
                />
                ))
              )}
            </div>
          )}
        </div>

        {/* ── GGUF filesystem scan (Tauri only) ── */}
        {isInTauri && (
          <div className="border-t border-border/50 pt-3">
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">GGUF files on disk</span>
                <p className="text-[9px] text-muted-foreground">Scans ~/models, ~/Downloads, ~/.cache/lm-studio, ~/.cache/huggingface</p>
              </div>
              <button
                onClick={handleScanFiles}
                disabled={scanningFiles}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-secondary text-foreground text-[10px] font-medium hover:bg-surface-hover transition-colors disabled:opacity-50 shrink-0"
              >
                {scanningFiles ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Search className="h-2.5 w-2.5" />}
                Scan files
              </button>
            </div>

            {scanningFiles && (
              <p className="text-[10px] text-muted-foreground">Searching filesystem for .gguf files…</p>
            )}

            {fileScanError && (
              <div className="flex items-start gap-1.5 text-[10px] text-destructive">
                <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                {fileScanError}
              </div>
            )}

            {fileScanDone && !scanningFiles && ggufFiles.length === 0 && !fileScanError && (
              <p className="text-[10px] text-muted-foreground">No .gguf files found in common locations.</p>
            )}

            {ggufFiles.length > 0 && (
              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                <p className="text-[9px] text-muted-foreground mb-1">
                  {ggufFiles.length} file{ggufFiles.length !== 1 ? 's' : ''} found
                  {needle && <span> · showing {filteredGguf.length}</span>}
                  {' '}— start llama-server with the file, then click Add
                </p>
                {filteredGguf.length === 0 && needle ? (
                  <p className="text-[10px] text-muted-foreground py-1">No files match “{resultFilter.trim()}”.</p>
                ) : (
                  filteredGguf.map(f => (
                  <ModelRow
                    key={f.path}
                    id={`file-${f.path}`}
                    name={f.displayName}
                    badge={
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] text-muted-foreground">{fmtBytes(f.sizeBytes)}</span>
                        <span className="text-[9px] text-muted-foreground/60 truncate max-w-[120px]" title={f.path}>
                          {f.path.replace(/^\/Users\/[^/]+/, '~')}
                        </span>
                      </div>
                    }
                    onSelect={role => addGguf(f, role)}
                  />
                  ))
                )}
              </div>
            )}

            {/* Running processes */}
            {processes.length > 0 && (
              <div className="mt-2 border-t border-border/50 pt-2">
                <p className="text-[9px] font-medium text-muted-foreground mb-1">Detected llama-server processes:</p>
                {processes.map((p, i) => {
                  // Extract -m flag value
                  const mMatch = p.match(/(?:-m|--model)\s+([^\s]+)/);
                  const modelArg = mMatch?.[1] ?? '';
                  return (
                    <div key={i} className="text-[9px] font-mono text-muted-foreground/70 truncate" title={p}>
                      → {modelArg || p.slice(0, 80)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Info note */}
        <div className="text-[9px] text-muted-foreground/60 border-t border-border/50 pt-2">
          💡 llama.cpp runs one model per process. Switch models by restarting with a different <code className="font-mono">-m</code> flag.
          Use <code className="font-mono">--port</code> to run multiple models on different ports simultaneously.
        </div>
      </div>
    </div>
  );
};

// ─── Local server discovery (Ollama / LM Studio) ─────────────────────────────

const LocalServerSection = ({
  provider,
  label,
  icon,
  defaultEndpoint,
  fetchUrl,
  discoverUrlCandidates,
  parseModels,
}: {
  provider: ModelProvider;
  label: string;
  icon: string;
  defaultEndpoint: string;
  fetchUrl: (endpoint: string) => string;
  /** Try these URLs in order (e.g. OpenAI /v1/models then legacy /models). */
  discoverUrlCandidates?: (base: string) => string[];
  parseModels: (data: unknown) => string[];
}) => {
  const models = useModelStore(s => s.models);
  const setDiscoveryEndpoint = useModelStore(s => s.setDiscoveryEndpoint);
  const endpoint = useModelStore(s => {
    const stored = s.discoveryEndpoints[provider];
    const fromModel = s.models.find(m => m.provider === provider && m.endpoint)?.endpoint;
    return stored ?? fromModel ?? defaultEndpoint;
  });
  const [discovered, setDiscovered] = useState<DiscoveredModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [modelFilter, setModelFilter] = useState('');

  const filteredDiscovered = useMemo(
    () => (discovered ? filterModelsByQuery(discovered, modelFilter) : null),
    [discovered, modelFilter],
  );

  const handleDiscover = async () => {
    setLoading(true);
    setError(null);
    setDiscovered(null);
    setStatus('idle');

    try {
      const ep = endpoint.replace(/\/$/, '');
      const urls = discoverUrlCandidates ? discoverUrlCandidates(ep) : [fetchUrl(ep)];
      let lastErr: unknown = null;
      let data: unknown | null = null;
      for (const url of urls) {
        try {
          data = await fetchDiscoveryJson(url);
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (data == null) {
        throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'Discovery failed'));
      }
      const ids = parseModels(data);
      setDiscovered(
        ids.map(id => ({
          id,
          name: id,
          provider,
          endpoint: ep,
        }))
      );
      setStatus('ok');
    } catch (e) {
      const hint = formatDiscoveryError(e);
      const extra = hint.includes('Browser blocked') || hint.includes('CORS')
        ? ''
        : ` ${label} at ${endpoint.replace(/\/$/, '')} must be reachable and expose the list API.`;
      setError(`${hint}${extra}`);
      setStatus('fail');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-panel border-b border-border">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-foreground">{label}</span>
        {status === 'ok' && <Wifi className="h-3 w-3 text-success ml-auto" />}
        {status === 'fail' && <WifiOff className="h-3 w-3 text-destructive ml-auto" />}
      </div>

      {/* Endpoint input */}
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex gap-2">
          <input
            value={endpoint}
            onChange={e => setDiscoveryEndpoint(provider, e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleDiscover()}
            placeholder={defaultEndpoint}
            className="flex-1 bg-input text-foreground text-xs font-mono rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
          />
          <button
            onClick={handleDiscover}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/80 transition-colors disabled:opacity-50 shrink-0"
          >
            {loading
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Search className="h-3 w-3" />
            }
            Discover
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {discovered !== null && discovered.length === 0 && (
          <p className="text-xs text-muted-foreground">No models found. Pull a model first.</p>
        )}

        {discovered !== null && discovered.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground">
              {discovered.length} model{discovered.length !== 1 ? 's' : ''} found
              {modelFilter.trim() && filteredDiscovered && (
                <span className="text-muted-foreground/80"> · showing {filteredDiscovered.length}</span>
              )}
            </p>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                value={modelFilter}
                onChange={e => setModelFilter(e.target.value)}
                placeholder="Filter models…"
                className="w-full bg-input text-foreground text-xs rounded pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                aria-label="Filter discovered models"
              />
            </div>
            <div className="space-y-0.5 max-h-72 overflow-y-auto">
              {filteredDiscovered?.length === 0 ? (
                <p className="text-[10px] text-muted-foreground py-2">No models match “{modelFilter.trim()}”.</p>
              ) : (
                filteredDiscovered?.map(m => <DiscoveredModelRow key={m.id} model={m} />)
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Cloud provider section ───────────────────────────────────────────────────

const CloudProviderSection = ({
  provider,
  label,
  icon,
  apiKeyPlaceholder,
  endpoint,
  fetchModels,
  staticModels,
}: (typeof CLOUD_PROVIDERS)[number]) => {
  const setProviderApiKey = useModelStore(s => s.setProviderApiKey);
  const apiKey = useModelStore(s => {
    const fromMap = s.providerApiKeys[provider];
    if (fromMap !== undefined) return fromMap;
    return s.models.find(m => m.provider === provider && m.apiKey)?.apiKey ?? '';
  });
  const [showKey, setShowKey] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [modelFilter, setModelFilter] = useState('');

  const filteredDiscovered = useMemo(
    () => (discovered ? filterModelsByQuery(discovered, modelFilter) : null),
    [discovered, modelFilter],
  );

  const handleDiscover = async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = await fetchModels(apiKey);
      setDiscovered(ids.map(id => ({ id, name: id, provider, endpoint, apiKey })));
    } catch (e) {
      // Fall back to static list
      setDiscovered(staticModels.map(id => ({ id, name: id, provider, endpoint, apiKey })));
      setError(e instanceof Error ? e.message : 'Using static model list');
    } finally {
      setLoading(false);
    }
    setExpanded(true);
  };

  const handleAddStatic = () => {
    setDiscovered(staticModels.map(id => ({ id, name: id, provider, endpoint, apiKey: apiKey || undefined })));
    setExpanded(true);
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-3 py-2.5 bg-surface-panel hover:bg-surface-hover transition-colors"
      >
        <ProviderIcon isLocal={false} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold text-foreground">{label}</span>
        <ChevronDown className={`h-3 w-3 text-muted-foreground ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3 py-2.5 space-y-2 border-t border-border">
          {/* API Key */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setProviderApiKey(provider, e.target.value)}
                placeholder={apiKeyPlaceholder}
                className="w-full bg-input text-foreground text-xs font-mono rounded px-2.5 py-1.5 pr-8 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              />
              <button
                onClick={() => setShowKey(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
            <button
              onClick={apiKey ? handleDiscover : handleAddStatic}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/80 transition-colors disabled:opacity-50 shrink-0"
            >
              {loading
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Search className="h-3 w-3" />
              }
              {apiKey ? 'Discover' : 'Show models'}
            </button>
          </div>

          {error && (
            <p className="text-[10px] text-warning">{error}</p>
          )}

          {discovered && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground">
                {discovered.length} model{discovered.length !== 1 ? 's' : ''}
                {modelFilter.trim() && (
                  <span className="text-muted-foreground/80"> · showing {filteredDiscovered?.length ?? 0}</span>
                )}
              </p>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                <input
                  type="search"
                  value={modelFilter}
                  onChange={e => setModelFilter(e.target.value)}
                  placeholder="Search models (e.g. qwen, claude)…"
                  className="w-full bg-input text-foreground text-xs rounded pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                  aria-label="Filter cloud model list"
                />
              </div>
              <div className="space-y-0.5 max-h-72 overflow-y-auto">
                {filteredDiscovered?.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground py-2">No models match “{modelFilter.trim()}”.</p>
                ) : (
                  filteredDiscovered?.map(m => <DiscoveredModelRow key={m.id} model={m} />)
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── llama.cpp quick start (Discover tab) ────────────────────────────────────

const LlamaCppRunHelp = () => (
  <div className="text-[9px] text-muted-foreground space-y-1.5 border border-border/70 rounded-lg px-3 py-2.5 bg-secondary/25">
    <p className="font-semibold text-foreground/90">How to run llama.cpp (llama-server)</p>
    <p>On the machine that has the model (.gguf), use a build that includes the <code className="font-mono text-[8px] bg-secondary px-1 rounded">server</code> binary. Example:</p>
    <code className="block font-mono bg-secondary px-2 py-1.5 rounded text-[8px] leading-relaxed whitespace-pre-wrap break-all">
      llama-server -m /path/to/model.gguf --host 0.0.0.0 --port 8080
    </code>
    <p>
      <code className="font-mono">--host 0.0.0.0</code> lets other computers on your LAN call this Mac/server. The OpenAI-compatible API should answer <code className="font-mono">GET /v1/models</code> (this app tries <code className="font-mono">/v1/models</code> then <code className="font-mono">/models</code>).
    </p>
    <p className="text-muted-foreground/90">
      <strong className="text-foreground/80">Discover from a browser tab often fails</strong> for URLs like <code className="font-mono">http://192.168.x.x:8080</code> (CORS). Use the <strong className="text-foreground/80">Code Scout desktop app</strong> for LAN discovery — it loads the list without browser restrictions.
    </p>
  </div>
);

// ─── Main Discovery Tab ───────────────────────────────────────────────────────

const ModelDiscovery = () => {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-foreground mb-0.5">Local Models</p>
        <p className="text-[10px] text-muted-foreground mb-3">
          Discover servers, then <strong className="text-foreground/80">Select</strong> models to include them in the chat model list (click <strong className="text-foreground/80">Selected</strong> to hide without deleting the row).
        </p>
        <div className="space-y-3">
          <LocalServerSection
            provider="ollama"
            label="Ollama"
            icon="🟢"
            defaultEndpoint={DEFAULT_OLLAMA_URL}
            fetchUrl={ep => `${ep}/api/tags`}
            parseModels={data => (data.models as { name: string }[]).map(m => m.name)}
          />
          <LocalServerSection
            provider="lm-studio"
            label="LM Studio"
            icon="🟡"
            defaultEndpoint="http://localhost:1234"
            fetchUrl={ep => `${ep}/v1/models`}
            parseModels={data => (data.data as { id: string }[]).map(m => m.id)}
          />
          <LocalServerSection
            provider="llama-cpp"
            label="llama.cpp"
            icon="🔶"
            defaultEndpoint={DEFAULT_LLAMA_CPP_URL}
            fetchUrl={ep => `${ep}/v1/models`}
            discoverUrlCandidates={ep => [`${ep}/v1/models`, `${ep}/models`]}
            parseModels={data => (data.data as { id: string }[]).map(m => m.id)}
          />
          <LlamaCppRunHelp />
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-xs font-semibold text-foreground mb-0.5">Cloud Providers</p>
        <p className="text-[10px] text-muted-foreground mb-3">
          Add API keys to discover and assign cloud models
        </p>
        <div className="space-y-2">
          {CLOUD_PROVIDERS.map(cp => (
            <CloudProviderSection key={cp.provider} {...cp} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default ModelDiscovery;
