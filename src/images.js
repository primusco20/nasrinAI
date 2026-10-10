import { HttpError } from './http/errors.js';
import { marketingCacheKey } from './marketing-cache.js';
import { ProviderError } from './ai/provider.js';
import { parseAttachments } from './attachments.js';
import { cleanUserText } from './ai/output.js';
import { publicMessage } from './conversations.js';
import { manilaDayStart } from './limits.js';
import { redactForProvider } from './ai/redact.js';
import { BRIEF_SYSTEM, planningMessage, readPlan, fallbackBrief, cleanAnswers, cleanBrief, promptFromBrief, summarize } from './ai/brief.js';

// Making pictures (Phase 4.2). Step 1: a prompt, optionally a photo, gives
// exactly one image. Step 2: before that, `brief` asks up to 5 adaptive
// questions and writes a structured creative brief with a low-cost text
// model; `create` then builds the image prompt from the brief's fields.
// Regenerate is simply `create` again with the same brief (a new, counted
// picture). Guests get IMAGES_PER_GUEST (default 1) per guest
// session; signed-in users IMAGES_USER_DAY per day. Each image is counted in
// the spending budget, kept private, and shown only to its owner.

const QUALITY = 'Create one professional, campaign-ready image. Keep any product in the attached photo exactly as it is (shape, colours, label, logo) unless asked to change it. No added text unless asked.';

// Picture tiers (chosen by code, no model call): 1 simple; 2 editing a photo
// or words in the picture; 3 the person asks for top quality. The highest
// configured tier at or below that is used (tier 1 when only tier 1 is set).
// Tier 4 is reserved: configurable, never chosen automatically.
const TOP_QUALITY = /\b(high[- ]quality|highest quality|4k|8k|photo-?realistic|ultra[- ]?realistic|hyper[- ]?realistic|print[- ]ready|billboard|award[- ]winning)\b/i;
export function imageTier({ prompt, photos = [], brief = null }) {
  const text = [prompt, brief && Object.values(brief).join(' ')].filter(Boolean).join(' ');
  if (TOP_QUALITY.test(text)) return 3;
  if (photos.length || (brief && brief.typography)) return 2;
  return 1;
}

