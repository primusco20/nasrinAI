import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnthropicProvider } from '../src/ai/anthropic.js';

test('Anthropic provider maps Messages API output and cache usage', async () => {
  const calls = [];
  const p = createAnthropicProvider({
    apiKey: 'sk-ant-test',
    model: 'claude-haiku-5-5',
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return Response.json({
        content: [{ type: 'text', text: 'Hello from Claude.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 12, cache_read_input_tokens: 4, output_tokens: 7 }
      });
    }
  });
  const out = await p.generate({ system: 'Be concise.', messages: [{ role: 'user', content: 'Hello' }], maxTokens: 100 });
  assert.equal(out.text, 'Hello from Claude.');
  assert.deepEqual([out.inputTokens, out.cachedTokens, out.outputTokens], [12, 4, 7]);
  assert.equal(calls[0].body.model, 'claude-haiku-5-5');
  assert.equal(calls[0].headers['x-api-key'], 'sk-ant-test');
});

test('Anthropic provider exposes no tool capability until the adapter is explicitly enabled', () => {
  const p = createAnthropicProvider({ apiKey: 'sk-ant-test' });
  assert.equal(p.capabilities().tools, false);
  assert.equal(p.capabilities().trainsOnData, false);
});
