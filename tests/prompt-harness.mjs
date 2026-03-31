#!/usr/bin/env node
/**
 * Code Scout — One-Shot Prompt Test Harness
 *
 * Exercises the SAME pipeline as the IDE (file scan → memory → system prompt → LLM → plan)
 * without Tauri, Zustand, or a browser. Calls the Anthropic API directly.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node tests/prompt-harness.mjs [--dir <path>] [--prompt <text>]
 *
 * Preset tests (no args):
 *   Runs the two reference prompts against a temp Vite+React project.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ──────────────────────────────────────────────────────────────────────────────
// 1. FILE SCANNING — same logic as the IDE's file tree builder
// ──────────────────────────────────────────────────────────────────────────────

const IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  '.turbo', '__pycache__', '.venv', 'target', '.codescout',
]);

function scanDirectory(dirPath, prefix = '') {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const nodes = [];
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const children = scanDirectory(path.join(dirPath, entry.name), rel);
      nodes.push({ name: entry.name, path: rel, type: 'folder', children });
    } else {
      let content = undefined;
      try {
        const size = fs.statSync(path.join(dirPath, entry.name)).size;
        if (size < 80_000) content = fs.readFileSync(path.join(dirPath, entry.name), 'utf-8');
      } catch { /* skip unreadable */ }
      nodes.push({ name: entry.name, path: rel, type: 'file', content });
    }
  }
  return nodes;
}

// ──────────────────────────────────────────────────────────────────────────────
// 2. PROJECT DETECTION — same logic as memoryManager.ts
// ──────────────────────────────────────────────────────────────────────────────

function flattenPaths(nodes) {
  const result = [];
  for (const n of nodes) {
    result.push(n.path);
    if (n.children) result.push(...flattenPaths(n.children));
  }
  return result;
}

function flattenFiles(nodes) {
  const result = [];
  for (const n of nodes) {
    if (n.type === 'file') result.push(n);
    if (n.children) result.push(...flattenFiles(n.children));
  }
  return result;
}

function detectFramework(files) {
  const paths = flattenPaths(files);
  if (paths.some(p => p.includes('next.config'))) return 'Next.js';
  if (paths.some(p => p.includes('vite.config'))) return 'Vite';
  if (paths.some(p => p.includes('nuxt.config'))) return 'Nuxt';
  if (paths.some(p => p.includes('svelte.config'))) return 'SvelteKit';
  if (paths.some(p => p.includes('angular.json'))) return 'Angular';
  if (paths.some(p => p.endsWith('App.tsx') || p.endsWith('App.jsx'))) return 'React (CRA/Vite)';
  if (paths.some(p => p === 'Cargo.toml')) return 'Rust (Cargo)';
  if (paths.some(p => p === 'go.mod')) return 'Go';
  return 'Unknown';
}

function detectPackageManager(files) {
  const paths = flattenPaths(files);
  if (paths.some(p => p === 'bun.lockb' || p === 'bun.lock')) return 'bun';
  if (paths.some(p => p === 'pnpm-lock.yaml')) return 'pnpm';
  if (paths.some(p => p === 'yarn.lock')) return 'yarn';
  if (paths.some(p => p === 'package-lock.json' || p === 'package.json')) return 'npm';
  return 'unknown';
}

function detectLanguage(files) {
  const flat = flattenFiles(files);
  const exts = flat.map(f => f.name.split('.').pop()?.toLowerCase()).filter(Boolean);
  if (exts.includes('tsx') || exts.includes('ts')) return 'TypeScript';
  if (exts.includes('jsx') || exts.includes('js')) return 'JavaScript';
  if (exts.includes('py')) return 'Python';
  if (exts.includes('rs')) return 'Rust';
  if (exts.includes('go')) return 'Go';
  return 'Unknown';
}

function detectEntryPoints(files) {
  const flat = flattenFiles(files);
  const entries = [];
  for (const f of flat) {
    if (/^src\/(main|index)\.(tsx?|jsx?)$/.test(f.path)) entries.push(f.path);
    if (f.path === 'index.html') entries.push(f.path);
  }
  return entries;
}

