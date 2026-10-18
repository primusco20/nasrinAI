import { assertIntegrationConnectionOwner, publicIntegrationConnection, requireIntegrationUser } from './ownership.js';

const PROVIDERS = new Set(['vercel','render','supabase','cloudflare','github','google','facebook','slack','zoom','microsoft','other']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const enc = (value) => encodeURIComponent(String(value));
const safeProvider = (provider) => {
  if (!PROVIDERS.has(provider)) throw new TypeError('unsupported integration provider');
  return provider;
};
const mapRow = (r) => ({
  id: r.id, tenantId: r.tenant_id, userId: r.user_id, provider: r.provider,
  providerAccountId: r.provider_account_id, accountLabel: r.account_label,
  credentialEnc: r.credential_enc, refreshCredentialEnc: r.refresh_credential_enc,
  scopes: Array.isArray(r.scopes) ? r.scopes : [], status: r.status,
  metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : {},
  connectedAt: r.connected_at, updatedAt: r.updated_at
});

export function createIntegrationStore({ store, now = () => new Date().toISOString() }) {
  if (!store || typeof store.request !== 'function') throw new TypeError('server database store is required');

  async function getOwned(caller, id) {
    const owner = requireIntegrationUser(caller);
    if (!UUID.test(String(id))) return null;
    const rows = await store.request('GET', 'integration_connections?select=*&id=eq.' + enc(id) +
      '&tenant_id=eq.' + enc(owner.tenantId) + '&user_id=eq.' + enc(owner.userId) + '&limit=1');
    return Array.isArray(rows) && rows[0] ? mapRow(rows[0]) : null;
  }

  return {
    async list(caller, provider) {
      const owner = requireIntegrationUser(caller);
      const providerFilter = provider ? '&provider=eq.' + enc(safeProvider(provider)) : '';
      const rows = await store.request('GET', 'integration_connections?select=id,tenant_id,user_id,provider,provider_account_id,account_label,scopes,status,metadata,connected_at,updated_at' +
        '&tenant_id=eq.' + enc(owner.tenantId) + '&user_id=eq.' + enc(owner.userId) + providerFilter + '&order=connected_at.desc');
      return (Array.isArray(rows) ? rows : []).map((r) => publicIntegrationConnection({
        id: r.id, provider: r.provider, accountId: r.provider_account_id,
        accountLabel: r.account_label, scopes: r.scopes, status: r.status,
        connectedAt: r.connected_at, updatedAt: r.updated_at
      }));
    },

    async get(caller, id) {
      const row = await getOwned(caller, id);
      return row ? publicIntegrationConnection({
        id: row.id, provider: row.provider, accountId: row.providerAccountId,
        accountLabel: row.accountLabel, scopes: row.scopes, status: row.status,
        connectedAt: row.connectedAt, updatedAt: row.updatedAt
      }) : null;
    },

    // Only the server may call this after validating provider identity and
    // encrypting credentials. Never pass browser-provided identity as verified.
    async saveVerified(caller, { provider, providerAccountId, accountLabel = '', credentialEnc, refreshCredentialEnc = null, scopes = [], metadata = {} }) {
      const owner = requireIntegrationUser(caller);
      safeProvider(provider);
      if (typeof providerAccountId !== 'string' || !providerAccountId || providerAccountId.length > 300) throw new TypeError('invalid provider account ID');
      if (typeof credentialEnc !== 'string' || !credentialEnc.startsWith('v1.')) throw new TypeError('encrypted credentials are required');
      if (refreshCredentialEnc !== null && (typeof refreshCredentialEnc !== 'string' || !refreshCredentialEnc.startsWith('v1.'))) throw new TypeError('refresh credentials must be encrypted');
      const safeScopes = Array.isArray(scopes) ? scopes.filter((s) => typeof s === 'string' && s.length <= 200).slice(0, 100) : [];
      const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
      const rows = await store.request('POST', 'integration_connections?on_conflict=tenant_id,user_id,provider,provider_account_id', {
        body: {
          tenant_id: owner.tenantId, user_id: owner.userId, provider,
          provider_account_id: providerAccountId, account_label: String(accountLabel).slice(0, 200),
          credential_enc: credentialEnc, refresh_credential_enc: refreshCredentialEnc,
          scopes: safeScopes, status: 'connected', metadata: safeMetadata, updated_at: now()
        },
        prefer: 'resolution=merge-duplicates,return=representation'
      });
      if (!Array.isArray(rows) || !rows[0]) throw new Error('integration connection was not saved');
      return publicIntegrationConnection({
        id: rows[0].id, provider: rows[0].provider, accountId: rows[0].provider_account_id,
        accountLabel: rows[0].account_label, scopes: rows[0].scopes, status: rows[0].status,
        connectedAt: rows[0].connected_at, updatedAt: rows[0].updated_at
      });
    },

    async withOwnedCredential(caller, id, operation) {
      const row = await getOwned(caller, id);
      assertIntegrationConnectionOwner(caller, row);
      // Keep encrypted values server-side; callers must decrypt only for the
      // immediate provider request and must never serialize this object.
      return operation(Object.freeze({ ...row }));
    },

    async disconnect(caller, id) {
      const owner = requireIntegrationUser(caller);
      const row = await getOwned(caller, id);
      if (!row) return false;
      assertIntegrationConnectionOwner(caller, row);
      await store.request('DELETE', 'integration_connections?id=eq.' + enc(id) +
        '&tenant_id=eq.' + enc(owner.tenantId) + '&user_id=eq.' + enc(owner.userId));
      return true;
    }
  };
}
