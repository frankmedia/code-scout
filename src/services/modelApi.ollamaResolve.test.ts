/** Real Node `fetch` + TCP; jsdom’s fetch does not reliably hit a local test server. */
// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearOllamaTagsCache, resolveOllamaModelId } from './modelApi';

/** Local HTTP server so we exercise real `fetch` (no brittle global mocks in jsdom). */
describe('resolveOllamaModelId', () => {
  let port = 0;
  let server: http.Server;
  let tagPayload: { models: { name: string }[] } = { models: [] };

  beforeAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server = http.createServer((req, res) => {
          if (req.url === '/api/tags' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(tagPayload));
            return;
          }
          res.writeHead(404);
          res.end();
        });
        server.listen(0, '127.0.0.1', () => {
          const a = server.address() as AddressInfo;
          port = a.port;
          resolve();
        });
        server.on('error', reject);
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
      }),
  );

  function base() {
    return `http://127.0.0.1:${port}`;
  }

  beforeEach(() => {
    clearOllamaTagsCache();
    tagPayload = { models: [] };
  });

  afterEach(() => {
    clearOllamaTagsCache();
  });

  it('returns exact match', async () => {
    tagPayload = { models: [{ name: 'llama3.2:latest' }, { name: 'phi3:latest' }] };
    const r = await resolveOllamaModelId(base(), 'phi3:latest');
    expect(r).toEqual({ ok: true, model: 'phi3:latest', verified: true });
  });

  it('matches case-insensitively', async () => {
    tagPayload = { models: [{ name: 'Llama3.2:latest' }] };
    const r = await resolveOllamaModelId(base(), 'llama3.2:latest');
    expect(r).toEqual({ ok: true, model: 'Llama3.2:latest', verified: true });
  });

  it('rewrites to sole tag with same base name', async () => {
    tagPayload = { models: [{ name: 'codellama:latest' }] };
    const r = await resolveOllamaModelId(base(), 'codellama:13b');
    expect(r).toEqual({ ok: true, model: 'codellama:latest', verified: true });
  });

  it('fails with options when multiple tags share base', async () => {
    tagPayload = { models: [{ name: 'mistral:7b' }, { name: 'mistral:latest' }] };
    const r = await resolveOllamaModelId(base(), 'mistral:foo');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('mistral:7b');
      expect(r.message).toContain('mistral:latest');
    }
  });

  it('fails listing installed when unknown', async () => {
    tagPayload = { models: [{ name: 'a:latest' }, { name: 'b:latest' }] };
    const r = await resolveOllamaModelId(base(), 'nope:missing');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('a:latest');
  });

  it('uses the only installed model when the requested name is missing', async () => {
    tagPayload = { models: [{ name: 'minimax-m2.7:cloud' }] };
    const r = await resolveOllamaModelId(base(), 'deepseek-coder-v2:16b');
    expect(r).toEqual({ ok: true, model: 'minimax-m2.7:cloud', verified: true });
  });

  it('passes through when /api/tags is unreachable', async () => {
    const r = await resolveOllamaModelId('http://127.0.0.1:1', 'anything');
    expect(r).toEqual({ ok: true, model: 'anything', verified: false });
  });
});
