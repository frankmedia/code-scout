import { useWorkbenchStore, PlanStep, Plan } from '@/store/workbenchStore';
import { useModelStore, ModelConfig } from '@/store/modelStore';
import { callModel, modelToRequest, ModelRequestMessage } from './modelApi';
import { verifyStep, VerificationInput, VerificationResult } from './verifierAgent';
import { writeFileToFS, deleteFileFromFS } from './fileSystemService';
import { isTauri, writeProjectFile, executeCommand, spawnCommand, makeHttpRequest } from '@/lib/tauri';
import {
  resolveProjectRoot,
  runProjectValidation,
  formatValidationFailure,
  normalizeValidationError,
  ValidationRunResult,
  collectProjectConfigHints,
  normalizeValidationCommand,
} from './validationRunner';
import { requestRepairFix, RepairFix, requestOrchestratorReplanning, OrchestratorReplanStep } from './repairAgent';
import type { EnvironmentInfo } from './environmentProbe';
import {
  createRepairLedger,
  nextRepairAction,
  recordAttempt,
  withProjectLock,
  formatLedgerForPrompt,
  bumpBudget,
  computeProgress,
} from './dependencyRepairEngine';
import { classifyFailure } from './validationRunner';
import type { RepairAttempt } from './repairTypes';
import { useTaskStore, EscalationDecision, EscalationContext } from '@/store/taskStore';
import { useAgentMemoryStore } from '@/store/agentMemoryStore';
import { flattenAllFilesCapped, raceWithTimeout } from './agentExecutorUtils';
import {
  isInstallCommand,
  buildInstallRecord,
  recordInstall,
  buildInstallContext,
} from './installTracker';

/** Normalise a file path to a consistent relative form (forward slashes, no leading slash). */
function normalizePath(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\/+/, '');
}

// ─── Universal path resolver ─────────────────────────────────────────────────
// LLMs frequently hallucinate paths: double prefixes (src/src/), wrong
// extensions (.js vs .ts), missing prefixes, etc. This resolver checks the
// path against the actual workbench file tree and fuzzy-matches the closest
// real file when the exact path doesn't exist.

/**
 * Detect the common directory prefix shared by project files in the tree.
 * E.g. if all files start with "website/", returns "website/".
 * Returns "" if files are at the root or have mixed prefixes.
 *
 * Hidden directories (.codescout, .git, .vscode, etc.) and root-level files
 * are excluded from the check — they are metadata, not project source.
 */
function detectFileTreePrefix(allFiles: { path: string }[]): string {
  if (!allFiles || allFiles.length === 0) return '';
  // Only consider files that are inside a non-hidden directory
  const withSlash = allFiles.filter(f => {
    if (!f.path.includes('/')) return false;
    const firstSeg = f.path.split('/')[0];
    // Ignore hidden dirs (.codescout, .git, .vscode, .github, etc.)
    return !firstSeg.startsWith('.');
  });
  if (withSlash.length === 0) return '';
  // Count occurrences of each first directory segment
  const counts = new Map<string, number>();
  for (const f of withSlash) {
    const seg = f.path.split('/')[0];
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  // If all non-hidden files share the same first directory, that's our prefix
  if (counts.size === 1) {
    const [prefix] = counts.keys();
    return `${prefix}/`;
  }
  // If one directory dominates (>= 80% of files), use it as prefix
  // This handles cases where a few stray files exist at root alongside the project dir
  const total = withSlash.length;
  for (const [seg, count] of counts) {
    if (count / total >= 0.8) return `${seg}/`;
  }
  return '';
}

export function resolveFilePath(
  rawPath: string,
  getFileContent: (path: string) => string | undefined,
  allFiles?: { path: string }[],
): { resolved: string; changed: boolean } {
  const p = normalizePath(rawPath);

  // 1. Exact match — fast path
  if (getFileContent(p) !== undefined) return { resolved: p, changed: false };

  // Detect the project subdirectory prefix from the actual file tree
  // e.g. if user opened WEBSITE/ and project is in WEBSITE/website/,
  // all store paths start with "website/" but LLM generates paths without it
  const projectPrefix = allFiles ? detectFileTreePrefix(allFiles) : '';

  // 2. Fix doubled directory prefixes: src/src/x → src/x, website/website/x → website/x
  const doublePrefix = p.match(/^([^/]+)\/\1\/(.*)/);
  if (doublePrefix) {
    const fixed = `${doublePrefix[1]}/${doublePrefix[2]}`;
    if (getFileContent(fixed) !== undefined) return { resolved: fixed, changed: true };
    // Also try with project prefix: src/src/App.jsx → website/src/App.jsx
    if (projectPrefix && getFileContent(projectPrefix + fixed) !== undefined) {
      return { resolved: projectPrefix + fixed, changed: true };
    }
  }

  // 3. Try adding project prefix (THE KEY FIX for nested projects)
  // LLM generates "src/App.jsx" but store has "website/src/App.jsx"
  if (projectPrefix && !p.startsWith(projectPrefix)) {
    const withPrefix = projectPrefix + p;
    if (getFileContent(withPrefix) !== undefined) return { resolved: withPrefix, changed: true };
  }

  // 4. Strip a leading directory that doesn't exist (e.g. LLM adds project name or wrong prefix)
  const parts = p.split('/');
  if (parts.length >= 2) {
    const stripped = parts.slice(1).join('/');
    if (getFileContent(stripped) !== undefined) return { resolved: stripped, changed: true };
    // Also try project prefix + stripped
    if (projectPrefix && getFileContent(projectPrefix + stripped) !== undefined) {
      return { resolved: projectPrefix + stripped, changed: true };
    }
  }

  // 5. Common extension mismatches
  const extSwaps: Record<string, string[]> = {
    '.js':  ['.ts', '.jsx', '.tsx', '.mjs', '.cjs'],
    '.ts':  ['.js', '.tsx', '.jsx'],
    '.jsx': ['.tsx', '.js', '.ts'],
    '.tsx': ['.jsx', '.ts', '.js'],
    '.mjs': ['.js', '.ts'],
    '.cjs': ['.js', '.ts'],
  };
  const ext = '.' + (p.split('.').pop() ?? '');
  const base = p.slice(0, p.length - ext.length);
  for (const alt of extSwaps[ext] ?? []) {
    const altPath = base + alt;
    if (getFileContent(altPath) !== undefined) return { resolved: altPath, changed: true };
    if (projectPrefix && getFileContent(projectPrefix + altPath) !== undefined) {
      return { resolved: projectPrefix + altPath, changed: true };
    }
  }

  // 6. Try adding/removing common prefixes
  const tryPrefixes = ['src/', 'app/', 'lib/', 'pages/'];
  for (const pre of tryPrefixes) {
    if (!p.startsWith(pre)) {
      const withPre = pre + p;
      if (getFileContent(withPre) !== undefined) return { resolved: withPre, changed: true };
      if (projectPrefix && getFileContent(projectPrefix + withPre) !== undefined) {
        return { resolved: projectPrefix + withPre, changed: true };
      }
    }
    if (p.startsWith(pre)) {
      const withoutPre = p.slice(pre.length);
      if (getFileContent(withoutPre) !== undefined) return { resolved: withoutPre, changed: true };
      if (projectPrefix && getFileContent(projectPrefix + withoutPre) !== undefined) {
        return { resolved: projectPrefix + withoutPre, changed: true };
      }
    }
  }

  // 7. Basename match — find any file in the tree with the same filename
  if (allFiles) {
    const basename = p.split('/').pop()!;
    const matches = allFiles.filter(f => f.path.endsWith('/' + basename) || f.path === basename);
    if (matches.length === 1) return { resolved: matches[0].path, changed: true };
  }

  // 8. Last resort for create_file: fix obviously broken paths even if target doesn't exist yet
  // src/src/App.jsx → src/App.jsx (doubled prefix is ALWAYS wrong)
  if (doublePrefix) {
    const fixed = `${doublePrefix[1]}/${doublePrefix[2]}`;
    return { resolved: projectPrefix ? projectPrefix + fixed : fixed, changed: true };
  }

  // If project prefix detected and path doesn't have it, add it for new files
  if (projectPrefix && !p.startsWith(projectPrefix)) {
    return { resolved: projectPrefix + p, changed: true };
  }

  // No match found — return original
  return { resolved: p, changed: false };
}

/** Repeated directory segment in shell strings, e.g. src/src/ → src/ */
const DOUBLE_DIR_IN_COMMAND = /([a-zA-Z0-9_.-]+)\/\1\//g;

/**
 * Fix doubled path segments inside a shell command (mv, mkdir, cp, rm, etc.).
 * LLMs often emit src/src/... even when the real tree is src/...
 */
export function normalizeCommandPaths(command: string): { normalized: string; changed: boolean } {
  let out = command;
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out.replace(DOUBLE_DIR_IN_COMMAND, '$1/');
  }
  return { normalized: out, changed: out !== command };
}

/**
 * Pre-process all plan step paths before execution begins.
 * Fixes hallucinated paths (double prefixes, wrong extensions, etc.)
 * against the actual file tree. Also normalizes paths embedded in run_command strings.
 */
function normalizePlanPaths(
  plan: Plan,
  getFileContent: (path: string) => string | undefined,
  allFiles: { path: string }[],
  onLog: (msg: string, type: 'info' | 'warning') => void,
): void {
  for (const step of plan.steps) {
    if (step.action === 'run_command' && step.command) {
      const { normalized, changed } = normalizeCommandPaths(step.command);
      if (changed) {
        onLog(`Command path fix: "${step.command}" → "${normalized}"`, 'warning');
        step.command = normalized;
      }
      continue;
    }

    if (!step.path) continue;

    const { resolved, changed } = resolveFilePath(step.path, getFileContent, allFiles);
    if (changed) {
      onLog(`Path fix: "${step.path}" → "${resolved}"`, 'warning');
      step.path = resolved;
    }
  }
}

/** Flatten all files from a FileNode tree into a flat list. */
function flattenAllFiles(nodes: import('@/store/workbenchStore').FileNode[]): { path: string; name: string }[] {
  const result: { path: string; name: string }[] = [];
  for (const n of nodes) {
    if (n.type === 'file') result.push({ path: n.path, name: n.name });
    if (n.children) result.push(...flattenAllFiles(n.children));
  }
  return result;
}

/**
 * Hard cap on repair attempts per step.
 * The repair engine enforces this via RepairEngineConfig.maxTotalAttempts;
 * this export is kept for backwards-compat with UI components.
 */
export const MAX_REPAIR_ATTEMPTS_PER_STEP = 20;

/**
 * @deprecated — repair sequencing is now driven by dependencyRepairEngine.
 * Kept to avoid breaking imports in UI components.
 */
export const ORCHESTRATOR_HELP_THRESHOLD = 3;

/**
 * @deprecated — escalation is now driven by dependencyRepairEngine's escalate_to_user action.
 * Kept to avoid breaking imports in UI components.
 */
export const ESCALATION_THRESHOLD = 3;

/** Per-file cap when inlining sibling context into coder prompts. */
const MAX_SIBLING_CONTEXT_PER_FILE = 8_000;
/** Total cap for all sibling context blocks. */
const MAX_SIBLING_CONTEXT_TOTAL = 32_000;
/** Max same-directory files to attach besides importers. */
const MAX_SAME_DIR_FILES = 8;
/** Warn when a generated file exceeds this many lines — it may eat the context window. */
const MAX_GENERATED_FILE_LINES = 2_000;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collects existing project files the coder should see when creating/editing a file
 * so exports/imports and dependencies stay consistent across steps.
 */
function gatherSiblingContext(
  targetPath: string,
  getFileContent: (path: string) => string | undefined,
  allFiles: { path: string; name: string }[],
): Record<string, string> {
  const norm = normalizePath(targetPath);
  const targetBase = norm.split('/').pop() ?? '';
  const stem = targetBase.replace(/\.[^.]+$/, '') || targetBase;
  const out: Record<string, string> = {};

  const addFile = (p: string) => {
    const key = normalizePath(p);
    if (key === norm || out[key] !== undefined) return;
    const c = getFileContent(key);
    if (c === undefined) return;
    out[key] =
      c.length > MAX_SIBLING_CONTEXT_PER_FILE
        ? `${c.slice(0, MAX_SIBLING_CONTEXT_PER_FILE)}\n... (truncated)`
        : c;
  };

  for (const f of allFiles) {
    if (f.name === 'package.json') addFile(f.path);
  }
  if (getFileContent('package.json') !== undefined) addFile('package.json');

  const rootConfigs = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs', 'index.html', 'tsconfig.json', 'tsconfig.app.json'];
  for (const name of rootConfigs) {
    const hit = allFiles.find(f => f.name === name);
    if (hit) addFile(hit.path);
  }

  if (stem) {
    const importRes = [
      new RegExp(`from\\s+['"]\\.\\/?${escapeRegex(stem)}['"]`, 'm'),
      new RegExp(`from\\s+['"]\\.\\/?${escapeRegex(stem)}\\.(jsx?|tsx?)['"]`, 'm'),
      new RegExp(`require\\(\\s*['"]\\.\\/?${escapeRegex(stem)}['"]`, 'm'),
      new RegExp(`require\\(\\s*['"]\\.\\/?${escapeRegex(stem)}\\.(jsx?|tsx?)['"]`, 'm'),
    ];
    for (const f of allFiles) {
      if (normalizePath(f.path) === norm) continue;
      const c = getFileContent(f.path);
      if (!c) continue;
      if (importRes.some(re => re.test(c))) addFile(f.path);
    }
  }

  const dir = norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : '';
  if (dir) {
    const inDir = allFiles
      .filter(f => {
        if (normalizePath(f.path) === norm) return false;
        const d = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
        return d === dir && /\.(jsx?|tsx?|css|html|json|vue|svelte)$/i.test(f.name);
      })
      .slice(0, MAX_SAME_DIR_FILES);
    for (const f of inDir) addFile(f.path);
  }

  let total = Object.values(out).reduce((n, s) => n + s.length, 0);
  if (total > MAX_SIBLING_CONTEXT_TOTAL) {
    const keys = Object.keys(out).sort((a, b) => out[b].length - out[a].length);
    for (const k of keys) {
      if (total <= MAX_SIBLING_CONTEXT_TOTAL) break;
      total -= out[k].length;
      delete out[k];
    }
  }

  return out;
}

