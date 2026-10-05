import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { toMessengerText, verifySignature } from '../src/channels/facebook.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { hashSecret } from '../src/auth/keys.js';
import { buildTestApp, serve, bearer, BIZ_TENANT, SECRET_KEY, testConfig } from './helpers.js';

const APP_SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const VERIFY = 'verify-token-0123456789';
const KEY_HEX = randomBytes(32).toString('hex');
const MGMT = `nss_ffffffffffff_${'e'.repeat(48)}`;
const PAGE = '1029384756';
const PAGE_TOKEN = 'EAAG' + 'x'.repeat(60);
const ENV = { FACEBOOK_APP_SECRET: APP_SECRET, FACEBOOK_VERIFY_TOKEN: VERIFY, CONNECTOR_SECRET_KEY: KEY_HEX };

const signed = (body) => {
  const raw = JSON.stringify(body);
  return { raw, sig: 'sha256=' + createHmac('sha256', APP_SECRET).update(raw).digest('hex') };
};
const event = (text, mid, extra = {}) => ({ object: 'page', entry: [{ id: PAGE, messaging: [{ sender: { id: '55501234' }, recipient: { id: PAGE }, message: { mid, text, ...extra } }] }] });

async function fbApp(reply = (req) => `Hi! You said: ${req.messages.at(-1).content}`, env = {}) {
  const sent = [];
  const facebookFetch = async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return Response.json({ message_id: 'm' }); };
  const provider = createFakeProvider({ models: ['gpt-6-luna'], reply });
  const built = buildTestApp({ provider, facebookFetch, env: { ...ENV, ...env } });
  built.store.addApiKey({ id: 'ffffffffffff', tenant_id: BIZ_TENANT, kind: 'secret', secret_hash: hashSecret('e'.repeat(48)), scopes: ['chat', 'connectors'] });
  const srv = await serve(built.app);
  const post = async (body, sig) => {
    const s = signed(body);
    return fetch(srv.url + '/v1/webhooks/facebook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig ?? s.sig }, body: s.raw });
  };
  const connect = (token = MGMT, page = PAGE) => fetch(srv.url + '/v1/channels/facebook', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...bearer(token) }, body: JSON.stringify({ page_id: page, page_access_token: PAGE_TOKEN }) });
  return { ...built, ...srv, sent, post, connect, fake: provider };
}

test('settings: Messenger is on only with a valid app secret, verify token and connector key', () => {
  assert.equal(testConfig({}).facebook, null);
  assert.equal(testConfig(ENV).facebook.appSecret, APP_SECRET);
  assert.ok(testConfig({ ...ENV, FACEBOOK_APP_SECRET: 'short' }).warnings.some((w) => /FACEBOOK_APP_SECRET/.test(w)));
  assert.ok(testConfig({ ...ENV, CONNECTOR_SECRET_KEY: '' }).warnings.some((w) => /Messenger needs CONNECTOR_SECRET_KEY/.test(w)));
  assert.ok(testConfig({ ...ENV, FACEBOOK_GRAPH_VERSION: 'latest' }).warnings.some((w) => /FACEBOOK_GRAPH_VERSION/.test(w)));
});

test('webhook check and signatures', async () => {
  const a = await fbApp();
  try {
    const ok = await fetch(a.url + `/v1/webhooks/facebook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345abc`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), '12345abc');
    assert.equal((await fetch(a.url + '/v1/webhooks/facebook?hub.mode=subscribe&hub.verify_token=wrong-token-0123456&hub.challenge=1')).status, 403);
    assert.equal((await a.post(event('hi', 'm1'), 'sha256=' + '0'.repeat(64))).status, 401);
    assert.equal((await a.post(event('hi', 'm1'), 'nope')).status, 401);
    assert.equal(verifySignature(APP_SECRET, Buffer.from('x'), 'sha256=' + createHmac('sha256', APP_SECRET).update('x').digest('hex')), true);
  } finally { await a.close(); }
});

