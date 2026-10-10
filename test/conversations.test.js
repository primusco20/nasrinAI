import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStore } from '../src/store/supabase-store.js';
import { createConversations } from '../src/conversations.js';
import { createMemoryStore } from '../src/store/memory-store.js';
import { buildTestApp, serve, bearer, memoryLogger, testConfig, SECRET_KEY, USER_TOKEN, PUB_KEY } from './helpers.js';

let srv, store;
before(async () => {
  const built = buildTestApp();
  store = built.store;
  srv = await serve(built.app);
});
after(() => srv.close());

const guestToken = async (headers = {}) =>
  (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST', headers })).json()).token;
const api = (path, token, method = 'GET') => fetch(srv.url + path, { method, headers: bearer(token) });

test('a caller creates, lists, reads and deletes their own conversation', async () => {
  const me = await guestToken();
  const created = await api('/v1/conversations', me, 'POST');
  assert.equal(created.status, 201);
  const { conversation } = await created.json();
  assert.match(conversation.id, /^[0-9a-f-]{36}$/);

  const list = await (await api('/v1/conversations', me)).json();
  assert.deepEqual(list.conversations.map((c) => c.id), [conversation.id]);

  const read = await (await api(`/v1/conversations/${conversation.id}/messages`, me)).json();
  assert.deepEqual(read.messages, []);

  assert.equal((await api(`/v1/conversations/${conversation.id}`, me, 'DELETE')).status, 204);
  assert.equal((await api(`/v1/conversations/${conversation.id}/messages`, me)).status, 404);
});

test('nobody else can see or delete a conversation, not even in the same business', async () => {
  const owner = await guestToken();
  const { conversation } = await (await api('/v1/conversations', owner, 'POST')).json();
  await store.addMessage({ conversationId: conversation.id, tenantId: '00000000-0000-0000-0000-000000000001', role: 'user', content: 'private' });

  const otherGuest = await guestToken();
  for (const token of [otherGuest, USER_TOKEN, SECRET_KEY]) {
    const r = await api(`/v1/conversations/${conversation.id}/messages`, token);
    assert.equal(r.status, 404);
    assert.doesNotMatch(await r.text(), /private/);
    assert.equal((await api(`/v1/conversations/${conversation.id}`, token, 'DELETE')).status, 404);
    const list = await (await api('/v1/conversations', token)).json();
    assert.ok(!list.conversations.some((c) => c.id === conversation.id));
  }
  // still there for its owner
  const mine = await (await api(`/v1/conversations/${conversation.id}/messages`, owner)).json();
  assert.equal(mine.messages[0].content, 'private');
});

test('a business guest cannot reach the business server\'s conversations', async () => {
  const { conversation } = await (await api('/v1/conversations', SECRET_KEY, 'POST')).json();
  const widgetGuest = await guestToken({ 'X-NasrinAI-Key': PUB_KEY, Origin: 'https://shop.example.com' });
  assert.equal((await api(`/v1/conversations/${conversation.id}/messages`, widgetGuest)).status, 404);
});

test('bad ids and missing credentials are refused', async () => {
  const me = await guestToken();
  assert.equal((await api('/v1/conversations/not-a-uuid/messages', me)).status, 404);
  assert.equal((await api('/v1/conversations/00000000-0000-4000-8000-000000000000/messages', me)).status, 404);
  assert.equal((await fetch(srv.url + '/v1/conversations')).status, 401);
});

test('guest conversations expire and are purged; user conversations do not expire', async () => {
  let t = Date.parse('2026-10-05T00:00:00Z');
  const memory = createMemoryStore({ now: () => t });
  const convs = createConversations({ store: memory, config: testConfig(), logger: memoryLogger(), now: () => t });
  const guest = { tenantId: '00000000-0000-0000-0000-000000000001', actor: { type: 'guest', id: 'g' } };
  const user = { tenantId: '00000000-0000-0000-0000-000000000001', actor: { type: 'user', id: 'u' } };

  const g = await convs.create(guest);
  const u = await convs.create(user);
  assert.equal(g.expiresAt, '2026-10-06T00:00:00.000Z');
  assert.equal(u.expiresAt, null);

  t += 25 * 3600 * 1000;
  await memory.purgeExpired();
  assert.equal(await memory.getConversation(g.id), null);
  assert.ok(await memory.getConversation(u.id));
});

test('Supabase store: conversation queries are scoped and encoded', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
    if (init.method === 'POST' && url.includes('/conversations')) {
      return new Response(JSON.stringify([{ id: 'c', tenant_id: 't', owner_type: 'guest', owner_id: 'g', title: '', created_at: 'x', updated_at: 'x', expires_at: null }]));
    }
    return new Response('[]');
  };
  const s = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl });
  const T = '00000000-0000-0000-0000-000000000001';
  const C = '9b2d3a6e-1c4f-4d2a-9e8b-7f6a5b4c3d2e';

  await s.createConversation({ tenantId: T, ownerType: 'guest', ownerId: 'abc123' });
  assert.deepEqual(calls[0].body, { tenant_id: T, owner_type: 'guest', owner_id: 'abc123', title: '', expires_at: null });

  await s.listConversations({ tenantId: T, ownerType: 'user', ownerId: 'user-1' });
  assert.match(calls[1].url, /conversations\?tenant_id=eq\.0{8}-.*&owner_type=eq\.user&owner_id=eq\.user-1&order=updated_at\.desc&limit=20/);

  await s.listMessages(C, 50);
  assert.match(calls[2].url, new RegExp(`messages\\?conversation_id=eq\\.${C}&order=created_at\\.desc&limit=50`));

  await s.deleteConversation(C);
  assert.equal(calls[3].method, 'DELETE');

  // owners that could change the query never reach the database
  await assert.rejects(s.listConversations({ tenantId: T, ownerType: 'user', ownerId: 'x&owner_id=neq.y' }));
  await assert.rejects(s.createConversation({ tenantId: T, ownerType: 'admin', ownerId: 'a' }));
  assert.deepEqual(await s.listMessages('nope'), []);
  assert.equal(calls.length, 4);
});

