/**
 * Code Scout — Prompt Pipeline Tests
 *
 * Tests the FULL pipeline: file scan → memory → ProjectIdentity → system prompt → plan validation
 * Uses mock LLM responses — no API key needed.
 *
 * Run: npx vitest run src/test/prompt-pipeline.test.ts
 */
import { describe, it, expect } from 'vitest';
import type { FileNode } from '@/store/workbenchStore';

// ─── Test fixtures ───────────────────────────────────────────────────────────

/** Minimal Vite+React project (what the user opens in the IDE) */
function createViteReactFixture(): FileNode[] {
  return [
    {
      name: 'package.json', path: 'package.json', type: 'file',
      content: JSON.stringify({
        name: 'test-landing', private: true, version: '0.0.0', type: 'module',
        scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
        dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
        devDependencies: { '@vitejs/plugin-react': '^4.2.0', vite: '^5.0.0' },
      }, null, 2),
    },
    {
      name: 'vite.config.js', path: 'vite.config.js', type: 'file',
      content: `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\nexport default defineConfig({ plugins: [react()] })`,
    },
    {
      name: 'index.html', path: 'index.html', type: 'file',
      content: `<!doctype html><html><head><title>Test</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`,
    },
    {
      name: 'src', path: 'src', type: 'folder', children: [
        {
          name: 'main.jsx', path: 'src/main.jsx', type: 'file',
          content: `import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App'\nReactDOM.createRoot(document.getElementById('root')).render(<App />)`,
        },
        {
          name: 'App.jsx', path: 'src/App.jsx', type: 'file',
          content: `function App() { return <div><h1>Hello</h1></div> }\nexport default App`,
        },
        {
          name: 'index.css', path: 'src/index.css', type: 'file',
          content: `body { margin: 0; font-family: sans-serif; }`,
        },
      ],
    },
  ];
}

/** Empty project (no files at all) */
function createEmptyFixture(): FileNode[] {
  return [];
}

/** Parent directory that contains the real project in a subfolder */
function createNestedFixture(): FileNode[] {
  return [
    {
      name: 'website', path: 'website', type: 'folder', children: [
        {
          name: 'package.json', path: 'website/package.json', type: 'file',
          content: JSON.stringify({ name: 'website', scripts: { build: 'vite build', dev: 'vite' } }),
        },
        {
          name: 'vite.config.js', path: 'website/vite.config.js', type: 'file',
          content: `export default {}`,
        },
        {
          name: 'src', path: 'website/src', type: 'folder', children: [
            { name: 'App.jsx', path: 'website/src/App.jsx', type: 'file', content: `export default function App() { return <div>Hi</div> }` },
            { name: 'main.jsx', path: 'website/src/main.jsx', type: 'file', content: `import App from './App'` },
          ],
        },
      ],
    },
  ];
}

// ─── Import the functions we're testing ──────────────────────────────────────
// We import from the actual source — these are pure functions with no side effects

import { indexProject } from '@/services/memoryManager';
import { resolveFilePath } from '@/services/agentExecutor';
import { generateMockPlan, type ProjectIdentity } from '@/services/planGenerator';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const result: FileNode[] = [];
  for (const n of nodes) {
    if (n.type === 'file') result.push(n);
    if (n.children) result.push(...flattenFiles(n.children));
  }
  return result;
}

function buildIdentityFromMemory(files: FileNode[], memory: ReturnType<typeof indexProject>): ProjectIdentity {
  const flat = flattenFiles(files);
  const hasSourceFiles = flat.some(f => /\.(jsx?|tsx?|py|rs|go)$/.test(f.path));
  const hasPackageJson = flat.some(f => f.name === 'package.json');
  return {
    framework: memory.repoMap.framework,
    packageManager: memory.repoMap.packageManager,
    language: memory.repoMap.primaryLanguage,
    styling: memory.conventions.styling !== 'N/A' ? memory.conventions.styling : undefined,
    entryPoints: memory.repoMap.entryPoints,
    runCommands: memory.repoMap.runCommands,
    hasExistingProject: hasSourceFiles || hasPackageJson,
  };
}

