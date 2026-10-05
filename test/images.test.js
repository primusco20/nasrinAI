import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiImage, createOpenAIImage } from '../src/ai/image.js';
import { testConfig } from './helpers.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { ProviderError } from '../src/ai/provider.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]);

function fakeImages({ fail = null } = {}) {
  const calls = [];
  return {
    id: 'gemini', model: 'gemini-3.1-flash-lite-image', calls,
    async generate(req) {
      calls.push(req);
      if (fail) throw new ProviderError(fail, 'nope', 400);
      return { bytes: PNG, mime: 'image/png' };
    }
  };
}

async function app({ imageProvider = fakeImages(), imageBackup = null, env = {} } = {}) {
  const built = buildTestApp({ provider: createFakeProvider(), imageProvider, imageBackup, env });
  const srv = await serve(built.app);
  const guest = async () => (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
  return { ...built, ...srv, guest, imageProvider };
}

test('a guest makes one picture; it is private to them; the second is refused', async () => {
  const a = await app();
  try {
    const g = await a.guest();
    const r = await postJson(a.url + '/v1/images', { prompt: 'A cup of kape on a wooden table, morning light' }, bearer(g));
    assert.equal(r.status, 200);
    const made = await r.json();
    assert.match(made.message.content, /^\[image:[0-9a-f-]{36}\]/);
    assert.match(a.imageProvider.calls[0].prompt, /campaign-ready[\s\S]*Request: A cup of kape/);

    const img = await fetch(a.url + '/v1/images/' + made.image_id, { headers: bearer(g) });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);

    const other = await a.guest();
    assert.equal((await fetch(a.url + '/v1/images/' + made.image_id, { headers: bearer(other) })).status, 404, 'not someone else');
    assert.equal((await fetch(a.url + '/v1/images/' + made.image_id, { headers: bearer(USER_TOKEN) })).status, 404);

    const again = await postJson(a.url + '/v1/images', { prompt: 'another one' }, bearer(g));
    assert.equal(again.status, 429);
    assert.equal((await again.json()).error.code, 'image_limit');
    assert.equal(a.imageProvider.calls.length, 1, 'one picture per guest');
    assert.equal(a.store.usage.at(-1).task, 'image');
  } finally { await a.close(); }
});

test('signed-in users: daily allowance; photos only; refusals explained; off without a key', async () => {
  const a = await app({ env: { IMAGES_USER_DAY: '2' } });
  try {
    assert.equal((await postJson(a.url + '/v1/images', { prompt: '' }, bearer(USER_TOKEN))).status, 400);
    assert.equal((await postJson(a.url + '/v1/images', { prompt: 'x', photo: { name: 'a.pdf', data: Buffer.from('%PDF-1.7 x').toString('base64') } }, bearer(USER_TOKEN))).status, 400);
    for (const want of [200, 200, 429]) assert.equal((await postJson(a.url + '/v1/images', { prompt: 'a red bicycle' }, bearer(USER_TOKEN))).status, want);
  } finally { await a.close(); }

  const refused = await app({ imageProvider: fakeImages({ fail: 'refused' }) });
  try {
    const r = await postJson(refused.url + '/v1/images', { prompt: 'something' }, bearer(USER_TOKEN));
    assert.equal(r.status, 422);
    assert.equal((await r.json()).error.code, 'image_refused');
  } finally { await refused.close(); }

  const off = await app({ imageProvider: null });
  try {
    assert.equal((await postJson(off.url + '/v1/images', { prompt: 'x' }, bearer(USER_TOKEN))).status, 503);
    assert.equal((await (await fetch(off.url + '/v1/status')).json()).images.available, false);
  } finally { await off.close(); }
});

test('Gemini image request shape and response parsing', async () => {
  const calls = [];
  const p = createGeminiImage({ apiKey: 'g-key', model: 'gemini-3.1-flash-lite-image', fetchImpl: async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return Response.json({ output_image: { data: PNG.toString('base64') } });
  } });
  const out = await p.generate({ prompt: 'p', images: [{ mime: 'image/jpeg', data: 'AAAA' }] });
  assert.equal(out.mime, 'image/png');
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'g-key');
  assert.deepEqual(calls[0].body.input[1], { type: 'image', mime_type: 'image/jpeg', data: 'AAAA' });
  const empty = createGeminiImage({ apiKey: 'k', model: 'm', fetchImpl: async () => Response.json({ output_text: 'I cannot make that.' }) });
  await assert.rejects(empty.generate({ prompt: 'p' }), { kind: 'refused' });
});

