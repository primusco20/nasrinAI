import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/ai/router.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { ProviderError } from '../src/ai/provider.js';
import { loadConfig, ConfigError } from '../src/config.js';

const AUTO = { AI_PROVIDER: 'auto', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30), LOCAL_AI_URL: 'http://127.0.0.1:11434/v1', LOCAL_AI_MODEL: 'llama3.1:8b' };
const quiet = { info() {}, warn() {}, error() {} };

function own({ fail = null, healthy = true, vision = false } = {}) {
  const p = createFakeProvider({ models: ['llama3.1:8b'], failWith: fail });
  p.id = 'local';
  p.capabilities = () => ({ local: true, dataLeavesServer: false, vision, pdf: false });
  p.healthCheck = async () => healthy;
  return p;
}
const gpt = () => createFakeProvider({ models: ['gpt-4o-mini', 'gpt-5'], dataLeavesServer: true });
const ask = (r, spec, extra = {}) => r.generate({ system: 'S', messages: [{ role: 'user', content: 'mail me at ana@example.com' }], route: spec, ...extra });

test('config: auto mode, prefixed tiers and fallback', () => {
  const ai = loadConfig(AUTO).ai;
  assert.deepEqual(ai.tiers.nasrinai, { provider: 'local', model: 'llama3.1:8b', effort: null });
  assert.deepEqual(ai.tiers.ultra, { provider: 'openai', model: 'gpt-5', effort: 'high' });
  assert.deepEqual(ai.fallback, { provider: 'openai', model: 'gpt-4o-mini', effort: null });
  assert.equal(ai.local.timeoutMs, 40_000, 'leaves time for the fallback');
  assert.equal(ai.speech.enabled, true);
  assert.deepEqual(loadConfig({ ...AUTO, TIER_PRO: 'local:qwen2.5:14b' }).ai.tiers.pro, { provider: 'local', model: 'qwen2.5:14b', effort: null });
  assert.equal(loadConfig({ ...AUTO, AI_FALLBACK: 'none' }).ai.fallback, null);
  for (const env of [
    { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', TIER_PRO: 'local:llama3' },
    { ...AUTO, OPENAI_API_KEY: '' },
    { ...AUTO, AI_FALLBACK: 'gemini' },
    { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'k', AI_FALLBACK: 'openai' }
  ]) assert.throws(() => loadConfig(env), ConfigError, JSON.stringify(env));
});

test('auto: the own model answers, unredacted', async () => {
  const local = own(); const openai = gpt();
  const r = createRouter({ providers: { local, openai }, config: loadConfig(AUTO), logger: quiet });
  const out = await ask(r, { provider: 'local', model: 'llama3.1:8b' });
  assert.deepEqual([out.provider, out.model, out.fallback], ['local', 'llama3.1:8b', false]);
  assert.match(local.calls[0].messages[0].content, /ana@example\.com/);
  assert.equal(openai.calls.length, 0);
  assert.deepEqual(r.capabilities(), { local: true, dataLeavesServer: true, vision: true, pdf: true });
});

test('auto: own model down or failing -> GPT fallback, redacted; then skipped for a while', async () => {
  const local = own({ fail: 'unavailable' }); const openai = gpt();
  const r = createRouter({ providers: { local, openai }, config: loadConfig(AUTO), logger: quiet });
  const out = await ask(r, { provider: 'local', model: 'llama3.1:8b' });
  assert.deepEqual([out.provider, out.model, out.fallback], ['fake', 'gpt-4o-mini', true]);
  assert.doesNotMatch(openai.calls[0].messages[0].content, /ana@example\.com/, 'redacted for the outside model');
  await ask(r, { provider: 'local', model: 'llama3.1:8b' });
  assert.equal(local.calls.length, 1, 'a down own model is skipped');

  const down = createRouter({ providers: { local: own({ healthy: false }), openai: gpt() }, config: loadConfig(AUTO), logger: quiet });
  assert.equal((await ask(down, { provider: 'local', model: 'llama3.1:8b' })).fallback, true);
  assert.equal(await down.healthCheck(), true, 'GPT can still answer');
});

test('auto: files the own model cannot read go to GPT; AI_FALLBACK=none keeps everything local', async () => {
  const local = own(); const openai = gpt();
  const r = createRouter({ providers: { local, openai }, config: loadConfig(AUTO), logger: quiet });
  const out = await ask(r, { provider: 'local', model: 'llama3.1:8b' }, { attachments: [{ kind: 'pdf', mime: 'application/pdf', name: 'a.pdf', data: 'JVBE' }] });
  assert.equal(out.fallback, true);

  const strict = createRouter({ providers: { local: own({ fail: 'timeout' }), openai: gpt() }, config: loadConfig({ ...AUTO, AI_FALLBACK: 'none' }), logger: quiet });
  await assert.rejects(ask(strict, { provider: 'local', model: 'llama3.1:8b' }), (e) => e instanceof ProviderError && e.provider === 'local');
});

test('GPT tiers go straight to GPT; config errors are not retried elsewhere', async () => {
  const local = own(); const openai = createFakeProvider({ models: ['gpt-5'], dataLeavesServer: true, failWith: 'config' });
  const r = createRouter({ providers: { local, openai }, config: loadConfig(AUTO), logger: quiet });
  await assert.rejects(ask(r, { provider: 'openai', model: 'gpt-5', effort: 'high' }), (e) => e.kind === 'config' && e.model === 'gpt-5');
  assert.equal(local.calls.length, 0);
  assert.deepEqual(await r.listModels(), ['local:llama3.1:8b', 'openai:gpt-5']);
});
