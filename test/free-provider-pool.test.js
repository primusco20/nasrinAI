import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { providerFromConfig } from '../src/ai/registry.js';
import { createRouter } from '../src/ai/router.js';
import { createPolicy } from '../src/ai/policy.js';
import { createBudget } from '../src/ai/budget.js';
import { loadPrices } from '../src/ai/pricing.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { createCloudflareWorkersAIProvider } from '../src/ai/cloudflare-workers-ai.js';
import { createCohereProvider } from '../src/ai/cohere.js';

const quiet = { info() {}, warn() {}, error() {} };

test('free provider pool enables only keyed providers with pinned models', () => {
  const config = loadConfig({
    AI_PROVIDER: 'none',
    GROQ_API_KEY: 'test-groq-key',
    GROQ_MODEL: 'llama-3.3-70b-versatile',
    GROQ_FREE_MODELS: 'llama-3.3-70b-versatile,llama-3.1-8b-instant'
  });
  assert.equal(config.ai.freeProviders.length, 1);
  assert.equal(config.ai.freeProviders[0].id, 'groq');
  assert.deepEqual(config.ai.routing.levels[1].slice(0, 2), [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', effort: null },
    { provider: 'groq', model: 'llama-3.1-8b-instant', effort: null }
  ]);
  assert.ok(config.ai.fallback.providers.includes('groq'));
  assert.ok(providerFromConfig(config, { logger: quiet }).providerIds.includes('groq'));
});

test('free model pricing requires an exact allowlist match', async () => {
  const config = loadConfig({
    AI_PROVIDER: 'none',
    GROQ_API_KEY: 'test-groq-key',
    GROQ_MODEL: 'llama-3.3-70b-versatile',
    GROQ_FREE_MODELS: 'llama-3.3-70b-versatile'
  });
  const fake = createFakeProvider({ models: ['llama-3.3-70b-versatile'] });
  fake.id = 'groq';
  fake.capabilities = () => ({ local: false, dataLeavesServer: true, vision: false, pdf: false, tools: false, trainsOnData: false });
  const router = createRouter({ providers: { groq: fake }, config, logger: quiet });
  const store = createMemoryStore();
  const budget = createBudget({ store, config, logger: quiet });
  const policy = createPolicy({ config, provider: router, prices: loadPrices(), budget, logger: quiet, sleep: async () => {} });
  const plan = policy.plan({ tier: 'nasrinai', message: 'hello', history: [] });
  const run = await policy.run(plan, { system: 'S', messages: [{ role: 'user', content: 'hello' }], attachments: [] });
  assert.equal(run.spec.provider, 'groq');
  assert.equal(run.costUsd, 0);

  const paidModelConfig = loadConfig({
    AI_PROVIDER: 'none',
    GROQ_API_KEY: 'test-groq-key',
    GROQ_MODEL: 'llama-3.3-70b-versatile',
    GROQ_FREE_MODELS: 'another-model'
  });
  assert.equal(paidModelConfig.ai.routing.freeModels.groq.includes('llama-3.3-70b-versatile'), false);
  assert.equal(paidModelConfig.ai.routing.levels[1].some((s) => s.provider === 'groq' && s.model === 'llama-3.3-70b-versatile'), false);
});

test('free provider credentials never become available from browser-facing config fields', () => {
  const config = loadConfig({
    AI_PROVIDER: 'none',
    GROQ_API_KEY: 'test-groq-key',
    GROQ_MODEL: 'llama-3.3-70b-versatile',
    GROQ_FREE_MODELS: 'llama-3.3-70b-versatile'
  });
  assert.equal(JSON.stringify(config.ai.routing).includes('test-groq-key'), false);
});

test('Gemini can run as a free-only provider without an OpenAI key', () => {
  const config = loadConfig({ AI_PROVIDER: 'none', GEMINI_API_KEY: 'test-gemini-key' });
  assert.equal(config.ai.routing.mode, 'smart');
  assert.ok(config.ai.routing.levels[1].some((s) => s.provider === 'gemini'));
  assert.ok(providerFromConfig(config, { logger: quiet }).providerIds.includes('gemini'));
});

test('Cloudflare Workers AI adapter maps its account-scoped response', async () => {
  let calledUrl = '';
  let sentBody = null;
  const provider = createCloudflareWorkersAIProvider({
    apiKey: 'test-cloudflare-key',
    accountId: 'account-123',
    model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    fetchImpl: async (url, options) => {
      calledUrl = String(url);
      sentBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ result: { response: 'Cloudflare reply', usage: { prompt_tokens: 2, completion_tokens: 3 } } }), { status: 200 });
    }
  });
  const out = await provider.generate({ system: 'system', messages: [{ role: 'user', content: 'hello' }], maxTokens: 100 });
  assert.ok(calledUrl.includes('/accounts/account-123/ai/run/'));
  assert.ok(calledUrl.includes('llama-3.3-70b-instruct-fp8-fast'));
  assert.equal(sentBody.max_tokens, 100);
  assert.equal(out.text, 'Cloudflare reply');
  assert.equal(out.inputTokens, 2);
  assert.equal(out.outputTokens, 3);
});

test('Cohere v2 adapter maps text and usage without leaking its key', async () => {
  let sentHeaders = null;
  const provider = createCohereProvider({
    apiKey: 'test-cohere-key',
    model: 'command-r7b-12-2024',
    fetchImpl: async (_url, options) => {
      sentHeaders = options.headers;
      return new Response(JSON.stringify({
        message: { content: [{ type: 'text', text: 'Cohere reply' }] },
        usage: { billed_units: { input_tokens: 4, output_tokens: 5 } },
        finish_reason: 'COMPLETE'
      }), { status: 200 });
    }
  });
  const out = await provider.generate({ system: 'system', messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(sentHeaders.Authorization, 'Bearer test-cohere-key');
  assert.equal(out.text, 'Cohere reply');
  assert.equal(out.inputTokens, 4);
  assert.equal(out.outputTokens, 5);
  assert.equal(out.finishReason, 'COMPLETE');
});
