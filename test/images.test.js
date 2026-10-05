import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiImage } from '../src/ai/image.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { ProviderError } from '../src/ai/provider.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]);

function fakeImages({ fail = null } = {}) {
  const calls = [];
  return {
    id: 'gemini', model: 'gemini-3.1-flash-lite-image', calls,
    async generate(req) {
      calls.push(req);
      if (fail) throw new ProviderError(fail, 'nope', 400);
      return { bytes: PNG, mime: 'image/png' };
    }
  };
}

async function app({ imageProvider = fakeImages(), env = {} } = {}) {
  const built = buildTestApp({ provider: createFakeProvider(), imageProvider, env });
  const srv = await serve(built.app);
  const guest = async () => (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
  return { ...built, ...srv, guest, imageProvider };
}

test('a guest makes one picture; it is private to them; the second is refused', async () => {
  const a = await app();
  try {
    const g = await a.guest();
    const r = await postJson(a.url + '/v1/images', { prompt: 'A cup of kape on a wooden table, morning light' }, bearer(g));
    assert.equal(r.status, 200);
    const made = await r.json();
    assert.match(made.message.content, /^\[image:[0-9a-f-]{36}\]/);
    assert.match(a.imageProvider.calls[0].prompt, /campaign-ready[\s\S]*Request: A cup of kape/);

    const img = await fetch(a.url + '/v1/images/' + made.image_id, { headers: bearer(g) });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);

    const other = await a.guest();
    assert.equal((await fetch(a.url + '/v1/images/' + made.image_id, { headers: bearer(other) })).status, 404, 'not someone else');
    assert.equal((await fetch(a.url + '/v1/images/' + made.image_id, { headers: bearer(USER_TOKEN) })).status, 404);

    const again = await postJson(a.url + '/v1/images', { prompt: 'another one' }, bearer(g));
    assert.equal(again.status, 429);
    assert.equal((await again.json()).error.code, 'image_limit');
    assert.equal(a.imageProvider.calls.length, 1, 'one picture per guest');
    assert.equal(a.store.usage.at(-1).task, 'image');
  } finally { await a.close(); }
});

test('signed-in users: daily allowance; photos only; refusals explained; off without a key', async () => {
  const a = await app({ env: { IMAGES_USER_DAY: '2' } });
  try {
    assert.equal((await postJson(a.url + '/v1/images', { prompt: '' }, bearer(USER_TOKEN))).status, 400);
    assert.equal((await postJson(a.url + '/v1/images', { prompt: 'x', photo: { name: 'a.pdf', data: Buffer.from('%PDF-1.7 x').toString('base64') } }, bearer(USER_TOKEN))).status, 400);
    for (const want of [200, 200, 429]) assert.equal((await postJson(a.url + '/v1/images', { prompt: 'a red bicycle' }, bearer(USER_TOKEN))).status, want);
  } finally { await a.close(); }

  const refused = await app({ imageProvider: fakeImages({ fail: 'refused' }) });
  try {
    const r = await postJson(refused.url + '/v1/images', { prompt: 'something' }, bearer(USER_TOKEN));
    assert.equal(r.status, 422);
    assert.equal((await r.json()).error.code, 'image_refused');
  } finally { await refused.close(); }

  const off = await app({ imageProvider: null });
  try {
    assert.equal((await postJson(off.url + '/v1/images', { prompt: 'x' }, bearer(USER_TOKEN))).status, 503);
    assert.equal((await (await fetch(off.url + '/v1/status')).json()).images.available, false);
  } finally { await off.close(); }
});

test('Gemini image request shape and response parsing', async () => {
  const calls = [];
  const p = createGeminiImage({ apiKey: 'g-key', model: 'gemini-3.1-flash-lite-image', fetchImpl: async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return Response.json({ output_image: { data: PNG.toString('base64') } });
  } });
  const out = await p.generate({ prompt: 'p', images: [{ mime: 'image/jpeg', data: 'AAAA' }] });
  assert.equal(out.mime, 'image/png');
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'g-key');
  assert.deepEqual(calls[0].body.input[1], { type: 'image', mime_type: 'image/jpeg', data: 'AAAA' });
  const empty = createGeminiImage({ apiKey: 'k', model: 'm', fetchImpl: async () => Response.json({ output_text: 'I cannot make that.' }) });
  await assert.rejects(empty.generate({ prompt: 'p' }), { kind: 'refused' });
});

test('all guests together stop at the daily guest ceiling', async () => {
  const a = await app({ env: { IMAGES_GUEST_DAY_TOTAL: '2' } });
  try {
    for (const want of [200, 200, 429]) {
      const r = await postJson(a.url + '/v1/images', { prompt: 'a kalamansi tree' }, bearer(await a.guest()));
      assert.equal(r.status, want);
      if (want === 429) assert.match((await r.json()).error.message, /used up for today/);
    }
    assert.equal((await postJson(a.url + '/v1/images', { prompt: 'a kalamansi tree' }, bearer(USER_TOKEN))).status, 200, 'signed-in users are not affected');
    assert.equal(a.imageProvider.calls.length, 3);
  } finally { await a.close(); }
});
