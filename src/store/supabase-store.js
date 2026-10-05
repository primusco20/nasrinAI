import { UpstreamError } from '../http/errors.js';
import { UUID } from '../tenants.js';
import { mapKey, mapTenant, mapConversation, mapMessage } from './shape.js';

const KEY_ID = /^[0-9a-f]{12}$/;
const OWNER_ID = /^[A-Za-z0-9_-]{1,80}$/;
const OWNER_TYPES = new Set(['user', 'guest', 'service']);
const CONVERSATION_COLUMNS = 'id,tenant_id,owner_type,owner_id,title,created_at,updated_at,expires_at';
const MESSAGE_COLUMNS = 'id,role,content,created_at';

function assertOwner(ownerType, ownerId) {
  if (!OWNER_TYPES.has(ownerType) || !OWNER_ID.test(String(ownerId))) throw new Error('invalid conversation owner');
}

// Talks to the NasrinAI Supabase project through its REST API with the
// service-role key, the same headers supabase-js sends. Every value placed in a
// URL is validated first, so nothing a caller sends can change the query.
export function createSupabaseStore({ url, serviceKey, fetchImpl = fetch, timeoutMs = 8000 }) {
  async function request(method, path, { body, prefer } = {}) {
    const headers = {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      Accept: 'application/json'
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;

    let resp;
    try {
      resp = await fetchImpl(url + '/rest/v1/' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      throw new UpstreamError('database request failed: ' + (err?.name || 'error'));
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new UpstreamError(`database answered ${resp.status} for ${method} ${path.split('?')[0]}: ${text.slice(0, 200)}`);
    }
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    kind: 'supabase',
    request,

    async getApiKey(id) {
      if (!KEY_ID.test(String(id))) return null;
      const rows = await request('GET', `api_keys?id=eq.${id}&select=id,tenant_id,kind,secret_hash,scopes,allowed_origins,revoked_at&limit=1`);
      return rows && rows[0] ? mapKey(rows[0]) : null;
    },

    async getTenant(id) {
      if (!UUID.test(String(id))) return null;
      const rows = await request('GET', `tenants?id=eq.${id}&select=id,kind,status,daily_token_limit&limit=1`);
      return rows && rows[0] ? mapTenant(rows[0]) : null;
    },

    // Counts one hit in a shared fixed window (database function rate_hit).
    async rateHit(bucket, windowSeconds, limit) {
      const rows = await request('POST', 'rpc/rate_hit', {
        body: { p_bucket: bucket, p_window_seconds: windowSeconds, p_limit: limit }
      });
      const r = Array.isArray(rows) ? rows[0] : rows;
      if (!r || typeof r.allowed !== 'boolean') throw new UpstreamError('rate_hit returned an unexpected shape');
      return { allowed: r.allowed, used: Number(r.used), retryAfter: Number(r.retry_after) };
    },

    async tokensSince({ since, tenantId = null, actorType = null, actorId = null }) {
      const n = await request('POST', 'rpc/usage_tokens_since', {
        body: { p_since: since.toISOString(), p_tenant: tenantId, p_actor_type: actorType, p_actor_id: actorId }
      });
      const value = Number(n);
      if (!Number.isFinite(value)) throw new UpstreamError('usage_tokens_since returned an unexpected shape');
      return value;
    },

    async createConversation({ tenantId, ownerType, ownerId, title = '', expiresAt = null }) {
      assertOwner(ownerType, ownerId);
      const rows = await request('POST', `conversations?select=${CONVERSATION_COLUMNS}`, {
        prefer: 'return=representation',
        body: { tenant_id: tenantId, owner_type: ownerType, owner_id: ownerId, title, expires_at: expiresAt }
      });
      return mapConversation(rows[0]);
    },

    async getConversation(id) {
      if (!UUID.test(String(id))) return null;
      const rows = await request('GET', `conversations?id=eq.${id}&select=${CONVERSATION_COLUMNS}&limit=1`);
      return rows && rows[0] ? mapConversation(rows[0]) : null;
    },

    async listConversations({ tenantId, ownerType, ownerId, limit = 20 }) {
      if (!UUID.test(String(tenantId))) return [];
      assertOwner(ownerType, ownerId);
      const rows = await request('GET', `conversations?tenant_id=eq.${tenantId}&owner_type=eq.${ownerType}`
        + `&owner_id=eq.${encodeURIComponent(ownerId)}&order=updated_at.desc&limit=${Math.min(100, limit)}&select=${CONVERSATION_COLUMNS}`);
      return (rows || []).map(mapConversation);
    },

    async setConversationTitle(id, title) {
      if (!UUID.test(String(id))) return;
      await request('PATCH', `conversations?id=eq.${id}`, { prefer: 'return=minimal', body: { title } });
    },

    async deleteConversation(id) {
      if (!UUID.test(String(id))) return;
      await request('DELETE', `conversations?id=eq.${id}`, { prefer: 'return=minimal' });
    },

    async addMessage({ conversationId, tenantId, role, content }) {
      const rows = await request('POST', `messages?select=${MESSAGE_COLUMNS}`, {
        prefer: 'return=representation',
        body: { conversation_id: conversationId, tenant_id: tenantId, role, content }
      });
      return mapMessage(rows[0]);
    },

    // The latest `limit` messages, oldest first.
    async listMessages(conversationId, limit = 50) {
      if (!UUID.test(String(conversationId))) return [];
      const rows = await request('GET', `messages?conversation_id=eq.${conversationId}`
        + `&order=created_at.desc&limit=${Math.min(200, limit)}&select=${MESSAGE_COLUMNS}`);
      return (rows || []).map(mapMessage).reverse();
    },

    async getMessage(id) {
      if (!UUID.test(String(id))) return null;
      const rows = await request('GET', `messages?id=eq.${id}&select=id,conversation_id,role,content,created_at&limit=1`);
      const r = rows && rows[0];
      return r ? { ...mapMessage(r), conversationId: r.conversation_id } : null;
    },

    // The user's plan periods that are running now.
    async activePlans({ tenantId, userId }) {
      if (!UUID.test(String(tenantId)) || !OWNER_ID.test(String(userId))) return [];
      const at = new Date().toISOString();
      const rows = await request('GET', `plan_periods?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}`
        + `&status=eq.active&starts_at=lte.${encodeURIComponent(at)}&ends_at=gt.${encodeURIComponent(at)}&select=plan,ends_at&limit=20`);
      return (rows || []).map((r) => ({ plan: r.plan, endsAt: r.ends_at }));
    },

    // Records one paid period (database function add_plan_period). Null when
    // this payment was already recorded.
    async addPlanPeriod({ tenantId, userId, plan, days, provider, ref = null, amount = null, currency = null }) {
      const id = await request('POST', 'rpc/add_plan_period', {
        body: { p_tenant: tenantId, p_user: userId, p_plan: plan, p_days: days, p_provider: provider, p_ref: ref, p_amount: amount, p_currency: currency }
      });
      return typeof id === 'string' ? id : null;
    },

    async purgeExpired() {
      await request('POST', 'rpc/purge_expired', { body: {} });
    },

    async recordUsage(e) {
      const body = {
        tenant_id: e.tenantId, actor_type: e.actorType, actor_id: e.actorId,
        provider: e.provider, model: e.model,
        input_tokens: e.inputTokens, output_tokens: e.outputTokens,
        latency_ms: e.latencyMs, outcome: e.outcome
      };
      const routing = {
        task: e.task ?? null, level: e.level ?? null, cost_usd: e.costUsd ?? null,
        cached_tokens: e.cachedTokens ?? null, escalated: e.escalated === true, cache_hit: e.cacheHit === true
      };
      try {
        await request('POST', 'usage_events', { prefer: 'return=minimal', body: { ...body, ...routing } });
      } catch (err) {
        // Before migration 003 the routing columns do not exist: keep the basic record.
        if (!/PGRST204|column|budget_blocked|23514/.test(err.message)) throw err;
        if (body.outcome === 'budget_blocked') return;
        await request('POST', 'usage_events', { prefer: 'return=minimal', body });
      }
    },

    // Pictures actually made (usage records, migration 003), for allowances.
    // Counts up to `limit` rows (allowances are small).
    async imagesMadeSince({ since, tenantId, actorType, actorId = null, limit = 1000 }) {
      const q = [
        'select=id', 'task=eq.image', 'outcome=eq.ok',
        'tenant_id=eq.' + encodeURIComponent(tenantId), 'actor_type=eq.' + encodeURIComponent(actorType),
        ...(actorId === null ? [] : ['actor_id=eq.' + encodeURIComponent(actorId)]),
        'created_at=gte.' + encodeURIComponent(since.toISOString()), 'limit=' + Math.max(1, Math.floor(limit))
      ].join('&');
      const rows = await request('GET', 'usage_events?' + q);
      if (!Array.isArray(rows)) throw new UpstreamError('usage_events returned an unexpected shape');
      return rows.length;
    },

    // Legal acceptance records (migration 005): insert-only.
    async recordAcceptance({ tenantId, userId, document, version, action, method }) {
      await request('POST', 'legal_acceptances', { prefer: 'return=minimal', body: { tenant_id: tenantId, user_id: userId, document, version, action, method } });
    },
    async hasAccepted({ tenantId, userId, document, version }) {
      if (!UUID.test(String(tenantId)) || !OWNER_ID.test(String(userId))) return false;
      const rows = await request('GET', `legal_acceptances?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}`
        + `&document=eq.${encodeURIComponent(document)}&version=eq.${encodeURIComponent(version)}&select=id&limit=1`);
      return Boolean(rows && rows.length);
    },
    async listAcceptances({ tenantId, userId }) {
      if (!UUID.test(String(tenantId)) || !OWNER_ID.test(String(userId))) return [];
      return (await request('GET', `legal_acceptances?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&select=document,version,action,method,created_at&order=created_at.asc&limit=200`)) || [];
    },
    async listPlanPeriods({ tenantId, userId }) {
      if (!UUID.test(String(tenantId)) || !OWNER_ID.test(String(userId))) return [];
      return (await request('GET', `plan_periods?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&select=plan,starts_at,ends_at,provider,amount,currency,created_at&order=created_at.asc&limit=500`)) || [];
    },
    // Every conversation of one owner (their messages and pictures go with them).
    async deleteConversationsOf({ tenantId, ownerType, ownerId }) {
      if (!UUID.test(String(tenantId))) return;
      assertOwner(ownerType, ownerId);
      await request('DELETE', `conversations?tenant_id=eq.${tenantId}&owner_type=eq.${ownerType}&owner_id=eq.${encodeURIComponent(ownerId)}`, { prefer: 'return=minimal' });
    },
    async deleteUserData({ tenantId, userId }) {
      await request('POST', 'rpc/delete_user_data', { body: { p_tenant: tenantId, p_user: userId } });
    },

    // Generated images (migration 004). Bytes travel as Postgres hex (bytea).
    async addImage({ tenantId, conversationId, ownerType, ownerId, mime, bytes, provider, model }) {
      assertOwner(ownerType, ownerId);
      const rows = await request('POST', 'generated_images?select=id', {
        prefer: 'return=representation',
        body: { tenant_id: tenantId, conversation_id: conversationId, owner_type: ownerType, owner_id: ownerId, mime, bytes: '\\x' + bytes.toString('hex'), provider, model }
      });
      return rows[0].id;
    },

    async getImage(id) {
      if (!UUID.test(String(id))) return null;
      const rows = await request('GET', `generated_images?id=eq.${id}&select=id,tenant_id,owner_type,owner_id,mime,bytes&limit=1`);
      const r = rows && rows[0];
      if (!r) return null;
      return { id: r.id, tenantId: r.tenant_id, ownerType: r.owner_type, ownerId: r.owner_id, mime: r.mime,
        bytes: Buffer.from(String(r.bytes).replace(/^\\x/, ''), 'hex') };
    },

    // Estimated spend (USD) since a moment, across everything (migration 003).
    async costSince(since) {
      const n = Number(await request('POST', 'rpc/usage_cost_since', { body: { p_since: since.toISOString() } }));
      if (!Number.isFinite(n)) throw new UpstreamError('usage_cost_since returned an unexpected shape');
      return n;
    }
  };
}
