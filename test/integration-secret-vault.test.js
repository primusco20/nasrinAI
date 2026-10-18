import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptIntegrationSecret, decryptIntegrationSecret } from '../src/integrations/secret-vault.js';

const key = Buffer.alloc(32, 7).toString('base64');
const env = { NASRINAI_INTEGRATION_ENCRYPTION_KEY: key };

test('integration secrets are encrypted and round-trip with authenticated context', () => {
  const envelope = encryptIntegrationSecret('provider-secret-token', { env, aad: 'user-a:render:account-a' });
  assert.equal(envelope.includes('provider-secret-token'), false);
  assert.equal(decryptIntegrationSecret(envelope, { env, aad: 'user-a:render:account-a' }), 'provider-secret-token');
  assert.throws(() => decryptIntegrationSecret(envelope, { env, aad: 'user-b:render:account-a' }));
});

test('integration secret vault fails closed for missing or invalid keys and tampering', () => {
  assert.throws(() => encryptIntegrationSecret('token', { env: {} }), /required/);
  assert.throws(() => encryptIntegrationSecret('token', { env: { NASRINAI_INTEGRATION_ENCRYPTION_KEY: 'bad' } }), /32-byte/);
  const envelope = encryptIntegrationSecret('token', { env });
  const pieces = envelope.split('.');
  pieces[3] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptIntegrationSecret(pieces.join('.'), { env }));
});