test('all guests together stop at the daily guest ceiling', async () => {
  const a = await app({ env: { IMAGES_GUEST_DAY_TOTAL: '2' } });
  try {
    for (const want of [200, 200, 429]) {
      const r = await postJson(a.url + '/v1/images', { prompt: 'a kalamansi tree' }, bearer(await a.guest()));
      assert.equal(r.status, want);
      if (want === 429) assert.match((await r.json()).error.message, /used up for today/);
    }
    assert.equal((await postJson(a.url + '/v1/images', { prompt: 'a kalamansi tree' }, bearer(USER_TOKEN))).status, 200, 'signed-in users are not affected');
    assert.equal(a.imageProvider.calls.length, 3);
  } finally { await a.close(); }
});

test('a Gemini error keeps Google\'s reason for the log', async () => {
  const p = createGeminiImage({ apiKey: 'k', model: 'm', fetchImpl: async () => Response.json({ error: { code: 429, message: 'You exceeded your current quota.\n Please check your plan.', status: 'RESOURCE_EXHAUSTED' } }, { status: 429 }) });
  await assert.rejects(p.generate({ prompt: 'p' }), (err) => err.kind === 'busy' && /429: You exceeded your current quota\. Please check your plan\./.test(err.message));
});

test('Gemini 503 (overloaded) is retried; other errors are not', async () => {
  let n = 0;
  const waits = [];
  const busy = createGeminiImage({ apiKey: 'k', model: 'm', sleep: async (ms) => { waits.push(ms); }, fetchImpl: async () => (++n < 3
    ? Response.json({ error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } }, { status: 503 })
    : Response.json({ output_image: { data: PNG.toString('base64') } })) });
  assert.equal((await busy.generate({ prompt: 'p' })).mime, 'image/png');
  assert.deepEqual([n, waits], [3, [2000, 5000]]);

  let m = 0;
  const down = createGeminiImage({ apiKey: 'k', model: 'm', sleep: async () => {}, fetchImpl: async () => { m++; return Response.json({}, { status: 503 }); } });
  await assert.rejects(down.generate({ prompt: 'p' }), { kind: 'unavailable', status: 503 });
  assert.equal(m, 3, 'three tries, then give up');

  let q = 0;
  const quota = createGeminiImage({ apiKey: 'k', model: 'm', sleep: async () => {}, fetchImpl: async () => { q++; return Response.json({}, { status: 429 }); } });
  await assert.rejects(quota.generate({ prompt: 'p' }), { kind: 'busy' });
  assert.equal(q, 1, 'quota errors are not retried');
});

test('picture backup settings: both model and price, and an OpenAI key', () => {
  const on = testConfig({ OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30), IMAGE_FALLBACK_MODEL: 'gpt-image-x', IMAGE_FALLBACK_PRICE: '0.04' });
  assert.deepEqual({ ...on.images.fallback }, { provider: 'openai', model: 'gpt-image-x', price: 0.04 });
  assert.equal(testConfig({}).images.fallback, null);
  for (const env of [{ IMAGE_FALLBACK_MODEL: 'gpt-image-x' }, { IMAGE_FALLBACK_MODEL: 'dall-e', IMAGE_FALLBACK_PRICE: '0.04' }, { IMAGE_FALLBACK_MODEL: 'gpt-image-x', IMAGE_FALLBACK_PRICE: '$0.04' }]) {
    const c = testConfig({ OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30), ...env });
    assert.equal(c.images.fallback, null);
    assert.ok(c.warnings.some((w) => /IMAGE_FALLBACK/.test(w)));
  }
  assert.ok(testConfig({ IMAGE_FALLBACK_MODEL: 'gpt-image-x', IMAGE_FALLBACK_PRICE: '0.04' }).warnings.some((w) => /needs OPENAI_API_KEY/.test(w)));
});

test('GPT Image request shape: generations without a photo, edits with one; safety blocks are refusals', async () => {
  const calls = [];
  const p = createOpenAIImage({ apiKey: 'sk-x', model: 'gpt-image-x', fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return Response.json({ data: [{ b64_json: PNG.toString('base64') }] });
  } });
  assert.equal((await p.generate({ prompt: 'p', aspectRatio: '16:9' })).mime, 'image/png');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/images/generations');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-x');
  assert.deepEqual(JSON.parse(calls[0].init.body), { model: 'gpt-image-x', prompt: 'p', size: '1536x1024', n: 1 });

  await p.generate({ prompt: 'p', aspectRatio: '4:5', images: [{ mime: 'image/png', data: PNG.toString('base64') }] });
  assert.equal(calls[1].url, 'https://api.openai.com/v1/images/edits');
  const form = calls[1].init.body;
  assert.equal(form.get('size'), '1024x1536');
  assert.equal(form.get('image').type, 'image/png');
  assert.equal(form.get('image').size, PNG.length);

  const blocked = createOpenAIImage({ apiKey: 'k', model: 'm', fetchImpl: async () => Response.json({ error: { code: 'moderation_blocked', message: 'blocked' } }, { status: 400 }) });
  await assert.rejects(blocked.generate({ prompt: 'p' }), { kind: 'refused' });
});

