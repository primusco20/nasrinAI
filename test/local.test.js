import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalProvider } from '../src/ai/local.js';
import { assertProvider, ProviderError } from '../src/ai/provider.js';
import { providerFromConfig } from '../src/ai/registry.js';
import { loadConfig, ConfigError } from '../src/config.js';
import { buildTestApp, serve, bearer, postJson } from './helpers.js';

const BASE = 'http://127.0.0.1:11434/v1';
const KEY = 'local-key-' + 'x'.repeat(24);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64');
const PDF = Buffer.from('%PDF-1.7\n...').toString('base64');

const completion = (content, usage = { prompt_tokens: 9, completion_tokens: 4 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage }));

// A pretend model server: answers /models with `models` and chat with `answer`.
function server({ models = ['llama3.1:8b'], answer = () => completion('Hi there!'), down = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init, body: init.body && JSON.parse(init.body) });
    if (down) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: models.map((id) => ({ id })) }));
    return answer();
  };
  return { fetchImpl, calls };
}

const localWith = (opts = {}, srv = server()) => ({
  provider: createLocalProvider({ baseUrl: BASE + '/', model: 'llama3.1:8b', fetchImpl: srv.fetchImpl, ...opts }),
  calls: srv.calls
});

test('local: request shape, credentials and capabilities', async () => {
  const { provider, calls } = localWith({ apiKey: KEY, accessClientId: 'id.access', accessClientSecret: 'access-secret' });
  assertProvider(provider);
  const out = await provider.generate({ system: 'S', messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'high', maxTokens: 300 });
  assert.deepEqual(out, { text: 'Hi there!', toolCalls: [], inputTokens: 9, cachedTokens: 0, outputTokens: 4, finishReason: 'stop', model: 'llama3.1:8b' });
  assert.equal(calls[0].url, BASE + '/chat/completions', 'trailing slash removed');
  assert.deepEqual(calls[0].body, { model: 'llama3.1:8b', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'hi' }], max_tokens: 300, stream: false });
  const h = calls[0].init.headers;
  assert.equal(h.Authorization, 'Bearer ' + KEY);
  assert.equal(h['CF-Access-Client-Id'], 'id.access');
  assert.equal(h['CF-Access-Client-Secret'], 'access-secret');
  assert.deepEqual(provider.capabilities(), { local: true, dataLeavesServer: false, vision: false, pdf: false, trainsOnData: false, tools: false });

  const plain = localWith();
  await plain.provider.generate({ system: 'S', messages: [{ role: 'user', content: 'hi' }], model: 'qwen2.5:7b' });
  assert.equal('Authorization' in plain.calls[0].init.headers, false, 'no credential unless configured');
  assert.equal(plain.calls[0].body.model, 'qwen2.5:7b', 'a tier can pick another local model');
});

