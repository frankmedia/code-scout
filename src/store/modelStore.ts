import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_LLAMA_CPP_URL, DEFAULT_OLLAMA_URL } from '@/config/llmNetworkDefaults';
import {
  DEFAULT_AGENT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_AGENT_STALL_WARNING_AFTER_MS,
  DEFAULT_AGENT_MAX_NO_TOOL_ROUNDS,
  DEFAULT_AGENT_MAX_ROUNDS,
  DEFAULT_AGENT_REPETITION_NUDGE_AT,
  DEFAULT_AGENT_REPETITION_EXIT_AT,
  DEFAULT_AGENT_MAX_CODER_ROUNDS,
  DEFAULT_AGENT_MAX_FILE_READ_CHARS,
  DEFAULT_AGENT_HISTORY_MESSAGES,
  DEFAULT_AGENT_BACKGROUND_SETTLE_MS,
} from '@/config/agentBehaviorDefaults';

export type AgentRole = 'orchestrator' | 'coder' | 'tester';
export type ModelProvider =
  | 'ollama'
  | 'lm-studio'
  | 'llama-cpp'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'groq'
  | 'mistral'
  | 'deepseek'
  | 'openrouter'
  | 'custom';

export interface ModelConfig {
  id: string;
  name: string;
  provider: ModelProvider;
  modelId: string;
  role: AgentRole;
  endpoint?: string;
  apiKey?: string;
  isDefault: boolean;
  enabled: boolean;
  /** Context window in tokens (optional; otherwise guessed from model id). */
  contextTokens?: number;
  /**
   * Image attachments in chat: `true` / `false` = forced; omit / `undefined` = infer from model id.
   */
  supportsVision?: boolean;
  /** Unix ms timestamp of the last successful stats fetch from the provider API. */
  statsRefreshedAt?: number;
}

export const PROVIDER_OPTIONS: {
  id: ModelProvider;
  label: string;
  icon: string;
  isLocal: boolean;
  defaultEndpoint?: string;
}[] = [
  // Local providers
  { id: 'ollama',    label: 'Ollama',     icon: '🟢', isLocal: true,  defaultEndpoint: DEFAULT_OLLAMA_URL },
  { id: 'lm-studio', label: 'LM Studio', icon: '🟡', isLocal: true,  defaultEndpoint: 'http://localhost:1234' },
  { id: 'llama-cpp', label: 'llama.cpp', icon: '🔶', isLocal: true,  defaultEndpoint: DEFAULT_LLAMA_CPP_URL },
  // Cloud providers — OpenRouter first, then budget/fast, then majors
  { id: 'openrouter', label: 'OpenRouter',    icon: '🧭', isLocal: false, defaultEndpoint: 'https://openrouter.ai/api/v1' },
  { id: 'deepseek',   label: 'DeepSeek',      icon: '🔍', isLocal: false },
  { id: 'groq',       label: 'Groq',          icon: '⚡', isLocal: false },
  { id: 'mistral',    label: 'Mistral',       icon: '🌊', isLocal: false },
  { id: 'openai',     label: 'OpenAI',        icon: '🔵', isLocal: false },
  { id: 'anthropic',  label: 'Anthropic',     icon: '🟠', isLocal: false },
  { id: 'google',     label: 'Google Gemini', icon: '🔴', isLocal: false },
  { id: 'custom',     label: 'Custom API',    icon: '⚙️', isLocal: false },
];

export const ROLE_OPTIONS: { id: AgentRole; label: string; description: string; icon: string }[] = [
  { id: 'orchestrator', label: 'Orchestrator', description: 'Plans tasks, breaks down work, coordinates agents', icon: '🧠' },
  { id: 'coder', label: 'Coder', description: 'Executes code changes, writes implementations', icon: '💻' },
  { id: 'tester', label: 'Tester', description: 'Writes and runs tests, validates changes', icon: '🧪' },
];

