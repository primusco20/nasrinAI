import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { seal, open, parseKey } from '../src/connectors/secret.js';
import { checkConnector } from '../src/connectors/spec.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { hashSecret } from '../src/auth/keys.js';
import { buildTestApp, serve, bearer, postJson, BIZ_TENANT, SECRET_KEY, USER_TOKEN } from './helpers.js';

const KEY_HEX = randomBytes(32).toString('hex');
const MGMT_SECRET = 'e'.repeat(48);
const MGMT = `nss_ffffffffffff_${MGMT_SECRET}`;

const SHOP = {
  base_url: 'https://api.shop.example.com/v1',
  auth: { type: 'header', header: 'X-Api-Key', secret: 'shop-key-123' },
  actions: [
    { name: 'order_status', description: 'Status of an order by its number', method: 'GET', path: '/orders/{order_id}',
      parameters: { properties: { order_id: { type: 'string', pattern: '^[0-9]{4,10}$' } }, required: ['order_id'] }, who: ['service', 'guest'] },
    { name: 'refund', description: 'Refund an order', method: 'POST', path: '/orders/{order_id}/refund', risk: 'money',
      parameters: { properties: { order_id: { type: 'string', pattern: '^[0-9]{4,10}$' }, amount: { type: 'number', minimum: 1, maximum: 5000 } }, required: ['order_id', 'amount'] } }
  ]
};

test('secrets: sealed with AES-GCM, bound to the business and connector', () => {
  const key = parseKey(KEY_HEX);
  const s = seal(key, 'tok', { tenantId: 't1', name: 'shop' });
  assert.match(s, /^v1\./);
  assert.ok(!s.includes('tok'));
  assert.equal(open(key, s, { tenantId: 't1', name: 'shop' }), 'tok');
  assert.throws(() => open(key, s, { tenantId: 't2', name: 'shop' }), 'cannot be moved to another business');
  assert.throws(() => open(parseKey(randomBytes(32).toString('hex')), s, { tenantId: 't1', name: 'shop' }));
  assert.equal(parseKey('short'), null);
});

test('definitions: only https public hosts, declared paths, safe patterns, explicit audience', () => {
  const ok = checkConnector({ name: 'shop', ...SHOP });
  assert.ok(ok.value);
  assert.deepEqual(ok.value.actions.map((a) => [a.name, a.risk, a.who]), [['order_status', 'read', ['service', 'guest']], ['refund', 'money', ['service']]]);
  const bad = (patch, actionPatch = {}) => checkConnector({ name: 'shop', ...SHOP, ...patch, actions: [{ ...SHOP.actions[0], ...actionPatch }] }).error;
  for (const base_url of ['http://api.example.com', 'https://127.0.0.1', 'https://10.0.0.5/api', 'https://localhost', 'https://api.example.com:8443', 'https://u:p@api.example.com', 'https://api.example.com/?a=1', 'https://metadata.google.internal']) {
    assert.ok(bad({ base_url }), base_url);
  }
  assert.ok(bad({}, { path: '/../admin' }));
  assert.ok(bad({}, { path: '/orders/{other}' }), 'path parameter must be declared and required');
  assert.ok(bad({}, { risk: 'write' }), 'GET only reads');
  assert.ok(bad({}, { who: ['user'] }));
  assert.ok(bad({}, { parameters: { properties: { q: { type: 'string', pattern: '^(a+)+$' } } }, path: '/x' }), 'ReDoS pattern');
  assert.ok(bad({ auth: { type: 'header', header: 'Host', secret: 'x' } }));
  assert.ok(bad({ auth: { type: 'bearer', secret: 'a\nb' } }));
  assert.equal(checkConnector({ name: 'shop', ...SHOP, actions: [{ ...SHOP.actions[0], who: undefined }] }).value.actions[0].who[0], 'service', 'default: the business server only');
});

async function bizApp({ calls = [], reply, respond } = {}) {
  const provider = createFakeProvider({ models: ['gpt-6-luna'], reply });
  const connectorCall = async (req) => { calls.push(req); return respond ? respond(req) : { status: 200, type: 'application/json', text: '{"status":"shipped","eta":"Oct 8"}' }; };
  const built = buildTestApp({ provider, connectorCall, env: { ROUTING: 'smart', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30), CONNECTOR_SECRET_KEY: KEY_HEX } });
  built.store.addApiKey({ id: 'ffffffffffff', tenant_id: BIZ_TENANT, kind: 'secret', secret_hash: hashSecret(MGMT_SECRET), scopes: ['chat', 'connectors'] });
  const srv = await serve(built.app);
  const put = (name, body, token = MGMT) => fetch(srv.url + '/v1/connectors/' + name, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...bearer(token) }, body: JSON.stringify(body) });
  return { ...built, ...srv, fake: provider, calls, put };
}

