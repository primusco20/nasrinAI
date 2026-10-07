import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAISpeech, PREVIEW_TEXT, VOICES } from '../src/ai/speech.js';
import { speechFilter } from '../src/ai/speech-text.js';
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
  assert.equal('speed' in sent.body, false, 'normal speed sends nothing extra');
});

test('read-aloud speed (SPEECH_RATE): words for gpt-4o voices, a number for tts-1, checked config', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return new Response(Buffer.from('mp3')); };
  await createOpenAISpeech({ apiKey: 'sk-x', rate: 1.15, fetchImpl }).synthesize({ text: 'Hi', voice: 'coral' });
  assert.match(sent.instructions, /slightly brisk pace/);
  assert.equal('speed' in sent, false, 'gpt-4o voices are told in words, not given a speed');
  await createOpenAISpeech({ apiKey: 'sk-x', rate: 1.4, fetchImpl }).synthesize({ text: 'Hi', voice: 'coral' });
  assert.match(sent.instructions, /quick, lively pace/);
  await createOpenAISpeech({ apiKey: 'sk-x', model: 'tts-1', rate: 1.3, fetchImpl }).synthesize({ text: 'Hi', voice: 'nova' });
  assert.equal(sent.speed, 1.3);

  const { loadConfig } = await import('../src/config.js');
  const cfg = (v) => loadConfig({ NODE_ENV: 'test', SPEECH_RATE: v });
  assert.equal(cfg(undefined).ai.speech.rate, 1.15, 'a little faster than normal by default');
  assert.equal(cfg('1.3').ai.speech.rate, 1.3);
  assert.equal(cfg('fast').ai.speech.rate, 1.15, 'a bad value warns and keeps the default');
  assert.match(cfg('9').warnings.join(' '), /SPEECH_RATE/);
});

test('long replies are read in parts: a short first part, Markdown removed', async () => {
  const engine = fakeEngine();
  const long = '## Steps\n1. **Unplug** the router. ' + 'Then wait a little while for it to restart fully. '.repeat(30) + '\n```\nping 8.8.8.8\n```';
  const built = buildTestApp({ provider: createFakeProvider({ reply: () => long }), speechEngine: engine });
  const srv = await serve(built.app);
  try {
    const g = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    const chat = await (await postJson(srv.url + '/v1/chat', { message: 'hello' }, bearer(g))).json();
    const r = await speak(srv.url, g, { voice: 'nova', message_id: chat.message.id, part: 0 });
    const parts = Number(r.headers.get('x-speech-parts'));
    assert.ok(parts >= 2, 'split into parts');
    assert.ok(engine.calls[0].text.length <= 260, 'first part is short so it starts fast');
    assert.doesNotMatch(engine.calls[0].text, /\*\*|##/);
    const lastPart = await speak(srv.url, g, { voice: 'nova', message_id: chat.message.id, part: parts - 1 });
    assert.equal(lastPart.status, 200);
    assert.match(engine.calls.at(-1).text, /code is shown on screen/);
    assert.equal((await speak(srv.url, g, { voice: 'nova', message_id: chat.message.id, part: parts })).status, 400);
    assert.equal((await speak(srv.url, g, { voice: 'nova', message_id: chat.message.id, part: -1 })).status, 400);
  } finally { await srv.close(); }
});

// ---- talking with Nasrin: speech while the reply is being written, quick model ----

test('speech filter: files, questions and code are not read out, even across pieces', () => {
  const f = speechFilter();
  assert.equal(f('Sure, here it is. '), 'Sure, here it is.');
  assert.match(f('[[file name="a.md"]]# Title\n- one'), /file is ready/);
  assert.equal(f(' two - three'), '', 'still inside the file');
  assert.equal(f('[[/file]] All done. '), 'All done.');
  assert.match(f('Try ```js\nlet x'), /code is shown/);
  assert.equal(f('= 1;```'), '');
  assert.equal(f(' Cool.'), 'Cool.');
});

test('quick voice model: used when asked, the normal one answers if it will not take the voice', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push(body.model);
    if (body.model === 'tts-1' && body.voice === 'verse') return new Response('bad voice', { status: 400 });
    return new Response(Buffer.from('mp3:' + body.model));
  };
  const engine = createOpenAISpeech({ apiKey: 'sk-x', model: 'gpt-4o-mini-tts', fastModel: 'tts-1', rate: 1.15, fetchImpl });
  assert.equal((await engine.synthesize({ text: 'Hi', voice: 'coral', fast: true })).toString(), 'mp3:tts-1');
  assert.equal((await engine.synthesize({ text: 'Hi', voice: 'coral' })).toString(), 'mp3:gpt-4o-mini-tts', 'read-aloud keeps the normal model');
  assert.equal((await engine.synthesize({ text: 'Hi', voice: 'verse', fast: true })).toString(), 'mp3:gpt-4o-mini-tts', 'falls back on a 400');
  const off = createOpenAISpeech({ apiKey: 'sk-x', fetchImpl });
  assert.equal((await off.synthesize({ text: 'Hi', voice: 'coral', fast: true })).toString(), 'mp3:gpt-4o-mini-tts', 'no quick model set');

  const { loadConfig } = await import('../src/config.js');
  assert.equal(loadConfig({ NODE_ENV: 'test' }).ai.speech.fastModel, 'tts-1');
  assert.equal(loadConfig({ NODE_ENV: 'test', OPENAI_TTS_FAST_MODEL: 'off' }).ai.speech.fastModel, '');
  assert.equal(loadConfig({ NODE_ENV: 'test', OPENAI_TTS_FAST_MODEL: 'gpt-4o-mini-tts' }).ai.speech.fastModel, 'gpt-4o-mini-tts');
});

