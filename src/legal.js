import { HttpError } from './http/errors.js';

// Terms acceptance, kept on the server (never trusted from the browser), and
// the person's data controls: export, delete all chats, delete account.
//
//   Terms of Service    must be accepted (current LEGAL_TERMS_VERSION) before a
//                       signed-in person can chat, make pictures or pay
//   Privacy Notice      shown and acknowledged with it (not a consent)
// Guests do not have accounts; the page shows them both documents' links.

export function createLegal({ store, config, logger, deleteAuthUser = null, now = () => Date.now() }) {
  const v = config.legal;
  const cache = new Map();   // user -> true once accepted (per instance)

  // The person's projects with their tasks and which chats and Library
  // items belong to them (an empty list before migration 013 is run).
  async function projectsExport(caller) {
    if (!store.listProjects) return [];
    try {
      const who = { tenantId: caller.tenantId, userId: caller.actor.id };
      const [chats, files] = await Promise.all([store.projectLinks({ ...who, kind: 'chat' }), store.projectLinks({ ...who, kind: 'file' })]);
      const out = [];
      for (const p of await store.listProjects(who)) {
        const tasks = await store.listTasks({ ...who, projectId: p.id });
        out.push({
          name: p.name, description: p.description, instructions: p.instructions, status: p.status, created_at: p.createdAt,
          tasks: tasks.map((t) => ({ text: t.text, done: t.done, created_at: t.createdAt })),
          chat_ids: Object.keys(chats).filter((k) => chats[k] === p.id),
          library_item_ids: Object.keys(files).filter((k) => files[k] === p.id)
        });
      }
      return out;
    } catch { return []; }
  }

  // The person's Library, with each item's full text (an empty list before
  // migration 012 is run).
  async function libraryExport(caller) {
    if (!store.listLibraryFiles) return [];
    try {
      const who = { tenantId: caller.tenantId, userId: caller.actor.id };
      const out = [];
      for (const f of await store.listLibraryFiles(who)) {
        const full = await store.getLibraryFile({ ...who, id: f.id });
        if (full) out.push({ id: full.id, title: full.title, kind: full.kind, format: full.format, created_at: full.createdAt, text: full.chunks.join('') });
      }
      return out;
    } catch { return []; }
  }

  async function accepted(caller) {
    if (caller.actor.type !== 'user' || !v.requireTerms) return true;
    const key = caller.tenantId + ':' + caller.actor.id + ':' + v.terms;
    if (cache.get(key)) return true;
    let ok;
    try {
      ok = await store.hasAccepted({ tenantId: caller.tenantId, userId: caller.actor.id, document: 'terms', version: v.terms });
    } catch (err) {
      // Before migration 005 there is nothing to check against: let people in, loudly.
      logger.warn('terms acceptance could not be checked', { error: err.message });
      return true;
    }
    if (ok) cache.set(key, true);
    return ok;
  }

  return {
    versions: { terms: v.terms, privacy: v.privacy },

    async status(caller) {
      return { terms_version: v.terms, privacy_version: v.privacy, accepted: await accepted(caller) };
    },

    // Throws 403 terms_required until the current Terms are accepted.
    async require(caller) {
      if (!(await accepted(caller))) {
        throw new HttpError(403, 'terms_required', 'Please accept the updated Terms of Service to continue.');
      }
    },

    async accept(caller, body) {
      if (caller.actor.type !== 'user') throw new HttpError(403, 'sign_in_required', 'Sign in first.');
      if (body.terms_version !== v.terms) throw new HttpError(409, 'terms_changed', 'The Terms have changed. Please read the current version.');
      const method = body.method === 'update_prompt' ? 'update_prompt' : 'signin';
      const base = { tenantId: caller.tenantId, userId: caller.actor.id, method };
      await store.recordAcceptance({ ...base, document: 'terms', version: v.terms, action: 'accepted' });
      await store.recordAcceptance({ ...base, document: 'privacy', version: v.privacy, action: 'acknowledged' });
      cache.set(caller.tenantId + ':' + caller.actor.id + ':' + v.terms, true);
      return { accepted: true, terms_version: v.terms };
    },

    // Everything NasrinAI keeps about the signed-in person, as JSON.
    async export(caller, conversations) {
      if (caller.actor.type !== 'user') throw new HttpError(403, 'sign_in_required', 'Sign in to export your data.');
      const list = await conversations.list(caller, 100);
      const chats = [];
      for (const c of list) {
        const conv = await conversations.get(caller, c.id);
        const messages = (await conversations.history(conv, 200)).map((m) => ({ role: m.role, content: m.content, created_at: m.createdAt }));
        chats.push({ id: c.id, title: c.title, created_at: c.createdAt, messages });
      }
      return {
        exported_at: new Date(now()).toISOString(),
        account: { id: caller.actor.id },
        conversations: chats,
        memories: (await (store.listMemories ? store.listMemories({ tenantId: caller.tenantId, userId: caller.actor.id }) : []).catch(() => [])).map((m) => ({ text: m.text, created_at: m.createdAt })),
        library: await libraryExport(caller),
        projects: await projectsExport(caller),
        plan_payments: await store.listPlanPeriods({ tenantId: caller.tenantId, userId: caller.actor.id }).catch(() => []),
        legal_acceptances: await store.listAcceptances({ tenantId: caller.tenantId, userId: caller.actor.id }).catch(() => [])
      };
    },

    async deleteAllChats(caller) {
      await store.deleteConversationsOf({ tenantId: caller.tenantId, ownerType: caller.actor.type, ownerId: caller.actor.id });
      return { deleted: true };
    },

    // Deletes the account: chats and pictures, the sign-in account itself, and
    // the user id from usage numbers. Payment and acceptance records are kept
    // (see the retention schedule).
    async deleteAccount(caller, body) {
      if (caller.actor.type !== 'user') throw new HttpError(403, 'sign_in_required', 'Sign in first.');
      if (body.confirm !== 'DELETE') throw new HttpError(400, 'confirm_required', 'Type DELETE to confirm.');
      if (!store.deleteImprovementExamplesForSubject) {
        throw new HttpError(503, 'deletion_unavailable', 'Account deletion is temporarily unavailable because linked improvement data could not be verified. Please retry or contact support.');
      }
      // Remove contributed examples before deleting the account identity needed to find them.
      // If this fails, stop here so the user can retry rather than orphaning the examples.
      await store.deleteImprovementExamplesForSubject({
        tenantId: caller.tenantId, subjectType: 'user', subjectId: caller.actor.id, reasonCode: 'account_deletion'
      });
      await store.deleteUserData({ tenantId: caller.tenantId, userId: caller.actor.id });
      if (deleteAuthUser) await deleteAuthUser(caller.actor.id);
      logger.info('account deleted', { tenantId: caller.tenantId });
      return { deleted: true };
    }
  };
}
