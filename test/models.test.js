import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChatModel, isSnapshot, patternMatcher, createModelCatalog } from '../src/ai/models.js';
import { createOpenAIProvider, isReasoningModel } from '../src/ai/openai.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { ProviderError } from '../src/ai/provider.js';
import { loadConfig, ConfigError } from '../src/config.js';
import { buildTestApp, serve, bearer, postJson, memoryLogger, testConfig, USER_TOKEN, SECRET_KEY } from './helpers.js';

// A realistic slice of what OpenAI's model list returns.
const OPENAI_IDS = [
  'gpt-4o-mini', 'gpt-4o', 'gpt-4o-2024-08-06', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-5', 'gpt-5-mini',
  'gpt-5-nano', 'gpt-5-chat-latest', 'gpt-5-pro', 'o3', 'o4-mini', 'o1-pro', 'gpt-3.5-turbo', 'gpt-3.5-turbo-0125',
  'gpt-3.5-turbo-instruct', 'chatgpt-4o-latest', 'text-embedding-3-small', 'tts-1', 'whisper-1', 'dall-e-3',
  'gpt-4o-mini-tts', 'gpt-4o-transcribe', 'gpt-4o-realtime-preview', 'gpt-4o-search-preview', 'gpt-image-1',
  'omni-moderation-latest', 'codex-mini-latest', 'babbage-002', 'davinci-002'
];

const guest = { tenantId: 't', actor: { type: 'guest', id: 'g' } };
const user = { tenantId: 't', actor: { type: 'user', id: 'u' } };

test('only chat models are offered', () => {
  const chat = OPENAI_IDS.filter(isChatModel);
  for (const id of ['gpt-4o-mini', 'gpt-4o', 'gpt-5', 'gpt-5-chat-latest', 'o3', 'o4-mini', 'gpt-3.5-turbo', 'chatgpt-4o-latest']) {
    assert.ok(chat.includes(id), id);
  }
  for (const id of ['text-embedding-3-small', 'tts-1', 'whisper-1', 'dall-e-3', 'gpt-4o-mini-tts', 'gpt-4o-transcribe',
    'gpt-4o-realtime-preview', 'gpt-4o-search-preview', 'gpt-image-1', 'omni-moderation-latest', 'codex-mini-latest',
    'gpt-3.5-turbo-instruct', 'gpt-5-pro', 'o1-pro', 'babbage-002', 'davinci-002']) {
    assert.ok(!chat.includes(id), id);
  }
  assert.ok(isSnapshot('gpt-4o-2024-08-06') && isSnapshot('gpt-3.5-turbo-0125') && !isSnapshot('gpt-4o'));
});

test('patterns use * only and refuse anything else', () => {
  const m = patternMatcher('*-mini, gpt-4.1*');
  assert.ok(m('gpt-4o-mini') && m('gpt-4.1') && m('gpt-4.1-nano') && !m('gpt-4o') && !m('gpt-401'));
  assert.equal(patternMatcher('')('gpt-4o'), false);
  for (const bad of ['gpt-(4)', 'a|b', 'x{2}', '^gpt']) assert.throws(() => patternMatcher(bad));
  assert.throws(() => loadConfig({ MODELS_GUEST: 'gpt-4o|o3' }), ConfigError);
  assert.throws(() => loadConfig({ OPENAI_REASONING_EFFORT: 'max' }), ConfigError);
});

function catalog({ ids = OPENAI_IDS, env = {}, model = 'gpt-4o-mini', fail = false } = {}) {
  let calls = 0;
  const provider = {
    id: 'openai', model,
    async listModels() { calls += 1; if (fail) throw new ProviderError('unavailable', 'down'); return ids; }
  };
  const c = createModelCatalog({ provider, config: testConfig(env), logger: memoryLogger() });
  return { c, calls: () => calls };
}

test('guests get the cheaper models; signed-in users get all chat models', async () => {
  const { c } = catalog();
  const g = await c.listFor(guest);
  assert.deepEqual(g.models, ['gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o-mini', 'gpt-5-mini', 'gpt-5-nano', 'o4-mini']);
  assert.equal(g.default, 'gpt-4o-mini');

  const u = await c.listFor(user);
  for (const id of ['gpt-4o', 'gpt-5', 'o3', 'gpt-4.1', 'chatgpt-4o-latest']) assert.ok(u.models.includes(id), id);
  assert.ok(!u.models.includes('gpt-4o-2024-08-06'), 'dated snapshots hidden by default');
  assert.ok(!u.models.includes('tts-1'));
});

test('the owner\'s rules: block list, custom guest list, snapshots on', async () => {
  const { c } = catalog({ env: { MODELS_BLOCK: 'o3,gpt-5', MODELS_GUEST: 'gpt-4.1-nano', MODELS_SHOW_SNAPSHOTS: 'true' } });
  const u = await c.listFor(user);
  assert.ok(!u.models.includes('o3') && !u.models.includes('gpt-5'));
  assert.ok(u.models.includes('gpt-4o-2024-08-06'));
  assert.deepEqual((await c.listFor(guest)).models, ['gpt-4.1-nano', 'gpt-4o-mini'], 'default model stays open to guests');

  const blockedDefault = catalog({ env: { MODELS_BLOCK: 'gpt-4o-mini' } }).c;
  assert.ok(!(await blockedDefault.listFor(guest)).models.includes('gpt-4o-mini'));
});

