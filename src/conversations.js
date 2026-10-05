import { notFound } from './http/errors.js';
import { UUID } from './tenants.js';

// Conversations belong to exactly one caller: same tenant, same actor type,
// same actor id. Anyone else gets "not found", so ids cannot be probed.
// History is read from here by the server; the browser never supplies it
// (audit finding M1).

export const owns = (caller, conv) =>
  Boolean(conv)
  && conv.tenantId === caller.tenantId
  && conv.ownerType === caller.actor.type
  && conv.ownerId === caller.actor.id;

export const publicConversation = (c) => ({ id: c.id, title: c.title, created_at: c.createdAt, updated_at: c.updatedAt });
export const publicMessage = (m) => ({ id: m.id, role: m.role, content: m.content, created_at: m.createdAt });

export function createConversations({ store, config, logger, now = () => Date.now() }) {
  let lastPurge = 0;

  // Expired guest conversations are deleted now and then (at most hourly per
  // server instance), in the background.
  function maybePurge() {
    if (now() - lastPurge < 3600_000) return;
    lastPurge = now();
    store.purgeExpired().catch((err) => logger.warn('purge of expired conversations failed', { error: err.message }));
  }

  return {
    async create(caller) {
      maybePurge();
      const expiresAt = caller.actor.type === 'guest' ? new Date(now() + config.guestTtlSeconds * 1000).toISOString() : null;
      return store.createConversation({ tenantId: caller.tenantId, ownerType: caller.actor.type, ownerId: caller.actor.id, expiresAt });
    },

    // The conversation, if this caller owns it; otherwise a 404.
    async get(caller, id) {
      if (!UUID.test(String(id))) throw notFound();
      const conv = await store.getConversation(id);
      if (!owns(caller, conv)) throw notFound();
      return conv;
    },

    list(caller) {
      return store.listConversations({ tenantId: caller.tenantId, ownerType: caller.actor.type, ownerId: caller.actor.id, limit: 20 });
    },

    history(conv, limit = 50) {
      return store.listMessages(conv.id, limit);
    },

    add(conv, role, content) {
      return store.addMessage({ conversationId: conv.id, tenantId: conv.tenantId, role, content });
    },

    setTitle(conv, title) {
      return store.setConversationTitle(conv.id, title);
    },

    // One message, if this caller owns its conversation; otherwise a 404.
    async message(caller, id) {
      if (!UUID.test(String(id))) throw notFound();
      const msg = await store.getMessage(id);
      if (!msg) throw notFound();
      await this.get(caller, msg.conversationId);
      return msg;
    },

    async remove(caller, id) {
      const conv = await this.get(caller, id);
      await store.deleteConversation(conv.id);
    }
  };
}
