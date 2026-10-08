import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createConnect, isBlockedAddress } from '../src/connect/index.js';
import { createInstallRegistry } from '../src/connect/provider-registry.js';
import { HttpError } from '../src/http/errors.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const A = { tenantId: TENANT_A, actor: { id: 'user-a', type: 'user' } };
const B = { tenantId: TENANT_B, actor: { id: 'user-b', type: 'user' } };
const CONFIG = { roles: ['sales'], tone: 'friendly', welcome: 'Hi!', human_handoff: true };

// A tiny stand-in for the Supabase REST API, enough for connect_installations:
// eq./neq. filters, limit, POST, PATCH, and the (tenant, origin) unique index.
function fakeDb() {
  const rows = [];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const matches = (row, params) => {
    for (const [key, value] of params) {
      if (['select', 'order', 'limit'].includes(key)) continue;
      const m = /^(eq|neq)\.(.*)$/.exec(value);
      if (!m) continue;
      const same = String(row[key]) === m[2];
      if (m[1] === 'eq' ? !same : same) return false;
    }
    return true;
  };
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  async function fetchImpl(url, init) {
    const u = new URL(url);
    assert.equal(u.pathname.split('/rest/v1/')[1], 'connect_installations');
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (init.method === 'GET') {
      let found = rows.filter((r) => matches(r, u.searchParams)).map(clone);
      const limit = Number(u.searchParams.get('limit'));
      if (limit) found = found.slice(0, limit);
      return reply(200, found);
    }
    if (init.method === 'POST') {
      if (rows.some((r) => r.tenant_id === body.tenant_id && r.site_origin === body.site_origin)) return reply(409, {});
      const row = {
        id: randomUUID(), status: 'discovered', platform: null, installation_method: null, authorization_method: null,
        authorization_ref: null, verification_token_hash: null, verification_expires_at: null, activated_at: null,
        removed_at: null, last_verified_at: null, last_error_code: null, last_error_message: null, metadata: {},
        ai_config: {}, config_approved_at: null, config_approved_by: null, config_approval_hash: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...clone(body)
      };
      rows.push(row);
      return reply(201, [clone(row)]);
    }
    if (init.method === 'PATCH') {
      const hit = rows.filter((r) => matches(r, u.searchParams));
      hit.forEach((r) => Object.assign(r, clone(body)));
      return reply(200, hit.map(clone));
    }
    throw new Error('unexpected ' + init.method);
  }
  return { rows, fetchImpl };
}

function setup({ adapters = {}, createPublishableKey } = {}) {
  const db = fakeDb();
  const calls = [];
  const connect = createConnect({
    url: 'https://db.test', secretKey: 'secret', fetchImpl: db.fetchImpl,
    installRegistry: createInstallRegistry(adapters),
    createPublishableKey: createPublishableKey === undefined
      ? async (args) => { calls.push(args); return 'nsp_aaaaaaaaaaaa'; }
      : createPublishableKey,
    analyze: async (value) => {
      const host = new URL(value).hostname.toLowerCase();
      return { origin: 'https://' + host, host, platform: 'custom', title: 'Shop', scripts: 1 };
    },
    verifyOwnership: async () => 'meta'
  });
  return { connect, db, calls };
}

const is = (code, status) => (error) => error instanceof HttpError && error.code === code && (status === undefined || error.status === status);

async function authorizedSite(connect, caller = A, url = 'https://shop.example.com') {
  const site = await connect.analyzeAndCreate(caller, url);
  await connect.verify(caller, site.id, site.verification.token);
  return site;
}
async function approvedSite(connect, caller = A) {
  const site = await authorizedSite(connect, caller);
  await connect.saveConfig(caller, site.id, CONFIG);
  await connect.approveConfig(caller, site.id);
  return site.id;
}
const goodAdapter = (extra = {}) => ({
  async install() { return { token: 'provider-secret-123' }; },
  async verify() { return { ok: true, version: 'v1' }; },
  async rollback() {},
  ...extra
});

// ---------------------------------------------------------------- guards
// Regression: these guards used to throw "ReferenceError: HttpError is not defined".
test('connect: guard errors are real HTTP errors, not crashes', async () => {
  const { connect } = setup();
  const unknown = randomUUID();
  await assert.rejects(connect.saveConfig(A, unknown, CONFIG), is('not_found', 404));
  await assert.rejects(connect.previewConfig(A, unknown), is('not_found', 404));
  await assert.rejects(connect.approveConfig(A, unknown), is('not_found', 404));
  await assert.rejects(connect.install(A, unknown, 'hosting'), is('not_found', 404));
  await assert.rejects(connect.provisionKey(A, unknown), is('not_found', 404));
});

