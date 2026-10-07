import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelCatalog, TIERS } from '../src/ai/models.js';
import { createOpenAIProvider, isReasoningModel } from '../src/ai/openai.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { ProviderError } from '../src/ai/provider.js';
import { loadConfig, ConfigError } from '../src/config.js';
import { buildTestApp, serve, bearer, postJson, memoryLogger, testConfig, USER_TOKEN, SECRET_KEY } from './helpers.js';

const KEY_MODELS = ['gpt-4o-mini', 'gpt-5-mini', 'gpt-5', 'o3', 'tts-1'];
const guest = { tenantId: 't', actor: { type: 'guest', id: 'g' } };
const user = { tenantId: 't', actor: { type: 'user', id: 'u' } };
const names = (list) => list.models.filter((m) => !m.locked).map((m) => m.name);
const PLATFORM = '00000000-0000-0000-0000-000000000001';
const giveUltra = (store) => store.addPlanPeriod({ tenantId: PLATFORM, userId: 'user-1', plan: 'ultra', days: 30, provider: 'manual' });

function catalog({ ids = KEY_MODELS, env = {}, fail = false } = {}) {
  let calls = 0;
  const config = testConfig(env);
  const provider = {
    id: 'openai', model: config.ai.openaiModel,
    async listModels() { calls += 1; if (fail) throw new ProviderError('unavailable', 'down'); return ids; }
  };
  return { c: createModelCatalog({ provider, config, logger: memoryLogger() }), calls: () => calls };
}

test('the four tiers and their default models', () => {
  assert.deepEqual(TIERS.map((t) => t.name), ['Quick', 'Pro', 'Max', 'Ultra']);
  const { tiers, guestTiers, userTiers, openaiModel } = loadConfig({}).ai;
  assert.deepEqual(tiers.nasrinai, { provider: 'openai', model: 'gpt-4o-mini', effort: null });
  assert.deepEqual(tiers.ultra, { provider: 'openai', model: 'gpt-5', effort: 'high' });
  assert.deepEqual([guestTiers, userTiers], [['nasrinai', 'pro'], ['nasrinai', 'pro', 'max', 'ultra']]);
  assert.equal(openaiModel, 'gpt-4o-mini');
  assert.equal(loadConfig({ OPENAI_MODEL: 'gpt-4.1-mini' }).ai.tiers.nasrinai.model, 'gpt-4.1-mini', 'OPENAI_MODEL still sets the default');
});

test('tier settings are checked at start-up', () => {
  assert.deepEqual(loadConfig({ TIER_MAX: 'o3:medium', TIER_ULTRA: '' }).ai.tiers.max, { provider: 'openai', model: 'o3', effort: 'medium' });
  assert.equal(loadConfig({ TIER_ULTRA: '' }).ai.tiers.ultra, null);
  for (const env of [{ TIER_PRO: 'gpt 5' }, { TIER_PRO: 'gpt-5:extreme' }, { TIER_PRO: 'a:b:c' }, { TIER_NASRINAI: '' },
    { TIERS_GUEST: 'nasrinai,mega' }, { OPENAI_REASONING_EFFORT: 'ultra' }]) {
    assert.throws(() => loadConfig(env), ConfigError, JSON.stringify(env));
  }
});

test('guests see Quick and Pro; signed-in users see all four; names only, no model ids', async () => {
  const { c } = catalog();
  const g = await c.listFor(guest);
  assert.deepEqual(g, { models: [{ id: 'nasrinai', name: 'Quick' }, { id: 'pro', name: 'Pro' }], default: 'nasrinai' });
  assert.deepEqual(names(await c.listFor(user)), ['Quick', 'Pro', 'Max', 'Ultra']);
  assert.doesNotMatch(JSON.stringify(await c.listFor(user)), /gpt|o3/);
});

test('a tier whose model the key cannot use is hidden; the default never is', async () => {
  assert.deepEqual(names(await catalog({ ids: ['gpt-4o-mini', 'gpt-5-mini'] }).c.listFor(user)), ['Quick', 'Pro']);
  assert.deepEqual(names(await catalog({ ids: [] }).c.listFor(guest)), ['Quick']);
  assert.deepEqual(names(await catalog({ env: { TIER_MAX: '' } }).c.listFor(user)), ['Quick', 'Pro', 'Ultra']);
});

test('resolve: default, allowed, sign-in needed, unknown', async () => {
  const { c } = catalog();
  assert.deepEqual(await c.resolve(guest, undefined), { tier: 'nasrinai', provider: 'openai', model: 'gpt-4o-mini', effort: null });
  assert.deepEqual(await c.resolve(guest, 'pro'), { tier: 'pro', provider: 'openai', model: 'gpt-5-mini', effort: null });
  await assert.rejects(c.resolve(guest, 'ultra'), { code: 'model_not_allowed', message: 'Sign in to use Ultra.' });
  assert.deepEqual(await c.resolve(user, 'ultra'), { tier: 'ultra', provider: 'openai', model: 'gpt-5', effort: 'high' });
  for (const bad of ['gpt-5', 'ULTRA', 42, {}]) await assert.rejects(c.resolve(user, bad), { code: 'invalid_model' });
});

