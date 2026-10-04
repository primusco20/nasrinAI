import { PLATFORM_TENANT_ID } from '../tenants.js';
import { mapKey, mapTenant } from './shape.js';

// The same interface as the Supabase store, kept in memory. Used by tests and
// local development only; the server refuses it in production.
export function createMemoryStore() {
  const tenants = new Map();
  const keys = new Map();

  tenants.set(PLATFORM_TENANT_ID, { id: PLATFORM_TENANT_ID, kind: 'platform', status: 'active', daily_token_limit: 2_000_000 });

  return {
    kind: 'memory',

    // test helpers
    addTenant(row) { tenants.set(row.id, { kind: 'business', status: 'active', daily_token_limit: 1_000_000, ...row }); },
    addApiKey(row) { keys.set(row.id, { scopes: ['chat'], allowed_origins: [], revoked_at: null, secret_hash: null, ...row }); },

    async getApiKey(id) {
      const r = keys.get(id);
      return r ? mapKey(r) : null;
    },

    async getTenant(id) {
      const r = tenants.get(id);
      return r ? mapTenant(r) : null;
    }
  };
}