test('connect: other tenants cannot see or change a site', async () => {
  const { connect } = setup({ adapters: { hosting: goodAdapter() } });
  const id = await approvedSite(connect, A);
  assert.equal(await connect.get(B, id), null);
  assert.deepEqual(await connect.list(B), []);
  await assert.rejects(connect.saveConfig(B, id, CONFIG), is('not_found'));
  await assert.rejects(connect.install(B, id, 'hosting'), is('not_found'));
  assert.equal(await connect.remove(B, id), false);
  assert.equal((await connect.get(A, id)).status, 'ready');
});

// ---------------------------------------------------------------- discovery and authorization
test('connect: analyze returns the challenge once and never exposes its hash', async () => {
  const { connect, db } = setup();
  const site = await connect.analyzeAndCreate(A, 'https://Shop.Example.com');
  assert.equal(site.status, 'verification_required');
  assert.equal(site.site_origin, 'https://shop.example.com');
  assert.ok(site.verification.token.length >= 20);
  assert.equal(JSON.stringify(site).includes('verification_token_hash'), false);
  assert.equal(db.rows[0].verification_token_hash.length, 64);
  assert.equal(JSON.stringify(await connect.get(A, site.id)).includes(site.verification.token), false);
});

test('connect: verify needs the right, unexpired token', async () => {
  const { connect, db } = setup();
  const site = await connect.analyzeAndCreate(A, 'https://shop.example.com');
  assert.equal(await connect.verify(A, site.id, 'x'.repeat(32)), null);
  assert.equal(await connect.verify(B, site.id, site.verification.token), null);
  db.rows[0].verification_expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal(await connect.verify(A, site.id, site.verification.token), null);
  db.rows[0].verification_expires_at = new Date(Date.now() + 60_000).toISOString();
  const done = await connect.verify(A, site.id, site.verification.token);
  assert.equal(done.status, 'authorized');
  assert.equal(done.authorization_method, 'meta');
  assert.equal(db.rows[0].verification_token_hash, null);
});

test('connect: the same website cannot be added twice, but a removed one can start over', async () => {
  const { connect, db } = setup();
  const first = await approvedSite(connect, A);
  await assert.rejects(connect.analyzeAndCreate(A, 'https://shop.example.com'), is('already_connected', 409));
  // another business may connect the same origin on its own account
  assert.equal((await connect.analyzeAndCreate(B, 'https://shop.example.com')).status, 'verification_required');

  assert.equal(await connect.remove(A, first), true);
  const again = await connect.analyzeAndCreate(A, 'https://shop.example.com');
  assert.equal(again.id, first);
  assert.equal(again.status, 'verification_required');
  assert.ok(again.verification.token);
  const row = db.rows.find((r) => r.id === first);
  assert.deepEqual(row.ai_config, {});
  assert.equal(row.config_approval_hash, null);
  assert.equal(row.config_approved_at, null);
  assert.equal(row.removed_at, null);
  assert.equal(row.authorization_method, null);
});

// ---------------------------------------------------------------- configuration and approval
test('connect: configuration is validated on the server', async () => {
  const { connect } = setup();
  const site = await authorizedSite(connect);
  await assert.rejects(connect.saveConfig(A, site.id, null), is('invalid_config', 400));
  await assert.rejects(connect.saveConfig(A, site.id, []), is('invalid_config', 400));
  await assert.rejects(connect.saveConfig(A, site.id, { roles: ['hacker'] }), is('invalid_config', 400));
  const saved = await connect.saveConfig(A, site.id, { roles: ['sales', 'hacker', 'sales'], tone: 'rude', welcome: 'w'.repeat(500) });
  assert.deepEqual(saved.ai_config.roles, ['sales']);
  assert.equal(saved.ai_config.tone, 'professional');
  assert.equal(saved.ai_config.welcome.length, 280);
  assert.equal(saved.status, 'ready');
});

test('connect: configuration must be saved before preview or approval', async () => {
  const { connect } = setup();
  const site = await authorizedSite(connect);
  await assert.rejects(connect.previewConfig(A, site.id), is('config_required', 409));
  await assert.rejects(connect.approveConfig(A, site.id), is('config_required', 409));
  await connect.saveConfig(A, site.id, CONFIG);
  const preview = await connect.previewConfig(A, site.id);
  assert.deepEqual(preview.configuration.roles, ['Sales']);
  assert.ok(preview.effects.some((line) => /does not modify your website/i.test(line)));
});