// Mock plan responses (what an LLM would return)

const GOOD_PLAN_EXISTING_PROJECT = JSON.stringify({
  summary: 'Create a CodeScout landing page with hero, features, how-it-works, and footer sections',
  validationCommand: 'npm run build',
  steps: [
    { action: 'create_file', path: 'src/components/Hero.jsx', description: 'Create Hero section component' },
    { action: 'create_file', path: 'src/components/Features.jsx', description: 'Create Features section component' },
    { action: 'create_file', path: 'src/components/HowItWorks.jsx', description: 'Create How It Works section' },
    { action: 'create_file', path: 'src/components/Footer.jsx', description: 'Create Footer component' },
    { action: 'create_file', path: 'src/App.css', description: 'Create CSS styles for all sections' },
    { action: 'edit_file', path: 'src/App.jsx', description: 'Import and compose all landing page sections', diff: { before: 'function App() { return <div><h1>Hello</h1></div> }', after: 'import Hero from...' } },
  ],
});

const BAD_PLAN_SCAFFOLDS_EXISTING = JSON.stringify({
  summary: 'Initialize and create landing page',
  validationCommand: 'npm run build',
  steps: [
    { action: 'run_command', command: 'npm create vite@latest . -- --template react', description: 'Initialize Vite project' },
    { action: 'edit_file', path: 'src/App.jsx', description: 'Update App component', diff: { before: '...', after: '...' } },
  ],
});

const GOOD_PLAN_EMPTY_PROJECT = JSON.stringify({
  summary: 'Create a complete React + Vite landing page from scratch',
  validationCommand: 'npm run build',
  steps: [
    { action: 'create_file', path: 'package.json', description: 'Create package.json with React and Vite dependencies' },
    { action: 'create_file', path: 'vite.config.js', description: 'Create Vite configuration' },
    { action: 'create_file', path: 'index.html', description: 'Create HTML entry point' },
    { action: 'create_file', path: 'src/main.jsx', description: 'Create React entry point' },
    { action: 'create_file', path: 'src/App.jsx', description: 'Create App component with landing page' },
    { action: 'create_file', path: 'src/App.css', description: 'Create styles' },
    { action: 'run_command', command: 'npm install', description: 'Install dependencies' },
  ],
});

const BAD_PLAN_WRONG_COMMANDS = JSON.stringify({
  summary: 'Create landing page',
  validationCommand: 'npm run build',
  steps: [
    { action: 'run_command', command: 'npx create-react-app .', description: 'Scaffold project' },
    { action: 'edit_file', path: 'src/App.js', description: 'Edit app', diff: { before: '...', after: '...' } },
  ],
});

// ─── Plan validator (same logic as test harness) ─────────────────────────────

