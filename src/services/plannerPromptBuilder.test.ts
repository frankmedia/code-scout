/**
 * Planner Prompt Builder Tests
 *
 * Snapshot-like tests for buildSystemPrompt and buildFileContext to prevent
 * regressions when prompt text is changed.  These tests ensure the small-LLM
 * contract (modular file guidance, size limits, project identity block) stays
 * present after refactoring.
 *
 * Run: npx vitest run src/services/plannerPromptBuilder.test.ts
 */

import { describe, it, expect } from 'vitest';
import type { FileNode } from '@/store/workbenchStore';
import {
  buildSystemPrompt,
  buildFileContext,
  buildProjectIdentityBlock,
  flattenFiles,
  shouldInlineFile,
  type ProjectIdentity,
} from './plannerPromptBuilder';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const minimalProject: FileNode[] = [
  { name: 'package.json', path: 'package.json', type: 'file', content: '{"name":"demo"}' },
  { name: 'src', path: 'src', type: 'folder', children: [
    { name: 'App.tsx', path: 'src/App.tsx', type: 'file', content: 'export default function App() { return null; }' },
    { name: 'index.ts', path: 'src/index.ts', type: 'file', content: "import App from './App'; export default App;" },
  ]},
];

const identity: ProjectIdentity = {
  framework: 'vite-react',
  language: 'typescript',
  packageManager: 'npm',
  hasExistingProject: true,
};

// ─── flattenFiles ─────────────────────────────────────────────────────────────

describe('flattenFiles', () => {
  it('extracts all file nodes from a nested tree', () => {
    const flat = flattenFiles(minimalProject);
    expect(flat.map(f => f.path).sort()).toEqual(['package.json', 'src/App.tsx', 'src/index.ts']);
  });

  it('returns empty array for empty tree', () => {
    expect(flattenFiles([])).toEqual([]);
  });
});

// ─── shouldInlineFile ──────────────────────────────────────────────────────────

describe('shouldInlineFile', () => {
  it('inlines .tsx files', () => {
    const node: FileNode = { name: 'App.tsx', path: 'src/App.tsx', type: 'file', content: 'code' };
    expect(shouldInlineFile(node)).toBe(true);
  });

  it('inlines package.json', () => {
    const node: FileNode = { name: 'package.json', path: 'package.json', type: 'file', content: '{}' };
    expect(shouldInlineFile(node)).toBe(true);
  });

  it('does not inline files without content', () => {
    const node: FileNode = { name: 'App.tsx', path: 'src/App.tsx', type: 'file' };
    expect(shouldInlineFile(node)).toBe(false);
  });

  it('does not inline very large files', () => {
    const node: FileNode = {
      name: 'big.ts', path: 'big.ts', type: 'file',
      content: 'x'.repeat(81_000),
    };
    expect(shouldInlineFile(node)).toBe(false);
  });
});

// ─── buildFileContext ─────────────────────────────────────────────────────────

describe('buildFileContext', () => {
  it('includes File tree heading', () => {
    const ctx = buildFileContext(minimalProject);
    expect(ctx).toContain('## File tree');
  });

  it('lists all file paths', () => {
    const ctx = buildFileContext(minimalProject);
    expect(ctx).toContain('package.json');
    expect(ctx).toContain('src/App.tsx');
    expect(ctx).toContain('src/index.ts');
  });

  it('includes file contents section for source files', () => {
    const ctx = buildFileContext(minimalProject);
    expect(ctx).toContain('## File contents');
  });

  it('handles empty tree', () => {
    const ctx = buildFileContext([]);
    expect(ctx).toContain('## File tree');
  });
});

// ─── buildProjectIdentityBlock ────────────────────────────────────────────────

describe('buildProjectIdentityBlock', () => {
  it('includes FRAMEWORK', () => {
    const block = buildProjectIdentityBlock(identity, 'my-app');
    expect(block).toContain('FRAMEWORK: vite-react');
  });

  it('includes project name warning', () => {
    const block = buildProjectIdentityBlock(identity, 'my-app');
    expect(block).toContain('my-app');
  });

  it('shows existing project status', () => {
    const block = buildProjectIdentityBlock({ ...identity, hasExistingProject: true }, 'app');
    expect(block).toContain('PROJECT ALREADY EXISTS');
  });

  it('shows empty project status', () => {
    const block = buildProjectIdentityBlock({ ...identity, hasExistingProject: false }, 'app');
    expect(block).toContain('EMPTY PROJECT');
  });
});

// ─── buildSystemPrompt contract tests ─────────────────────────────────────────

describe('buildSystemPrompt — small-LLM contract', () => {
  it('contains PREFER MODULAR FILES rule', () => {
    const p = buildSystemPrompt(minimalProject, 'demo', undefined, true);
    expect(p).toMatch(/PREFER MODULAR FILES/i);
  });

  it('mentions 200 lines limit', () => {
    const p = buildSystemPrompt(minimalProject, 'demo', undefined, true);
    expect(p).toContain('200 lines');
  });

  it('prohibits run_command with cd projectName', () => {
    const p = buildSystemPrompt(minimalProject, 'demo', undefined, true);
    expect(p).toContain('NEVER start a run_command with "cd demo"');
  });

  it('uses shellCapable flag to set execution context', () => {
    const desktop = buildSystemPrompt(minimalProject, 'demo', undefined, true);
    const browser = buildSystemPrompt(minimalProject, 'demo', undefined, false);
    expect(desktop).toContain('Desktop app');
    expect(browser).toContain('Browser');
  });

  it('includes project identity block when identity is provided', () => {
    const p = buildSystemPrompt(minimalProject, 'demo', undefined, true, undefined, identity);
    expect(p).toContain('PROJECT IDENTITY');
  });

  it('does not include project identity block when no identity', () => {
    const p = buildSystemPrompt(minimalProject, 'demo', undefined, true);
    expect(p).not.toContain('PROJECT IDENTITY');
  });

  it('includes install history when provided', () => {
    const p = buildSystemPrompt(minimalProject, 'demo', undefined, true, undefined, undefined, '## Install history\nnpm install react');
    expect(p).toContain('npm install react');
  });

  it('includes terminal context when provided', () => {
    const p = buildSystemPrompt(minimalProject, 'demo', undefined, true, undefined, undefined, undefined, undefined, 'npm run build\n✓ Built in 1.2s');
    expect(p).toContain('npm run build');
  });
});