test('cross-chat recall requires Memory ON and supports broad chat-history questions', async () => {
  const memory = createMemoryStore();
  const logger = memoryLogger();
  const config = testConfig();
  const convs = createConversations({ store: memory, config, logger });
  const caller = {
    tenantId: '00000000-0000-0000-0000-000000000001',
    actor: { type: 'user', id: 'memory-user' },
    prefs: { memory: false }
  };
  const oldChat = await convs.create(caller);
  await convs.add(oldChat, 'user', 'We discussed the NasrinAI automation roadmap.');
  await convs.add(oldChat, 'assistant', 'The roadmap should use permission-aware plugins.');

  assert.equal(await convs.context(caller, 'do you remember all my chats?'), null);

  caller.prefs.memory = true;
  const recalled = await convs.context(caller, 'do you remember all my chats?');
  assert.ok(recalled);
  assert.match(recalled.text, /NasrinAI automation roadmap/);
  assert.match(recalled.text, /permission-aware plugins/);
});

test('temporal recall retrieves recent saved messages even when the query has no matching topic words', async () => {
  const memory = createMemoryStore();
  const logger = memoryLogger();
  const convs = createConversations({ store: memory, config: testConfig(), logger });
  const caller = {
    tenantId: '00000000-0000-0000-0000-000000000001',
    actor: { type: 'user', id: 'temporal-recall-user' },
    prefs: { memory: true }
  };
  const previous = await convs.create(caller);
  await convs.add(previous, 'user', 'We discussed the new NasrinAI multi-chat behavior and account switching.');
  await convs.add(previous, 'assistant', 'Each conversation should keep its own active response and Stop control.');

  const recalled = await convs.context(caller, 'do you remember what we discussed yesterday?');
  assert.ok(recalled);
  assert.match(recalled.text, /multi-chat behavior/);
  assert.match(recalled.text, /own active response/);
});


test('generic memory questions retrieve saved chats and provide real line breaks', async () => {
  const memory = createMemoryStore();
  const convs = createConversations({ store: memory, config: testConfig(), logger: memoryLogger() });
  const caller = {
    tenantId: '00000000-0000-0000-0000-000000000001',
    actor: { type: 'user', id: 'generic-memory-user' },
    prefs: { memory: true }
  };
  const previous = await convs.create(caller);
  await convs.add(previous, 'user', 'We discussed the NasrinAI deployment checklist.');
  await convs.add(previous, 'assistant', 'We agreed to validate staging before production.');

  const recalled = await convs.context(caller, 'Do you remember our chats?');
  assert.ok(recalled);
  assert.match(recalled.text, /deployment checklist/);
  assert.match(recalled.text, /validate staging before production/);
  assert.match(recalled.text, /^\n\nRelevant excerpts/);
  assert.doesNotMatch(recalled.text, /\\n\\nRelevant excerpts/);
});


test('four-day summary requests retrieve recent saved chats', async () => {
  const memory = createMemoryStore();
  const convs = createConversations({ store: memory, config: testConfig(), logger: memoryLogger() });
  const caller = {
    tenantId: '00000000-0000-0000-0000-000000000001',
    actor: { type: 'user', id: 'four-day-summary-user' },
    prefs: { memory: true }
  };
  const previous = await convs.create(caller);
  await convs.add(previous, 'user', 'We discussed the four-day summary regression test.');
  await convs.add(previous, 'assistant', 'The summary must use saved messages, not web search.');

  const recalled = await convs.context(caller, 'Can you summarize our chats for 4 days?');
  assert.ok(recalled);
  assert.match(recalled.text, /four-day summary regression test/);
  assert.match(recalled.text, /saved messages, not web search/);
});
