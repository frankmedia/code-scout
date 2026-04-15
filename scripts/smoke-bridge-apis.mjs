#!/usr/bin/env node
/**
 * Smoke-test two integration surfaces Code Scout can use:
 *
 * 1) openai — Codex-style / subscription bearer against OpenAI-compatible
 *    https://api.openai.com/v1 (or override base).
 * 2) openclaw — OpenClaw Gateway HTTP (enable chatCompletions in gateway config).
 *
 * Usage:
 *   node scripts/smoke-bridge-apis.mjs openai
 *   node scripts/smoke-bridge-apis.mjs openclaw
 *   node scripts/smoke-bridge-apis.mjs all
 *
 * Env (openai):
 *   OPENAI_ACCESS_TOKEN   required (OAuth access token or API key for that base)
 *   OPENAI_BASE           optional, default https://api.openai.com/v1
 *   OPENAI_CHAT_MODEL     optional, default gpt-4o
 *
 * Env (openclaw):
 *   OPENCLAW_GATEWAY_TOKEN  required
 *   OPENCLAW_BASE           optional, default http://127.0.0.1:18789/v1
 *   OPENCLAW_AGENT_MODEL    optional OpenAI model field, default openclaw/default
 *   OPENCLAW_BACKEND_MODEL  optional x-openclaw-model header (e.g. openai/gpt-5.4)
 */

const TIMEOUT_MS = 25_000;

function usage() {
  console.log(`Usage: node scripts/smoke-bridge-apis.mjs <openai|openclaw|all>

Smoke-tests GET /v1/models and POST /v1/chat/completions (non-stream, max_tokens: 8).

openai:
  OPENAI_ACCESS_TOKEN   required
  OPENAI_BASE           default https://api.openai.com/v1
  OPENAI_CHAT_MODEL     default gpt-4o

openclaw:
  OPENCLAW_GATEWAY_TOKEN  required
  OPENCLAW_BASE           default http://127.0.0.1:18789/v1
  OPENCLAW_AGENT_MODEL    default openclaw/default
  OPENCLAW_BACKEND_MODEL  optional → sent as x-openclaw-model

Examples:
  OPENAI_ACCESS_TOKEN="\${TOKEN}" node scripts/smoke-bridge-apis.mjs openai
  OPENCLAW_GATEWAY_TOKEN="\${TOKEN}" node scripts/smoke-bridge-apis.mjs openclaw
  OPENAI_ACCESS_TOKEN="\${A}" OPENCLAW_GATEWAY_TOKEN="\${B}" node scripts/smoke-bridge-apis.mjs all
`);
}

function normalizeBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

async function fetchJson(url, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

async function smokeOpenAI() {
  const token = process.env.OPENAI_ACCESS_TOKEN?.trim();
  const base  = normalizeBase(process.env.OPENAI_BASE || 'https://api.openai.com/v1');
  const model = process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-4o';

  if (!token) { console.error('[openai] Missing OPENAI_ACCESS_TOKEN'); return false; }

  console.log(`[openai] Base:  ${base}`);
  console.log(`[openai] Model: ${model}`);

  const auth = { Authorization: `Bearer ${token}` };

  // /models requires api.model.read scope — web session tokens (from chatgpt.com) have
  // model.read but not api.model.read; Codex OAuth tokens have api.model.read.
  // Treat 403 here as a warning, not a fatal failure — chat/completions is the real test.
  console.log(`[openai] GET ${base}/models`);
  const m = await fetchJson(`${base}/models`, { headers: auth });
  if (!m.ok) {
    if (m.status === 403) {
      console.warn(`[openai] GET /models → HTTP 403 (missing api.model.read scope — expected for web session tokens). Continuing to chat test.`);
    } else {
      console.error(`[openai] GET /models failed: HTTP ${m.status}`, m.body);
      if (m.status === 401) console.error('[openai] Hint: token is expired or invalid.');
      if (m.status === 429) console.error('[openai] Hint: quota/rate-limit. Retry later.');
      return false;
    }
  } else {
    const ids = m.body?.data?.map(x => x.id).filter(Boolean) ?? [];
    console.log(`[openai] GET /models OK — ${ids.length} models; sample: ${ids.slice(0, 5).join(', ') || '(none)'}`);
  }

  // o3 / o4 family reject max_tokens — use max_completion_tokens instead
  const isOModel = /^o\d/i.test(model);
  const tokenParam = isOModel ? { max_completion_tokens: 50 } : { max_tokens: 8 };

  console.log(`[openai] POST ${base}/chat/completions (model: ${model})`);
  const c = await fetchJson(`${base}/chat/completions`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      ...tokenParam,
      messages: [{ role: 'user', content: 'Say OK in one word.' }],
      stream: false,
    }),
  });
  if (!c.ok) {
    console.error(`[openai] POST /chat/completions failed: HTTP ${c.status}`, c.body);
    if (c.status === 429) console.error('[openai] Hint: quota/rate-limit — expected with ChatGPT subscription (weekly caps). Try another model or wait.');
    if (c.status === 401 || c.status === 403) console.error('[openai] Hint: token rejected. The Codex OAuth path and pay-per-use API are different products.');
    return false;
  }
  const reply = String(c.body?.choices?.[0]?.message?.content ?? '').slice(0, 120);
  console.log(`[openai] POST /chat/completions OK — assistant: ${JSON.stringify(reply)}`);
  return true;
}