async function voiceTurn(url, token, extra = {}) {
  const resp = await fetch(url + '/v1/chat', {
    method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hello there', stream: true, voice: true, ...extra })
  });
  const events = [];
  let buf = '';
  const dec = new TextDecoder();
  for await (const chunk of resp.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { events.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
  }
  return events;
}

function liveEngine({ failAt = -1 } = {}) {
  const calls = [];
  return {
    model: 'gpt-4o-mini-tts', fastModel: 'tts-1', calls,
    async synthesize({ text, voice, fast }) {
      calls.push({ text, voice, fast });
      if (calls.length - 1 === failAt) throw new ProviderError('unavailable', 'down');
      await new Promise((r) => setTimeout(r, calls.length === 1 ? 40 : 5));   // the first one is the slowest
      return Buffer.from('mp3:' + text);
    }
  };
}

test('a spoken turn: each sentence arrives as audio, in order, made with the quick model', async () => {
  const engine = liveEngine();
  const reply = 'Sure thing. I can help with that. What do you need?';
  const built = buildTestApp({ provider: createFakeProvider({ reply: () => reply }), speechEngine: engine });
  const srv = await serve(built.app);
  try {
    const g = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    const events = await voiceTurn(srv.url, g, { speak_voice: 'coral' });
    const audio = events.filter((e) => e.type === 'audio');
    const done = events.at(-1);
    assert.equal(done.type, 'done');
    assert.equal(done.message.content, reply, 'the written reply is unchanged');
    assert.deepEqual(audio.map((a) => a.seq), [0, 1, 2], 'in order, though the first took longest');
    assert.equal(audio.map((a) => Buffer.from(a.data, 'base64').toString().slice(4)).join(' '), reply);
    assert.ok(audio.every((a) => a.mime === 'audio/mpeg'));
    assert.deepEqual(engine.calls.map((c) => [c.voice, c.fast]), [['coral', true], ['coral', true], ['coral', true]]);
    assert.deepEqual(done.audio, { parts: 3, ok: true });
    assert.ok(events.findIndex((e) => e.type === 'audio') < events.findIndex((e) => e.type === 'done'));
    assert.equal(built.store.usage.filter((u) => u.model === 'tts-1').length, 3, 'each sentence is recorded with the quick model');
  } finally { await srv.close(); }
});

test('a spoken turn: only with a listed voice, never for a normal turn, and a problem never stops the text', async () => {
  const reply = 'First sentence here. Second sentence here.';
  for (const [extra, expected] of [
    [{}, 'none'],                                   // no voice asked for
    [{ speak_voice: 'robot' }, 'none'],             // not a listed voice
    [{ speak_voice: 'nova', voice: false }, 'none'] // not a spoken turn
  ]) {
    const engine = liveEngine();
    const built = buildTestApp({ provider: createFakeProvider({ reply: () => reply }), speechEngine: engine });
    const srv = await serve(built.app);
    try {
      const g = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
      const events = await voiceTurn(srv.url, g, extra);
      assert.equal(events.filter((e) => e.type === 'audio').length, 0, expected);
      assert.equal(events.at(-1).message.content, reply);
      assert.equal(events.at(-1).audio, undefined);
      assert.equal(engine.calls.length, 0);
    } finally { await srv.close(); }
  }
  // The speech service fails on the second sentence: the reply still arrives, and says so.
  const engine = liveEngine({ failAt: 1 });
  const built = buildTestApp({ provider: createFakeProvider({ reply: () => reply }), speechEngine: engine });
  const srv = await serve(built.app);
  try {
    const g = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    const events = await voiceTurn(srv.url, g, { speak_voice: 'nova' });
    assert.equal(events.at(-1).message.content, reply);
    assert.equal(events.at(-1).audio.ok, false);
    assert.equal(events.filter((e) => e.type === 'audio').length, 1, 'what could be spoken before the problem is kept');
  } finally { await srv.close(); }
});

test('a spoken turn counts once against the hourly listening limit', async () => {
  const engine = liveEngine();
  const built = buildTestApp({ provider: createFakeProvider({ reply: () => 'One. Two. Three.' }), speechEngine: engine, env: { LIMIT_GUEST_SPEECH_HOUR: '1' } });
  const srv = await serve(built.app);
  try {
    const g = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    const first = await voiceTurn(srv.url, g, { speak_voice: 'coral' });
    assert.equal(first.at(-1).audio.ok, true, 'three sentences, one count');
    const second = await voiceTurn(srv.url, g, { speak_voice: 'coral' });
    assert.equal(second.at(-1).audio.ok, false, 'over the limit: no speech');
    assert.equal(second.at(-1).message.content, 'One. Two. Three.', 'but the reply is still written');
  } finally { await srv.close(); }
});

// ---- Gemini speech ----

test('Gemini speech: request shape, PCM wrapped as WAV, one retry on a text-only answer', async () => {
  const { createGeminiSpeech, GEMINI_VOICES, pcmToWav } = await import('../src/ai/speech.js');
  const pcm = Buffer.alloc(4800, 1);
  const sent = [];
  let tries = 0;
  const fetchImpl = async (url, init) => {
    sent.push({ url, init });
    tries += 1;
    if (tries === 1) return new Response('no audio', { status: 500 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: pcm.toString('base64') } }] } }] }), { status: 200 });
  };
  const engine = createGeminiSpeech({ apiKey: 'g-key', rate: 1.15, fetchImpl });
  const audio = await engine.synthesize({ text: 'Hello there.', voice: 'Kore' });
  assert.equal(tries, 2, 'one retry after a 500');
  assert.match(sent[0].url, /models\/gemini-3\.1-flash-tts-preview:generateContent$/);
  assert.equal(sent[0].init.headers['x-goog-api-key'], 'g-key');
  const body = JSON.parse(sent[0].init.body);
  assert.deepEqual(body.generationConfig.responseModalities, ['AUDIO']);
  assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
  assert.match(body.contents[0].parts[0].text, /Hello there\.$/);
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
  assert.equal(audio.toString('ascii', 8, 12), 'WAVE');
  assert.equal(audio.length, pcm.length + 44);
  assert.equal(audio.readUInt32LE(24), 24000);
  assert.equal(engine.mime, 'audio/wav');
  assert.equal(GEMINI_VOICES.length, 30);
  assert.equal(pcmToWav(Buffer.alloc(2), 16000).readUInt32LE(24), 16000);
});

