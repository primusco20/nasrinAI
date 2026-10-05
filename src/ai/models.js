import { HttpError } from '../http/errors.js';

// NasrinAI tiers. People pick a tier; only the server knows which model (and
// reasoning effort) is behind it, set by the owner with TIER_* settings.
//
// - NasrinAI is the default and is open to everyone.
// - Guests may pick the tiers in TIERS_GUEST; signed-in users and business
//   servers the tiers in TIERS_USER.
// - A tier is offered only if the OpenAI key can use its model (checked
//   hourly). If that check fails, the configured tiers are trusted.
// - A tier whose model the provider refuses is set aside for an hour.

export const TIERS = Object.freeze([
  { id: 'nasrinai', name: 'NasrinAI' },
  { id: 'pro', name: 'Pro' },
  { id: 'max', name: 'Max' },
  { id: 'ultra', name: 'Ultra' }
]);
export const DEFAULT_TIER = 'nasrinai';

export function createModelCatalog({ provider, config, logger, now = () => Date.now(), cacheMs = 3600_000 }) {
  const { tiers, guestTiers, userTiers } = config.ai;
  const unusable = new Map();             // tier id -> until (ms)
  let cache = { at: 0, ids: null };
  let loading = null;

  // The model ids the key can use, or null when that cannot be checked.
  async function keyModels() {
    if (!provider) return new Set();
    if (cache.ids && now() - cache.at < cacheMs) return cache.ids;
    if (!loading) {
      loading = provider.listModels()
        .then((ids) => { cache = { at: now(), ids: new Set(ids) }; return cache.ids; })
        .catch((err) => { logger.warn('model list unavailable', { error: err.message }); return cache.ids; })
        .finally(() => { loading = null; });
    }
    return loading;
  }

  function offered(caller, id, available) {
    const spec = tiers[id];
    if (!spec) return false;
    if (id !== DEFAULT_TIER) {
      const allowed = caller.actor.type === 'guest' ? guestTiers : userTiers;
      if (!allowed.includes(id)) return false;
      const until = unusable.get(id);
      if (until && until > now()) return false;
      if (available && !available.has(spec.model)) return false;
    }
    return true;
  }

  return {
    // The tiers this caller may pick: [{ id, name }], and the default.
    // With showLocked, guests also get the tiers they could use after signing
    // in, marked { locked: true }, so the page can offer sign-in.
    async listFor(caller, { showLocked = false } = {}) {
      if (!provider) return { models: [], default: null };
      const available = await keyModels();
      const models = [];
      for (const t of TIERS) {
        if (offered(caller, t.id, available)) models.push({ id: t.id, name: t.name });
        else if (showLocked && caller.actor.type === 'guest' && offered({ ...caller, actor: { type: 'user', id: '' } }, t.id, available)) {
          models.push({ id: t.id, name: t.name, locked: true });
        }
      }
      return { models, default: DEFAULT_TIER };
    },

    // The tier, model and effort for this request, or a 400.
    async resolve(caller, requested) {
      const id = requested === undefined || requested === null || requested === '' ? DEFAULT_TIER : requested;
      if (typeof id !== 'string' || !TIERS.some((t) => t.id === id)) {
        throw new HttpError(400, 'invalid_model', 'Choose NasrinAI, Pro, Max or Ultra.');
      }
      if (!offered(caller, id, await keyModels())) {
        const name = TIERS.find((t) => t.id === id).name;
        throw new HttpError(400, 'model_not_allowed',
          caller.actor.type === 'guest' && userTiers.includes(id)
            ? `Sign in to use ${name}.`
            : `${name} is not available right now. Choose another option.`);
      }
      const spec = tiers[id];
      return { tier: id, model: spec.model, effort: spec.effort };
    },

    // Called when the provider refuses a tier's model. The default is never set aside.
    markUnusable(id) {
      if (id === DEFAULT_TIER) return;
      unusable.set(id, now() + cacheMs);
      logger.warn('tier set aside for an hour', { tier: id, model: tiers[id]?.model });
    }
  };
}
