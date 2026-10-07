import { HttpError, unauthenticated, forbidden } from '../http/errors.js';
import { verifyGuestToken, isGuestToken } from '../auth/guest.js';
import { parseKey, secretMatches } from '../auth/keys.js';
import { PLATFORM_TENANT_ID } from '../tenants.js';

// The gateway turns a request into a caller:
//   { tenantId, tenant, actor: { type: 'user' | 'guest' | 'service', id }, scopes }
// The tenant and actor come only from the credential, never from the body.
// Anything it cannot identify is refused (fail closed).
//
// Accepted credentials, all in "Authorization: Bearer ...":
//   nsg_...  guest session issued by POST /v1/guest/sessions
//   nss_...  secret business key (server to server)
//   <JWT>    Supabase Auth session of a signed-in NasrinAI user
// Publishable keys (nsp_...) are never accepted here: they can only start
// guest sessions for their business, from their listed websites.

export function createGateway({ store, guestSecret, verifyUser = null, tenantCacheMs = 60_000 }) {
  const tenantCache = new Map();

  async function activeTenant(id) {
    const hit = tenantCache.get(id);
    let tenant = hit && hit.until > Date.now() ? hit.tenant : null;
    if (!tenant) {
      tenant = await store.getTenant(id);
      if (tenant) tenantCache.set(id, { tenant, until: Date.now() + tenantCacheMs });
    }
    if (!tenant) throw unauthenticated();
    if (tenant.status !== 'active') throw forbidden('This business account is not active.');
    return tenant;
  }

  async function identify(req) {
    const header = String(req.headers.authorization || '');
    if (!header.startsWith('Bearer ')) throw unauthenticated();
    const token = header.slice(7).trim();

    if (isGuestToken(token)) {
      const guest = verifyGuestToken(token, guestSecret);
      if (!guest) throw unauthenticated();
      const tenant = await activeTenant(guest.tenantId);
      const requestOrigin = String(req.headers.origin || '').toLowerCase().replace(/\/+$/, '');
      if (guest.origin && requestOrigin && requestOrigin !== guest.origin) throw forbidden('This guest session is bound to a different website.');
      return { tenantId: guest.tenantId, tenant, actor: { type: 'guest', id: guest.guestId }, scopes: ['chat'], origin: guest.origin };
    }

    const key = parseKey(token);
    if (key) {
      if (key.kind !== 'secret') throw unauthenticated();
      const row = await store.getApiKey(key.id);
      if (!row || row.kind !== 'secret' || row.revoked || !secretMatches(key.secret, row.secretHash)) throw unauthenticated();
      const tenant = await activeTenant(row.tenantId);
      return { tenantId: row.tenantId, tenant, actor: { type: 'service', id: row.id }, scopes: row.scopes };
    }

    if (!verifyUser) throw unauthenticated();
    const user = await verifyUser(token);
    if (!user) throw unauthenticated();
    const tenant = await activeTenant(PLATFORM_TENANT_ID);
    return { tenantId: PLATFORM_TENANT_ID, tenant, actor: { type: 'user', id: user.id }, prefs: { ...(user.prefs || {}) }, scopes: ['chat'] };
  }

  return {
    async resolve(req, { scope } = {}) {
      const caller = await identify(req);
      if (scope && !caller.scopes.includes(scope)) throw forbidden('This key is not allowed to do that.');
      return caller;
    },

    // Which tenant a new guest session belongs to. With no key: the platform.
    // With a publishable key: its business, but only from a website the key lists.
    async guestTenantFor(req) {
      const raw = req.headers['x-nasrinai-key'];
      if (raw === undefined) {
        await activeTenant(PLATFORM_TENANT_ID);
        return PLATFORM_TENANT_ID;
      }
      const key = parseKey(raw);
      if (!key || key.kind !== 'publishable') throw unauthenticated();
      const row = await store.getApiKey(key.id);
      if (!row || row.kind !== 'publishable' || row.revoked || !row.scopes.includes('chat')) throw unauthenticated();
      const origin = String(req.headers.origin || '').toLowerCase().replace(/\/+$/, '');
      if (!origin || !row.allowedOrigins.includes(origin)) {
        throw new HttpError(403, 'origin_not_allowed', 'This key cannot be used from this website.');
      }
      await activeTenant(row.tenantId);
      return row.tenantId;
    }
  };
}

// Used until the database is configured: recognises nobody.
export function createClosedGateway() {
  return {
    async resolve() { throw unauthenticated(); },
    async guestTenantFor() { throw unauthenticated(); }
  };
}