function extractRunCommands(files) {
  const flat = flattenFiles(files);
  const pkg = flat.find(f => f.name === 'package.json');
  if (!pkg?.content) return {};
  try {
    const json = JSON.parse(pkg.content);
    const scripts = json.scripts || {};
    const cmds = {};
    if (scripts.build) cmds.build = `npm run build`;
    if (scripts.dev) cmds.dev = `npm run dev`;
    if (scripts.start) cmds.start = `npm run start`;
    if (scripts.lint) cmds.lint = `npm run lint`;
    if (scripts.test) cmds.test = `npm run test`;
    return cmds;
  } catch { return {}; }
}

function detectStyling(files) {
  const paths = flattenPaths(files);
  if (paths.some(p => p.includes('tailwind.config'))) return 'TailwindCSS';
  if (paths.some(p => p.endsWith('.module.css') || p.endsWith('.module.scss'))) return 'CSS Modules';
  if (paths.some(p => p.endsWith('.scss'))) return 'SCSS';
  if (paths.some(p => p.endsWith('.css'))) return 'CSS';
  return 'N/A';
}

// ──────────────────────────────────────────────────────────────────────────────
// 3. SYSTEM PROMPT BUILDER — replicates planGenerator.ts + ProjectIdentity
// ──────────────────────────────────────────────────────────────────────────────

const ALWAYS_INLINE_NAMES = new Set([
  'package.json', 'vite.config.ts', 'vite.config.js', 'vite.config.mjs',
  'tsconfig.json', 'tsconfig.app.json', 'index.html', 'cargo.toml',
  'go.mod', 'pyproject.toml', '.env', '.env.example',
]);

function buildFileContext(files) {
  const flat = flattenFiles(files);
  const filePaths = flat.map(f => f.path);
  const inlined = [];
  let totalChars = 0;
  const sorted = [...flat].sort((a, b) => {
    const aP = ALWAYS_INLINE_NAMES.has(a.name.toLowerCase()) ? 0 : 1;
    const bP = ALWAYS_INLINE_NAMES.has(b.name.toLowerCase()) ? 0 : 1;
    return aP - bP;
  });
  for (const f of sorted) {
    if (!f.content) continue;
    if (f.content.length > 80_000) continue;
    if (totalChars > 40_000) break;
    const snippet = f.content.slice(0, 6_000);
    const trunc = f.content.length > 6_000 ? '\n... (truncated)' : '';
    inlined.push(`### ${f.path}\n\`\`\`\n${snippet}${trunc}\n\`\`\``);
    totalChars += snippet.length;
  }
  const pathList = filePaths.slice(0, 120).join('\n') +
    (filePaths.length > 120 ? `\n... and ${filePaths.length - 120} more` : '');
  return inlined.length > 0
    ? `## File tree\n${pathList}\n\n## File contents\n${inlined.join('\n\n')}`
    : `## File tree\n${pathList}`;
}

