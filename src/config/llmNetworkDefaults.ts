/**
 * Default host for Ollama and llama-server.
 * Defaults to localhost — users can change to a LAN IP in Settings → Discover.
 */
export const LAN_LLM_HOST = 'localhost';

/** Ollama API base (no trailing slash) */
export const DEFAULT_OLLAMA_URL = `http://${LAN_LLM_HOST}:11434`;

/** llama-server OpenAI-compatible base — one process per model, default port 8080 */
export const DEFAULT_LLAMA_CPP_URL = `http://${LAN_LLM_HOST}:8080`;