function validatePlan(planJson: string, identity: ProjectIdentity) {
  const issues: string[] = [];
  let plan: any;

  // Extract JSON
  const fenceMatch = planJson.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  const raw = fenceMatch ? fenceMatch[1].trim() : planJson;
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { pass: false, issues: ['No JSON found'], plan: null };

  try {
    plan = JSON.parse(jsonMatch[0]);
  } catch (e: any) {
    return { pass: false, issues: [`JSON parse error: ${e.message}`], plan: null };
  }

  if (!plan.summary) issues.push('Missing summary');
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    return { pass: false, issues: ['No steps'], plan };
  }

  // Check for forbidden scaffolding commands in existing projects
  if (identity.hasExistingProject) {
    for (const step of plan.steps) {
      if (step.action === 'run_command' && step.command) {
        const cmd = step.command.toLowerCase();
        if (cmd.includes('npm create') || cmd.includes('npx create-') ||
            cmd.includes('npm init') || cmd.includes('yarn create') ||
            cmd.includes('bun create')) {
          issues.push(`CRITICAL: Scaffolding command in existing project: "${step.command}"`);
        }
      }
    }
  }

  // Check valid actions
  const validActions = ['create_file', 'edit_file', 'delete_file', 'run_command'];
  for (const step of plan.steps) {
    if (!validActions.includes(step.action)) {
      issues.push(`Invalid action: ${step.action}`);
    }
    if (step.action !== 'run_command' && !step.path) {
      issues.push(`File action missing path: ${step.description}`);
    }
  }

  const hasCritical = issues.some(i => i.startsWith('CRITICAL'));
  return { pass: !hasCritical, issues, plan };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Project Detection', () => {
  it('detects Vite framework from vite.config.js', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-project');
    expect(memory.repoMap.framework).toBe('React + Vite');
  });

  it('detects npm package manager from package.json', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-project');
    expect(memory.repoMap.packageManager).toBe('npm');
  });

  it('detects JavaScript language from .jsx files', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-project');
    expect(memory.repoMap.primaryLanguage).toBe('JavaScript');
  });

  it('detects entry points', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-project');
    expect(memory.repoMap.entryPoints).toContain('src/main.jsx');
  });

  it('extracts run commands from package.json', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-project');
    expect(memory.repoMap.runCommands.build).toBeTruthy();
    expect(memory.repoMap.runCommands.dev).toBeTruthy();
  });

  it('returns Unknown for empty project', () => {
    const files = createEmptyFixture();
    const memory = indexProject(files, 'empty-project');
    expect(memory.repoMap.framework).toBe('Unknown');
  });

  it('detects framework in nested project', () => {
    const files = createNestedFixture();
    const memory = indexProject(files, 'parent-dir');
    expect(memory.repoMap.framework).toBe('React + Vite');
  });
});

describe('ProjectIdentity building', () => {
  it('marks existing Vite project as hasExistingProject=true', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-project');
    const identity = buildIdentityFromMemory(files, memory);
    expect(identity.hasExistingProject).toBe(true);
    expect(identity.framework).toBe('React + Vite');
    expect(identity.packageManager).toBe('npm');
  });

  it('marks empty project as hasExistingProject=false', () => {
    const files = createEmptyFixture();
    const memory = indexProject(files, 'empty-project');
    const identity = buildIdentityFromMemory(files, memory);
    expect(identity.hasExistingProject).toBe(false);
  });
});

describe('skillMd content', () => {
  it('includes framework in skillMd', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-project');
    expect(memory.skillMd).toContain('Framework: React + Vite');
  });

  it('includes package manager in skillMd', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-project');
    expect(memory.skillMd).toContain('npm');
  });

  it('includes file tree with correct paths', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-project');
    expect(memory.skillMd).toContain('src/App.jsx');
    expect(memory.skillMd).toContain('src/main.jsx');
    expect(memory.skillMd).toContain('package.json');
  });

  it('includes IMPORTANT rules section', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-project');
    expect(memory.skillMd).toContain('## IMPORTANT');
  });
});

describe('Plan validation — existing project', () => {
  const files = createViteReactFixture();
  const memory = indexProject(files, 'test-project');
  const identity = buildIdentityFromMemory(files, memory);

  it('accepts a good plan that only creates/edits files', () => {
    const result = validatePlan(GOOD_PLAN_EXISTING_PROJECT, identity);
    expect(result.pass).toBe(true);
    expect(result.issues.filter(i => i.startsWith('CRITICAL'))).toHaveLength(0);
  });

  it('REJECTS a plan that runs npm create vite on existing project', () => {
    const result = validatePlan(BAD_PLAN_SCAFFOLDS_EXISTING, identity);
    expect(result.pass).toBe(false);
    expect(result.issues.some(i => i.includes('CRITICAL') && i.includes('npm create vite'))).toBe(true);
  });

  it('REJECTS a plan that runs npx create-react-app on existing project', () => {
    const result = validatePlan(BAD_PLAN_WRONG_COMMANDS, identity);
    expect(result.pass).toBe(false);
    expect(result.issues.some(i => i.includes('CRITICAL') && i.includes('npx create-react-app'))).toBe(true);
  });

  it('validates plan has correct structure', () => {
    const result = validatePlan(GOOD_PLAN_EXISTING_PROJECT, identity);
    expect(result.plan).not.toBeNull();
    expect(result.plan.summary).toBeTruthy();
    expect(result.plan.steps.length).toBeGreaterThan(0);
    expect(result.plan.validationCommand).toBe('npm run build');
  });
});

