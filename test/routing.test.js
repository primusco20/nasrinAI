import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/ai/classify.js';
import { answerWithLogic } from '../src/ai/logic.js';
import { createPolicy } from '../src/ai/policy.js';
import { createRouter } from '../src/ai/router.js';
import { createBudget } from '../src/ai/budget.js';
import { loadPrices, priceOf, costOf } from '../src/ai/pricing.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { ProviderError } from '../src/ai/provider.js';
import { loadConfig } from '../src/config.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN } from './helpers.js';

const quiet = { info() {}, warn() {}, error() {} };
const ENV = { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30), GEMINI_API_KEY: 'g-key' };
const PLATFORM = '00000000-0000-0000-0000-000000000001';

// A router over pretend providers: gemini (free tier, trains on data) and openai.
function setup({ env = {}, openaiFail = null, geminiFail = null, reply } = {}) {
  const config = loadConfig({ ...ENV, ...env });
  const gemini = createFakeProvider({ models: ['gemini-3.1-flash-lite'], dataLeavesServer: true, failWith: geminiFail, reply });
  gemini.capabilities = () => ({ local: false, dataLeavesServer: true, vision: true, pdf: false, trainsOnData: true });
  const openai = createFakeProvider({ models: ['gpt-6-luna'], dataLeavesServer: true, failWith: openaiFail, reply });
  const router = createRouter({ providers: { gemini, openai }, config, logger: quiet });
  const store = createMemoryStore();
  const budget = createBudget({ store, config, logger: quiet });
  const policy = createPolicy({ config, provider: router, prices: loadPrices(), budget, logger: quiet, sleep: async () => {} });
  return { config, gemini, openai, policy, store };
}
const req = (content) => ({ system: 'S', messages: [{ role: 'user', content }], attachments: [] });

test('logic tier: arithmetic, percentages and email checks need no model', () => {
  assert.equal(answerWithLogic('Calculate 20% of 500').text, '20% of 500 is 100.');
  assert.equal(answerWithLogic('what is (12.5 + 3) * 4?').text, '(12.5 + 3) * 4 = 62');
  assert.equal(answerWithLogic('2^10').text, '2^10 = 1,024');
  assert.match(answerWithLogic('is ana@example.com a valid email?').text, /^Yes/);
  assert.match(answerWithLogic('is ana@@x a valid email').text, /^No/);
  for (const q of ['what is love', 'calculate my taxes for 2025', '2024', 'process.exit(1)', 'what is 1/0']) assert.equal(answerWithLogic(q), null, q);
});

test('classifier: simple, moderate, complex, extreme', () => {
  assert.equal(classify({ message: 'hi!' }).level, 1);
  assert.equal(classify({ message: 'Translate "thank you for waiting" into Bisaya' }).level, 1);
  assert.equal(classify({ message: 'Write a javascript function that sorts names' }).level, 2);
  assert.equal(classify({ message: 'My python code fails with TypeError: NoneType, can you debug it?' }).level, 3);
  assert.equal(classify({ message: 'Design the authentication architecture and database schema for a multi-tenant SaaS' }).level, 4);
  assert.equal(classify({ message: 'Plan an end-to-end architecture redesign of the entire codebase' }).level, 5);
});

test('routing: cheapest capable model; tiers cap the level; private data never goes to a free tier', async () => {
  const a = setup();
  const p = a.policy.plan({ tier: 'nasrinai', message: 'hello', history: [] });
  let run = await a.policy.run(p, req('hello'));
  assert.deepEqual([run.level, run.spec.provider, run.spec.model, run.costUsd], [1, 'gemini', 'gemini-3.1-flash-lite', 0], 'free tier first');

  const hard = a.policy.plan({ tier: 'nasrinai', message: 'Design the database schema architecture for a multi-tenant app' });
  assert.equal(hard.wanted, 4);
  assert.equal(hard.level, 2, 'NasrinAI tier goes up to level 2');
  assert.equal(a.policy.plan({ tier: 'ultra', message: 'Design the database schema architecture for a multi-tenant app' }).level, 4);

  const priv = a.policy.plan({ tier: 'nasrinai', message: 'email me at ana@example.com', history: [] });
  assert.equal(priv.sensitive, true);
  run = await a.policy.run(priv, req('email me at [email]'));
  assert.equal(run.spec.provider, 'openai', 'skips the free tier that trains on data');
  assert.equal(a.gemini.calls.length, 1);
});

