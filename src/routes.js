import { issueGuestToken, newGuestId } from './auth/guest.js';
import { publicConversation, publicMessage } from './conversations.js';
import { HttpError } from './http/errors.js';
import { authRoutes } from './auth/routes.js';
import { paymentRoutes } from './payments/routes.js';
import { manilaDayStart } from './limits.js';
import { publicCatalog } from './ai/professions.js';
import { createNotices, WHENS } from './notices.js';

// The public API. Each route is either explicitly public or requires a caller.
export function buildRoutes({ config, gateway, store = null, limiter, conversations, chat, provider = null, models, voice = null, auth = null, plans = null, payments = null, images = null, legal = null, connectors = null, confirmations = null, facebook = null, hooks = [], knowledge = null, memory = null, settings = null, notices = null, library = null, projects = null, storage = null, logger = null, now = () => Date.now() }) {
  // Is anything able to answer? The router checks an own model at most every
  // 30 seconds, however often the page asks.
  async function modelReady() {
    if (!provider) return false;
    try { return await provider.healthCheck(); } catch { return false; }
  }

  notices = notices || createNotices({ plans, config, now });
  // Which moment the page asks about: ?when=open (default) or ?when=new_chat.
  const retentionAuthorized = (req) => {
    const expected = config.retentionCronSecret;
    const auth = String(req.headers.authorization || '');
    return Boolean(expected) && auth === 'Bearer ' + expected;
  };

  const noticeWhen = (req) => {
    const w = new URL(req.url, 'http://local').searchParams.get('when') || 'open';
    if (!WHENS.includes(w) || w === 'both') throw new HttpError(400, 'invalid_notice', 'Ask for open or new_chat.');
    return w;
  };

  const connectRoutes = connect ? [
    {
      method: 'GET',
      path: '/v1/connect/sites',
      scope: 'connectors',
      handler: async ({ caller }) => ({ body: { sites: await connect.list(caller) } })
    },
    {
      method: 'POST',
      path: '/v1/connect/sites/analyze',
      scope: 'connectors',
      body: true,
      handler: async ({ caller, body }) => {
        const siteUrl = body && typeof body.url === 'string' ? body.url : '';
        if (!siteUrl) throw new HttpError(400, 'invalid_url', 'Enter your website address.');
        return { status: 201, body: { site: await connect.analyzeAndCreate(caller, siteUrl) } };
      }
    },
    {
      method: 'GET',
      path: '/v1/connect/sites/:id',
      scope: 'connectors',
      handler: async ({ caller, params }) => {
        const site = await connect.get(caller, params.id);
        if (!site) throw new HttpError(404, 'not_found', 'Connect site not found.');
        return { body: { site } };
      }
    },
    {
      method: 'DELETE',
      path: '/v1/connect/sites/:id',
      scope: 'connectors',
      handler: async ({ caller, params }) => {
        const ok = await connect.remove(caller, params.id);
        if (!ok) throw new HttpError(404, 'not_found', 'Connect site not found.');
        return { body: { removed: true } };
      }
    }
  ] : [];

  return [...connectRoutes,
    {
      // Vercel Cron: automatic retention enforcement for inactive users.
      // This route is public at the HTTP layer but protected by CRON_SECRET.
      method: 'GET',
      path: '/v1/internal/retention',
      public: true,
      handler: async ({ req }) => {
        if (!retentionAuthorized(req)) throw new HttpError(401, 'unauthorized', 'Unauthorized.');
        if (!store?.purgeRetention) throw new HttpError(503, 'retention_unavailable', 'Retention cleanup is not configured.');
        await store.purgeRetention();
        return { body: { ok: true } };
      }
    },
    {
      // Reads one of Nasrin's replies aloud, or previews a voice.
      // Body: { voice, message_id } or { voice, preview: true }. Answers audio (MP3 for OpenAI, WAV for Gemini).
      method: 'POST',
      path: '/v1/speech',
      scope: 'chat',
      body: true,
      handler: async ({ caller, body, ip, res }) => {
        if (!voice) throw new HttpError(503, 'speech_unavailable', 'Voice replies are not available right now.');
        const { audio, parts } = await voice.speak(caller, body, ip);
        res.writeHead(200, { 'Content-Type': voice.mime || 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'private, max-age=3600', 'X-Speech-Parts': String(parts) });
        res.end(audio);
      }
    },
    {
      // Which Terms / Privacy Notice versions are current, and whether this
      // signed-in person has accepted them.
      method: 'GET',
      path: '/v1/legal',
      scope: 'chat',
      handler: async ({ caller }) => ({ body: legal ? await legal.status(caller) : { accepted: true } })
    },
    {
      // Records acceptance of the current Terms (and that the Privacy Notice was shown).
      method: 'POST',
      path: '/v1/legal/accept',
      scope: 'chat',
      body: true,
      handler: async ({ caller, body }) => ({ body: await legal.accept(caller, body) })
    },
    {
      // Everything kept about the signed-in person, as a JSON file.
      method: 'GET',
      path: '/v1/account/export',
      scope: 'chat',
      handler: async ({ caller, res }) => {
        const data = await legal.export(caller, conversations);
        const json = JSON.stringify(data, null, 2);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="nasrinai-my-data.json"', 'Cache-Control': 'no-store' });
        res.end(json);
      }
    },
    {
      // Deletes the account and its chats. Body: { confirm: "DELETE" }.
      method: 'POST',
      path: '/v1/account/delete',
      scope: 'chat',
      body: true,
      handler: async ({ caller, body, res }) => {
        const out = await legal.deleteAccount(caller, body);
        res.appendHeader('Set-Cookie', 'nasrin_rt=; Path=/v1/auth; Max-Age=0; HttpOnly; Secure; SameSite=Strict');
        return { body: out };
      }
    },
    {
      // Professional AI: the professions and groups the page can offer
      // (names and short descriptions only; the instructions stay on the server).
      method: 'GET',
      path: '/v1/professionals',
      public: true,
      handler: async () => ({ body: config.professional?.enabled === false ? { enabled: false, groups: [], professions: [] } : { enabled: true, ...publicCatalog() } })
    },
    {
      // Projects (src/projects.js): the signed-in person's own workspaces.
      method: 'GET',
      path: '/v1/projects',
      scope: 'chat',
      handler: async ({ caller }) => {
        if (!projects) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await projects.list(caller) };
      }
    },
    {
      // Body: { name, description?, instructions?, status? }.
      method: 'POST',
      path: '/v1/projects',
      scope: 'chat',
      body: true,
      handler: async ({ caller, body }) => {
        if (!projects) throw new HttpError(404, 'not_found', 'Not found.');
        return { status: 201, body: await projects.create(caller, body) };
      }
    },
    {
      // Puts a chat or Library item into a project, or takes it out.
      // Body: { kind: chat|file, id, project_id (null: out) }.
      method: 'POST',
      path: '/v1/project-links',
      scope: 'chat',
      body: true,
      handler: async ({ caller, body }) => {
        if (!projects) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await projects.move(caller, body) };
      }
    },
    {
      method: 'GET',
      path: '/v1/projects/:id',
      scope: 'chat',
      handler: async ({ caller, params }) => {
        if (!projects) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await projects.get(caller, params.id) };
      }
    },
    {
      method: 'PUT',
      path: '/v1/projects/:id',
      scope: 'chat',
      body: true,
      handler: async ({ caller, params, body }) => {
        if (!projects) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await projects.update(caller, params.id, body) };
      }
    },
    {
      method: 'DELETE',
      path: '/v1/projects/:id',
      scope: 'chat',
      handler: async ({ caller, params }) => {
        if (!projects) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await projects.remove(caller, params.id) };
      }
    },
    {
      method: 'POST',
      path: '/v1/projects/:id/tasks',
      scope: 'chat',
      body: true,
      handler: async ({ caller, params, body }) => {
        if (!projects) throw new HttpError(404, 'not_found', 'Not found.');
        return { status: 201, body: await projects.addTask(caller, params.id, body) };
      }
    },
    {
      method: 'PUT',
      path: '/v1/projects/:id/tasks/:taskId',
      scope: 'chat',
      body: true,
      handler: async ({ caller, params, body }) => {
        if (!projects) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await projects.updateTask(caller, params.id, params.taskId, body) };
      }
    },
    {
      method: 'DELETE',
      path: '/v1/projects/:id/tasks/:taskId',
      scope: 'chat',
      handler: async ({ caller, params }) => {
        if (!projects) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await projects.deleteTask(caller, params.id, params.taskId) };
      }
    },
    {
      // The Library: the signed-in person's own documents (src/library.js).
      method: 'GET',
      path: '/v1/library',
      scope: 'chat',
      handler: async ({ caller, req }) => {
        if (!library) throw new HttpError(404, 'not_found', 'Not found.');
        const out = await library.list(caller, new URL(req.url, 'http://local').searchParams.get('q'));
        const links = projects ? await projects.links(caller, 'file') : {};
        return { body: { ...out, files: out.files.map((f) => ({ ...f, project_id: links[f.id] || null })) } };
      }
    },
    {
      method: 'GET',
      path: '/v1/library/:id',
      scope: 'chat',
      handler: async ({ caller, params }) => {
        if (!library) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await library.get(caller, params.id) };
      }
    },
    {
      // Body: { title, text, kind?, format? }. Text only (the page reads the file).
      method: 'POST',
      path: '/v1/library',
      scope: 'chat',
      body: true,
      maxBody: 1_000_000,
      handler: async ({ caller, body }) => {
        if (!library) throw new HttpError(404, 'not_found', 'Not found.');
        // Added straight into one of the person's projects (checked first).
        const pid = body && body.project_id !== undefined && body.project_id !== null ? body.project_id : null;
        if (pid !== null && !projects) throw new HttpError(404, 'not_found', 'That project was not found.');
        if (pid !== null) await projects.require(caller, pid);
        const added = await library.add(caller, body);
        if (pid !== null) await projects.linkFile(caller, pid, added.id);
        return { status: 201, body: { ...added, project_id: pid } };
      }
    },
    {
      // Storage (the Library tab): everything the signed-in person keeps, how much, and for how long.
      method: 'GET',
      path: '/v1/storage',
      scope: 'chat',
      handler: async ({ caller }) => {
        if (!storage) throw new HttpError(404, 'not_found', 'Not found.');
        const out = await storage.list(caller);
        const chatLinks = projects ? await projects.links(caller, 'chat').catch(() => ({})) : {};
        const fileLinks = projects ? await projects.links(caller, 'file').catch(() => ({})) : {};
        const link = (i) => (i.kind === 'chat' ? chatLinks[i.id] : i.kind === 'file' ? fileLinks[i.id] : undefined);
        return { body: { ...out, items: out.items.map((i) => (link(i) !== undefined || i.kind === 'chat' || i.kind === 'file' ? { ...i, project_id: link(i) || null } : i)) } };
      }
    },
    {
      // A photo or file the person sent, only for that person. Photos show inline; anything else only downloads.
      method: 'GET',
      path: '/v1/storage/sent/:id',
      scope: 'chat',
      handler: async ({ caller, params, res }) => {
        if (!storage) throw new HttpError(404, 'not_found', 'Not found.');
        const f = await storage.readSent(caller, params.id);
        const name = String(f.name).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 100) || 'file';
        res.writeHead(200, {
          'Content-Type': f.inline ? f.mime : 'application/octet-stream',
          'Content-Length': f.bytes.length,
          'Cache-Control': 'private, max-age=3600',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Content-Disposition': `${f.inline ? 'inline' : 'attachment'}; filename="${name}"`
        });
        res.end(f.bytes);
      }
    },
    {
      // Deletes one stored item. kind: chat, file, note, reply, photo_sent, file_sent, photo_generated.
      method: 'DELETE',
      path: '/v1/storage/:kind/:id',
      scope: 'chat',
      handler: async ({ caller, params }) => {
        if (!storage) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await storage.remove(caller, params.kind, params.id) };
      }
    },
    {
      method: 'DELETE',
      path: '/v1/library/:id',
      scope: 'chat',
      handler: async ({ caller, params }) => {
        if (!library) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await library.remove(caller, params.id) };
      }
    },
    {
      // In-app notices for everyone (config/notices.json). Guests hide the
      // ones they closed on their device.
      method: 'GET',
      path: '/v1/notices',
      public: true,
      handler: async ({ req }) => ({ body: { notices: notices.general(noticeWhen(req)) } })
    },
    {
      // A signed-in person's notices: their choices and closed ones applied,
      // plus their own (plan ending soon).
      method: 'GET',
      path: '/v1/notices/mine',
      scope: 'chat',
      handler: async ({ caller, req }) => {
        const when = noticeWhen(req);
        if (caller.actor.type === 'service') throw new HttpError(403, 'forbidden', 'Notices are shown to people in the app.');
        return { body: { notices: caller.actor.type === 'user' ? await notices.forUser(caller, when) : notices.general(when) } };
      }
    },
    {
      // The person closed a notice: it is not shown to them again.
      method: 'POST',
      path: '/v1/notices/:id/dismiss',
      scope: 'chat',
      handler: async ({ caller, params, req }) => {
        if (caller.actor.type !== 'user') throw new HttpError(403, 'sign_in_required', 'Sign in to keep this choice.');
        if (!settings) throw new HttpError(503, 'settings_unavailable', 'These settings are not available right now.');
        const token = String(req.headers.authorization || '').slice(7).trim();
        await settings.dismiss(caller, token, params.id);
        return { body: { dismissed: params.id } };
      }
    },
    {
      // Settings > Usage: the caller's own numbers, read from the same counters
      // the limits are enforced with (the server stays the source of truth).
      method: 'GET',
      path: '/v1/usage',
      scope: 'chat',
      handler: async ({ caller }) => {
        const { type, id } = caller.actor;
        if (type === 'service') throw new HttpError(403, 'forbidden', 'Usage is shown to people in the app.');
        const dayStart = manilaDayStart(now()).getTime();
        const resets = new Date(dayStart + 24 * 3600 * 1000).toISOString();
        const limits = config.limits;
        const out = { plan: null, resets_at: resets, chat: null, pictures: null, hourly: null };
        if (type === 'user') {
          if (plans) {
            const p = await plans.current(caller);
            out.plan = p.open ? null : { id: p.plan, ends_at: p.endsAt };
          }
          const used = await store.tokensSince({ since: new Date(dayStart), tenantId: caller.tenantId, actorType: 'user', actorId: id });
          out.chat = { used: Math.min(used, limits.userDailyTokens), limit: limits.userDailyTokens, unit: 'tokens', period: 'day' };
          out.hourly = { messages: limits.userMessagesHour, read_aloud: limits.userSpeechHour };
        } else {
          out.hourly = { messages: limits.guestMessagesHour, read_aloud: limits.guestSpeechHour };
        }
        if (images && images.available) out.pictures = await images.usage(caller);
        return { body: out };
      }
    },
    {
      // Settings > Billing: the caller's plan and their own plan payments.
      // Only what PayMongo told us is stored: plan, dates, amount. No card data.
      method: 'GET',
      path: '/v1/billing',
      scope: 'chat',
      handler: async ({ caller }) => {
        if (caller.actor.type !== 'user') throw new HttpError(403, 'sign_in_required', 'Sign in to see billing.');
        if (!plans || !config.plans.enabled) return { body: { enabled: false, plan: null, payments: [] } };
        const p = await plans.current(caller);
        const rows = await store.listPlanPeriods({ tenantId: caller.tenantId, userId: caller.actor.id });
        const payments = rows.map((r) => ({
          plan: r.plan, starts_at: r.starts_at, ends_at: r.ends_at,
          amount: Number.isInteger(r.amount) ? r.amount / 100 : null, currency: r.currency || null,
          paid_at: r.created_at || r.starts_at, via: r.provider === 'paymongo' ? 'PayMongo' : null
        })).reverse();
        return { body: { enabled: true, plan: { id: p.plan, ends_at: p.endsAt }, payments } };
      }
    },
    {
      // Settings > Privacy: the signed-in person's own preferences.
      method: 'GET',
      path: '/v1/settings',
      scope: 'chat',
      handler: async ({ caller }) => {
        if (!settings) throw new HttpError(503, 'settings_unavailable', 'These settings are not available right now.');
        return { body: { prefs: settings.get(caller) } };
      }
    },
    {
      method: 'PUT',
      path: '/v1/settings',
      scope: 'chat',
      body: true,
      handler: async ({ caller, body, req }) => {
        if (!settings) throw new HttpError(503, 'settings_unavailable', 'These settings are not available right now.');
        const token = String(req.headers.authorization || '').slice(7).trim();
        const prefs = await settings.update(caller, token, body);
        // A new keep-time takes effect straight away.
        if (storage && body && typeof body === 'object' && 'retention' in body) await storage.sweep({ ...caller, prefs }, { force: true });
        return { body: { prefs } };
      }
    },
    {
      // Deletes all of the caller's conversations (and their pictures).
      method: 'DELETE',
      path: '/v1/conversations',
      scope: 'chat',
      handler: async ({ caller }) => ({ body: await legal.deleteAllChats(caller) })
    },
    {
      // A business's knowledge documents (Phase 7): its secret key with the 'knowledge' scope.
      method: 'GET',
      path: '/v1/knowledge',
      scope: 'knowledge',
      handler: async ({ caller }) => {
        if (!knowledge) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: { documents: await knowledge.manage.list(caller) } };
      }
    },
    {
      method: 'POST',
      path: '/v1/knowledge',
      scope: 'knowledge',
      body: true,
      maxBody: 512 * 1024,
      handler: async ({ caller, body }) => {
        if (!knowledge) throw new HttpError(404, 'not_found', 'Not found.');
        return { status: 201, body: { document: await knowledge.manage.add(caller, body) } };
      }
    },
    {
      method: 'DELETE',
      path: '/v1/knowledge/:id',
      scope: 'knowledge',
      handler: async ({ caller, params }) => {
        if (!knowledge) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await knowledge.manage.remove(caller, params.id) };
      }
    },
    {
      // What Nasrin remembers about the signed-in person.
      method: 'GET',
      path: '/v1/memories',
      scope: 'chat',
      handler: async ({ caller }) => {
        if (!memory) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: { memories: await memory.list(caller) } };
      }
    },
    {
      method: 'DELETE',
      path: '/v1/memories',
      scope: 'chat',
      handler: async ({ caller }) => {
        if (!memory) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await memory.removeAll(caller) };
      }
    },
    {
      // Edit a note. Body: { text }.
      method: 'PUT',
      path: '/v1/memories/:id',
      scope: 'chat',
      body: true,
      handler: async ({ caller, params, body }) => {
        if (!memory) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await memory.update(caller, params.id, body.text) };
      }
    },
    {
      method: 'DELETE',
      path: '/v1/memories/:id',
      scope: 'chat',
      handler: async ({ caller, params }) => {
        if (!memory) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await memory.remove(caller, params.id) };
      }
    },
    {
      // The person confirms or cancels an action the model proposed. Body: { token }.
      method: 'POST',
      path: '/v1/actions/confirm',
      scope: 'chat',
      body: true,
      handler: async ({ caller, body, ip }) => {
        if (!confirmations) throw new HttpError(404, 'not_found', 'Not found.');
        await limiter.message(caller, ip);
        return { body: await confirmations.confirm(caller, body.token) };
      }
    },
    {
      method: 'POST',
      path: '/v1/actions/cancel',
      scope: 'chat',
      body: true,
      handler: async ({ caller, body }) => {
        if (!confirmations) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await confirmations.cancel(caller, body.token) };
      }
    },
    {
      // A business's Facebook Pages (Messenger): its secret key with the 'connectors' scope.
      method: 'GET',
      path: '/v1/channels/facebook',
      scope: 'connectors',
      handler: async ({ caller }) => {
        if (!facebook) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: { pages: await facebook.manage.list(caller) } };
      }
    },
    {
      method: 'PUT',
      path: '/v1/channels/facebook',
      scope: 'connectors',
      body: true,
      handler: async ({ caller, body }) => {
        if (!facebook) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: { page: await facebook.manage.put(caller, body) } };
      }
    },
    {
      method: 'DELETE',
      path: '/v1/channels/facebook/:page_id',
      scope: 'connectors',
      handler: async ({ caller, params }) => {
        if (!facebook) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await facebook.manage.remove(caller, params.page_id) };
      }
    },
    {
      // A business's connectors (Phase 6): its secret key with the 'connectors' scope.
      method: 'GET',
      path: '/v1/connectors',
      scope: 'connectors',
      handler: async ({ caller }) => {
        if (!connectors) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: { connectors: await connectors.list(caller) } };
      }
    },
    {
      method: 'PUT',
      path: '/v1/connectors/:name',
      scope: 'connectors',
      body: true,
      handler: async ({ caller, params, body }) => {
        if (!connectors) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: { connector: await connectors.put(caller, params.name, body) } };
      }
    },
    {
      // A connector's webhook: POST turns it on (new secret, shown once), DELETE off.
      method: 'POST',
      path: '/v1/connectors/:name/webhook',
      scope: 'connectors',
      handler: async ({ caller, params }) => {
        if (!connectors) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await connectors.webhook(caller, params.name, true) };
      }
    },
    {
      method: 'DELETE',
      path: '/v1/connectors/:name/webhook',
      scope: 'connectors',
      handler: async ({ caller, params }) => {
        if (!connectors) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await connectors.webhook(caller, params.name, false) };
      }
    },
    {
      method: 'DELETE',
      path: '/v1/connectors/:name',
      scope: 'connectors',
      handler: async ({ caller, params }) => {
        if (!connectors) throw new HttpError(404, 'not_found', 'Not found.');
        return { body: await connectors.remove(caller, params.name) };
      }
    },
    {
      // Plans a picture: adaptive questions, then the creative brief.
      // Body: { prompt, photo?, answers? }.
      method: 'POST',
      path: '/v1/images/brief',
      scope: 'chat',
      body: true,
      maxBody: Math.ceil(config.ai.attachments.maxTotalBytes * 1.37) + 64 * 1024,
      handler: async ({ caller, body, ip }) => {
        if (!images) throw new HttpError(503, 'images_unavailable', 'Picture creation is not available yet.');
        return { body: await images.brief(caller, body, ip) };
      }
    },
    {
      // Makes one picture. Body: { prompt, photo?, brief?, conversation_id? }.
      method: 'POST',
      path: '/v1/images',
      scope: 'chat',
      body: true,
      maxBody: Math.ceil(config.ai.attachments.maxTotalBytes * 1.37) + 64 * 1024,
      handler: async ({ caller, body, ip }) => {
        if (!images) throw new HttpError(503, 'images_unavailable', 'Picture creation is not available yet.');
        return { body: await images.create(caller, body, ip) };
      }
    },
    {
      // A picture, only for the person who made it.
      method: 'GET',
      path: '/v1/images/:id',
      scope: 'chat',
      handler: async ({ caller, params, res }) => {
        if (!images) throw new HttpError(404, 'not_found', 'Not found.');
        const img = await images.read(caller, params.id);
        res.writeHead(200, { 'Content-Type': img.mime, 'Content-Length': img.bytes.length, 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': `inline; filename="nasrin-${params.id.slice(0, 8)}.${img.mime.split('/')[1]}"` });
        res.end(img.bytes);
      }
    },
    {
      // The plans (Free, Max, Ultra), their prices, and the caller's plan.
      method: 'GET',
      path: '/v1/plans',
      scope: 'chat',
      handler: async ({ caller }) => {
        if (!plans) return { body: { enabled: false, current: null, ends_at: null, plans: [] } };
        return { body: await plans.describe(caller, { purchasable: Boolean(payments) && caller.actor.type === 'user' }) };
      }
    },
    {
      // The models this caller may choose, and the default.
      method: 'GET',
      path: '/v1/models',
      scope: 'chat',
      handler: async ({ caller }) => {
        // Guests also see the tiers that need sign-in, marked locked, when sign-in exists.
        const signIn = Boolean(auth) && (config.auth.email || config.auth.google);
        const plan = plans ? await plans.planFor(caller) : 'ultra';
        const list = models ? await models.listFor(caller, { showLocked: signIn || (plans && config.plans.enabled), plan }) : { models: [], default: null };
        return { body: { models: list.models, default: list.default } };
      }
    },
    {
      // What the chat page needs to tell people honestly: is the AI on, and
      // does a message leave this server to reach it? Nothing more.
      method: 'GET',
      path: '/v1/status',
      public: true,
      handler: async () => ({
        body: {
          ai_available: await modelReady(),
          external_model: provider ? provider.capabilities().dataLeavesServer : null,
          own_model: provider ? provider.capabilities().local === true && provider.id !== 'fake' : null,
          redacts_contact_details: Boolean(provider && provider.capabilities().dataLeavesServer && config.ai.redactExternal),
          // Which files the model can read. Text files always work.
          files: {
            photos: Boolean(provider) && provider.capabilities().vision !== false,
            pdfs: Boolean(provider) && provider.capabilities().pdf !== false
          },
          legal: { terms_version: config.legal.terms, privacy_version: config.legal.privacy },
          plans: Boolean(plans) && config.plans.enabled,
          library: Boolean(library) && config.library?.enabled === true,
          projects: Boolean(projects) && config.projects?.enabled === true,
          images: images && images.available ? { available: true, per_guest: config.images.perGuest, per_user_day: config.images.perUserDay } : { available: false },
          sign_in: { email: Boolean(auth) && config.auth.email, google: Boolean(auth) && config.auth.google },
          guest_session_hours: Math.round(config.guestTtlSeconds / 3600),
          speech: voice && voice.available
            ? { available: true, voices: voice.voices, default: voice.defaultVoice, rate: config.ai.speech.rate }
            : { available: false, voices: [], default: null, rate: config.ai.speech.rate }
        }
      })
    },
    {
      // One chat turn. Body: { message, conversation_id?, model?, attachments? }.
      // Without conversation_id a new conversation is started.
      method: 'POST',
      path: '/v1/chat',
      scope: 'chat',
      body: true,
      // room for attachments (base64) plus the message
      maxBody: Math.ceil(config.ai.attachments.maxTotalBytes * 4 / 3) + 64 * 1024,
      // With { stream: true } the answer comes as lines of JSON (NDJSON) while it
      // is written: { type: 'start', conversation_id, user_message_id } once the
      // message is saved, { type: 'delta', text } pieces, { type: 'reset' } when another
      // model takes over, { type: 'audio', seq, mime, data } spoken sentences (only on a
      // voice turn with `speak_voice`), then { type: 'done', ...the usual reply, audio? } or
      // { type: 'error', error }. Problems found before the model starts (checks,
      // limits, plan) are normal JSON errors. Closing the connection stops the reply.
      handler: async ({ caller, body, ip, res, requestId }) => {
        if (body.stream !== true) return { body: await chat(caller, body, ip) };
        const stop = new AbortController();
        res.on('close', () => { if (!res.writableEnded) stop.abort(); });
        let started = false;
        const send = (event) => {
          if (res.destroyed || res.writableEnded) return;
          if (!started) {
            started = true;
            res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
          }
          res.write(JSON.stringify(event) + '\n');
        };
        // A hands-free voice turn with a natural voice ({ voice: true, speak_voice }):
        // each sentence is also spoken as it is written, and sent as { type: 'audio' }.
        const speaker = voice && typeof voice.live === 'function' && body.voice === true && typeof body.speak_voice === 'string'
          ? voice.live(caller, ip, body.speak_voice, send)
          : null;
        try {
          const out = await chat(caller, body, ip, { stream: {
            start: (info) => send({ type: 'start', ...info }),
            onText: (text) => { send({ type: 'delta', text }); speaker?.push(text); },
            reset: () => { speaker?.reset(); send({ type: 'reset' }); }
          }, signal: stop.signal });
          const audio = speaker && !stop.signal.aborted ? await speaker.finish() : null;
          send({ type: 'done', ...out, ...(audio ? { audio } : {}) });
        } catch (err) {
          speaker?.cancel();
          if (!started) throw err;
          const known = err instanceof HttpError;
          if (!known && logger) logger.error('streamed reply failed', { requestId, error: err?.message });
          send({ type: 'error', error: known
            ? { code: err.code, message: err.message }
            : { code: 'internal', message: 'NasrinAI could not finish that reply. Please try again.' } });
        }
        if (!res.writableEnded && !res.destroyed) res.end();
      }
    },
    {
      method: 'POST',
      path: '/v1/conversations',
      scope: 'chat',
      handler: async ({ caller }) => ({ status: 201, body: { conversation: publicConversation(await conversations.create(caller)) } })
    },
    {
      method: 'GET',
      path: '/v1/conversations',
      scope: 'chat',
      handler: async ({ caller }) => {
        if (storage) await storage.sweep(caller);
        const links = projects ? await projects.links(caller, 'chat') : {};
        return { body: { conversations: (await conversations.list(caller, 50)).map((c) => ({ ...publicConversation(c), project_id: links[c.id] || null })) } };
      }
    },
    {
      method: 'GET',
      path: '/v1/conversations/:id/messages',
      scope: 'chat',
      handler: async ({ caller, params }) => {
        const conv = await conversations.get(caller, params.id);
        const project = projects ? await projects.forChat(caller, conv.id) : null;
        return { body: { conversation: publicConversation(conv), project: project ? { id: project.id, name: project.name } : null, messages: (await conversations.history(conv, 100)).map(publicMessage) } };
      }
    },
    {
      method: 'DELETE',
      path: '/v1/conversations/:id',
      scope: 'chat',
      handler: async ({ caller, params, res }) => {
        await conversations.remove(caller, params.id);
        res.statusCode = 204;
        res.end();
      }
    },
    {
      // Starts a guest session. No key: a NasrinAI platform guest.
      // With a publishable key (X-NasrinAI-Key) from a listed website: a guest
      // of that business. The guest can chat, nothing more.
      method: 'POST',
      path: '/v1/guest/sessions',
      public: true,
      handler: async ({ req, ip }) => {
        await limiter.guestSession(ip);
        const tenantId = await gateway.guestTenantFor(req);
        const { token, expiresAt } = issueGuestToken({
          secret: config.guestSecret, tenantId, guestId: newGuestId(), ttlSeconds: config.guestTtlSeconds
        });
        return { status: 201, body: { token, expires_at: expiresAt, tenant_id: tenantId } };
      }
    },
    {
      // Who am I? Shows only the caller's own type, business and scopes.
      method: 'GET',
      path: '/v1/whoami',
      handler: async ({ caller }) => ({
        body: { actor_type: caller.actor.type, tenant_id: caller.tenantId, scopes: caller.scopes }
      })
    }
  ].concat(authRoutes({ config, auth, limiter, logger }), paymentRoutes({ config, payments, plans, store, limiter, legal, logger }), facebook ? facebook.routes : [], hooks);
}
