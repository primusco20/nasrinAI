import { HttpError } from '../http/errors.js';

// Which models a caller may choose.
//
// 1. The provider says which models the key can use (cached for an hour).
// 2. Only chat models are kept: no embeddings, voice, images, realtime,
//    search, moderation, or models that only work outside chat.
// 3. Dated snapshots (gpt-4o-2024-08-06) are hidden unless enabled, so the
//    menu stays short; the undated name points at the latest one.
// 4. The owner's rules decide who gets what: guests get MODELS_GUEST,
//    signed-in users and business servers get MODELS_USER, and MODELS_BLOCK
//    removes models for everyone. Patterns use * as a wildcard. The default
//    model (OPENAI_MODEL) is open to everyone unless blocked.
// 5. A model that turns out not to work for chat is set aside for an hour.

const CHAT_PREFIX = /^(gpt-|chatgpt-|o\d)/;
const NOT_CHAT = /(embedding|tts|whisper|dall-e|audio|realtime|transcribe|search|image|moderation|instruct|codex|computer-use|deep-research|-pro$|-pro-)/;
const SNAPSHOT = /-(\d{4}-\d{2}-\d{2}|\d{4})$/;
const SAFE_PATTERN = /^[a-z0-9.*_-]{1,80}$/;
const MODEL_ID = /^[A-Za-z0-9._:-]{1,80}$/;

export const isChatModel = (id) => CHAT_PREFIX.test(id) && !NOT_CHAT.test(id);
export const isSnapshot = (id) => SNAPSHOT.test(id);

// "gpt-4o*,*-mini" -> one matcher. Throws on anything but plain characters and *.
export function patternMatcher(list) {
  const parts = String(list || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const p of parts) if (!SAFE_PATTERN.test(p)) throw new Error(`invalid model pattern "${p}"`);
  const regexes = parts.map((p) => new RegExp('^' + p.replace(/[.]/g, '\\.').replace(/\*/g, '.*') + '$'));
  return (id) => regexes.some((r) => r.test(id.toLowerCase()));
}

export function createModelCatalog({ provider, config, logger, now = () => Date.now(), cacheMs = 3600_000 }) {
  const rules = config.ai.models;
  const forGuests = patternMatcher(rules.guest);
  const forUsers = patternMatcher(rules.user);
  const blocked = patternMatcher(rules.block);
  const unusable = new Map();             // model -> until (ms)
  let cache = { at: 0, ids: null };
  let loading = null;

  async function available() {
    if (!provider) return [];
    if (cache.ids && now() - cache.at < cacheMs) return cache.ids;
    if (!loading) {
      loading = provider.listModels()
        .then((ids) => {
          const chat = [...new Set(ids)]
            .filter((id) => MODEL_ID.test(id) && isChatModel(id) && (rules.showSnapshots || !isSnapshot(id)))
            .sort();
          if (!chat.includes(provider.model)) chat.unshift(provider.model);
          cache = { at: now(), ids: chat };
          return chat;
        })
        .catch((err) => {
          // Keep the last good list; with none, offer only the default model.
          logger.warn('model list unavailable', { error: err.message });
          if (cache.ids) return cache.ids;
          return [provider.model];
        })
        .finally(() => { loading = null; });
    }
    return loading;
  }

  function allowedFor(caller, id) {
    if (blocked(id)) return false;
    // The owner's default model (OPENAI_MODEL) is open to everyone unless blocked.
    if (id === provider.model) return true;
    const until = unusable.get(id);
    if (until && until > now()) return false;
    return caller.actor.type === 'guest' ? forGuests(id) : forUsers(id);
  }

  return {
    // The models this caller may pick, and the one used when they pick none.
    async listFor(caller) {
      const models = (await available()).filter((id) => allowedFor(caller, id));
      const fallback = models.includes(provider?.model) ? provider.model : models[0] || null;
      return { models, default: fallback };
    },

    // The model to use for this request, or a 400 if the caller may not use it.
    async resolve(caller, requested) {
      const { models, default: fallback } = await this.listFor(caller);
      if (requested === undefined || requested === null || requested === '') {
        if (!fallback) throw new HttpError(503, 'ai_unavailable', 'No AI model is available right now.');
        return fallback;
      }
      if (typeof requested !== 'string' || !MODEL_ID.test(requested)) {
        throw new HttpError(400, 'invalid_model', 'That is not a valid model name.');
      }
      if (!models.includes(requested)) {
        throw new HttpError(400, 'model_not_allowed',
          caller.actor.type === 'guest'
            ? 'That model is not available to guests. Pick another, or sign in.'
            : 'That model is not available. Pick another.');
      }
      return requested;
    },

    // Called when the provider refuses a model for chat.
    markUnusable(id) {
      unusable.set(id, now() + cacheMs);
      logger.warn('model set aside for an hour', { model: id });
    }
  };
}