test('resolve: default, allowed, not allowed, invalid names', async () => {
  const { c } = catalog();
  assert.equal(await c.resolve(guest, undefined), 'gpt-4o-mini');
  assert.equal(await c.resolve(guest, 'gpt-5-nano'), 'gpt-5-nano');
  await assert.rejects(c.resolve(guest, 'gpt-5'), { code: 'model_not_allowed' });
  assert.equal(await c.resolve(user, 'gpt-5'), 'gpt-5');
  await assert.rejects(c.resolve(user, 'tts-1'), { code: 'model_not_allowed' });
  await assert.rejects(c.resolve(user, 'gpt 4; drop'), { code: 'invalid_model' });
  await assert.rejects(c.resolve(user, 42), { code: 'invalid_model' });
});

test('the model list is cached, and a failed fetch falls back safely', async () => {
  const ok = catalog();
  await ok.c.listFor(user); await ok.c.listFor(guest); await ok.c.resolve(user, 'gpt-4o');
  assert.equal(ok.calls(), 1);

  const down = catalog({ fail: true });
  assert.deepEqual(await down.c.listFor(user), { models: ['gpt-4o-mini'], default: 'gpt-4o-mini' });
});

test('a model the provider refuses is set aside', async () => {
  const { c } = catalog();
  c.markUnusable('gpt-5');
  assert.ok(!(await c.listFor(user)).models.includes('gpt-5'));
  await assert.rejects(c.resolve(user, 'gpt-5'), { code: 'model_not_allowed' });
});

test('OpenAI: reasoning models get a bigger allowance and an effort, no temperature', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }));
  };
  const p = createOpenAIProvider({ apiKey: 'sk-x', temperature: 0.3, reasoningMaxTokens: 4000, reasoningEffort: 'low', fetchImpl });
  await p.generate({ system: 's', messages: [], model: 'o4-mini', maxTokens: 800 });
  await p.generate({ system: 's', messages: [], model: 'gpt-4o', maxTokens: 800 });
  assert.deepEqual([bodies[0].max_completion_tokens, bodies[0].reasoning_effort, bodies[0].temperature], [4000, 'low', undefined]);
  assert.deepEqual([bodies[1].max_completion_tokens, bodies[1].reasoning_effort, bodies[1].temperature], [800, undefined, 0.3]);
  assert.ok(isReasoningModel('gpt-5-mini') && isReasoningModel('o3') && !isReasoningModel('gpt-5-chat-latest') && !isReasoningModel('gpt-4.1'));
});

test('OpenAI: model list request', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://api.openai.com/v1/models');
    return new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'tts-1' }, {}] }));
  };
  assert.deepEqual(await createOpenAIProvider({ apiKey: 'sk-x', fetchImpl }).listModels(), ['gpt-4o', 'tts-1']);
});

test('end to end: /v1/models and choosing a model in /v1/chat', async () => {
  const provider = createFakeProvider({ models: ['gpt-4o-mini', 'gpt-4o', 'gpt-5-nano', 'tts-1'] });
  const built = buildTestApp({ provider });
  const srv = await serve(built.app);
  try {
    const g = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;

    assert.deepEqual(await (await fetch(srv.url + '/v1/models', { headers: bearer(g) })).json(),
      { models: ['gpt-4o-mini', 'gpt-5-nano'], default: 'gpt-4o-mini' });
    assert.deepEqual((await (await fetch(srv.url + '/v1/models', { headers: bearer(USER_TOKEN) })).json()).models,
      ['gpt-4o', 'gpt-4o-mini', 'gpt-5-nano']);
    assert.equal((await fetch(srv.url + '/v1/models')).status, 401);

    const r = await postJson(srv.url + '/v1/chat', { message: 'hi', model: 'gpt-5-nano' }, bearer(g));
    assert.equal((await r.json()).model, 'gpt-5-nano');
    assert.equal(provider.calls.at(-1).model, 'gpt-5-nano');
    assert.equal(built.store.usage.at(-1).model, 'gpt-5-nano', 'usage records the chosen model');

    const refused = await postJson(srv.url + '/v1/chat', { message: 'hi', model: 'gpt-4o' }, bearer(g));
    assert.equal(refused.status, 400);
    assert.equal(provider.calls.length, 1, 'refused before the model is called');

    assert.equal((await (await postJson(srv.url + '/v1/chat', { message: 'hi', model: 'gpt-4o' }, bearer(SECRET_KEY))).json()).model, 'gpt-4o');
  } finally { await srv.close(); }
});

test('end to end: a model refused by the provider is set aside and the caller is told', async () => {
  const provider = createFakeProvider({
    models: ['gpt-4o-mini', 'gpt-5'],
    failWith: (req) => (req.model === 'gpt-5' ? new ProviderError('config', 'only in responses API', 400) : null)
  });
  const built = buildTestApp({ provider });
  const srv = await serve(built.app);
  try {
    const r = await postJson(srv.url + '/v1/chat', { message: 'hi', model: 'gpt-5' }, bearer(USER_TOKEN));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, 'model_unavailable');
    const list = await (await fetch(srv.url + '/v1/models', { headers: bearer(USER_TOKEN) })).json();
    assert.deepEqual(list.models, ['gpt-4o-mini']);
    assert.equal((await postJson(srv.url + '/v1/chat', { message: 'hi' }, bearer(USER_TOKEN))).status, 200);
  } finally { await srv.close(); }
});
