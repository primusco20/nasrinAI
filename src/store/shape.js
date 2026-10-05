// Database rows -> the shapes the rest of the server uses.

export const mapKey = (r) => ({
  id: r.id,
  tenantId: r.tenant_id,
  kind: r.kind,
  secretHash: r.secret_hash || null,
  scopes: Array.isArray(r.scopes) ? r.scopes : [],
  allowedOrigins: Array.isArray(r.allowed_origins) ? r.allowed_origins : [],
  revoked: Boolean(r.revoked_at)
});

export const mapConversation = (r) => ({
  id: r.id,
  tenantId: r.tenant_id,
  ownerType: r.owner_type,
  ownerId: r.owner_id,
  title: r.title || '',
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  expiresAt: r.expires_at || null
});

export const mapMessage = (r) => ({
  id: r.id,
  role: r.role,
  content: r.content,
  createdAt: r.created_at
});

export const mapTenant = (r) => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  dailyTokenLimit: Number(r.daily_token_limit)
});

export const mapConnector = (r) => ({
  tenantId: r.tenant_id, name: r.name, baseUrl: r.base_url, authType: r.auth_type, authHeader: r.auth_header ?? null,
  secretEnc: r.secret_enc ?? null, actions: Array.isArray(r.actions) ? r.actions : [], enabled: r.enabled !== false, updatedAt: r.updated_at,
  webhookSecretEnc: r.webhook_secret_enc ?? null, eventsWho: Array.isArray(r.events_who) && r.events_who.length ? r.events_who : ['service']
});

export const mapChannel = (r) => ({
  tenantId: r.tenant_id, kind: r.kind, externalId: r.external_id, secretEnc: r.secret_enc, enabled: r.enabled !== false, updatedAt: r.updated_at
});
