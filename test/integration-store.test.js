import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntegrationStore } from '../src/integrations/store.js';

const callerA = { tenantId: '00000000-0000-0000-0000-000000000001', actor: { type: 'user', id: 'user-a' } };

test('integration store scopes list queries to the verified tenant and user and returns no credentials', async () => {
  let requested = '';
  const integrationStore = createIntegrationStore({ store: { async request(method, path) {
    requested = method + ' ' + path;
    return [{
      id: 'conn-a', tenant_id: callerA.tenantId, user_id: 'user-a', provider: 'render',
      provider_account_id: 'acct-a', account_label: 'Production', credential_enc: 'v1.secret',
      refresh_credential_enc: 'v1.refresh', scopes: ['services:read'], status: 'connected',
      metadata: {}, connected_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'
    }];
  } } });
  const rows = await integrationStore.list(callerA, 'render');
  assert.match(requested, /tenant_id=eq\.00000000-0000-0000-0000-000000000001/);
  assert.match(requested, /user_id=eq\.user-a/);
  assert.match(requested, /provider=eq\.render/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accountId, 'acct-a');
  assert.equal(JSON.stringify(rows).includes('v1.secret'), false);
  assert.equal(JSON.stringify(rows).includes('v1.refresh'), false);
});

test('integration store rejects guests and unsupported provider filters', async () => {
  const integrationStore = createIntegrationStore({ store: { async request() { throw new Error('must not query'); } } });
  await assert.rejects(() => integrationStore.list({ ...callerA, actor: { type: 'guest', id: 'guest-a' } }), (err) => err.status === 401);
  await assert.rejects(() => integrationStore.list(callerA, 'unknown-provider'), /unsupported integration provider/);
});

test('integration store returns not-found rather than exposing another account', async () => {
  const integrationStore = createIntegrationStore({ store: { async request(method, path) {
    assert.match(path, /user_id=eq\.user-a/);
    return [];
  } } });
  assert.equal(await integrationStore.get(callerA, '00000000-0000-4000-8000-000000000099'), null);
});
