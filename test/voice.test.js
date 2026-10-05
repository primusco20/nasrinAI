import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAISpeech, PREVIEW_TEXT, VOICES } from '../src/ai/speech.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { ProviderError } from '../src/ai/provider.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN } from './helpers.js';

function fakeEngine({ fail = false } = {}) {
  const calls = [];
  return {
    model: 'gpt-4o-mini-tts', calls,
    async synthesize({ text, voice }) {
      calls.push({ text, voice });
      if (fail) throw new ProviderError('unavailable', 'down');
      return Buffer.from('ID3fake-mp3:' + voice);
    }
  };
}

async function withApp(opts, fn) {
  const built = buildTestApp({ provider: createFakeProvider({ reply: () => 'Here is my answer.' }), ...opts });
  const srv = await serve(built.app);
  try {
    const g = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    const chat = await (await postJson(srv.url + '/v1/chat', { message: 'hello' }, bearer(g))).json();
    await fn({ ...built, url: srv.url, g, chat });
  } finally { await srv.close(); }
}
const speak = (url, token, body) => postJson(url + '/v1/speech', body, bearer(token));

test('reads one of Nasrin\'s replies aloud as MP3, and replays from memory', async () => {
  const engine = fakeEngine();
  await withApp({ speechEngine: engine }, async ({ url, g, chat, store }) => {
    const r = await speak(url, g, { voice: 'nova', message_id: chat.message.id });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'audio/mpeg');
    assert.equal(Buffer.from(await r.arrayBuffer()).toString(), 'ID3fake-mp3:nova');
    assert.deepEqual(engine.calls, [{ text: 'Here is my answer.', voice: 'nova' }]);
    assert.equal(store.usage.at(-1).model, 'gpt-4o-mini-tts');

    await speak(url, g, { voice: 'nova', message_id: chat.message.id });
    assert.equal(engine.calls.length, 1, 'second listen served from memory');
  });
});

test('only Nasrin\'s own replies in the caller\'s own conversation can be spoken', async () => {
  const engine = fakeEngine();
  await withApp({ speechEngine: engine }, async ({ url, g, chat }) => {
    assert.equal((await speak(url, g, { voice: 'nova', message_id: chat.user_message_id })).status, 404, 'not the user\'s own words');
    assert.equal((await speak(url, USER_TOKEN, { voice: 'nova', message_id: chat.message.id })).status, 404, 'not someone else\'s');
    assert.equal((await speak(url, g, { voice: 'nova', text: 'say anything I want' })).status, 400, 'no free text');
    assert.equal((await speak(url, g, { voice: 'robot', message_id: chat.message.id })).status, 400, 'only listed voices');
    assert.equal((await postJson(url + '/v1/speech', { voice: 'nova', preview: true })).status, 401, 'needs a caller');
    assert.equal(engine.calls.length, 0);
  });
});

test('previews speak only the fixed line, once per voice', async () => {
  const engine = fakeEngine();
  await withApp({ speechEngine: engine }, async ({ url, g }) => {
    assert.equal((await speak(url, g, { voice: 'sage', preview: true, text: 'ignored' })).status, 200);
    await speak(url, g, { voice: 'sage', preview: true });
    assert.deepEqual(engine.calls, [{ text: PREVIEW_TEXT, voice: 'sage' }]);
  });
});

test('limits apply, failures are a plain 503, and status lists the voices', async () => {
  await withApp({ speechEngine: fakeEngine(), env: { LIMIT_GUEST_SPEECH_HOUR: '1' } }, async ({ url, g, chat }) => {
    assert.equal((await speak(url, g, { voice: 'nova', message_id: chat.message.id })).status, 200);
    assert.equal((await speak(url, g, { voice: 'onyx', message_id: chat.message.id })).status, 429);
    const status = await (await fetch(url + '/v1/status')).json();
    assert.equal(status.speech.available, true);
    assert.equal(status.speech.default, 'coral');
    assert.deepEqual(status.speech.voices.map((v) => v.id), VOICES.map((v) => v.id));
  });
  await withApp({ speechEngine: fakeEngine({ fail: true }) }, async ({ url, g, chat, store }) => {
    const r = await speak(url, g, { voice: 'nova', message_id: chat.message.id });
    assert.equal(r.status, 503);
    assert.equal(store.usage.at(-1).outcome, 'provider_error');
  });
  await withApp({}, async ({ url, g, chat }) => {
    assert.equal((await speak(url, g, { voice: 'nova', message_id: chat.message.id })).status, 503, 'no engine configured');
  });
});

test('OpenAI speech request shape', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return new Response(Buffer.from('mp3')); };
  const audio = await createOpenAISpeech({ apiKey: 'sk-x', fetchImpl }).synthesize({ text: 'Hi', voice: 'coral' });
  assert.equal(audio.toString(), 'mp3');
  assert.equal(sent.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(sent.body.voice, 'coral');
  assert.equal(sent.body.model, 'gpt-4o-mini-tts');
  assert.ok(sent.body.instructions);
  const old = await createOpenAISpeech({ apiKey: 'sk-x', model: 'tts-1', fetchImpl }).synthesize({ text: 'Hi', voice: 'nova' });
  assert.ok(old && !('instructions' in sent.body), 'tts-1 gets no instructions');
});