function formatContextFilesBlock(contextFiles: Record<string, string> | undefined): string {
  if (!contextFiles || Object.keys(contextFiles).length === 0) return '';
  const parts = Object.entries(contextFiles).map(
    ([p, body]) => `### ${p}\n\`\`\`\n${body}\n\`\`\``,
  );
  return `\n\n--- Existing project files (match imports/exports and dependencies) ---\n${parts.join('\n\n')}\n`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExecutionCallbacks {
  /** When aborted (user stop), executor exits and calls onPlanStoppedEarly. */
  signal?: AbortSignal;
  onStepStart: (step: PlanStep) => void;
  onStepDone: (step: PlanStep) => void;
  onStepError: (step: PlanStep, error: string) => void;
  onAllDone: () => void;
  /** Plan stopped early because a step could not be validated/repaired */
  onPlanStoppedEarly?: (reason: string) => void;
  onLog: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void;
  onTerminal: (line: string) => void;
  /** Called for every stdout/stderr line emitted by a run_command step */
  onStepOutput?: (step: PlanStep, line: string) => void;
  /** Called when a server URL (http://host:port) is detected in command output */
  onStepServerUrl?: (step: PlanStep, url: string) => void;
  /** Disciplined loop: repair attempt for current step (1-based) */
  onRepairStart?: (step: PlanStep, attempt: number) => void;
  onRepairDone?: (step: PlanStep, attempt: number, validationPassed: boolean) => void;
  /**
   * Called when auto-repair is stuck. Pauses the loop and waits for the user
   * to decide how to proceed. Must return a Promise resolving to an EscalationDecision.
   * If not provided, the agent will stop after ESCALATION_THRESHOLD attempts.
   */
  onEscalateToUser?: (ctx: EscalationContext) => Promise<EscalationDecision>;
  /** Called when agent activity phase changes — for live UI feedback */
  onActivity?: (phase: import('@/store/taskStore').AgentActivityPhase, label: string, detail?: string) => string;
  onActivityComplete?: (activityId: string) => void;
  onActivityUpdate?: (activityId: string, label: string, detail?: string) => void;
}

import type { RepairProjectContext } from './repairAgent';
import type { ProjectIdentity } from './planGenerator';

// Module-level project context — set once per executePlan() call so all
// step executors and the repair agent can access structured project info.
let _projectContext: RepairProjectContext | undefined;
let _projectIdentity: ProjectIdentity | undefined;
// System environment — set once per executePlan() call so the coder and repair
// agents know the OS/architecture without re-probing on every step.
let _envInfo: EnvironmentInfo | undefined;
// SkillMd — project skills/conventions, from projectMemory, set per executePlan call
let _skillMd: string | undefined;
// Install history — from .codescout/installs.json, set per executePlan call
let _installHistoryForCoder: string | undefined;

// ─── Web Research Context ─────────────────────────────────────────────────────
// Accumulated web search results and fetched pages from web_search / fetch_url
// steps. Injected into the coder model's context so it can reference docs/examples.
let _webResearchContext: string[] = [];

/** Get the accumulated web research context (for use in post-plan summary). */
export function getWebResearchContext(): string[] {
  return _webResearchContext;
}

/** Max chars of web content to store per fetch/search (prevent context overflow). */
const WEB_CONTENT_MAX_CHARS = 8_000;

/** Clean HTML entities and tags from a string */
function cleanHtml(s: string): string {
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
function extractDdgUrl(raw: string): string {
  // Try to extract uddg= parameter (URL-encoded destination)
  const uddgMatch = raw.match(/[?&]uddg=([^&]+)/);
  if (uddgMatch) {
    try {
      return decodeURIComponent(uddgMatch[1]);
    } catch {
      return uddgMatch[1];
    }
  }
  // If it starts with //, prepend https:
  if (raw.startsWith('//')) return 'https:' + raw;
  return raw;
}

/**
 * Parse DuckDuckGo HTML search results into structured snippets.
 * Handles the actual DDG HTML format:
 *   <a class="result__a" href="//duckduckgo.com/l/?uddg=...">Title</a>
 *   <a class="result__snippet" href="...">Snippet text</a>
 */
function parseDuckDuckGoResults(html: string): { title: string; url: string; snippet: string }[] {
  const results: { title: string; url: string; snippet: string }[] = [];
  let m;

  // Strategy 1: DDG HTML format — result__a for title+URL, result__snippet for snippet
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

  // Strategy 2: DDG lite format — <a rel="nofollow"> + <td class="result-snippet">
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
function htmlToText(html: string): string {
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

// ─── Code Generation ─────────────────────────────────────────────────────────

function generateCodeWithModel(
  model: ModelConfig,
  prompt: string,
  signal?: AbortSignal,
  contextFiles?: Record<string, string>,
): Promise<string> {
  const storeName = useWorkbenchStore.getState().projectName ?? '';
  // Build framework-specific rules to prevent cross-framework confusion
  const fwk = _projectContext?.framework ?? '';
  const fwkRules = fwk.toLowerCase().includes('react')
    ? 'This is a REACT project. Use @vitejs/plugin-react (NOT plugin-vue, NOT plugin-svelte). Use .jsx/.tsx files. Import from "react" and "react-dom".'
    : fwk.toLowerCase().includes('vue')
    ? 'This is a VUE project. Use @vitejs/plugin-vue. Use .vue files.'
    : fwk.toLowerCase().includes('svelte')
    ? 'This is a SVELTE project. Use @sveltejs/vite-plugin-svelte. Use .svelte files.'
    : `Use imports and patterns consistent with ${fwk || 'the project'}.`;
  const ctxBlock = _projectContext
    ? `\nPROJECT CONTEXT:\n  PROJECT_DIR: ${storeName}\n  FRAMEWORK: ${_projectContext.framework}\n  LANGUAGE: ${_projectContext.language}\n  PACKAGE_MANAGER: ${_projectContext.packageManager}\n  ${_projectContext.entryPoints?.length ? `ENTRY_POINTS: ${_projectContext.entryPoints.join(', ')}` : ''}\n${fwkRules}\nDo NOT import libraries that aren't installed. The project directory is "${storeName}" — do NOT create subdirectories or rename the project.\n`
    : '';

  // Include any web research gathered from web_search / fetch_url steps
  const webCtx = _webResearchContext.length > 0
    ? `\n\nWEB RESEARCH (from earlier steps — use this as reference):\n${_webResearchContext.join('\n---\n')}\n`
    : '';

  const envCtx = _envInfo
    ? `\nSYSTEM ENVIRONMENT:\n  Platform: ${_envInfo.os ?? 'unknown'} / ${_envInfo.arch ?? 'unknown'}\n  Node: ${_envInfo.nodeVersion ?? 'unknown'}  |  Package manager: ${_envInfo.packageManager ?? 'npm'}\n  tsx available: ${_envInfo.tsxAvailable ? 'YES — use npx tsx FILE.ts' : 'use npx tsx FILE.ts (always works via npx)'}\n  ts-node: ${_envInfo.tsNodeAvailable ? 'installed' : 'NOT installed'}\n  Playwright: ${_envInfo.playwrightAvailable ? 'installed' : 'not installed'}\n  All commands, binaries, and packages MUST be compatible with this OS and CPU architecture.\n`
    : '';

  const skillCtx = _skillMd
    ? `\nPROJECT CONVENTIONS:\n${_skillMd.slice(0, 2000)}\n`
    : '';

  const installCtx = _installHistoryForCoder
    ? `\nINSTALL HISTORY (what worked/failed in past sessions — do not repeat failures):\n${_installHistoryForCoder.slice(0, 1000)}\n`
    : '';

  // Agent memory — past decisions, fixes, and learnings
  let memCtx = '';
  try {
    const projectName = useWorkbenchStore.getState().projectName;
    memCtx = useAgentMemoryStore.getState().buildMemoryPrompt(projectName, 1000) || '';
    if (memCtx) memCtx = `\n${memCtx}\n`;
  } catch { /* non-fatal */ }

  const userContent = prompt + formatContextFilesBlock(contextFiles);

  return new Promise((resolve, reject) => {
    const messages: ModelRequestMessage[] = [
      {
        role: 'system',
        content: `You are an expert code generator. When asked to write code, respond with ONLY the code content — no markdown fences, no explanations, no comments about what the code does. Just pure, clean, working code. If you must include imports, include them at the top. Make sure the code is complete and ready to use. Write focused, modular code — extract reusable logic into imports rather than inlining everything in one file.${ctxBlock}${envCtx}${skillCtx}${installCtx}${memCtx}${webCtx}`,
      },
      { role: 'user', content: userContent },
    ];

    let fullText = '';

    callModel(
      modelToRequest(model, messages, signal ? { signal } : undefined),
      (chunk) => { fullText += chunk; },
      (final) => { resolve(cleanCodeResponse(final)); },
      (err) => { reject(err); },
    );
  });
}

function cleanCodeResponse(text: string): string {
  // Strip markdown code fences if present
  const fenceMatch = text.match(/```(?:\w*)\n([\s\S]*?)\n```/);
  let code = fenceMatch ? fenceMatch[1].trim() : text.trim();

  // ── Sanitize truncated/duplicated LLM output ──
  // LLMs (especially with small context) sometimes output the file content
  // correctly then append garbage (a second copy of part of the file, or
  // random JSX fragments). Detect and truncate at the natural end.

  // For JSX/JS/TS files: if we see "export default X;" followed by more JSX/code,
  // truncate after the export.
  const exportMatch = code.match(/(export\s+default\s+\w+;)\s*[>\]}<]/);
  if (exportMatch) {
    const idx = code.indexOf(exportMatch[1]) + exportMatch[1].length;
    code = code.slice(0, idx);
  }

  // For any file: if the same large block (50+ chars) appears twice, keep only the first
  if (code.length > 200) {
    const mid = Math.floor(code.length * 0.4);
    const firstHalf = code.slice(0, mid);
    const secondHalf = code.slice(mid);
    // Check if a significant chunk from the start repeats later
    const sample = firstHalf.slice(0, 100);
    const repeatIdx = secondHalf.indexOf(sample);
    if (repeatIdx !== -1 && repeatIdx < secondHalf.length * 0.7) {
      code = code.slice(0, mid + repeatIdx).trimEnd();
    }
  }

  return code;
}

// ─── Fallback Code Templates ─────────────────────────────────────────────────

function generateFallbackCode(step: PlanStep): string {
  const path = step.path || '';
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const fileName = path.split('/').pop() || '';
  const name = fileName.replace(/\.\w+$/, '') || 'Component';
  const fwk = _projectContext?.framework?.toLowerCase() ?? '';
  const lang = _projectIdentity?.language?.toLowerCase() ?? '';
  const isTS = lang.includes('typescript');

  // index.html — Vite entry point with script tag
  if (fileName === 'index.html') {
    const entryExt = isTS ? '.tsx' : '.jsx';
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${_projectIdentity ? useWorkbenchStore.getState().projectName ?? 'App' : 'App'}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main${entryExt}"></script>
  </body>
</html>`;
  }

  // main.jsx / main.tsx — React entry
  if (name === 'main' && (ext === 'jsx' || ext === 'tsx')) {
    return `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)`;
  }

  // vite.config — correct plugin
  if (fileName.startsWith('vite.config')) {
    if (fwk.includes('react')) {
      return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})`;
    }
    return `import { defineConfig } from 'vite'\n\nexport default defineConfig({})`;
  }

  if (ext === 'tsx' || ext === 'jsx') {
    // Use function component without TypeScript interface for JSX projects
    if (ext === 'jsx' || !isTS) {
      return `function ${name}() {
  return (
    <div>
      <h2>${name}</h2>
      <p>${step.description}</p>
    </div>
  )
}

export default ${name}`;
    }
    return `import React from 'react'

interface ${name}Props {}

const ${name}: React.FC<${name}Props> = () => {
  return (
    <div>
      <h2>${name}</h2>
      <p>${step.description}</p>
    </div>
  )
}

export default ${name}`;
  }

  if (ext === 'ts' || ext === 'js') {
    return `// ${step.description}\n\nexport {};\n`;
  }

  if (ext === 'css' || ext === 'scss') {
    return `/* ${step.description} */\n`;
  }

  if (ext === 'json') {
    return `{\n  "name": "${name}"\n}\n`;
  }

  return `// ${step.description}\n`;
}

// ─── File-specific hints for the coder model ────────────────────────────────
// These prevent common LLM mistakes for critical files (e.g. missing Vite
// script tag in index.html, wrong plugin in vite.config).

