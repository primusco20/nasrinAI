import { HttpError } from './http/errors.js';
import { ProviderError } from './ai/provider.js';
import { VOICES, PREVIEW_TEXT } from './ai/speech.js';
import { plainForSpeech, splitForSpeech, speechFilter } from './ai/speech-text.js';

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
  // The engine says which voices it has (OpenAI and Gemini differ).
  const voices = engine?.voices || VOICES;
  const voiceIds = new Set(voices.map((v) => v.id));
  const provider = engine?.provider || 'openai';
  const mime = engine?.mime || 'audio/mpeg';
  const defaultVoice = engine?.defaultVoice || 'coral';
  const cache = new Map();          // `${voice}|${message id or 'preview'}` -> Buffer
  const CACHE_MAX = 60;

  function remember(key, audio) {
    cache.set(key, audio);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  async function synthesize(caller, text, voice, opts = {}) {
    const started = Date.now();
    const model = opts.fast && engine.fastModel ? engine.fastModel : engine.model;
    try {
      const audio = await engine.synthesize({ text, voice, ...opts });
      await usageLog.record(caller, {
        provider, model,
        inputTokens: Math.ceil(text.length / 4), latencyMs: Date.now() - started, outcome: 'ok'
      });
      return audio;
    } catch (err) {
      const kind = err instanceof ProviderError ? err.kind : 'unexpected';
      await usageLog.record(caller, {
        provider, model, latencyMs: Date.now() - started,
        outcome: kind === 'timeout' ? 'timeout' : 'provider_error'
      });
      (kind === 'config' || kind === 'unexpected' ? logger.error : logger.warn)('speech failed', { kind, error: err.message });
      throw unavailable();
    }
  }

  return {
    available: Boolean(engine),
    voices: engine ? voices : [],
    defaultVoice,
    mime,

    // Speaks a reply while it is still being written (the hands-free voice
    // conversation). The chat route feeds it the reply's own sentences, as
    // they are written and checked, so only what Nasrin wrote is ever spoken
    // (the same rule as above). Each sentence is turned into audio with the
    // quick voice model, all at once, and sent in order through `emit` as
    // { type: 'audio', seq, mime, data (base64 MP3) }.
    //   push(text)  more of the reply        reset()   another model took over
    //   finish()    resolves { parts, ok }   cancel()  the person left or pressed Stop
    // A problem never stops the written reply; `ok` is false and the page falls back.
    // Returns null when natural voices are off or the voice is not on the list.
    live(caller, ip, voice, emit) {
      if (!engine || typeof voice !== 'string' || !voiceIds.has(voice)) return null;
      const maxChars = config.ai.speech.maxChars;
      const FIRST_MIN = 6;     // the first words go out as soon as they are a few characters long
      const MIN = 15;          // later very short sentences wait for the next one
      let filter = speechFilter();
      let buffer = '';
      let chars = 0;
      let seq = 0;
      let generation = 0;
      let failed = false;
      let cancelled = false;
      let chain = Promise.resolve();   // keeps the audio in order
      let gate = null;                 // the hourly limit, counted once per reply

      function dispatch(text) {
        if (failed || cancelled) return;
        text = text.trim().slice(0, Math.max(0, maxChars - chars));
        if (!text) return;
        chars += text.length;
        const mine = generation;
        const n = seq++;
        gate = gate || limiter.speech(caller, ip);
        const job = (async () => {
          await gate;
          await limiter.budget(caller);
          return synthesize(caller, text, voice, { fast: true, timeoutMs: 15_000 });
        })();
        job.catch(() => {});   // handled below, in order
        chain = chain.then(async () => {
          try {
            const audio = await job;
            if (mine === generation && !cancelled && !failed) {
              emit({ type: 'audio', seq: n, mime, data: audio.toString('base64') });
            }
          } catch {
            if (mine === generation) failed = true;
          }
        });
      }

      function release(force) {
        const t = buffer.trim();
        if (!t || (!force && t.length < (seq === 0 ? FIRST_MIN : MIN))) return;
        buffer = '';
        for (const part of splitForSpeech(t, { first: 600, rest: 600 })) dispatch(part);
      }

      return {
        push(text) {
          if (failed || cancelled) return;
          buffer += (buffer ? ' ' : '') + filter(text);
          release(false);
        },
        reset() {
          generation += 1;
          filter = speechFilter();
          buffer = '';
          chars = 0;
          seq = 0;
          failed = false;
        },
        async finish() {
          release(true);
          // Never hold the reply back for long if the speech service is slow.
          let timer;
          await Promise.race([chain, new Promise((r) => { timer = setTimeout(r, 20_000); })]);
          clearTimeout(timer);
          return { parts: seq, ok: !failed && !cancelled };
        },
        cancel() { cancelled = true; }
      };
    },

    // body: { voice, message_id, part? } or { voice, preview: true }.
    // Resolves { audio (MP3 or WAV, see `mime`), parts }: long replies are read in parts, so the
    // first one (short) can start playing while the next is made.
    async speak(caller, body, ip) {
      if (!engine) throw unavailable();
      const voice = body.voice;
      if (typeof voice !== 'string' || !voiceIds.has(voice)) throw new HttpError(400, 'invalid_voice', 'Choose one of the listed voices.');

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
      if (!Number.isInteger(part) || part < 0 || part > 40) throw new HttpError(400, 'invalid_part', 'That part of the reply does not exist.');
      // Ownership first: someone else's message is a 404, before anything is counted.
      const msg = await conversations.message(caller, body.message_id);
      if (msg.role !== 'assistant') throw new HttpError(404, 'not_found', 'Not found.');

      const parts = splitForSpeech(plainForSpeech(msg.content).slice(0, config.ai.speech.maxChars));
      if (!parts.length) throw new HttpError(404, 'not_found', 'There is nothing to read aloud in that reply.');
      if (part >= parts.length) throw new HttpError(400, 'invalid_part', 'That part of the reply does not exist.');
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