describe('Plan validation — empty project', () => {
  const identity: ProjectIdentity = {
    framework: 'Unknown',
    packageManager: 'unknown',
    language: 'Unknown',
    hasExistingProject: false,
  };

  it('accepts a plan that creates files from scratch', () => {
    const result = validatePlan(GOOD_PLAN_EMPTY_PROJECT, identity);
    expect(result.pass).toBe(true);
  });

  it('accepts npm install in empty project (needed for dependencies)', () => {
    const result = validatePlan(GOOD_PLAN_EMPTY_PROJECT, identity);
    const installStep = result.plan?.steps?.find((s: any) => s.command?.includes('npm install'));
    expect(installStep).toBeTruthy();
    expect(result.pass).toBe(true);
  });
});

describe('Plan validation — edge cases', () => {
  const identity: ProjectIdentity = {
    framework: 'Vite', packageManager: 'npm', language: 'JavaScript', hasExistingProject: true,
  };

  it('handles invalid JSON gracefully', () => {
    const result = validatePlan('not json at all', identity);
    expect(result.pass).toBe(false);
    expect(result.issues).toContain('No JSON found');
  });

  it('handles empty steps array', () => {
    const result = validatePlan(JSON.stringify({ summary: 'test', steps: [] }), identity);
    expect(result.pass).toBe(false);
  });

  it('handles JSON wrapped in markdown fences', () => {
    const wrapped = '```json\n' + GOOD_PLAN_EXISTING_PROJECT + '\n```';
    const result = validatePlan(wrapped, identity);
    expect(result.pass).toBe(true);
  });

  it('handles plan with extra text before JSON', () => {
    const withPreamble = 'Here is the plan:\n' + GOOD_PLAN_EXISTING_PROJECT;
    const result = validatePlan(withPreamble, identity);
    expect(result.pass).toBe(true);
  });
});

describe('One-shot prompt: "List files and tell me what framework"', () => {
  it('memory system produces correct info for a Vite+React project', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-landing');
    const identity = buildIdentityFromMemory(files, memory);

    // The agent should be able to answer this from context alone
    expect(identity.framework).toBe('React + Vite');
    expect(identity.language).toBe('JavaScript');
    expect(identity.hasExistingProject).toBe(true);

    // Verify the file list is in skillMd
    expect(memory.skillMd).toContain('package.json');
    expect(memory.skillMd).toContain('vite.config.js');
    expect(memory.skillMd).toContain('src/App.jsx');
    expect(memory.skillMd).toContain('src/main.jsx');
    expect(memory.skillMd).toContain('src/index.css');
    expect(memory.skillMd).toContain('index.html');
  });
});

describe('One-shot prompt: "Create CodeScout landing page"', () => {
  it('identity correctly identifies existing Vite+React+JSX project', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-landing');
    const identity = buildIdentityFromMemory(files, memory);

    expect(identity.framework).toBe('React + Vite');
    expect(identity.packageManager).toBe('npm');
    expect(identity.language).toBe('JavaScript');
    expect(identity.hasExistingProject).toBe(true);
    expect(identity.entryPoints).toContain('src/main.jsx');
  });

  it('good landing page plan passes validation', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-landing');
    const identity = buildIdentityFromMemory(files, memory);
    const result = validatePlan(GOOD_PLAN_EXISTING_PROJECT, identity);

    expect(result.pass).toBe(true);
    expect(result.plan.steps.length).toBeGreaterThanOrEqual(3);
    // All file steps should create new components, not scaffold
    const fileSteps = result.plan.steps.filter((s: any) => s.action === 'create_file');
    expect(fileSteps.length).toBeGreaterThanOrEqual(3);
  });

  it('scaffolding plan is REJECTED for existing project', () => {
    const files = createViteReactFixture();
    const memory = indexProject(files, 'test-landing');
    const identity = buildIdentityFromMemory(files, memory);
    const result = validatePlan(BAD_PLAN_SCAFFOLDS_EXISTING, identity);

    expect(result.pass).toBe(false);
    expect(result.issues.some(i => i.includes('CRITICAL'))).toBe(true);
  });
});