async function smokeOpenClaw() {
  const token      = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  const base       = normalizeBase(process.env.OPENCLAW_BASE || 'http://127.0.0.1:18789/v1');
  const agentModel = process.env.OPENCLAW_AGENT_MODEL?.trim() || 'openclaw/default';
  const backend    = process.env.OPENCLAW_BACKEND_MODEL?.trim();

  if (!token) { console.error('[openclaw] Missing OPENCLAW_GATEWAY_TOKEN'); return false; }

  console.log(`[openclaw] Base:          ${base}`);
  console.log(`[openclaw] Agent model:   ${agentModel}`);
  if (backend) console.log(`[openclaw] x-openclaw-model: ${backend}`);

  const authHeaders = { Authorization: `Bearer ${token}` };
  const chatHeaders = { ...authHeaders, 'Content-Type': 'application/json' };
  if (backend) chatHeaders['x-openclaw-model'] = backend;

  console.log(`[openclaw] GET ${base}/models`);
  const m = await fetchJson(`${base}/models`, { headers: authHeaders });
  if (!m.ok) {
    console.error(`[openclaw] GET /models failed: HTTP ${m.status}`, m.body);
    if (m.status === 404 || m.status === 405) {
      console.error('[openclaw] Hint: HTTP completions surface is disabled. Set gateway.http.endpoints.chatCompletions.enabled: true in your OpenClaw gateway config.');
    }
    if (m.status === 401) console.error('[openclaw] Hint: wrong gateway token — check OPENCLAW_GATEWAY_TOKEN vs gateway.auth.token / gateway.auth.password.');
    return false;
  }
  const ids = m.body?.data?.map(x => x.id).filter(Boolean) ?? [];
  console.log(`[openclaw] GET /models OK — ${ids.length} agent targets; sample: ${ids.slice(0, 8).join(', ') || '(none)'}`);

  console.log(`[openclaw] POST ${base}/chat/completions`);
  const c = await fetchJson(`${base}/chat/completions`, {
    method: 'POST',
    headers: chatHeaders,
    body: JSON.stringify({
      model: agentModel,
      max_tokens: 8,
      messages: [{ role: 'user', content: 'Say OK in one word.' }],
      stream: false,
    }),
  });
  if (!c.ok) {
    console.error(`[openclaw] POST /chat/completions failed: HTTP ${c.status}`, c.body);
    return false;
  }
  const reply = String(c.body?.choices?.[0]?.message?.content ?? '').slice(0, 120);
  console.log(`[openclaw] POST /chat/completions OK — assistant: ${JSON.stringify(reply)}`);
  return true;
}

const cmd = process.argv[2];

if (!cmd || cmd === '-h' || cmd === '--help') {
  usage();
  process.exit(cmd ? 0 : 1);
}

(async () => {
  if (cmd === 'openai')   return process.exit((await smokeOpenAI())   ? 0 : 1);
  if (cmd === 'openclaw') return process.exit((await smokeOpenClaw()) ? 0 : 1);
  if (cmd === 'all') {
    console.log('=== openai ===\n');
    const a = await smokeOpenAI();
    console.log('\n=== openclaw ===\n');
    const b = await smokeOpenClaw();
    return process.exit(a && b ? 0 : 1);
  }
  console.error(`Unknown command: ${cmd}`);
  usage();
  process.exit(1);
})().catch(err => { console.error(err); process.exit(1); });
