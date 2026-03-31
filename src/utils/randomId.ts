/**
 * Message / entity ids. Tauri’s WKWebView can run in contexts where
 * `crypto.randomUUID` is missing or throws; avoid hard-crashing the UI.
 */
export function randomUuid(): string {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') {
      return c.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
