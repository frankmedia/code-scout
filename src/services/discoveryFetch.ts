import { isTauri } from '@/lib/tauri';

export interface ProbeResult {
  ok: boolean;
  status: number;
  body: string;
}

/** GET for health / props checks (Tauri bypasses CORS). */
export async function probeUrl(url: string, timeoutMs = 2500): Promise<ProbeResult> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const r = await invoke<{ status: number; body: string }>('http_request', { url });
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      body: r.body,
    };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, body };
}

/**
 * Fetch JSON for Discover (Ollama / LM Studio / llama.cpp).
 * In Tauri, uses native HTTP to avoid browser CORS on LAN URLs.
 */
export async function fetchDiscoveryJson(url: string): Promise<unknown> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const r = await invoke<{ status: number; body: string }>('http_request', { url });
    if (r.status < 200 || r.status >= 300) {
      throw new Error(
        `HTTP ${r.status}${r.body ? ` — ${r.body.slice(0, 160)}` : ''}`,
      );
    }
    const raw = (r.body ?? '').trim();
    if (!raw) return {} as unknown;
    return JSON.parse(raw) as unknown;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 160)}` : ''}`,
    );
  }
  return JSON.parse(text) as unknown;
}

export function formatDiscoveryError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const browser = !isTauri();
  if (
    browser &&
    (msg === 'Failed to fetch' ||
      msg.includes('Load failed') ||
      msg.includes('NetworkError'))
  ) {
    return (
      'Browser blocked this request (CORS). ' +
      'Open **Code Scout as the desktop app** (not only the browser) to discover models on another machine on your LAN, ' +
      'or run the UI from the same origin as the API.'
    );
  }
  return msg;
}
