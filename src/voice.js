import { HttpError } from './http/errors.js';
import { ProviderError } from './ai/provider.js';
import { VOICES, VOICE_IDS, PREVIEW_TEXT } from './ai/speech.js';
import { plainForSpeech, splitForSpeech } from './ai/speech-text.js';

// Reading replies aloud with natural voices.
//
// Only two things can be spoken, so this cannot become a free text-to-speech
// service for anyone (audit finding H2):
//   - a reply Nasrin wrote, in a conversation the caller owns
//   - the fixed preview line, to hear what a voice sounds like
// Limited per caller and per IP, counted against the daily budget, recorded
// in usage. Finished audio is kept in memory briefly so a replay is free.

const unavailable = () => new HttpError(503, 'speech_unavailable', 'Voice replies are not available right now. Try your phone’s voice in Settings.');

export function createVoice({ engine, conversations, limiter, usageLog, config, logger }) {
  const cache = new Map();          // `${voice}|${message id or 'preview'}` -> Buffer
  const CACHE_MAX = 60;

  function remember(key, audio) {
    cache.set(key, audio);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  async function synthesize(caller, text, voice) {
    const started = Date.now();
    try {
      const audio = await engine.synthesize({ text, voice });
      await usageLog.record(caller, {
        provider: 'openai', model: engine.model,
        inputTokens: Math.ceil(text.length / 4), latencyMs: Date.now() - started, outcome: 'ok'
      });
      return audio;
    } catch (err) {
      const kind = err instanceof ProviderError ? err.kind : 'unexpected';
      await usageLog.record(caller, {
        provider: 'openai', model: engine.model, latencyMs: Date.now() - started,
        outcome: kind === 'timeout' ? 'timeout' : 'provider_error'
      });
      (kind === 'config' || kind === 'unexpected' ? logger.error : logger.warn)('speech failed', { kind, error: err.message });
      throw unavailable();
    }
  }

  return {
    available: Boolean(engine),
    voices: engine ? VOICES : [],
    defaultVoice: 'coral',

    // body: { voice, message_id, part? } or { voice, preview: true }.
    // Resolves { audio (MP3), parts }: long replies are read in parts, so the
    // first one (short) can start playing while the next is made.
    async speak(caller, body, ip) {
      if (!engine) throw unavailable();
      const voice = body.voice;
      if (typeof voice !== 'string' || !VOICE_IDS.has(voice)) throw new HttpError(400, 'invalid_voice', 'Choose one of the listed voices.');

      if (body.preview === true) {
        const key = voice + '|preview';
        if (cache.has(key)) return { audio: cache.get(key), parts: 1 };
        await limiter.speech(caller, ip);
        const audio = await synthesize(caller, PREVIEW_TEXT, voice);
        remember(key, audio);
        return { audio, parts: 1 };
      }

      if (typeof body.message_id !== 'string') throw new HttpError(400, 'invalid_message', 'Say which reply to read.');
      const part = body.part === undefined ? 0 : body.part;
      if (!Number.isInteger(part) || part < 0 || part > 40) throw new HttpError(400, 'invalid_part', 'Unknown part.');
      // Ownership first: someone else's message is a 404, before anything is counted.
      const msg = await conversations.message(caller, body.message_id);
      if (msg.role !== 'assistant') throw new HttpError(404, 'not_found', 'Not found.');

      const parts = splitForSpeech(plainForSpeech(msg.content).slice(0, config.ai.speech.maxChars));
      if (!parts.length) throw new HttpError(404, 'not_found', 'Nothing to read.');
      if (part >= parts.length) throw new HttpError(400, 'invalid_part', 'Unknown part.');
      const key = voice + '|' + msg.id + '|' + part;
      if (cache.has(key)) return { audio: cache.get(key), parts: parts.length };
      // The whole reply counts once against the hourly limit (on its first part).
      if (part === 0) await limiter.speech(caller, ip);
      await limiter.budget(caller);
      const audio = await synthesize(caller, parts[part], voice);
      remember(key, audio);
      return { audio, parts: parts.length };
    }
  };
}
