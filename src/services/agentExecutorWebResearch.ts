/**
 * agentExecutorWebResearch.ts
 *
 * HTML/search utilities and web research step executors (web_search, fetch_url, browse_web).
 */

import type { PlanStep } from '@/store/workbenchStore';
import { useModelStore, type ModelConfig } from '@/store/modelStore';
import { isTauri, makeHttpRequest } from '@/lib/tauri';
import type { ExecutionCallbacks } from './agentExecutorContext';
import { addWebResearchContext, WEB_CONTENT_MAX_CHARS } from './agentExecutorContext';
import { DEFAULT_HTTP_TIMEOUT_MS } from '@/config/runtimeTimeoutDefaults';

/** Subset of ExecutionCallbacks for agent-tool web helpers. */
export type AgentWebResearchHooks = {
  onLog: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void;
  onTerminal: (line: string) => void;
};

// ─── HTML Utilities ─────────────────────────────────────────────────────────

/** Clean HTML entities and tags from a string */
export function cleanHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract real URL from DuckDuckGo redirect link.
 * DDG wraps results as //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
 */
export function extractDdgUrl(raw: string): string {
  const uddgMatch = raw.match(/[?&]uddg=([^&]+)/);
  if (uddgMatch) {
    try {
      return decodeURIComponent(uddgMatch[1]);
    } catch {
      return uddgMatch[1];
    }
  }
  if (raw.startsWith('//')) return 'https:' + raw;
  return raw;
}

/**
 * Parse DuckDuckGo HTML search results into structured snippets.
 */
export function parseDuckDuckGoResults(html: string): { title: string; url: string; snippet: string }[] {
  const results: { title: string; url: string; snippet: string }[] = [];
  let m;

  // Strategy 1: DDG HTML format
  const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const titles: { url: string; title: string }[] = [];
  while ((m = titleRegex.exec(html)) !== null) {
    const rawUrl = cleanHtml(m[1]);
    const url = extractDdgUrl(rawUrl);
    const title = cleanHtml(m[2]);
    if (url.startsWith('http') && title && title.length > 2) {
      titles.push({ url, title });
    }
  }

  const snippets: string[] = [];
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(cleanHtml(m[1]));
  }

  for (let i = 0; i < titles.length && i < 8; i++) {
    results.push({ title: titles[i].title, url: titles[i].url, snippet: snippets[i] || '' });
  }

  if (results.length > 0) return results;

  // Strategy 2: DDG lite format
  const liteLinkRegex = /<a[^>]*rel="nofollow"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const liteSnippetRegex = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi;

  const liteLinks: { url: string; title: string }[] = [];
  while ((m = liteLinkRegex.exec(html)) !== null) {
    const rawUrl = cleanHtml(m[1]);
    const url = extractDdgUrl(rawUrl);
    const title = cleanHtml(m[2]);
    if (url.startsWith('http') && title && title.length > 2 && !url.includes('duckduckgo.com')) {
      liteLinks.push({ url, title });
    }
  }

  const liteSnippets: string[] = [];
  while ((m = liteSnippetRegex.exec(html)) !== null) {
    liteSnippets.push(cleanHtml(m[1]));
  }

  for (let i = 0; i < liteLinks.length && i < 8; i++) {
    results.push({ title: liteLinks[i].title, url: liteLinks[i].url, snippet: liteSnippets[i] || '' });
  }

  if (results.length > 0) return results;

  // Strategy 3: Fallback — any <a> with uddg= parameter
  const anyUddgRegex = /<a[^>]*href="([^"]*uddg=[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set<string>();
  while ((m = anyUddgRegex.exec(html)) !== null) {
    const url = extractDdgUrl(cleanHtml(m[1]));
    const title = cleanHtml(m[2]);
    if (url.startsWith('http') && title && title.length > 2 && !seen.has(url)) {
      seen.add(url);
      results.push({ title, url, snippet: '' });
    }
    if (results.length >= 8) break;
  }

  return results;
}