function buildProjectIdentityBlock(id) {
  const lines = [
    '',
    '╔══════════════════════════════════════════════════════════════╗',
    '║                    PROJECT IDENTITY                         ║',
    '║  These are FACTS about the current project. Obey them.     ║',
    '╚══════════════════════════════════════════════════════════════╝',
  ];
  lines.push(`FRAMEWORK: ${id.framework}`);
  lines.push(`LANGUAGE: ${id.language}`);
  lines.push(`PACKAGE_MANAGER: ${id.packageManager}`);
  if (id.styling) lines.push(`STYLING: ${id.styling}`);
  if (id.entryPoints?.length) lines.push(`ENTRY_POINTS: ${id.entryPoints.join(', ')}`);
  if (id.runCommands) {
    const cmds = Object.entries(id.runCommands).map(([k, v]) => `${k}=${v}`).join(', ');
    lines.push(`SCRIPTS: ${cmds}`);
  }
  if (id.hasExistingProject) {
    lines.push('');
    lines.push('STATUS: PROJECT ALREADY EXISTS — it has source files, config, and dependencies.');
    lines.push('FORBIDDEN ACTIONS:');
    lines.push('  - DO NOT run "npm create vite@latest" or any scaffolding/init command');
    lines.push('  - DO NOT run "npx create-react-app" or "npx create-next-app"');
    lines.push('  - DO NOT create package.json from scratch (it already exists)');
    lines.push('  - DO NOT overwrite vite.config / tsconfig / existing config files');
    lines.push('REQUIRED: Work with the existing project. Create/edit source files only.');
  } else {
    lines.push('');
    lines.push('STATUS: EMPTY PROJECT — no source files yet.');
    lines.push('PREFER: Write files directly with create_file (package.json, index.html, main.jsx, App.jsx, CSS).');
    lines.push('AVOID: Scaffolding commands (npm create vite, npx create-react-app) — they are fragile and may fail.');
  }
  lines.push('');
  return lines.join('\n');
}

function buildSystemPrompt(files, projectName, projectIdentity) {
  const fileContext = buildFileContext(files);
  const flat = flattenFiles(files);
  const hasSourceFiles = flat.some(f => /\.(jsx?|tsx?|py|rs|go)$/.test(f.path));
  const hasPackageJson = flat.some(f => f.name === 'package.json');
  const isEmpty = projectIdentity
    ? !projectIdentity.hasExistingProject
    : (flat.length === 0 || (!hasSourceFiles && !hasPackageJson));

  const scaffoldRules = isEmpty
    ? `IMPORTANT — Empty/new project. ALWAYS prefer writing files directly with create_file. AVOID scaffolding commands.`
    : `This project already has files. Do NOT re-initialize or scaffold from scratch. Do NOT run npm create, npx create-vite, or any scaffolding command.`;

  const shellRules = `Execution context: **Desktop app** — run_command steps run on the user's machine. Prefer file edits when possible. For Node/Vite repos, set validationCommand to **npm run build**. ${scaffoldRules}`;

  const identityBlock = projectIdentity ? buildProjectIdentityBlock(projectIdentity) : '';

  return `You are Code Scout AI, an expert coding assistant that generates structured execution plans.
${identityBlock}
When the user describes what they want to build or change, you MUST respond with ONLY a valid JSON object (no markdown, no code fences, no explanation before or after).

The JSON must follow this exact schema:
{
  "summary": "Brief 1-sentence description of what the plan does",
  "validationCommand": "e.g. npm run build",
  "steps": [
    {
      "action": "create_file" | "edit_file" | "delete_file" | "run_command",
      "path": "relative/path/to/file",
      "description": "What this step does and why",
      "command": "only for run_command actions",
      "diff": { "before": "...", "after": "..." }
    }
  ]
}

${shellRules}

Rules:
- validationCommand is required — use **npm run build** for Vite/npm projects
- action must be one of: create_file, edit_file, delete_file, run_command
- path is required for file actions (relative to project root)
- diff is required for edit_file actions
- Order steps logically (create before edit, install before use)
- Keep plans small: prefer 1-3 steps per plan; at most 8 steps.
- CRITICAL: File paths MUST exactly match the paths listed in the project context / file tree.
- Dev server steps (npm run dev) are fine and will be started in the background.

Project context:
# ${projectName}

## Stack
- Framework: ${projectIdentity?.framework ?? detectFramework(files)}
- Language: ${projectIdentity?.language ?? detectLanguage(files)}
- Package manager: ${projectIdentity?.packageManager ?? detectPackageManager(files)}

${fileContext}

Respond with ONLY the JSON object. No other text.`;
}

// ──────────────────────────────────────────────────────────────────────────────
// 4. ANTHROPIC API CALLER
// ──────────────────────────────────────────────────────────────────────────────

async function callAnthropic(systemPrompt, userMessage, apiKey) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text ?? '';
}

