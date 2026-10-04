import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { issueGuestToken, verifyGuestToken, newGuestId } from '../src/auth/guest.js';
import { parseKey, hashSecret, secretMatches } from '../src/auth/keys.js';
import { clientIpFrom } from '../src/net.js';
import { loadConfig, ConfigError, supabaseKeyKind } from '../src/config.js';

const SECRET = 'x'.repeat(40);
const TENANT = '00000000-0000-0000-0000-000000000001';

test('guest tokens verify, and expire', () => {
  const guestId = newGuestId();
  const { token } = issueGuestToken({ secret: SECRET, tenantId: TENANT, guestId, ttlSeconds: 60, now: 1_000_000 });
  assert.deepEqual(verifyGuestToken(token, SECRET, 1_000_000), { tenantId: TENANT, guestId });
  assert.equal(verifyGuestToken(token, SECRET, 1_000_000 + 61_000), null);
});

test('guest tokens cannot be forged or altered', () => {
  const { token } = issueGuestToken({ secret: SECRET, tenantId: TENANT, guestId: newGuestId(), ttlSeconds: 60 });
  assert.equal(verifyGuestToken(token, 'y'.repeat(40)), null, 'other secret');

  const [payload, sig] = token.slice(4).split('.');
  const data = JSON.parse(Buffer.from(payload, 'base64url'));
  data.t = '11111111-1111-4111-8111-111111111111';            // try to move to another business
  const forged = 'nsg_' + Buffer.from(JSON.stringify(data)).toString('base64url') + '.' + sig;
  assert.equal(verifyGuestToken(forged, SECRET), null, 'altered payload');

  for (const bad of ['', 'nsg_', 'nsg_a.b', token + '.x', token.slice(0, -2), 'Bearer ' + token, null, 42]) {
    assert.equal(verifyGuestToken(bad, SECRET), null, String(bad));
  }
});

test('business keys parse only in their exact formats', () => {
  assert.deepEqual(parseKey('nsp_0123456789ab'), { kind: 'publishable', id: '0123456789ab' });
  const s = 'f'.repeat(48);
  assert.deepEqual(parseKey(`nss_0123456789ab_${s}`), { kind: 'secret', id: '0123456789ab', secret: s });
  for (const bad of ['nsp_0123', 'nss_0123456789ab', 'nsp_0123456789AB', `nss_0123456789ab_${s}x`, 'eyJ.a.b', '']) {
    assert.equal(parseKey(bad), null, bad);
  }
});

test('secret hashing matches the database (sha256 hex) and compares safely', () => {
  const s = 'a1'.repeat(24);
  assert.equal(hashSecret(s), createHash('sha256').update(s).digest('hex'));
  assert.equal(secretMatches(s, hashSecret(s)), true);
  assert.equal(secretMatches(s, hashSecret('other')), false);
  assert.equal(secretMatches(s, 'not-a-hash'), false);
  assert.equal(secretMatches(s, null), false);
});

test('client IP: the proxy-added entry is used, client-written entries are ignored', () => {
  const req = (xff, remote = '10.0.0.5') => ({ headers: xff ? { 'x-forwarded-for': xff } : {}, socket: { remoteAddress: remote } });
  assert.equal(clientIpFrom(req('203.0.113.9'), 1), '203.0.113.9');
  assert.equal(clientIpFrom(req('1.1.1.1, 203.0.113.9'), 1), '203.0.113.9', 'spoofed left entry ignored');
  assert.equal(clientIpFrom(req(undefined), 1), '10.0.0.5');
  assert.equal(clientIpFrom(req('not-an-ip'), 1), '10.0.0.5');
  assert.equal(clientIpFrom(req('203.0.113.9'), 0), '10.0.0.5', 'no trusted proxy');
  assert.equal(clientIpFrom(req(undefined, '::ffff:192.0.2.1'), 1), '192.0.2.1');
});

const jwt = (role) => 'h.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.s';

test('config: production needs every secret, and keys cannot be swapped', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), ConfigError);
  const good = {
    NODE_ENV: 'production', SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_ANON_KEY: jwt('anon'), SUPABASE_SERVICE_ROLE_KEY: jwt('service_role'), GUEST_SESSION_SECRET: 'z'.repeat(32)
  };
  assert.equal(loadConfig(good).supabaseUrl, 'https://abc.supabase.co');
  assert.equal(loadConfig({ ...good, SUPABASE_URL: 'https://abc.supabase.co/rest/v1/' }).supabaseUrl, 'https://abc.supabase.co');
  assert.throws(() => loadConfig({ ...good, SUPABASE_ANON_KEY: jwt('service_role') }), /secret key/);
  assert.throws(() => loadConfig({ ...good, SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_x' }), /public key/);
  assert.throws(() => loadConfig({ ...good, GUEST_SESSION_SECRET: 'short' }), /32/);
  assert.throws(() => loadConfig({ ...good, SUPABASE_URL: 'not a url' }), /SUPABASE_URL/);
  assert.equal(supabaseKeyKind('sb_secret_abc'), 'secret');
  assert.equal(supabaseKeyKind('whatever'), 'unknown');
});
