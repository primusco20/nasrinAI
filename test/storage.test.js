import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, serve, bearer, postJson, testConfig, memoryLogger, USER_TOKEN } from './helpers.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { createConversations } from '../src/conversations.js';
import { createStorage } from '../src/storage.js';
import { createSettings, readPrefs } from '../src/settings.js';
import { PLATFORM_TENANT_ID } from '../src/tenants.js';

const OTHER = 'other.user.token';
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2, 3]);
const NOTES = b64(Buffer.from('rice, 2\nbeans, 3\n'));
const verify = async (t) => (t === USER_TOKEN ? { id: 'user-1' } : t === OTHER ? { id: 'user-2' } : null);
const get = (url, path, token) => fetch(url + path, { headers: token ? bearer(token) : {} });
const del = (url, path, token) => fetch(url + path, { method: 'DELETE', headers: bearer(token) });
const guestToken = async (url) => (await (await fetch(url + '/v1/guest/sessions', { method: 'POST' })).json()).token;

async function withApp(fn) {
  const provider = createFakeProvider({ dataLeavesServer: true, reply: () => 'Got it.' });
  const built = buildTestApp({ provider, verifyUser: verify });
  const srv = await serve(built.app);
  try { await fn({ ...built, url: srv.url }); } finally { await srv.close(); }
}

test('storage: photos and files a signed-in person sends are kept, listed and shown back only to them', async () => {
  await withApp(async ({ url }) => {
    const sent = await postJson(url + '/v1/chat', {
      message: 'Look at these',
      attachments: [{ name: 'dish.jpg', data: JPEG }, { name: 'shopping.txt', data: NOTES }]
    }, bearer(USER_TOKEN));
    assert.equal(sent.status, 200);
    const { conversation_id } = await sent.json();

    const list = await (await get(url, '/v1/storage', USER_TOKEN)).json();
    assert.equal(list.counts.chat, 1);
    assert.equal(list.counts.photo_sent, 1);
    assert.equal(list.counts.file_sent, 1);
    assert.deepEqual(list.retention, { days: null, picture_default_days: 30 });
    const photo = list.items.find((i) => i.kind === 'photo_sent');
    const file = list.items.find((i) => i.kind === 'file_sent');
    assert.equal(photo.title, 'dish.jpg');
    assert.equal(photo.chat_id, conversation_id);
    assert.equal(list.used.bytes, 9 + Buffer.from(NOTES, 'base64').length);

    const shown = await get(url, '/v1/storage/sent/' + photo.id, USER_TOKEN);
    assert.equal(shown.status, 200);
    assert.equal(shown.headers.get('content-type'), 'image/jpeg');
    assert.match(shown.headers.get('content-disposition'), /^inline/);
    assert.deepEqual([...Buffer.from(await shown.arrayBuffer())], [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2, 3]);

    const download = await get(url, '/v1/storage/sent/' + file.id, USER_TOKEN);
    assert.equal(download.headers.get('content-type'), 'application/octet-stream', 'non-pictures are never shown inline');
    assert.match(download.headers.get('content-disposition'), /^attachment; filename="shopping.txt"/);
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await download.text(), 'rice, 2\nbeans, 3\n');

    // Someone else sees none of it and cannot reach it by id.
    assert.equal((await get(url, '/v1/storage/sent/' + photo.id, OTHER)).status, 404);
    assert.equal((await del(url, `/v1/storage/photo_sent/${photo.id}`, OTHER)).status, 404);
    const theirs = await (await get(url, '/v1/storage', OTHER)).json();
    assert.deepEqual(theirs.items, []);
    assert.equal((await get(url, '/v1/storage/sent/' + photo.id)).status, 401);

    // Deleting one item keeps the rest; deleting the chat takes its sent files with it.
    assert.equal((await del(url, `/v1/storage/file_sent/${file.id}`, USER_TOKEN)).status, 200);
    assert.equal((await get(url, '/v1/storage/sent/' + file.id, USER_TOKEN)).status, 404);
    assert.equal((await del(url, `/v1/storage/chat/${conversation_id}`, USER_TOKEN)).status, 200);
    assert.equal((await get(url, '/v1/storage/sent/' + photo.id, USER_TOKEN)).status, 404);
    assert.deepEqual((await (await get(url, '/v1/storage', USER_TOKEN)).json()).items, []);
  });
});