function buildFileHints(filePath: string): string {
  const name = filePath.split('/').pop()?.toLowerCase() ?? '';
  const fwk = _projectContext?.framework?.toLowerCase() ?? '';
  const entryPoints = _projectContext?.entryPoints ?? [];
  const hints: string[] = [];

  if (name === 'index.html') {
    // Vite REQUIRES a <script type="module"> pointing to the entry file
    const entry = entryPoints.find(e => /main\.(jsx?|tsx?)$/.test(e)) ?? 'src/main.jsx';
    // Strip any project prefix (e.g. "website/src/main.jsx" → "/src/main.jsx")
    const entryForHtml = '/' + entry.replace(/^[^/]+\//, '');
    if (fwk.includes('vite') || fwk.includes('react')) {
      hints.push(`CRITICAL: This is a Vite project. The index.html MUST include: <script type="module" src="${entryForHtml}"></script> inside the <body> tag. Without this script tag, the app will show a blank page.`);
      hints.push(`Include <div id="root"></div> for the React mount point.`);
    }
  }

  if (name === 'vite.config.js' || name === 'vite.config.ts' || name === 'vite.config.mjs') {
    if (fwk.includes('react')) {
      hints.push(`This is a React project. Use: import react from '@vitejs/plugin-react' and plugins: [react()]. Do NOT use @vitejs/plugin-vue or any other framework plugin.`);
    } else if (fwk.includes('vue')) {
      hints.push(`This is a Vue project. Use: import vue from '@vitejs/plugin-vue' and plugins: [vue()].`);
    }
  }

  if (name === 'main.jsx' || name === 'main.tsx') {
    if (fwk.includes('react')) {
      hints.push(`Import React, ReactDOM, App component, and CSS. Use ReactDOM.createRoot(document.getElementById('root')).render(<App />).`);
    }
  }

  if (name === 'package.json') {
    if (fwk.includes('react') && fwk.includes('vite')) {
      hints.push(`Must include scripts: { "dev": "vite", "build": "vite build", "preview": "vite preview" }. Must include react, react-dom in dependencies. Must include @vitejs/plugin-react and vite in devDependencies. Do NOT include @vitejs/plugin-vue.`);
    }
  }

  return hints.length > 0 ? '\n' + hints.join('\n') : '';
}

// ─── Step Executors ──────────────────────────────────────────────────────────

async function executeCreateFile(
  step: PlanStep,
  model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const path = normalizePath(step.path ?? '');
  if (!path) throw new Error('No file path specified');
  step.path = path;

  const store = useWorkbenchStore.getState();

  // Snapshot: file didn't exist before
  store.pushSnapshot({ path, content: null, action: 'created' });

  let content: string;

  const actId = callbacks.onActivity?.('creating_file', `Creating ${path}`, step.description.slice(0, 80));

  if (model) {
    callbacks.onLog(`Generating code for ${path}...`, 'info');
    const fileHints = buildFileHints(path);
    const siblingCtx = gatherSiblingContext(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
    try {
      content = await generateCodeWithModel(
        model,
        `Create a file at "${path}". Purpose: ${step.description}.${fileHints}\nWrite the complete file content.`,
        callbacks.signal,
        siblingCtx,
      );
    } catch {
      callbacks.onLog(`AI generation failed for ${path}, using template`, 'warning');
      content = generateFallbackCode(step);
    }
  } else {
    content = generateFallbackCode(step);
  }

  // Warn if the generated file is unusually large — big files eat the context
  // window of downstream steps and small LLMs. The planner and coder prompts
  // already encourage splitting, but this catches cases where they don't.
  const lineCount = content.split('\n').length;
  if (lineCount > MAX_GENERATED_FILE_LINES) {
    callbacks.onLog(
      `Generated file "${path}" is ${lineCount} lines (limit: ${MAX_GENERATED_FILE_LINES}) — consider splitting into smaller modules`,
      'warning',
    );
  }

  store.createFile(path, content);

  // Mirror to real filesystem — resolve to actual project root
  const { dirHandle, projectPath, files: currentFiles } = useWorkbenchStore.getState();
  const resolvedRoot = projectPath ? resolveProjectRoot(projectPath, currentFiles) : null;
  if (isTauri() && resolvedRoot) {
    try { await writeProjectFile(resolvedRoot, path, content); } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  } else if (dirHandle) {
    try { await writeFileToFS(dirHandle, path, content); } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  }

  if (actId) callbacks.onActivityComplete?.(actId);
  callbacks.onLog(`Created: ${path}`, 'success');
}

async function executeEditFile(
  step: PlanStep,
  model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  let path = normalizePath(step.path ?? '');
  if (!path) throw new Error('No file path specified');

  const editActId = callbacks.onActivity?.('writing_code', `Editing ${path}`, step.description.slice(0, 80));

  const store = useWorkbenchStore.getState();

  // Resolve path against actual file tree (handles hallucinated paths)
  const { resolved, changed } = resolveFilePath(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
  if (changed) {
    callbacks.onLog(`Path resolved: "${path}" → "${resolved}"`, 'warning');
    path = resolved;
  }
  step.path = path;

  const currentContent = store.getFileContent(path);

  if (currentContent === undefined) {
    // File not found — fall back to CREATE instead of crashing the plan.
    // The LLM wanted to edit a file that doesn't exist (wrong path or new file).
    // If there's diff.after content, create the file with that content.
    callbacks.onLog(`File not found for edit: "${path}" — falling back to create`, 'warning');
    if (step.diff?.after) {
      store.createFile(path, step.diff.after);
      // Mirror to filesystem
      const { dirHandle: dh2, projectPath: pp2, files: f2 } = useWorkbenchStore.getState();
      const root2 = pp2 ? resolveProjectRoot(pp2, f2) : null;
      if (isTauri() && root2) {
        try { await writeProjectFile(root2, path, step.diff.after); } catch { /* non-fatal */ }
      } else if (dh2) {
        try { await writeFileToFS(dh2, path, step.diff.after); } catch { /* non-fatal */ }
      }
      callbacks.onLog(`Created (fallback): ${path}`, 'success');
      return;
    }
    // No diff content — try AI generation as last resort
    if (model) {
      callbacks.onLog(`AI generating content for new file ${path}...`, 'info');
      const siblingCtx = gatherSiblingContext(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
      try {
        const generated = await generateCodeWithModel(
          model,
          `Create a file at "${path}". Purpose: ${step.description}. Write the complete file content.`,
          callbacks.signal,
          siblingCtx,
        );
        store.createFile(path, generated);
        const { dirHandle: dh3, projectPath: pp3, files: f3 } = useWorkbenchStore.getState();
        const root3 = pp3 ? resolveProjectRoot(pp3, f3) : null;
        if (isTauri() && root3) {
          try { await writeProjectFile(root3, path, generated); } catch { /* non-fatal */ }
        } else if (dh3) {
          try { await writeFileToFS(dh3, path, generated); } catch { /* non-fatal */ }
        }
        callbacks.onLog(`Created (AI fallback): ${path}`, 'success');
        return;
      } catch {
        callbacks.onLog(`AI generation also failed for ${path}`, 'warning');
      }
    }
    throw new Error(`File not found: ${path}`);
  }

  // Snapshot: save current content before editing
  store.pushSnapshot({ path, content: currentContent, action: 'edited' });

  let newContent: string;

  if (step.diff?.after) {
    // If the plan already has a diff with an "after" value, apply it directly
    // For simple diffs, do a find-and-replace
    if (step.diff.before && currentContent.includes(step.diff.before)) {
      newContent = currentContent.replace(step.diff.before, step.diff.after);
    } else if (model) {
      // Stale/wrong "before" from the planner — do NOT append (duplicates whole files).
      callbacks.onLog(`Diff "before" did not match "${path}" — asking model with full file...`, 'warning');
      const siblingCtx = gatherSiblingContext(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
      try {
        newContent = await generateCodeWithModel(
          model,
          `Current file "${path}":\n\n${currentContent}\n\nThe plan wanted this change but the exact "before" snippet was not found in the file: ${step.description}\n\nApply the intended change. Return the COMPLETE updated file content only.`,
          callbacks.signal,
          siblingCtx,
        );
      } catch {
        callbacks.onLog(`AI edit failed for ${path}, appending planned diff as last resort`, 'warning');
        newContent = currentContent + '\n' + step.diff.after;
      }
    } else {
      // No model — last resort only
      newContent = currentContent + '\n' + step.diff.after;
    }
  } else if (model) {
    // Ask the AI to edit the file
    callbacks.onLog(`AI editing ${path}...`, 'info');
    const siblingCtx = gatherSiblingContext(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
    try {
      newContent = await generateCodeWithModel(
        model,
        `Here is the current content of "${path}":\n\n${currentContent}\n\nEdit this file to: ${step.description}\n\nReturn the COMPLETE updated file content.`,
        callbacks.signal,
        siblingCtx,
      );
    } catch {
      callbacks.onLog(`AI edit failed for ${path}, applying basic edit`, 'warning');
      newContent = currentContent + `\n// TODO: ${step.description}\n`;
    }
  } else {
    // No model, no diff — add a TODO comment
    newContent = currentContent + `\n// TODO: ${step.description}\n`;
  }

  store.updateFileContent(path, newContent);

  // Mirror to real filesystem — resolve to actual project root
  const { dirHandle: dh, projectPath: pp, files: editFiles } = useWorkbenchStore.getState();
  const editRoot = pp ? resolveProjectRoot(pp, editFiles) : null;
  if (isTauri() && editRoot) {
    try { await writeProjectFile(editRoot, path, newContent); } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  } else if (dh) {
    try { await writeFileToFS(dh, path, newContent); } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  }

  // Update the step's diff so the user can see what changed
  const currentPlan = useWorkbenchStore.getState().currentPlan;
  if (currentPlan) {
    const updatedSteps = currentPlan.steps.map(s =>
      s.id === step.id
        ? { ...s, diff: { before: currentContent, after: newContent } }
        : s
    );
    useWorkbenchStore.setState({
      currentPlan: { ...currentPlan, steps: updatedSteps },
    });
  }

  if (editActId) callbacks.onActivityComplete?.(editActId);
  callbacks.onLog(`Edited: ${path}`, 'success');
}

async function executeDeleteFile(
  step: PlanStep,
  _model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  let path = normalizePath(step.path ?? '');
  if (!path) throw new Error('No file path specified');

  const store = useWorkbenchStore.getState();

  // Resolve path against actual file tree (handles hallucinated paths like src/src/...)
  const { resolved, changed } = resolveFilePath(path, (p) => store.getFileContent(p), flattenAllFiles(store.files));
  if (changed) {
    callbacks.onLog(`Path resolved: "${path}" → "${resolved}"`, 'warning');
    path = resolved;
  }
  step.path = path;

  const currentContent = store.getFileContent(path);

  if (currentContent === undefined) {
    // File doesn't exist — skip delete silently rather than crashing the whole plan
    callbacks.onLog(`Delete skipped (file not found): ${path}`, 'warning');
    return;
  }

  // Snapshot: save content before deleting
  store.pushSnapshot({ path, content: currentContent, action: 'deleted' });
  store.deleteFile(path);

  // Mirror to real filesystem — resolve to actual project root
  const { dirHandle: dh2, projectPath: pp2, files: delFiles } = useWorkbenchStore.getState();
  const delRoot = pp2 ? resolveProjectRoot(pp2, delFiles) : null;
  if (isTauri() && delRoot) {
    try {
      await executeCommand(`rm -f "${delRoot}/${path}"`);
    } catch (e) {
      callbacks.onLog(`FS delete warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  } else if (dh2) {
    try {
      await deleteFileFromFS(dh2, path);
    } catch (e) {
      callbacks.onLog(`FS delete warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  }

  callbacks.onLog(`Deleted: ${path}`, 'success');
}

/**
 * Patterns that indicate a command is a long-running dev server / watcher
 * and should be spawned in the background rather than awaited.
 */
const BACKGROUND_CMD_PATTERNS = [
  /\bnpm run (dev|start|serve|watch)\b/,
  /\bnpm start\b/,                          // bare "npm start" (no "run")
  /\bnpx (vite|next|nuxt|remix|astro|webpack-dev-server)\b/,
  /\bpnpm (run\s+)?(dev|start|serve|watch)\b/,
  /\byarn (run\s+)?(dev|start|serve|watch)\b/,
  /\bbun (run\s+)?(dev|start|serve|watch)\b/,
  /\bcargo (run|watch)\b/,
  /\bpython.*-m\s+(http\.server|flask|uvicorn|gunicorn)\b/,
  /\bnode\s+.*server/,
  /\bnodemon\b/,
  /\btailwindcss.*--watch\b/,
  // Bare dev-server CLIs the LLM sometimes emits directly
  /^vite(?!\s+build)(\s|$)/,         // "vite" but not "vite build"
  /^next\s+(dev|start)\b/,
  /^nuxt\s+(dev|start)\b/,
  /^astro\s+dev\b/,
  /^remix\s+dev\b/,
  /^react-scripts\s+start\b/,
  /^expo\s+start\b/,
];

export function isBackgroundCommand(cmd: string): boolean {
  return BACKGROUND_CMD_PATTERNS.some(p => p.test(cmd));
}

/** How long to wait for a background dev server to emit its startup URL. */
export const BACKGROUND_SETTLE_MS_EXPORT = 6_000;

/**
 * Guess which port a dev-server command will bind to.
 * Checks: explicit --port flag, vite.config content, then framework defaults.
 */
export function detectDevServerPort(cmd: string, viteConfigContent?: string): number | null {
  // Explicit --port flag: e.g. "npm run dev -- --port 3001" or "vite --port 8080"
  const portFlag = cmd.match(/--port[=\s]+(\d{2,5})/);
  if (portFlag) return parseInt(portFlag[1], 10);

  // vite.config: server: { port: NNNN }
  if (viteConfigContent) {
    const cfgPort = viteConfigContent.match(/server\s*:\s*\{[^}]*port\s*:\s*(\d{2,5})/);
    if (cfgPort) return parseInt(cfgPort[1], 10);
  }

  // Framework defaults
  if (/\bnext\b/.test(cmd)) return 3000;
  if (/\bnuxt\b/.test(cmd)) return 3000;
  if (/react-scripts/.test(cmd)) return 3000;
  if (/\bexpo\b/.test(cmd)) return 19000;
  if (/python.*-m\s+http\.server/.test(cmd)) return 8000;
  if (/uvicorn|gunicorn|flask/.test(cmd)) return 8000;
  // Vite default — covers "npm run dev", "npm start", "bun dev", "vite", etc.
  if (isBackgroundCommand(cmd)) return 5173;

  return null;
}

export type SimpleCallbacks = { onLog: (msg: string, type: 'info' | 'warning' | 'success' | 'error') => void; onTerminal: (line: string) => void };

/**
 * If a process is already bound to `port`, kill it AND its parent process
 * group so the new dev server can claim the port cleanly.
 * For Electron apps this also kills the Electron window process so a stale
 * window can't reconnect to the new server.
 * Returns true if something was killed.
 */
export async function freePortIfOccupied(
  port: number,
  cwd: string | undefined,
  callbacks: SimpleCallbacks,
  /** Optional hint: subdirectory name to kill related Electron processes */
  projectHint?: string,
): Promise<boolean> {
  try {
    const check = await executeCommand(`lsof -ti :${port} 2>/dev/null`, cwd);
    const pids = check.stdout.trim();

    let killed = false;

    if (pids) {
      callbacks.onLog(`Port ${port} occupied by PID(s) ${pids} — stopping old server`, 'warning');
      callbacks.onTerminal(`⚠ Port ${port} in use (PID ${pids}) — stopping old process...`);

      // Kill the port holder plus any children it spawned (e.g. esbuild workers)
      const killScript = [
        `for PID in ${pids}; do`,
        `  kill -9 $PID 2>/dev/null`,
        `  PPID=$(ps -o ppid= -p $PID 2>/dev/null | tr -d ' ')`,
        `  [ -n "$PPID" ] && [ "$PPID" != "1" ] && kill -9 $PPID 2>/dev/null || true`,
        `  pkill -P $PID 2>/dev/null || true`,
        `done`,
      ].join('; ');

      await executeCommand(killScript, cwd);
      killed = true;
    }

    // Also kill any related Electron processes so stale windows don't reconnect.
    // We match on the project hint (directory name) from the command, which is
    // usually unique enough to identify the right Electron app without nuking
    // unrelated Electron instances.
    if (projectHint) {
      const safe = projectHint.replace(/[^a-zA-Z0-9_-]/g, '');
      if (safe) {
        const elCheck = await executeCommand(
          `pgrep -lf "Electron.*${safe}" 2>/dev/null || pgrep -lf "${safe}.*Electron" 2>/dev/null || true`,
          cwd,
        );
        if (elCheck.stdout.trim()) {
          callbacks.onTerminal(`⚠ Closing old Electron window for ${safe}...`);
          await executeCommand(
            `pkill -f "Electron.*${safe}" 2>/dev/null; pkill -f "${safe}.*Electron" 2>/dev/null; true`,
            cwd,
          );
          killed = true;
        }
      }
    }

    if (killed) {
      await executeCommand('sleep 0.8', cwd); // let OS release the port
      callbacks.onTerminal(`✓ Cleared — starting new server`);
    }
    return killed;
  } catch {
    return false;
  }
}

/** Max time (ms) to wait for a normal command before considering it timed out. */
const CMD_TIMEOUT_MS = 120_000; // 2 minutes

/** For background commands, wait this long to collect initial output then move on. */
const BACKGROUND_SETTLE_MS = 5_000; // 5 seconds

async function executeRunCommand(
  step: PlanStep,
  _model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const command = step.command;
  if (!command) throw new Error('No command specified');

  // Guard: the planner sometimes emits a file:// URL as a command when it
  // wants to "read" a file. file:// is not a valid shell command.
  // Resolve the file from the workbench store and inject it into the coder's
  // context (same pipeline as web_search / fetch_url) so subsequent steps work.
  if (/^file:\/\//i.test(command.trim())) {
    const store = useWorkbenchStore.getState();

    // Strip file:// prefix and normalise; try multiple path variants to match
    // however the path happens to be stored (absolute, relative, with/without
    // leading slash, with/without project-name prefix).
    const stripped = command.trim().replace(/^file:\/\//i, '').replace(/\\/g, '/');
    const candidates = [
      stripped,
      stripped.replace(/^\/+/, ''),                         // strip leading /
      stripped.split('/').slice(1).join('/'),                // strip first path segment (project name)
      stripped.split('/').slice(2).join('/'),                // strip first two segments (e.g. /Users/foo)
    ];

    let resolvedPath = stripped;
    let content: string | undefined;
    for (const candidate of candidates) {
      content = store.getFileContent(candidate);
      if (content !== undefined) { resolvedPath = candidate; break; }
    }

    if (content !== undefined) {
      callbacks.onTerminal(`📄 Reading ${resolvedPath} (${content.length} chars)`);
      callbacks.onLog(`Resolved file:// command → served "${resolvedPath}" from store`, 'info');
      // Push into the coder context so it gets injected into the coder's system prompt,
      // exactly the same way fetch_url / web_search steps work.
      _webResearchContext.push(`[File read: ${resolvedPath}]\n${content.slice(0, WEB_CONTENT_MAX_CHARS)}`);
      // Also emit as step output for the terminal log
      callbacks.onStepOutput?.(step, `=== ${resolvedPath} ===\n${content.slice(0, 2000)}`);
      return;
    }

    // File not found in store — fail with a clear message
    throw new Error(
      `Cannot read "${stripped}": file:// is not a valid shell command, and the file was not found ` +
      `in the open project. Ensure the correct project folder is open in Code Scout.`,
    );
  }

  // Auto-correct commands that will always fail regardless of project or machine.
  let correctedCommand = command;

  // `node file.ts` → `npx tsx file.ts` (Node.js cannot run TypeScript natively).
  const nodeRunsTs = command.match(/^node\s+(["']?)(\S+\.tsx?)\1(\s|$)/);
  if (nodeRunsTs) {
    correctedCommand = command.replace(/^node\s+/, 'npx tsx ');
    callbacks.onLog(`Auto-corrected: "node" cannot run .ts files — using "npx tsx" instead`, 'info');
  }

  // `ts-node file.ts` or `npx ts-node file.ts` → `npx tsx file.ts`
  // ts-node requires a separate install; tsx is always available via npx.
  const tsNodeRunsTs = correctedCommand.match(/^(?:npx\s+)?ts-node\s+/i);
  if (tsNodeRunsTs) {
    correctedCommand = correctedCommand.replace(/^(?:npx\s+)?ts-node\s+/i, 'npx tsx ');
    callbacks.onLog(`Auto-corrected: "ts-node" → "npx tsx" (tsx is always available via npx)`, 'info');
  }

  const cmdActId = callbacks.onActivity?.('running_command', `Running: ${correctedCommand.slice(0, 80)}`, step.description.slice(0, 60));
  callbacks.onTerminal(`$ ${correctedCommand}`);

  if (!isTauri()) {
    if (cmdActId) callbacks.onActivityComplete?.(cmdActId);
    callbacks.onTerminal(`⚠ Skipped (requires desktop build): ${command}`);
    const msg =
      'Shell steps cannot run in the browser build. Use the Code Scout desktop app with a project folder open, or run this command yourself in the Terminal panel.';
    callbacks.onLog(`${msg} Command: ${command}`, 'warning');
    throw new Error(msg);
  }

  const { projectPath, files } = useWorkbenchStore.getState();
  // For commands using only absolute paths (find /usr/…, cat /path/…, etc.)
  // cwd doesn't matter — fall back to home dir so the shell starts cleanly.
  const effectivePath = projectPath ? resolveProjectRoot(projectPath, files) : undefined;

  // Strip a redundant "cd PROJECTNAME && " prefix that the model sometimes emits.
  // The shell cwd is already set to the project root, so "cd projectName" would
  // try to enter a non-existent subdirectory and fail with "No such file or directory".
  let resolvedCommand = correctedCommand;

  // ── Sanitise npm flag typos generated by the LLM ─────────────────────────
  // The model frequently writes --omit-optional (hyphen, invalid) instead of
  // --omit=optional (equals, the actual npm flag). npm silently ignores the
  // unknown flag and then installs the x64 binary anyway, causing EBADPLATFORM.
  // Also normalise other common variants so they always reach npm in the right form.
  if (/^(npm|npx|yarn|pnpm|bun)\b/.test(resolvedCommand.trim())) {
    resolvedCommand = resolvedCommand
      .replace(/--omit-optional\b/g, '--omit=optional')  // LLM typo: hyphen → equals
      .replace(/--omit optional\b/g, '--omit=optional')  // LLM typo: space → equals
      .replace(/--omit=optional\s+--omit=optional/g, '--omit=optional'); // dedup
  }

  if (effectivePath) {
    const projectDirName = effectivePath.replace(/\\/g, '/').split('/').filter(Boolean).pop();
    if (projectDirName) {
      // Match: cd property-prospector && …  OR  cd ./property-prospector && …
      const redundantCd = new RegExp(`^cd\\s+\\.?\\/?${projectDirName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*&&\\s*`, 'i');
      const stripped = resolvedCommand.replace(redundantCd, '');
      if (stripped !== resolvedCommand) {
        callbacks.onLog(`Removed redundant 'cd ${projectDirName}' — already in project root`, 'info');
        resolvedCommand = stripped;
      }
    }
  }

  const background = isBackgroundCommand(resolvedCommand);

  if (background) {
    // Before spawning: detect what port this server will use and free it if occupied.
    // This prevents the common "wrong app loads in Electron/browser" problem when
    // switching projects while an old dev server is still running.
    const viteConfig = useWorkbenchStore.getState().getFileContent('vite.config.ts')
      ?? useWorkbenchStore.getState().getFileContent('vite.config.js')
      ?? useWorkbenchStore.getState().getFileContent('vite.config.mjs');
    const devPort = detectDevServerPort(resolvedCommand, viteConfig);
    // Extract project hint for Electron cleanup:
    // 1. Try "cd DIRNAME &&" in the command; 2. fall back to last segment of cwd
    const cdMatch = resolvedCommand.match(/\bcd\s+([\w.-]+)/);
    const projectHint = cdMatch?.[1]
      ?? (effectivePath ? effectivePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() : undefined);
    if (devPort) {
      await freePortIfOccupied(devPort, effectivePath, callbacks, projectHint);
    }

    // Spawn in background — collect output for a few seconds then continue
    callbacks.onLog(`Starting background process: ${resolvedCommand}`, 'info');
    callbacks.onTerminal(`(background) ${resolvedCommand}`);

    let settled = false;
    let errorOutput = '';

    // Detect server URLs (e.g. http://localhost:5173, http://192.168.x.x:PORT)
    const URL_REGEX = /https?:\/\/[^\s'">\])+,;]+/gi;
    const handleOutputLine = (raw: string, isErr = false) => {
      const line = isErr ? `! ${raw}` : raw;
      callbacks.onTerminal(line);
      callbacks.onStepOutput?.(step, line);
      const matches = raw.match(URL_REGEX);
      if (matches) {
        // Prefer localhost / 127.0.0.1 URL; fall back to first match
        const preferred = matches.find(u => /localhost|127\.0\.0\.1/i.test(u)) ?? matches[0];
        const clean = preferred.replace(/[/,;:]+$/, ''); // strip trailing punctuation
        callbacks.onStepServerUrl?.(step, clean);
      }
    };

    const kill = await spawnCommand(
      resolvedCommand,
      effectivePath,
      (line) => handleOutputLine(line),
      (line) => { handleOutputLine(line, true); errorOutput += line + '\n'; },
      (code) => {
        if (!settled) {
          settled = true;
          if (code !== 0 && code !== null) {
            callbacks.onTerminal(`! Process exited with code ${code}`);
          }
        }
      },
    );

    useWorkbenchStore.getState().addLog(`Background: ${resolvedCommand} (PID active)`, 'info');

    // Wait for the process to settle (collect initial output, check for immediate crash)
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        settled = true;
        resolve();
      }, BACKGROUND_SETTLE_MS);
    });

    if (errorOutput.trim()) {
      callbacks.onLog(`Background process stderr: ${errorOutput.trim().slice(0, 200)}`, 'warning');
    }
    callbacks.onLog(`Background process started: ${resolvedCommand}`, 'success');
    callbacks.onTerminal(`✓ Background process running. Continuing plan...`);

    (window as Record<string, unknown>).__scout_bg_kill = kill;
    return;
  }

  // Normal (foreground) command with timeout
  const result = await Promise.race([
    executeCommand(resolvedCommand, effectivePath),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Command timed out after ${CMD_TIMEOUT_MS / 1000}s: ${command}`)), CMD_TIMEOUT_MS),
    ),
  ]);

  if (result.stdout) result.stdout.split('\n').filter(Boolean).forEach(l => {
    callbacks.onTerminal(l);
    callbacks.onStepOutput?.(step, l);
  });
  if (result.stderr) result.stderr.split('\n').filter(Boolean).forEach(l => {
    callbacks.onTerminal(`! ${l}`);
    callbacks.onStepOutput?.(step, `! ${l}`);
  });
  if (result.code !== 0) {
    // ── grep / rg exit 1 = no matches found (NOT an error) ───────────────────
    // Standard POSIX: grep returns 0 (matches), 1 (no matches), 2 (error).
    // LLMs use grep/rg frequently as diagnostic "search" steps. If the search
    // found nothing that is useful information, not a failure — inject it into
    // the coder context so subsequent steps know and continue.
    const isSearchTool = /^(grep|rg|ag|ack)\b/.test(resolvedCommand.trim()) ||
                         /\|\s*(grep|rg|ack)\b/.test(resolvedCommand);
    if (isSearchTool && result.code === 1 && !result.stderr.trim()) {
      const noMatchMsg = `(no matches found for: ${resolvedCommand.slice(0, 120)})`;
      callbacks.onTerminal(noMatchMsg);
      callbacks.onStepOutput?.(step, noMatchMsg);
      _webResearchContext.push(
        `[Command: ${resolvedCommand.slice(0, 200)}]\nResult: No matches found (exit 1 — empty result). ` +
        `The pattern does not appear in the searched files.`,
      );
      callbacks.onLog(`Ran: ${resolvedCommand} (no matches — not an error)`, 'success');
      return;
    }

    // Auto-retry: "cd: DIRNAME: No such file or directory"
    // Even though the sanitizer above strips known redundant `cd PROJECTNAME &&` prefixes,
    // the model may use a slightly different form. If we see this error, strip the
    // offending `cd DIRNAME &&` segment and retry once before giving up.
    const cdErrMatch = (result.stderr || '').match(/cd:\s*([^\s:]+):\s*no such file or directory/i);
    if (cdErrMatch) {
      const badDir = cdErrMatch[1];
      const escapedDir = badDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const fixedCmd = resolvedCommand.replace(
        new RegExp(`^cd\\s+\\.?\\/?${escapedDir}\\s*&&\\s*`, 'i'), '',
      );
      if (fixedCmd !== resolvedCommand && fixedCmd.trim().length > 0) {
        callbacks.onLog(`Auto-fix: "cd ${badDir}" doesn't exist (already in project root). Retrying without it.`, 'info');
        callbacks.onTerminal(`⚙ Retrying: ${fixedCmd}`);
        const retryResult = await Promise.race([
          executeCommand(fixedCmd, effectivePath),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Command timed out after ${CMD_TIMEOUT_MS / 1000}s`)), CMD_TIMEOUT_MS),
          ),
        ]);
        if (retryResult.stdout) retryResult.stdout.split('\n').filter(Boolean).forEach(l => {
          callbacks.onTerminal(l);
          callbacks.onStepOutput?.(step, l);
        });
        if (retryResult.stderr) retryResult.stderr.split('\n').filter(Boolean).forEach(l => {
          callbacks.onTerminal(`! ${l}`);
          callbacks.onStepOutput?.(step, `! ${l}`);
        });
        if (retryResult.code === 0) {
          callbacks.onLog(`Retried successfully (without redundant cd): ${fixedCmd}`, 'success');
          return;
        }
        throw new Error(`Command failed (exit ${retryResult.code}): ${retryResult.stderr || fixedCmd}`);
      }
    }

    // Safety net: if the command failed and it doesn't look like a real CLI command,
    // it was probably a search query that slipped through detection — do a web search
    const isRealCmd = KNOWN_CLI_TOOLS.test(command) || /[|><;]/.test(command) || /\s+--?\w/.test(command) || /[/\\]/.test(command);
    if (!isRealCmd && command.split(/\s+/).length >= 2) {
      callbacks.onLog(`Command "${command}" failed — looks like a search query, rerouting to web search`, 'info');
      callbacks.onTerminal(`⚠ Not a shell command — searching the web instead...`);
      // Mutate step action so caller knows this became a web search
      (step as { action: string }).action = 'web_search';
      await executeWebSearch(step, _model, callbacks);
      return;
    }
    throw new Error(`Command failed (exit ${result.code}): ${result.stderr || command}`);
  }
  // ── Push diagnostic output into coder context ────────────────────────────
  // For read-only investigation commands (grep, ls, find, cat, head, rg, etc.)
  // the stdout is useful evidence for the coder model on subsequent steps.
  // We only do this for commands that produce output and look investigative —
  // not for install/build commands whose output is too noisy.
  const isInvestigativeCmd = /^(grep|rg|ag|ls|find|cat|head|tail|wc|file|stat|diff|jq|curl|echo)\b/.test(resolvedCommand.trim()) ||
    /\|\s*(grep|rg|jq|head|tail)\b/.test(resolvedCommand);
  const combinedOut = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  if (isInvestigativeCmd && combinedOut) {
    const capped = combinedOut.length > 3_000 ? combinedOut.slice(0, 3_000) + '\n... (truncated)' : combinedOut;
    _webResearchContext.push(`[Command: ${resolvedCommand.slice(0, 200)}]\n${capped}`);
  }

  // ── Install tracking ─────────────────────────────────────────────────────
  // Record every install command to .codescout/installs.json so future
  // sessions know what was installed and whether it succeeded.
  if (isInstallCommand(command)) {
    const record = buildInstallRecord(
      command,
      0, // exit code 0 = success (we only reach here on success)
      result.stdout ?? '',
      result.stderr ?? '',
      0, // no retries at this point (platform retries happen above)
      step.id,
      '',
    );
    const { projectPath, files } = useWorkbenchStore.getState();
    const { resolveEffectiveRoot } = await import('@/services/memoryManager');
    const root = projectPath ? resolveEffectiveRoot(projectPath, files) : '';
    if (root) recordInstall(record, root).catch(() => {});
    // Record to memory store
    useAgentMemoryStore.getState().recordCommandOutcome(
      useWorkbenchStore.getState().projectName,
      command,
      true,
    );

  }

  if (cmdActId) callbacks.onActivityComplete?.(cmdActId);
  callbacks.onLog(`Ran: ${command}`, 'success');
}

// ─── Validation + repair (disciplined loop) ─────────────────────────────────

function verifierToValidationResult(verification: VerificationResult): ValidationRunResult | null {
  if (verification.result === 'fail') {
    return {
      pass: false,
      command: '(step verifier)',
      stdout: '',
      stderr: verification.summary,
      skipped: false,
    };
  }
  if (verification.result === 'partial') {
    return {
      pass: false,
      command: '(step verifier)',
      stdout: '',
      stderr: `Verification partial: ${verification.summary}`,
      skipped: false,
    };
  }
  return null;
}

async function runPostStepValidation(
  plan: Plan,
  verification: VerificationResult,
  /** Skip the full project build/lint — only use the lightweight step verifier. */
  skipProjectBuild: boolean,
): Promise<ValidationRunResult> {
  const failed = verifierToValidationResult(verification);
  if (failed) return failed;

  // For intermediate file steps, skipping the build avoids false failures
  // when later steps haven't yet created files that are already imported.
  if (skipProjectBuild) {
    return { pass: true, command: '(deferred to last step)', stdout: '', stderr: '', skipped: true };
  }

  const { projectPath, files, getFileContent } = useWorkbenchStore.getState();
  const project = await runProjectValidation({
    validationCommand: plan.validationCommand,
    projectPath,
    files,
    getFileContent,
  });

  if (project.skipped) {
    return { ...project, pass: true };
  }
  return project;
}

/** Map common wrong paths from the model to files that exist in the workbench. */
function resolveRepairEditPath(
  normalizedPath: string,
  getFileContent: (path: string) => string | undefined,
): string {
  if (getFileContent(normalizedPath) !== undefined) return normalizedPath;

  const tryAlts = (wrong: string, alts: string[]) => {
    if (normalizedPath === wrong || normalizedPath.endsWith(`/${wrong}`)) {
      for (const a of alts) {
        if (getFileContent(a) !== undefined) return a;
      }
    }
    return null;
  };

  return (
    tryAlts('vite.config.js', ['vite.config.ts', 'vite.config.mjs', 'vite.config.cjs']) ??
    tryAlts('main.js', ['src/main.tsx', 'src/main.jsx', 'src/main.ts']) ??
    tryAlts('src/main.js', ['src/main.tsx', 'src/main.jsx']) ??
    normalizedPath
  );
}

// ─── Stop diagnostic helpers ─────────────────────────────────────────────────

/**
 * Map a FailureFingerprint category to the legacy UI-facing kind.
 * Kept for backwards compatibility with PlanStep.stopDiagnosticKind.
 */
export function classifyValidationFailure(
  validation: ValidationRunResult,
  repeatedError: boolean,
): 'model' | 'infra' | 'stuck' {
  if (repeatedError) return 'stuck';
  const text = (validation.stderr + ' ' + validation.stdout).toLowerCase();
  const infraPatterns = [
    'no such file or directory', 'command not found', 'enoent', 'os error',
    'ebadplatform', 'unsupported platform', 'cannot find native binding',
    'npm has a bug related to optional dependencies',
    'please try `npm i` again after removing both package-lock',
    'shell execution requires', 'timed out after', 'econnrefused',
    'failed to fetch', 'permission denied', 'npm error 404',
    '404 not found', 'is not in this registry', 'e404',
  ];
  if (infraPatterns.some(p => text.includes(p))) return 'infra';
  return 'model';
}

function buildStopDiagnostic(
  step: PlanStep,
  validation: ValidationRunResult,
  attempts: number,
  kind: 'model' | 'infra' | 'stuck',
): string {
  const failText = formatValidationFailure(validation);
  const failLower = (validation.stderr + ' ' + validation.stdout).toLowerCase();
  const isNpm404 = failLower.includes('npm error 404') || failLower.includes('is not in this registry');
  const isBadPlatform = failLower.includes('ebadplatform') || failLower.includes('unsupported platform');
  const isMissingBinding = failLower.includes('cannot find native binding');

  const header =
    kind === 'infra'
      ? isNpm404
        ? `Stopped — the model tried to install a package that does not exist on npm (404).`
        : isMissingBinding
        ? `Stopped — a native arm64 binding could not be installed after repair attempts.`
        : isBadPlatform
        ? `Stopped — npm tried to install an x64 binary on this Apple Silicon (arm64) machine.`
        : `Stopped — infrastructure problem prevented validation.`
      : kind === 'stuck'
        ? `Stopped — the same error persisted after ${attempts} repair attempt(s).`
        : `Stopped — code changes did not build after ${attempts} repair attempt(s).`;

  const suggestion =
    kind === 'infra'
      ? 'Ensure the project folder is open, dependencies are installed, and the validation command is correct.'
      : 'Fix the error above manually, or switch to a more capable model and retry.';

  return [
    header,
    `Step: ${step.description}`,
    step.path ? `File involved: ${step.path}` : '',
    step.command ? `Command: ${step.command}` : '',
    `Still failing:\n${failText.slice(0, 2000)}`,
    suggestion,
  ].filter(Boolean).join('\n');
}

// ─── Syntax pre-check ────────────────────────────────────────────────────────

/**
 * Fast in-process checks for the most common model-caused file corruptions.
 * Runs before the full build so the repair agent gets a tight, precise error
 * instead of a noisy compiler dump.
 *
 * Returns an array of human-readable problem descriptions, empty if all clear.
 */
export function syntaxPreCheck(content: string, filePath: string): string[] {
  const problems: string[] = [];
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const isJs = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].includes(ext);
  if (!isJs) return problems;

  const lines = content.split('\n');

  // 1. Duplicate import lines (same line repeated consecutively or within file)
  const importLines = lines
    .map((l, i) => ({ line: l.trim(), idx: i + 1 }))
    .filter(l => /^import\s+/.test(l.line));

  const seen = new Map<string, number>();
  for (const { line, idx } of importLines) {
    const prev = seen.get(line);
    if (prev !== undefined) {
      problems.push(`Duplicate import on lines ${prev} and ${idx}: ${line}`);
    } else {
      seen.set(line, idx);
    }
  }

  // 2. Import / export statements after `export default` — invalid in ES modules
  let defaultExportLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^export\s+default\s+/.test(trimmed) || trimmed === 'export default') {
      defaultExportLine = i + 1;
    }
  }
  if (defaultExportLine > 0) {
    for (let i = defaultExportLine; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (/^import\s+/.test(trimmed) || /^export\s+/.test(trimmed)) {
        problems.push(
          `Statement after \`export default\` on line ${i + 1} (must be at top of file): ${trimmed}`,
        );
      }
    }
  }

  return problems;
}

async function applyRepairFix(fix: RepairFix, callbacks: ExecutionCallbacks): Promise<void> {
  const store = useWorkbenchStore.getState();

  if (fix.kind === 'run_command') {
    const cmd =
      normalizeValidationCommand(fix.command, (p) => store.getFileContent(p), store.files) || fix.command.trim();
    if (cmd !== fix.command.trim()) {
      callbacks.onLog(`Repair: using \`${cmd}\` instead of \`${fix.command.trim()}\``, 'info');
    }
    callbacks.onLog(`Repair: running ${cmd}`, 'info');
    callbacks.onTerminal(`$ ${cmd}`);
    if (!isTauri()) {
      throw new Error('Repair command requires Code Scout desktop app with a project folder open.');
    }
    const { projectPath, files } = store;
    const cwd = projectPath ? resolveProjectRoot(projectPath, files) : undefined;
    const result = await executeCommand(cmd, cwd);
    if (result.stdout) result.stdout.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(l));
    if (result.stderr) result.stderr.split('\n').filter(Boolean).forEach(l => callbacks.onTerminal(`! ${l}`));
    if (result.code !== 0) {
      throw new Error(`Repair command failed (exit ${result.code}): ${result.stderr || cmd}`);
    }
    callbacks.onLog(`Repair: ran ${cmd}`, 'success');
    return;
  }

  if (fix.kind === 'create_file') {
    const createPath = normalizePath(fix.path);
    callbacks.onLog(`Repair: writing full file ${createPath}`, 'info');
    store.updateFileContent(createPath, fix.content);
    const { projectPath, files: createFiles } = useWorkbenchStore.getState();
    const createRoot = projectPath ? resolveProjectRoot(projectPath, createFiles) : null;
    if (isTauri() && createRoot) {
      try {
        await writeProjectFile(createRoot, createPath, fix.content);
      } catch (e) {
        callbacks.onLog(`FS write warning for ${createPath}: ${e instanceof Error ? e.message : e}`, 'warning');
      }
    }
    callbacks.onLog(`Repair: wrote full file ${createPath}`, 'success');
    return;
  }

  const rawPath = normalizePath(fix.path);
  const path = resolveRepairEditPath(rawPath, (p) => store.getFileContent(p));
  const content = store.getFileContent(path);
  if (content === undefined) {
    throw new Error(`Repair: file not found: ${rawPath}${rawPath !== path ? ` (also tried ${path})` : ''}`);
  }
  if (path !== rawPath) {
    callbacks.onLog(`Repair: using ${path} instead of ${rawPath}`, 'info');
  }

  store.pushSnapshot({ path, content, action: 'edited' });

  let newContent: string;
  if (!fix.before.trim()) {
    newContent = content + (fix.after ? `\n${fix.after}` : '');
  } else if (content.includes(fix.before)) {
    newContent = content.replace(fix.before, fix.after);
  } else {
    throw new Error(`Repair: could not find the pattern to replace in ${path}`);
  }

  store.updateFileContent(path, newContent);

  const { dirHandle, projectPath, files: repairFiles } = useWorkbenchStore.getState();
  const repairRoot = projectPath ? resolveProjectRoot(projectPath, repairFiles) : null;
  if (isTauri() && repairRoot) {
    try {
      await writeProjectFile(repairRoot, path, newContent);
    } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  } else if (dirHandle) {
    try {
      await writeFileToFS(dirHandle, path, newContent);
    } catch (e) {
      callbacks.onLog(`FS write warning for ${path}: ${e instanceof Error ? e.message : e}`, 'warning');
    }
  }

  const currentPlan = useWorkbenchStore.getState().currentPlan;
  if (currentPlan) {
    const steps2 = currentPlan.steps.map(s =>
      normalizePath(s.path ?? '') === path ? { ...s, diff: { before: content, after: newContent } } : s,
    );
    useWorkbenchStore.setState({
      currentPlan: { ...currentPlan, steps: steps2 },
    });
  }

  callbacks.onLog(`Repair: edited ${path}`, 'success');
}

// ─── Web Search & Fetch ───────────────────────────────────────────────────────

async function executeWebSearch(
  step: PlanStep,
  _model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const query = step.command; // reuse command field for the search query
  if (!query) throw new Error('No search query specified');

  const searchActId = callbacks.onActivity?.('researching', `Searching: "${query.slice(0, 60)}"`, step.description.slice(0, 60));
  callbacks.onTerminal(`🔍 Searching: ${query}`);
  callbacks.onLog(`Web search: ${query}`, 'info');

  if (!isTauri()) {
    callbacks.onTerminal('⚠ Web search requires the desktop build (Tauri)');
    callbacks.onLog('Web search skipped — requires Tauri desktop', 'warning');
    return;
  }

  // Wrap every HTTP call with a hard 30-second timeout so a stalled network
  // request can never freeze plan execution indefinitely.
  const HTTP_TIMEOUT_MS = 30_000;
  const timedFetch = (url: string) =>
    Promise.race([
      makeHttpRequest(url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`HTTP timeout after ${HTTP_TIMEOUT_MS / 1000}s: ${url}`)), HTTP_TIMEOUT_MS),
      ),
    ]);

  try {
    const encoded = encodeURIComponent(query);

    // Try DuckDuckGo HTML search first, fall back to lite, then to API
    let results: { title: string; url: string; snippet: string }[] = [];

    const endpoints = [
      `https://html.duckduckgo.com/html/?q=${encoded}`,
      `https://lite.duckduckgo.com/lite/?q=${encoded}`,
    ];

    for (const searchUrl of endpoints) {
      try {
        callbacks.onLog(`Trying: ${searchUrl}`, 'info');
        const response = await timedFetch(searchUrl);
        if (response.status === 200 && response.body.length > 100) {
          results = parseDuckDuckGoResults(response.body);
          if (results.length > 0) {
            callbacks.onLog(`Got ${results.length} results from ${searchUrl}`, 'info');
            break;
          }
        }
      } catch (e) {
        callbacks.onLog(`Endpoint failed: ${searchUrl}: ${e}`, 'warning');
      }
    }

    // Fallback: try DuckDuckGo Instant Answer API (JSON)
    if (results.length === 0) {
      try {
        const apiUrl = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`;
        const apiResp = await timedFetch(apiUrl);
        if (apiResp.status === 200) {
          const data = JSON.parse(apiResp.body);
          if (data.AbstractText) {
            results.push({
              title: data.Heading || query,
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
        // JSON API failed too — continue with empty results
      }
    }

    if (results.length === 0) {
      callbacks.onTerminal('⚠ No search results found from any source');
      callbacks.onLog('No search results found', 'warning');
      _webResearchContext.push(`[Web search: "${query}"] — No results found.`);
      callbacks.onStepOutput?.(step, `No search results found for: ${query}`);
      return;
    }

    // Format results for display and context
    const formatted = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
    ).join('\n\n');

    callbacks.onTerminal(`Found ${results.length} results:`);
    // Output each result to both terminal and step output (so stepResults includes them)
    for (const r of results.slice(0, 5)) {
      const line1 = `  → ${r.title}`;
      const line2 = `    ${r.url}`;
      const line3 = r.snippet ? `    ${r.snippet}` : '';
      callbacks.onTerminal(line1);
      callbacks.onTerminal(line2);
      if (line3) callbacks.onTerminal(line3);
      callbacks.onStepOutput?.(step, line1);
      callbacks.onStepOutput?.(step, line2);
      if (line3) callbacks.onStepOutput?.(step, line3);
    }

    // Store in context for the coder model and subsequent steps
    const contextEntry = `[Web search: "${query}"]\n${formatted}`;
    _webResearchContext.push(
      contextEntry.length > WEB_CONTENT_MAX_CHARS
        ? contextEntry.slice(0, WEB_CONTENT_MAX_CHARS) + '\n... (truncated)'
        : contextEntry
    );

    callbacks.onLog(`Web search found ${results.length} results`, 'success');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onLog(`Web search failed: ${msg}`, 'warning');
    callbacks.onTerminal(`⚠ Search error: ${msg}`);
  } finally {
    if (searchActId) callbacks.onActivityComplete?.(searchActId);
  }
}

async function executeFetchUrl(
  step: PlanStep,
  _model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const url = step.command; // reuse command field for the URL
  if (!url) throw new Error('No URL specified');

  callbacks.onTerminal(`🌐 Fetching: ${url}`);
  callbacks.onLog(`Fetch URL: ${url}`, 'info');

  if (!isTauri()) {
    callbacks.onTerminal('⚠ URL fetch requires the desktop build (Tauri)');
    callbacks.onLog('URL fetch skipped — requires Tauri desktop', 'warning');
    return;
  }

  try {
    const response = await Promise.race([
      makeHttpRequest(url),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`HTTP timeout after 30s: ${url}`)), 30_000),
      ),
    ]);

    if (response.status !== 200) {
      callbacks.onLog(`Fetch returned HTTP ${response.status}`, 'warning');
      callbacks.onTerminal(`⚠ HTTP ${response.status} from ${url}`);
      _webResearchContext.push(`[Fetched: ${url}] — HTTP ${response.status} (failed)`);
      return;
    }

    // Convert HTML to readable text, or use body as-is for JSON/plain text
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

    // Truncate to prevent context overflow
    if (content.length > WEB_CONTENT_MAX_CHARS) {
      content = content.slice(0, WEB_CONTENT_MAX_CHARS) + '\n... (truncated)';
    }

    const preview = content.slice(0, 300).replace(/\n/g, ' ');
    callbacks.onTerminal(`✓ Fetched ${content.length} chars`);
    callbacks.onTerminal(`  Preview: ${preview}...`);
    callbacks.onStepOutput?.(step, `Fetched ${content.length} chars from ${url}`);
    callbacks.onStepOutput?.(step, preview.slice(0, 200));

    // Store in context for the coder model
    _webResearchContext.push(`[Fetched: ${url}]\n${content}`);

    callbacks.onLog(`Fetched ${content.length} chars from ${url}`, 'success');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onLog(`Fetch failed: ${msg}`, 'warning');
    callbacks.onTerminal(`⚠ Fetch error: ${msg}`);
    _webResearchContext.push(`[Fetched: ${url}] — Error: ${msg}`);
  }
}

// ─── browse_web ───────────────────────────────────────────────────────────────

async function executeBrowseWeb(
  step: PlanStep,
  _model: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  const url = step.command;
  if (!url) throw new Error('No URL specified for browse_web');

  callbacks.onTerminal(`🌐 Browsing: ${url}`);
  callbacks.onLog(`Browse web: ${url}`, 'info');

  if (!isTauri()) {
    callbacks.onTerminal('⚠ browse_web requires the desktop build (Tauri)');
    callbacks.onLog('browse_web skipped — requires Tauri desktop', 'warning');
    return;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');

    // On first call this installs Playwright + Chromium (~300 MB, one-time)
    const status = await invoke<string>('ensure_playwright');
    if (status !== 'ready') {
      callbacks.onTerminal(`  🌐 Playwright installed (first-time setup)`);
    }

    const actionsJson = (step as unknown as { browseActions?: string }).browseActions;
    const resultJson = await invoke<string>('browse_web', {
      url,
      actionsJson: actionsJson ?? null,
    });

    const result = JSON.parse(resultJson) as { title: string; content: string; url: string };
    const content = result.content ?? '';
    const truncated = content.length > WEB_CONTENT_MAX_CHARS
      ? content.slice(0, WEB_CONTENT_MAX_CHARS) + '\n... (truncated)'
      : content;

    const preview = truncated.slice(0, 300).replace(/\n/g, ' ');
    callbacks.onTerminal(`  Title: ${result.title}`);
    callbacks.onTerminal(`  Preview: ${preview}…`);
    callbacks.onStepOutput?.(step, `Browsed ${content.length} chars from ${result.url}`);

    _webResearchContext.push(`[Browsed: ${result.url}]\nTitle: ${result.title}\n\n${truncated}`);
    callbacks.onLog(`Browsed ${content.length} chars from ${result.url}`, 'success');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    callbacks.onLog(`Browse failed: ${msg}`, 'warning');
    callbacks.onTerminal(`⚠ Browse error: ${msg}`);
    _webResearchContext.push(`[Browsed: ${url}] — Error: ${msg}`);
  }
}

// ─── Smart Action Detection ───────────────────────────────────────────────────

/** Known CLI tools — if the command starts with one of these, it's a real shell command. */
const KNOWN_CLI_TOOLS = /^(npm|npx|node|pnpm|yarn|bun|cargo|pip|pip3|python|python3|git|curl|wget|make|cmake|mkdir|rm|rmdir|mv|cp|cat|ls|cd|echo|find|grep|rg|chmod|chown|brew|apt|apt-get|yum|dnf|pacman|rustc|rustup|go|java|javac|mvn|gradle|docker|kubectl|terraform|ssh|scp|tar|unzip|zip|sed|awk|sort|head|tail|wc|diff|touch|ln|open|pbcopy|xdg-open|code|subl|vim|nano|less|more|env|export|source|which|whereis|type|man|sudo|su|deno|tsc|tsx|jest|vitest|eslint|prettier)\b/;

/**
 * Detect if a "run_command" is actually a web search query or a URL fetch.
 * LLMs often generate `run_command` with plain English or URLs instead of using
 * web_search / fetch_url actions. This auto-corrects those cases.
 */
function detectSmartAction(step: PlanStep): PlanStep['action'] {
  if (step.action !== 'run_command') return step.action;
  const cmd = (step.command ?? '').trim();
  if (!cmd) return step.action;

  // If the command is an https URL, treat as fetch_url
  if (/^https?:\/\//i.test(cmd)) return 'fetch_url';

  // file:// commands stay as run_command so the guard in executeRunCommand
  // can intercept them and serve content from the workbench store
  if (/^file:\/\//i.test(cmd)) return 'run_command';

  // If description mentions search-related words — treat as web_search
  // Use flexible matching: search, searches, searching, searched, etc.
  const desc = (step.description ?? '').toLowerCase();
  const searchInDesc = /\b(search|look\s*up|research|find\s+out|google|browse|web|internet|online|documentation|docs)\b/i;
  if (searchInDesc.test(desc) && !KNOWN_CLI_TOOLS.test(cmd)) return 'web_search';

  // If the command itself mentions searching
  const cmdLower = cmd.toLowerCase();
  if (/^(search|find|look\s*up|what\s+is|how\s+to|latest|best|top|list\s+of)\b/.test(cmdLower)) return 'web_search';

  // If the command has no executable-like pattern and looks like natural language
  const hasFlags = /\s+--?\w/.test(cmd);       // has -flag or --flag
  const hasPipes = /[|><]/.test(cmd);           // has pipes or redirects
  const hasPath = /[/\\]/.test(cmd);            // has path separators
  const startsWithTool = KNOWN_CLI_TOOLS.test(cmd);

  const looksLikeCommand = startsWithTool || hasFlags || hasPipes || hasPath;

  if (!looksLikeCommand && cmd.split(/\s+/).length >= 2) {
    // 2+ words with no CLI tool, flags, or paths = probably a search query
    return 'web_search';
  }

  return step.action;
}

/**
 * Mutates the step's action in-place if it's misclassified, so the caller
 * sees the corrected action for verification skipping, etc.
 */
function applySmartDetection(step: PlanStep, callbacks: ExecutionCallbacks): void {
  const detected = detectSmartAction(step);
  if (detected !== step.action) {
    callbacks.onLog(`Auto-rerouted: ${step.action} → ${detected} for "${step.command}"`, 'info');
    // Mutate in-place so the caller's reference sees the change
    (step as { action: string }).action = detected;
  }
}

// ─── Step Action Router ───────────────────────────────────────────────────────

async function executeStepAction(
  step: PlanStep,
  coderModel: ModelConfig | undefined,
  callbacks: ExecutionCallbacks,
): Promise<void> {
  // Auto-detect misclassified steps (LLM says run_command but it's really a search/fetch)
  // Mutates step.action in-place so caller sees the corrected action
  applySmartDetection(step, callbacks);

  switch (step.action) {
    case 'create_file':
      await executeCreateFile(step, coderModel, callbacks);
      break;
    case 'edit_file':
      await executeEditFile(step, coderModel, callbacks);
      break;
    case 'delete_file':
      await executeDeleteFile(step, coderModel, callbacks);
      break;
    case 'run_command':
      await executeRunCommand(step, coderModel, callbacks);
      break;
    case 'web_search':
      await executeWebSearch(step, coderModel, callbacks);
      break;
    case 'fetch_url':
      await executeFetchUrl(step, coderModel, callbacks);
      break;
    case 'browse_web':
      await executeBrowseWeb(step, coderModel, callbacks);
      break;
    default:
      throw new Error(`Unknown action: ${step.action}`);
  }
}

// ─── Main Executor ───────────────────────────────────────────────────────────

export async function executePlan(
  plan: Plan,
  callbacks: ExecutionCallbacks,
  coderModelOverride?: ModelConfig,
  verifierModelOverride?: ModelConfig,
  /** Structured project info — set once so all step executors + repair agent can use it */
  projectIdentity?: ProjectIdentity,
  /** System environment — set once so the coder + repair agents know OS/arch */
  envInfo?: EnvironmentInfo,
): Promise<void> {
  const store = useWorkbenchStore.getState();
  const modelStore = useModelStore.getState();

  const coderModel = coderModelOverride ?? modelStore.getModelForRole('coder');
  const verifierModel = verifierModelOverride ?? modelStore.getModelForRole('tester');

  // Set module-level project context for code generation + repair
  if (projectIdentity) {
    _projectIdentity = projectIdentity;
    _projectContext = {
      framework: projectIdentity.framework,
      packageManager: projectIdentity.packageManager,
      language: projectIdentity.language,
      entryPoints: projectIdentity.entryPoints,
      runCommands: projectIdentity.runCommands,
      os: envInfo?.os ?? null,
      arch: envInfo?.arch ?? null,
    };
  }
  // Set module-level env info so coder + repair agents know the system
  _envInfo = envInfo ?? useWorkbenchStore.getState().envInfo ?? undefined;

  // Pull skillMd from project memory store so coder has project conventions
  try {
    const { useProjectMemoryStore } = await import('@/store/projectMemoryStore');
    _skillMd = useProjectMemoryStore.getState().getMemory(store.projectName)?.skillMd || undefined;
  } catch { /* non-fatal */ }

  // Pull install history so coder knows what to avoid repeating (bounded — disk read must not block forever)
  _installHistoryForCoder = undefined;
  if (store.projectPath) {
    try {
      const root = resolveProjectRoot(store.projectPath, store.files);
      if (root) {
        const { buildInstallContext } = await import('@/services/installTracker');
        const INSTALL_CTX_MS = 6_000;
        _installHistoryForCoder =
          (await raceWithTimeout(buildInstallContext(root), INSTALL_CTX_MS, undefined)) || undefined;
      }
    } catch { /* non-fatal */ }
  }

  store.clearHistory();

  // Reset web research context for this plan execution
  _webResearchContext = [];

  // Let the UI paint "executing" before any heavy synchronous work (large file trees).
  callbacks.onLog('Plan engine: preparing…', 'info');
  await new Promise<void>(r => setTimeout(r, 0));

  // Pre-process plan paths — fix hallucinated paths before execution begins
  const allFiles = flattenAllFilesCapped(store.files, (m) => callbacks.onLog(m, 'warning'));
  normalizePlanPaths(plan, (p) => store.getFileContent(p), allFiles, callbacks.onLog);

  callbacks.onTerminal('─── Executing plan: ' + plan.summary + ' ───');
  callbacks.onLog('Plan execution started', 'info');
  if (plan.validationCommand) {
    callbacks.onLog(`Validation after edits: ${plan.validationCommand}`, 'info');
  }

  let stoppedEarly = false;
  let stopReason = '';
  let userCancelled = false;
  const sig = callbacks.signal;

  const abortIfNeeded = (label: string): boolean => {
    if (!sig?.aborted) return false;
    stopReason = label;
    stoppedEarly = true;
    userCancelled = true;
    callbacks.onPlanStoppedEarly?.(label);
    return true;
  };

  stepLoop: for (const [stepIndex, step] of plan.steps.entries()) {
    if (abortIfNeeded('Cancelled by user')) break stepLoop;

    useWorkbenchStore.getState().updatePlanStep(step.id, {
      stopDiagnostic: undefined,
      lastValidationError: undefined,
      repairAttemptCount: 0,
    });

    callbacks.onStepStart(step);
    callbacks.onLog(`Step: ${step.description}`, 'info');

    const storeBefore = useWorkbenchStore.getState();
    const contentBefore = step.path ? storeBefore.getFileContent(step.path) : undefined;
    const fileExistsBefore = step.path ? contentBefore !== undefined : false;

    let stepThrowError: string | null = null;
    try {
      await executeStepAction(step, coderModel, callbacks);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        abortIfNeeded('Cancelled by user');
        break stepLoop;
      }
      const stepError = err instanceof Error ? err.message : 'Unknown error';

      // EBADPLATFORM errors on npm/yarn/pnpm installs: don't kill the plan — convert
      // to a synthetic validation failure so the repair loop can try LLM-guided fixes
      // (e.g. PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1, different package versions, etc.).
      const isInstallCmd = /^(npm|npx|yarn|pnpm|bun)\s+(?:install|add|i)\b/i.test((step.command ?? '').trim());
      if (step.action === 'run_command' && isInstallCmd && /ebadplatform/i.test(stepError)) {
        callbacks.onLog(
          `EBADPLATFORM auto-fix exhausted — converting to repair loop for LLM-guided recovery`,
          'warning',
        );
        callbacks.onTerminal(`⚙ Entering repair loop for arm64 platform fix...`);
        stepThrowError = stepError;
        // Fall through to validation block below with a synthetic failure
      } else if (
        step.action === 'run_command' &&
        /timed out|Command timed out/i.test(stepError) &&
        /^(?:git\s+grep|grep|rg|ack|ag)\b/i.test((step.command ?? '').trim())
      ) {
        // Read-only search over the repo — do not enter the heavy repair engine; user only waits longer.
        callbacks.onLog(`Search command hit the time limit — stopping the plan. ${stepError.slice(0, 200)}`, 'error');
        callbacks.onTerminal(`! ${stepError}`);
        callbacks.onStepError(step, stepError);
        stoppedEarly = true;
        stopReason = stepError;
        break stepLoop;
      } else if (step.action === 'run_command') {
        // All run_command failures enter the repair loop — the agent decides
        // whether to retry, search the web, try different flags, or move on.
        // The repair engine's progress-gated persistence handles everything.
        callbacks.onLog(
          `Command failed — entering repair loop: ${stepError.slice(0, 200)}`,
          'warning',
        );
        callbacks.onTerminal(`⚙ Command failed — repair loop will try to fix it...`);
        stepThrowError = stepError;
      }

      if (!stepThrowError) {
        callbacks.onStepError(step, stepError);
        callbacks.onLog(`Error in step "${step.description}": ${stepError}`, 'error');
        callbacks.onTerminal(`! Error: ${stepError}`);
        stoppedEarly = true;
        stopReason = stepError;
        break stepLoop;
      }
    }

    const storeAfter = useWorkbenchStore.getState();
    const contentAfter = step.path ? storeAfter.getFileContent(step.path) : undefined;
    const fileExistsAfter = step.path ? contentAfter !== undefined : true;

    // Web search / fetch / browse steps don't modify files — auto-pass verification
    if (step.action === 'web_search' || step.action === 'fetch_url' || step.action === 'browse_web') {
      callbacks.onStepDone(step);
      continue;
    }

    const isLastStep = stepIndex === plan.steps.length - 1;

    // The agent decides whether a project build is relevant — not the plan.
    //
    // A project-wide build/lint validation is only useful when ALL of these hold:
    //   1. This is the last step (earlier steps haven't set up the full environment)
    //   2. The plan contains at least one source-code change (edit_file/create_file
    //      on a compilable file) — if the plan only runs commands or edits configs,
    //      the build was never the goal
    //   3. The step itself is a run_command — file-edit steps are validated by the
    //      step verifier (did the content change?), not by a build
    //
    // This means the agent never needs the user to specify a validation command.
    // It runs one when it makes sense, and skips it otherwise.
    const planTouchesSourceCode = plan.steps.some(s =>
      (s.action === 'edit_file' || s.action === 'create_file') &&
      s.path &&
      /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|rb|php|cs|java|swift|kt|c|cpp|h|hpp|vue|svelte)$/i.test(s.path),
    );
    const stepIsRunCommand = step.action === 'run_command';

    const skipProjectBuild = !isLastStep || !stepIsRunCommand || !planTouchesSourceCode;

    // If executeStepAction threw an EBADPLATFORM error, inject it as a synthetic
    // validation failure so the repair loop can try LLM-guided recovery strategies.
    let validation: ValidationRunResult;
    if (stepThrowError) {
      validation = {
        pass: false,
        command: step.command ?? '',
        stdout: '',
        stderr: stepThrowError,
        skipped: false,
      };
      useWorkbenchStore.getState().updatePlanStep(step.id, {
        lastValidationCommand: step.command ?? '',
        lastValidationError: stepThrowError.slice(0, 500),
      });
    } else {
      const verInput: VerificationInput = {
        step,
        fileExistsBefore,
        fileExistsAfter,
        contentBefore,
        contentAfter,
        errorOutput: undefined,
      };
      const verActId = callbacks.onActivity?.('verifying', `Verifying: ${step.description.slice(0, 60)}`);
      const verification = await verifyStep(verInput, verifierModel);
      if (verActId) callbacks.onActivityComplete?.(verActId);
      callbacks.onLog(
        `Verified step: ${verification.result} — ${verification.summary}`,
        verification.result === 'pass' ? 'success' : verification.result === 'fail' ? 'error' : 'warning',
      );

      // Only run the full project build on the last step.
      // Intermediate steps cannot reliably pass a build until the entire plan is applied.
      validation = await runPostStepValidation(plan, verification, skipProjectBuild);
    }

    useWorkbenchStore.getState().updatePlanStep(step.id, {
      lastValidationCommand: validation.command,
      lastValidationError: validation.pass ? undefined : formatValidationFailure(validation).slice(0, 500),
    });

    if (validation.pass) {
      callbacks.onStepDone(step);
      continue;
    }

    // ── Syntax pre-check before full build ───────────────────────────────────
    // Catch the most common model-caused file corruptions cheaply, before
    // spending 30-120s on a real build.
    if (step.path && !validation.pass) {
      const fileContent = useWorkbenchStore.getState().getFileContent(step.path);
      if (fileContent !== undefined) {
        const syntaxProblems = syntaxPreCheck(fileContent, step.path);
        if (syntaxProblems.length > 0) {
          const syntaxError = `Syntax pre-check failed in ${step.path}:\n${syntaxProblems.map(p => `  • ${p}`).join('\n')}`;
          callbacks.onLog(syntaxError, 'error');
          callbacks.onTerminal(`! ${syntaxProblems[0]}`);
          // Inject a synthetic validation result so the repair agent gets a
          // tight, precise error instead of a full build dump.
          validation = {
            pass: false,
            command: `syntax-check ${step.path}`,
            stdout: '',
            stderr: syntaxError,
            skipped: false,
          };
          useWorkbenchStore.getState().updatePlanStep(step.id, {
            lastValidationCommand: `syntax-check ${step.path}`,
            lastValidationError: syntaxError.slice(0, 500),
          });
        }
      }
    }

    // ── Ledger-based repair loop ──────────────────────────────────────────────
    // One control loop, one decision maker (dependencyRepairEngine).
    // No parallel retry cascades, no overlapping mutation layers.
    const ledger = createRepairLedger(step.id, { maxTotalAttempts: MAX_REPAIR_ATTEMPTS_PER_STEP, wallClockBudgetMs: 900_000 });
    let attempt = 0;
    let repeatedError = false;
    let skipCurrentStep = false;

    // Detect package manager and arch for the repair engine context.
    // Derive PM from the actual validation command — more reliable than stored project context
    // because the user may have changed the command since the project was last scanned.
    const { projectPath: repairPP, files: repairFiles } = useWorkbenchStore.getState();
    const _cmdForPm = validation.command ?? step.command ?? '';
    const _detectedPm = ((): import('./repairTypes').PackageManager => {
      if (/^npm[\s/]/.test(_cmdForPm)) return 'npm';
      if (/^pnpm[\s/]/.test(_cmdForPm)) return 'pnpm';
      if (/^yarn[\s/]/.test(_cmdForPm)) return 'yarn';
      if (/^bun[\s/]/.test(_cmdForPm)) return 'bun';
      return _projectContext?.packageManager ?? null;
    })();
    let repairContext = {
      packageManager: _detectedPm,
      arch: _projectContext?.arch ?? null,
      os: _projectContext?.os ?? null,
      lockfilePresent: repairFiles.some(f =>
        f.name === 'package-lock.json' || f.name === 'bun.lockb' || f.name === 'yarn.lock' ||
        f.path?.endsWith('/package-lock.json') || f.path?.endsWith('/bun.lockb') || f.path?.endsWith('/yarn.lock')
      ),
      projectPath: repairPP ?? '',
      originalCommand: step.command ?? validation.command,
    };
    // Track search source count for progress scoring
    let _searchSourcesAdded = 0;

    while (!validation.pass) {
      if (abortIfNeeded('Cancelled by user')) break stepLoop;

      _searchSourcesAdded = 0; // reset per iteration; escalate_to_search will set it

      // Classify the current failure
      const fingerprint = classifyFailure(
        validation.stdout,
        validation.stderr,
        validation.pass ? 0 : 1,
        { packageManager: repairContext.packageManager, arch: repairContext.arch, os: repairContext.os },
      );

      // Ask the repair engine what to do next
      const action = nextRepairAction(ledger, fingerprint, repairContext);

      switch (action.kind) {
        case 'stop': {
          callbacks.onLog(`Repair engine stopped: ${action.reason}`, 'error');
          callbacks.onTerminal(`! ${action.reason}`);
          repeatedError = action.reason.includes('persisted');
          break;
        }

        case 'run_command': {
          attempt += 1;
          useWorkbenchStore.getState().updatePlanStep(step.id, { status: 'repairing', repairAttemptCount: attempt });
          callbacks.onRepairStart?.(step, attempt);
          callbacks.onLog(`Repair [${action.strategyId}]: ${action.command}`, 'info');
          callbacks.onTerminal(`$ ${action.command}`);

          const cmdActId = callbacks.onActivity?.('repairing', `[${action.strategyId}]: ${action.command.slice(0, 60)}`, '');

          let repairResult: Awaited<ReturnType<typeof executeCommand>> | null = null;
          try {
            // Prepend env vars as KEY=VALUE prefix (executeCommand doesn't accept an env param)
            const envPrefix = action.env
              ? Object.entries(action.env).map(([k, v]) => `${k}=${v}`).join(' ') + ' '
              : '';
            const fullCmd = envPrefix + action.command;
            await withProjectLock(repairContext.projectPath, async () => {
              repairResult = await executeCommand(fullCmd, repairContext.projectPath);
            });
          } catch (e) {
            repairResult = { code: 1, stdout: '', stderr: e instanceof Error ? e.message : String(e) };
          }

          if (cmdActId) callbacks.onActivityComplete?.(cmdActId);

          const repairExitCode = repairResult?.code ?? null;
          const progress = computeProgress(ledger, fingerprint, action.strategyFamily, 0);
          const repairAttempt: RepairAttempt = {
            timestamp: new Date().toISOString(),
            strategyId: action.strategyId,
            command: action.command,
            packageManager: repairContext.packageManager,
            result: repairExitCode === 0 ? 'success' : 'failed',
            fingerprint,
            exitCode: repairExitCode,
            errorSnippet: (repairResult?.stderr ?? '').slice(-500),
            strategyFamily: action.strategyFamily,
            progressScore: progress.score,
          };
          recordAttempt(ledger, repairAttempt);

          if (repairExitCode === 0) {
            // Re-validate after successful repair command
            const rv = await runPostStepValidation(
              plan,
              { result: 'pass', summary: 'repair command succeeded' } satisfies VerificationResult,
              skipProjectBuild,
            );
            validation = rv;
            useWorkbenchStore.getState().updatePlanStep(step.id, {
              lastValidationCommand: validation.command,
              lastValidationError: validation.pass ? undefined : formatValidationFailure(validation).slice(0, 500),
            });
            callbacks.onRepairDone?.(step, attempt, validation.pass);
          } else {
            // Exit 127 = command not found, 126 = permission denied — infrastructure failure.
            // The repair command itself wasn't found, so the PM is wrong. Correct it to npm.
            if (repairExitCode === 127 || repairExitCode === 126) {
              repairContext = { ...repairContext, packageManager: 'npm' };
              callbacks.onLog(
                `Repair command not found (exit ${repairExitCode}) — package manager unavailable, switching to npm`,
                'warning',
              );
              // Record the missing binary to agent memory so future plans avoid it
              const missingBinMatch = action.command.trim().match(/^(\S+)/);
              const missingBin = missingBinMatch?.[1] ?? action.command.trim().slice(0, 40);
              try {
                useAgentMemoryStore.getState().addMemory({
                  projectName: useWorkbenchStore.getState().projectName,
                  category: 'error',
                  title: `Missing binary: ${missingBin} (exit ${repairExitCode})`,
                  content: `Command "${action.command}" failed with exit ${repairExitCode} (command not found). Binary "${missingBin}" is not installed or not in PATH. Do not use this binary directly; install it first or use an alternative (e.g., npx ${missingBin}).`,
                  tags: ['missing_binary', missingBin, `exit_${repairExitCode}`],
                  outcome: 'failure',
                });
              } catch { /* non-fatal */ }
            } else {
              callbacks.onLog(
                `Repair command failed (exit ${repairExitCode ?? '?'}): ${(repairResult?.stderr ?? '').slice(0, 200)}`,
                'warning',
              );
            }

            // Record failed repair install commands to installs.json so buildInstallContext
            // populates its KNOWN FAILURES section — the LLM sees what already failed
            if (isInstallCommand(action.command)) {
              try {
                const { projectPath, files } = useWorkbenchStore.getState();
                const { resolveEffectiveRoot } = await import('@/services/memoryManager');
                const root = projectPath ? resolveEffectiveRoot(projectPath, files) : '';
                if (root) {
                  const failRecord = buildInstallRecord(
                    action.command,
                    repairExitCode ?? 1,
                    repairResult?.stdout ?? '',
                    (repairResult?.stderr ?? '').slice(-500),
                    0,
                    step.id,
                    '',
                  );
                  recordInstall(failRecord, root).catch(() => {});
                }
              } catch { /* non-fatal */ }
            }

            callbacks.onRepairDone?.(step, attempt, false);
          }
          continue;
        }

        case 'escalate_to_search': {
          // Engine decided we need web evidence before more attempts.
          if (!coderModel) {
            callbacks.onLog('No coder model configured — skipping web search.', 'warning');
            ledger.webSearchDone = true; // mark done so we don't loop forever
            continue;
          }
          const searchQuery = action.query;
          callbacks.onLog(`Searching the web: "${searchQuery.slice(0, 120)}"`, 'info');
          callbacks.onTerminal(`🔍 Researching: "${searchQuery.slice(0, 120)}"`);
          const searchActId = callbacks.onActivity?.('researching', `Searching: "${searchQuery.slice(0, 80)}"`, 'Evidence gathering');
          try {
            const searchStep: PlanStep = {
              ...step,
              id: `search_repair_${step.id}`,
              action: 'web_search',
              command: searchQuery,
              description: `Research: ${searchQuery.slice(0, 80)}`,
            };
            const prevLen = _webResearchContext.length;
            await executeWebSearch(searchStep, coderModel, callbacks);
            _searchSourcesAdded = _webResearchContext.length - prevLen;
          } catch { /* non-fatal */ }
          if (searchActId) callbacks.onActivityComplete?.(searchActId);
          ledger.webSearchDone = true;
          // Reset zero-progress counter — new evidence was (potentially) gathered
          ledger.zeroProgressRounds = 0;
          continue;
        }

        case 'run_pm_reassessment': {
          // Re-derive PM from the actual validation command (not stored project context).
          callbacks.onLog(`PM reassessment: ${action.reason}`, 'info');
          const cmdForReassess = validation.command ?? step.command ?? '';
          const reassessedPm = ((): import('./repairTypes').PackageManager => {
            if (/^npm[\s/]/.test(cmdForReassess)) return 'npm';
            if (/^pnpm[\s/]/.test(cmdForReassess)) return 'pnpm';
            if (/^yarn[\s/]/.test(cmdForReassess)) return 'yarn';
            if (/^bun[\s/]/.test(cmdForReassess)) return 'bun';
            return 'npm'; // safe default
          })();
          if (reassessedPm !== repairContext.packageManager) {
            callbacks.onLog(`PM reassessment: switching from "${repairContext.packageManager}" to "${reassessedPm}"`, 'warning');
            repairContext = { ...repairContext, packageManager: reassessedPm };
          } else {
            callbacks.onLog(`PM reassessment: "${reassessedPm}" confirmed (no change).`, 'info');
          }
          ledger.pmReassessmentDone = true;
          ledger.zeroProgressRounds = 0;
          continue;
        }

        case 'escalate_to_llm': {
          if (!coderModel) {
            callbacks.onLog('No coder model configured — cannot auto-repair.', 'warning');
            break;
          }

          attempt += 1;
          useWorkbenchStore.getState().updatePlanStep(step.id, { status: 'repairing', repairAttemptCount: attempt });
          callbacks.onRepairStart?.(step, attempt);

          const repairActId = callbacks.onActivity?.(
            'repairing',
            `LLM repair attempt ${attempt}: ${step.description.slice(0, 50)}`,
            formatValidationFailure(validation).slice(0, 100),
          );

          const st = useWorkbenchStore.getState();
          const repairBaseline = step.path ? st.getFileContent(step.path) : undefined;
          // Don't send the file being edited when the error is a native binding or platform
          // issue — the file is irrelevant and causes the LLM to edit it instead of reinstalling
          const fileExcerpt =
            step.path && repairBaseline !== undefined &&
            fingerprint.category !== 'missing_native_binding' &&
            fingerprint.category !== 'bad_platform'
              ? { path: step.path, content: repairBaseline }
              : undefined;
          const projectFileHints = collectProjectConfigHints(st.files, st.getFileContent);

          // The repair ledger + past install history + agent memory are passed to the LLM
          // so it cannot repeat strategies that failed now or in previous sessions.
          const ledgerSummary = formatLedgerForPrompt(ledger);
          let installHistoryCtx: string | undefined;
          try {
            installHistoryCtx = await buildInstallContext(repairContext.projectPath);
          } catch { /* non-fatal */ }
          let agentMemoryCtx: string | undefined;
          try {
            agentMemoryCtx = useAgentMemoryStore.getState().buildMemoryPrompt(
              useWorkbenchStore.getState().projectName, 1500,
            ) || undefined;
          } catch { /* non-fatal */ }
          const researchContext = [
            ..._webResearchContext.slice(-5),
            ledgerSummary,
            installHistoryCtx,
          ].filter(Boolean).join('\n\n');

          const fix = await requestRepairFix({
            step,
            attempt,
            maxAttempts: MAX_REPAIR_ATTEMPTS_PER_STEP,
            validation,
            fileExcerpt,
            projectFileHints,
            // Pass the corrected (runtime-derived) package manager, not the stale stored one
            projectContext: { ..._projectContext, packageManager: repairContext.packageManager ?? _projectContext?.packageManager },
            researchContext: researchContext || undefined,
            agentMemory: agentMemoryCtx,
            envInfo: _envInfo,
            userHint: undefined,
            previousAttempts: ledger.attempts.map(a => `[${a.strategyId}] ${a.command.slice(0, 80)} → ${a.result}`),
            model: coderModel,
            signal: sig,
          });

          if (repairActId) callbacks.onActivityComplete?.(repairActId);

          const llmProgress = computeProgress(ledger, fingerprint, action.strategyFamily, _searchSourcesAdded);
          const llmAttempt: RepairAttempt = {
            timestamp: new Date().toISOString(),
            strategyId: `llm-repair-${attempt}`,
            command: fix
              ? (fix.kind === 'run_command' ? fix.command : `edit_file:${fix.path}`)
              : '(no fix)',
            packageManager: repairContext.packageManager,
            result: 'failed',
            fingerprint,
            exitCode: null,
            errorSnippet: '',
            strategyFamily: action.strategyFamily,
            progressScore: llmProgress.score,
          };

          if (!fix) {
            callbacks.onLog('Repair agent returned no applicable fix — continuing repair loop for next strategy.', 'warning');
            callbacks.onRepairDone?.(step, attempt, false);
            llmAttempt.errorSnippet = 'LLM returned no fix';
            recordAttempt(ledger, llmAttempt);
            // `continue` not `break` — a null response is a failed attempt, not a terminal stop.
            // The engine will escalate to search, PM reassessment, or user on the next iteration.
            continue;
          }

          try {
            await applyRepairFix(fix, callbacks);
          } catch (repairErr) {
            const msg = repairErr instanceof Error ? repairErr.message : String(repairErr);
            callbacks.onLog(`Repair failed: ${msg}`, 'error');
            callbacks.onTerminal(`! Repair failed: ${msg}`);
            callbacks.onRepairDone?.(step, attempt, false);
            llmAttempt.errorSnippet = msg.slice(0, 300);
            recordAttempt(ledger, llmAttempt);
            validation = { pass: false, command: validation.command, stdout: '', stderr: msg, skipped: false };
            continue;
          }

          const vAfter = useWorkbenchStore.getState();
          const cAfter = step.path ? vAfter.getFileContent(step.path) : undefined;
          const existsAfter = step.path ? cAfter !== undefined : true;
          const verInput2: VerificationInput = {
            step,
            fileExistsBefore,
            fileExistsAfter: existsAfter,
            contentBefore: repairBaseline,
            contentAfter: cAfter,
            errorOutput: undefined,
          };
          const verification2 = await verifyStep(verInput2, verifierModel);
          validation = await runPostStepValidation(plan, verification2, skipProjectBuild);

          useWorkbenchStore.getState().updatePlanStep(step.id, {
            lastValidationCommand: validation.command,
            lastValidationError: validation.pass ? undefined : formatValidationFailure(validation).slice(0, 500),
          });

          llmAttempt.result = validation.pass ? 'success' : 'failed';
          recordAttempt(ledger, llmAttempt);
          callbacks.onRepairDone?.(step, attempt, validation.pass);
          continue;
        }

        case 'escalate_to_user': {
          // Never block on user input — auto-continue and expand budget.
          bumpBudget(ledger, 5);
          callbacks.onLog(`Auto-continue after escalation trigger (attempt ${attempt})`, 'warning');
          continue;
        }

// Break out of while if action.kind was 'stop' or LLM returned nothing or escalation
      // (the continue statements above re-enter the loop when we want to keep going)
      break;
    }

    useWorkbenchStore.getState().updatePlanStep(step.id, { status: 'running' });

    // If user chose to skip this step, record it and move on
    if (skipCurrentStep) {
      useWorkbenchStore.getState().updatePlanStep(step.id, { status: 'done' });
      useAgentMemoryStore.getState().recordCommandOutcome(
        useWorkbenchStore.getState().projectName,
        step.description,
        false,
        'User skipped this step after repeated repair failures',
      );
      continue;
    }

    if (!validation.pass) {
      useAgentMemoryStore.getState().recordCommandOutcome(
        useWorkbenchStore.getState().projectName,
        step.command ?? step.description,
        false,
        formatValidationFailure(validation).slice(0, 300),
      );

      // Persist the ledger even on failure — future sessions will know all strategies were exhausted
      if (ledger.attempts.length > 0) {
        const lastFingerprint = ledger.attempts[ledger.attempts.length - 1]?.fingerprint;
        useAgentMemoryStore.getState().addMemory({
          projectName: useWorkbenchStore.getState().projectName,
          category: 'error',
          title: `Repair failed: ${lastFingerprint?.category ?? 'unknown'} — ${step.description.slice(0, 60)}`,
          content: [
            `Step: ${step.description}`,
            `Error category: ${lastFingerprint?.category ?? 'unknown'}`,
            `Error signature: ${lastFingerprint?.errorSignature ?? 'unknown'}`,
            `All strategies exhausted without success.`,
            '',
            formatLedgerForPrompt(ledger),
          ].join('\n'),
          tags: [
            lastFingerprint?.category ?? 'unknown',
            repairContext.packageManager ?? 'unknown',
            'exhausted',
          ].filter(Boolean),
        });
      }

      const kind = classifyValidationFailure(validation, repeatedError);
      const diagnostic = buildStopDiagnostic(step, validation, attempt, kind);
      useWorkbenchStore.getState().updatePlanStep(step.id, {
        stopDiagnostic: diagnostic,
        stopDiagnosticKind: kind,
        status: 'error',
      });
      callbacks.onStepError(step, diagnostic);
      callbacks.onLog(diagnostic, 'error');
      callbacks.onTerminal(`! ${diagnostic.split('\n')[0]}`);
      stoppedEarly = true;
      stopReason = diagnostic;
      break stepLoop;
    }

    if (attempt > 0) {
      // Find the specific attempt that succeeded so we record WHAT worked, not just that something did
      const winningAttempt = [...ledger.attempts].reverse().find(a => a.result === 'success');
      const winningCmd = winningAttempt?.command ?? step.command ?? step.description;
      const resolution = winningAttempt
        ? `Fixed by [${winningAttempt.strategyId}] (${winningAttempt.strategyFamily}): ${winningCmd.slice(0, 200)}. Category was: ${winningAttempt.fingerprint.category}`
        : `Fixed after ${attempt} attempt(s)`;

      useAgentMemoryStore.getState().recordCommandOutcome(
        useWorkbenchStore.getState().projectName,
        winningCmd,
        true,
        undefined,
        resolution,
      );

      // Also record winning install command to installs.json so future buildInstallContext sees it
      if (winningAttempt && isInstallCommand(winningCmd)) {
        try {
          const { projectPath, files } = useWorkbenchStore.getState();
          const { resolveEffectiveRoot } = await import('@/services/memoryManager');
          const root = projectPath ? resolveEffectiveRoot(projectPath, files) : '';
          if (root) {
            const record = buildInstallRecord(winningCmd, 0, '', winningAttempt.errorSnippet, attempt, step.id, resolution);
            recordInstall(record, root).catch(() => {});
          }
        } catch { /* non-fatal */ }
      }

      // Persist the full ledger summary — next time the same error category appears,
      // buildMemoryPrompt will surface the complete repair history from this session
      useAgentMemoryStore.getState().addMemory({
        projectName: useWorkbenchStore.getState().projectName,
        category: 'error_fix',
        title: `Repair succeeded: ${winningAttempt?.fingerprint.category ?? 'unknown'} — ${step.description.slice(0, 60)}`,
        content: [
          `Step: ${step.description}`,
          `Winning strategy: ${winningAttempt?.strategyId ?? 'unknown'} (${winningAttempt?.strategyFamily ?? 'unknown'})`,
          `Winning command: ${winningCmd.slice(0, 300)}`,
          `Error category: ${winningAttempt?.fingerprint.category ?? 'unknown'}`,
          `Error signature: ${winningAttempt?.fingerprint.errorSignature ?? 'unknown'}`,
          '',
          formatLedgerForPrompt(ledger),
        ].join('\n'),
        tags: [
          winningAttempt?.fingerprint.category ?? 'unknown',
          winningAttempt?.strategyFamily ?? 'unknown',
          repairContext.packageManager ?? 'unknown',
        ].filter(Boolean),
      });
    }

    callbacks.onStepDone(step);
  }

  if (stoppedEarly) {
    callbacks.onTerminal(
      userCancelled ? '─── Plan cancelled ───' : '─── Plan stopped (validation/repair failed) ───',
    );
    callbacks.onLog(
      userCancelled ? 'Cancelled by user.' : 'Plan stopped early — fix the reported issue before continuing.',
      userCancelled ? 'info' : 'warning',
    );
    if (!userCancelled) {
      callbacks.onPlanStoppedEarly?.(stopReason);
    }
  } else {
    callbacks.onAllDone();
    callbacks.onTerminal('─── Plan execution complete ───');
    callbacks.onLog('All steps completed', 'success');
  }
}
}
