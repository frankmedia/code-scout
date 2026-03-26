import { useState } from 'react';
import { X, Plus, Trash2, Star, Power, ChevronDown, Server, Brain, Code, TestTube } from 'lucide-react';
import {
  useModelStore,
  ModelConfig,
  AgentRole,
  ModelProvider,
  PROVIDER_OPTIONS,
  ROLE_OPTIONS,
} from '@/store/modelStore';

const roleIcons: Record<AgentRole, typeof Brain> = {
  orchestrator: Brain,
  coder: Code,
  tester: TestTube,
};

const AddModelForm = ({ onClose }: { onClose: () => void }) => {
  const { addModel } = useModelStore();
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<ModelProvider>('ollama');
  const [modelId, setModelId] = useState('');
  const [role, setRole] = useState<AgentRole>('coder');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');

  const selectedProvider = PROVIDER_OPTIONS.find(p => p.id === provider);

  const handleSubmit = () => {
    if (!name || !modelId) return;
    addModel({
      name,
      provider,
      modelId,
      role,
      endpoint: endpoint || selectedProvider?.defaultEndpoint || '',
      apiKey: apiKey || undefined,
      isDefault: false,
      enabled: true,
    });
    onClose();
  };

  return (
    <div className="bg-surface-panel border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Add Model</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Name */}
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Display Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. GPT-4o Orchestrator"
            className="w-full bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Provider */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Provider</label>
          <div className="relative">
            <select
              value={provider}
              onChange={e => setProvider(e.target.value as ModelProvider)}
              className="w-full appearance-none bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-8"
            >
              {PROVIDER_OPTIONS.map(p => (
                <option key={p.id} value={p.id}>{p.icon} {p.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Role */}
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Agent Role</label>
          <div className="relative">
            <select
              value={role}
              onChange={e => setRole(e.target.value as AgentRole)}
              className="w-full appearance-none bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary pr-8"
            >
              {ROLE_OPTIONS.map(r => (
                <option key={r.id} value={r.id}>{r.icon} {r.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          </div>
        </div>

        {/* Model ID */}
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Model ID</label>
          <input
            value={modelId}
            onChange={e => setModelId(e.target.value)}
            placeholder={provider === 'ollama' ? 'llama3.1:8b' : provider === 'openai' ? 'gpt-4o' : 'model-name'}
            className="w-full bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Endpoint */}
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">API Endpoint</label>
          <input
            value={endpoint}
            onChange={e => setEndpoint(e.target.value)}
            placeholder={selectedProvider?.defaultEndpoint || 'https://api.example.com'}
            className="w-full bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* API Key (only for cloud providers) */}
        {(['openai', 'anthropic', 'google', 'custom'] as ModelProvider[]).includes(provider) && (
          <div className="col-span-2">
            <label className="text-xs text-muted-foreground mb-1 block">API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full bg-secondary border border-border rounded-md px-3 py-1.5 text-xs text-foreground font-mono placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        )}
      </div>

      {/* Role description */}
      <div className="bg-secondary/50 rounded-md px-3 py-2">
        <p className="text-[10px] text-muted-foreground">
          {ROLE_OPTIONS.find(r => r.id === role)?.description}
        </p>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!name || !modelId}
        className="w-full bg-primary text-primary-foreground rounded-md py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Add Model
      </button>
    </div>
  );
};

const ModelCard = ({ model }: { model: ModelConfig }) => {
  const { removeModel, toggleModel, setDefault } = useModelStore();
  const RoleIcon = roleIcons[model.role];
  const providerInfo = PROVIDER_OPTIONS.find(p => p.id === model.provider);

  return (
    <div className={`group border rounded-lg p-3 transition-all ${
      model.enabled
        ? 'border-border bg-card hover:border-primary/30'
        : 'border-border/50 bg-card/50 opacity-60'
    }`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1.5 rounded-md ${
            model.role === 'orchestrator' ? 'bg-accent/20 text-accent' :
            model.role === 'coder' ? 'bg-primary/20 text-primary' :
            'bg-warning/20 text-warning'
          }`}>
            <RoleIcon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-foreground truncate">{model.name}</span>
              {model.isDefault && (
                <Star className="h-3 w-3 text-warning fill-warning shrink-0" />
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[10px] text-muted-foreground">{providerInfo?.icon} {providerInfo?.label}</span>
              <span className="text-[10px] text-muted-foreground">·</span>
              <span className="text-[10px] text-muted-foreground font-mono">{model.modelId}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setDefault(model.id, model.role)}
            title="Set as default for this role"
            className={`p-1 rounded transition-colors ${model.isDefault ? 'text-warning' : 'text-muted-foreground hover:text-warning'}`}
          >
            <Star className="h-3 w-3" />
          </button>
          <button
            onClick={() => toggleModel(model.id)}
            title={model.enabled ? 'Disable' : 'Enable'}
            className={`p-1 rounded transition-colors ${model.enabled ? 'text-success' : 'text-muted-foreground hover:text-success'}`}
          >
            <Power className="h-3 w-3" />
          </button>
          <button
            onClick={() => removeModel(model.id)}
            title="Remove"
            className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
};

const ModelSettings = () => {
  const { models, settingsOpen, setSettingsOpen } = useModelStore();
  const [showAdd, setShowAdd] = useState(false);

  if (!settingsOpen) return null;

  const grouped: Record<AgentRole, ModelConfig[]> = {
    orchestrator: models.filter(m => m.role === 'orchestrator'),
    coder: models.filter(m => m.role === 'coder'),
    tester: models.filter(m => m.role === 'tester'),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Model Configuration</h2>
          </div>
          <button
            onClick={() => setSettingsOpen(false)}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Info banner */}
        <div className="mx-5 mt-4 bg-accent/10 border border-accent/20 rounded-lg px-3 py-2">
          <p className="text-[11px] text-accent-foreground/80">
            <span className="font-semibold text-accent">Agent Routing:</span> The system auto-selects models by role —{' '}
            <span className="text-accent">orchestrators</span> plan,{' '}
            <span className="text-primary">coders</span> execute,{' '}
            <span className="text-warning">testers</span> validate.
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
                    {roleModels.map(m => <ModelCard key={m.id} model={m} />)}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add form */}
          {showAdd && <AddModelForm onClose={() => setShowAdd(false)} />}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {models.filter(m => m.enabled).length} active model{models.filter(m => m.enabled).length !== 1 ? 's' : ''}
          </span>
          {!showAdd && (
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
