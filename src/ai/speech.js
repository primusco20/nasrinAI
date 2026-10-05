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

export function createOpenAISpeech({ apiKey, model = 'gpt-4o-mini-tts', fetchImpl = fetch, timeoutMs = 45_000 }) {
  const instructions = 'Speak warmly and naturally, like a helpful friend. Use the language the text is written in.';
  return {
    model,
    async synthesize({ text, voice }) {
      const body = { model, voice, input: text, response_format: 'mp3' };
      // Only the gpt-4o speech models accept delivery instructions.
      if (model.startsWith('gpt-4o')) body.instructions = instructions;
      let resp;
      try {
        resp = await fetchImpl('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs)
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
  };
}