// ──────────────────────────────────────────────────────────────────────────────
// 5. PLAN VALIDATION
// ──────────────────────────────────────────────────────────────────────────────

function extractJSON(text) {
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const raw = fence ? fence[1].trim() : text;
  const m = raw.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

function validatePlan(text, projectIdentity, testName) {
  const issues = [];

  // Parse JSON
  const jsonStr = extractJSON(text);
  if (!jsonStr) {
    issues.push('FAIL: No valid JSON found in response');
    return { pass: false, issues, plan: null };
  }

  let plan;
  try {
    plan = JSON.parse(jsonStr);
  } catch (e) {
    issues.push(`FAIL: JSON parse error: ${e.message}`);
    return { pass: false, issues, plan: null };
  }

  // Check required fields
  if (!plan.summary) issues.push('WARN: Missing summary');
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    issues.push('FAIL: No steps in plan');
    return { pass: false, issues, plan };
  }

  // Check for forbidden scaffolding commands
  if (projectIdentity?.hasExistingProject) {
    for (const step of plan.steps) {
      if (step.action === 'run_command' && step.command) {
        const cmd = step.command.toLowerCase();
        if (cmd.includes('npm create') || cmd.includes('npx create-') ||
            cmd.includes('npm init') || cmd.includes('yarn create')) {
          issues.push(`CRITICAL: Scaffolding command in existing project: "${step.command}"`);
        }
      }
    }
  }

  // Check valid actions
  const validActions = ['create_file', 'edit_file', 'delete_file', 'run_command'];
  for (const step of plan.steps) {
    if (!validActions.includes(step.action)) {
      issues.push(`WARN: Invalid action "${step.action}"`);
    }
    if (step.action !== 'run_command' && !step.path) {
      issues.push(`WARN: File action missing path: ${step.description}`);
    }
  }

  const hasCritical = issues.some(i => i.startsWith('CRITICAL') || i.startsWith('FAIL'));
  return { pass: !hasCritical, issues, plan };
}

// ──────────────────────────────────────────────────────────────────────────────
// 6. TEST FIXTURE — create a minimal Vite+React project
// ──────────────────────────────────────────────────────────────────────────────

function createTestFixture(tmpDir) {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'public'), { recursive: true });

  fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
    name: 'test-landing',
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      preview: 'vite preview',
    },
    dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
    devDependencies: { '@vitejs/plugin-react': '^4.2.0', vite: '^5.0.0' },
  }, null, 2));

  fs.writeFileSync(path.join(tmpDir, 'vite.config.js'), `
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()] })
`.trim());

  fs.writeFileSync(path.join(tmpDir, 'index.html'), `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Test</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>`);

  fs.writeFileSync(path.join(tmpDir, 'src', 'main.jsx'), `
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
`.trim());

  fs.writeFileSync(path.join(tmpDir, 'src', 'App.jsx'), `
function App() {
  return <div><h1>Hello World</h1></div>
}
export default App
`.trim());

  fs.writeFileSync(path.join(tmpDir, 'src', 'index.css'), `
body { margin: 0; font-family: sans-serif; }
`.trim());

  return tmpDir;
}

// ──────────────────────────────────────────────────────────────────────────────
// 7. TEST RUNNER
// ──────────────────────────────────────────────────────────────────────────────

