/**
 * Separate AbortControllers per chat session so multiple agent streams can run in parallel.
 */

const controllers = new Map<string, AbortController>();

export function beginStreamForSession(sessionId: string): AbortSignal {
  const prev = controllers.get(sessionId);
  prev?.abort();
  const c = new AbortController();
  controllers.set(sessionId, c);
  return c.signal;
}

export function abortStreamForSession(sessionId: string): void {
  controllers.get(sessionId)?.abort();
  controllers.delete(sessionId);
}

export function abortAllChatStreams(): void {
  for (const c of controllers.values()) {
    c.abort();
  }
  controllers.clear();
}
