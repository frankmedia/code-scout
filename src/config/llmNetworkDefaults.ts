/**
 * Default host for Ollama and llama-server when they run on another machine on your LAN.
 * Change `LAN_LLM_HOST` if your server IP moves.
 *
 * On the **server** (192.168.1.34):
 * - Ollama: listen on all interfaces, e.g. `OLLAMA_HOST=0.0.0.0 ollama serve` (or set in ollama service env).
 * - llama-server: use `--host 0.0.0.0` so port 8080+ is reachable from this Mac.
 */
export const LAN_LLM_HOST = '192.168.1.34';

/** Ollama API base (no trailing slash) */
export const DEFAULT_OLLAMA_URL = `http://${LAN_LLM_HOST}:11434`;

/** llama-server OpenAI-compatible base — one process per model, default port 8080 */
export const DEFAULT_LLAMA_CPP_URL = `http://${LAN_LLM_HOST}:8080`;
