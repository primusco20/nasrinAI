import { HttpError } from '../http/errors.js';
import { cleanUserText } from '../ai/output.js';
import { searchTerms } from './index.js';

// Memory (Phase 7): short notes a signed-in person asked Nasrin to remember.
// Saving is a 'write' tool, so the person confirms each note on a card (a web
// page or file cannot plant a memory). They see and delete notes in Settings;
// notes go with the data export and are deleted with the account.

const MAX_NOTES = 50;
const CONTEXT_CHARS = 1200;

export function memoryTools({ store }) {
  return [{
    name: 'remember',
    description: 'Save a short note about the person for future chats (their preference or fact they asked you to remember). They confirm it first.',
    risk: 'write',
    who: ['user'],
    parameters: { properties: { note: { type: 'string', maxLength: 300 } }, required: ['note'] },
    async run({ note }, ctx) {
      const text = cleanUserText(note, 300);
      if (!text) throw new Error('empty note');
      const list = await store.listMemories({ tenantId: ctx.tenantId, userId: ctx.actor.id });
      if (list.length >= MAX_NOTES) throw new Error(`at most ${MAX_NOTES} notes; delete some in Settings`);
      await store.addMemory({ tenantId: ctx.tenantId, userId: ctx.actor.id, text });
      return { ok: true, saved: text };
    }
  }];
}

export function createMemory({ store, logger }) {
  const mine = (caller) => {
    if (caller.actor.type !== 'user') throw new HttpError(403, 'forbidden', 'Sign in to use memory.');
    return { tenantId: caller.tenantId, userId: caller.actor.id };
  };
  return {
    // Notes to add to the turn: those sharing words with the message first,
    // then the newest; capped. Signed-in users only. Never throws.
    async context(caller, message) {
      if (caller.actor.type !== 'user') return null;
      try {
        const list = await store.listMemories({ tenantId: caller.tenantId, userId: caller.actor.id });
        if (!list.length) return null;
        const terms = new Set(searchTerms(message));
        const score = (m) => (searchTerms(m.text).filter((w) => terms.has(w)).length);
        const ordered = [...list].sort((a, b) => score(b) - score(a));
        const picked = [];
        let size = 0;
        for (const m of ordered) {
          if (size + m.text.length > CONTEXT_CHARS) break;
          size += m.text.length;
          picked.push('- ' + m.text);
        }
        return `\n\nNotes this person asked you to remember (use only when relevant):\n${picked.join('\n')}`;
      } catch (err) {
        logger.warn('memory read failed', { error: err.message });
        return null;
      }
    },
    async list(caller) {
      return (await store.listMemories(mine(caller))).map((m) => ({ id: m.id, text: m.text, created_at: m.createdAt }));
    },
    async remove(caller, id) {
      if (!(await store.deleteMemory({ ...mine(caller), id: String(id) }))) throw new HttpError(404, 'not_found', 'Not found.');
      return { deleted: true };
    },
    async removeAll(caller) {
      await store.deleteAllMemories(mine(caller));
      return { deleted: true };
    }
  };
}