async function runTest(testName, projectDir, userPrompt, apiKey, opts = {}) {
  const divider = '═'.repeat(60);
  console.log(`\n${divider}`);
  console.log(`TEST: ${testName}`);
  console.log(`DIR:  ${projectDir}`);
  console.log(`${divider}`);

  // Scan
  const files = scanDirectory(projectDir);
  const flat = flattenFiles(files);
  console.log(`  Scanned: ${flat.length} files`);

  // Detect
  const framework = detectFramework(files);
  const packageManager = detectPackageManager(files);
  const language = detectLanguage(files);
  const styling = detectStyling(files);
  const entryPoints = detectEntryPoints(files);
  const runCommands = extractRunCommands(files);
  const hasSourceFiles = flat.some(f => /\.(jsx?|tsx?|py|rs|go)$/.test(f.path));
  const hasPackageJson = flat.some(f => f.name === 'package.json');

  const projectIdentity = {
    framework,
    packageManager,
    language,
    styling: styling !== 'N/A' ? styling : undefined,
    entryPoints,
    runCommands,
    hasExistingProject: hasSourceFiles || hasPackageJson,
  };

  console.log(`  Framework: ${framework}`);
  console.log(`  Language:  ${language}`);
  console.log(`  PM:        ${packageManager}`);
  console.log(`  Existing:  ${projectIdentity.hasExistingProject}`);

  // Build prompt
  const projectName = path.basename(projectDir);
  const systemPrompt = buildSystemPrompt(files, projectName, projectIdentity);
  console.log(`  System prompt: ${systemPrompt.length} chars (~${Math.round(systemPrompt.length / 4)} tokens)`);

  if (opts.dumpPrompt) {
    const dumpPath = path.join(process.cwd(), `tests/dump-${testName.replace(/\s+/g, '-').toLowerCase()}.txt`);
    fs.writeFileSync(dumpPath, `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`);
    console.log(`  Prompt dumped to: ${dumpPath}`);
  }

  if (opts.dumpOnly) {
    console.log('  [dump-only mode — skipping API call]');
    return { pass: true, testName, issues: [], plan: null };
  }

  // Call API
  console.log('  Calling Anthropic API...');
  const startTime = Date.now();
  let response;
  try {
    response = await callAnthropic(systemPrompt, userPrompt, apiKey);
  } catch (e) {
    console.log(`  ❌ API call failed: ${e.message}`);
    return { pass: false, testName, error: e.message };
  }
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Response: ${response.length} chars in ${elapsed}s`);

  // Validate
  const result = validatePlan(response, projectIdentity, testName);

  if (result.plan) {
    console.log(`  Plan: "${result.plan.summary}"`);
    console.log(`  Steps: ${result.plan.steps?.length ?? 0}`);
    for (const step of (result.plan.steps ?? [])) {
      const target = step.command ?? step.path ?? '';
      console.log(`    [${step.action}] ${step.description} ${target ? '— ' + target : ''}`);
    }
  }

  if (result.issues.length > 0) {
    console.log('  Issues:');
    for (const issue of result.issues) {
      console.log(`    ${issue}`);
    }
  }

  console.log(result.pass ? '  ✅ PASS' : '  �� FAIL');

  // Save raw response for debugging
  const rawPath = path.join(process.cwd(), `tests/response-${testName.replace(/\s+/g, '-').toLowerCase()}.json`);
  fs.writeFileSync(rawPath, response);

  return { pass: result.pass, testName, issues: result.issues, plan: result.plan };
}

// ──────────────────────────────────────────────────────────────────────────────
// 8. MAIN
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  // Parse CLI args
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const promptIdx = args.indexOf('--prompt');
  const dumpPrompt = args.includes('--dump');
  const dumpOnly = args.includes('--dump-only');

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !dumpOnly) {
    console.error('ERROR: Set ANTHROPIC_API_KEY environment variable (or use --dump-only)');
    process.exit(1);
  }

  if (dirIdx !== -1 && promptIdx !== -1) {
    // Single test mode
    const dir = args[dirIdx + 1];
    const prompt = args[promptIdx + 1];
    if (!dir || !prompt) {
      console.error('Usage: --dir <path> --prompt <text>');
      process.exit(1);
    }
    if (dumpOnly) {
      const result = await runTest('custom', path.resolve(dir), prompt, 'DUMP_ONLY', { dumpPrompt: true, dumpOnly: true });
      process.exit(0);
    }
    const result = await runTest('custom', path.resolve(dir), prompt, apiKey, { dumpPrompt });
    process.exit(result.pass ? 0 : 1);
  }

  if (dumpOnly) {
    // Just dump prompts without calling API
    const tmpDir = path.join(process.cwd(), 'tests/.fixture-vite-react');
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
    createTestFixture(tmpDir);
    console.log(`Fixture created at: ${tmpDir}`);

    // Scan and build identity
    const files = scanDirectory(tmpDir);
    const flat = flattenFiles(files);
    const projectIdentity = {
      framework: detectFramework(files),
      packageManager: detectPackageManager(files),
      language: detectLanguage(files),
      styling: detectStyling(files) !== 'N/A' ? detectStyling(files) : undefined,
      entryPoints: detectEntryPoints(files),
      runCommands: extractRunCommands(files),
      hasExistingProject: flat.some(f => /\.(jsx?|tsx?|py|rs|go)$/.test(f.path)) || flat.some(f => f.name === 'package.json'),
    };

    const systemPrompt = buildSystemPrompt(files, 'test-landing', projectIdentity);
    console.log('\n' + '═'.repeat(60));
    console.log('SYSTEM PROMPT (for existing Vite+React project):');
    console.log('═'.repeat(60));
    console.log(systemPrompt);
    console.log('\n' + '═'.repeat(60));
    console.log(`Total chars: ${systemPrompt.length} (~${Math.round(systemPrompt.length / 4)} tokens)`);
    console.log(`\nProject Identity:`);
    console.log(JSON.stringify(projectIdentity, null, 2));

    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(0);
  }

  // ── Preset tests ──────────────────────────────────────────────────────────

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          Code Scout — One-Shot Prompt Test Suite            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Create temp fixture
  const tmpDir = path.join(process.cwd(), 'tests/.fixture-vite-react');
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
  createTestFixture(tmpDir);
  console.log(`\nFixture created at: ${tmpDir}`);

  const results = [];

  // Test 1: File listing + framework detection
  results.push(await runTest(
    'list-files-framework',
    tmpDir,
    'List the files in the current project directory and tell me what framework this project uses',
    apiKey,
    { dumpPrompt },
  ));

  // Test 2: Landing page creation (the big one)
  results.push(await runTest(
    'create-landing-page',
    tmpDir,
    `Goal:
Create a clean, minimal landing page for a fictional product called "CodeScout" (an AI-powered coding assistant IDE).

Requirements:
- Use React + Vite
- No external UI frameworks (no Tailwind, no Bootstrap)
- Pure CSS or CSS modules only
- Must be responsive
- Clean modern design (dark + light sections)

Sections required:
1. Hero section (headline + subtext + CTA button)
2. Features section (3 features with icons or placeholders)
3. How it works (3 steps)
4. Footer

Technical constraints:
- Must run with: npm install && npm run dev
- No TypeScript
- No external APIs
- No broken imports
- No missing files

Output format:
- Full project structure
- All files (index.html, main.jsx, App.jsx, CSS)
- Exact commands to run`,
    apiKey,
    { dumpPrompt },
  ));

  // Test 3: Landing page on EMPTY project (should NOT scaffold)
  const emptyDir = path.join(process.cwd(), 'tests/.fixture-empty');
  if (fs.existsSync(emptyDir)) fs.rmSync(emptyDir, { recursive: true });
  fs.mkdirSync(emptyDir, { recursive: true });

  results.push(await runTest(
    'empty-project-landing',
    emptyDir,
    `Create a React + Vite landing page for "CodeScout". Include package.json, vite config, index.html, main.jsx, App.jsx, and CSS. Pure CSS only, no TypeScript.`,
    apiKey,
    { dumpPrompt },
  ));

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('SUMMARY');
  console.log('═'.repeat(60));
  let allPass = true;
  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    console.log(`  ${icon} ${r.testName}${r.error ? ` — ${r.error}` : ''}`);
    if (!r.pass) allPass = false;
  }
  console.log('═'.repeat(60));
  console.log(allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(emptyDir, { recursive: true, force: true });

  process.exit(allPass ? 0 : 1);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
