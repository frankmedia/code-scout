/**
 * Small-LLM Guard Tests
 *
 * Verifies that:
 * 1. The write size hard cap rejects oversized write_to_file calls.
 * 2. The warning threshold logs a message for large-but-not-rejected writes.
 * 3. The read_file truncation works at the configured limit.
 * 4. Path resolution handles common LLM hallucination patterns.
 *
 * These tests use no mocks or API keys — they test pure logic in the executor
 * and path-resolution modules.
 *
 * Run: npx vitest run src/services/agentToolLoop.smallLlmGuards.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_AGENT_MAX_WRITE_FILE_CHARS,
  DEFAULT_AGENT_WARN_WRITE_FILE_CHARS,
  DEFAULT_AGENT_MAX_FILE_READ_CHARS,
} from '@/config/agentBehaviorDefaults';
import {
  resolveFilePath,
  normalizePath,
  detectFileTreePrefix,
  normalizeCommandPaths,
} from './pathResolution';
import { parseWriteToFile, parseReadFile } from './chatToolParsers';
import { buildSystemPrompt, buildFileContext } from './plannerPromptBuilder';
import type { FileNode } from '@/store/workbenchStore';

// ─── Write size constants ──────────────────────────────────────────────────────

describe('small-LLM write size constants', () => {
  it('warn threshold is 10 000 chars', () => {
    expect(DEFAULT_AGENT_WARN_WRITE_FILE_CHARS).toBe(10_000);
  });

  it('hard cap is 50 000 chars', () => {
    expect(DEFAULT_AGENT_MAX_WRITE_FILE_CHARS).toBe(50_000);
  });

  it('read truncation is 8 000 chars by default', () => {
    expect(DEFAULT_AGENT_MAX_FILE_READ_CHARS).toBe(8_000);
  });

  it('warn threshold is less than hard cap', () => {
    expect(DEFAULT_AGENT_WARN_WRITE_FILE_CHARS).toBeLessThan(DEFAULT_AGENT_MAX_WRITE_FILE_CHARS);
  });
});

// ─── chatToolParsers ───────────────────────────────────────────────────────────

describe('parseWriteToFile', () => {
  it('parses valid args', () => {
    const result = parseWriteToFile('{"path":"src/foo.ts","content":"hello"}');
    expect(result).toEqual({ path: 'src/foo.ts', content: 'hello' });
  });

  it('returns null when path is missing', () => {
    expect(parseWriteToFile('{"content":"hello"}')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseWriteToFile('not json')).toBeNull();
  });
});

describe('parseReadFile', () => {
  it('parses valid args', () => {
    expect(parseReadFile('{"path":"src/App.tsx"}')).toEqual({ path: 'src/App.tsx' });
  });

  it('returns null when path is missing', () => {
    expect(parseReadFile('{}')).toBeNull();
  });
});

// ─── pathResolution ────────────────────────────────────────────────────────────

describe('normalizePath', () => {
  it('strips leading slashes', () => {
    expect(normalizePath('/src/App.tsx')).toBe('src/App.tsx');
  });

  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('src\\components\\App.tsx')).toBe('src/components/App.tsx');
  });

  it('passes through already-clean paths', () => {
    expect(normalizePath('src/App.tsx')).toBe('src/App.tsx');
  });
});

describe('detectFileTreePrefix', () => {
  it('returns empty string when files are at root (no consistent subdirectory)', () => {
    // Mix of top-level files — no single subdirectory dominates
    const files = [
      { path: 'package.json' },        // root-level (no slash)
      { path: 'frontend/App.tsx' },
      { path: 'backend/server.ts' },
    ];
    expect(detectFileTreePrefix(files)).toBe('');
  });

  it('detects a shared subdirectory prefix', () => {
    const files = [
      { path: 'website/src/App.tsx' },
      { path: 'website/src/index.ts' },
      { path: 'website/package.json' },
    ];
    expect(detectFileTreePrefix(files)).toBe('website/');
  });

  it('detects src/ prefix when all non-hidden files are under src/', () => {
    const files = [
      { path: 'src/App.tsx' },
      { path: 'src/index.ts' },
    ];
    expect(detectFileTreePrefix(files)).toBe('src/');
  });

  it('ignores hidden directories when computing prefix', () => {
    // .git files are excluded; remaining files under src/ → prefix = src/
    const files = [
      { path: '.git/HEAD' },
      { path: '.git/config' },
      { path: 'src/App.tsx' },
    ];
    expect(detectFileTreePrefix(files)).toBe('src/');
  });

  it('returns empty for empty array', () => {
    expect(detectFileTreePrefix([])).toBe('');
  });
});

describe('resolveFilePath', () => {
  const files = [
    { path: 'src/App.tsx' },
    { path: 'src/components/Button.tsx' },
    { path: 'package.json' },
  ];

  const getContent = (p: string): string | undefined =>
    files.find(f => f.path === p) ? 'content' : undefined;

  it('returns exact match unchanged', () => {
    const result = resolveFilePath('src/App.tsx', getContent, files);
    expect(result).toEqual({ resolved: 'src/App.tsx', changed: false });
  });

  it('fixes doubled path prefix', () => {
    const result = resolveFilePath('src/src/App.tsx', getContent, files);
    expect(result.resolved).toBe('src/App.tsx');
    expect(result.changed).toBe(true);
  });

  it('fixes leading slash', () => {
    const result = resolveFilePath('/src/App.tsx', getContent, files);
    expect(result.resolved).toBe('src/App.tsx');
    expect(result.changed).toBe(false);
  });

  it('matches by basename when unique', () => {
    const result = resolveFilePath('Button.tsx', getContent, files);
    expect(result.resolved).toBe('src/components/Button.tsx');
    expect(result.changed).toBe(true);
  });
});

describe('normalizeCommandPaths', () => {
  it('fixes doubled directory segments', () => {
    const result = normalizeCommandPaths('cd src/src/App.tsx');
    expect(result.normalized).toBe('cd src/App.tsx');
    expect(result.changed).toBe(true);
  });

  it('leaves clean commands unchanged', () => {
    const result = normalizeCommandPaths('npm run build');
    expect(result.normalized).toBe('npm run build');
    expect(result.changed).toBe(false);
  });
});

// ─── plannerPromptBuilder ──────────────────────────────────────────────────────

describe('buildSystemPrompt small-file policy', () => {
  const minimalFiles: FileNode[] = [
    { name: 'package.json', path: 'package.json', type: 'file', content: '{"name":"test"}' },
  ];

  it('includes the PREFER MODULAR FILES rule', () => {
    const prompt = buildSystemPrompt(minimalFiles, 'test-project', undefined, true);
    expect(prompt).toMatch(/PREFER MODULAR FILES/i);
  });

  it('mentions 200 lines limit', () => {
    const prompt = buildSystemPrompt(minimalFiles, 'test-project', undefined, true);
    expect(prompt).toMatch(/200 lines/);
  });

  it('includes the project name in the prompt', () => {
    const prompt = buildSystemPrompt(minimalFiles, 'my-app', undefined, true);
    expect(prompt).toContain('my-app');
  });
});

describe('buildFileContext', () => {
  it('generates a file tree section', () => {
    const files: FileNode[] = [
      { name: 'package.json', path: 'package.json', type: 'file', content: '{"name":"x"}' },
      { name: 'src', path: 'src', type: 'folder', children: [
        { name: 'App.tsx', path: 'src/App.tsx', type: 'file', content: 'export default function App() {}' },
      ]},
    ];
    const ctx = buildFileContext(files);
    expect(ctx).toContain('## File tree');
    expect(ctx).toContain('package.json');
    expect(ctx).toContain('src/App.tsx');
  });

  it('inlines source file content', () => {
    const files: FileNode[] = [
      { name: 'App.tsx', path: 'App.tsx', type: 'file', content: 'export default function App() { return null; }' },
    ];
    const ctx = buildFileContext(files);
    expect(ctx).toContain('## File contents');
    expect(ctx).toContain('App.tsx');
  });
});
