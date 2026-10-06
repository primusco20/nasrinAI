import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksSecret } from '../src/knowledge/secrets.js';
import { createMemory, memoryTools } from '../src/knowledge/memory.js';
import { createToolRegistry } from '../src/tools/registry.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { PLATFORM_TENANT_ID } from '../src/tenants.js';
import { buildTestApp, serve, bearer, USER_TOKEN } from './helpers.js';

const T = PLATFORM_TENANT_ID;
const user = (id, memory) => ({ tenantId: T, actor: { type: 'user', id }, prefs: { memory } });

test('secret detector: keys, passwords, codes and cards are caught; ordinary notes pass', () => {
  for (const s of [
    'my password is hunter2!', 'Password: Tr0ub4dor&3', 'my pin is 4821', 'OTP 552901', 'mpin ko ay 123456',
    'api key sk-proj-' + 'a1B2'.repeat(8), 'AKIAABCDEFGHIJKLMNOP', 'card 4111 1111 1111 1111', 'AIza' + 'x'.repeat(35),
    'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcdefghijk', '-----BEGIN RSA PRIVATE KEY-----', 'ghp_' + 'A'.repeat(36),
    'nss_0123456789ab_' + 'f'.repeat(48), 'deadbeef'.repeat(5), 'seed phrase: apple banana cherry'
  ]) assert.equal(looksSecret(s), true, s);
  for (const s of [
    'I like calamansi juice', 'My birthday is May 5', 'I use an iPhone 15', 'Order 123456 was late',
    'I prefer short answers in Bisaya', 'My business is a cafe in Davao', 'Call me Ana', 'My phone number is private'
  ]) assert.equal(looksSecret(s), false, s);
});

test('memory is opt-in: not chosen or off means no notes used and no remember tool', async () => {
  const store = createMemoryStore();
  await store.addMemory({ tenantId: T, userId: 'u1', text: 'likes calamansi' });
  const memory = createMemory({ store, logger: { warn() {} } });
  const reg = createToolRegistry({ tools: memoryTools({ store }) });
  for (const choice of [null, undefined, false]) {
    assert.equal(await memory.context(user('u1', choice), 'calamansi'), null, String(choice));
    assert.equal(reg.specsFor(user('u1', choice)).length, 0);
    await assert.rejects(reg.run(user('u1', choice), 'remember', { note: 'x' }, { confirmed: true }), (e) => e.code === 'not_allowed');
  }
  assert.match(await memory.context(user('u1', true), 'calamansi'), /likes calamansi/);
  assert.equal(await memory.context(user('u2', true), 'calamansi'), null, 'another person never sees it');
  // Even confirmed, a secret is never saved.
  await assert.rejects(reg.run(user('u1', true), 'remember', { note: 'my password is hunter2!' }, { confirmed: true }), (e) => e.code === 'failed');
  assert.equal((await store.listMemories({ tenantId: T, userId: 'u1' })).length, 1);
});

test('editing a note: own notes only, checked like new notes', async () => {
  const OTHER = 'other.user.token';
  const built = buildTestApp({ verifyUser: async (t) => (t === USER_TOKEN ? { id: 'user-1', prefs: { memory: true } } : t === OTHER ? { id: 'user-2', prefs: { memory: true } } : null) });
  const { url, close } = await serve(built.app);
  try {
    const id = await built.store.addMemory({ tenantId: T, userId: 'user-1', text: 'likes tea' });
    const put = (noteId, text, token = USER_TOKEN) => fetch(url + '/v1/memories/' + noteId, { method: 'PUT', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });

    assert.equal((await put(id, 'likes coffee', OTHER)).status, 404, 'someone else cannot edit it');
    assert.equal((await put(id, 'my pin is 4821')).status, 400);
    assert.equal((await put(id, '')).status, 400);
    const r = await put(id, 'likes coffee, no sugar');
    assert.equal(r.status, 200);
    const list = await (await fetch(url + '/v1/memories', { headers: bearer(USER_TOKEN) })).json();
    assert.deepEqual(list.memories.map((m) => m.text), ['likes coffee, no sugar']);
    assert.deepEqual((await (await fetch(url + '/v1/memories', { headers: bearer(OTHER) })).json()).memories, []);
  } finally { await close(); }
});
