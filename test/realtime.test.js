import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRealtime } from '../src/realtime.js';

test('realtime creates a short-lived client secret without exposing the API key', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return new Response(JSON.stringify({ value: 'ek_test_secret', expires_at: 12345 }), { status: 200 });
  };
  const rt = createRealtime({ apiKey: 'sk-secret', fetchImpl });
  const out = await rt.session({ model: 'gpt-realtime-2.1', voice: 'coral', reasoningEffort: 'high', maxOutputTokens: 1800 });
  assert.equal(out.value, 'ek_test_secret');
  assert.equal(sent.url, 'https://api.openai.com/v1/realtime/client_secrets');
  assert.equal(sent.init.headers.Authorization, 'Bearer sk-secret');
  const body = JSON.parse(sent.init.body);
  assert.equal(body.session.model, 'gpt-realtime-2.1');
  assert.equal(body.session.audio.output.voice, 'coral');
  assert.equal(body.session.reasoning.effort, 'high');
  assert.equal(body.session.max_output_tokens, 1800);
  assert.equal(body.session.type, 'realtime');
});

test('realtime defaults to a bounded output-token allowance', async () => {
  let sent;
  const rt = createRealtime({ apiKey: 'sk-secret', fetchImpl: async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ value: 'ek_test_secret' }), { status: 200 });
  } });
  await rt.session({ model: 'gpt-realtime-2.1', voice: 'coral' });
  assert.equal(sent.session.max_output_tokens, 512);
});

test('realtime rejects arbitrary models and voices', async () => {
  const rt = createRealtime({ apiKey: 'sk-secret', fetchImpl: async () => new Response('{}') });
  await assert.rejects(rt.session({ model: 'gpt-5', voice: 'coral' }), /Realtime model is not allowed/);
  await assert.rejects(rt.session({ model: 'gpt-realtime-2.1', voice: 'robot' }), /Realtime voice is not allowed/);
});
