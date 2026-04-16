import { describe, it, expect } from 'vitest';
import { raceWithTimeout } from './agentExecutorUtils';

describe('raceWithTimeout', () => {
  it('returns timeoutValue when the promise is slower than ms', async () => {
    const slow = new Promise<string>(resolve => setTimeout(() => resolve('late'), 500));
    const out = await raceWithTimeout(slow, 40, 'cutoff');
    expect(out).toBe('cutoff');
  });

  it('returns the promise result when it settles before ms', async () => {
    const fast = Promise.resolve('ok');
    const out = await raceWithTimeout(fast, 5_000, 'should-not-use');
    expect(out).toBe('ok');
  });
});
