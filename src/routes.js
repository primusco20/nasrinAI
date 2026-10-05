import { issueGuestToken, newGuestId } from './auth/guest.js';
import { publicConversation, publicMessage } from './conversations.js';
import { HttpError } from './http/errors.js';
import { authRoutes } from './auth/routes.js';
import { paymentRoutes } from './payments/routes.js';

// The public API. Each route is either explicitly public or requires a caller.
export function buildRoutes({ config, gateway, store = null, limiter, conversations, chat, provider = null, models, voice = null, auth = null, plans = null, payments = null, logger = null, now = () => Date.now() }) {
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
          plans: Boolean(plans) && config.plans.enabled,
          sign_in: { email: Boolean(auth) && config.auth.email, google: Boolean(auth) && config.auth.google },
          guest_session_hours: Math.round(config.guestTtlSeconds / 3600),
          speech: voice && voice.available
            ? { available: true, voices: voice.voices, default: voice.defaultVoice }
            : { available: false, voices: [], default: null }
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
      handler: async ({ caller }) => ({ body: { conversations: (await conversations.list(caller)).map(publicConversation) } })
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
  ].concat(authRoutes({ config, auth, limiter, logger }), paymentRoutes({ config, payments, plans, store, limiter, logger }));
}
