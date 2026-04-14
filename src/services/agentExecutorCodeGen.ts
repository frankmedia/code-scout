/**
 * agentExecutorCodeGen.ts
 *
 * Code generation with LLM models: generateCodeWithModel, cleanCodeResponse,
 * generateFallbackCode, sibling context gathering, file hints.
 */

import { useWorkbenchStore, PlanStep } from '@/store/workbenchStore';
import { ModelConfig } from '@/store/modelStore';
import { callModel, modelToRequest, ModelRequestMessage } from './modelApi';
import { useAgentMemoryStore } from '@/store/agentMemoryStore';
import { formatTerminalContextForAgent } from '@/utils/terminalContextForAgent';
import { normalizePath } from './pathResolution';
import {
  getProjectContext,
  getProjectIdentity,
  getEnvInfo,
  getSkillMd,
  getInstallHistoryForCoder,
  getWebResearchContext,
  getScaffoldHint,
} from './agentExecutorContext';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Per-file cap when inlining sibling context into coder prompts. */
const MAX_SIBLING_CONTEXT_PER_FILE = 8_000;
/** Total cap for all sibling context blocks. */
const MAX_SIBLING_CONTEXT_TOTAL = 32_000;
/** Max same-directory files to attach besides importers. */
const MAX_SAME_DIR_FILES = 8;
/** Hard limit for plan-step generated files (lines). Warns at 200, errors at 2000. */
export const MAX_GENERATED_FILE_LINES = 2_000;
/** Soft guidance threshold — files over this are flagged as too large for small LLMs. */
export const WARN_GENERATED_FILE_LINES = 200;

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Sibling context ────────────────────────────────────────────────────────

/**
 * Collects existing project files the coder should see when creating/editing a file
 * so exports/imports and dependencies stay consistent across steps.
 */
export function gatherSiblingContext(
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

export function formatContextFilesBlock(contextFiles: Record<string, string> | undefined): string {
  if (!contextFiles || Object.keys(contextFiles).length === 0) return '';
  const parts = Object.entries(contextFiles).map(
    ([p, body]) => `### ${p}\n\`\`\`\n${body}\n\`\`\``,
  );
  return `\n\n--- Existing project files (match imports/exports and dependencies) ---\n${parts.join('\n\n')}\n`;
}

// ─── File-specific hints ────────────────────────────────────────────────────

export function buildFileHints(filePath: string): string {
  const name = filePath.split('/').pop()?.toLowerCase() ?? '';
  const _projectContext = getProjectContext();
  const fwk = _projectContext?.framework?.toLowerCase() ?? '';
  const entryPoints = _projectContext?.entryPoints ?? [];
  const hints: string[] = [];

  if (name === 'index.html') {
    const entry = entryPoints.find(e => /main\.(jsx?|tsx?)$/.test(e)) ?? 'src/main.jsx';
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

// ─── Code generation ────────────────────────────────────────────────────────

export function generateCodeWithModel(
  model: ModelConfig,
  prompt: string,
  signal?: AbortSignal,
  contextFiles?: Record<string, string>,
): Promise<string> {
  const storeName = useWorkbenchStore.getState().projectName ?? '';
  const _projectContext = getProjectContext();
  const _envInfo = getEnvInfo();
  const _skillMd = getSkillMd();
  const _installHistoryForCoder = getInstallHistoryForCoder();
  const _webResearchContext = getWebResearchContext();

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

  let memCtx = '';
  try {
    const projectName = useWorkbenchStore.getState().projectName;
    memCtx = useAgentMemoryStore.getState().buildMemoryPrompt(projectName, 1000) || '';
    if (memCtx) memCtx = `\n${memCtx}\n`;
  } catch { /* non-fatal */ }

  let termCtx = '';
  try {
    const block = formatTerminalContextForAgent(useWorkbenchStore.getState().terminalOutput, 4000);
    if (block) termCtx = `\nRECENT WORKBENCH TERMINAL (user-ran commands / installs / builds):\n${block}\n`;
  } catch { /* non-fatal */ }

  const rawScaffoldHint = getScaffoldHint();
  const scaffoldCtx = rawScaffoldHint
    ? `\n\nSCAFFOLD REFERENCE (exact file templates for this stack — follow precisely):\n${rawScaffoldHint}\n`
    : '';

  const userContent = prompt + formatContextFilesBlock(contextFiles);

  return new Promise((resolve, reject) => {
    const messages: ModelRequestMessage[] = [
      {
        role: 'system',
        content: `You are an expert code generator. When asked to write code, respond with ONLY the code content — no markdown fences, no explanations, no comments about what the code does. Just pure, clean, working code. If you must include imports, include them at the top. Make sure the code is complete and ready to use. Write focused, modular code — extract reusable logic into imports rather than inlining everything in one file.

CRITICAL — Tailwind CSS: If writing a CSS file that uses Tailwind, include the proper directives. For Tailwind v4: \`@import "tailwindcss";\`. For Tailwind v3: \`@tailwind base; @tailwind components; @tailwind utilities;\`. If writing vite.config.ts for a Tailwind project, include the @tailwindcss/vite plugin. Without this setup, Tailwind classes produce ZERO styling.${ctxBlock}${envCtx}${skillCtx}${installCtx}${termCtx}${memCtx}${webCtx}${scaffoldCtx}`,
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

export function cleanCodeResponse(text: string): string {
  const fenceMatch = text.match(/```(?:\w*)\n([\s\S]*?)\n```/);
  let code = fenceMatch ? fenceMatch[1].trim() : text.trim();

  const exportMatch = code.match(/(export\s+default\s+\w+;)\s*[>\]}<]/);
  if (exportMatch) {
    const idx = code.indexOf(exportMatch[1]) + exportMatch[1].length;
    code = code.slice(0, idx);
  }

  if (code.length > 200) {
    const mid = Math.floor(code.length * 0.4);
    const firstHalf = code.slice(0, mid);
    const secondHalf = code.slice(mid);
    const sample = firstHalf.slice(0, 100);
    const repeatIdx = secondHalf.indexOf(sample);
    if (repeatIdx !== -1 && repeatIdx < secondHalf.length * 0.7) {
      code = code.slice(0, mid + repeatIdx).trimEnd();
    }
  }

  return code;
}

// ─── Fallback Code Templates ────────────────────────────────────────────────

export function generateFallbackCode(step: PlanStep): string {
  const path = step.path || '';
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const fileName = path.split('/').pop() || '';
  const name = fileName.replace(/\.\w+$/, '') || 'Component';
  const _projectContext = getProjectContext();
  const _projectIdentity = getProjectIdentity();
  const fwk = _projectContext?.framework?.toLowerCase() ?? '';
  const lang = _projectIdentity?.language?.toLowerCase() ?? '';
  const isTS = lang.includes('typescript');

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
