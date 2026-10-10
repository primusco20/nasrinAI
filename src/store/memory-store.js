import { randomUUID } from 'node:crypto';
import { PLATFORM_TENANT_ID } from '../tenants.js';
import { mapKey, mapTenant, mapConversation, mapMessage, mapConnector, mapChannel } from './shape.js';

// The same interface as the Supabase store, kept in memory. Used by tests and
// local development only; the server refuses it in production.
const projectOut = ({ tasks, at, tenantId, userId, ...p }) => p;

export function createMemoryStore({ now = () => Date.now() } = {}) {
  const tenants = new Map();
  const keys = new Map();
  const counters = new Map();
  const usage = [];
  const reservations = new Map();
  const conversations = new Map();
  const messages = [];
  const planPeriods = [];
  const images = new Map();
  const videos = new Map();
  const marketingCache = new Map();
  const sentFiles = new Map();   // photos and files sent in chat (migration 014)
  const acceptances = [];
  const improvementConsentEvents = [];
  const improvementExamples = [];
  const improvementExampleDeletions = [];
  let improvementConsentSequence = 0;
  const connectors = new Map();   // tenantId:name -> row
  const channels = new Map();     // kind:externalId -> row
  const events = [];              // connector events
  const docs = new Map();         // knowledge documents (with their chunks)
  const memories = [];            // user memories
  const library = new Map();      // Library files (with their chunks)
  const projects = new Map();     // projects (with their tasks)
  const links = { chat: new Map(), file: new Map() };   // item id -> { projectId, tenantId, userId }
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
      const events = usage
        .filter((e) => !e.reservationId && e.at >= since.getTime()
          && (tenantId === null || e.tenantId === tenantId)
          && (actorType === null || e.actorType === actorType)
          && (actorId === null || e.actorId === actorId))
        .reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0);
      const reserved = [...reservations.values()]
        .filter((r) => r.createdAt >= since.getTime() && ['reserved', 'settled'].includes(r.status)
          && (tenantId === null || r.tenantId === tenantId)
          && (actorType === null || r.actorType === actorType)
          && (actorId === null || r.actorId === actorId))
        .reduce((sum, r) => sum + (r.status === 'reserved' ? r.reservedTokens : r.actualTokens), 0);
      return events + reserved;
    },

    async reserveDailyTokens({ reservationId, tenantId, actorType, actorId, reservedTokens, actorLimit, guestLimit, tenantLimit }) {
      if (!reservationId || reservations.has(reservationId) || !Number.isSafeInteger(reservedTokens) || reservedTokens < 1) {
        return { allowed: false, reason: 'invalid_reservation', reservationId: null, actorUsed: 0, tenantUsed: 0 };
      }
      const day = 24 * 60 * 60 * 1000;
      const offset = 8 * 60 * 60 * 1000;
      const dayStart = Math.floor((now() + offset) / day) * day - offset;
      const legacy = (filter) => usage.filter((e) => !e.reservationId && e.at >= dayStart && filter(e))
        .reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0);
      const held = (filter) => [...reservations.values()].filter((r) => r.dayStart === dayStart
        && ['reserved', 'settled'].includes(r.status) && filter(r))
        .reduce((sum, r) => sum + (r.status === 'reserved' ? r.reservedTokens : r.actualTokens), 0);
      const tenantUsed = legacy((e) => e.tenantId === tenantId) + held((r) => r.tenantId === tenantId);
      let actorUsed = 0;
      let limit = null;
      if (actorType === 'user') {
        limit = actorLimit;
        const weekStart = dayStart - ((new Date(now() + offset).getUTCDay() + 6) % 7) * day;
        actorUsed = usage.filter((e) => !e.reservationId && e.at >= weekStart && e.tenantId === tenantId && e.actorType === 'user' && e.actorId === actorId)
          .reduce((sum, e) => sum + e.inputTokens + e.outputTokens, 0)
          + [...reservations.values()].filter((r) => r.dayStart >= weekStart && ['reserved', 'settled'].includes(r.status) && r.tenantId === tenantId && r.actorType === 'user' && r.actorId === actorId)
            .reduce((sum, r) => sum + (r.status === 'reserved' ? r.reservedTokens : r.actualTokens), 0);
      } else if (actorType === 'guest' && tenantId === PLATFORM_TENANT_ID) {
        limit = guestLimit;
        actorUsed = legacy((e) => e.tenantId === tenantId && e.actorType === 'guest')
          + held((r) => r.tenantId === tenantId && r.actorType === 'guest');
      }
      if (limit !== null && limit > 0 && actorUsed + reservedTokens > limit) {
        return { allowed: false, reason: actorType === 'guest' ? 'guest_limit' : 'weekly_limit', reservationId: null, actorUsed, tenantUsed };
      }
      if (tenantUsed + reservedTokens > tenantLimit) {
        return { allowed: false, reason: 'tenant_limit', reservationId: null, actorUsed, tenantUsed };
      }
      reservations.set(reservationId, { reservationId, tenantId, actorType, actorId, reservedTokens, actualTokens: null,
        status: 'reserved', dayStart, createdAt: now() });
      return { allowed: true, reason: null, reservationId, actorUsed, tenantUsed };
    },

    async settleDailyTokenReservation({ reservationId, actualTokens }) {
      const r = reservations.get(reservationId);
      if (!r) return false;
      if (r.status === 'settled') return true;
      if (r.status !== 'reserved' || !Number.isSafeInteger(actualTokens) || actualTokens < 0) return false;
      r.status = 'settled';
      r.actualTokens = actualTokens;
      r.settledAt = now();
      return true;
    },

    async releaseDailyTokenReservation({ reservationId }) {
      const r = reservations.get(reservationId);
      if (!r) return false;
      if (r.status === 'released') return true;
      if (r.status !== 'reserved') return false;
      r.status = 'released';
      r.settledAt = now();
      return true;
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
      links.chat.delete(id);
      for (const [fid, f] of sentFiles) if (f.conversationId === id) sentFiles.delete(fid);
      for (const [iid, im] of images) if (im.conversationId === id) images.delete(iid);
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

    improvementConsentEvents,
    improvementExamples,
    improvementExampleDeletions,
    async deleteImprovementExamplesForSubject({ tenantId, subjectType, subjectId, reasonCode }) {
      if (!['user', 'guest'].includes(subjectType) || typeof subjectId !== 'string' || !subjectId || subjectId.length > 80 ||
          !['consent_withdrawal', 'account_deletion', 'privacy_request'].includes(reasonCode)) {
        throw new Error('invalid improvement-example deletion request');
      }
      const matches = improvementExamples.filter((e) => e.tenantId === tenantId && e.subjectType === subjectType && e.subjectId === subjectId);
      const ids = matches.map((e) => e.id);
      for (let i = improvementExamples.length - 1; i >= 0; i--) {
        const e = improvementExamples[i];
        if (e.tenantId === tenantId && e.subjectType === subjectType && e.subjectId === subjectId) improvementExamples.splice(i, 1);
      }
      improvementExampleDeletions.push({ request_id: randomUUID(), tenant_id: tenantId, reason_code: reasonCode, deleted_example_ids: ids, deleted_count: ids.length, created_at: iso() });
      return ids.length;
    },
    async purgeImprovementExamples() {
      const cutoffGuest = now() - 24 * 60 * 60 * 1000;
      for (let i = improvementExamples.length - 1; i >= 0; i--) {
        const e = improvementExamples[i];
        const latest = improvementConsentEvents.filter((c) => c.tenantId === e.tenantId && c.subjectType === e.subjectType && c.subjectId === e.subjectId).sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at) || (y.sequence ?? 0) - (x.sequence ?? 0))[0];
        if (Date.parse(e.expiresAt) <= now() || (e.subjectType === 'guest' && Date.parse(e.createdAt) < cutoffGuest) || !latest || latest.decision !== 'granted' || latest.version !== e.consentVersion || e.consentVersion === '2026-10-10-preference-only') improvementExamples.splice(i, 1);
      }
    },
    async purgeImprovementConsent() {
      const cutoffGuest = now() - 24 * 60 * 60 * 1000;
      const cutoffUser = now() - 10 * 365.25 * 24 * 60 * 60 * 1000;
      for (let i = improvementConsentEvents.length - 1; i >= 0; i--) {
        const e = improvementConsentEvents[i];
        const cutoff = e.subjectType === 'guest' ? cutoffGuest : cutoffUser;
        if (Date.parse(e.created_at) < cutoff) improvementConsentEvents.splice(i, 1);
      }
    },
    async getImprovementConsent({ tenantId, subjectType, subjectId }) {
      if (!['user', 'guest'].includes(subjectType) || typeof subjectId !== 'string' || !subjectId || subjectId.length > 80) return null;
      const row = improvementConsentEvents
        .filter((e) => e.tenantId === tenantId && e.subjectType === subjectType && e.subjectId === subjectId)
        .sort((a, b) => b.sequence - a.sequence)[0];
      return row ? { version: row.version, decision: row.decision, createdAt: row.created_at } : null;
    },
    async recordImprovementConsent({ tenantId, subjectType, subjectId, version, decision }) {
      if (!['user', 'guest'].includes(subjectType) || typeof subjectId !== 'string' || !subjectId || subjectId.length > 80 ||
          !/^[A-Za-z0-9._-]{1,40}$/.test(String(version)) || !['granted', 'declined', 'withdrawn'].includes(decision)) {
        throw new Error('invalid improvement consent event');
      }
      improvementConsentEvents.push({ tenantId, subjectType, subjectId, version, decision, created_at: iso(), sequence: ++improvementConsentSequence });
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
        .map((p) => ({ id: p.id, plan: p.plan, starts_at: new Date(p.startsAt).toISOString(), ends_at: new Date(p.endsAt).toISOString(), provider: p.provider, provider_ref: p.ref, amount: p.amount, currency: p.currency, created_at: new Date(p.startsAt).toISOString() }));
    },
    async deleteConversationsOf({ tenantId, ownerType, ownerId }) {
      for (const [id, c] of conversations) {
        if (c.tenant_id === tenantId && c.owner_type === ownerType && c.owner_id === ownerId) {
          conversations.delete(id);
          links.chat.delete(id);
          for (let i = messages.length - 1; i >= 0; i--) if (messages[i].conversation_id === id) messages.splice(i, 1);
        }
      }
    },
    async deleteUserData({ tenantId, userId }) {
      await this.deleteConversationsOf({ tenantId, ownerType: 'user', ownerId: userId });
      await this.deleteAllMemories({ tenantId, userId });
      for (const [id, f] of library) if (f.tenantId === tenantId && f.userId === userId) library.delete(id);
      for (const [id, f] of sentFiles) if (f.tenantId === tenantId && f.userId === userId) sentFiles.delete(id);
      for (const [id, p] of projects) if (p.tenantId === tenantId && p.userId === userId) await this.deleteProject({ tenantId, userId, id });
      for (const m of Object.values(links)) for (const [k, l] of m) if (l.tenantId === tenantId && l.userId === userId) m.delete(k);
      for (const e of usage) if (e.tenantId === tenantId && e.actorType === 'user' && e.actorId === userId) e.actorId = 'deleted-user';
    },

    async purgeImagesBefore(before) {
      for (const [id, r] of images) if (r.ownerType === 'service' && Date.parse(r.createdAt) < before.getTime()) images.delete(id);
    },

    async getMarketingCache({ tenantId, ownerType, ownerId, kind, key }) {
      const cacheKey = [tenantId, ownerType, ownerId, kind, key].join(':');
      const row = marketingCache.get(cacheKey);
      if (!row || Date.parse(row.expiresAt) <= now()) { marketingCache.delete(cacheKey); return null; }
      return JSON.parse(JSON.stringify(row.value));
    },
    async setMarketingCache({ tenantId, ownerType, ownerId, kind, key, value, ttlMs = 7 * 86400_000 }) {
      if (JSON.stringify(value).length > 100_000) return false;
      for (const [k, row] of marketingCache) if (Date.parse(row.expiresAt) <= now()) marketingCache.delete(k);
      const cacheKey = [tenantId, ownerType, ownerId, kind, key].join(':');
      marketingCache.set(cacheKey, { value: JSON.parse(JSON.stringify(value)), expiresAt: new Date(now() + ttlMs).toISOString() });
      return true;
    },

    async addImage(row) {
      const id = randomUUID();
      images.set(id, { ...row, id, createdAt: iso() });
      return id;
    },

    async addVideo(row) {
      const id = randomUUID();
      videos.set(id, { ...row, id, createdAt: iso(), updatedAt: iso() });
      return id;
    },

    async getVideo({ tenantId, ownerType, ownerId, id }) {
      const r = videos.get(id);
      if (!r || r.tenantId !== tenantId || r.ownerType !== ownerType || r.ownerId !== ownerId) return null;
      return { ...r };
    },

    async updateVideo(id, patch) {
      const r = videos.get(id);
      if (!r) return false;
      Object.assign(r, patch, { updatedAt: iso() });
      return true;
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


    // Storage (migration 014): what a signed-in person keeps, and their keep-time.
    async addSentFile({ tenantId, userId, conversationId = null, kind, name, mime, bytes }) {
      const id = randomUUID();
      sentFiles.set(id, { id, tenantId, userId, conversationId, kind, name, mime, size: bytes.length, bytes, createdAt: iso() });
      return id;
    },
    async listSentFiles({ tenantId, userId }) {
      return [...sentFiles.values()].filter((f) => f.tenantId === tenantId && f.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(({ bytes, tenantId: t, userId: u, ...f }) => f);
    },
    async getSentFile({ tenantId, userId, id }) {
      const f = sentFiles.get(id);
      return f && f.tenantId === tenantId && f.userId === userId ? { ...f } : null;
    },
    async deleteSentFile({ tenantId, userId, id }) {
      const f = sentFiles.get(id);
      if (!f || f.tenantId !== tenantId || f.userId !== userId) return false;
      return sentFiles.delete(id);
    },
    async listImages({ tenantId, ownerType, ownerId, limit = 500 }) {
      return [...images.values()].filter((r) => r.tenantId === tenantId && r.ownerType === ownerType && r.ownerId === ownerId && conversations.has(r.conversationId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
        .map((r) => ({ id: r.id, conversationId: r.conversationId, mime: r.mime, size: r.bytes ? r.bytes.length : 0, createdAt: r.createdAt }));
    },
    async deleteImage({ tenantId, ownerType, ownerId, id }) {
      const r = images.get(id);
      if (!r || r.tenantId !== tenantId || r.ownerType !== ownerType || r.ownerId !== ownerId) return false;
      return images.delete(id);
    },
    // One person's chats, files, notes, replies, sent files and pictures older than `before`.
    async purgeUserBefore({ tenantId, userId, before, imagesOnly = false }) {
      const cut = before.getTime();
      if (!imagesOnly) for (const c of [...conversations.values()]) {
        if (c.tenant_id === tenantId && c.owner_type === 'user' && c.owner_id === userId && Date.parse(c.updated_at) < cut) await this.deleteConversation(c.id);
      }
      if (!imagesOnly) for (const [id, f] of library) if (f.tenantId === tenantId && f.userId === userId && Date.parse(f.createdAt) < cut) { links.file.delete(id); library.delete(id); }
      if (!imagesOnly) for (const [id, f] of sentFiles) if (f.tenantId === tenantId && f.userId === userId && Date.parse(f.createdAt) < cut) sentFiles.delete(id);
      for (const [id, r] of images) if (r.tenantId === tenantId && r.ownerType === 'user' && r.ownerId === userId && Date.parse(r.createdAt) < cut) images.delete(id);
    },

    // Library (migration 012).
    async listLibraryFiles({ tenantId, userId }) {
      return [...library.values()].filter((f) => f.tenantId === tenantId && f.userId === userId)
        .sort((a, b) => b.at - a.at).map(({ chunks, at, tenantId: t, userId: u, ...f }) => f);
    },
    async getLibraryFile({ tenantId, userId, id }) {
      const f = library.get(id);
      if (!f || f.tenantId !== tenantId || f.userId !== userId) return null;
      const { at, tenantId: t, userId: u, ...rest } = f;
      return { ...rest, chunks: [...f.chunks] };
    },
    async addLibraryFile({ tenantId, userId, title, kind, format, chars, chunks }) {
      const id = randomUUID();
      library.set(id, { id, tenantId, userId, title, kind, format, chars, chunks: [...chunks], createdAt: iso(), at: now() + library.size / 1000 });
      return id;
    },
    async deleteLibraryFile({ tenantId, userId, id }) {
      const f = library.get(id);
      if (!f || f.tenantId !== tenantId || f.userId !== userId) return false;
      links.file.delete(id);
      return library.delete(id);
    },
    async searchLibrary({ tenantId, userId, terms, limit = 4 }) {
      const out = [];
      for (const f of library.values()) {
        if (f.tenantId !== tenantId || f.userId !== userId) continue;
        f.chunks.forEach((text, idx) => {
          const words = new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
          const hits = terms.filter((t) => words.has(t)).length;
          if (hits) out.push({ fileId: f.id, title: f.title, idx, text, rank: hits / (hits + 1) });
        });
      }
      return out.sort((a, b) => b.rank - a.rank).slice(0, limit);
    },

    // Projects (migration 013).
    async listProjects({ tenantId, userId }) {
      return [...projects.values()].filter((p) => p.tenantId === tenantId && p.userId === userId)
        .sort((a, b) => b.at - a.at).map(projectOut);
    },
    async getProject({ tenantId, userId, id }) {
      const p = projects.get(id);
      return p && p.tenantId === tenantId && p.userId === userId ? projectOut(p) : null;
    },
    async createProject({ tenantId, userId, name, description = '', instructions = '', status = 'active' }) {
      const p = { id: randomUUID(), tenantId, userId, name, description, instructions, status, createdAt: iso(), updatedAt: iso(), at: now() + projects.size / 1000, tasks: [] };
      projects.set(p.id, p);
      return projectOut(p);
    },
    async updateProject({ tenantId, userId, id, patch }) {
      const p = projects.get(id);
      if (!p || p.tenantId !== tenantId || p.userId !== userId) return null;
      for (const k of ['name', 'description', 'instructions', 'status']) if (k in patch) p[k] = patch[k];
      p.updatedAt = iso();
      p.at = now() + projects.size / 1000 + 1;
      return projectOut(p);
    },
    async deleteProject({ tenantId, userId, id }) {
      const p = projects.get(id);
      if (!p || p.tenantId !== tenantId || p.userId !== userId) return false;
      for (const m of Object.values(links)) for (const [k, l] of m) if (l.projectId === id) m.delete(k);
      return projects.delete(id);
    },
    async listTasks({ tenantId, userId, projectId }) {
      const p = projects.get(projectId);
      return p && p.tenantId === tenantId && p.userId === userId ? p.tasks.map((t) => ({ ...t })) : [];
    },
    async addTask({ tenantId, userId, projectId, text }) {
      const p = projects.get(projectId);
      if (!p || p.tenantId !== tenantId || p.userId !== userId) throw new Error('no such project');
      const t = { id: randomUUID(), text, done: false, createdAt: iso() };
      p.tasks.push(t);
      return { ...t };
    },
    async updateTask({ tenantId, userId, projectId, id, patch }) {
      const p = projects.get(projectId);
      const t = p && p.tenantId === tenantId && p.userId === userId ? p.tasks.find((x) => x.id === id) : null;
      if (!t) return null;
      for (const k of ['text', 'done']) if (k in patch) t[k] = patch[k];
      return { ...t };
    },
    async deleteTask({ tenantId, userId, projectId, id }) {
      const p = projects.get(projectId);
      if (!p || p.tenantId !== tenantId || p.userId !== userId) return false;
      const i = p.tasks.findIndex((x) => x.id === id);
      if (i < 0) return false;
      p.tasks.splice(i, 1);
      return true;
    },
    async linkToProject({ tenantId, userId, projectId, kind, id }) {
      links[kind].set(id, { projectId, tenantId, userId });
    },
    async unlinkFromProject({ tenantId, userId, kind, id }) {
      const l = links[kind].get(id);
      if (l && l.tenantId === tenantId && l.userId === userId) links[kind].delete(id);
    },
    async projectLinks({ tenantId, userId, kind }) {
      return Object.fromEntries([...links[kind]].filter(([, l]) => l.tenantId === tenantId && l.userId === userId).map(([k, l]) => [k, l.projectId]));
    },
    async projectOf({ tenantId, userId, kind, id }) {
      const l = links[kind].get(id);
      return l && l.tenantId === tenantId && l.userId === userId ? l.projectId : null;
    },
    async searchLibraryIn({ tenantId, userId, projectId = null, terms, limit = 4 }) {
      const all = await this.searchLibrary({ tenantId, userId, terms, limit: 1000 });
      return all.filter((h) => {
        const l = links.file.get(h.fileId);
        return projectId === null ? !l : Boolean(l) && l.projectId === projectId && l.userId === userId;
      }).slice(0, limit);
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
