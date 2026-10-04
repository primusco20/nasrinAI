import { issueGuestToken, newGuestId } from './auth/guest.js';

// The public API. Each route is either explicitly public or requires a caller.
export function buildRoutes({ config, gateway, limiter }) {
  return [
    {
      // Starts a guest session. No key: a NasrinAI platform guest.
      // With a publishable key (X-NasrinAI-Key) from a listed website: a guest
      // of that business. The guest can chat, nothing more.
      method: 'POST',
      path: '/v1/guest/sessions',
      public: true,
      handler: async ({ req, ip }) => {
        await limiter.guestSession(ip);
        const tenantId = await gateway.guestTenantFor(req);
        const { token, expiresAt } = issueGuestToken({
          secret: config.guestSecret, tenantId, guestId: newGuestId(), ttlSeconds: config.guestTtlSeconds
        });
        return { status: 201, body: { token, expires_at: expiresAt, tenant_id: tenantId } };
      }
    },
    {
      // Who am I? Shows only the caller's own type, business and scopes.
      method: 'GET',
      path: '/v1/whoami',
      handler: async ({ caller }) => ({
        body: { actor_type: caller.actor.type, tenant_id: caller.tenantId, scopes: caller.scopes }
      })
    }
  ];
}