test('storage: guests keep nothing and cannot use it; bad kinds and ids are plain 404s', async () => {
  await withApp(async ({ url, store }) => {
    const g = await guestToken(url);
    const sent = await postJson(url + '/v1/chat', { message: 'hi', attachments: [{ name: 'dish.jpg', data: JPEG }] }, bearer(g));
    assert.equal(sent.status, 200);
    assert.equal((await store.listSentFiles({ tenantId: PLATFORM_TENANT_ID, userId: 'anyone' })).length, 0);
    assert.equal((await get(url, '/v1/storage', g)).status, 403);
    assert.equal((await del(url, '/v1/storage/chat/00000000-0000-4000-8000-000000000000', g)).status, 403);
    assert.equal((await del(url, '/v1/storage/exe/00000000-0000-4000-8000-000000000000', USER_TOKEN)).status, 404);
    assert.equal((await del(url, '/v1/storage/chat/not-a-uuid', USER_TOKEN)).status, 404);
    assert.equal((await get(url, '/v1/storage')).status, 401);
  });
});

test('storage: library files, notes and saved replies are listed and can be deleted from here', async () => {
  await withApp(async ({ url }) => {
    const add = async (body) => (await (await postJson(url + '/v1/library', body, bearer(USER_TOKEN))).json()).id;
    const f = await add({ title: 'budget.txt', text: 'Rent is 12000.' });
    const n = await add({ kind: 'note', title: 'Idea', text: 'Open a stall.' });
    const list = await (await get(url, '/v1/storage', USER_TOKEN)).json();
    assert.equal(list.counts.file, 1);
    assert.equal(list.counts.note, 1);
    assert.equal((await del(url, `/v1/storage/file/${f}`, USER_TOKEN)).status, 200);
    assert.equal((await del(url, `/v1/storage/note/${n}`, USER_TOKEN)).status, 200);
    assert.deepEqual((await (await get(url, '/v1/storage', USER_TOKEN)).json()).items, []);
  });
});

test('retention: a chosen keep-time deletes what is older, "until I delete" keeps everything, no choice keeps chats but not old pictures', async () => {
  let t = Date.parse('2026-01-01T00:00:00Z');
  const store = createMemoryStore({ now: () => t });
  const logger = memoryLogger();
  const config = testConfig();
  const conversations = createConversations({ store, config, logger, now: () => t });
  const storage = createStorage({ store, config, conversations, library: null, logger, now: () => t });
  const tenantId = PLATFORM_TENANT_ID;
  const me = (retention) => ({ tenantId, actor: { type: 'user', id: 'u1' }, prefs: { retention } });
  const seed = async () => {
    const conv = await store.createConversation({ tenantId, ownerType: 'user', ownerId: 'u1' });
    await store.addMessage({ conversationId: conv.id, tenantId, role: 'user', content: 'hi' });
    const photo = await store.addSentFile({ tenantId, userId: 'u1', kind: 'photo', name: 'a.jpg', mime: 'image/jpeg', bytes: Buffer.from('abc') });
    const lib = await store.addLibraryFile({ tenantId, userId: 'u1', title: 'n.txt', kind: 'file', format: 'text', chars: 3, chunks: ['abc'] });
    const pic = await store.addImage({ tenantId, conversationId: conv.id, ownerType: 'user', ownerId: 'u1', mime: 'image/png', bytes: Buffer.alloc(200) });
    return { conv, photo, lib, pic };
  };
  const state = async (s) => ({
    chat: Boolean(await store.getConversation(s.conv.id)),
    photo: Boolean(await store.getSentFile({ tenantId, userId: 'u1', id: s.photo })),
    lib: Boolean(await store.getLibraryFile({ tenantId, userId: 'u1', id: s.lib })),
    pic: Boolean(await store.getImage(s.pic))
  });

  // Not chosen: after 31 days only the picture (30-day default) goes.
  let s = await seed();
  t += 31 * 86400_000;
  await storage.sweep(me(null), { force: true });
  assert.deepEqual(await state(s), { chat: true, photo: true, lib: true, pic: false });

  // "Until I delete" (0): nothing goes, however old.
  t += 400 * 86400_000;
  await storage.sweep(me(0), { force: true });
  assert.deepEqual(await state(s), { chat: true, photo: true, lib: true, pic: false });

  // 30 days: everything older goes; something new stays.
  s = await seed();
  t += 10 * 86400_000;
  const fresh = await seed();
  await storage.sweep(me(0), { force: true });
  t += 25 * 86400_000;   // the first set is 35 days old, the second 25
  await storage.sweep(me(30), { force: true });
  assert.deepEqual(await state(s), { chat: false, photo: false, lib: false, pic: false });
  assert.deepEqual(await state(fresh), { chat: true, photo: true, lib: true, pic: true });

  // Clean-up runs at most hourly unless forced, and never for another person or a guest.
  t += 40 * 86400_000;
  assert.equal(await storage.sweep(me(30)), true);
  assert.equal(await storage.sweep(me(30)), false, 'throttled');
  assert.equal(await storage.sweep({ tenantId, actor: { type: 'guest', id: 'g' }, prefs: {} }, { force: true }), false);
  const other = await store.createConversation({ tenantId, ownerType: 'user', ownerId: 'u2' });
  t += 400 * 86400_000;
  await storage.sweep(me(30), { force: true });
  assert.ok(await store.getConversation(other.id), 'only the caller\'s own data is cleaned');
});

