import { useCallback, useEffect, useState } from 'react';
import { useModelStore } from '@/store/modelStore';
import {
  loadRoleCatalogLists,
  type RoleCatalogLists,
  type RoleCatalogFetchMeta,
} from '@/services/agentRoleCatalog';

/**
 * Fetches full Ollama tag list, OpenRouter catalog, and OpenAI-compatible local lists for role dropdowns.
 */
export function useAgentRoleCatalog() {
  const epOllama = useModelStore(s => s.discoveryEndpoints.ollama);
  const epLmStudio = useModelStore(s => s.discoveryEndpoints['lm-studio']);
  const epLlamaCpp = useModelStore(s => s.discoveryEndpoints['llama-cpp']);
  const providerOpenrouterKey = useModelStore(s => s.providerApiKeys.openrouter);
  const modelEndpointSig = useModelStore(s =>
    s.models
      .map(m => `${m.provider}:${m.endpoint ?? ''}:${m.enabled ? 1 : 0}`)
      .sort()
      .join('|'),
  );

  const [loading, setLoading] = useState(true);
  const [lists, setLists] = useState<RoleCatalogLists>({
    ollama: [],
    openrouter: [],
    lmstudio: [],
    llamacpp: [],
  });
  const [meta, setMeta] = useState<RoleCatalogFetchMeta>({
    ollamaEndpoint: '',
    ollamaError: null,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { lists: next, meta: m } = await loadRoleCatalogLists(useModelStore.getState);
      setLists(next);
      setMeta(m);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { lists: next, meta: m } = await loadRoleCatalogLists(useModelStore.getState);
        if (!cancelled) {
          setLists(next);
          setMeta(m);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [epOllama, epLmStudio, epLlamaCpp, providerOpenrouterKey, modelEndpointSig]);

  return { loading, lists, meta, refresh };
}
