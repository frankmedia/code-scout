import { describe, it, expect } from 'vitest';
import { sanitizeRmCommaSeparatedPaths } from './agentExecutor';

describe('sanitizeRmCommaSeparatedPaths', () => {
  it('splits comma-separated rm targets', () => {
    const { normalized, changed } = sanitizeRmCommaSeparatedPaths(
      'rm -rf node_modules,@types,package-lock.json',
    );
    expect(changed).toBe(true);
    expect(normalized).toBe('rm -rf node_modules @types package-lock.json');
  });

  it('leaves valid rm unchanged', () => {
    const { normalized, changed } = sanitizeRmCommaSeparatedPaths('rm -rf node_modules');
    expect(changed).toBe(false);
    expect(normalized).toBe('rm -rf node_modules');
  });

  it('preserves tail after &&', () => {
    const { normalized } = sanitizeRmCommaSeparatedPaths(
      'rm -rf node_modules,package-lock.json && npm install',
    );
    expect(normalized).toBe('rm -rf node_modules package-lock.json && npm install');
  });
});
