import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeProvider } from '../src/ai/fake.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN } from './helpers.js';

const PLATFORM = '00000000-0000-0000-0000-000000000001';

async function app(env = {}) {
  const built = buildTestApp({ provider: createFakeProvider({ reply: () => 'ok' }), env: { LEGAL_REQUIRE_TERMS: 'true', ...env } });
  const srv = await serve(built.app);
  return { ...built, ...srv };
}

test('terms: required for signed-in use, recorded on the server, version-checked', async () => {
  const a = await app();
  try {
    const blocked = await postJson(a.url + '/v1/chat', { message: 'hi' }, bearer(USER_TOKEN));
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).error.code, 'terms_required');
    assert.deepEqual(await (await fetch(a.url + '/v1/legal', { headers: bearer(USER_TOKEN) })).json(), { terms_version: '2026-10-06c', privacy_version: '2026-10-06f', accepted: false });

    assert.equal((await postJson(a.url + '/v1/legal/accept', { terms_version: 'old' }, bearer(USER_TOKEN))).status, 409, 'must accept the current version');
    assert.equal((await postJson(a.url + '/v1/legal/accept', { terms_version: '2026-10-06c' }, bearer(USER_TOKEN))).status, 200);
    assert.deepEqual(a.store.acceptances.map((x) => [x.userId, x.document, x.version, x.action, x.method]), [
      ['user-1', 'terms', '2026-10-06c', 'accepted', 'signin'], ['user-1', 'privacy', '2026-10-06f', 'acknowledged', 'signin']]);
    assert.equal((await postJson(a.url + '/v1/chat', { message: 'hi' }, bearer(USER_TOKEN))).status, 200);

    const g = (await (await fetch(a.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    assert.equal((await postJson(a.url + '/v1/chat', { message: 'hi' }, bearer(g))).status, 200, 'guests have no account to accept with');
    assert.equal((await postJson(a.url + '/v1/legal/accept', { terms_version: '2026-10-06c' }, bearer(g))).status, 403);
  } finally { await a.close(); }

  // New Terms version: existing acceptance no longer counts; old record kept.
  const b = await app({ LEGAL_TERMS_VERSION: '2026-11-01' });
  try {
    await b.store.recordAcceptance({ tenantId: PLATFORM, userId: 'user-1', document: 'terms', version: '2026-10-06c', action: 'accepted', method: 'signin' });
    assert.equal((await postJson(b.url + '/v1/chat', { message: 'hi' }, bearer(USER_TOKEN))).status, 403);
    await postJson(b.url + '/v1/legal/accept', { terms_version: '2026-11-01', method: 'update_prompt' }, bearer(USER_TOKEN));
    assert.equal(b.store.acceptances.length, 3, 'history preserved');
    assert.equal(b.store.acceptances.at(-1).method, 'update_prompt');
  } finally { await b.close(); }
});

test('data controls: export, delete all chats, delete account', async () => {
  const a = await app({ LEGAL_REQUIRE_TERMS: 'false' });
  try {
    const c = await (await postJson(a.url + '/v1/chat', { message: 'my secret plan' }, bearer(USER_TOKEN))).json();
    const exp = await fetch(a.url + '/v1/account/export', { headers: bearer(USER_TOKEN) });
    assert.equal(exp.status, 200);
    assert.match(exp.headers.get('content-disposition'), /attachment/);
    const data = await exp.json();
    assert.equal(data.conversations[0].messages[0].content, 'my secret plan');

    const g = (await (await fetch(a.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    assert.equal((await fetch(a.url + '/v1/account/export', { headers: bearer(g) })).status, 403);
    await postJson(a.url + '/v1/chat', { message: 'guest words' }, bearer(g));
    assert.equal((await fetch(a.url + '/v1/conversations', { method: 'DELETE', headers: bearer(g) })).status, 200);
    assert.deepEqual((await (await fetch(a.url + '/v1/conversations', { headers: bearer(g) })).json()).conversations, []);
    assert.equal((await (await fetch(a.url + '/v1/conversations', { headers: bearer(USER_TOKEN) })).json()).conversations.length, 1, 'only the caller\'s chats');

    assert.equal((await postJson(a.url + '/v1/account/delete', {}, bearer(USER_TOKEN))).status, 400, 'needs confirmation');
    const del = await postJson(a.url + '/v1/account/delete', { confirm: 'DELETE' }, bearer(USER_TOKEN));
    assert.equal(del.status, 200);
    assert.match(del.headers.getSetCookie().join(';'), /nasrin_rt=; Path=\/v1\/auth; Max-Age=0/);
    assert.deepEqual(a.deletedUsers, ['user-1'], 'sign-in account deleted');
    assert.equal((await fetch(a.url + `/v1/conversations/${c.conversation_id}/messages`, { headers: bearer(USER_TOKEN) })).status, 404);
    assert.ok(a.store.usage.filter((e) => e.actorType === 'user').every((e) => e.actorId === 'deleted-user'), 'usage numbers no longer name the user');
  } finally { await a.close(); }
});