interface ModelStoreState {
  models: ModelConfig[];
  settingsOpen: boolean;
  // Which model the user has selected in the chat dropdown (by ID)
  selectedChatModel: string | null;
  /** Discover tab: last URL entered per local provider (Ollama, LM Studio, llama.cpp, …) */
  discoveryEndpoints: Partial<Record<ModelProvider, string>>;
  /** API keys typed in Discover — kept even before any cloud model row exists */
  providerApiKeys: Partial<Record<ModelProvider, string>>;
  /** Timeout (ms) for the orchestrator evaluation call after plan completion. Default 15000. */
  orchestratorTimeoutMs: number;
  setOrchestratorTimeout: (ms: number) => void;
  /** Timeout (ms) for web search / fetch HTTP requests during plan execution. Default 30000. */
  httpTimeoutMs: number;
  setHttpTimeout: (ms: number) => void;

  // ── Agent heartbeat & loop limits ──────────────────────────────────────────
  agentHeartbeatIntervalMs: number;
  agentStallWarningAfterMs: number;
  agentMaxNoToolRounds: number;
  agentMaxRounds: number;
  agentRepetitionNudgeAt: number;
  agentRepetitionExitAt: number;
  agentMaxCoderRounds: number;
  agentMaxFileReadChars: number;
  agentHistoryMessages: number;
  agentBackgroundSettleMs: number;
  setAgentHeartbeatIntervalMs: (ms: number) => void;
  setAgentHeartbeatEnabled: (on: boolean) => void;
  setAgentStallWarningAfterMs: (ms: number) => void;
  setAgentMaxNoToolRounds: (n: number) => void;
  setAgentMaxRounds: (n: number) => void;
  setAgentRepetitionNudgeAt: (n: number) => void;
  setAgentRepetitionExitAt: (n: number) => void;
  setAgentMaxCoderRounds: (n: number) => void;
  setAgentMaxFileReadChars: (n: number) => void;
  setAgentHistoryMessages: (n: number) => void;
  setAgentBackgroundSettleMs: (ms: number) => void;
  resetAgentLoopLimitsToDefaults: () => void;

  addModel: (model: Omit<ModelConfig, 'id'>, makeDefault?: boolean) => void;
  removeModel: (id: string) => void;
  updateModel: (id: string, updates: Partial<ModelConfig>) => void;
  toggleModel: (id: string) => void;
  setDefault: (id: string, role: AgentRole) => void;
  getModelForRole: (role: AgentRole) => ModelConfig | undefined;
  /** Refresh stats for a single model unconditionally. */
  refreshModelStats: (id: string) => Promise<void>;
  /** Refresh stats for all enabled models in the background (skips models refreshed recently). */
  refreshAllEnabledModels: (maxAgeMs?: number) => void;
  setSettingsOpen: (open: boolean) => void;
  setDiscoveryEndpoint: (provider: ModelProvider, url: string) => void;
  /** Persists key, applies to all models of this provider, and survives zero models */
  setProviderApiKey: (provider: ModelProvider, apiKey: string) => void;
  setSelectedChatModel: (id: string | null) => void;
  getSelectedChatModel: () => ModelConfig | undefined;
  resolveModelRequestFields: (model: ModelConfig) => { endpoint?: string; apiKey?: string };
  resolveModelRequestFieldsForProvider: (
    provider: ModelProvider,
    partial: { endpoint?: string; apiKey?: string },
  ) => { endpoint?: string; apiKey?: string };
}