/**
 * Strip HTML tags and collapse whitespace for readable text extraction.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── HTTP helper ────────────────────────────────────────────────────────────

/** Wraps makeHttpRequest with a hard timeout so a stalled HTTP call can't block plan execution. */
export async function makeHttpRequestWithTimeout(url: string): ReturnType<typeof makeHttpRequest> {
  const timeoutMs = useModelStore.getState().httpTimeoutMs || DEFAULT_HTTP_TIMEOUT_MS;
  return Promise.race([
    makeHttpRequest(url),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`HTTP request timed out after ${Math.round(timeoutMs / 1000)}s: ${url.slice(0, 120)}`)),
        timeoutMs,
      ),
    ),
  ]);
}

// ─── Agent tools + plan step executors ───────────────────────────────────────

/**
 * Web search for the agent tool loop (and shared with plan `web_search` steps).
 * Updates accumulated web-research context; returns text for the model.
 */
export async function runWebSearchForAgentTool(query: string, hooks: AgentWebResearchHooks): Promise<string> {
  const q = query.trim();
  if (!q) return 'Error: empty search query.';

  hooks.onTerminal(`[Internet · search] ${q}`);
  hooks.onLog(`[Internet · search] ${q}`, 'info');

  if (!isTauri()) {
    hooks.onTerminal('⚠ Web search requires the desktop build (Tauri)');
    hooks.onLog('Web search skipped — requires Tauri desktop', 'warning');
    return (
      'Web search is only available in the Code Scout desktop app (Tauri). ' +
      'Do not run npm install or shell commands to add web search — use this tool in the desktop build, or rely on local files and the user.'
    );
  }

  try {
    const encoded = encodeURIComponent(q);

    let results: { title: string; url: string; snippet: string }[] = [];

    const endpoints = [
      `https://html.duckduckgo.com/html/?q=${encoded}`,
      `https://lite.duckduckgo.com/lite/?q=${encoded}`,
    ];

    for (const searchUrl of endpoints) {
      try {
        hooks.onLog(`Trying: ${searchUrl}`, 'info');
        const response = await makeHttpRequestWithTimeout(searchUrl);
        if (response.status === 200 && response.body.length > 100) {
          results = parseDuckDuckGoResults(response.body);
          if (results.length > 0) {
            hooks.onLog(`Got ${results.length} results from ${searchUrl}`, 'info');
            break;
          }
        }
      } catch (e) {
        hooks.onLog(`Endpoint failed: ${searchUrl}: ${e}`, 'warning');
      }
    }

    if (results.length === 0) {
      try {
        const apiUrl = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;
        const apiResp = await makeHttpRequestWithTimeout(apiUrl);
        if (apiResp.status === 200) {
          const data = JSON.parse(apiResp.body) as {
            AbstractText?: string;
            Heading?: string;
            AbstractURL?: string;
            RelatedTopics?: Array<{ FirstURL?: string; Text?: string }>;
          };
          if (data.AbstractText) {
            results.push({
              title: data.Heading || q,
              url: data.AbstractURL || `https://duckduckgo.com/?q=${encoded}`,
              snippet: data.AbstractText,
            });
          }
          if (Array.isArray(data.RelatedTopics)) {
            for (const topic of data.RelatedTopics.slice(0, 6)) {
              if (topic.FirstURL && topic.Text) {
                results.push({ title: topic.Text.slice(0, 80), url: topic.FirstURL, snippet: topic.Text });
              }
            }
          }
        }
      } catch {
        /* JSON API failed */
      }
    }

    if (results.length === 0) {
      hooks.onTerminal('⚠ No search results found from any source');
      hooks.onLog('No search results found', 'warning');
      addWebResearchContext(`[Web search: "${q}"] — No results found.`);
      return `No search results found for: ${q}`;
    }

    const formatted = results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join('\n\n');

    hooks.onTerminal(`Found ${results.length} results:`);
    for (const r of results.slice(0, 5)) {
      const line1 = `  → ${r.title}`;
      const line2 = `    ${r.url}`;
      const line3 = r.snippet ? `    ${r.snippet}` : '';
      hooks.onTerminal(line1);
      hooks.onTerminal(line2);
      if (line3) hooks.onTerminal(line3);
    }

    const contextEntry = `[Web search: "${q}"]\n${formatted}`;
    addWebResearchContext(
      contextEntry.length > WEB_CONTENT_MAX_CHARS
        ? contextEntry.slice(0, WEB_CONTENT_MAX_CHARS) + '\n... (truncated)'
        : contextEntry,
    );

    hooks.onLog(`Web search found ${results.length} results`, 'success');
    return `Search results for "${q}":\n\n${formatted}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hooks.onLog(`Web search failed: ${msg}`, 'warning');
    hooks.onTerminal(`⚠ Search error: ${msg}`);
    return `Web search failed: ${msg}`;
  }
}

/**
 * HTTP fetch for the agent tool loop (and shared with plan `fetch_url` steps).
 */
export async function runFetchUrlForAgentTool(url: string, hooks: AgentWebResearchHooks): Promise<string> {
  const u = url.trim();
  if (!u) return 'Error: empty URL.';

  hooks.onTerminal(`[Internet · HTTP fetch] ${u}`);
  hooks.onLog(`[Internet · HTTP fetch] ${u}`, 'info');

  if (!isTauri()) {
    hooks.onTerminal('⚠ URL fetch requires the desktop build (Tauri)');
    hooks.onLog('URL fetch skipped — requires Tauri desktop', 'warning');
    return (
      'Fetching URLs is only available in the Code Scout desktop app (Tauri). ' +
      'Do not npm install CLI search tools — use this tool in the desktop build.'
    );
  }

  try {
    const response = await makeHttpRequestWithTimeout(u);

    if (response.status !== 200) {
      hooks.onLog(`Fetch returned HTTP ${response.status}`, 'warning');
      hooks.onTerminal(`⚠ HTTP ${response.status} from ${u}`);
      addWebResearchContext(`[Fetched: ${u}] — HTTP ${response.status} (failed)`);
      return `HTTP ${response.status} when fetching ${u}`;
    }

    const contentType = response.body.trimStart().startsWith('<')
      ? 'html'
      : response.body.trimStart().startsWith('{') || response.body.trimStart().startsWith('[')
        ? 'json'
        : 'text';

    let content: string;
    if (contentType === 'html') {
      content = htmlToText(response.body);
    } else {
      content = response.body;
    }

    if (content.length > WEB_CONTENT_MAX_CHARS) {
      content = content.slice(0, WEB_CONTENT_MAX_CHARS) + '\n... (truncated)';
    }

    const preview = content.slice(0, 300).replace(/\n/g, ' ');
    hooks.onTerminal(`✓ Fetched ${content.length} chars`);
    hooks.onTerminal(`  Preview: ${preview}...`);

    addWebResearchContext(`[Fetched: ${u}]\n${content}`);

    hooks.onLog(`Fetched ${content.length} chars from ${u}`, 'success');
    return `Fetched ${u} (${content.length} chars, ${contentType}):\n\n${content}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hooks.onLog(`Fetch failed: ${msg}`, 'warning');
    hooks.onTerminal(`⚠ Fetch error: ${msg}`);
    addWebResearchContext(`[Fetched: ${u}] — Error: ${msg}`);
    return `Fetch failed: ${msg}`;
  }
}