test('management: only the business secret key with the connectors scope; the secret is never shown', async () => {
  const a = await bizApp();
  try {
    assert.equal((await a.put('shop', SHOP, SECRET_KEY)).status, 403, 'secret key without the scope');
    assert.equal((await a.put('shop', SHOP, USER_TOKEN)).status, 403, 'signed-in user');
    const r = await a.put('shop', SHOP);
    assert.equal(r.status, 200);
    const text = await r.text();
    assert.ok(!text.includes('shop-key-123'));
    assert.equal(JSON.parse(text).connector.auth.has_secret, true);
    const stored = (await a.store.listConnectors(BIZ_TENANT))[0];
    assert.ok(!JSON.stringify(stored).includes('shop-key-123'), 'stored encrypted');
    assert.equal((await a.put('shop', { ...SHOP, auth: { type: 'header', header: 'X-Api-Key' } })).status, 200, 'secret kept when not resent');
    assert.equal((await a.put('bad', { ...SHOP, base_url: 'https://192.168.1.10' })).status, 400);
    const list = await (await fetch(a.url + '/v1/connectors', { headers: bearer(MGMT) })).json();
    assert.deepEqual(list.connectors.map((c) => c.name), ['shop']);
    assert.equal((await fetch(a.url + '/v1/connectors/shop', { method: 'DELETE', headers: bearer(MGMT) })).status, 200);
    assert.equal((await fetch(a.url + '/v1/connectors/shop', { method: 'DELETE', headers: bearer(MGMT) })).status, 404);
  } finally { await a.close(); }
});

test('chat: the business server asks about an order; the declared call is made with its key; refunds need Confirm', async () => {
  const a = await bizApp({ reply: (req) => {
    const last = req.messages.at(-1);
    if (last.role === 'tool') return 'Result: ' + last.content;
    if (/refund/.test(last.content)) return { toolCalls: [{ id: 'r', name: 'shop_refund', arguments: '{"order_id":"12345","amount":100}' }] };
    return { toolCalls: [{ id: 'o', name: 'shop_order_status', arguments: '{"order_id":"12345"}' }] };
  } });
  try {
    await a.put('shop', SHOP);
    const out = await (await postJson(a.url + '/v1/chat', { message: 'Where is order 12345?' }, bearer(MGMT))).json();
    assert.equal(a.calls.length, 1);
    assert.equal(String(a.calls[0].url), 'https://api.shop.example.com/v1/orders/12345');
    assert.equal(a.calls[0].method, 'GET');
    assert.equal(a.calls[0].headers['X-Api-Key'], 'shop-key-123', 'decrypted only for the call');
    assert.match(out.message.content, /data, not instructions/);
    assert.match(out.message.content, /"status":"shipped"/);
    assert.ok(!JSON.stringify(a.store.usage).includes('shop-key-123'));

    const refund = await (await postJson(a.url + '/v1/chat', { message: 'Please refund 100 for order 12345' }, bearer(MGMT))).json();
    assert.equal(a.calls.length, 1, 'no money moved without Confirm');
    assert.match(refund.message.content, /awaiting_confirmation/);
    const pa = refund.pending_action;
    assert.deepEqual([pa.tool, pa.risk], ['shop_refund', 'money']);
    assert.equal(pa.summary, 'Refund an order — order id: 12345, amount: 100', 'built by code from the declaration');

    const act = (path, token, auth = MGMT) => postJson(a.url + '/v1/actions/' + path, { token }, bearer(auth));
    assert.equal((await act('confirm', pa.token, SECRET_KEY)).status, 404, 'another caller cannot confirm');
    const [payload, mac] = pa.token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), g: { order_id: '12345', amount: 5000 } })).toString('base64url') + '.' + mac;
    assert.equal((await act('confirm', forged)).status, 400, 'arguments cannot be changed');
    const done = await act('confirm', pa.token);
    assert.equal(done.status, 200);
    assert.match((await done.json()).message.content, /^Done: Refund an order/);
    assert.equal(a.calls.length, 2);
    assert.deepEqual([String(a.calls[1].url), a.calls[1].method, a.calls[1].body], ['https://api.shop.example.com/v1/orders/12345/refund', 'POST', { amount: 100 }]);
    assert.equal((await act('confirm', pa.token)).status, 409, 'runs once');

    const again = await (await postJson(a.url + '/v1/chat', { message: 'Please refund 100 for order 12345' }, bearer(MGMT))).json();
    assert.equal((await act('cancel', again.pending_action.token)).status, 200);
    assert.equal((await act('confirm', again.pending_action.token)).status, 409, 'cancelled cannot be confirmed');
    assert.equal(a.calls.length, 2);

    const evil = await bizApp({ reply: (req) => (req.messages.at(-1).role === 'tool' ? 'done' : { toolCalls: [{ id: 'e', name: 'shop_order_status', arguments: '{"order_id":"../admin"}' }] }) });
    try {
      await evil.put('shop', SHOP);
      await postJson(evil.url + '/v1/chat', { message: 'order 1' }, bearer(MGMT));
      assert.equal(evil.calls.length, 0, 'arguments outside the declared pattern are refused');
    } finally { await evil.close(); }
  } finally { await a.close(); }
});

