import { HttpError } from './http/errors.js';
import { ProviderError } from './ai/provider.js';
import { parseAttachments } from './attachments.js';
import { cleanUserText } from './ai/output.js';
import { publicMessage } from './conversations.js';

// Making pictures (Phase 4.2, first step): a prompt, optionally a photo,
// gives exactly one image. Guests get IMAGES_PER_GUEST (default 1) per guest
// session; signed-in users IMAGES_USER_DAY per day. Each image is counted in
// the spending budget, kept private, and shown only to its owner.

const QUALITY = 'Create one professional, campaign-ready image. Keep any product in the attached photo exactly as it is (shape, colours, label, logo) unless asked to change it. No added text unless asked.';

export function createImages({ store, conversations, limiter, usageLog, imageProvider, policy, price, legal = null, config, logger, now = () => Date.now() }) {
  const busy = new Set();   // one image at a time per person (per server instance)

  return {
    available: Boolean(imageProvider),

    async create(caller, body, ip) {
      if (!imageProvider) throw new HttpError(503, 'images_unavailable', 'Making pictures is not switched on yet.');
      if (legal) await legal.require(caller);
      const prompt = cleanUserText(body.prompt, 1000);
      if (!prompt) throw new HttpError(400, 'invalid_prompt', 'Describe the picture in 1 to 1000 characters.');
      const photos = parseAttachments(body.photo ? [body.photo] : [], { ...config.ai.attachments, maxCount: 1 });
      if (photos.some((p) => p.kind !== 'image')) throw new HttpError(400, 'invalid_attachment', 'Add a photo (PNG, JPEG or WebP).');
      if (body.conversation_id !== undefined && typeof body.conversation_id !== 'string') throw new HttpError(400, 'invalid_conversation', 'conversation_id must be a string.');

      const who = `${caller.tenantId}:${caller.actor.type}:${caller.actor.id}`;
      if (busy.has(who)) throw new HttpError(429, 'image_in_progress', 'One picture at a time, please. Your last one is still being made.');

      // Allowance: guests per session (the session lasts guestTtlSeconds), users per day.
      const { type, id } = caller.actor;
      if (type === 'guest') {
        const r = await store.rateHit(`img:guest:${caller.tenantId}:${id}`, config.guestTtlSeconds, config.images.perGuest);
        if (!r.allowed) throw new HttpError(429, 'image_limit', config.images.perGuest === 1
          ? 'Guests can make one picture. Sign in to make more.'
          : `Guests can make ${config.images.perGuest} pictures. Sign in to make more.`);
      } else {
        const r = await store.rateHit(`img:${type}:${caller.tenantId}:${id}`, 86400, config.images.perUserDay);
        if (!r.allowed) throw new HttpError(429, 'image_limit', 'You have made the most pictures allowed today. Try again tomorrow.', { retryAfter: r.retryAfter });
      }
      await limiter.message(caller, ip);

      // Budget: one image costs `price` (from config/model-prices.json).
      if (policy) {
        const left = await policy.budgetLeft();
        const cap = Math.min(left.unknown ? Infinity : left.usd, policy.maxRequestUsd ?? Infinity);
        if (price === null || price > cap) {
          await usageLog.record(caller, { provider: imageProvider.id, model: imageProvider.model, outcome: 'budget_blocked', task: 'image', costUsd: 0 });
          throw new HttpError(503, 'budget_reached', 'NasrinAI has reached its spending limit for pictures for now. Please try again later.', { retryAfter: 600 });
        }
      }

      const conv = body.conversation_id ? await conversations.get(caller, body.conversation_id) : await conversations.create(caller);
      const userMessage = await conversations.add(conv, 'user', `Create an image: ${prompt}${photos.length ? '\n\n[Attached: ' + photos[0].name + ']' : ''}`);
      if (!conv.title) await conversations.setTitle(conv, ('Image: ' + prompt).slice(0, 60)).catch(() => {});

      busy.add(who);
      const started = now();
      let out;
      try {
        out = await imageProvider.generate({ prompt: `${QUALITY}\n\nRequest: ${prompt}`, images: photos.map((p) => ({ mime: p.mime, data: p.data })) });
      } catch (err) {
        const kind = err instanceof ProviderError ? err.kind : 'unexpected';
        await usageLog.record(caller, { provider: imageProvider.id, model: imageProvider.model, latencyMs: now() - started, outcome: kind === 'timeout' ? 'timeout' : kind === 'refused' ? 'rejected_output' : 'provider_error', task: 'image', costUsd: 0 });
        (kind === 'config' || kind === 'unexpected' ? logger.error : logger.warn)('image failed', { kind, status: err?.status });
        if (kind === 'refused') throw new HttpError(422, 'image_refused', 'That picture could not be made. Try describing it differently.');
        throw new HttpError(503, 'images_unavailable', 'Pictures cannot be made right now. Please try again in a moment.', kind === 'busy' ? { retryAfter: 30 } : {});
      } finally {
        busy.delete(who);
      }

      const imageId = await store.addImage({
        tenantId: caller.tenantId, conversationId: conv.id, ownerType: caller.actor.type, ownerId: caller.actor.id,
        mime: out.mime, bytes: out.bytes, provider: imageProvider.id, model: imageProvider.model
      });
      if (policy) policy.spent(price);
      await usageLog.record(caller, { provider: imageProvider.id, model: imageProvider.model, latencyMs: now() - started, outcome: 'ok', task: 'image', costUsd: price ?? 0 });
      const assistant = await conversations.add(conv, 'assistant', `[image:${imageId}]\nHere is your picture.`);
      return { conversation_id: conv.id, user_message_id: userMessage.id, image_id: imageId, message: publicMessage(assistant) };
    },

    // The image bytes, only for the person who made it.
    async read(caller, imageId) {
      const img = await store.getImage(imageId);
      if (!img || img.tenantId !== caller.tenantId || img.ownerType !== caller.actor.type || img.ownerId !== caller.actor.id) {
        throw new HttpError(404, 'not_found', 'Not found.');
      }
      return img;
    }
  };
}
