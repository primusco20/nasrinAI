import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http/errors.js';
import { seal, open } from '../connectors/secret.js';

// Facebook Messenger (Phase 6): people message a business's Facebook Page and
// that business's Nasrin answers, with its own tools and limits.
//
//   GET  /v1/webhooks/facebook   Meta's webhook check (verify token)
//   POST /v1/webhooks/facebook   messages; signed by Meta (X-Hub-Signature-256,
//                                HMAC-SHA256 of the raw body with the App Secret)
//   GET/PUT/DELETE /v1/channels/facebook[/:page_id]   the business connects a Page
//
// Each sender is a guest of the Page's business (id fb_<PSID>), so guest
// limits, budgets and the business's guest-allowed tools apply. Messenger
// cannot show a Confirm card, so write/money tools are refused there. Each
// message id is handled once (Meta retries). Text only; replies are plain
// text in parts of at most 2,000 characters.

const GRAPH = 'https://graph.facebook.com';
const MAX_PART = 2000;

export function verifySignature(appSecret, raw, header) {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header || ''));
  if (!m) return false;
  const want = createHmac('sha256', appSecret).update(raw).digest();
  return timingSafeEqual(want, Buffer.from(m[1], 'hex'));
}

// Plain text for Messenger: Markdown marks removed, split at paragraph or
// sentence ends.
export function toMessengerText(text) {
  const plain = String(text)
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)')
    .trim();
  const parts = [];
  let rest = plain;
  while (rest.length > MAX_PART) {
    let cut = rest.lastIndexOf('\n\n', MAX_PART);
    if (cut < MAX_PART / 2) cut = rest.lastIndexOf('. ', MAX_PART) + 1;
    if (cut < MAX_PART / 2) cut = MAX_PART;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.slice(0, 5);
}

