import { describe, expect, it } from 'vitest';
import { formatActivityLogForExport, normalizeActivityLine } from './activityLineNormalize';

describe('normalizeActivityLine', () => {
  it('strips leading junk before Orchestrator marker', () => {
    expect(normalizeActivityLine('🧠 Orchestrator · m · round 1/2 · waiting')).toBe(
      'Orchestrator · m · round 1/2 · waiting',
    );
  });
});

describe('formatActivityLogForExport', () => {
  it('joins normalized lines and optional header', () => {
    const text = formatActivityLogForExport(['  → read_file · ok ', '🧠 Round 1 · x'], {
      includeHeader: true,
      currentStatus: '$ npm test',
    });
    expect(text).toContain('Code Scout — agent activity log');
    expect(text).toContain('Exported:');
    expect(text).toContain('→ read_file · ok');
    expect(text).toContain('Round 1 · x');
    expect(text).toContain('$ npm test');
  });
});
