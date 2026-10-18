import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireIntegrationUser, assertIntegrationConnectionOwner, publicIntegrationConnection } from '../src/integrations/ownership.js';

const userA = { actor: { type: 'user', id: 'user-a' }, tenantId: 'tenant-a' };
const userB = { actor: { type: 'user', id: 'user-b' }, tenantId: 'tenant-a' };
const connectionA = { id: 'conn-a', userId: 'user-a', tenantId: 'tenant-a', provider: 'render', accountId: 'acct-a', status: 'connected' };

test('integration ownership: only a signed-in user with a tenant can manage connections', () => {
  assert.deepEqual(requireIntegrationUser(userA), { userId: 'user-a', tenantId: 'tenant-a' });
  assert.throws(() => requireIntegrationUser({ actor: { type: 'guest', id: 'guest-a' }, tenantId: 'tenant-a' }), (err) => err.status === 401);
  assert.throws(() => requireIntegrationUser({ actor: { type: 'service', id: 'service-a' }, tenantId: 'tenant-a' }), (err) => err.status === 401);
  assert.throws(() => requireIntegrationUser({ actor: { type: 'user', id: 'user-a' } }), (err) => err.status === 403);
});

test('integration ownership: copied connection IDs cannot cross user or tenant boundaries', () => {
  assert.equal(assertIntegrationConnectionOwner(userA, connectionA), connectionA);
  assert.throws(() => assertIntegrationConnectionOwner(userB, connectionA), (err) => err.status === 404 && err.code === 'integration_not_found');
  assert.throws(() => assertIntegrationConnectionOwner({ ...userA, tenantId: 'tenant-b' }, connectionA), (err) => err.status === 404);
  assert.throws(() => assertIntegrationConnectionOwner(userA, null), (err) => err.status === 404);
});

test('integration connection public projection never returns credential fields', () => {
  const safe = publicIntegrationConnection({
    ...connectionA,
    accountLabel: 'Production',
    scopes: ['read'],
    accessToken: 'never-return-this',
    refreshToken: 'never-return-this-either',
    accessTokenEnc: 'ciphertext',
    secretKey: 'secret'
  });
  assert.deepEqual(safe, {
    id: 'conn-a',
    provider: 'render',
    accountId: 'acct-a',
    accountLabel: 'Production',
    status: 'connected',
    scopes: ['read']
  });
  assert.equal(JSON.stringify(safe).includes('never-return-this'), false);
  assert.equal(JSON.stringify(safe).includes('ciphertext'), false);
});