test('budget: over a limit downgrades; nothing affordable blocks; unknown spend stays cheap', async () => {
  const a = setup({ env: { GEMINI_API_KEY: '' } });
  const plan = a.policy.plan({ tier: 'ultra', message: 'Plan an end-to-end architecture redesign of the entire codebase' });
  assert.equal(plan.level, 5);
  const run = await a.policy.run(plan, req('x'));
  assert.ok(run.level < 5, 'astra is over the $0.05 per-request limit, so it downgrades');
  assert.ok(run.costUsd < 0.05);

  const broke = setup({ env: { GEMINI_API_KEY: '', DAILY_BUDGET_USD: '0' } });
  await assert.rejects(broke.policy.run(broke.policy.plan({ tier: 'pro', message: 'hello' }), req('hello')), { code: 'budget_reached' });

  const free = setup({ env: { DAILY_BUDGET_USD: '0' } });
  const ok = await free.policy.run(free.policy.plan({ tier: 'pro', message: 'hello' }), req('hello'));
  assert.equal(ok.spec.provider, 'gemini', 'a free model still answers when the budget is used up');

  const unknown = setup({ env: { GEMINI_API_KEY: '' } });
  unknown.store.costSince = async () => { throw new Error('db down'); };
  const u = unknown.policy.plan({ tier: 'ultra', message: 'Design a scalable distributed system architecture' });
  const ur = await unknown.policy.run(u, req('x'));
  assert.equal(ur.level, 1, 'only the cheapest level until spend can be read');
});

test('escalation is bounded; failover respects privacy', async () => {
  let n = 0;
  const a = setup({ env: { GEMINI_API_KEY: '' }, reply: async () => (++n === 1 ? '' : 'Here is a full answer.') });
  const run = await a.policy.run(a.policy.plan({ tier: 'pro', message: 'hello' }), req('hello'));
  assert.deepEqual([run.level, run.escalated, run.result.text], [2, true, 'Here is a full answer.']);

  const always = setup({ env: { GEMINI_API_KEY: '', MAX_ESCALATION_DEPTH: '1' }, reply: async () => '' });
  const r2 = await always.policy.run(always.policy.plan({ tier: 'ultra', message: 'hello' }), req('hello'));
  assert.equal(always.openai.calls.length, 2, 'one escalation, then stop');
  assert.equal(r2.result.text, '');

  const down = setup({ geminiFail: 'unavailable' });
  const f = await down.policy.run(down.policy.plan({ tier: 'nasrinai', message: 'hello' }), req('hello'));
  assert.equal(f.spec.provider, 'openai', 'gemini down -> next candidate');

  const both = setup({ geminiFail: 'unavailable', openaiFail: 'unavailable' });
  await assert.rejects(both.policy.run(both.policy.plan({ tier: 'nasrinai', message: 'hello' }), req('hello')), (e) => e instanceof ProviderError);
  assert.equal(both.gemini.calls.length + both.openai.calls.length, 2, 'retries are limited');
});

test('response cache: same first public question hits; different misses; private never cached', () => {
  const a = setup();
  const plan = a.policy.plan({ tier: 'nasrinai', message: 'What is the capital of Japan?', history: [] });
  const k = a.policy.cacheKey(plan, { history: [{}], attachments: [], message: 'What is the capital of Japan?' });
  a.policy.remember(k, { text: 'Tokyo.', provider: 'gemini', model: 'x' });
  assert.equal(a.policy.cached(a.policy.cacheKey(plan, { history: [{}], attachments: [], message: 'what is the  capital of japan?' })).text, 'Tokyo.');
  assert.equal(a.policy.cached(a.policy.cacheKey(plan, { history: [{}], attachments: [], message: 'What is the capital of Korea?' })), null);
  const priv = a.policy.plan({ tier: 'nasrinai', message: 'call me at 0917 123 4567', history: [] });
  assert.equal(a.policy.cacheKey(priv, { history: [{}], attachments: [], message: 'call me at 0917 123 4567' }), null);
  assert.equal(a.policy.cacheKey(plan, { history: [{}, {}, {}], attachments: [], message: 'x' }), null, 'not mid-conversation');
});

