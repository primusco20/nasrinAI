import { issueGuestToken, newGuestId } from './auth/guest.js';
import { publicConversation, publicMessage } from './conversations.js';
import { HttpError } from './http/errors.js';
import { authRoutes } from './auth/routes.js';
import { paymentRoutes } from './payments/routes.js';
import { manilaDayStart } from './limits.js';
import { publicCatalog } from './ai/professions.js';

// The public API. Each route is either explicitly public or requires a caller.
export function buildRoutes({ config, gateway, store = null, limiter, conversations, chat, provider = null, models, voice = null, auth = null, plans = null, payments = null, images = null, legal = null, connectors = null, confirmations = null, facebook = null, hooks = [], knowledge = null, memory = null, settings = null, logger = null, now = () => Date.now() }) {
  // Is anything able to answer? The router checks an own model at most every
  // 30 seconds, however often the page asks.
  async function modelReady() {
    if (!provider) return false;
    try { return await provider.healthCheck(); } catch { return false; }
  }

  return [
    {
      // Reads one of Nasrin's replies aloud, or previews a voice.
      // Body: { voice, message_id } or { voice, preview: true }. Answers MP3 audio.
      method: 'POST',
      path: '/v1/speech',
      scope: 'chat',
      body: true,
      handler: async ({ caller, body, ip, res }) => {
        if (!voice) throw new HttpError(503, 'speech_unavailable', 'Voice replies are not available right now.');
        const { audio, parts } = await voice.speak(caller, body, ip);
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'private, max-age=3600', 'X-Speech-Parts': String(parts) });
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
        return { body: { prefs: await settings.update(caller, token, body) } };
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
      handler: async ({ caller, body, ip }) => ({ body: await chat(caller, body, ip) })
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
      handler: async ({ caller }) => ({ body: { conversations: (await conversations.list(caller, 50)).map(publicConversation) } })
    },
    {
      method: 'GET',
      path: '/v1/conversations/:id/messages',
      scope: 'chat',
      handler: async ({ caller, params }) => {
        const conv = await conversations.get(caller, params.id);
        return { body: { conversation: publicConversation(conv), messages: (await conversations.history(conv, 100)).map(publicMessage) } };
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
