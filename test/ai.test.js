import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIProvider } from '../src/ai/openai.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { ProviderError, assertProvider } from '../src/ai/provider.js';
import { providerFromConfig } from '../src/ai/registry.js';
import { buildSystemPrompt, fitHistory } from '../src/ai/prompt.js';
import { cleanReply, cleanUserText } from '../src/ai/output.js';
import { redactForProvider } from '../src/ai/redact.js';
import { loadConfig, ConfigError } from '../src/config.js';

const KEY = 'sk-test-' + 'k'.repeat(30);

function openaiWith(answer) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body && JSON.parse(init.body) });
    return typeof answer === 'function' ? answer() : answer;
  };
  return { provider: createOpenAIProvider({ apiKey: KEY, model: 'gpt-4o-mini', fetchImpl }), calls };
}

test('OpenAI: request shape and usage mapping', async () => {
  const { provider, calls } = openaiWith(new Response(JSON.stringify({
    choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3 }
  })));
  assertProvider(provider);
  const out = await provider.generate({ system: 'S', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100 });
  assert.deepEqual(out, { text: 'Hello!', inputTokens: 12, outputTokens: 3, finishReason: 'stop', model: 'gpt-4o-mini' });
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.deepEqual(calls[0].body.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'hi' }]);
  assert.equal(calls[0].body.max_completion_tokens, 100);
  assert.equal('temperature' in calls[0].body, false, 'temperature only sent when configured');
  assert.equal(provider.capabilities().dataLeavesServer, true);
});

test('OpenAI: failures become ProviderErrors that never contain the key', async () => {
  const cases = [
    [new Response('{"error":"bad key"}', { status: 401 }), 'config'],
    [new Response('{"error":"slow down"}', { status: 429 }), 'busy'],
    [new Response('oops', { status: 503 }), 'unavailable']
  ];
  for (const [resp, kind] of cases) {
    const { provider } = openaiWith(resp);
    await assert.rejects(provider.generate({ system: 'S', messages: [] }), (e) => {
      assert.ok(e instanceof ProviderError);
      assert.equal(e.kind, kind);
      assert.ok(!e.message.includes(KEY));
      return true;
    });
  }
  const { provider } = openaiWith(() => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; });
  await assert.rejects(provider.generate({ system: 'S', messages: [] }), { kind: 'timeout' });
});

test('provider choice: none by default; openai needs a key; fake never in production', () => {
  assert.equal(providerFromConfig(loadConfig({})), null);
  assert.throws(() => loadConfig({ AI_PROVIDER: 'openai' }), ConfigError);
  assert.deepEqual(providerFromConfig(loadConfig({ AI_PROVIDER: 'openai', OPENAI_API_KEY: KEY })).providerIds, ['openai']);
  assert.deepEqual(providerFromConfig(loadConfig({ AI_PROVIDER: 'fake' })).providerIds, ['fake']);
  assert.throws(() => loadConfig({ AI_PROVIDER: 'fake', NODE_ENV: 'production' }), ConfigError);
  assert.throws(() => loadConfig({ AI_PROVIDER: 'gpt-9' }), ConfigError);
  assert.throws(() => loadConfig({ OPENAI_TEMPERATURE: '5' }), ConfigError);
});

test('system prompt: general assistant, dated, no restaurant or secrets', () => {
  const p = buildSystemPrompt({ now: new Date('2026-10-05T03:00:00Z') });
  assert.match(p, /NasrinAI/);
  assert.match(p, /October 5, 2026/);
  assert.doesNotMatch(p, /burger|menu|order|Crazy Bite|sk-/i);
});

test('history: newest messages within budget, starting with a user turn', () => {
  const msgs = [
    { role: 'user', content: 'a'.repeat(50) }, { role: 'assistant', content: 'b'.repeat(50) },
    { role: 'user', content: 'c'.repeat(50) }, { role: 'assistant', content: 'd'.repeat(50) },
    { role: 'user', content: 'e'.repeat(10) }
  ];
  const kept = fitHistory(msgs, 120);
  assert.equal(kept.at(-1).content, 'e'.repeat(10));
  assert.equal(kept[0].role, 'user');
  assert.ok(kept.reduce((n, m) => n + m.content.length, 0) <= 120);
  assert.equal(fitHistory([{ role: 'user', content: 'x'.repeat(500) }], 10).length, 1, 'the latest message is always kept');
});

test('model output is cleaned and capped; empty output is rejected', () => {
  assert.equal(cleanReply('  hi\r\nthere\u0000‮  '), 'hi\nthere');
  assert.equal(cleanReply(''), null);
  assert.equal(cleanReply('   ​ '), null);
  assert.equal(cleanReply(42), null);
  assert.equal(cleanReply('x'.repeat(20), 10), 'x'.repeat(10) + '…');
  assert.equal(cleanUserText('hello', 4), null, 'too long is refused, not cut');
  assert.equal(cleanUserText(' ok ', 10), 'ok');
});

test('redaction: contact and card details are removed, ordinary numbers are kept', () => {
  const out = redactForProvider('Mail me at ana.cruz@example.ph or call 0917 123 4567 / +63 917-123-4567, card 4111 1111 1111 1111.');
  assert.doesNotMatch(out, /ana\.cruz|0917|917-123|4111/);
  assert.match(out, /\[email\].*\[phone\].*\[phone\].*\[card number\]/);
  assert.match(redactForProvider('+1 415 555 0132'), /\[phone\]/);

  const plain = 'In 2026 we sold 1,250,000 units for PHP 3500.50; order #20261005123 shipped. 1234567890123 is not a card.';
  assert.equal(redactForProvider(plain), plain);
});

test('the fake provider is local and records requests', async () => {
  const fake = createFakeProvider();
  const out = await fake.generate({ system: 's', messages: [{ role: 'user', content: 'ping' }] });
  assert.equal(out.text, 'You said: ping');
  assert.equal(fake.capabilities().dataLeavesServer, false);
  assert.equal(fake.calls.length, 1);
});
