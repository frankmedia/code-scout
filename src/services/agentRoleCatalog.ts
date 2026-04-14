import { DEFAULT_OLLAMA_URL } from '@/config/llmNetworkDefaults';
import { fetchDiscoveryJson, formatDiscoveryError } from '@/services/discoveryFetch';
import {
  useModelStore,
  type AgentRole,
  type ModelConfig,
  type ModelProvider,
  PROVIDER_OPTIONS,
} from '@/store/modelStore';

export async function fetchOllamaModelIds(baseUrl: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '');
  const data = (await fetchDiscoveryJson(`${base}/api/tags`)) as { models?: { name: string }[] };
  const ids = (data.models ?? []).map(m => m.name).filter(Boolean);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export async function fetchOpenAiCompatibleModelIds(baseUrl: string): Promise<string[]> {
  const base = baseUrl.replace(/\/$/, '');
  const data = (await fetchDiscoveryJson(`${base}/v1/models`)) as { data?: { id: string }[] };
  const ids = (data.data ?? []).map(m => m.id).filter(Boolean);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export async function fetchOpenRouterModelIds(apiKey: string): Promise<string[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = (await res.json()) as { data?: { id: string }[] };
  const ids = (data.data ?? []).map(m => m.id).filter(Boolean);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export type RoleCatalogLists = {
  ollama: string[];
  openrouter: string[];
  lmstudio: string[];
  llamacpp: string[];
};

export type RoleCatalogFetchMeta = {
  ollamaEndpoint: string;
  ollamaError: string | null;
};

/**
 * Load full model id lists for onboarding / role dropdowns (Ollama tags, OpenRouter API, local OpenAI-compatible).
 */
export async function loadRoleCatalogLists(getState: typeof useModelStore.getState): Promise<{
  lists: RoleCatalogLists;
  meta: RoleCatalogFetchMeta;
}> {
  const st = getState();
  const ollamaEndpoint = (
    st.discoveryEndpoints.ollama?.trim() ||
    st.models.find(m => m.provider === 'ollama' && m.endpoint?.trim())?.endpoint?.trim() ||
    DEFAULT_OLLAMA_URL
  ).replace(/\/$/, '');

  const lmBase =
    st.discoveryEndpoints['lm-studio']?.trim() ||
    st.models.find(m => m.provider === 'lm-studio' && m.endpoint?.trim())?.endpoint?.trim() ||
    '';
  const lcBase =
    st.discoveryEndpoints['llama-cpp']?.trim() ||
    st.models.find(m => m.provider === 'llama-cpp' && m.endpoint?.trim())?.endpoint?.trim() ||
    '';

  let ollamaError: string | null = null;
  const [ollama, openrouter, lmstudio, llamacpp] = await Promise.all([
    (async () => {
      try {
        return await fetchOllamaModelIds(ollamaEndpoint);
      } catch (e) {
        ollamaError = formatDiscoveryError(e);
        return [] as string[];
      }
    })(),
    (async () => {
      const k = st.providerApiKeys.openrouter?.trim();
      if (!k) return [] as string[];
      try {
        return await fetchOpenRouterModelIds(k);
      } catch {
        return [] as string[];
      }
    })(),
    lmBase
      ? fetchOpenAiCompatibleModelIds(lmBase).catch(() => [] as string[])
      : Promise.resolve([] as string[]),
    lcBase
      ? fetchOpenAiCompatibleModelIds(lcBase).catch(() => [] as string[])
      : Promise.resolve([] as string[]),
  ]);

  return {
    lists: { ollama, openrouter, lmstudio, llamacpp },
    meta: { ollamaEndpoint, ollamaError },
  };
}

export type RoleCatalogOptionGroup = {
  label: string;
  options: { value: string; label: string }[];
};

/** Build `<select>` option groups: configured rows for the role, then full provider catalogs. */
export function buildRoleCatalogOptionGroups(
  role: AgentRole,
  models: ModelConfig[],
  lists: RoleCatalogLists,
): RoleCatalogOptionGroup[] {
  const configured = models.filter(m => m.enabled && m.role === role);
  const groups: RoleCatalogOptionGroup[] = [
    {
      label: 'Configured for this role',
      options: configured.map(m => ({ value: `id:${m.id}`, label: m.name })),
    },
  ];
  if (lists.ollama.length) {
    groups.push({
      label: 'Ollama (all tags on server)',
      options: lists.ollama.map(id => ({
        value: `pick:ollama:${encodeURIComponent(id)}`,
        label: id,
      })),
    });
  }
  if (lists.openrouter.length) {
    groups.push({
      label: 'OpenRouter (full catalog)',
      options: lists.openrouter.map(id => ({
        value: `pick:openrouter:${encodeURIComponent(id)}`,
        label: id,
      })),
    });
  }
  if (lists.lmstudio.length) {
    groups.push({
      label: 'LM Studio (server models)',
      options: lists.lmstudio.map(id => ({
        value: `pick:lm-studio:${encodeURIComponent(id)}`,
        label: id,
      })),
    });
  }
  if (lists.llamacpp.length) {
    groups.push({
      label: 'llama.cpp (server models)',
      options: lists.llamacpp.map(id => ({
        value: `pick:llama-cpp:${encodeURIComponent(id)}`,
        label: id,
      })),
    });
  }
  return groups;
}

export function roleCatalogSelectValue(current: { id: string } | undefined): string {
  return current ? `id:${current.id}` : '';
}

/**
 * `<select>` value is either `id:<uuid>` or `pick:<provider>:<encodeURIComponent(modelId)>`.
 */
export function applyRoleCatalogPick(role: AgentRole, value: string): void {
  if (!value) return;
  if (value.startsWith('id:')) {
    useModelStore.getState().setDefault(value.slice(3), role);
    return;
  }
  if (!value.startsWith('pick:')) return;
  const rest = value.slice(5);
  const colon = rest.indexOf(':');
  if (colon < 0) return;
  const provider = rest.slice(0, colon) as ModelProvider;
  const enc = rest.slice(colon + 1);
  let modelId: string;
  try {
    modelId = decodeURIComponent(enc);
  } catch {
    return;
  }
  const st = useModelStore.getState();
  const { endpoint, apiKey } = st.resolveModelRequestFieldsForProvider(provider, {});
  const provLabel = PROVIDER_OPTIONS.find(p => p.id === provider)?.label ?? provider;
  const roleTag = role === 'orchestrator' ? '(planner)' : '(coder)';

  const existing = st.models.find(
    m => m.provider === provider && m.modelId === modelId && m.role === role,
  );
  if (existing) {
    if (!existing.enabled) st.updateModel(existing.id, { enabled: true });
    st.setDefault(existing.id, role);
    return;
  }

  st.addModel(
    {
      name: `${provLabel} — ${modelId} ${roleTag}`.replace(/\s+/g, ' ').trim(),
      provider,
      modelId,
      role,
      endpoint,
      apiKey,
      enabled: true,
      isDefault: false,
    },
    true,
  );
}

export function countCatalogOptions(groups: RoleCatalogOptionGroup[]): number {
  return groups.reduce((n, g) => n + g.options.length, 0);
}
