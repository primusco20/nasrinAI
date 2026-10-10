import { UpstreamError } from '../http/errors.js';
import { UUID } from '../tenants.js';
import { mapKey, mapTenant, mapConversation, mapMessage, mapConnector, mapChannel } from './shape.js';

const KEY_ID = /^[0-9a-f]{12}$/;
const OWNER_ID = /^[A-Za-z0-9_-]{1,80}$/;
const OWNER_TYPES = new Set(['user', 'guest', 'service']);
const CONVERSATION_COLUMNS = 'id,tenant_id,owner_type,owner_id,title,created_at,updated_at,expires_at';
const MESSAGE_COLUMNS = 'id,role,content,created_at';

const PROJECT_COLUMNS = 'id,name,description,instructions,status,created_at,updated_at';
const mapProject = (r) => ({ id: r.id, name: r.name, description: r.description, instructions: r.instructions, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });
const mapLibraryFile = (r) => ({ id: r.id, title: r.title, kind: r.kind, format: r.format, chars: r.chars, createdAt: r.created_at });

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

    async createPublishableKey({ tenantId, origin, label = 'NasrinAI Connect' }) {
      if (!UUID.test(String(tenantId)) || typeof origin !== 'string' || !/^https:\/\/[^/]+$/.test(origin)) {
        throw new Error('invalid Connect key request');
      }
      const rows = await request('POST', 'rpc/create_connect_publishable_key', {
        body: {
          p_tenant: tenantId,
          p_origin: origin.toLowerCase().replace(/\/+$/, ''),
          p_label: String(label).slice(0, 80)
        }
      });
      if (typeof rows !== 'string' || !/^nsp_[0-9a-f]{12}$/.test(rows)) throw new UpstreamError('create_api_key returned an unexpected shape');
      return rows;
    },

    async revokePublishableKey({ tenantId, key }) {
      const m = /^nsp_([0-9a-f]{12})$/.exec(String(key));
      if (!UUID.test(String(tenantId)) || !m) throw new Error('invalid Connect key revoke request');
      await request('PATCH', `api_keys?id=eq.${m[1]}&tenant_id=eq.${tenantId}&kind=eq.publishable`, {
        body: { revoked_at: new Date().toISOString() }
      });
    },

    async getApiKey(id) {
      if (!KEY_ID.test(String(id))) return null;
      const rows = await request('GET', `api_keys?id=eq.${id}&select=id,tenant_id,kind,secret_hash,scopes,allowed_origins,revoked_at&limit=1`);
      return rows && rows[0] ? mapKey(rows[0]) : null;
    },

    async getTenant(id) {
      if (!UUID.test(String(id))) return null;
      let rows;
      try {
        rows = await request('GET', `tenants?id=eq.${id}&select=id,kind,status,daily_token_limit,knowledge_only,off_topic_reply&limit=1`);
      } catch (err) {
        // Before migration 011 those columns do not exist: read without them
        // (every business answers as before) instead of failing every request.
        if (!/knowledge_only|off_topic_reply|42703/.test(String(err?.message))) throw err;
        rows = await request('GET', `tenants?id=eq.${id}&select=id,kind,status,daily_token_limit&limit=1`);
      }
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

    // Atomically reserve daily token capacity in PostgreSQL. The DB derives the
    // Manila day and serializes quota checks across all server instances.
    async reserveDailyTokens({ reservationId, tenantId, actorType, actorId, reservedTokens, actorLimit, guestLimit, tenantLimit }) {
      const rows = await request('POST', 'rpc/reserve_daily_tokens', {
        body: {
          p_reservation_id: reservationId,
          p_tenant: tenantId,
          p_actor_type: actorType,
          p_actor_id: actorId,
          p_reserved_tokens: reservedTokens,
          p_actor_limit: actorLimit,
          p_guest_limit: guestLimit,
          p_tenant_limit: tenantLimit
        }
      });
      const r = Array.isArray(rows) ? rows[0] : rows;
      if (!r || typeof r.allowed !== 'boolean' || typeof r.reason !== 'string' && r.reason !== null) {
        throw new UpstreamError('reserve_daily_tokens returned an unexpected shape');
      }
      return { allowed: r.allowed, reason: r.reason, reservationId: r.reservation_id || null,
        actorUsed: Number(r.actor_used || 0), tenantUsed: Number(r.tenant_used || 0) };
    },

    async settleDailyTokenReservation({ reservationId, actualTokens }) {
      const value = await request('POST', 'rpc/settle_daily_token_reservation', {
        body: { p_reservation_id: reservationId, p_actual_tokens: actualTokens }
      });
      if (typeof value !== 'boolean') throw new UpstreamError('settle_daily_token_reservation returned an unexpected shape');
      return value;
    },

    async releaseDailyTokenReservation({ reservationId }) {
      const value = await request('POST', 'rpc/release_daily_token_reservation', {
        body: { p_reservation_id: reservationId }
      });
      if (typeof value !== 'boolean') throw new UpstreamError('release_daily_token_reservation returned an unexpected shape');
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

    // One message of one conversation (both ids must match).
    async deleteMessage(conversationId, id) {
      if (!UUID.test(String(conversationId)) || !UUID.test(String(id))) return;
      await request('DELETE', `messages?id=eq.${id}&conversation_id=eq.${conversationId}`, { prefer: 'return=minimal' });
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
      const reservation = e.reservationId ? { reservation_id: e.reservationId } : {};
      const routing = {
        task: e.task ?? null, level: e.level ?? null, cost_usd: e.costUsd ?? null,
        cached_tokens: e.cachedTokens ?? null, escalated: e.escalated === true, cache_hit: e.cacheHit === true
      };
      try {
        await request('POST', 'usage_events', { prefer: 'return=minimal', body: { ...body, ...reservation, ...routing } });
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

    // Improvement consent (migration 018): append-only choice events; no content is stored here.
    async getImprovementConsent({ tenantId, subjectType, subjectId }) {
      if (!UUID.test(String(tenantId)) || !['user', 'guest'].includes(subjectType) || !OWNER_ID.test(String(subjectId))) return null;
      const rows = await request('GET', `improvement_consent_events?tenant_id=eq.${tenantId}&subject_type=eq.${subjectType}&subject_id=eq.${encodeURIComponent(subjectId)}&select=version,decision,created_at&order=created_at.desc,id.desc&limit=1`);
      const row = rows && rows[0];
      return row ? { version: row.version, decision: row.decision, createdAt: row.created_at } : null;
    },
    async recordImprovementConsent({ tenantId, subjectType, subjectId, version, decision }) {
      if (!UUID.test(String(tenantId)) || !['user', 'guest'].includes(subjectType) || !OWNER_ID.test(String(subjectId)) ||
          !/^[A-Za-z0-9._-]{1,40}$/.test(String(version)) || !['granted', 'declined', 'withdrawn'].includes(decision)) {
        throw new Error('invalid improvement consent event');
      }
      await request('POST', 'improvement_consent_events', { prefer: 'return=minimal', body: { tenant_id: tenantId, subject_type: subjectType, subject_id: subjectId, version, decision } });
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
      return (await request('GET', `plan_periods?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&select=id,plan,starts_at,ends_at,provider,provider_ref,amount,currency,created_at&order=created_at.asc&limit=500`)) || [];
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

    // Retention: pictures of businesses older than `before`. Signed-in people's
    // pictures follow their own keep-time (purgeUserBefore).
    async purgeImagesBefore(before) {
      await request('DELETE', 'generated_images?owner_type=eq.service&created_at=lt.' + encodeURIComponent(before.toISOString()), { prefer: 'return=minimal' });
    },

    async purgeRetention(imageRetentionDays = 30) {
      if (!Number.isInteger(imageRetentionDays) || imageRetentionDays < 0 || imageRetentionDays > 3650) {
        throw new Error('invalid image retention days');
      }
      await request('POST', 'rpc/purge_retention', { body: { p_image_retention_days: imageRetentionDays } });
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

    async addVideo(row) {
      assertOwner(row.ownerType, row.ownerId);
      const rows = await request('POST', 'generated_videos?select=id', {
        prefer: 'return=representation',
        body: {
          tenant_id: row.tenantId, conversation_id: row.conversationId || null,
          owner_type: row.ownerType, owner_id: row.ownerId, prompt: row.prompt,
          target_seconds: row.targetSeconds, produced_seconds: row.producedSeconds || 0,
          status: row.status, provider: row.provider, provider_operation: row.providerOperation || null,
          provider_video_uri: row.providerVideoUri || null, mime: row.mime || null,
          bytes: row.bytes ? '\\x' + Buffer.from(row.bytes).toString('hex') : null,
          error_code: row.errorCode || null, error_message: row.errorMessage || null
        }
      });
      return rows[0].id;
    },

    async getVideo({ tenantId, ownerType, ownerId, id }) {
      if (!UUID.test(String(id))) return null;
      const rows = await request('GET', `generated_videos?id=eq.${id}&tenant_id=eq.${tenantId}&owner_type=eq.${ownerType}&owner_id=eq.${encodeURIComponent(ownerId)}&select=*&limit=1`);
      const r = rows && rows[0];
      if (!r) return null;
      return { id:r.id, tenantId:r.tenant_id, conversationId:r.conversation_id, ownerType:r.owner_type, ownerId:r.owner_id,
        prompt:r.prompt, targetSeconds:r.target_seconds, producedSeconds:r.produced_seconds, status:r.status,
        provider:r.provider, providerOperation:r.provider_operation, providerVideoUri:r.provider_video_uri,
        mime:r.mime, bytes:r.bytes ? Buffer.from(String(r.bytes).replace(/^\\x/, ''), 'hex') : null,
        errorCode:r.error_code, errorMessage:r.error_message, createdAt:r.created_at, updatedAt:r.updated_at };
    },

    async updateVideo(id, patch) {
      if (!UUID.test(String(id))) return false;
      const body = {};
      const map = { tenantId:'tenant_id', conversationId:'conversation_id', targetSeconds:'target_seconds',
        producedSeconds:'produced_seconds', status:'status', providerOperation:'provider_operation',
        providerVideoUri:'provider_video_uri', mime:'mime', bytes:'bytes', errorCode:'error_code', errorMessage:'error_message' };
      for (const [k,col] of Object.entries(map)) if (k in patch) body[col] = k === 'bytes' && patch[k] ? '\\x' + Buffer.from(patch[k]).toString('hex') : patch[k];
      body.updated_at = new Date().toISOString();
      const rows = await request('PATCH', `generated_videos?id=eq.${id}`, { prefer:'return=representation', body });
      return Array.isArray(rows) && rows.length > 0;
    },

    // Estimated spend (USD) since a moment, across everything (migration 003).
    // Knowledge (migration 009). Only the server reads these tables.
    async listKnowledgeDocs(tenantId) {
      if (!UUID.test(String(tenantId))) return [];
      const rows = await request('GET', `knowledge_docs?tenant_id=eq.${tenantId}&order=updated_at.desc&select=id,title,source_url,who,chars,updated_at`);
      return (rows || []).map((r) => ({ id: r.id, tenantId, title: r.title, sourceUrl: r.source_url, who: r.who, chars: r.chars, updatedAt: r.updated_at }));
    },
    async addKnowledgeDoc({ tenantId, title, sourceUrl = null, who, chars, chunks }) {
      const rows = await request('POST', 'knowledge_docs?select=id', { prefer: 'return=representation', body: { tenant_id: tenantId, title, source_url: sourceUrl, who, chars } });
      const id = rows[0].id;
      try {
        await request('POST', 'knowledge_chunks', { prefer: 'return=minimal', body: chunks.map((text, idx) => ({ doc_id: id, tenant_id: tenantId, idx, text })) });
      } catch (err) {
        await request('DELETE', `knowledge_docs?id=eq.${id}`, { prefer: 'return=minimal' }).catch(() => {});
        throw err;
      }
      return id;
    },
    async deleteKnowledgeDoc(tenantId, id) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return false;
      const rows = await request('DELETE', `knowledge_docs?tenant_id=eq.${tenantId}&id=eq.${id}&select=id`, { prefer: 'return=representation' });
      return Array.isArray(rows) && rows.length > 0;
    },
    async searchKnowledge({ tenantId, terms, audience, limit = 4 }) {
      if (!UUID.test(String(tenantId)) || !terms.length) return [];
      const rows = await request('POST', 'rpc/search_knowledge', { body: { p_tenant: tenantId, p_terms: terms.join(' | '), p_audience: audience, p_limit: limit } });
      return (rows || []).map((r) => ({ docId: r.doc_id, title: r.title, sourceUrl: r.source_url, idx: r.idx, text: r.text, rank: Number(r.rank) || 0 }));
    },
    // Memories (migration 009).
    async listMemories({ tenantId, userId }) {
      if (!UUID.test(String(tenantId))) return [];
      assertOwner('user', userId);
      const rows = await request('GET', `user_memories?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=100&select=id,text,created_at`);
      return (rows || []).map((r) => ({ id: r.id, tenantId, userId, text: r.text, createdAt: r.created_at }));
    },
    async addMemory({ tenantId, userId, text }) {
      assertOwner('user', userId);
      const rows = await request('POST', 'user_memories?select=id', { prefer: 'return=representation', body: { tenant_id: tenantId, user_id: userId, text } });
      return rows[0].id;
    },
    async deleteMemory({ tenantId, userId, id }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return false;
      assertOwner('user', userId);
      const rows = await request('DELETE', `user_memories?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&id=eq.${id}&select=id`, { prefer: 'return=representation' });
      return Array.isArray(rows) && rows.length > 0;
    },
    async deleteAllMemories({ tenantId, userId }) {
      if (!UUID.test(String(tenantId))) return;
      assertOwner('user', userId);
      await request('DELETE', `user_memories?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}`, { prefer: 'return=minimal' });
    },


    // Storage (migration 014): what a signed-in person keeps, and their keep-time.
    async addSentFile({ tenantId, userId, conversationId = null, kind, name, mime, bytes }) {
      assertOwner('user', userId);
      if (conversationId !== null && !UUID.test(String(conversationId))) throw new Error('invalid conversation');
      const rows = await request('POST', 'sent_files?select=id', {
        prefer: 'return=representation',
        body: { tenant_id: tenantId, user_id: userId, conversation_id: conversationId, kind, name, mime, size: bytes.length, bytes: '\\x' + bytes.toString('hex') }
      });
      return rows[0].id;
    },
    async listSentFiles({ tenantId, userId }) {
      if (!UUID.test(String(tenantId))) return [];
      assertOwner('user', userId);
      const rows = await request('GET', `sent_files?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=500&select=id,conversation_id,kind,name,mime,size,created_at`);
      return (rows || []).map((r) => ({ id: r.id, conversationId: r.conversation_id, kind: r.kind, name: r.name, mime: r.mime, size: r.size, createdAt: r.created_at }));
    },
    async getSentFile({ tenantId, userId, id }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return null;
      assertOwner('user', userId);
      const rows = await request('GET', `sent_files?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&id=eq.${id}&select=id,kind,name,mime,size,created_at,bytes&limit=1`);
      const r = rows && rows[0];
      if (!r) return null;
      return { id: r.id, kind: r.kind, name: r.name, mime: r.mime, size: r.size, createdAt: r.created_at, bytes: Buffer.from(String(r.bytes).replace(/^\\x/, ''), 'hex') };
    },
    async deleteSentFile({ tenantId, userId, id }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return false;
      assertOwner('user', userId);
      const rows = await request('DELETE', `sent_files?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&id=eq.${id}&select=id`, { prefer: 'return=representation' });
      return Array.isArray(rows) && rows.length > 0;
    },
    async listImages({ tenantId, ownerType, ownerId, limit = 500 }) {
      if (!UUID.test(String(tenantId))) return [];
      assertOwner(ownerType, ownerId);
      const rows = await request('GET', `generated_images?tenant_id=eq.${tenantId}&owner_type=eq.${ownerType}&owner_id=eq.${encodeURIComponent(ownerId)}&order=created_at.desc&limit=${Math.min(500, limit)}&select=id,conversation_id,mime,created_at`);
      return (rows || []).map((r) => ({ id: r.id, conversationId: r.conversation_id, mime: r.mime, size: 0, createdAt: r.created_at }));
    },
    async deleteImage({ tenantId, ownerType, ownerId, id }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return false;
      assertOwner(ownerType, ownerId);
      const rows = await request('DELETE', `generated_images?tenant_id=eq.${tenantId}&owner_type=eq.${ownerType}&owner_id=eq.${encodeURIComponent(ownerId)}&id=eq.${id}&select=id`, { prefer: 'return=representation' });
      return Array.isArray(rows) && rows.length > 0;
    },
    // One person's chats, files, notes, replies, sent files and pictures older than `before`.
    async purgeUserBefore({ tenantId, userId, before, imagesOnly = false }) {
      assertOwner('user', userId);
      await request('POST', 'rpc/purge_user_data_before', { body: { p_tenant: tenantId, p_user: userId, p_before: before.toISOString(), p_images_only: imagesOnly === true } });
    },

    // Library (migration 012). Every query filters by tenant AND user.
    async listLibraryFiles({ tenantId, userId }) {
      if (!UUID.test(String(tenantId))) return [];
      assertOwner('user', userId);
      const rows = await request('GET', `library_files?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=500&select=id,title,kind,format,chars,created_at`);
      return (rows || []).map(mapLibraryFile);
    },
    async getLibraryFile({ tenantId, userId, id }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return null;
      assertOwner('user', userId);
      const rows = await request('GET', `library_files?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&id=eq.${id}&select=id,title,kind,format,chars,created_at&limit=1`);
      if (!rows || !rows[0]) return null;
      const chunks = await request('GET', `library_chunks?file_id=eq.${id}&tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&order=idx.asc&select=text&limit=1001`);
      return { ...mapLibraryFile(rows[0]), chunks: (chunks || []).map((c) => c.text) };
    },
    async addLibraryFile({ tenantId, userId, title, kind, format, chars, chunks }) {
      assertOwner('user', userId);
      const rows = await request('POST', 'library_files?select=id', { prefer: 'return=representation', body: { tenant_id: tenantId, user_id: userId, title, kind, format, chars } });
      const id = rows[0].id;
      try {
        await request('POST', 'library_chunks', { prefer: 'return=minimal', body: chunks.map((text, idx) => ({ file_id: id, tenant_id: tenantId, user_id: userId, idx, text })) });
      } catch (err) {
        await request('DELETE', `library_files?id=eq.${id}`, { prefer: 'return=minimal' }).catch(() => {});
        throw err;
      }
      return id;
    },
    async deleteLibraryFile({ tenantId, userId, id }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return false;
      assertOwner('user', userId);
      const rows = await request('DELETE', `library_files?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&id=eq.${id}&select=id`, { prefer: 'return=representation' });
      return Array.isArray(rows) && rows.length > 0;
    },
    async searchLibrary({ tenantId, userId, terms, limit = 4 }) {
      if (!UUID.test(String(tenantId)) || !terms.length) return [];
      assertOwner('user', userId);
      const rows = await request('POST', 'rpc/search_library', { body: { p_tenant: tenantId, p_user: userId, p_terms: terms.join(' | '), p_limit: limit } });
      return (rows || []).map((r) => ({ fileId: r.file_id, title: r.title, idx: r.idx, text: r.text, rank: Number(r.rank) || 0 }));
    },

    // Projects (migration 013). Every query filters by tenant AND user.
    async listProjects({ tenantId, userId }) {
      if (!UUID.test(String(tenantId))) return [];
      assertOwner('user', userId);
      const rows = await request('GET', `projects?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc&limit=200&select=${PROJECT_COLUMNS}`);
      return (rows || []).map(mapProject);
    },
    async getProject({ tenantId, userId, id }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return null;
      assertOwner('user', userId);
      const rows = await request('GET', `projects?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&id=eq.${id}&select=${PROJECT_COLUMNS}&limit=1`);
      return rows && rows[0] ? mapProject(rows[0]) : null;
    },
    async createProject({ tenantId, userId, name, description = '', instructions = '', status = 'active' }) {
      assertOwner('user', userId);
      const rows = await request('POST', `projects?select=${PROJECT_COLUMNS}`, { prefer: 'return=representation', body: { tenant_id: tenantId, user_id: userId, name, description, instructions, status } });
      return mapProject(rows[0]);
    },
    async updateProject({ tenantId, userId, id, patch }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return null;
      assertOwner('user', userId);
      const body = { updated_at: new Date().toISOString() };
      for (const k of ['name', 'description', 'instructions', 'status']) if (k in patch) body[k] = patch[k];
      const rows = await request('PATCH', `projects?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&id=eq.${id}&select=${PROJECT_COLUMNS}`, { prefer: 'return=representation', body });
      return rows && rows[0] ? mapProject(rows[0]) : null;
    },
    async deleteProject({ tenantId, userId, id }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return false;
      assertOwner('user', userId);
      const rows = await request('DELETE', `projects?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&id=eq.${id}&select=id`, { prefer: 'return=representation' });
      return Array.isArray(rows) && rows.length > 0;
    },
    async listTasks({ tenantId, userId, projectId }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(projectId))) return [];
      assertOwner('user', userId);
      const rows = await request('GET', `project_tasks?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&project_id=eq.${projectId}&order=created_at.asc&limit=200&select=id,text,done,created_at`);
      return (rows || []).map((r) => ({ id: r.id, text: r.text, done: r.done, createdAt: r.created_at }));
    },
    async addTask({ tenantId, userId, projectId, text }) {
      assertOwner('user', userId);
      const rows = await request('POST', 'project_tasks?select=id,text,done,created_at', { prefer: 'return=representation', body: { project_id: projectId, tenant_id: tenantId, user_id: userId, text } });
      const r = rows[0];
      return { id: r.id, text: r.text, done: r.done, createdAt: r.created_at };
    },
    async updateTask({ tenantId, userId, projectId, id, patch }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(projectId)) || !UUID.test(String(id))) return null;
      assertOwner('user', userId);
      const body = {};
      for (const k of ['text', 'done']) if (k in patch) body[k] = patch[k];
      const rows = await request('PATCH', `project_tasks?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&project_id=eq.${projectId}&id=eq.${id}&select=id,text,done,created_at`, { prefer: 'return=representation', body });
      const r = rows && rows[0];
      return r ? { id: r.id, text: r.text, done: r.done, createdAt: r.created_at } : null;
    },
    async deleteTask({ tenantId, userId, projectId, id }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(projectId)) || !UUID.test(String(id))) return false;
      assertOwner('user', userId);
      const rows = await request('DELETE', `project_tasks?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&project_id=eq.${projectId}&id=eq.${id}&select=id`, { prefer: 'return=representation' });
      return Array.isArray(rows) && rows.length > 0;
    },
    // Links: kind 'chat' (conversation id) or 'file' (Library item id).
    async linkToProject({ tenantId, userId, projectId, kind, id }) {
      assertOwner('user', userId);
      const table = kind === 'chat' ? 'project_chats' : 'project_files';
      const col = kind === 'chat' ? 'conversation_id' : 'file_id';
      // Moving between projects: the old link goes first (no UPDATE right needed).
      await request('DELETE', `${table}?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&${col}=eq.${id}`, { prefer: 'return=minimal' });
      await request('POST', table, { prefer: 'return=minimal', body: { [col]: id, project_id: projectId, tenant_id: tenantId, user_id: userId } });
    },
    async unlinkFromProject({ tenantId, userId, kind, id }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return;
      assertOwner('user', userId);
      const table = kind === 'chat' ? 'project_chats' : 'project_files';
      const col = kind === 'chat' ? 'conversation_id' : 'file_id';
      await request('DELETE', `${table}?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&${col}=eq.${id}`, { prefer: 'return=minimal' });
    },
    // { [item id]: project id } for the person's linked chats or files.
    async projectLinks({ tenantId, userId, kind }) {
      if (!UUID.test(String(tenantId))) return {};
      assertOwner('user', userId);
      const table = kind === 'chat' ? 'project_chats' : 'project_files';
      const col = kind === 'chat' ? 'conversation_id' : 'file_id';
      const rows = await request('GET', `${table}?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&select=${col},project_id&limit=5000`);
      return Object.fromEntries((rows || []).map((r) => [r[col], r.project_id]));
    },
    async projectOf({ tenantId, userId, kind, id }) {
      if (!UUID.test(String(tenantId)) || !UUID.test(String(id))) return null;
      assertOwner('user', userId);
      const table = kind === 'chat' ? 'project_chats' : 'project_files';
      const col = kind === 'chat' ? 'conversation_id' : 'file_id';
      const rows = await request('GET', `${table}?tenant_id=eq.${tenantId}&user_id=eq.${encodeURIComponent(userId)}&${col}=eq.${id}&select=project_id&limit=1`);
      return rows && rows[0] ? rows[0].project_id : null;
    },
    async searchLibraryIn({ tenantId, userId, projectId = null, terms, limit = 4 }) {
      if (!UUID.test(String(tenantId)) || !terms.length || (projectId !== null && !UUID.test(String(projectId)))) return [];
      assertOwner('user', userId);
      const rows = await request('POST', 'rpc/search_library_scoped', { body: { p_tenant: tenantId, p_user: userId, p_project: projectId, p_terms: terms.join(' | '), p_limit: limit } });
      return (rows || []).map((r) => ({ fileId: r.file_id, title: r.title, idx: r.idx, text: r.text, rank: Number(r.rank) || 0 }));
    },

    // Channels (migration 007). Only the server reads this table.
    async getChannel(kind, externalId) {
      if (!/^[a-z]{2,20}$/.test(kind) || !/^[0-9]{5,30}$/.test(String(externalId))) return null;
      const rows = await request('GET', `channels?kind=eq.${kind}&external_id=eq.${externalId}&select=tenant_id,kind,external_id,secret_enc,enabled,updated_at&limit=1`);
      return rows && rows[0] ? mapChannel(rows[0]) : null;
    },
    async listChannels(tenantId) {
      if (!UUID.test(String(tenantId))) return [];
      const rows = await request('GET', `channels?tenant_id=eq.${tenantId}&select=tenant_id,kind,external_id,secret_enc,enabled,updated_at`);
      return (rows || []).map(mapChannel);
    },
    // Insert, or update only when the row already belongs to this business
    // (a Page cannot be taken over by another business).
    async putChannel({ tenantId, kind, externalId, secretEnc, enabled }) {
      const old = await this.getChannel(kind, externalId);
      if (old && old.tenantId !== tenantId) throw Object.assign(new Error('channel belongs to another business'), { code: 'taken' });
      const cols = 'select=tenant_id,kind,external_id,secret_enc,enabled,updated_at';
      const rows = old
        ? await request('PATCH', `channels?kind=eq.${kind}&external_id=eq.${externalId}&tenant_id=eq.${tenantId}&${cols}`, { prefer: 'return=representation', body: { secret_enc: secretEnc, enabled, updated_at: new Date().toISOString() } })
        : await request('POST', `channels?${cols}`, { prefer: 'return=representation', body: { tenant_id: tenantId, kind, external_id: externalId, secret_enc: secretEnc, enabled } });
      return mapChannel(rows[0]);
    },
    async deleteChannel(tenantId, kind, externalId) {
      if (!UUID.test(String(tenantId)) || !/^[a-z]{2,20}$/.test(kind) || !/^[0-9]{5,30}$/.test(String(externalId))) return false;
      const rows = await request('DELETE', `channels?tenant_id=eq.${tenantId}&kind=eq.${kind}&external_id=eq.${externalId}&select=external_id`, { prefer: 'return=representation' });
      return Array.isArray(rows) && rows.length > 0;
    },

    // Connectors (migration 006). Only the server reads this table.
    async listConnectors(tenantId) {
      if (!UUID.test(String(tenantId))) return [];
      const rows = await request('GET', `connectors?tenant_id=eq.${tenantId}&order=name.asc&select=tenant_id,name,base_url,auth_type,auth_header,secret_enc,actions,enabled,updated_at,webhook_secret_enc,events_who,oauth`);
      return (rows || []).map(mapConnector);
    },
    async putConnector({ tenantId, name, baseUrl, authType, authHeader, secretEnc, actions, enabled, eventsWho = ['service'], oauth = null }) {
      const rows = await request('POST', 'connectors?on_conflict=tenant_id,name&select=tenant_id,name,base_url,auth_type,auth_header,secret_enc,actions,enabled,updated_at,webhook_secret_enc,events_who,oauth', {
        prefer: 'return=representation,resolution=merge-duplicates',
        body: { tenant_id: tenantId, name, base_url: baseUrl, auth_type: authType, auth_header: authHeader, secret_enc: secretEnc, actions, enabled, events_who: eventsWho, oauth, updated_at: new Date().toISOString() }
      });
      return mapConnector(rows[0]);
    },
    async setConnectorWebhook(tenantId, name, secretEnc) {
      if (!UUID.test(String(tenantId)) || !/^[a-z][a-z0-9_]{1,20}$/.test(name)) return false;
      const rows = await request('PATCH', `connectors?tenant_id=eq.${tenantId}&name=eq.${name}&select=name`, { prefer: 'return=representation', body: { webhook_secret_enc: secretEnc, updated_at: new Date().toISOString() } });
      return Array.isArray(rows) && rows.length > 0;
    },
    // Connector events (migration 008). Returns false for an event already stored.
    async addConnectorEvent({ tenantId, connector, eventId, type, key, data }) {
      const rows = await request('POST', 'connector_events?on_conflict=tenant_id,connector,event_id&select=id', {
        prefer: 'return=representation,resolution=ignore-duplicates',
        body: { tenant_id: tenantId, connector, event_id: eventId, type, key, data }
      });
      return Array.isArray(rows) && rows.length > 0;
    },
    async listConnectorEvents({ tenantId, connector, type = null, key = null, limit = 10 }) {
      if (!UUID.test(String(tenantId)) || !/^[a-z][a-z0-9_]{1,20}$/.test(connector)) return [];
      const q = [`tenant_id=eq.${tenantId}`, `connector=eq.${connector}`, ...(type ? ['type=eq.' + encodeURIComponent(type)] : []),
        ...(key ? ['key=eq.' + encodeURIComponent(key)] : []), 'order=created_at.desc', `limit=${Math.min(50, limit)}`, 'select=event_id,type,key,data,created_at'].join('&');
      const rows = await request('GET', 'connector_events?' + q);
      return (rows || []).map((r) => ({ eventId: r.event_id, type: r.type, key: r.key, data: r.data, createdAt: r.created_at }));
    },
    async purgeConnectorEvents(before) {
      await request('DELETE', 'connector_events?created_at=lt.' + encodeURIComponent(before.toISOString()), { prefer: 'return=minimal' });
    },
    async deleteConnector(tenantId, name) {
      if (!UUID.test(String(tenantId)) || !/^[a-z][a-z0-9_]{1,20}$/.test(name)) return false;
      const rows = await request('DELETE', `connectors?tenant_id=eq.${tenantId}&name=eq.${name}&select=name`, { prefer: 'return=representation' });
      return Array.isArray(rows) && rows.length > 0;
    },

    // Picture spending only (usage_events.task = 'image', migration 003).
    async imageCostSince(since) {
      const rows = await request('GET', 'usage_events?select=cost_usd&task=eq.image&cost_usd=gt.0&created_at=gte.'
        + encodeURIComponent(since.toISOString()) + '&limit=20000');
      if (!Array.isArray(rows)) throw new UpstreamError('usage_events returned an unexpected shape');
      return rows.reduce((sum, r) => sum + (Number(r.cost_usd) || 0), 0);
    },

    async costSince(since) {
      const n = Number(await request('POST', 'rpc/usage_cost_since', { body: { p_since: since.toISOString() } }));
      if (!Number.isFinite(n)) throw new UpstreamError('usage_cost_since returned an unexpected shape');
      return n;
    }
  };
}
