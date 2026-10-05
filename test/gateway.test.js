import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/http/errors.js';
import {
  buildTestApp, serve, bearer, BIZ_TENANT, PUB_KEY, SECRET_KEY, USER_TOKEN
} from './helpers.js';

const PLATFORM = '00000000-0000-0000-0000-000000000001';
let srv;

before(async () => {
  const { app } = buildTestApp({
    verifyUser: async (t) => {
      if (t === USER_TOKEN) return { id: 'user-1' };
      if (t === 'down.down.down') throw new HttpError(503, 'auth_unavailable', 'Sign-in is temporarily unavailable.');
      return null;
    },
    extraRoutes: [{ method: 'GET', path: '/v1/test/admin', scope: 'admin', handler: async () => ({ body: { ok: true } }) }]
  });
  srv = await serve(app);
});
after(() => srv.close());

const whoami = (headers) => fetch(srv.url + '/v1/whoami', { headers });
const newGuest = (headers = {}) => fetch(srv.url + '/v1/guest/sessions', { method: 'POST', headers });

test('no credential, or an unknown one, is refused', async () => {
  for (const h of [{}, { Authorization: 'Basic abc' }, bearer('nope'), bearer('a.b.c'), bearer('nsg_bad.sig')]) {
    assert.equal((await whoami(h)).status, 401, JSON.stringify(h));
  }
});

test('a platform guest session works and is a guest of the platform', async () => {
  const r = await newGuest();
  assert.equal(r.status, 201);
  const { token, tenant_id, expires_at } = await r.json();
  assert.equal(tenant_id, PLATFORM);
  assert.ok(Date.parse(expires_at) > Date.now());
  const me = await (await whoami(bearer(token))).json();
  assert.deepEqual(me, { actor_type: 'guest', tenant_id: PLATFORM, scopes: ['chat'] });
});

test('a publishable key starts a business guest session only from its listed website', async () => {
  const ok = await newGuest({ 'X-NasrinAI-Key': PUB_KEY, Origin: 'https://shop.example.com' });
  assert.equal(ok.status, 201);
  const { token } = await ok.json();
  assert.equal((await (await whoami(bearer(token))).json()).tenant_id, BIZ_TENANT);

  assert.equal((await newGuest({ 'X-NasrinAI-Key': PUB_KEY, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await newGuest({ 'X-NasrinAI-Key': PUB_KEY })).status, 403, 'no origin');
  assert.equal((await newGuest({ 'X-NasrinAI-Key': 'nsp_999999999999', Origin: 'https://shop.example.com' })).status, 401, 'unknown key');
  assert.equal((await newGuest({ 'X-NasrinAI-Key': SECRET_KEY, Origin: 'https://shop.example.com' })).status, 401, 'secret key in a browser header');
});

test('a publishable key cannot be used as a caller', async () => {
  assert.equal((await whoami(bearer(PUB_KEY))).status, 401);
});

test('secret keys: valid works; wrong secret, revoked, suspended business are refused', async () => {
  const me = await (await whoami(bearer(SECRET_KEY))).json();
  assert.deepEqual(me, { actor_type: 'service', tenant_id: BIZ_TENANT, scopes: ['chat'] });
  assert.equal((await whoami(bearer('nss_cccccccccccc_' + 'f'.repeat(48)))).status, 401, 'wrong secret');
  assert.equal((await whoami(bearer('nss_dddddddddddd_' + 'd'.repeat(48)))).status, 401, 'revoked');
  assert.equal((await whoami(bearer('nss_eeeeeeeeeeee_' + 'e'.repeat(48)))).status, 403, 'suspended business');
});

test('signed-in users belong to the platform; an auth outage is a 503, not a sign-out', async () => {
  const me = await (await whoami(bearer(USER_TOKEN))).json();
  assert.deepEqual(me, { actor_type: 'user', tenant_id: PLATFORM, scopes: ['chat'] });
  assert.equal((await whoami(bearer('down.down.down'))).status, 503);
});

test('the body can never choose the tenant', async () => {
  const r = await fetch(srv.url + '/v1/guest/sessions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenant_id: BIZ_TENANT })
  });
  assert.equal((await r.json()).tenant_id, PLATFORM);
});

test('routes that need a scope refuse callers without it', async () => {
  assert.equal((await fetch(srv.url + '/v1/test/admin', { headers: bearer(SECRET_KEY) })).status, 403);
});

test('CORS preflight is answered without allowing credentials', async () => {
  const r = await fetch(srv.url + '/v1/whoami', { method: 'OPTIONS', headers: { Origin: 'https://shop.example.com', 'Access-Control-Request-Method': 'GET' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://shop.example.com');
  assert.equal(r.headers.get('access-control-allow-credentials'), null);
  assert.match(r.headers.get('access-control-allow-headers'), /Authorization/);
});