test('local: photos only with vision; PDFs never; refused before any call', async () => {
  const msg = [{ role: 'user', content: 'what is this?' }];
  const off = localWith();
  for (const a of [{ kind: 'image', mime: 'image/png', name: 'a.png', data: PNG }, { kind: 'pdf', mime: 'application/pdf', name: 'a.pdf', data: PDF }]) {
    await assert.rejects(off.provider.generate({ system: 'S', messages: msg, attachments: [a] }), (e) => e instanceof ProviderError && e.kind === 'config' && e.status === 400);
  }
  assert.equal(off.calls.length, 0);

  const on = localWith({ vision: true });
  await on.provider.generate({ system: 'S', messages: msg, attachments: [{ kind: 'image', mime: 'image/png', name: 'a.png', data: PNG }] });
  assert.deepEqual(on.calls[0].body.messages[1].content, [
    { type: 'text', text: 'what is this?' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,' + PNG } }
  ]);
  await assert.rejects(on.provider.generate({ system: 'S', messages: msg, attachments: [{ kind: 'pdf', mime: 'application/pdf', name: 'a.pdf', data: PDF }] }), { kind: 'config' });
});

test('local: failures become ProviderErrors without secrets', async () => {
  const cases = [
    [() => new Response('nope', { status: 401 }), 'config'],
    [() => new Response('{"error":"model \\"x\\" not found"}', { status: 404 }), 'config'],
    [() => new Response('loading', { status: 503 }), 'busy'],
    [() => new Response('boom', { status: 500 }), 'unavailable'],
    [() => { throw new DOMException('t', 'TimeoutError'); }, 'timeout']
  ];
  for (const [answer, kind] of cases) {
    const { provider } = localWith({ apiKey: KEY }, server({ answer }));
    await assert.rejects(provider.generate({ system: 'S', messages: [{ role: 'user', content: 'x' }] }), (e) => {
      assert.equal(e.kind, kind);
      assert.equal(e.message.includes(KEY), false);
      return true;
    });
  }
  const { provider } = localWith({ apiKey: KEY }, server({ down: true }));
  await assert.rejects(provider.generate({ system: 'S', messages: [{ role: 'user', content: 'x' }] }), (e) => e.kind === 'unavailable' && /ECONNREFUSED/.test(e.message));
});

test('local: thinking tags are removed from the reply', async () => {
  const { provider } = localWith({}, server({ answer: () => completion('<think>\nlet me see\n</think>\n\nThe answer is 4.') }));
  assert.equal((await provider.generate({ system: 'S', messages: [{ role: 'user', content: '2+2' }] })).text, 'The answer is 4.');
});

test('local: model list and health', async () => {
  const { provider } = localWith({ model: 'llama3.2' }, server({ models: ['llama3.2:latest', 'qwen2.5:7b'] }));
  assert.deepEqual(await provider.listModels(), ['llama3.2:latest', 'llama3.2', 'qwen2.5:7b']);
  assert.equal(await provider.healthCheck(), true);
  assert.equal(await localWith({ model: 'mistral' }, server({ models: ['qwen2.5:7b'] })).provider.healthCheck(), false, 'model not pulled');
  assert.equal(await localWith({}, server({ down: true })).provider.healthCheck(), false, 'server off');
});

test('config: local settings are checked', () => {
  const ok = { AI_PROVIDER: 'local', LOCAL_AI_URL: BASE, LOCAL_AI_MODEL: 'llama3.1:8b' };
  const ai = loadConfig(ok).ai;
  assert.equal(ai.local.url, BASE);
  assert.equal(ai.local.vision, false);
  assert.equal(ai.local.timeoutMs, 100_000);
  assert.deepEqual(ai.tiers, { nasrinai: { provider: 'local', model: 'llama3.1:8b', effort: null }, pro: null, max: null, ultra: null }, 'only NasrinAI until the owner names more');
  assert.equal(ai.speech.enabled, false, 'no outside voice service with a local model');

  const tiers = loadConfig({ ...ok, TIER_PRO: 'qwen2.5:14b', TIER_MAX: 'meta-llama/Llama-3.1-70B-Instruct' }).ai.tiers;
  assert.deepEqual([tiers.pro.model, tiers.max.model], ['qwen2.5:14b', 'meta-llama/Llama-3.1-70B-Instruct']);

  const prodBase = { NODE_ENV: 'production', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x', SUPABASE_SECRET_KEY: 'sb_secret_y', GUEST_SESSION_SECRET: 'g'.repeat(40), AI_PROVIDER: 'local', LOCAL_AI_MODEL: 'llama3.1:8b' };
  assert.equal(loadConfig({ ...prodBase, LOCAL_AI_URL: 'http://127.0.0.1:11434/v1' }).ai.local.url, 'http://127.0.0.1:11434/v1', 'same machine is fine');
  assert.ok(loadConfig({ ...prodBase, LOCAL_AI_URL: 'https://model.example.com/v1', LOCAL_AI_KEY: KEY }).ai.local);
  assert.ok(loadConfig({ ...prodBase, LOCAL_AI_URL: 'https://model.example.com/v1', LOCAL_AI_ACCESS_CLIENT_ID: 'a', LOCAL_AI_ACCESS_CLIENT_SECRET: 'b' }).ai.local);

  for (const env of [
    { ...ok, LOCAL_AI_URL: '' },
    { ...ok, LOCAL_AI_URL: 'ftp://host/v1' },
    { ...ok, LOCAL_AI_MODEL: '' },
    { ...ok, LOCAL_AI_URL: 'https://user:pass@model.example.com/v1' },
    { ...ok, LOCAL_AI_URL: 'https://model.example.com/v1?key=1' },
    { ...ok, LOCAL_AI_ACCESS_CLIENT_ID: 'only-id' },
    { ...ok, LOCAL_AI_VISION: 'yes' },
    { ...ok, LOCAL_AI_TIMEOUT_SECONDS: '300' },
    { ...ok, TIER_PRO: 'bad name' },
    { ...prodBase, LOCAL_AI_URL: 'http://model.example.com/v1', LOCAL_AI_KEY: KEY },
    { ...prodBase, LOCAL_AI_URL: 'https://model.example.com/v1' }
  ]) assert.throws(() => loadConfig(env), ConfigError, JSON.stringify(env));
});

test('registry: AI_PROVIDER=local builds the local provider', () => {
  const p = providerFromConfig(loadConfig({ AI_PROVIDER: 'local', LOCAL_AI_URL: BASE, LOCAL_AI_MODEL: 'llama3.1:8b', LOCAL_AI_VISION: 'true' }));
  assert.deepEqual(p.providerIds, ['local']);
  assert.equal(p.model, 'llama3.1:8b');
  assert.deepEqual(p.capabilities(), { local: true, dataLeavesServer: false, vision: true, pdf: false });
});

test('end to end: own model, honest status, no redaction, health cached', async () => {
  const srv = server({ answer: () => completion('Noted.') });
  const provider = createLocalProvider({ baseUrl: BASE, model: 'llama3.1:8b', fetchImpl: srv.fetchImpl });
  const env = { AI_PROVIDER: 'local', LOCAL_AI_URL: BASE, LOCAL_AI_MODEL: 'llama3.1:8b' };
  const { app, store } = buildTestApp({ provider, env });
  const { url, close } = await serve(app);
  try {
    const status = await (await fetch(url + '/v1/status')).json();
    assert.equal(status.ai_available, true);
    assert.equal(status.external_model, false);
    assert.equal(status.own_model, true);
    assert.equal(status.redacts_contact_details, false);
    assert.deepEqual(status.files, { photos: false, pdfs: false });
    await fetch(url + '/v1/status');
    assert.equal(srv.calls.filter((c) => c.url.endsWith('/models')).length, 1, 'health checked once, then cached');

    const g = (await (await fetch(url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    const r = await postJson(url + '/v1/chat', { message: 'Email me at ana@example.com' }, bearer(g));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).message.content, 'Noted.');
    const sent = srv.calls.find((c) => c.url.endsWith('/chat/completions')).body.messages.at(-1).content;
    assert.match(sent, /ana@example\.com/, 'nothing leaves for an outside company, so nothing is removed');
    assert.equal(store.usage.at(-1).provider, 'local');

    const pdf = await postJson(url + '/v1/chat', { message: 'read this', attachments: [{ name: 'a.pdf', data: PDF }] }, bearer(g));
    assert.equal(pdf.status, 400);
    assert.equal((await pdf.json()).error.code, 'attachment_unsupported');
  } finally { await close(); }
});

test('status: a switched-off model server shows as not available', async () => {
  const provider = createLocalProvider({ baseUrl: BASE, model: 'llama3.1:8b', fetchImpl: server({ down: true }).fetchImpl });
  const { app } = buildTestApp({ provider, env: { AI_PROVIDER: 'local', LOCAL_AI_URL: BASE, LOCAL_AI_MODEL: 'llama3.1:8b' } });
  const { url, close } = await serve(app);
  try {
    assert.equal((await (await fetch(url + '/v1/status')).json()).ai_available, false);
  } finally { await close(); }
});
