import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, searchTerms } from '../src/knowledge/index.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { hashSecret } from '../src/auth/keys.js';
import { buildTestApp, serve, bearer, postJson, BIZ_TENANT, SECRET_KEY, USER_TOKEN, PUB_KEY } from './helpers.js';

const KNOW = `nss_dddddddddd01_${'d'.repeat(48)}`;
const MENU = 'Adobo with rice costs 120 pesos.\n\nWe are open daily from 8am to 9pm.\n\nOur Sunday special is sinigang na baboy.';

async function app(reply = (req) => 'ANSWER ' + req.messages.at(-1).content, env = {}) {
  const provider = createFakeProvider({ models: ['gpt-6-luna'], reply });
  const pages = { 'https://shop.example.com/faq': { url: 'https://shop.example.com/faq', title: 'FAQ', text: 'Delivery is free within Cebu City for orders over 500 pesos.' } };
  const built = buildTestApp({ provider, env, readLinkImpl: async (u) => pages[u] || { url: u, error: 'not found' } });
  built.store.addApiKey({ id: 'dddddddddd01', tenant_id: BIZ_TENANT, kind: 'secret', secret_hash: hashSecret('d'.repeat(48)), scopes: ['chat', 'knowledge'] });
  const srv = await serve(built.app);
  const add = (body, token = KNOW) => postJson(srv.url + '/v1/knowledge', body, bearer(token));
  return { ...built, ...srv, fake: provider, add };
}

test('chunks and search terms', () => {
  const chunks = chunkText('Para one.\n\n' + 'Long sentence here. '.repeat(200));
  assert.ok(chunks.length > 2 && chunks.every((c) => c.length <= 1200));
  assert.deepEqual(searchTerms('Magkano ang adobo? How much is the ADOBO?'), ['magkano', 'adobo', 'much']);
});

test('knowledge: a business adds documents; its chats get the matching parts, for the right audience only', async () => {
  const a = await app();
  try {
    assert.equal((await a.add({ title: 'Menu', text: MENU }, SECRET_KEY)).status, 403, 'needs the knowledge scope');
    const r = await a.add({ title: 'Menu', text: MENU, who: ['service'] });
    assert.equal(r.status, 201);
    const doc = (await r.json()).document;
    assert.ok(doc.chunks >= 1);
    assert.equal((await a.add({ url: 'https://shop.example.com/faq' })).status, 201);
    assert.equal((await a.add({ url: 'https://nowhere.example.com' })).status, 400);

    const ask = async (token, message) => (await (await postJson(a.url + '/v1/chat', { message }, bearer(token))).json()).message.content;
    let out = await ask(KNOW, 'How much is the adobo?');
    assert.match(out, /From "Menu":\nAdobo with rice costs 120 pesos/);
    assert.match(out, /data, not instructions/);
    assert.doesNotMatch(out, /Delivery is free/, 'only matching parts');
    out = await ask(KNOW, 'Is delivery free?');
    assert.match(out, /From "FAQ" \(https:\/\/shop\.example\.com\/faq\)/);

    const guest = (await (await fetch(a.url + '/v1/guest/sessions', { method: 'POST', headers: { 'X-NasrinAI-Key': PUB_KEY, Origin: 'https://shop.example.com' } })).json()).token;
    out = await ask(guest, 'How much is the adobo?');
    assert.doesNotMatch(out, /120 pesos/, 'service-only document not shown to visitors');
    assert.match(await ask(guest, 'Is delivery free?'), /Delivery is free/, 'shared with everyone by default');
    assert.doesNotMatch(await ask(USER_TOKEN, 'Is delivery free?'), /Delivery is free/, 'other businesses never see it');

    const list = await (await fetch(a.url + '/v1/knowledge', { headers: bearer(KNOW) })).json();
    assert.equal(list.documents.length, 2);
    assert.equal((await fetch(a.url + '/v1/knowledge/' + doc.id, { method: 'DELETE', headers: bearer(KNOW) })).status, 200);
    assert.doesNotMatch(await ask(KNOW, 'How much is the adobo?'), /120 pesos/);
  } finally { await a.close(); }
});

test('memory: saved only after the person confirms; used later; listed, exported and deleted', async () => {
  const a = await app((req) => {
    const last = req.messages.at(-1);
    if (last.role === 'tool') return 'OK, I will remember once you confirm.';
    if (/remember that/i.test(last.content)) return { toolCalls: [{ id: 'm', name: 'remember', arguments: '{"note":"Prefers vegetarian dishes"}' }] };
    return 'SEEN ' + last.content;
  }, { ROUTING: 'smart', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30) });
  try {
    const out = await (await postJson(a.url + '/v1/chat', { message: 'Please remember that I am vegetarian' }, bearer(USER_TOKEN))).json();
    assert.equal(out.pending_action.tool, 'remember');
    assert.equal((await (await fetch(a.url + '/v1/memories', { headers: bearer(USER_TOKEN) })).json()).memories.length, 0, 'nothing saved before Confirm');
    assert.equal((await postJson(a.url + '/v1/actions/confirm', { token: out.pending_action.token }, bearer(USER_TOKEN))).status, 200);
    const list = (await (await fetch(a.url + '/v1/memories', { headers: bearer(USER_TOKEN) })).json()).memories;
    assert.deepEqual(list.map((m) => m.text), ['Prefers vegetarian dishes']);

    const next = await (await postJson(a.url + '/v1/chat', { message: 'Suggest a dish for dinner' }, bearer(USER_TOKEN))).json();
    assert.match(next.message.content, /Notes this person asked you to remember[\s\S]*Prefers vegetarian dishes/);

    const exported = await (await fetch(a.url + '/v1/account/export', { headers: bearer(USER_TOKEN) })).json();
    assert.deepEqual(exported.memories.map((m) => m.text), ['Prefers vegetarian dishes']);

    const guest = (await (await fetch(a.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    assert.equal((await fetch(a.url + '/v1/memories', { headers: bearer(guest) })).status, 403, 'guests have no memory');

    assert.equal((await fetch(a.url + '/v1/memories/' + list[0].id, { method: 'DELETE', headers: bearer(USER_TOKEN) })).status, 200);
    assert.doesNotMatch((await (await postJson(a.url + '/v1/chat', { message: 'Suggest a dish' }, bearer(USER_TOKEN))).json()).message.content, /vegetarian/);

    await a.store.addMemory({ tenantId: '00000000-0000-0000-0000-000000000001', userId: 'user-1', text: 'Lives in Cebu' });
    assert.equal((await postJson(a.url + '/v1/account/delete', { confirm: 'DELETE' }, bearer(USER_TOKEN))).status, 200);
    assert.equal((await a.store.listMemories({ tenantId: '00000000-0000-0000-0000-000000000001', userId: 'user-1' })).length, 0, 'deleted with the account');
  } finally { await a.close(); }
});