test('connect: changing the configuration clears its approval', async () => {
  const { connect, db } = setup();
  const id = await approvedSite(connect);
  assert.ok(db.rows[0].config_approval_hash);
  await connect.saveConfig(A, id, { ...CONFIG, tone: 'warm' });
  assert.equal(db.rows[0].config_approval_hash, null);
  assert.equal(db.rows[0].config_approved_at, null);
});

// ---------------------------------------------------------------- installation gate
test('connect: install is refused until the site is ready and approved', async () => {
  const { connect } = setup({ adapters: { hosting: goodAdapter() } });
  const site = await authorizedSite(connect);
  await assert.rejects(connect.install(A, site.id, 'hosting'), is('invalid_state', 409));
  await connect.saveConfig(A, site.id, CONFIG);
  await assert.rejects(connect.install(A, site.id, 'hosting'), is('approval_required', 409));
});

test('connect: an approval does not survive a changed configuration', async () => {
  let installs = 0;
  const { connect, db } = setup({ adapters: { hosting: goodAdapter({ async install() { installs += 1; return {}; } }) } });
  const id = await approvedSite(connect);
  db.rows[0].ai_config = { ...db.rows[0].ai_config, welcome: 'changed behind the approval' };
  await assert.rejects(connect.install(A, id, 'hosting'), is('approval_stale', 409));
  assert.equal(installs, 0);
  assert.equal(db.rows[0].status, 'ready');
});

test('connect: with no provider, install fails closed BEFORE the lifecycle changes', async () => {
  const { connect, db } = setup(); // empty registry, like production today
  const id = await approvedSite(connect);
  await assert.rejects(connect.install(A, id, 'hosting'), is('provider_unavailable', 409));
  await assert.rejects(connect.install(A, id, 'authorized_script'), is('provider_unavailable', 409));
  await assert.rejects(connect.install(A, id, ''), is('invalid_method', 400));
  await assert.rejects(connect.install(A, id, 'x'.repeat(65)), is('invalid_method', 400));
  assert.equal(db.rows[0].status, 'ready');
  assert.equal(db.rows[0].installation_method, null);
  assert.equal(db.rows[0].last_error_code, null);
  assert.equal(db.rows[0].activated_at, null);
});

test('connect: verified install goes active and never stores or returns the raw receipt', async () => {
  const { connect, db } = setup({ adapters: { hosting: goodAdapter() } });
  const id = await approvedSite(connect);
  const result = await connect.install(A, id, 'hosting');
  assert.deepEqual(result, { active: true, version: 'v1' });
  const row = db.rows[0];
  assert.equal(row.status, 'active');
  assert.ok(row.activated_at && row.last_verified_at);
  assert.match(row.metadata.deployment_receipt_hash, /^[0-9a-f]{64}$/);
  assert.equal(row.metadata.version, 'v1');
  assert.equal(JSON.stringify(row).includes('provider-secret-123'), false);
});

test('connect: failed verification rolls back and is recorded as failed, never active', async () => {
  let rolledBack = 0;
  const { connect, db } = setup({ adapters: { hosting: goodAdapter({
    async verify() { return { ok: false }; },
    async rollback() { rolledBack += 1; }
  }) } });
  const id = await approvedSite(connect);
  await assert.rejects(connect.install(A, id, 'hosting'), is('verification_failed', 502));
  assert.equal(rolledBack, 1);
  assert.equal(db.rows[0].status, 'failed');
  assert.equal(db.rows[0].last_error_code, 'verification_failed');
  assert.equal(db.rows[0].activated_at, null);
});

test('connect: a failed rollback is surfaced as rollback_failed', async () => {
  const { connect, db } = setup({ adapters: { hosting: goodAdapter({
    async verify() { return { ok: false }; },
    async rollback() { throw new Error('provider down'); }
  }) } });
  const id = await approvedSite(connect);
  await assert.rejects(connect.install(A, id, 'hosting'), is('rollback_failed', 502));
  assert.equal(db.rows[0].status, 'failed');
  assert.equal(db.rows[0].last_error_code, 'rollback_failed');
  assert.match(db.rows[0].last_error_message, /rollback could not complete/i);
});