// ─── Path resolver tests ─────────────────────────────────────────────────────

describe('Path resolver — resolveFilePath (root-level project)', () => {
  // Files at project root (no subdirectory prefix)
  const fileStore: Record<string, string> = {
    'src/App.jsx': '<App/>',
    'src/main.jsx': 'import App',
    'src/index.css': 'body {}',
    'src/components/Feature.tsx': 'export const Feature = () => {}',
    'index.html': '<html>',
    'package.json': '{}',
    'vite.config.ts': 'export default {}',
  };
  const getContent = (p: string) => fileStore[p];
  const allFiles = Object.keys(fileStore).map(p => ({ path: p, name: p.split('/').pop()! }));

  it('returns exact path when it exists', () => {
    const { resolved, changed } = resolveFilePath('src/App.jsx', getContent, allFiles);
    expect(resolved).toBe('src/App.jsx');
    expect(changed).toBe(false);
  });

  it('fixes doubled prefix: src/src/components/Feature.tsx → src/components/Feature.tsx', () => {
    const { resolved, changed } = resolveFilePath('src/src/components/Feature.tsx', getContent, allFiles);
    expect(resolved).toBe('src/components/Feature.tsx');
    expect(changed).toBe(true);
  });

  it('strips leading project name: myproject/src/App.jsx → src/App.jsx', () => {
    const { resolved, changed } = resolveFilePath('myproject/src/App.jsx', getContent, allFiles);
    expect(resolved).toBe('src/App.jsx');
    expect(changed).toBe(true);
  });

  it('resolves .js → .ts extension: vite.config.js → vite.config.ts', () => {
    const { resolved, changed } = resolveFilePath('vite.config.js', getContent, allFiles);
    expect(resolved).toBe('vite.config.ts');
    expect(changed).toBe(true);
  });

  it('resolves .jsx → .tsx extension: src/components/Feature.jsx → src/components/Feature.tsx', () => {
    const { resolved, changed } = resolveFilePath('src/components/Feature.jsx', getContent, allFiles);
    expect(resolved).toBe('src/components/Feature.tsx');
    expect(changed).toBe(true);
  });

  it('resolves .js → .jsx when needed: src/main.js → src/main.jsx', () => {
    const { resolved, changed } = resolveFilePath('src/main.js', getContent, allFiles);
    expect(resolved).toBe('src/main.jsx');
    expect(changed).toBe(true);
  });

  it('finds file by basename when path is wrong: components/Feature.tsx → src/components/Feature.tsx', () => {
    const { resolved, changed } = resolveFilePath('components/Feature.tsx', getContent, allFiles);
    expect(resolved).toBe('src/components/Feature.tsx');
    expect(changed).toBe(true);
  });

  it('resolves src/index.html → index.html (strip wrong prefix)', () => {
    const { resolved, changed } = resolveFilePath('src/index.html', getContent, allFiles);
    expect(resolved).toBe('index.html');
    expect(changed).toBe(true);
  });
});

