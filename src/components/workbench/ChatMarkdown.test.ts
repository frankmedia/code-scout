import { describe, it, expect } from 'vitest';
import { normalizeShellSnippet } from '@/utils/shellSnippet';

describe('normalizeShellSnippet', () => {
  it('strips leading $ and joins lines', () => {
    expect(normalizeShellSnippet('$ npm install\n$ npm run build')).toBe('npm install\nnpm run build');
  });

  it('drops comment-only and blank lines', () => {
    const raw = '# setup\n\n$ echo hi\n';
    expect(normalizeShellSnippet(raw)).toBe('echo hi');
  });

  it('returns empty when only comments', () => {
    expect(normalizeShellSnippet('# only\n# this')).toBe('');
  });
});
