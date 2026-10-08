import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, serve, bearer, postJson } from './helpers.js';
import { createFakeProvider } from '../src/ai/fake.js';

const realtime = {
  async session(opts) {
    return { value: 'ephemeral-test', expiresAt: 123, model: opts.model, voice: opts.voice, maxSeconds: opts.maxSeconds };
  }
};

test('realtime session follows the selected NasrinAI tier and never accepts a raw model id', async () => {
  const built = buildTestApp({
    provider: createFakeProvider({ reply: () => 'ok' }),
    realtime
  });
  const srv = await serve(built.app);
  try {
    const token = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    const quick = await (await postJson(srv.url + '/v1/realtime/session', { model: 'nasrinai', voice: 'coral' }, bearer(token))).json();
    assert.equal(quick.tier, 'nasrinai');
    assert.equal(quick.model, 'gpt-realtime-2.1-mini');
    assert.equal(quick.effort, 'low');

    const pro = await (await postJson(srv.url + '/v1/realtime/session', { model: 'pro', voice: 'coral' }, bearer(token))).json();
    assert.equal(pro.tier, 'pro');
    assert.equal(pro.model, 'gpt-realtime-2.1');
    assert.equal(pro.effort, 'low');

    const raw = await postJson(srv.url + '/v1/realtime/session', { model: 'gpt-realtime-2.1', voice: 'coral' }, bearer(token));
    assert.equal(raw.status, 400);
  } finally {
    await srv.close();
  }
});