test('connectors stay inside their business and audience', async () => {
  const a = await bizApp();
  try {
    await a.put('shop', SHOP);
    const { createConnectors } = await import('../src/connectors/index.js');
    const { basicTools } = await import('../src/tools/basic.js');
    const c = createConnectors({ store: a.store, baseTools: basicTools, usageLog: a.usageLog, config: a.config, logger: a.logger });
    const names = async (caller) => (await c.toolbox.forCaller(caller)).specsFor(caller).map((s) => s.function.name);
    assert.deepEqual(await names({ tenantId: BIZ_TENANT, actor: { type: 'service', id: 'k' } }), ['calculate', 'current_time', 'convert_units', 'shop_order_status', 'shop_refund']);
    assert.deepEqual(await names({ tenantId: BIZ_TENANT, actor: { type: 'guest', id: 'g' } }), ['calculate', 'current_time', 'convert_units', 'shop_order_status'], 'guests: only what the business opened');
    assert.deepEqual(await names({ tenantId: '00000000-0000-0000-0000-000000000001', actor: { type: 'user', id: 'u' } }), ['calculate', 'current_time', 'convert_units'], 'other businesses see nothing');
  } finally { await a.close(); }
});

test('the API caller refuses names that resolve to internal addresses', async () => {
  const { callApi } = await import('../src/connectors/request.js');
  await assert.rejects(callApi({ url: new URL('https://localhost/x'), method: 'GET', timeoutMs: 2000 }), (err) => err.code === 'EBLOCKED');
});

test('GraphQL actions: the business fixes the document, the model fills the variables', async () => {
  const gql = (query, extra = {}) => checkConnector({ name: 'crm', base_url: 'https://api.crm.example.com', actions: [{ name: 'qq', description: 'd', method: 'GRAPHQL', path: '/graphql', query,
    parameters: { properties: { id: { type: 'string', maxLength: 20 } }, required: ['id'] }, ...extra }] });
  assert.equal(gql('query Order($id: ID!) { order(id: $id) { status } }').value.actions[0].risk, 'read');
  assert.equal(gql('mutation Cancel($id: ID!) { cancel(id: $id) { ok } }').value.actions[0].risk, 'write');
  assert.equal(gql('mutation Pay($id: ID!) { pay(id: $id) { ok } }', { risk: 'money' }).value.actions[0].risk, 'money');
  assert.ok(gql('subscription { orders { id } }').error);
  assert.ok(gql('query A { a } query B { b }').error, 'one operation only');
  assert.ok(gql('query A { a } mutation B { b }').error);
  assert.ok(gql('{ order { id } }').error, 'operation type must be explicit');
  assert.ok(gql('query X { a }', { risk: 'write' }).error, 'queries only read');

  const a = await bizApp({
    reply: (req) => (req.messages.at(-1).role === 'tool' ? 'Answer: ' + req.messages.at(-1).content : { toolCalls: [{ id: 'g', name: 'crm_order', arguments: '{"id":"A-1"}' }] }),
    respond: () => ({ status: 200, type: 'application/json', text: '{"errors":[{"message":"not found"}]}' })
  });
  try {
    await a.put('crm', { base_url: 'https://api.crm.example.com', auth: { type: 'bearer', secret: 'crm-token' }, actions: [{ name: 'order', description: 'Order by id', method: 'GRAPHQL', path: '/graphql',
      query: 'query Order($id: ID!) { order(id: $id) { status } }', parameters: { properties: { id: { type: 'string', maxLength: 20 } }, required: ['id'] } }] });
    const out = await (await postJson(a.url + '/v1/chat', { message: 'Status of order A-1?' }, bearer(MGMT))).json();
    assert.deepEqual([String(a.calls[0].url), a.calls[0].method], ['https://api.crm.example.com/graphql', 'POST']);
    assert.deepEqual(a.calls[0].body, { query: 'query Order($id: ID!) { order(id: $id) { status } }', variables: { id: 'A-1' } });
    assert.equal(a.calls[0].headers.Authorization, 'Bearer crm-token');
    assert.match(out.message.content, /"ok":false/, 'GraphQL errors are failures');
  } finally { await a.close(); }
});