describe('Path resolver — NESTED project (user opens parent dir)', () => {
  // THE CRITICAL CASE: user opens WEBSITE/, project is in WEBSITE/website/
  // Store paths all start with "website/"
  const fileStore: Record<string, string> = {
    'website/src/App.jsx': '<App/>',
    'website/src/main.jsx': 'import App',
    'website/src/index.css': 'body {}',
    'website/index.html': '<html>',
    'website/package.json': '{}',
    'website/vite.config.js': 'export default {}',
  };
  const getContent = (p: string) => fileStore[p];
  const allFiles = Object.keys(fileStore).map(p => ({ path: p, name: p.split('/').pop()! }));

  it('adds project prefix: src/App.jsx → website/src/App.jsx', () => {
    const { resolved, changed } = resolveFilePath('src/App.jsx', getContent, allFiles);
    expect(resolved).toBe('website/src/App.jsx');
    expect(changed).toBe(true);
  });

  it('adds project prefix: index.html → website/index.html', () => {
    const { resolved, changed } = resolveFilePath('index.html', getContent, allFiles);
    expect(resolved).toBe('website/index.html');
    expect(changed).toBe(true);
  });

  it('adds project prefix: package.json → website/package.json', () => {
    const { resolved, changed } = resolveFilePath('package.json', getContent, allFiles);
    expect(resolved).toBe('website/package.json');
    expect(changed).toBe(true);
  });

  it('fixes doubled prefix + adds project prefix: src/src/App.jsx → website/src/App.jsx', () => {
    const { resolved, changed } = resolveFilePath('src/src/App.jsx', getContent, allFiles);
    expect(resolved).toBe('website/src/App.jsx');
    expect(changed).toBe(true);
  });

  it('resolves src/index.html → website/index.html (strip src/, add project prefix)', () => {
    const { resolved, changed } = resolveFilePath('src/index.html', getContent, allFiles);
    expect(resolved).toBe('website/index.html');
    expect(changed).toBe(true);
  });

  it('exact match still works: website/src/App.jsx → website/src/App.jsx', () => {
    const { resolved, changed } = resolveFilePath('website/src/App.jsx', getContent, allFiles);
    expect(resolved).toBe('website/src/App.jsx');
    expect(changed).toBe(false);
  });

  it('handles create_file with new path: src/components/Hero.jsx → website/src/components/Hero.jsx', () => {
    // New file — doesn't exist in store. Resolver should still add the prefix.
    const { resolved, changed } = resolveFilePath('src/components/Hero.jsx', getContent, allFiles);
    expect(resolved).toBe('website/src/components/Hero.jsx');
    expect(changed).toBe(true);
  });
});

