import { randomUUID } from 'node:crypto';
import { PLATFORM_TENANT_ID } from '../tenants.js';
import { mapKey, mapTenant, mapConversation, mapMessage, mapConnector, mapChannel } from './shape.js';

// The same interface as the Supabase store, kept in memory. Used by tests and
// local development only; the server refuses it in production.
export function createMemoryStore({ now = () => Date.now() } = {}) {
  const tenants = new Map();
  const keys = new Map();
  const counters = new Map();
  const usage = [];
  const conversations = new Map();
  const messages = [];
  const planPeriods = [];
  const images = new Map();
  const acceptances = [];
  const connectors = new Map();   // tenantId:name -> row
  const channels = new Map();     // kind:externalId -> row
  const events = [];              // connector events
  const docs = new Map();         // knowledge documents (with their chunks)
  const memories = [];            // user memories
  const iso = () => new Date(now()).toISOString();

  tenants.set(PLATFORM_TENANT_ID, { id: PLATFORM_TENANT_ID, kind: 'platform', status: 'active', daily_token_limit: 2_000_000 });

  return {
    kind: 'memory',
    usage,

    // test helpers
    planPeriods,
    addTenant(row) { tenants.set(row.id, { kind: 'business', status: 'active', daily_token_limit: 1_000_000, ...row }); },
    addApiKey(row) { keys.set(row.id, { scopes: ['chat'], allowed_origins: [], revoked_at: null, secret_hash: null, ...row }); },

    // Same rules as the database function add_plan_period: one row per payment
    // reference, and a new period starts when the current one of that plan ends.
    async addPlanPeriod({ tenantId, userId, plan, days, provider, ref = null, amount = null, currency = null }) {
      if (ref && planPeriods.some((p) => p.provider === provider && p.ref === ref)) return null;
      const t = now();
      const current = planPeriods.filter((p) => p.tenantId === tenantId && p.userId === userId && p.plan === plan && p.endsAt > t);
      const start = Math.max(t, ...current.map((p) => p.endsAt));
      const row = { id: randomUUID(), tenantId, userId, plan, provider, ref, amount, currency, startsAt: start, endsAt: start + days * 86400_000 };
      planPeriods.push(row);
      return row.id;
    },

    async activePlans({ tenantId, userId }) {
      const t = now();
      return planPeriods.filter((p) => p.tenantId === tenantId && p.userId === userId && p.endsAt > t && p.startsAt <= t)
        .map((p) => ({ plan: p.plan, endsAt: new Date(p.endsAt).toISOString() }));
    },

    async getApiKey(id) {
      const r = keys.get(id);
      return r ? mapKey(r) : null;
    },

    async getTenant(id) {
      const r = tenants.get(id);
      return r ? mapTenant(r) : null;
    },

    async rateHit(bucket, windowSeconds, limit) {
      const t = now();
      const start = Math.floor(t / 1000 / windowSeconds) * windowSeconds;
      const k = bucket + '@' + start;
      const used = (counters.get(k) || 0) + 1;
      counters.set(k, used);
      return { allowed: used <= limit, used, retryAfter: Math.max(1, Math.ceil(start + windowSeconds - t / 1000)) };
    },

    async tokensSince({ since, tenantId = null, actorType = null, actorId = null }) {
      return usage
        .filter((e) => e.at >= since.getTime()
          && (tenantId === null || e.tenantId === tenantId)
          && (actorType === null || e.actorType === actorType)
          && (actorId === null || e.actorId === actorId))
        .reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0);
    },

    async createConversation({ tenantId, ownerType, ownerId, title = '', expiresAt = null }) {
      const row = { id: randomUUID(), tenant_id: tenantId, owner_type: ownerType, owner_id: ownerId, title,
        created_at: iso(), updated_at: iso(), expires_at: expiresAt };
      conversations.set(row.id, row);
      return mapConversation(row);
    },

    async getConversation(id) {
      const r = conversations.get(id);
      return r ? mapConversation(r) : null;
    },

    async listConversations({ tenantId, ownerType, ownerId, limit = 20 }) {
      return [...conversations.values()]
        .filter((c) => c.tenant_id === tenantId && c.owner_type === ownerType && c.owner_id === ownerId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, limit)
        .map(mapConversation);
    },

    async setConversationTitle(id, title) {
      const r = conversations.get(id);
      if (r) r.title = title;
    },

    async deleteConversation(id) {
      conversations.delete(id);
      for (let i = messages.length - 1; i >= 0; i--) if (messages[i].conversation_id === id) messages.splice(i, 1);
    },

    async addMessage({ conversationId, tenantId, role, content }) {
      const c = conversations.get(conversationId);
      if (!c || c.tenant_id !== tenantId) throw new Error('foreign key violation');
      const row = { id: randomUUID(), conversation_id: conversationId, tenant_id: tenantId, role, content, created_at: iso(), seq: messages.length };
      messages.push(row);
      c.updated_at = row.created_at;
      return mapMessage(row);
    },

    async listMessages(conversationId, limit = 50) {
      return messages.filter((m) => m.conversation_id === conversationId).slice(-limit).map(mapMessage);
    },

    async deleteMessage(conversationId, id) {
      const i = messages.findIndex((m) => m.id === id && m.conversation_id === conversationId);
      if (i >= 0) messages.splice(i, 1);
    },

    async getMessage(id) {
      const r = messages.find((m) => m.id === id);
      return r ? { ...mapMessage(r), conversationId: r.conversation_id } : null;
    },

    async purgeExpired() {
      for (const c of [...conversations.values()]) {
        if (c.expires_at && Date.parse(c.expires_at) < now()) await this.deleteConversation(c.id);
      }
    },

    async recordUsage(e) {
      usage.push({ ...e, at: now() });
    },

    acceptances,
    async recordAcceptance(r) { acceptances.push({ ...r, created_at: new Date(now()).toISOString() }); },
    async hasAccepted({ tenantId, userId, document, version }) {
      return acceptances.some((a) => a.tenantId === tenantId && a.userId === userId && a.document === document && a.version === version);
    },
    async listAcceptances({ tenantId, userId }) {
      return acceptances.filter((a) => a.tenantId === tenantId && a.userId === userId)
        .map((a) => ({ document: a.document, version: a.version, action: a.action, method: a.method, created_at: a.created_at }));
    },
    async listPlanPeriods({ tenantId, userId }) {
      return planPeriods.filter((p) => p.tenantId === tenantId && p.userId === userId)
        .map((p) => ({ plan: p.plan, starts_at: new Date(p.startsAt).toISOString(), ends_at: new Date(p.endsAt).toISOString(), provider: p.provider, amount: p.amount, currency: p.currency }));
    },
    async deleteConversationsOf({ tenantId, ownerType, ownerId }) {
      for (const [id, c] of conversations) {
        if (c.tenant_id === tenantId && c.owner_type === ownerType && c.owner_id === ownerId) {
          conversations.delete(id);
          for (let i = messages.length - 1; i >= 0; i--) if (messages[i].conversation_id === id) messages.splice(i, 1);
        }
      }
    },
    async deleteUserData({ tenantId, userId }) {
      await this.deleteConversationsOf({ tenantId, ownerType: 'user', ownerId: userId });
      await this.deleteAllMemories({ tenantId, userId });
      for (const e of usage) if (e.tenantId === tenantId && e.actorType === 'user' && e.actorId === userId) e.actorId = 'deleted-user';
    },

    async purgeImagesBefore(before) {
      for (const [id, r] of images) if (r.ownerType !== 'guest' && Date.parse(r.createdAt) < before.getTime()) images.delete(id);
    },

    async addImage(row) {
      const id = randomUUID();
      images.set(id, { ...row, id, createdAt: iso() });
      return id;
    },

    async getImage(id) {
      const r = images.get(id);
      if (!r) return null;
      // Gone with its conversation, like the database's cascade.
      if (!conversations.has(r.conversationId)) { images.delete(id); return null; }
      return r;
    },

    // Pictures actually made (usage records), for allowances. actorId null: all
    // actors of that type in the tenant.
    async imagesMadeSince({ since, tenantId, actorType, actorId = null, limit = 1000 }) {
      return Math.min(limit, usage.filter((e) => e.at >= since.getTime() && e.task === 'image' && e.outcome === 'ok' &&
        e.tenantId === tenantId && e.actorType === actorType && (actorId === null || e.actorId === actorId)).length);
    },

    async imageCostSince(since) {
      return usage.filter((e) => e.at >= since.getTime() && e.task === 'image').reduce((sum, e) => sum + (e.costUsd || 0), 0);
    },

    // Knowledge (migration 009). Search: chunks sharing the most words.
    async listKnowledgeDocs(tenantId) {
      return [...docs.values()].filter((d) => d.tenantId === tenantId).map(({ chunks, ...d }) => ({ ...d, chunks: chunks.length }));
    },
    async addKnowledgeDoc({ tenantId, title, sourceUrl = null, who, chars, chunks }) {
      const id = randomUUID();
      docs.set(id, { id, tenantId, title, sourceUrl, who: [...who], chars, chunks: [...chunks], updatedAt: iso() });
      return id;
    },
    async deleteKnowledgeDoc(tenantId, id) {
      if (docs.get(id)?.tenantId !== tenantId) return false;
      return docs.delete(id);
    },
    async searchKnowledge({ tenantId, terms, audience, limit = 4 }) {
      const out = [];
      for (const d of docs.values()) {
        if (d.tenantId !== tenantId || !d.who.includes(audience)) continue;
        d.chunks.forEach((text, idx) => {
          const words = new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
          const hits = terms.filter((t) => words.has(t)).length;
          if (hits) out.push({ docId: d.id, title: d.title, sourceUrl: d.sourceUrl, idx, text, rank: hits / (hits + 1) });
        });
      }
      return out.sort((a, b) => b.rank - a.rank).slice(0, limit);
    },
    // Memories (migration 009).
    async listMemories({ tenantId, userId }) {
      return memories.filter((m) => m.tenantId === tenantId && m.userId === userId).sort((a, b) => b.at - a.at).map(({ at, ...m }) => m);
    },
    async addMemory({ tenantId, userId, text }) {
      const m = { id: randomUUID(), tenantId, userId, text, createdAt: iso(), at: now() + memories.length / 1000 };
      memories.push(m);
      return m.id;
    },
    async deleteMemory({ tenantId, userId, id }) {
      const i = memories.findIndex((m) => m.id === id && m.tenantId === tenantId && m.userId === userId);
      if (i < 0) return false;
      memories.splice(i, 1);
      return true;
    },
    async deleteAllMemories({ tenantId, userId }) {
      for (let i = memories.length - 1; i >= 0; i--) if (memories[i].tenantId === tenantId && memories[i].userId === userId) memories.splice(i, 1);
    },

    // Channels (migration 007).
    async getChannel(kind, externalId) {
      const r = channels.get(kind + ':' + externalId);
      return r ? mapChannel(r) : null;
    },
    async listChannels(tenantId) {
      return [...channels.values()].filter((c) => c.tenant_id === tenantId).map(mapChannel);
    },
    async putChannel({ tenantId, kind, externalId, secretEnc, enabled }) {
      const k = kind + ':' + externalId;
      const old = channels.get(k);
      if (old && old.tenant_id !== tenantId) throw Object.assign(new Error('channel belongs to another business'), { code: 'taken' });
      const row = { tenant_id: tenantId, kind, external_id: externalId, secret_enc: secretEnc, enabled, updated_at: iso() };
      channels.set(k, row);
      return mapChannel(row);
    },
    async deleteChannel(tenantId, kind, externalId) {
      const k = kind + ':' + externalId;
      if (channels.get(k)?.tenant_id !== tenantId) return false;
      return channels.delete(k);
    },

    // Connectors (migration 006).
    async listConnectors(tenantId) {
      return [...connectors.values()].filter((c) => c.tenant_id === tenantId).sort((a, b) => a.name.localeCompare(b.name)).map(mapConnector);
    },
    async putConnector({ tenantId, name, baseUrl, authType, authHeader, secretEnc, actions, enabled, eventsWho = ['service'], oauth = null }) {
      const k = tenantId + ':' + name;
      const row = { ...(connectors.get(k) || { created_at: iso() }), tenant_id: tenantId, name, base_url: baseUrl, auth_type: authType,
        auth_header: authHeader, secret_enc: secretEnc, actions: JSON.parse(JSON.stringify(actions)), enabled, events_who: eventsWho, oauth, updated_at: iso() };
      connectors.set(k, row);
      return mapConnector(row);
    },
    async deleteConnector(tenantId, name) {
      return connectors.delete(tenantId + ':' + name);
    },
    async setConnectorWebhook(tenantId, name, secretEnc) {
      const row = connectors.get(tenantId + ':' + name);
      if (!row) return false;
      row.webhook_secret_enc = secretEnc;
      return true;
    },
    events,
    async addConnectorEvent({ tenantId, connector, eventId, type, key, data }) {
      if (events.some((e) => e.tenantId === tenantId && e.connector === connector && e.eventId === eventId)) return false;
      events.push({ tenantId, connector, eventId, type, key, data: JSON.parse(JSON.stringify(data)), createdAt: iso(), at: now() });
      return true;
    },
    async listConnectorEvents({ tenantId, connector, type = null, key = null, limit = 10 }) {
      return events.filter((e) => e.tenantId === tenantId && e.connector === connector && (!type || e.type === type) && (!key || e.key === key))
        .sort((a, b) => b.at - a.at).slice(0, limit).map(({ eventId, type: t, key: k, data, createdAt }) => ({ eventId, type: t, key: k, data, createdAt }));
    },
    async purgeConnectorEvents(before) {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].at < before.getTime()) events.splice(i, 1);
    },

    async costSince(since) {
      return usage.filter((e) => e.at >= since.getTime()).reduce((sum, e) => sum + (e.costUsd || 0), 0);
    }
  };
}
