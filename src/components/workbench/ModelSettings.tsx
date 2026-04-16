import { useState, useCallback } from 'react';
import { X, Plus, Trash2, Star, Power, ChevronDown, Server, Brain, Code, TestTube, Pencil, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { ProviderIcon } from './AIPanel';
import {
  useModelStore,
  ModelConfig,
  AgentRole,
  ModelProvider,
  PROVIDER_OPTIONS,
  ROLE_OPTIONS,
} from '@/store/modelStore';
import { DEFAULT_LLAMA_CPP_URL, DEFAULT_OLLAMA_URL } from '@/config/llmNetworkDefaults';
import { resolveContextWindowTokens } from '@/config/modelContextDefaults';
import { effectiveSupportsVision, guessSupportsVisionFromModelId } from '@/config/modelVisionHeuristics';
import ModelDiscovery from './ModelDiscovery';

const roleIcons: Record<AgentRole, typeof Brain> = {
  orchestrator: Brain,
  coder: Code,
  tester: TestTube,
};

// ─── Model Form (shared for Add + Edit) ──────────────────────────────────────

interface ModelFormData {
  name: string;
  provider: ModelProvider;
  modelId: string;
  role: AgentRole;
  endpoint: string;
  apiKey: string;
  contextTokens: string;
  visionMode: 'auto' | 'on' | 'off';
}

const MODEL_HINTS: Record<ModelProvider, { placeholder: string; endpointHint: string; models: string[] }> = {
  ollama: { placeholder: 'llama3.1:8b', endpointHint: DEFAULT_OLLAMA_URL, models: ['llama3.1:8b', 'llama3.1:70b', 'codellama:13b', 'deepseek-coder-v2:16b', 'qwen2.5-coder:7b', 'mistral:7b'] },
  'lm-studio': { placeholder: 'local-model', endpointHint: 'http://localhost:1234', models: [] },
  'llama-cpp': { placeholder: 'default', endpointHint: DEFAULT_LLAMA_CPP_URL, models: [] },
  openai: { placeholder: 'gpt-4o', endpointHint: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini'] },
  anthropic: { placeholder: 'claude-sonnet-4-20250514', endpointHint: 'https://api.anthropic.com', models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-20250514'] },
  google: { placeholder: 'gemini-2.5-pro', endpointHint: 'https://generativelanguage.googleapis.com/v1beta', models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
  groq: { placeholder: 'llama-3.3-70b-versatile', endpointHint: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  mistral: { placeholder: 'mistral-large-latest', endpointHint: 'https://api.mistral.ai/v1', models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'] },
  deepseek: { placeholder: 'deepseek-chat', endpointHint: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-coder', 'deepseek-reasoner'] },
  openrouter: {
    placeholder: 'qwen/qwen2.5-coder-32b-instruct',
    endpointHint: 'https://openrouter.ai/api/v1',
    models: ['qwen/qwen2.5-coder-32b-instruct', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-r1'],
  },
  custom: { placeholder: 'model-name', endpointHint: 'https://your-api.com/v1', models: [] },
};

const needsApiKey = (provider: ModelProvider) =>
  ['openai', 'anthropic', 'google', 'groq', 'mistral', 'deepseek', 'openrouter', 'custom'].includes(provider);

const ModelForm = ({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: ModelFormData;
  onSubmit: (data: ModelFormData) => void;
  onCancel: () => void;
  submitLabel: string;
}) => {
  const [form, setForm] = useState<ModelFormData>(initial || {
    name: '',
    provider: 'ollama',
    modelId: '',
    role: 'coder',
    endpoint: '',
    apiKey: '',
    contextTokens: '',
    visionMode: 'auto',
  });
  const [showKey, setShowKey] = useState(false);

  const hints = MODEL_HINTS[form.provider];
  const update = (patch: Partial<ModelFormData>) => setForm(prev => ({ ...prev, ...patch }));

  // When provider changes, update endpoint hint
  const handleProviderChange = (provider: ModelProvider) => {
    const newHints = MODEL_HINTS[provider];
    update({
      provider,
      endpoint: newHints.endpointHint,
      modelId: '',
    });
  };

  return (
    <div className="bg-surface-panel border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{submitLabel === 'Save' ? 'Edit Model' : 'Add Model'}</h3>
        <button onClick={onCancel} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Display Name */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Display Name</label>
        <input
          value={form.name}
          onChange={e => update({ name: e.target.value })}
          placeholder="e.g. GPT-4o Orchestrator"
          className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Provider + Role row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Provider</label>
          <div className="relative">
            <select
              value={form.provider}
              onChange={e => handleProviderChange(e.target.value as ModelProvider)}
              className="w-full appearance-none bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-8"
            >
              {PROVIDER_OPTIONS.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Agent Role</label>
          <div className="relative">
            <select
              value={form.role}
              onChange={e => update({ role: e.target.value as AgentRole })}
              className="w-full appearance-none bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-8"
            >
              {ROLE_OPTIONS.map(r => (
                <option key={r.id} value={r.id}>{r.icon} {r.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Model ID — with quick-pick buttons for known providers */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Model ID</label>
        <input
          value={form.modelId}
          onChange={e => update({ modelId: e.target.value })}
          placeholder={hints.placeholder}
          className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {hints.models.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {hints.models.map(m => (
              <button
                key={m}
                onClick={() => update({ modelId: m })}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  form.modelId === m
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground hover:bg-surface-hover'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Endpoint */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">API Endpoint</label>
        <input
          value={form.endpoint}
          onChange={e => update({ endpoint: e.target.value })}
          placeholder={hints.endpointHint}
          className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <p className="text-[10px] text-muted-foreground mt-0.5">
          {form.provider === 'ollama' && 'Make sure Ollama is running locally'}
          {form.provider === 'lm-studio' && 'Start LM Studio server first'}
          {form.provider === 'openai' && 'Uses OpenAI chat completions API'}
          {form.provider === 'anthropic' && 'Uses Anthropic messages API'}
          {form.provider === 'google' && 'Uses Google Gemini API'}
          {form.provider === 'openrouter' && 'OpenRouter: OpenAI-compatible /v1/chat/completions'}
          {form.provider === 'groq' && 'Groq OpenAI-compatible API'}
          {form.provider === 'mistral' && 'Mistral API'}
          {form.provider === 'deepseek' && 'DeepSeek API'}
        </p>
      </div>

      {/* Context window + vision */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Context window (tokens)</label>
          <input
            type="number"
            min={1024}
            step={1024}
            value={form.contextTokens}
            onChange={e => update({ contextTokens: e.target.value })}
            placeholder="Auto from model id"
            className="w-full bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">Leave empty to guess from model name</p>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Images in chat</label>
          <div className="relative">
            <select
              value={form.visionMode}
              onChange={e => update({ visionMode: e.target.value as 'auto' | 'on' | 'off' })}
              className="w-full appearance-none bg-secondary border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-8"
            >
              <option value="auto">Auto (infer from model id)</option>
              <option value="on">Always on</option>
              <option value="off">Always off</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Auto: e.g. <span className="font-mono">qwen2.5-coder</span> → off, <span className="font-mono">*-vl</span> / llava → on
          </p>
        </div>
      </div>

      {/* API Key */}
      {needsApiKey(form.provider) && (
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">API Key</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={e => update({ apiKey: e.target.value })}
              placeholder={
                form.provider === 'openai' ? 'sk-...'
                : form.provider === 'anthropic' ? 'sk-ant-...'
                : form.provider === 'openrouter' ? 'sk-or-...'
                : 'your-api-key'
              }
              className="w-full bg-secondary border border-border rounded-md px-3 py-2 pr-9 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">Your key is stored locally and never sent to our servers</p>
        </div>
      )}

      {/* Role description */}
      <div className="bg-secondary/50 rounded-md px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{ROLE_OPTIONS.find(r => r.id === form.role)?.label}:</span>{' '}
          {ROLE_OPTIONS.find(r => r.id === form.role)?.description}
        </p>
      </div>

      {/* Submit */}
      <div className="flex gap-2">
        <button
          onClick={() => onSubmit(form)}
          disabled={!form.name || !form.modelId}
          className="flex-1 bg-primary text-primary-foreground rounded-md py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitLabel}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground bg-secondary hover:bg-surface-hover transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// ─── Model Card ──────────────────────────────────────────────────────────────

const ModelCard = ({ model, onEdit }: { model: ModelConfig; onEdit: (model: ModelConfig) => void }) => {
  const { removeModel, toggleModel, setDefault, refreshModelStats } = useModelStore();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const RoleIcon = roleIcons[model.role];
  const providerInfo = PROVIDER_OPTIONS.find(p => p.id === model.provider);

  const refreshStats = useCallback(async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      await refreshModelStats(model.id);
      // Check if we got anything back — if statsRefreshedAt didn't update, nothing came back
      const updated = useModelStore.getState().models.find(m => m.id === model.id);
      if (!updated?.statsRefreshedAt || updated.statsRefreshedAt === model.statsRefreshedAt) {
        setRefreshError('No data from provider');
      }
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : 'Refresh failed');
    } finally {
      setIsRefreshing(false);
    }
  }, [model.id, model.statsRefreshedAt, refreshModelStats]);

  return (
    <div className={`group border rounded-lg p-3 transition-all ${
      model.enabled
        ? 'border-border bg-card hover:border-primary/30'
        : 'border-border/50 bg-card/50 opacity-60'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className={`p-1.5 rounded-md shrink-0 ${
            model.role === 'orchestrator' ? 'bg-accent/20 text-accent' :
            model.role === 'coder' ? 'bg-primary/20 text-primary' :
            'bg-warning/20 text-warning'
          }`}>
            <RoleIcon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground truncate">{model.name}</span>
              {model.isDefault && (
                <Star className="h-3 w-3 text-warning fill-warning shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                {providerInfo && <ProviderIcon isLocal={providerInfo.isLocal} className="h-3 w-3" />}
                {providerInfo?.label}
              </span>
              <span className="text-[10px] text-muted-foreground">·</span>
              <span className="text-[10px] text-muted-foreground font-mono">{model.modelId}</span>
            </div>
            {model.endpoint && (
              <p className="text-[10px] text-muted-foreground/60 font-mono mt-0.5 truncate">{model.endpoint}</p>
            )}
            {model.apiKey && (
              <p className="text-[10px] text-success/60 mt-0.5">Key configured</p>
            )}
            <div className="flex flex-wrap gap-1 mt-1 items-center">
              {/* Context window badge */}
              <span
                className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                  model.contextTokens != null
                    ? 'bg-success/10 text-success'
                    : 'bg-secondary text-muted-foreground'
                }`}
                title={model.contextTokens != null ? 'Live value from provider API' : 'Estimated from model name — click ↺ to fetch real value'}
              >
                {isRefreshing
                  ? '…'
                  : `${resolveContextWindowTokens(model.contextTokens, model.modelId).toLocaleString()} ctx`
                }
                {model.contextTokens == null && !isRefreshing && (
                  <span className="opacity-60"> est</span>
                )}
              </span>
              {/* Vision badge */}
              {effectiveSupportsVision(model) && (
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary`}
                  title={
                    model.supportsVision === true
                      ? 'Vision: confirmed by provider API'
                      : 'Vision: inferred from model name (Auto)'
                  }
                >
                  Vision{model.supportsVision === undefined && <span className="opacity-60"> est</span>}
                </span>
              )}
              {/* Refresh error */}
              {refreshError && (
                <span className="text-[9px] text-destructive/70" title={refreshError}>no data</span>
              )}
              {/* Last refreshed timestamp */}
              {model.statsRefreshedAt != null && !isRefreshing && !refreshError && (
                <span className="text-[9px] text-muted-foreground/50" title={new Date(model.statsRefreshedAt).toLocaleString()}>
                  live · {new Date(model.statsRefreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={refreshStats}
            disabled={isRefreshing}
            title="Refresh stats from provider API (context window, vision support)"
            className={`p-1.5 rounded transition-colors ${
              isRefreshing
                ? 'text-primary cursor-wait'
                : 'text-muted-foreground hover:text-primary hover:bg-surface-hover'
            }`}
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => onEdit(model)}
            title="Edit model"
            className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-surface-hover"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={() => setDefault(model.id, model.role)}
            title="Set as default for this role"
            className={`p-1.5 rounded transition-colors ${model.isDefault ? 'text-warning' : 'text-muted-foreground hover:text-warning hover:bg-surface-hover'}`}
          >
            <Star className="h-3 w-3" />
          </button>
          <button
            onClick={() => toggleModel(model.id)}
            title={model.enabled ? 'Disable' : 'Enable'}
            className={`p-1.5 rounded transition-colors ${model.enabled ? 'text-success hover:bg-surface-hover' : 'text-muted-foreground hover:text-success hover:bg-surface-hover'}`}
          >
            <Power className="h-3 w-3" />
          </button>
          <button
            onClick={() => removeModel(model.id)}
            title="Remove"
            className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-surface-hover transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Advanced Settings ───────────────────────────────────────────────────────

const AdvancedSettings = () => {
  const orchTimeout = useModelStore(s => s.orchestratorTimeoutMs);
  const setOrchTimeout = useModelStore(s => s.setOrchestratorTimeout);
  const httpTimeout = useModelStore(s => s.httpTimeoutMs);
  const setHttpTimeout = useModelStore(s => s.setHttpTimeout);

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-3">Timeouts</h3>
        <div className="space-y-3">
          {/* Orchestrator evaluation timeout */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-foreground">Orchestrator evaluation</p>
              <p className="text-[10px] text-muted-foreground">
                How long to wait for the orchestrator to evaluate plan results before marking as complete.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="number"
                min={5}
                max={300}
                value={Math.round(orchTimeout / 1000)}
                onChange={e => setOrchTimeout(Number(e.target.value) * 1000)}
                className="w-16 rounded border border-border bg-background px-2 py-1 text-xs text-foreground text-right"
              />
              <span className="text-[10px] text-muted-foreground">sec</span>
            </div>
          </div>

          {/* HTTP request timeout */}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-foreground">Web search / fetch</p>
              <p className="text-[10px] text-muted-foreground">
                Max time per HTTP request during web search and URL fetch plan steps.
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <input
                type="number"
                min={5}
                max={300}
                value={Math.round(httpTimeout / 1000)}
                onChange={e => setHttpTimeout(Number(e.target.value) * 1000)}
                className="w-16 rounded border border-border bg-background px-2 py-1 text-xs text-foreground text-right"
              />
              <span className="text-[10px] text-muted-foreground">sec</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Main Settings Modal ─────────────────────────────────────────────────────

type SettingsTab = 'discover' | 'models' | 'advanced';

const ModelSettings = () => {
  const { models, settingsOpen, setSettingsOpen, addModel, updateModel } = useModelStore();
  const [showAdd, setShowAdd] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);
  const [tab, setTab] = useState<SettingsTab>('discover');

  if (!settingsOpen) return null;

  const grouped: Record<AgentRole, ModelConfig[]> = {
    orchestrator: models.filter(m => m.role === 'orchestrator'),
    coder: models.filter(m => m.role === 'coder'),
    tester: models.filter(m => m.role === 'tester'),
  };

  const handleAdd = (data: ModelFormData) => {
    const selectedProvider = PROVIDER_OPTIONS.find(p => p.id === data.provider);
    const ctx = data.contextTokens.trim();
    const parsedCtx = ctx ? parseInt(ctx, 10) : NaN;
    const vision =
      data.visionMode === 'on' ? { supportsVision: true as const }
      : data.visionMode === 'off' ? { supportsVision: false as const }
      : { supportsVision: undefined as boolean | undefined };
    addModel({
      name: data.name,
      provider: data.provider,
      modelId: data.modelId,
      role: data.role,
      endpoint: data.endpoint || selectedProvider?.defaultEndpoint || '',
      apiKey: data.apiKey || undefined,
      isDefault: false,
      enabled: true,
      contextTokens: Number.isFinite(parsedCtx) && parsedCtx > 0 ? parsedCtx : undefined,
      ...vision,
    });
    setShowAdd(false);
  };

  const handleEdit = (data: ModelFormData) => {
    if (!editingModel) return;
    const ctx = data.contextTokens.trim();
    const parsedCtx = ctx ? parseInt(ctx, 10) : NaN;
    const vision =
      data.visionMode === 'on' ? { supportsVision: true as const }
      : data.visionMode === 'off' ? { supportsVision: false as const }
      : { supportsVision: undefined as boolean | undefined };
    updateModel(editingModel.id, {
      name: data.name,
      provider: data.provider,
      modelId: data.modelId,
      role: data.role,
      endpoint: data.endpoint,
      apiKey: data.apiKey || undefined,
      contextTokens: Number.isFinite(parsedCtx) && parsedCtx > 0 ? parsedCtx : undefined,
      ...vision,
    });
    setEditingModel(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Model Configuration</h2>
          </div>
          <button
            onClick={() => { setSettingsOpen(false); setShowAdd(false); setEditingModel(null); }}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-border">
          {([
            { id: 'discover', label: 'Discover' },
            { id: 'models', label: 'Models & Roles' },
            { id: 'advanced', label: 'Advanced' },
          ] as { id: SettingsTab; label: string }[]).map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setShowAdd(false); setEditingModel(null); }}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* ─── Discover Tab ─── */}
          {tab === 'discover' && <ModelDiscovery />}

          {/* ─── Models Tab ─── */}
          {tab === 'models' && (
            <>
              {/* Edit form */}
              {editingModel && (
                <ModelForm
                  initial={{
                    name: editingModel.name,
                    provider: editingModel.provider,
                    modelId: editingModel.modelId,
                    role: editingModel.role,
                    endpoint: editingModel.endpoint || '',
                    apiKey: editingModel.apiKey || '',
                    contextTokens: editingModel.contextTokens != null ? String(editingModel.contextTokens) : '',
                    visionMode:
                      editingModel.supportsVision === true ? 'on'
                      : editingModel.supportsVision === false ? 'off'
                      : 'auto',
                  }}
                  onSubmit={handleEdit}
                  onCancel={() => setEditingModel(null)}
                  submitLabel="Save"
                />
              )}

              {/* Add form */}
              {showAdd && !editingModel && (
                <ModelForm
                  onSubmit={handleAdd}
                  onCancel={() => setShowAdd(false)}
                  submitLabel="Add Model"
                />
              )}

              {/* Model list grouped by role */}
              {!editingModel && !showAdd && (
                <>
                  {ROLE_OPTIONS.map(roleOpt => {
                    const RoleIcon = roleIcons[roleOpt.id];
                    const roleModels = grouped[roleOpt.id];
                    return (
                      <div key={roleOpt.id}>
                        <div className="flex items-center gap-2 mb-2">
                          <RoleIcon className={`h-3.5 w-3.5 ${
                            roleOpt.id === 'orchestrator' ? 'text-accent' :
                            roleOpt.id === 'coder' ? 'text-primary' : 'text-warning'
                          }`} />
                          <span className="text-xs font-semibold text-foreground">{roleOpt.label}</span>
                          <span className="text-[10px] text-muted-foreground">— {roleOpt.description}</span>
                        </div>
                        {roleModels.length === 0 ? (
                          <div className="border border-dashed border-border rounded-lg p-3 text-center">
                            <p className="text-[11px] text-muted-foreground">No models configured for this role</p>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {roleModels.map(m => (
                              <ModelCard key={m.id} model={m} onEdit={(model) => setEditingModel(model)} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}

          {/* ─── Advanced Tab ─── */}
          {tab === 'advanced' && (
            <AdvancedSettings />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {models.filter(m => m.enabled).length} active model{models.filter(m => m.enabled).length !== 1 ? 's' : ''}
          </span>
          {tab === 'models' && !showAdd && !editingModel && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add Model
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModelSettings;
