import { ProviderError } from './provider.js';

// Natural voices for reading Nasrin's replies aloud, through OpenAI's speech
// API. The key stays on the server; the browser only names a voice and the
// reply to read.

export const VOICES = Object.freeze([
  { id: 'coral', name: 'Coral' },
  { id: 'nova', name: 'Nova' },
  { id: 'shimmer', name: 'Shimmer' },
  { id: 'sage', name: 'Sage' },
  { id: 'ballad', name: 'Ballad' },
  { id: 'verse', name: 'Verse' },
  { id: 'alloy', name: 'Alloy' },
  { id: 'ash', name: 'Ash' },
  { id: 'echo', name: 'Echo' },
  { id: 'fable', name: 'Fable' },
  { id: 'onyx', name: 'Onyx' }
]);
export const VOICE_IDS = new Set(VOICES.map((v) => v.id));

// The line used to preview a voice. Fixed, so a preview can never speak
// anything a caller sends.
export const PREVIEW_TEXT = 'Hi, I’m Nasrin. This is how I sound.';

// How fast to speak, in words the gpt-4o speech models follow (they take
// delivery instructions rather than a speed number).
export function paceWords(rate) {
  if (rate >= 1.6) return ' Speak fast, with short pauses.';
  if (rate >= 1.3) return ' Speak at a quick, lively pace.';
  if (rate > 1.05) return ' Speak at a slightly brisk pace, without rushing.';
  if (rate < 0.85) return ' Speak slowly and calmly.';
  return '';
}

export function createOpenAISpeech({ apiKey, model = 'gpt-4o-mini-tts', fastModel = '', rate = 1, fetchImpl = fetch, timeoutMs = 45_000 }) {
  const instructions = 'Speak warmly and naturally, like a helpful friend. Use the language the text is written in.' + paceWords(rate);
  // One request to the speech API with a given model.
  async function call({ text, voice, useModel, timeout }) {
    const body = { model: useModel, voice, input: text, response_format: 'mp3' };
    // The gpt-4o speech models take delivery instructions (pace included);
    // the older tts models take a speed number instead.
    if (useModel.startsWith('gpt-4o')) body.instructions = instructions;
    else if (rate !== 1) body.speed = rate;
    let resp;
    try {
      resp = await fetchImpl('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout)
      });
    } catch (err) {
      throw new ProviderError(err?.name === 'TimeoutError' ? 'timeout' : 'unavailable', 'OpenAI speech could not be reached');
    }
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => '')).slice(0, 200);
      throw new ProviderError(resp.status === 429 ? 'busy' : resp.status >= 500 ? 'unavailable' : 'config', `OpenAI speech answered ${resp.status}: ${detail}`, resp.status);
    }
    return Buffer.from(await resp.arrayBuffer());
  }
  const quick = fastModel && fastModel !== model ? fastModel : '';
  return {
    model,
    // The quick model used while talking (empty: always the normal model).
    fastModel: quick,
    // fast: use the low-latency model (voice conversation). If it will not
    // take this voice or setting (a 400), the normal model answers instead.
    async synthesize({ text, voice, fast = false, timeoutMs: timeout = timeoutMs }) {
      if (fast && quick) {
        try {
          return await call({ text, voice, useModel: quick, timeout });
        } catch (err) {
          if (!(err instanceof ProviderError) || err.kind !== 'config') throw err;
        }
      }
      return call({ text, voice, useModel: model, timeout });
    }
  };
}
