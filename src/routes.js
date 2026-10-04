// The public API. Each route is either explicitly public or requires a caller.

export function buildRoutes() {
  return [
    {
      // Who am I? Useful for checking a credential; reveals nothing beyond
      // the caller's own type and business.
      method: 'GET',
      path: '/v1/whoami',
      handler: async ({ caller }) => ({
        body: { actor_type: caller.actor.type, tenant_id: caller.tenantId, scopes: caller.scopes }
      })
    }
  ];
}
