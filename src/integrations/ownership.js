import { HttpError } from '../http/errors.js';

// Gateway identity is verified server-side. Never accept identity from request
// bodies, query parameters, or provider resource IDs.
export function requireIntegrationUser(caller) {
  if (caller?.actor?.type !== 'user' || typeof caller.actor.id !== 'string' || !caller.actor.id) {
    throw new HttpError(401, 'integration_sign_in_required', 'Sign in to connect and manage your accounts.');
  }
  if (typeof caller.tenantId !== 'string' || !caller.tenantId) {
    throw new HttpError(403, 'integration_access_denied', 'This account cannot manage integrations.');
  }
  return Object.freeze({ userId: caller.actor.id, tenantId: caller.tenantId });
}

export function assertIntegrationConnectionOwner(caller, connection) {
  const identity = requireIntegrationUser(caller);
  if (!connection || connection.userId !== identity.userId || connection.tenantId !== identity.tenantId) {
    throw new HttpError(404, 'integration_not_found', 'Connected account not found.');
  }
  return connection;
}

// Explicit allow-list: never serialize database rows or provider credentials.
export function publicIntegrationConnection(connection) {
  if (!connection || typeof connection !== 'object') throw new TypeError('connection is required');
  const allowed = ['id', 'provider', 'accountId', 'accountLabel', 'status', 'scopes', 'connectedAt', 'updatedAt'];
  const result = {};
  for (const key of allowed) if (connection[key] !== undefined) result[key] = connection[key];
  return result;
}