test('connecting a Page: business key only, token encrypted, one business per Page', async () => {
  const a = await fbApp();
  try {
    assert.equal((await a.connect(SECRET_KEY)).status, 403, 'needs the connectors scope');
    assert.equal((await a.connect()).status, 200);
    const stored = await a.store.getChannel('facebook', PAGE);
    assert.ok(!stored.secretEnc.includes('xxxx'), 'stored encrypted');
    const list = await (await fetch(a.url + '/v1/channels/facebook', { headers: bearer(MGMT) })).text();
    assert.ok(!list.includes(PAGE_TOKEN) && list.includes(PAGE));
    a.store.addTenant({ id: '33333333-3333-4333-8333-333333333333' });
    a.store.addApiKey({ id: 'abcabcabcabc', tenant_id: '33333333-3333-4333-8333-333333333333', kind: 'secret', secret_hash: hashSecret('d'.repeat(48)), scopes: ['chat', 'connectors'] });
    assert.equal((await a.connect(`nss_abcabcabcabc_${'d'.repeat(48)}`)).status, 409, 'cannot take another business’s Page');
  } finally { await a.close(); }
});

test('a Messenger message is answered once, as a guest of the Page’s business, in one conversation', async () => {
  const a = await fbApp();
  try {
    assert.equal((await a.post(event('hello', 'mid.1'))).status, 200);
    assert.equal(a.sent.length, 0, 'Page not connected yet: nothing sent');
    await a.connect();
    await a.post(event('hello', 'mid.2'));
    await a.post(event('hello', 'mid.2'));
    assert.equal(a.sent.length, 1, 'Meta retries are answered once');
    assert.deepEqual(a.sent[0].body.recipient, { id: '55501234' });
    assert.equal(a.sent[0].body.access_token, PAGE_TOKEN, 'decrypted only to send');
    assert.equal(a.sent[0].body.message.text, 'Hi! You said: hello');
    assert.equal(a.sent[0].url, 'https://graph.facebook.com/me/messages');

    await a.post(event('again', 'mid.3'));
    const convs = await a.store.listConversations({ tenantId: BIZ_TENANT, ownerType: 'guest', ownerId: 'fb_55501234' });
    assert.equal(convs.length, 1, 'the same conversation continues');
    assert.equal(a.fake.calls.at(-1).messages.length, 3);

    await a.post(event('', 'mid.4', { attachments: [{ type: 'image' }] }));
    assert.match(a.sent.at(-1).body.message.text, /only read text/);
    await a.post({ object: 'page', entry: [{ id: PAGE, messaging: [{ sender: { id: PAGE }, message: { mid: 'mid.5', text: 'echo', is_echo: true } }] }] });
    assert.equal(a.sent.length, 3, 'echoes ignored');
  } finally { await a.close(); }
});

test('Messenger text: Markdown removed, long replies split', () => {
  assert.deepEqual(toMessengerText('## Menu\n**Adobo** and `rice`. See [site](https://x.example)'), ['Menu\nAdobo and rice. See site (https://x.example)']);
  const long = toMessengerText(('Sentence number one is here. ').repeat(150));
  assert.ok(long.length >= 2 && long.every((p) => p.length <= 2000));
});

test('Messenger cannot show Confirm, so write/money tools are refused there', async () => {
  const a = await fbApp((req) => (req.messages.at(-1).role === 'tool' ? 'Tool said: ' + req.messages.at(-1).content : { toolCalls: [{ id: 'w', name: 'shop_cancel', arguments: '{"order_id":"123456"}' }] }), { ROUTING: 'smart', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30) });
  try {
    await a.store.putConnector({ tenantId: BIZ_TENANT, name: 'shop', baseUrl: 'https://api.shop.example.com', authType: 'none', authHeader: null, secretEnc: null, enabled: true,
      actions: [{ name: 'cancel', description: 'Cancel an order', method: 'POST', path: '/orders/{order_id}/cancel', parameters: { properties: { order_id: { type: 'string' } }, required: ['order_id'] }, risk: 'write', who: ['guest'] }] });
    await a.connect();
    await a.post(event('Cancel order 123456', 'mid.w'));
    assert.match(a.sent.at(-1).body.message.text, /needs your confirmation/);
    assert.doesNotMatch(a.sent.at(-1).body.message.text, /awaiting_confirmation/);
  } finally { await a.close(); }
});