describe('Path resolver — NESTED project WITH .codescout/ (production scenario)', () => {
  // THE REAL PRODUCTION CASE: user opens WEBSITE/, .codescout/ exists alongside website/
  // This previously broke detectFileTreePrefix because .codescout != website
  const fileStore: Record<string, string> = {
    '.codescout/project.json': '{"framework":"Vite"}',
    'website/src/App.jsx': '<App/>',
    'website/src/main.jsx': 'import App',
    'website/src/index.css': 'body {}',
    'website/index.html': '<html>',
    'website/package.json': '{"scripts":{"build":"vite build"}}',
    'website/vite.config.js': 'export default {}',
  };
  const getContent = (p: string) => fileStore[p];
  const allFiles = Object.keys(fileStore).map(p => ({ path: p, name: p.split('/').pop()! }));

  it('detects website/ prefix despite .codescout/ being present', () => {
    const { resolved, changed } = resolveFilePath('src/App.jsx', getContent, allFiles);
    expect(resolved).toBe('website/src/App.jsx');
    expect(changed).toBe(true);
  });

  it('fixes src/src/main.jsx → website/src/main.jsx with .codescout present', () => {
    const { resolved, changed } = resolveFilePath('src/src/main.jsx', getContent, allFiles);
    expect(resolved).toBe('website/src/main.jsx');
    expect(changed).toBe(true);
  });

  it('fixes index.html → website/index.html with .codescout present', () => {
    const { resolved, changed } = resolveFilePath('index.html', getContent, allFiles);
    expect(resolved).toBe('website/index.html');
    expect(changed).toBe(true);
  });

  it('exact match on .codescout path still works', () => {
    const { resolved, changed } = resolveFilePath('.codescout/project.json', getContent, allFiles);
    expect(resolved).toBe('.codescout/project.json');
    expect(changed).toBe(false);
  });

  it('handles create_file for new file with .codescout present', () => {
    const { resolved, changed } = resolveFilePath('src/components/Feature.tsx', getContent, allFiles);
    expect(resolved).toBe('website/src/components/Feature.tsx');
    expect(changed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Mock Plan Generation
// ═══════════════════════════════════════════════════════════════════════════════

describe('generateMockPlan — component naming', () => {
  it('extracts clean name from "build a landing page" (no commas/garbage)', () => {
    const plan = generateMockPlan(
      'Create a clean, minimal landing page for CodeScout',
      { framework: 'Vite', packageManager: 'npm', language: 'JavaScript', hasExistingProject: true },
    );
    // Component name should NOT contain commas or garbage
    for (const step of plan.steps) {
      if (step.path) {
        expect(step.path).not.toContain(',');
        expect(step.path).not.toContain(' ');
      }
    }
  });

  it('uses .jsx extension for JavaScript projects', () => {
    const plan = generateMockPlan(
      'Create a landing page component',
      { framework: 'Vite', packageManager: 'npm', language: 'JavaScript', hasExistingProject: true },
    );
    const createSteps = plan.steps.filter(s => s.action === 'create_file');
    for (const step of createSteps) {
      expect(step.path).toMatch(/\.jsx$/);
      expect(step.path).not.toMatch(/\.tsx$/);
    }
  });

  it('uses .tsx extension for TypeScript projects', () => {
    const plan = generateMockPlan(
      'Create a landing page component',
      { framework: 'Vite', packageManager: 'npm', language: 'TypeScript', hasExistingProject: true },
    );
    const createSteps = plan.steps.filter(s => s.action === 'create_file');
    for (const step of createSteps) {
      expect(step.path).toMatch(/\.tsx$/);
    }
  });

  it('does NOT add form validation libraries for a landing page', () => {
    const plan = generateMockPlan(
      'Create a landing page with hero, features, and footer sections. Pure CSS, no external UI frameworks.',
      { framework: 'Vite', packageManager: 'npm', language: 'JavaScript', hasExistingProject: true },
    );
    const runSteps = plan.steps.filter(s => s.action === 'run_command');
    for (const step of runSteps) {
      expect(step.command).not.toContain('react-hook-form');
      expect(step.command).not.toContain('zod');
    }
  });
});

describe('generateMockPlan — nested project paths', () => {
  const nestedFiles = createNestedFixture();
  const identity: ProjectIdentity = {
    framework: 'Vite',
    packageManager: 'npm',
    language: 'JavaScript',
    entryPoints: ['website/src/main.jsx', 'website/src/App.jsx'],
    runCommands: { build: 'vite build', dev: 'vite' },
    hasExistingProject: true,
  };

  it('adds website/ prefix to created file paths', () => {
    const plan = generateMockPlan('Create a landing page', identity, nestedFiles);
    const createSteps = plan.steps.filter(s => s.action === 'create_file');
    for (const step of createSteps) {
      expect(step.path).toMatch(/^website\//);
    }
  });

  it('uses correct App path for edit step', () => {
    const plan = generateMockPlan('Create a landing page', identity, nestedFiles);
    const editSteps = plan.steps.filter(s => s.action === 'edit_file');
    const appEdit = editSteps.find(s => s.path?.includes('App'));
    expect(appEdit?.path).toMatch(/^website\/src\/App\.jsx$/);
  });

  it('handles .codescout in file tree without breaking prefix detection', () => {
    // Add .codescout to the fixture
    const filesWithCodescout: FileNode[] = [
      { name: '.codescout', path: '.codescout', type: 'folder', children: [
        { name: 'project.json', path: '.codescout/project.json', type: 'file', content: '{}' },
      ]},
      ...nestedFiles,
    ];
    const plan = generateMockPlan('Create a landing page', identity, filesWithCodescout);
    const createSteps = plan.steps.filter(s => s.action === 'create_file');
    for (const step of createSteps) {
      expect(step.path).toMatch(/^website\//);
      expect(step.path).not.toContain('src/src/');
    }
  });

  it('summary indicates it is a mock plan', () => {
    const plan = generateMockPlan('Create something', identity, nestedFiles);
    expect(plan.summary.toLowerCase()).toContain('mock');
  });
});