// ─── Step executors ─────────────────────────────────────────────────────────

export async function executeWebSearch(
  step: PlanStep,
  _model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const query = step.command;
  if (!query) throw new Error('No search query specified');

  const searchActId = callbacks.onActivity?.(
    'researching',
    `Searching: "${query.slice(0, 60)}"`,
    step.description.slice(0, 60),
  );
  try {
    const out = await runWebSearchForAgentTool(query, {
      onLog: callbacks.onLog,
      onTerminal: callbacks.onTerminal,
    });
    for (const line of out.split('\n')) {
      if (line.trim()) callbacks.onStepOutput?.(step, line);
    }
  } finally {
    if (searchActId) callbacks.onActivityComplete?.(searchActId);
  }
}

export async function executeFetchUrl(
  step: PlanStep,
  _model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const url = step.command;
  if (!url) throw new Error('No URL specified');

  const out = await runFetchUrlForAgentTool(url, {
    onLog: callbacks.onLog,
    onTerminal: callbacks.onTerminal,
  });
  const lines = out.split('\n');
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const line = lines[i];
    if (line.trim()) callbacks.onStepOutput?.(step, line);
  }
}

// ─── browse_web ─────────────────────────────────────────────────────────────

function normalizeBrowseActionsJson(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    return t.length ? t : null;
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

/**
 * Headless browser fetch for agent tools and plan `browse_web` steps.
 */
export async function runBrowseWebForAgentTool(
  url: string,
  browseActions: unknown,
  hooks: AgentWebResearchHooks,
): Promise<string> {
  const u = url.trim();
  if (!u) return 'Error: empty URL.';

  hooks.onTerminal(`[Internet · headless browser] ${u}`);
  hooks.onLog(`[Internet · headless browser] ${u}`, 'info');

  // Callers (agent tool executor, plan runner) must gate with isTauri() — avoid duplicate UX.

  try {
    const { invoke } = await import('@tauri-apps/api/core');

    const status = await invoke<string>('ensure_playwright');
    if (status !== 'ready') {
      hooks.onTerminal(`  🌐 Playwright installed (first-time setup)`);
    }

    const actionsJson = normalizeBrowseActionsJson(browseActions);
    const resultJson = await invoke<string>('browse_web', {
      url: u,
      actionsJson: actionsJson,
    });

    const result = JSON.parse(resultJson) as { title: string; content: string; url: string };
    const content = result.content ?? '';
    const truncated = content.length > WEB_CONTENT_MAX_CHARS
      ? content.slice(0, WEB_CONTENT_MAX_CHARS) + '\n... (truncated)'
      : content;

    const preview = truncated.slice(0, 300).replace(/\n/g, ' ');
    hooks.onTerminal(`  Title: ${result.title}`);
    hooks.onTerminal(`  Preview: ${preview}…`);

    addWebResearchContext(`[Browsed: ${result.url}]\nTitle: ${result.title}\n\n${truncated}`);
    hooks.onLog(`Browsed ${content.length} chars from ${result.url}`, 'success');
    return `Title: ${result.title}\nURL: ${result.url}\n\n${truncated}`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hooks.onLog(`Browse failed: ${msg}`, 'warning');
    hooks.onTerminal(`⚠ Browse error: ${msg}`);
    addWebResearchContext(`[Browsed: ${u}] — Error: ${msg}`);
    return `Browse failed: ${msg}`;
  }
}

export async function executeBrowseWeb(
  step: PlanStep,
  _model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const url = step.command;
  if (!url) throw new Error('No URL specified for browse_web');

  if (!isTauri()) {
    const msg =
      'browse_web requires the Code Scout desktop app. In the browser build use fetch_url or web_search for this step.';
    callbacks.onLog(msg, 'warning');
    callbacks.onTerminal(`! ${msg}`);
    callbacks.onStepOutput?.(step, msg);
    return;
  }

  const browseActions = (step as unknown as { browseActions?: unknown }).browseActions;
  const out = await runBrowseWebForAgentTool(url, browseActions, {
    onLog: callbacks.onLog,
    onTerminal: callbacks.onTerminal,
  });
  for (const line of out.split('\n').slice(0, 20)) {
    if (line.trim()) callbacks.onStepOutput?.(step, line);
  }
}