test('Gemini overloaded: GPT Image makes the picture and is the one counted; other errors do not switch', async () => {
  const backupCalls = [];
  const imageBackup = { provider: { id: 'openai', model: 'gpt-image-x', async generate(req) { backupCalls.push(req); return { bytes: PNG, mime: 'image/png' }; } }, price: 0.05 };
  const a = await app({ imageProvider: fakeImages({ fail: 'unavailable' }), imageBackup });
  try {
    const r = await postJson(a.url + '/v1/images', { prompt: 'a jeepney at sunset' }, bearer(USER_TOKEN));
    assert.equal(r.status, 200);
    assert.equal(backupCalls.length, 1);
    assert.match(backupCalls[0].prompt, /Request: a jeepney/);
    const [gem, gpt] = a.store.usage.slice(-2);
    assert.deepEqual([gem.provider, gem.outcome], ['gemini', 'provider_error']);
    assert.deepEqual([gpt.provider, gpt.model, gpt.outcome, gpt.costUsd], ['openai', 'gpt-image-x', 'ok', 0.05]);
  } finally { await a.close(); }

  for (const fail of ['busy', 'refused', 'config']) {
    const b = await app({ imageProvider: fakeImages({ fail }), imageBackup });
    try {
      await postJson(b.url + '/v1/images', { prompt: 'x' }, bearer(USER_TOKEN));
      assert.equal(backupCalls.length, 1, `no backup on ${fail}`);
    } finally { await b.close(); }
  }
});

test('allowance follows the plan, and failed attempts do not count', async () => {
  const { PLATFORM_TENANT_ID } = await import('../src/tenants.js');
  let fail = true;
  const flaky = { id: 'gemini', model: 'gemini-3.1-flash-lite-image', calls: [], async generate(req) {
    this.calls.push(req);
    if (fail) throw new ProviderError('unavailable', 'overloaded', 503);
    return { bytes: PNG, mime: 'image/png' };
  } };
  const a = await app({ imageProvider: flaky, env: { IMAGES_USER_DAY: '1', IMAGES_ULTRA_DAY: '3' } });
  try {
    for (let i = 0; i < 3; i++) assert.equal((await postJson(a.url + '/v1/images', { prompt: 'x' }, bearer(USER_TOKEN))).status, 503);
    fail = false;
    assert.equal((await postJson(a.url + '/v1/images', { prompt: 'x' }, bearer(USER_TOKEN))).status, 200, 'three failures used nothing');
    const over = await postJson(a.url + '/v1/images', { prompt: 'x' }, bearer(USER_TOKEN));
    assert.equal(over.status, 429);
    assert.match((await over.json()).error.message, /made 1 picture today/);

    await a.store.addPlanPeriod({ tenantId: PLATFORM_TENANT_ID, userId: 'user-1', plan: 'ultra', days: 30, provider: 'manual' });
    a.plans.forget({ tenantId: PLATFORM_TENANT_ID, actor: { type: 'user', id: 'user-1' } });
    for (const want of [200, 200, 429]) assert.equal((await postJson(a.url + '/v1/images', { prompt: 'x' }, bearer(USER_TOKEN))).status, want, 'Ultra: 3 a day');
  } finally { await a.close(); }
});

test('pictures have their own budget; it never uses up the chat budget', async () => {
  const a = await app({ env: { IMAGE_DAILY_BUDGET_USD: '0.05' } });
  try {
    assert.equal((await postJson(a.url + '/v1/images', { prompt: 'x' }, bearer(USER_TOKEN))).status, 200);
    const r = await postJson(a.url + '/v1/images', { prompt: 'x' }, bearer(USER_TOKEN));
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error.code, 'budget_reached');
    assert.equal(a.imageProvider.calls.length, 1);

    const { createBudget } = await import('../src/ai/budget.js');
    const chatBudget = createBudget({ store: a.store, config: a.config, logger: a.logger });
    assert.equal((await chatBudget.remaining()).usd, a.config.ai.routing.budget.dailyUsd, 'picture spend is not chat spend');
  } finally { await a.close(); }
});
