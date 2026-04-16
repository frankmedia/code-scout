import { describe, it, expect, vi } from 'vitest';
import type { FileNode } from '@/store/workbenchStore';
import { flattenAllFilesCapped, PLAN_FLATTEN_MAX_FILES } from './agentExecutorUtils';

describe('flattenAllFilesCapped', () => {
  it('returns every file when under the cap', () => {
    const tree: FileNode[] = [
      { name: 'a.ts', path: 'a.ts', type: 'file' },
      {
        name: 'src',
        path: 'src',
        type: 'folder',
        children: [{ name: 'b.ts', path: 'src/b.ts', type: 'file' }],
      },
    ];
    const files = flattenAllFilesCapped(tree);
    expect(files.map(f => f.path).sort()).toEqual(['a.ts', 'src/b.ts']);
  });

  it('stops at PLAN_FLATTEN_MAX_FILES and calls onTruncated', () => {
    const onTruncated = vi.fn();
    const lots: FileNode[] = Array.from({ length: PLAN_FLATTEN_MAX_FILES + 50 }, (_, i) => ({
      name: `f${i}.txt`,
      path: `f${i}.txt`,
      type: 'file' as const,
    }));
    const files = flattenAllFilesCapped(lots, onTruncated);
    expect(files.length).toBe(PLAN_FLATTEN_MAX_FILES);
    expect(onTruncated).toHaveBeenCalledTimes(1);
    expect(onTruncated.mock.calls[0][0]).toMatch(/indexed the first/);
  });
});