test('pricing: from the price file; unknown models are never assumed free', () => {
  const t = loadPrices();
  assert.equal(costOf(priceOf(t, 'openai', 'gpt-6-luna'), { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 0.6);
  assert.equal(priceOf(t, 'openai', 'gpt-9-imaginary'), null);
  assert.equal(priceOf(t, 'gemini', 'gemini-3.1-flash-lite', { freeTier: true }).output, 0);
  assert.equal(priceOf(loadPrices('{"openai":{"gpt-6-luna":{"input":1,"output":2}}}'), 'openai', 'gpt-6-luna').output, 2);
});

test('end to end: logic answers without a model; smart routing records telemetry', async () => {
  const provider = createFakeProvider({ models: ['gpt-6-luna'] });
  const built = buildTestApp({ provider, env: { ROUTING: 'smart', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30) } });
  const srv = await serve(built.app);
  try {
    const m = await (await postJson(srv.url + '/v1/chat', { message: 'what is 15% of 80?' }, bearer(USER_TOKEN))).json();
    assert.equal(m.message.content, '15% of 80 is 12.');
    assert.equal(provider.calls.length, 0);
    assert.deepEqual([built.store.usage.at(-1).provider, built.store.usage.at(-1).level], ['logic', 0]);

    await postJson(srv.url + '/v1/chat', { message: 'Tell me a fun fact about the sea' }, bearer(USER_TOKEN));
    const e = built.store.usage.at(-1);
    assert.deepEqual([e.model, e.level, e.task, e.outcome], ['gpt-6-luna', 1, 'chat', 'ok']);
    assert.equal(provider.calls.at(-1).maxTokens, 700, 'level 1 reply allowance');
    assert.ok(e.costUsd > 0 && e.costUsd < 0.001);

    await postJson(srv.url + '/v1/chat', { message: 'Tell me a fun fact about the sea' }, bearer(USER_TOKEN));
    assert.equal(built.store.usage.at(-1).cacheHit, true);
    assert.equal(provider.calls.length, 1, 'same first question answered from cache');
  } finally { await srv.close(); }
});

test('a brief outage of the only model: one retry after a short wait, then a clear failure', async () => {
  let n = 0;
  const once = setup({ env: { GEMINI_API_KEY: '', ROUTE_LEVEL_1: 'openai:gpt-6-luna' }, openaiFail: () => (++n === 1 ? new ProviderError('unavailable', 'blip', 503) : null) });
  const plan = { task: 'chat', level: 1, floor: 1, ceiling: 1, sensitive: false };
  const run = await once.policy.run(plan, req('hello'));
  assert.equal(run.result.text, 'You said: hello');
  assert.equal(n, 2, 'one retry');

  let m = 0;
  const down = setup({ env: { GEMINI_API_KEY: '', ROUTE_LEVEL_1: 'openai:gpt-6-luna' }, openaiFail: () => { m++; return new ProviderError('unavailable', 'down', 503); } });
  await assert.rejects(down.policy.run(plan, req('hello')), { kind: 'unavailable' });
  assert.equal(m, 2, 'bounded: no loop');
});


test('Claude is isolated to Max/Ultra coding, with Opus reserved for deep Ultra work', async () => {
  const env = {
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30),
    ANTHROPIC_API_KEY: 'anthropic-test',
    GEMINI_API_KEY: ''
  };
  const config = loadConfig(env);
  assert.deepEqual(config.ai.routing.coding.max, { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: null });
  assert.deepEqual(config.ai.routing.coding.ultra, { provider: 'anthropic', model: 'claude-sonnet-5-5', effort: null });
  assert.deepEqual(config.ai.routing.coding.ultraDeep, { provider: 'anthropic', model: 'claude-opus-5-5', effort: null });
  assert.ok(Object.values(config.ai.routing.levels).flat().every((s) => s.provider !== 'anthropic'));

  const anthropic = createFakeProvider({ models: ['claude-sonnet-5-5', 'claude-opus-5-5'], dataLeavesServer: true });
  anthropic.id = 'anthropic';
  anthropic.capabilities = () => ({ local: false, dataLeavesServer: true, vision: true, pdf: true, tools: false, trainsOnData: false });
  const openai = createFakeProvider({ models: ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-6.1-sol', 'gpt-6-astra'], dataLeavesServer: true });
  const router = createRouter({ providers: { anthropic, openai }, config, logger: quiet });
  const store = createMemoryStore();
  const budget = createBudget({ store, config, logger: quiet });
  const policy = createPolicy({ config, provider: router, prices: loadPrices(), budget, logger: quiet, sleep: async () => {} });

  const quick = await policy.run(policy.plan({ tier: 'nasrinai', message: 'Write a javascript function that sorts names' }), req('Write a javascript function that sorts names'));
  assert.equal(quick.spec.provider, 'openai');

  const max = await policy.run(policy.plan({ tier: 'max', message: 'Fix this TypeScript bug and explain the regression' }), req('Fix this TypeScript bug and explain the regression'));
  assert.deepEqual([max.spec.provider, max.spec.model], ['anthropic', 'claude-sonnet-5-5']);

  const ultraModerate = await policy.run(policy.plan({ tier: 'ultra', message: 'Fix this TypeScript bug and explain the regression' }), req('Fix this TypeScript bug and explain the regression'));
  assert.deepEqual([ultraModerate.spec.provider, ultraModerate.spec.model], ['anthropic', 'claude-sonnet-5-5']);

  const ultraDeep = await policy.run(policy.plan({ tier: 'ultra', message: 'Perform an end-to-end architecture refactor of the entire codebase and migrate the authentication system' }), req('Perform an end-to-end architecture refactor of the entire codebase and migrate the authentication system'));
  assert.deepEqual([ultraDeep.spec.provider, ultraDeep.spec.model], ['anthropic', 'claude-opus-5-5']);

  const ultraNonCode = await policy.run(policy.plan({ tier: 'ultra', message: 'Write a polished announcement for our new product' }), req('Write a polished announcement for our new product'));
  assert.notEqual(ultraNonCode.spec.provider, 'anthropic');
});
