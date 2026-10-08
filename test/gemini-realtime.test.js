import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiRealtime } from '../src/gemini-realtime.js';

test('Gemini realtime mints a constrained ephemeral token', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return new Response(JSON.stringify({ name: 'auth_tokens/test-token' }), { status: 200 });
  };
  const rt = createGeminiRealtime({ apiKey: 'test-key', fetchImpl });
  const out = await rt.session({ model: 'gemini-3.8-live', voice: 'Kore', maxSeconds: 300 });
  assert.equal(out.value, 'auth_tokens/test-token');
  assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/auth_tokens');
  assert.equal(sent.init.headers['x-goog-api-key'], 'test-key');
  const body = JSON.parse(sent.init.body);
  assert.equal(body.uses, 1);
  assert.equal(body.liveConnectConstraints.model, 'gemini-3.8-live');
  assert.deepEqual(body.liveConnectConstraints.config.responseModalities, ['AUDIO']);
  assert.ok(body.liveConnectConstraints.config.sessionResumption);
});

test('Gemini realtime rejects arbitrary models and voices', async () => {
  const rt = createGeminiRealtime({ apiKey: 'test-key', fetchImpl: async () => new Response('{}') });
  await assert.rejects(rt.session({ model: 'gemini-3.8-flash', voice: 'Kore' }), /Gemini realtime model is not allowed/);
  await assert.rejects(rt.session({ model: 'gemini-3.8-live', voice: 'robot' }), /Gemini realtime voice is not allowed/);
});