export function createImages({ store, conversations, limiter, usageLog, routes = null, imageProvider = null, backup = null, provider = null, plans = null, budget = null, policy, price = null, legal = null, config, logger, now = () => Date.now() }) {
  // routes: { tier: { primary: { p, price }, fallback: { p, price } | null } }.
  // Older callers pass one imageProvider (+ backup) for tier 1.
  if (!routes) routes = imageProvider ? { 1: { primary: { p: imageProvider, price }, fallback: backup ? { p: backup.provider, price: backup.price } : null } } : {};
  const tiers = Object.keys(routes).map(Number).sort((a, b) => a - b);
  const pickTier = (wanted) => tiers.filter((n) => n <= wanted).pop() ?? tiers[0];
  const busy = new Set();   // one image at a time per person (per server instance)
  let lastPurge = 0;
  // Retention (IMAGE_RETENTION_DAYS): old pictures of businesses are deleted, at
  // most hourly per server instance, in the background. Signed-in people's
  // pictures follow their own keep-time (src/storage.js).
  function maybePurge() {
    const days = config.images.retentionDays;
    if (!days || !store.purgeImagesBefore || now() - lastPurge < 3600_000) return;
    lastPurge = now();
    store.purgeImagesBefore(new Date(now() - days * 86400_000)).catch((err) => logger.warn('picture purge failed', { error: err.message }));
  }

  const switchable = (err) => err instanceof ProviderError &&
    (['unavailable', 'timeout', 'busy'].includes(err.kind) || (err.kind === 'config' && err.status === 404));

  // Allowance: only pictures actually made count (failed attempts do not).
  // Guests: per guest session, plus one ceiling for all guests per day.
  // Signed-in users: per day (Manila time), by plan. Business keys: per day.
  async function allowance(caller) {
    const { type, id } = caller.actor;
    const base = { tenantId: caller.tenantId, actorType: type };
    if (type === 'guest') {
      const per = config.images.perGuest;
      const mine = await store.imagesMadeSince({ ...base, actorId: id, since: new Date(now() - config.guestTtlSeconds * 1000), limit: per + 1 });
      if (mine >= per) throw new HttpError(429, 'image_limit', per === 1 ? 'Guests can make one picture. Sign in to make more.' : `Guests can make ${per} pictures. Sign in to make more.`);
      const all = await store.imagesMadeSince({ ...base, since: new Date(manilaDayStart(now())), limit: config.images.guestDayTotal + 1 });
      if (all >= config.images.guestDayTotal) throw new HttpError(429, 'image_limit', 'Guest pictures are used up for today. Sign in to make more.');
      return;
    }
    const per = await dailyLimit(caller);
    const made = await store.imagesMadeSince({ ...base, actorId: id, since: new Date(manilaDayStart(now())), limit: per + 1 });
    if (made >= per) throw new HttpError(429, 'image_limit', `You have made ${per} ${per === 1 ? 'picture' : 'pictures'} today, the most your plan allows. Try again tomorrow.`);
  }

  // Pictures a day for a signed-in user (by plan) or a business key.
  async function dailyLimit(caller) {
    let per = config.images.perUserDay;
    if (caller.actor.type === 'user' && plans) {
      const p = await plans.current(caller);
      if (!p.open) per = { max: config.images.perMaxDay, ultra: config.images.perUltraDay }[p.plan] ?? per;
    }
    return per;
  }

  // The idea and the optional photo, checked the same way for both steps.
  function readRequest(body) {
    if (!tiers.length) throw new HttpError(503, 'images_unavailable', 'Picture creation is not available yet.');
    const prompt = cleanUserText(body.prompt, 1000);
    if (!prompt) throw new HttpError(400, 'invalid_prompt', 'Describe the picture in 1 to 1000 characters.');
    const photos = parseAttachments(body.photo ? [body.photo] : [], { ...config.ai.attachments, maxCount: 1 });
    if (photos.some((p) => p.kind !== 'image')) throw new HttpError(400, 'invalid_attachment', 'Add a photo (PNG, JPEG or WebP).');
    return { prompt, photos };
  }

  // One call to the low-cost text model: the cheapest level that fits the
  // budget (smart routing), else the default tier.
  async function plan(caller, req, sensitive) {
    if (policy) {
      const run = await policy.run({ task: 'image_brief', level: 1, floor: 1, ceiling: 2, sensitive }, req, {
        onFailure: (f) => usageLog.record(caller, {
          provider: f.result?.provider || f.error?.provider || f.spec.provider, model: f.spec.model,
          inputTokens: f.result?.inputTokens, outputTokens: f.result?.outputTokens, latencyMs: f.latencyMs,
          outcome: f.outcome, task: 'image_brief', level: f.level, costUsd: f.costUsd, escalated: f.escalated
        })
      });
      return { ...run.result, provider: run.result.provider || run.spec.provider, model: run.result.model || run.spec.model, costUsd: run.costUsd, level: run.level };
    }
    const result = await provider.generate({ ...req, route: config.ai.tiers.nasrinai, maxTokens: 1000 });
    return { ...result, provider: result.provider || provider.id, model: result.model || provider.model, costUsd: 0 };
  }

  return {
    available: tiers.length > 0,

    // What Settings > Usage shows, counted exactly as allowance() counts it.
    async usage(caller) {
      const { type, id } = caller.actor;
      const base = { tenantId: caller.tenantId, actorType: type, actorId: id };
      if (type === 'guest') {
        const limit = config.images.perGuest;
        const used = await store.imagesMadeSince({ ...base, since: new Date(now() - config.guestTtlSeconds * 1000), limit: limit + 1 });
        return { used: Math.min(used, limit), limit, period: 'guest_session' };
      }
      const limit = await dailyLimit(caller);
      const used = await store.imagesMadeSince({ ...base, since: new Date(manilaDayStart(now())), limit: limit + 1 });
      return { used: Math.min(used, limit), limit, period: 'day' };
    },

    // Step 2a: adaptive questions, or the creative brief.
    // Body: { prompt, photo?, answers? }. Without `answers` the model may ask
    // up to 5 questions; with `answers` (an empty list means "skip") it writes
    // the brief. Answers: [{ question, answer }].
    // Returns { questions: [{ id, question, choices }] } or { brief, summary }.
    async brief(caller, body, ip) {
      const { prompt, photos } = readRequest(body);
      const answered = body.answers !== undefined;
      const answers = answered ? cleanAnswers(body.answers) : [];
      if (!answers) throw new HttpError(400, 'invalid_answers', 'Each answer must include its question (up to 5).');
      if (legal) await legal.require(caller);
      await limiter.message(caller, ip);

      const done = (brief) => ({ brief, summary: summarize(brief) });
      const briefCacheKey = marketingCacheKey('brief', {
        prompt, answered, answers,
        message: planningMessage({ idea: prompt, answers, answered, photo: photos.length > 0, photoUnseen: false }),
        photos: photos.map((p) => ({ mime: p.mime, digest: marketingCacheKey('photo', { mime: p.mime, data: p.data }) })),
        systemDigest: marketingCacheKey('brief-system', { system: BRIEF_SYSTEM })
      });
      if (provider && store.getMarketingCache) {
        const cached = await store.getMarketingCache({
          tenantId: caller.tenantId, ownerType: caller.actor.type, ownerId: caller.actor.id,
          kind: 'brief', key: briefCacheKey
        });
        if (cached && typeof cached === 'object') {
          await usageLog.record(caller, { provider: 'cache', model: 'marketing-brief-v1', outcome: 'ok', task: 'marketing_cache_hit', costUsd: 0, cacheHit: true });
          return cached;
        }
      }
      await limiter.budget(caller);
      if (!provider) return done(fallbackBrief(prompt, { photo: photos.length > 0 }));

      const ask = (withPhoto) => plan(caller, {
        system: BRIEF_SYSTEM,
        messages: [{ role: 'user', content: planningMessage({ idea: prompt, answers, answered, photo: photos.length > 0, photoUnseen: photos.length > 0 && !withPhoto }) }],
        attachments: withPhoto ? photos : []
      }, photos.length > 0 || redactForProvider(prompt) !== prompt);

      const started = now();
      let out;
      try {
        try {
          out = await ask(photos.length > 0);
        } catch (err) {
          // A model that cannot see photos still plans from the words.
          const photoProblem = photos.length && ((err instanceof HttpError && err.code === 'attachment_unsupported') || (err instanceof ProviderError && err.kind === 'config' && err.status === 400));
          if (!photoProblem) throw err;
          logger.info('image brief without the photo', { reason: err.code || err.kind });
          out = await ask(false);
        }
      } catch (err) {
        if (err instanceof HttpError) {
          await usageLog.record(caller, { provider: 'router', model: 'none', outcome: err.code === 'budget_reached' ? 'budget_blocked' : 'rejected_output', task: 'image_brief', costUsd: 0 });
          throw err;
        }
        const kind = err instanceof ProviderError ? err.kind : 'unexpected';
        await usageLog.record(caller, { provider: err?.provider || 'router', model: err?.model || 'unknown', latencyMs: now() - started, outcome: kind === 'timeout' ? 'timeout' : 'provider_error', task: 'image_brief', costUsd: 0 });
        (kind === 'config' || kind === 'unexpected' ? logger.error : logger.warn)('image brief failed', { kind, error: err?.message });
        throw new HttpError(503, 'images_unavailable', 'NasrinAI cannot plan pictures right now. Please try again in a moment.', kind === 'busy' ? { retryAfter: 30 } : {});
      }

      const read = readPlan(out.text, { answered });
      await usageLog.record(caller, {
        provider: out.provider, model: out.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens,
        latencyMs: now() - started, outcome: read ? 'ok' : 'rejected_output', task: 'image_brief', level: out.level, costUsd: out.costUsd
      });
      if (!read) logger.warn('image brief did not fit the format; using the idea as the brief');
      const result = read?.questions ? { questions: read.questions } : done(read?.brief || fallbackBrief(prompt, { photo: photos.length > 0 }));
      if (store.setMarketingCache) {
        await store.setMarketingCache({
          tenantId: caller.tenantId, ownerType: caller.actor.type, ownerId: caller.actor.id,
          kind: 'brief', key: briefCacheKey, value: result
        }).catch((err) => logger.warn('marketing brief cache write failed', { error: err.message }));
      }
      return result;
    },

    // Step 1 / 2b: one picture. Body: { prompt, photo?, brief?, conversation_id? }.
    async create(caller, body, ip) {
      const { prompt, photos } = readRequest(body);
      maybePurge();
      const brief = body.brief === undefined ? null : cleanBrief(body.brief);
      if (body.brief !== undefined && !brief) throw new HttpError(400, 'invalid_brief', 'The brief needs at least a subject.');
      if (legal) await legal.require(caller);
      if (body.conversation_id !== undefined && typeof body.conversation_id !== 'string') throw new HttpError(400, 'invalid_conversation', 'The conversation id is not valid.');

      const who = `${caller.tenantId}:${caller.actor.type}:${caller.actor.id}`;
      if (busy.has(who)) throw new HttpError(429, 'image_in_progress', 'One picture at a time, please. Your last one is still being made.');

      // The tier and model route are part of the fingerprint: never serve a
      // cached image across model/quality changes or between different owners.
      const tier = pickTier(imageTier({ prompt, photos, brief }));
      const route = routes[tier];
      const aspectRatio = brief ? brief.aspect_ratio : '1:1';
      const cacheKey = marketingCacheKey('image', {
        prompt: brief ? promptFromBrief(brief, { quality: QUALITY }) : `${QUALITY}\n\nRequest: ${prompt}`,
        photos: photos.map((p) => ({ mime: p.mime, digest: marketingCacheKey('photo', { mime: p.mime, data: p.data }) })),
        aspectRatio, tier,
        primary: { provider: route.primary.p.id, model: route.primary.p.model },
        fallback: route.fallback ? { provider: route.fallback.p.id, model: route.fallback.p.model } : null
      });
      await limiter.message(caller, ip);

      // Reuse only an exact, still-existing asset owned by this caller.
      const cached = body.reuse_cached === true && store.getMarketingCache ? await store.getMarketingCache({
        tenantId: caller.tenantId, ownerType: caller.actor.type, ownerId: caller.actor.id, kind: 'image', key: cacheKey
      }) : null;
      if (cached && typeof cached.imageId === 'string') {
        const image = await store.getImage(cached.imageId);
        if (image && image.tenantId === caller.tenantId && image.ownerType === caller.actor.type && image.ownerId === caller.actor.id) {
          const conv = body.conversation_id ? await conversations.get(caller, body.conversation_id) : await conversations.create(caller);
          const userMessage = await conversations.add(conv, 'user', `Create an image: ${prompt}${photos.length ? '\n\n[Attached: ' + photos[0].name + ']' : ''}`);
          if (!conv.title) await conversations.setTitle(conv, ('Image: ' + prompt).slice(0, 60)).catch(() => {});
          const assistant = await conversations.add(conv, 'assistant', `[image:${cached.imageId}]\nHere is your picture.`);
          await usageLog.record(caller, { provider: image.provider || route.primary.p.id, model: image.model || route.primary.p.model,
            outcome: 'ok', task: 'marketing_cache_hit', level: tier, costUsd: 0, cacheHit: true });
          return { conversation_id: conv.id, user_message_id: userMessage.id, image_id: cached.imageId, message: publicMessage(assistant), cache_hit: true };
        }
      }

      // Cache misses must pass the existing daily image allowance.
      await allowance(caller);
      // Picture budget: reserve against the dearer possible provider.
      const worst = route.fallback ? Math.max(route.primary.price ?? Infinity, route.fallback.price ?? Infinity) : route.primary.price;
      if (budget) {
        const left = await budget.remaining();
        if (worst === null || !Number.isFinite(worst) || left.unknown || worst > left.usd) {
          await usageLog.record(caller, { provider: route.primary.p.id, model: route.primary.p.model, outcome: 'budget_blocked', task: 'image', level: tier, costUsd: 0 });
          throw new HttpError(503, 'budget_reached', 'NasrinAI has reached its spending limit for pictures for now. Please try again later.', { retryAfter: 600 });
        }
      }

      const conv = body.conversation_id ? await conversations.get(caller, body.conversation_id) : await conversations.create(caller);
      const userMessage = await conversations.add(conv, 'user', `Create an image: ${prompt}${photos.length ? '\n\n[Attached: ' + photos[0].name + ']' : ''}`);
      if (!conv.title) await conversations.setTitle(conv, ('Image: ' + prompt).slice(0, 60)).catch(() => {});

      busy.add(who);
      const request = {
        prompt: brief ? promptFromBrief(brief, { quality: QUALITY }) : `${QUALITY}\n\nRequest: ${prompt}`,
        images: photos.map((p) => ({ mime: p.mime, data: p.data })),
        aspectRatio
      };
      const failed = (p, err, started) => {
        const kind = err instanceof ProviderError ? err.kind : 'unexpected';
        return usageLog.record(caller, { provider: p.id, model: p.model, latencyMs: now() - started, outcome: kind === 'timeout' ? 'timeout' : kind === 'refused' ? 'rejected_output' : 'provider_error', task: 'image', level: tier, costUsd: 0 });
      };
      let started = now();
      let out;
      let used = route.primary;
      try {
        try {
          out = await used.p.generate(request);
        } catch (err) {
          // The fallback, once, when the primary is down, overloaded, out of
          // quota, timed out, or its model is unavailable. Never for a safety
          // refusal (no shopping around a provider's rules) or a bad key.
          if (!route.fallback || !switchable(err)) throw err;
          await failed(used.p, err, started);
          logger.warn('image: using the fallback', { tier, from: used.p.id, status: err.status, error: err.message });
          used = route.fallback;
          started = now();
          out = await used.p.generate(request);
        }
      } catch (err) {
        const kind = err instanceof ProviderError ? err.kind : 'unexpected';
        await failed(used.p, err, started);
        (kind === 'config' || kind === 'unexpected' ? logger.error : logger.warn)('image failed', { kind, status: err?.status, error: err?.message });
        if (kind === 'refused') throw new HttpError(422, 'image_refused', 'That picture could not be made. Try describing it differently.');
        if (err?.status === 503) throw new HttpError(503, 'images_busy', 'The picture service is very busy right now. Please try again in a few minutes.', { retryAfter: 120 });
        throw new HttpError(503, 'images_unavailable', 'Pictures cannot be made right now. Please try again in a moment.', kind === 'busy' ? { retryAfter: 30 } : {});
      } finally {
        busy.delete(who);
      }

      const imageId = await store.addImage({
        tenantId: caller.tenantId, conversationId: conv.id, ownerType: caller.actor.type, ownerId: caller.actor.id,
        mime: out.mime, bytes: out.bytes, provider: used.p.id, model: used.p.model
      });
      if (budget) budget.spend(used.price);
      await usageLog.record(caller, { provider: used.p.id, model: used.p.model, latencyMs: now() - started, outcome: 'ok', task: 'image', level: tier, costUsd: used.price ?? 0 });
      if (store.setMarketingCache) {
        await store.setMarketingCache({
          tenantId: caller.tenantId, ownerType: caller.actor.type, ownerId: caller.actor.id,
          kind: 'image', key: cacheKey, value: { imageId }
        }).catch((err) => logger.warn('marketing image cache write failed', { error: err.message }));
      }
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
