import { describe, expect, it } from 'vitest';
import { inferWorkbenchAgentRole } from './AIPanelUtils';

describe('inferWorkbenchAgentRole', () => {
  it('infers coder from status prefix', () => {
    expect(inferWorkbenchAgentRole('Coder · x · round 1/2 · waiting', [])).toBe('coder');
  });

  it('uses file tools after delegation as weak coder hint', () => {
    const history = [
      'Orchestrator · m · round 1/2 · waiting',
      '→ delegate_to_coder · summary · «do it»',
      '$ npm install',
      '→ read_file · ok',
    ];
    expect(inferWorkbenchAgentRole('$ npm run build', history)).toBe('coder');
  });

  it('does not use file tools before any delegation', () => {
    const history = ['Round 1 · tools', '→ read_file · ok'];
    expect(inferWorkbenchAgentRole('$ ls', history)).toBe('orchestrator');
  });
});