test('connect: two simultaneous installs enter the provider only once', async () => {
  let installs = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { connect, db } = setup({ adapters: { hosting: goodAdapter({
    async install() { installs += 1; await gate; return {}; }
  }) } });
  const id = await approvedSite(connect);
  const both = Promise.allSettled([connect.install(A, id, 'hosting'), connect.install(A, id, 'hosting')]);
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const [x, y] = await both;
  assert.equal(installs, 1);
  assert.deepEqual([x.status, y.status].sort(), ['fulfilled', 'rejected']);
  const loser = x.status === 'rejected' ? x.reason : y.reason;
  assert.ok(['installation_in_progress', 'invalid_state'].includes(loser.code));
  assert.equal(db.rows[0].status, 'active');
});

// ---------------------------------------------------------------- removal
test('connect: a site cannot be removed while it is installing; removing twice is harmless', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { connect, db } = setup({ adapters: { hosting: goodAdapter({ async install() { await gate; return {}; } }) } });
  const id = await approvedSite(connect);
  const installing = connect.install(A, id, 'hosting');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(db.rows[0].status, 'installing');
  await assert.rejects(connect.remove(A, id), is('installation_in_progress', 409));
  release();
  await installing;
  assert.equal(db.rows[0].status, 'active');

  assert.equal(await connect.remove(A, id), true);
  const removedAt = db.rows[0].removed_at;
  assert.ok(removedAt);
  assert.equal(await connect.remove(A, id), true);
  assert.equal(db.rows[0].removed_at, removedAt);
  assert.equal(await connect.remove(A, randomUUID()), false);
  await assert.rejects(connect.saveConfig(A, id, CONFIG), is('removed', 409));
});

// ---------------------------------------------------------------- widget key
test('connect: a widget key needs a current approval and is not an installation', async () => {
  const { connect, db, calls } = setup();
  const site = await authorizedSite(connect);
  await assert.rejects(connect.provisionKey(A, site.id), is('approval_required', 409));
  await connect.saveConfig(A, site.id, CONFIG);
  await assert.rejects(connect.provisionKey(A, site.id), is('approval_required', 409));
  await connect.approveConfig(A, site.id);

  const issued = await connect.provisionKey(A, site.id);
  assert.deepEqual(issued, { key: 'nsp_aaaaaaaaaaaa', origin: 'https://shop.example.com' });
  assert.deepEqual(calls, [{ tenantId: TENANT_A, origin: 'https://shop.example.com', label: 'NasrinAI Connect' }]);
  assert.equal(db.rows[0].status, 'ready'); // key provision is not installation
  assert.equal(db.rows[0].activated_at, null);

  db.rows[0].ai_config = { ...db.rows[0].ai_config, tone: 'concise' };
  await assert.rejects(connect.provisionKey(A, site.id), is('approval_stale', 409));
});

test('connect: without key provisioning configured, it says so', async () => {
  const { connect } = setup({ createPublishableKey: null });
  const id = await approvedSite(connect);
  await assert.rejects(connect.provisionKey(A, id), is('key_provisioning_unavailable', 503));
});

// ---------------------------------------------------------------- address filter (SSRF)
test('connect: private and special addresses are blocked in every IPv6/IPv4 spelling', () => {
  const blocked = [
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::', '::1', '::127.0.0.1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:10.0.0.5', '::ffff:169.254.169.254',
    'fc00::1', 'fd12:3456::1', 'fe80::1', 'febf::1', 'fec0::1', 'ff02::1',
    '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1',
    'not-an-ip'
  ];
  for (const ip of blocked) assert.equal(isBlockedAddress(ip), true, ip + ' should be blocked');
  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '::ffff:808:808'];
  for (const ip of allowed) assert.equal(isBlockedAddress(ip), false, ip + ' should be allowed');
});

test('connect: an unreachable database or an empty insert gives a clear error, never a generic 500', async () => {
  const down = createConnect({
    url: 'https://db.test', secretKey: 'secret',
    fetchImpl: async () => { throw new TypeError('fetch failed', { cause: Object.assign(new Error('boom'), { code: 'ECONNREFUSED' }) }); },
    analyze: async () => ({ origin: 'https://shop.example', host: 'shop.example', platform: 'custom' })
  });
  await assert.rejects(down.analyzeAndCreate({ tenantId: 't1' }, 'https://shop.example'), is('storage_unavailable', 503));

  const empty = createConnect({
    url: 'https://db.test', secretKey: 'secret',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }),
    analyze: async () => ({ origin: 'https://shop.example', host: 'shop.example', platform: 'custom' })
  });
  await assert.rejects(empty.analyzeAndCreate({ tenantId: 't1' }, 'https://shop.example'), is('storage_error', 503));
});
