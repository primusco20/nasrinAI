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
    provider: 'openai',
    mime: 'audio/mpeg',
    voices: VOICES,
    defaultVoice: 'coral',
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

// ---------------------------------------------------------------------------
// Gemini speech. Same job as the OpenAI engine above: turn one piece of
// Nasrin's reply into audio. The key stays on the server.
//
// Gemini returns raw 16-bit PCM (24 kHz, mono) or, on some models, a finished
// WAV. Browsers decode WAV with no extra work, so PCM is wrapped in a WAV
// header here and no audio converter is needed.

export const GEMINI_VOICES = Object.freeze([
  ['Kore', 'Kore'], ['Aoede', 'Aoede'], ['Leda', 'Leda'], ['Zephyr', 'Zephyr'],
  ['Puck', 'Puck'], ['Charon', 'Charon'], ['Fenrir', 'Fenrir'], ['Orus', 'Orus'],
  ['Callirrhoe', 'Callirrhoe'], ['Autonoe', 'Autonoe'], ['Enceladus', 'Enceladus'],
  ['Iapetus', 'Iapetus'], ['Umbriel', 'Umbriel'], ['Algieba', 'Algieba'],
  ['Despina', 'Despina'], ['Erinome', 'Erinome'], ['Algenib', 'Algenib'],
  ['Rasalgethi', 'Rasalgethi'], ['Laomedeia', 'Laomedeia'], ['Achernar', 'Achernar'],
  ['Alnilam', 'Alnilam'], ['Schedar', 'Schedar'], ['Gacrux', 'Gacrux'],
  ['Pulcherrima', 'Pulcherrima'], ['Achird', 'Achird'], ['Zubenelgenubi', 'Zubenelgenubi'],
  ['Vindemiatrix', 'Vindemiatrix'], ['Sadachbia', 'Sadachbia'], ['Sadaltager', 'Sadaltager'],
  ['Sulafat', 'Sulafat']
].map(([id, name]) => ({ id, name })));

// Raw 16-bit little-endian PCM -> a playable WAV file.
export function pcmToWav(pcm, sampleRate = 24000, channels = 1) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);                          // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);  // bytes per second
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// How to ask for the pace: Gemini takes a plain-language direction in front of
// the text rather than a speed number.
function geminiDirection(rate) {
  const pace = rate >= 1.6 ? ', quickly, with short pauses'
    : rate >= 1.3 ? ', at a quick, lively pace'
    : rate > 1.05 ? ', at a slightly brisk pace'
    : rate < 0.85 ? ', slowly and calmly'
    : '';
  return `Say warmly and naturally, like a helpful friend${pace}: `;
}

export function createGeminiSpeech({ apiKey, model = 'gemini-3.1-flash-tts-preview', fastModel = '', rate = 1, fetchImpl = fetch, timeoutMs = 45_000 }) {
  const direction = geminiDirection(rate);

  async function call({ text, voice, useModel, timeout }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(useModel)}:generateContent`;
    const body = {
      contents: [{ parts: [{ text: direction + text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
      }
    };
    let resp;
    try {
      resp = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout)
      });
    } catch (err) {
      throw new ProviderError(err?.name === 'TimeoutError' ? 'timeout' : 'unavailable', 'Gemini speech could not be reached');
    }
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => '')).slice(0, 200);
      // 500: the preview models now and then answer with text instead of audio.
      // That is worth one more try, so it is reported as "unavailable".
      throw new ProviderError(resp.status === 429 ? 'busy' : resp.status >= 500 ? 'unavailable' : 'config', `Gemini speech answered ${resp.status}: ${detail}`, resp.status);
    }
    const json = await resp.json().catch(() => null);
    const part = json?.candidates?.[0]?.content?.parts?.find((p) => p?.inlineData?.data);
    if (!part) throw new ProviderError('unavailable', 'Gemini speech returned no audio');
    const bytes = Buffer.from(part.inlineData.data, 'base64');
    if (bytes.length > 4 && bytes.toString('ascii', 0, 4) === 'RIFF') return bytes;   // already a WAV
    const hz = Number(/rate=(\d+)/i.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
    return pcmToWav(bytes, hz);
  }

  const quick = fastModel && fastModel !== model ? fastModel : '';
  return {
    provider: 'gemini',
    mime: 'audio/wav',
    voices: GEMINI_VOICES,
    defaultVoice: 'Kore',
    previewText: PREVIEW_TEXT,
    model,
    fastModel: quick,
    async synthesize({ text, voice, fast = false, timeoutMs: timeout = timeoutMs }) {
      const useModel = fast && quick ? quick : model;
      try {
        return await call({ text, voice, useModel, timeout });
      } catch (err) {
        // One quick retry for the occasional text-instead-of-audio answer.
        if (err instanceof ProviderError && err.kind === 'unavailable' && timeout > 6000) return call({ text, voice, useModel, timeout: Math.min(timeout, 15_000) });
        throw err;
      }
    }
  };
}
