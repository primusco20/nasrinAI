import { ProviderError } from './provider.js';
import { redactForProvider } from './redact.js';

// The AI router (Phase 4): LOCAL, GPT and AUTO behind one provider.
//
// Each tier names a provider and a model (config tiers: { provider, model,
// effort }). The router sends the request there, with these rules:
//   - Redaction is decided per call by where the message really goes: text
//     sent to a provider whose data leaves the server is redacted when
//     REDACT_FOR_EXTERNAL_AI is on; the own model gets it as written.
//   - AUTO fallback: when a request for the own model cannot be answered
//     (server down, timeout, busy) or needs something it cannot do (photos
//     without vision, PDFs), it goes to the GPT fallback model instead, if
//     AI_FALLBACK=openai. A down own model is skipped for 30 seconds.
//   - The result says which provider and model answered, for usage records.

const RETRYABLE = new Set(['unavailable', 'timeout', 'busy']);

export function createRouter({ providers, config, logger, now = () => Date.now(), healthMs = 30_000 }) {
  const keys = Object.keys(providers).filter((k) => providers[k]);
  if (!keys.length) throw new Error('the router needs at least one provider');
  const defaultSpec = config.ai.tiers.nasrinai;
  const caps = (p) => p.capabilities();
  const isOwn = (p) => caps(p).local === true && p.id !== 'fake';
  const fallback = config.ai.fallback || { mode: 'none', providers: [] };
  const health = new Map();   // key -> { at, ok, pending }

  async function healthy(key) {
    const p = providers[key];
    const h = health.get(key);
    if (h && now() - h.at < healthMs) return h.ok;
    if (!isOwn(p)) return true;
    if (h && h.pending) return h.pending;
    const pending = p.healthCheck().catch(() => false)
      .then((ok) => { health.set(key, { at: now(), ok }); return ok; });
    health.set(key, { ...(h || { at: -Infinity, ok: true }), pending });
    return pending;
  }
  const markDown = (key) => health.set(key, { at: now(), ok: false });

  function canHandle(p, attachments) {
    const c = caps(p);
    if (attachments.some((a) => a.kind === 'pdf') && c.pdf === false) return false;
    if (attachments.some((a) => a.kind === 'image') && c.vision === false) return false;
    return true;
  }

  async function call(key, spec, req, fallback, attempts = []) {
    const p = providers[key];
    attempts.push({ provider: key, model: spec.model, effort: spec.effort });
    const external = caps(p).dataLeavesServer;
    const messages = external && config.ai.redactExternal
      ? req.messages.map((m) => (m.role === 'tool' ? m : { ...m, content: redactForProvider(m.content || '') }))
      : req.messages;
    const { spendHooks, spendTier, ...providerReq } = req;
    // The spend reservation is made for each actual provider attempt, including
    // failover. Private callbacks never cross the provider boundary.
    let spendReservation = null;
    try {
      spendReservation = spendHooks
        ? await spendHooks.reserve({ provider: key, model: spec.model, effort: spec.effort, request: req, tier: spendTier })
        : null;
    } catch (err) {
      if (err && typeof err === 'object') err.providerNotCalled = true;
      throw err;
    }
    let out;
    try {
      out = await p.generate({ ...providerReq, messages, model: spec.model,
        reasoningEffort: spec.effort || req.reasoningEffort, route: undefined });
    } catch (err) {
      if (spendHooks && spendReservation) {
        try { await spendHooks.settle(spendReservation, null); }
        catch (settleErr) { logger.error('failed provider spend reservation remains held', { provider: key, model: spec.model, error: settleErr.message }); }
        if (err && typeof err === 'object') err.spendReservationId = spendReservation.id;
      }
      if (err && typeof err === 'object') { err.provider = p.id; err.model = spec.model; }
      throw err;
    }
    const settled = spendHooks ? await spendHooks.settle(spendReservation, out) : {};
    return { ...out, ...settled, provider: p.id, model: spec.model, fallback, external };
  }

  // One routed attempt: the chosen provider, then a failover provider when it
  // fails in a way another provider could answer. Every real call is added to `attempts`.
  async function generateOnce(req, attempts) {
    const spec = req.route || defaultSpec;
    const key = providers[spec.provider] ? spec.provider : keys[0];
    const attachments = req.attachments || [];

    // Pick a fallback model at the same routing level whenever possible.
    // If an operator overrides a level to one provider only, use that
    // provider's registered default model rather than disabling resilience.
    const fallbackSpecs = [];
    for (const provider of fallback.providers || []) {
      if (provider === key || !providers[provider]) continue;
      const levels = config.ai.routing?.levels || {};
      const sameLevel = Object.values(levels)
        .flat()
        .find((candidate) => candidate.provider === provider && candidate.provider !== key);
      const candidate = sameLevel || { provider, model: providers[provider].model, effort: null };
      if (candidate && canHandle(providers[provider], attachments)) {
        fallbackSpecs.push([provider, candidate]);
      }
    }

    const useFallback = async (reason, failedKey = key) => {
      for (const [provider, fallbackSpec] of fallbackSpecs) {
        if (provider === failedKey) continue;
        if (!(await healthy(provider))) continue;
        logger.warn('AI provider failover', {
          from: failedKey,
          to: provider,
          reason
        });
        return call(provider, fallbackSpec, req, true, attempts);
      }
      return null;
    };

    if (!(await healthy(key)) || !canHandle(providers[key], attachments)) {
      const result = await useFallback(
        !(await healthy(key)) ? 'provider temporarily unavailable' : 'provider cannot handle attachments'
      );
      if (result) return result;
    }

    try {
      return await call(key, spec, req, false, attempts);
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;

      // A provider-specific configuration/quota failure is terminal for that
      // provider, not for the whole chat request. This is what lets an
      // exhausted Anthropic credit balance fall through to Gemini/OpenAI.
      const canFailOver = ['config', ...RETRYABLE].includes(err.kind);
      if (!canFailOver) throw err;

      if (err.kind !== 'busy') markDown(key);
      const result = await useFallback(err.kind, key);
      if (result) return result;
      throw err;
    }
  }

  return {
    id: 'router',
    // Which providers sit behind the router (for start-up logs and tests).
    providerIds: keys.map((k) => providers[k].id),
    model: defaultSpec.model,
    // A configured provider's capabilities, or null when it is not set up.
    capsOf(key) { return providers[key] ? caps(providers[key]) : null; },
    capabilities() {
      const all = keys.map((k) => caps(providers[k]));
      return {
        local: keys.some((k) => isOwn(providers[k])),
        dataLeavesServer: all.some((c) => c.dataLeavesServer),
        vision: all.some((c) => c.vision !== false),
        pdf: all.some((c) => c.pdf !== false)
      };
    },

    // Every model each provider can use, as "provider:model". A provider whose
    // list cannot be read is reported as "provider:*" (trust the settings).
    async listModels() {
      const out = [];
      for (const k of new Set(keys)) {
        try {
          for (const id of await providers[k].listModels()) out.push(k + ':' + id);
        } catch (err) {
          if (RETRYABLE.has(err?.kind)) markDown(k);
          out.push(k + ':*');
        }
      }
      return out;
    },

    // True when something can answer: a GPT provider is configured, or the
    // own model is up.
    async healthCheck() {
      if (keys.some((k) => !isOwn(providers[k]))) return true;
      for (const k of keys) if (await healthy(k)) return true;
      return false;
    },

    // req: { system, messages, route: { provider, model, effort }, attachments, maxTokens, signal }
    // When it fails, the error carries `attempts`: every { provider, model, effort }
    // actually called for this request (the first one plus any failover), and
    // `failoverAttempted` when more than one was used.
    async generate(req) {
      const attempts = [];
      try {
        return await generateOnce(req, attempts);
      } catch (err) {
        if (err && typeof err === 'object') {
          err.attempts = attempts.map((a) => ({ ...a }));
          if (attempts.length > 1) err.failoverAttempted = true;
        }
        throw err;
      }
    }
  };
}