test('the key\'s model list is cached; if it cannot be read, the settings are trusted', async () => {
  const ok = catalog();
  await ok.c.listFor(user); await ok.c.listFor(guest); await ok.c.resolve(user, 'max');
  assert.equal(ok.calls(), 1);
  assert.deepEqual(names(await catalog({ fail: true }).c.listFor(user)), ['Quick', 'Pro', 'Max', 'Ultra']);
});

test('a refused tier is set aside; the default cannot be', async () => {
  const { c } = catalog();
  c.markUnusable('max');
  c.markUnusable('nasrinai');
  assert.deepEqual(names(await c.listFor(user)), ['Quick', 'Pro', 'Ultra']);
});

test('OpenAI: effort per tier, a bigger allowance for more thinking, no temperature for reasoning', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }));
  };
  const p = createOpenAIProvider({ apiKey: 'sk-x', temperature: 0.3, reasoningMaxTokens: 4000, reasoningEffort: 'low', fetchImpl });
  await p.generate({ system: 's', messages: [], model: 'gpt-5', maxTokens: 800 });
  await p.generate({ system: 's', messages: [], model: 'gpt-5', reasoningEffort: 'high', maxTokens: 800 });
  await p.generate({ system: 's', messages: [], model: 'gpt-4o', maxTokens: 800 });
  assert.deepEqual([bodies[0].max_completion_tokens, bodies[0].reasoning_effort, bodies[0].temperature], [4000, 'low', undefined]);
  assert.deepEqual([bodies[1].max_completion_tokens, bodies[1].reasoning_effort], [16000, 'high']);
  assert.deepEqual([bodies[2].max_completion_tokens, bodies[2].reasoning_effort, bodies[2].temperature], [800, undefined, 0.3]);
  assert.ok(isReasoningModel('gpt-5-mini') && isReasoningModel('o3') && !isReasoningModel('gpt-5-chat-latest') && !isReasoningModel('gpt-4.1'));
});

test('OpenAI: model list request', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://api.openai.com/v1/models');
    return new Response(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'tts-1' }, {}] }));
  };
  assert.deepEqual(await createOpenAIProvider({ apiKey: 'sk-x', fetchImpl }).listModels(), ['gpt-4o', 'tts-1']);
});

test('end to end: tiers in /v1/models and /v1/chat; usage keeps the real model', async () => {
  const provider = createFakeProvider({ models: KEY_MODELS });
  const built = buildTestApp({ provider, env: { OPENAI_MODEL: 'gpt-4o-mini' } });
  const srv = await serve(built.app);
  try {
    await giveUltra(built.store);
    const g = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    const forGuest = await (await fetch(srv.url + '/v1/models', { headers: bearer(g) })).json();
    assert.deepEqual(names(forGuest), ['Quick', 'Pro']);
    assert.deepEqual(forGuest.models.filter((m) => m.locked).map((m) => [m.id, m.needs, m.plan]), [['max', 'sign_in', 'max'], ['ultra', 'sign_in', 'ultra']]);
    assert.equal((await fetch(srv.url + '/v1/models')).status, 401);

    const r = await (await postJson(srv.url + '/v1/chat', { message: 'hi', model: 'pro' }, bearer(g))).json();
    assert.equal(r.model, 'pro');
    assert.equal(provider.calls.at(-1).model, 'gpt-5-mini');
    assert.equal(built.store.usage.at(-1).model, 'gpt-5-mini');

    const refused = await postJson(srv.url + '/v1/chat', { message: 'hi', model: 'max' }, bearer(g));
    assert.equal(refused.status, 400);
    assert.equal(provider.calls.length, 1, 'refused before the model is called');

    await postJson(srv.url + '/v1/chat', { message: 'hi', model: 'ultra' }, bearer(USER_TOKEN));
    assert.deepEqual([provider.calls.at(-1).model, provider.calls.at(-1).reasoningEffort], ['gpt-5', 'high']);
    assert.equal((await (await postJson(srv.url + '/v1/chat', { message: 'hi', model: 'max' }, bearer(SECRET_KEY))).json()).model, 'max');
  } finally { await srv.close(); }
});

test('end to end: a tier refused by the provider is set aside and the caller is told', async () => {
  const provider = createFakeProvider({
    models: KEY_MODELS,
    failWith: (req) => (req.model === 'gpt-5' ? new ProviderError('config', 'not for chat', 400) : null)
  });
  const built = buildTestApp({ provider, env: { OPENAI_MODEL: 'gpt-4o-mini' } });
  await giveUltra(built.store);
  const srv = await serve(built.app);
  try {
    const r = await postJson(srv.url + '/v1/chat', { message: 'hi', model: 'max' }, bearer(USER_TOKEN));
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, 'model_unavailable');
    assert.deepEqual(names(await (await fetch(srv.url + '/v1/models', { headers: bearer(USER_TOKEN) })).json()), ['NasrinAI', 'Pro', 'Ultra']);
    assert.equal((await postJson(srv.url + '/v1/chat', { message: 'hi' }, bearer(USER_TOKEN))).status, 200);
  } finally { await srv.close(); }
});
