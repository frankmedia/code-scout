import { create } from 'zustand';

export type AgentRole = 'orchestrator' | 'coder' | 'tester';
export type ModelProvider = 'ollama' | 'lm-studio' | 'llama-cpp' | 'openai' | 'anthropic' | 'google' | 'custom';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  modelId: string; // e.g. "llama3.1:8b", "gpt-4o", "claude-3.5-sonnet"
  role: AgentRole;
  endpoint?: string; // custom API endpoint
  apiKey?: string;
  isDefault: boolean;
  enabled: boolean;
}

export const PROVIDER_OPTIONS: { id: ModelProvider; label: string; icon: string; defaultEndpoint?: string }[] = [
  { id: 'ollama', label: 'Ollama', icon: '🟢', defaultEndpoint: 'http://localhost:11434' },
  { id: 'lm-studio', label: 'LM Studio', icon: '🟡', defaultEndpoint: 'http://localhost:1234' },
  { id: 'llama-cpp', label: 'llama.cpp', icon: '🔶', defaultEndpoint: 'http://localhost:8080' },
  { id: 'openai', label: 'OpenAI', icon: '🔵' },
  { id: 'anthropic', label: 'Anthropic', icon: '🟠' },
  { id: 'google', label: 'Google', icon: '🔴' },
  { id: 'custom', label: 'Custom API', icon: '⚙️' },
];

export const ROLE_OPTIONS: { id: AgentRole; label: string; description: string; icon: string }[] = [
  { id: 'orchestrator', label: 'Orchestrator', description: 'Plans tasks, breaks down work, coordinates agents', icon: '🧠' },
  { id: 'coder', label: 'Coder', description: 'Executes code changes, writes implementations', icon: '💻' },
  { id: 'tester', label: 'Tester', description: 'Writes and runs tests, validates changes', icon: '🧪' },
];

interface ModelStoreState {
  models: ModelConfig[];
  settingsOpen: boolean;
  addModel: (model: Omit<ModelConfig, 'id'>) => void;
  removeModel: (id: string) => void;
  updateModel: (id: string, updates: Partial<ModelConfig>) => void;
  toggleModel: (id: string) => void;
  setDefault: (id: string, role: AgentRole) => void;
  getModelForRole: (role: AgentRole) => ModelConfig | undefined;
  setSettingsOpen: (open: boolean) => void;
}

const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'default-orchestrator',
    name: 'Llama 3.1 8B (Planner)',
    provider: 'ollama',
    modelId: 'llama3.1:8b',
    role: 'orchestrator',
    endpoint: 'http://localhost:11434',
    isDefault: true,
    enabled: true,
  },
  {
    id: 'default-coder',
    name: 'DeepSeek Coder V2',
    provider: 'ollama',
    modelId: 'deepseek-coder-v2:16b',
    role: 'coder',
    endpoint: 'http://localhost:11434',
    isDefault: true,
    enabled: true,
  },
  {
    id: 'default-tester',
    name: 'CodeLlama 13B',
    provider: 'ollama',
    modelId: 'codellama:13b',
    role: 'tester',
    endpoint: 'http://localhost:11434',
    isDefault: true,
    enabled: true,
  },
];

export const useModelStore = create<ModelStoreState>((set, get) => ({
  models: DEFAULT_MODELS,
  settingsOpen: false,

  addModel: (model) => set(s => ({
    models: [...s.models, { ...model, id: crypto.randomUUID() }],
  })),

  removeModel: (id) => set(s => ({
    models: s.models.filter(m => m.id !== id),
  })),

  updateModel: (id, updates) => set(s => ({
    models: s.models.map(m => m.id === id ? { ...m, ...updates } : m),
  })),

  toggleModel: (id) => set(s => ({
    models: s.models.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m),
  })),

  setDefault: (id, role) => set(s => ({
    models: s.models.map(m => {
      if (m.role === role) return { ...m, isDefault: m.id === id };
      return m;
    }),
  })),

  getModelForRole: (role) => {
    const { models } = get();
    return models.find(m => m.role === role && m.isDefault && m.enabled)
      || models.find(m => m.role === role && m.enabled);
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));