// Default placeholders — no endpoint baked in.
// Users must set an endpoint in Settings → Models before these will work.
// Use the Discover tab to auto-detect local servers (Ollama, LM Studio, etc.).
const DEFAULT_MODELS: ModelConfig[] = [
  {
    id: 'default-orchestrator',
    name: 'Llama 3.1 8B (Planner)',
    provider: 'ollama',
    modelId: 'llama3.1:8b',
    role: 'orchestrator',
    isDefault: true,
    enabled: true,
  },
  {
    id: 'default-coder',
    name: 'DeepSeek Coder V2',
    provider: 'ollama',
    modelId: 'deepseek-coder-v2:16b',
    role: 'coder',
    isDefault: true,
    enabled: true,
  },
  {
    id: 'default-tester',
    name: 'CodeLlama 13B',
    provider: 'ollama',
    modelId: 'codellama:13b',
    role: 'tester',
    isDefault: true,
    enabled: true,
  },
];

export const useModelStore = create<ModelStoreState>()(
  persist(
    (set, get) => ({
      models: DEFAULT_MODELS,
      settingsOpen: false,
      selectedChatModel: null,
      discoveryEndpoints: {},
      providerApiKeys: {},
      orchestratorTimeoutMs: 15_000,
      setOrchestratorTimeout: (ms: number) => set({ orchestratorTimeoutMs: Math.max(5000, ms) }),
      httpTimeoutMs: 30_000,
      setHttpTimeout: (ms: number) => set({ httpTimeoutMs: Math.max(5000, ms) }),

      // ── Agent heartbeat & loop limits ────────────────────────────────────
      agentHeartbeatIntervalMs: DEFAULT_AGENT_HEARTBEAT_INTERVAL_MS,
      agentStallWarningAfterMs: DEFAULT_AGENT_STALL_WARNING_AFTER_MS,
      agentMaxNoToolRounds: DEFAULT_AGENT_MAX_NO_TOOL_ROUNDS,
      agentMaxRounds: DEFAULT_AGENT_MAX_ROUNDS,
      agentRepetitionNudgeAt: DEFAULT_AGENT_REPETITION_NUDGE_AT,
      agentRepetitionExitAt: DEFAULT_AGENT_REPETITION_EXIT_AT,
      agentMaxCoderRounds: DEFAULT_AGENT_MAX_CODER_ROUNDS,
      agentMaxFileReadChars: DEFAULT_AGENT_MAX_FILE_READ_CHARS,
      agentHistoryMessages: DEFAULT_AGENT_HISTORY_MESSAGES,
      agentBackgroundSettleMs: DEFAULT_AGENT_BACKGROUND_SETTLE_MS,
      setAgentHeartbeatIntervalMs: (ms) => set({ agentHeartbeatIntervalMs: Math.max(0, ms) }),
      setAgentHeartbeatEnabled: (on) => set({ agentHeartbeatIntervalMs: on ? DEFAULT_AGENT_HEARTBEAT_INTERVAL_MS : 0 }),
      setAgentStallWarningAfterMs: (ms) => set({ agentStallWarningAfterMs: Math.max(0, ms) }),
      setAgentMaxNoToolRounds: (n) => set({ agentMaxNoToolRounds: Math.max(1, n) }),
      setAgentMaxRounds: (n) => set({ agentMaxRounds: Math.max(1, n) }),
      setAgentRepetitionNudgeAt: (n) => set({ agentRepetitionNudgeAt: Math.max(1, n) }),
      setAgentRepetitionExitAt: (n) => set({ agentRepetitionExitAt: Math.max(2, n) }),
      setAgentMaxCoderRounds: (n) => set({ agentMaxCoderRounds: Math.max(1, n) }),
      setAgentMaxFileReadChars: (n) => set({ agentMaxFileReadChars: Math.max(1000, n) }),
      setAgentHistoryMessages: (n) => set({ agentHistoryMessages: Math.max(1, n) }),
      setAgentBackgroundSettleMs: (ms) => set({ agentBackgroundSettleMs: Math.max(1000, ms) }),
      resetAgentLoopLimitsToDefaults: () => set({
        agentHeartbeatIntervalMs: DEFAULT_AGENT_HEARTBEAT_INTERVAL_MS,
        agentStallWarningAfterMs: DEFAULT_AGENT_STALL_WARNING_AFTER_MS,
        agentMaxNoToolRounds: DEFAULT_AGENT_MAX_NO_TOOL_ROUNDS,
        agentMaxRounds: DEFAULT_AGENT_MAX_ROUNDS,
        agentRepetitionNudgeAt: DEFAULT_AGENT_REPETITION_NUDGE_AT,
        agentRepetitionExitAt: DEFAULT_AGENT_REPETITION_EXIT_AT,
        agentMaxCoderRounds: DEFAULT_AGENT_MAX_CODER_ROUNDS,
        agentMaxFileReadChars: DEFAULT_AGENT_MAX_FILE_READ_CHARS,
        agentHistoryMessages: DEFAULT_AGENT_HISTORY_MESSAGES,
        agentBackgroundSettleMs: DEFAULT_AGENT_BACKGROUND_SETTLE_MS,
      }),

      addModel: (model, makeDefault) => {
        const id = crypto.randomUUID();
        set(s => {
          const added = { ...model, id };
          const newModels = [...s.models, added];
          let providerApiKeys = s.providerApiKeys;
          const key = added.apiKey?.trim();
          if (key) {
            providerApiKeys = { ...s.providerApiKeys, [added.provider]: key };
          }
          const withDefaults = makeDefault
            ? newModels.map(m => m.role === model.role ? { ...m, isDefault: m.id === id } : m)
            : newModels;
          return { models: withDefaults, providerApiKeys };
        });
        // Immediately fetch real stats from the provider's API.
        setTimeout(() => get().refreshModelStats(id), 0);
      },

      removeModel: (id) => set(s => ({
        models: s.models.filter(m => m.id !== id),
      })),

      updateModel: (id, updates) => {
        set(s => {
          const nextModels = s.models.map(m => m.id === id ? { ...m, ...updates } : m);
          const m = nextModels.find(x => x.id === id);
          let providerApiKeys = s.providerApiKeys;
          if (m && 'apiKey' in updates) {
            providerApiKeys = { ...s.providerApiKeys };
            const key = m.apiKey?.trim();
            if (key) providerApiKeys[m.provider] = key;
            else {
              const otherHasKey = nextModels.some(
                x => x.provider === m.provider && x.id !== m.id && x.apiKey?.trim(),
              );
              if (!otherHasKey) delete providerApiKeys[m.provider];
            }
          }
          return { models: nextModels, providerApiKeys };
        });
        // If connectivity details changed, always re-fetch stats immediately
        const isConnectivityChange = 'endpoint' in updates || 'apiKey' in updates;
        const isStatsChange = 'contextTokens' in updates || 'supportsVision' in updates || 'statsRefreshedAt' in updates;
        if (isConnectivityChange && !isStatsChange) {
          const model = get().models.find(m => m.id === id);
          if (model?.enabled) {
            setTimeout(() => get().refreshModelStats(id), 0);
          }
        }
      },

      toggleModel: (id) => {
        set(s => ({
          models: s.models.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m),
        }));
        // After enabling, always refresh stats from the API
        const model = get().models.find(m => m.id === id);
        if (model?.enabled) {
          setTimeout(() => get().refreshModelStats(id), 0);
        }
      },

      setDefault: (id, role) => set(s => ({
        models: s.models.map(m => {
          if (m.role === role) return { ...m, isDefault: m.id === id };
          return m;
        }),
      })),

      refreshModelStats: async (id) => {
        const model = get().models.find(m => m.id === id);
        if (!model) return;
        const { fetchModelStats } = await import('@/services/modelContextFetcher');
        const stats = await fetchModelStats(model);
        const updates: Partial<ModelConfig> = { statsRefreshedAt: Date.now() };
        if (stats.contextTokens != null) updates.contextTokens = stats.contextTokens;
        if (stats.supportsVision != null) updates.supportsVision = stats.supportsVision;
        get().updateModel(id, updates);
      },

      refreshAllEnabledModels: (maxAgeMs = 10 * 60 * 1000) => {
        const now = Date.now();
        const stale = get().models.filter(m =>
          m.enabled &&
          (m.statsRefreshedAt == null || now - m.statsRefreshedAt > maxAgeMs),
        );
        if (stale.length === 0) return;
        // Stagger requests to avoid hammering the API
        stale.forEach((m, i) => {
          setTimeout(() => get().refreshModelStats(m.id), i * 400);
        });
      },

      getModelForRole: (role) => {
        const { models } = get();
        return models.find(m => m.role === role && m.isDefault && m.enabled)
          || models.find(m => m.role === role && m.enabled);
      },

      setSettingsOpen: (open) => set({ settingsOpen: open }),

      setDiscoveryEndpoint: (provider, url) =>
        set(s => {
          const next = { ...s.discoveryEndpoints };
          const t = url.trim();
          if (t) next[provider] = t;
          else delete next[provider];
          return { discoveryEndpoints: next };
        }),

      setProviderApiKey: (provider, apiKey) =>
        set(s => {
          const val = apiKey.trim() || undefined;
          const nextKeys = { ...s.providerApiKeys };
          if (val) nextKeys[provider] = val;
          else delete nextKeys[provider];
          return {
            providerApiKeys: nextKeys,
            models: s.models.map(m =>
              m.provider === provider ? { ...m, apiKey: val } : m
            ),
          };
        }),

      resolveModelRequestFieldsForProvider: (provider, partial) => {
        const s = get();
        const opt = PROVIDER_OPTIONS.find(p => p.id === provider);
        const fallbackEndpoint = opt?.defaultEndpoint;

        const apiKey =
          partial.apiKey ||
          s.providerApiKeys[provider] ||
          s.models.find(m => m.provider === provider && m.apiKey)?.apiKey ||
          undefined;

        const endpoint =
          partial.endpoint ||
          s.discoveryEndpoints[provider] ||
          s.models.find(m => m.provider === provider && m.endpoint)?.endpoint ||
          fallbackEndpoint ||
          undefined;

        return { endpoint, apiKey };
      },

      resolveModelRequestFields: (model) =>
        get().resolveModelRequestFieldsForProvider(model.provider, {
          endpoint: model.endpoint,
          apiKey: model.apiKey,
        }),

      setSelectedChatModel: (id) => set({ selectedChatModel: id }),

      getSelectedChatModel: () => {
        const { models, selectedChatModel } = get();
        if (selectedChatModel) {
          return models.find(m => m.id === selectedChatModel && m.enabled);
        }
        return undefined;
      },
    }),
    {
      name: 'coder-scout-models',
      // Don't persist UI state like settingsOpen
      partialize: (state) => ({
        models: state.models,
        selectedChatModel: state.selectedChatModel,
        discoveryEndpoints: state.discoveryEndpoints,
        providerApiKeys: state.providerApiKeys,
        orchestratorTimeoutMs: state.orchestratorTimeoutMs,
        httpTimeoutMs: state.httpTimeoutMs,
        agentHeartbeatIntervalMs: state.agentHeartbeatIntervalMs,
        agentStallWarningAfterMs: state.agentStallWarningAfterMs,
        agentMaxNoToolRounds: state.agentMaxNoToolRounds,
        agentMaxRounds: state.agentMaxRounds,
        agentRepetitionNudgeAt: state.agentRepetitionNudgeAt,
        agentRepetitionExitAt: state.agentRepetitionExitAt,
        agentMaxCoderRounds: state.agentMaxCoderRounds,
        agentMaxFileReadChars: state.agentMaxFileReadChars,
        agentHistoryMessages: state.agentHistoryMessages,
        agentBackgroundSettleMs: state.agentBackgroundSettleMs,
      }),
    }
  )
);