test('Gemini speech: a finished WAV passes through, a bad key is a config error', async () => {
  const { createGeminiSpeech, pcmToWav } = await import('../src/ai/speech.js');
  const wav = pcmToWav(Buffer.alloc(100));
  const ok = createGeminiSpeech({ apiKey: 'k', fetchImpl: async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }] } }] })) });
  assert.deepEqual(await ok.synthesize({ text: 'Hi', voice: 'Puck' }), wav);
  const bad = createGeminiSpeech({ apiKey: 'k', fetchImpl: async () => new Response('bad key', { status: 403 }) });
  await assert.rejects(bad.synthesize({ text: 'Hi', voice: 'Puck' }), (e) => e instanceof ProviderError && e.kind === 'config');
});

test('speech provider choice: OpenAI first, Gemini when it is the only key', async () => {
  const { loadConfig } = await import('../src/config.js');
  const base = { NODE_ENV: 'test' };
  assert.equal(loadConfig({ ...base, AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk' }).ai.speech.provider, 'openai');
  assert.equal(loadConfig({ ...base, AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk', GEMINI_API_KEY: 'g' }).ai.speech.provider, 'openai');
  assert.equal(loadConfig({ ...base, AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk', GEMINI_API_KEY: 'g', SPEECH_PROVIDER: 'gemini' }).ai.speech.provider, 'gemini');
  const only = loadConfig({ ...base, GEMINI_API_KEY: 'g' }).ai.speech;
  assert.equal(only.provider, 'gemini');
  assert.equal(only.enabled, true);
  assert.equal(loadConfig({ ...base }).ai.speech.enabled, false);
  assert.throws(() => loadConfig({ ...base, SPEECH_PROVIDER: 'gemini' }), /GEMINI_API_KEY/);
});