export function createFacebook({ config, store, chat, conversations, logger, fetchImpl = fetch }) {
  const fb = config.facebook;
  const key = config.connectors.key;
  const url = (path) => `${GRAPH}${fb.graphVersion ? '/' + fb.graphVersion : ''}${path}`;

  async function send(token, psid, text) {
    for (const part of toMessengerText(text)) {
      let resp;
      try {
        resp = await fetchImpl(url('/me/messages'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text: part }, access_token: token }),
          signal: AbortSignal.timeout(10_000)
        });
      } catch (err) {
        logger.warn('messenger send failed', { error: err?.name || 'error' });
        return false;
      }
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        logger.warn('messenger send refused', { status: resp.status, error: String(data?.error?.message || '').slice(0, 200) });
        return false;
      }
    }
    return true;
  }

  async function handleMessage(pageId, ev) {
    const psid = String(ev.sender?.id || '');
    const msg = ev.message;
    if (!msg || msg.is_echo || !/^[0-9]{5,30}$/.test(psid)) return;
    const mid = String(msg.mid || '').slice(0, 200);
    if (mid) {
      const once = await store.rateHit(`fb:mid:${mid}`, 86400, 1);
      if (!once.allowed) return;   // Meta sent it again
    }
    const channel = await store.getChannel('facebook', pageId);
    if (!channel || !channel.enabled) { logger.warn('messenger: page not connected', { page: pageId }); return; }
    const tenant = await store.getTenant(channel.tenantId);
    if (!tenant || tenant.status !== 'active') return;
    let token;
    try { token = open(key, channel.secretEnc, { tenantId: channel.tenantId, name: 'facebook:' + pageId }); } catch {
      logger.error('messenger: page token cannot be read (CONNECTOR_SECRET_KEY changed?)', { page: pageId });
      return;
    }

    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    if (!text) {
      await send(token, psid, 'Sorry, I can only read text messages here for now.');
      return;
    }
    const caller = { tenantId: channel.tenantId, tenant, actor: { type: 'guest', id: 'fb_' + psid }, scopes: ['chat'] };
    const latest = (await conversations.list(caller, 1))[0];
    let reply;
    try {
      const out = await chat(caller, { message: text.slice(0, config.ai.maxMessageChars), ...(latest ? { conversation_id: latest.id } : {}) }, 'messenger:' + pageId, { confirm: false });
      reply = out.message.content;
    } catch (err) {
      reply = err instanceof HttpError && err.status < 500 ? err.publicMessage : 'Sorry, I cannot answer right now. Please try again in a moment.';
      if (!(err instanceof HttpError)) logger.error('messenger chat failed', { error: err?.message });
    }
    await send(token, psid, reply.replace(/^\[image:[0-9a-f-]{36}\]\s*/, ''));
  }

  const ownBusiness = (caller) => {
    if (caller.actor.type !== 'service') throw new HttpError(403, 'forbidden', 'Only a business secret key can connect a Page.');
  };

  return {
    routes: [
      {
        // Meta's subscription check: echo the challenge when the token matches.
        method: 'GET',
        path: '/v1/webhooks/facebook',
        public: true,
        handler: async ({ req, res }) => {
          const q = new URL(req.url, 'http://x').searchParams;
          const given = Buffer.from(String(q.get('hub.verify_token') || ''));
          const want = Buffer.from(fb.verifyToken);
          const ok = q.get('hub.mode') === 'subscribe' && given.length === want.length && timingSafeEqual(given, want);
          const challenge = String(q.get('hub.challenge') || '');
          if (!ok || !/^[A-Za-z0-9_-]{1,200}$/.test(challenge)) throw new HttpError(403, 'forbidden', 'Verification failed.');
          res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end(challenge);
        }
      },
      {
        method: 'POST',
        path: '/v1/webhooks/facebook',
        public: true,
        raw: true,
        maxBody: 512 * 1024,
        handler: async ({ req, raw }) => {
          if (!verifySignature(fb.appSecret, raw, req.headers['x-hub-signature-256'])) {
            logger.warn('messenger webhook with a bad signature');
            throw new HttpError(401, 'bad_signature', 'The signature is not valid.');
          }
          let body;
          try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'invalid_json', 'The request body must be JSON.'); }
          if (body?.object !== 'page' || !Array.isArray(body.entry)) return { body: { ignored: true } };
          // Answered before replying 200 (serverless stops after the response).
          for (const entry of body.entry.slice(0, 20)) {
            const pageId = String(entry?.id || '');
            if (!/^[0-9]{5,30}$/.test(pageId)) continue;
            for (const ev of (Array.isArray(entry.messaging) ? entry.messaging : []).slice(0, 20)) {
              try { await handleMessage(pageId, ev); } catch (err) { logger.error('messenger event failed', { error: err?.message }); }
            }
          }
          return { body: { received: true } };
        }
      }
    ],
    manage: {
      async list(caller) {
        ownBusiness(caller);
        return (await store.listChannels(caller.tenantId)).filter((c) => c.kind === 'facebook')
          .map((c) => ({ page_id: c.externalId, enabled: c.enabled, updated_at: c.updatedAt }));
      },
      async put(caller, body) {
        ownBusiness(caller);
        const pageId = String(body?.page_id || '');
        const token = body?.page_access_token;
        if (!/^[0-9]{5,30}$/.test(pageId)) throw new HttpError(400, 'invalid_channel', 'page_id: the numeric Facebook Page ID.');
        if (typeof token !== 'string' || token.length < 20 || token.length > 1000 || /\s/.test(token)) throw new HttpError(400, 'invalid_channel', 'page_access_token: the Page access token from the Meta app.');
        try {
          const saved = await store.putChannel({ tenantId: caller.tenantId, kind: 'facebook', externalId: pageId,
            secretEnc: seal(key, token, { tenantId: caller.tenantId, name: 'facebook:' + pageId }), enabled: body.enabled !== false });
          logger.info('messenger page connected', { tenantId: caller.tenantId, page: pageId });
          return { page_id: saved.externalId, enabled: saved.enabled };
        } catch (err) {
          if (err.code === 'taken') throw new HttpError(409, 'channel_taken', 'This Page is connected to another business.');
          throw err;
        }
      },
      async remove(caller, pageId) {
        ownBusiness(caller);
        const gone = await store.deleteChannel(caller.tenantId, 'facebook', String(pageId));
        if (!gone) throw new HttpError(404, 'not_found', 'Not found.');
        return { deleted: true };
      }
    }
  };
}
