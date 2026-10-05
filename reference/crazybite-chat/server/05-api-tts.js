// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM server.js:724-787 | POST /api/tts (OpenAI text-to-speech, voices, cache, male/female)
// ---------------------------------------------------------------------------
// Smart Chat voice — OpenAI text-to-speech. The key stays on the server; the
// browser only ever posts the sentence to be spoken. Voice and model are fixed
// here, so a caller cannot pick a pricier one. If this fails for any reason the
// app quietly falls back to the phone's built-in voice.
// ---------------------------------------------------------------------------
const TTS_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
// tts-1 is the fastest to first audio; gpt-4o-mini-tts sounds more expressive but is slower.
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'tts-1';
const TTS_VOICE = TTS_VOICES.includes(process.env.OPENAI_TTS_VOICE) ? process.env.OPENAI_TTS_VOICE : 'coral';
// Only the gpt-4o TTS models accept delivery instructions; tts-1 rejects them.
const TTS_INSTRUCTIONS = 'You are Nasrin, the friendly assistant of a burger and chicken shop in Davao, Philippines. '
  + 'Speak warmly and naturally, like a helpful person on the phone: upbeat, relaxed, never robotic. Say prices in pesos. '
  + 'Speak in whatever language the text is written in, with a natural native accent.';
// Replies repeat a lot (the greeting, canned answers), so finished audio is kept
// in memory: a repeat is instant and costs nothing.
// Male / female voice: the app sends gender 'male' or 'female'. Change the voices with
// OPENAI_TTS_VOICE_MALE / OPENAI_TTS_VOICE_FEMALE (any name in TTS_VOICES above).
const TTS_VOICE_MALE = TTS_VOICES.includes(process.env.OPENAI_TTS_VOICE_MALE) ? process.env.OPENAI_TTS_VOICE_MALE : 'onyx';
const TTS_VOICE_FEMALE = TTS_VOICES.includes(process.env.OPENAI_TTS_VOICE_FEMALE) ? process.env.OPENAI_TTS_VOICE_FEMALE : TTS_VOICE;
// Speaking pace: 1.0 is normal, 1.2 is a little quicker. Change it with OPENAI_TTS_SPEED (0.5 to 2).
const TTS_SPEED = Math.min(2, Math.max(0.5, Number(process.env.OPENAI_TTS_SPEED) || 1.2));
const ttsCache = new Map();
const TTS_CACHE_MAX = 150;
const ttsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

app.post('/api/tts', ttsLimiter, async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(503).json({ error: 'Voice is not configured.' });
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > 500) return res.status(400).json({ error: 'Send between 1 and 500 characters.' });

  const gender = req.body?.gender === 'female' ? 'female' : req.body?.gender === 'male' ? 'male' : '';
  const voice = gender === 'male' ? TTS_VOICE_MALE : gender === 'female' ? TTS_VOICE_FEMALE : TTS_VOICE;
  const cacheKey = voice + '|' + text;
  const hit = ttsCache.get(cacheKey);
  if (hit) {
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': hit.length, 'Cache-Control': 'private, max-age=3600' });
    return res.send(hit);
  }

  try {
    const payload = { model: TTS_MODEL, voice, input: text, response_format: 'mp3' };
    if (TTS_MODEL.startsWith('gpt-4o')) payload.instructions = TTS_INSTRUCTIONS + (TTS_SPEED > 1.05 ? ' Speak at a brisk, quick pace.' : '');
    else payload.speed = TTS_SPEED;   // the speed setting is not available on the gpt-4o voices
    const resp = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OPENAI_API_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });
    if (!resp.ok) {
      console.error('[tts] OpenAI returned ' + resp.status + ': ' + (await resp.text()).slice(0, 200));
      return res.status(502).json({ error: 'Voice is unavailable right now.' });
    }
    const audio = Buffer.from(await resp.arrayBuffer());
    ttsCache.set(cacheKey, audio);
    if (ttsCache.size > TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value);
    res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'private, max-age=3600' });
    res.send(audio);
  } catch (err) {
    console.error('[tts] failed:', err.message);
    res.status(502).json({ error: 'Voice is unavailable right now.' });
  }
});
// @@ END VERBATIM