test('retention: sent files are kept only while the person has room, and a failure never stops a chat', async () => {
  const store = createMemoryStore();
  const logger = memoryLogger();
  const config = testConfig({ STORAGE_MAX_MB: '1' });
  const conversations = createConversations({ store, config, logger });
  const storage = createStorage({ store, config, conversations, library: null, logger });
  const caller = { tenantId: PLATFORM_TENANT_ID, actor: { type: 'user', id: 'u1' }, prefs: {} };
  const conv = await store.createConversation({ tenantId: PLATFORM_TENANT_ID, ownerType: 'user', ownerId: 'u1' });
  const big = (name) => ({ kind: 'text', mime: 'text/plain', name, data: Buffer.alloc(600_000, 97).toString('base64') });
  assert.equal(await storage.keepSent(caller, conv, [big('one.txt'), big('two.txt')]), 1, 'the second would pass 1 MB');
  assert.equal((await store.listSentFiles({ tenantId: PLATFORM_TENANT_ID, userId: 'u1' })).length, 1);
  const broken = createStorage({ store: { ...store, listSentFiles: async () => { throw new Error('db down'); }, addSentFile: store.addSentFile }, config, conversations, library: null, logger });
  assert.equal(await broken.keepSent(caller, conv, [big('x.txt')]), 0, 'returns instead of throwing');
  assert.equal(await storage.keepSent({ ...caller, actor: { type: 'guest', id: 'g' } }, conv, [big('x.txt')]), 0);
});

test('settings: the keep-time is null, 0 (until I delete) or whole days up to ten years; anything else is refused', async () => {
  const settings = createSettings({ url: 'https://p.supabase.co', anonKey: 'anon', fetchImpl: async (u, init) => Response.json({ user_metadata: JSON.parse(init.body).data }) });
  const caller = { actor: { type: 'user', id: 'u' }, prefs: {} };
  assert.equal((await settings.update(caller, 't', { retention: 30 })).retention, 30);
  assert.equal((await settings.update(caller, 't', { retention: 365 })).retention, 365);
  assert.equal((await settings.update(caller, 't', { retention: 0 })).retention, 0);
  assert.equal((await settings.update({ ...caller, prefs: { retention: 30 } }, 't', { retention: null })).retention, null);
  assert.equal((await settings.update({ ...caller, prefs: { retention: 30 } }, 't', { memory: true })).retention, 30, 'other changes keep it');
  for (const bad of [-1, 1.5, 3651, '30', true, {}, NaN]) {
    await assert.rejects(settings.update(caller, 't', { retention: bad }), (e) => e.code === 'invalid_settings', String(bad));
  }
  assert.equal(readPrefs({ nasrin_prefs: { retention: 'forever' } }).retention, null, 'bad stored values read as not chosen');
  assert.equal(readPrefs({ nasrin_prefs: { retention: 90 } }).retention, 90);
});
