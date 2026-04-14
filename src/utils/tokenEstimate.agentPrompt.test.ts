/**
 * Regression: orchestrator-with-coder system prompt must stay aligned with
 * buildAgentTools(true) — web research + delegation, not “four tools only”.
 *
 * Run: npx vitest run src/utils/tokenEstimate.agentPrompt.test.ts
 */
import { describe, it, expect } from 'vitest';
import { getAgentSystemPrompt } from './tokenEstimate';

describe('getAgentSystemPrompt', () => {
  it('withCoder lists web_search, fetch_url, and delegate_to_coder', () => {
    const p = getAgentSystemPrompt({ withCoder: true });
    expect(p).toContain('web_search');
    expect(p).toContain('fetch_url');
    expect(p).toContain('delegate_to_coder');
    expect(p).toContain('browse_web');
    expect(p).toMatch(/finish_task/i);
  });

  it('solo mode mentions web research in workflow', () => {
    const p = getAgentSystemPrompt({ withCoder: false });
    expect(p).toContain('web_search');
    expect(p).toContain('fetch_url');
  });
});
