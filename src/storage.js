import { HttpError } from './http/errors.js';
import { UUID, PLATFORM_TENANT_ID } from './tenants.js';

// Storage: what a signed-in person has kept with NasrinAI, in one place (the
// Library tab): their chats, files and notes, photos and files they sent, and
// pictures Nasrin made. They can open or delete each item, and choose how long
// NasrinAI keeps it (Settings: retention).
//
//   prefs.retention  null  not chosen: the usual defaults (chats and files are
//                          kept; pictures follow IMAGE_RETENTION_DAYS)
//                    0     keep everything until the person deletes it
//                    1-3650  whole days: older chats, files, photos and
//                          pictures are deleted
//
// Everything is scoped to the caller's tenant and user id, taken from their
// token. Clean-up runs when the person uses the app (at most once an hour per
// person per server instance) and straight away when they change the choice.

const DAY = 86400_000;
const SWEEP_EVERY = 3600_000;
export const KINDS = Object.freeze(['chat', 'file', 'note', 'reply', 'photo_sent', 'file_sent', 'photo_generated']);
const LIBRARY_KINDS = new Set(['file', 'note', 'reply']);
// Types served back inline. Anything else is only ever served as a download.
const INLINE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export function createStorage({ store, config, conversations, library, logger, now = () => Date.now() }) {
  const limits = config.storage || { maxBytes: 100 * 1024 * 1024, maxFileBytes: 8_000_000 };
  const lastSweep = new Map();   // userId -> time of the last clean-up on this instance

  const signedIn = (caller) => {
    if (caller.actor.type !== 'user' || caller.tenantId !== PLATFORM_TENANT_ID) throw new HttpError(403, 'sign_in_required', 'Sign in to use your Library.');
  };
  const who = (caller) => ({ tenantId: caller.tenantId, userId: caller.actor.id });
  const owner = (caller) => ({ tenantId: caller.tenantId, ownerType: 'user', ownerId: caller.actor.id });
  const retentionOf = (caller) => {
    const r = caller.prefs?.retention;
    return Number.isInteger(r) && r >= 0 ? r : null;
  };
  const guard = async (fn) => {
    try { return await fn(); } catch (err) {
      if (err instanceof HttpError) throw err;
      logger.warn('storage unavailable', { error: err?.message });
      throw new HttpError(503, 'storage_unavailable', 'Your Library is not available right now. Please try again later.');
    }
  };
  const expiry = (iso, days) => (days > 0 ? new Date(Date.parse(iso) + days * DAY).toISOString() : null);

  // Deletes what is past the person's keep-time. Never throws: a failed
  // clean-up must not break a chat or a page.
  async function sweep(caller, { force = false } = {}) {
    try {
      if (caller.actor.type !== 'user' || caller.tenantId !== PLATFORM_TENANT_ID || !store.purgeUserBefore) return false;
      const id = caller.actor.id;
      const t = now();
      if (!force && t - (lastSweep.get(id) || 0) < SWEEP_EVERY) return false;
      const days = retentionOf(caller);
      if (days > 0) await store.purgeUserBefore({ ...who(caller), before: new Date(t - days * DAY) });
      else if (days === null && config.images?.retentionDays > 0) {
        await store.purgeUserBefore({ ...who(caller), before: new Date(t - config.images.retentionDays * DAY), imagesOnly: true });
      }
      // Record the successful sweep only after deletion succeeds. If the
      // database is temporarily unavailable, the next request can retry rather
      // than being throttled for a full hour.
      lastSweep.set(id, t);
      if (lastSweep.size > 5000) lastSweep.delete(lastSweep.keys().next().value);
      return true;
    } catch (err) {
      logger.warn('storage clean-up failed', { error: err?.message });
      return false;
    }
  }

  return {
    sweep,

    // Everything the person keeps, newest first, with how much and for how long.
    async list(caller) {
      signedIn(caller);
      await sweep(caller);
      const days = retentionOf(caller);
      const [chats, files, sent, pictures] = await guard(() => Promise.all([
        store.listConversations({ ...owner(caller), limit: 100 }),
        store.listLibraryFiles(who(caller)).catch(() => []),
        store.listSentFiles ? store.listSentFiles(who(caller)).catch(() => []) : [],
        store.listImages ? store.listImages(owner(caller)).catch(() => []) : []
      ]));
      const titles = new Map(chats.map((c) => [c.id, c.title]));
      const items = [
        ...chats.map((c) => ({ id: c.id, kind: 'chat', title: c.title || 'New chat', created_at: c.createdAt, updated_at: c.updatedAt, size: null, expires_at: expiry(c.updatedAt, days) })),
        ...files.map((f) => ({ id: f.id, kind: f.kind, title: f.title, created_at: f.createdAt, size: f.chars, size_unit: 'characters', expires_at: expiry(f.createdAt, days) })),
        ...sent.map((f) => ({ id: f.id, kind: f.kind === 'photo' ? 'photo_sent' : 'file_sent', title: f.name, mime: f.mime, created_at: f.createdAt, size: f.size, chat_id: f.conversationId || null, expires_at: expiry(f.createdAt, days) })),
        ...pictures.map((p) => ({ id: p.id, kind: 'photo_generated', title: titles.get(p.conversationId) || 'Picture from Nasrin', mime: p.mime, created_at: p.createdAt, size: p.size || null, chat_id: p.conversationId || null,
          expires_at: expiry(p.createdAt, days === null ? (config.images?.retentionDays || 0) : days) }))
      ].sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
      const counts = Object.fromEntries(KINDS.map((k) => [k, 0]));
      for (const i of items) counts[i.kind] += 1;
      return {
        items,
        counts,
        used: { bytes: sent.reduce((n, f) => n + f.size, 0), max_bytes: limits.maxBytes },
        retention: { days, picture_default_days: config.images?.retentionDays || 0 }
      };
    },

    async remove(caller, kind, id) {
      signedIn(caller);
      if (!KINDS.includes(kind) || !UUID.test(String(id))) throw new HttpError(404, 'not_found', 'Not found.');
      if (kind === 'chat') { await conversations.remove(caller, id); return { deleted: true }; }
      if (LIBRARY_KINDS.has(kind)) {
        if (!library) throw new HttpError(404, 'not_found', 'Not found.');
        return library.remove(caller, id);
      }
      const ok = await guard(() => (kind === 'photo_generated'
        ? store.deleteImage({ ...owner(caller), id })
        : store.deleteSentFile({ ...who(caller), id })));
      if (!ok) throw new HttpError(404, 'not_found', 'That item is not in your Library.');
      return { deleted: true };
    },

    // A photo or file the person sent, only for that person.
    async readSent(caller, id) {
      signedIn(caller);
      if (!UUID.test(String(id))) throw new HttpError(404, 'not_found', 'Not found.');
      const f = await guard(() => store.getSentFile({ ...who(caller), id }));
      if (!f) throw new HttpError(404, 'not_found', 'Not found.');
      return { ...f, inline: f.kind === 'photo' && INLINE.has(f.mime) };
    },

    // Keeps the photos and files sent with a message (already checked by
    // parseAttachments). Never throws and never stops the answer; what does not
    // fit (too big, or the person's space is full) is simply not kept.
    async keepSent(caller, conv, files) {
      try {
        if (caller.actor.type !== 'user' || caller.tenantId !== PLATFORM_TENANT_ID || !store.addSentFile || !files.length) return 0;
        const have = (await store.listSentFiles(who(caller))).reduce((n, f) => n + f.size, 0);
        let total = have;
        let kept = 0;
        for (const f of files) {
          const bytes = Buffer.from(f.data, 'base64');
          if (!bytes.length || bytes.length > limits.maxFileBytes || total + bytes.length > limits.maxBytes) continue;
          await store.addSentFile({
            ...who(caller), conversationId: conv.id, kind: f.kind === 'image' ? 'photo' : 'file',
            name: f.name, mime: f.mime || 'application/octet-stream', bytes
          });
          total += bytes.length;
          kept += 1;
        }
        return kept;
      } catch (err) {
        logger.warn('could not keep sent files', { error: err?.message });
        return 0;
      }
    }
  };
}
