// Gemini Live API: mint a short-lived client token for browser WebSocket sessions.
// The permanent Gemini API key never leaves NasrinAI's server.
import { ProviderError } from './ai/provider.js';

const TOKEN_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
export const GEMINI_REALTIME_VOICES = Object.freeze([
  'Puck','Kore','Aoede','Charon','Fenrir','Leda','Orus','Zephyr'
]);

export function createGeminiRealtime({ apiKey, fetchImpl = fetch }) {
  if (!apiKey) return null;
  return {
    async session({ model = 'gemini-3.8-live', voice = 'Kore', instructions, maxSeconds = 300, maxOutputTokens = 256 }) {
      if (model !== 'gemini-3.8-live' && model !== 'gemini-3.8-live-extended-thinking') {
        throw new ProviderError('config', 'Gemini realtime model is not allowed.');
      }
      if (!GEMINI_REALTIME_VOICES.includes(String(voice))) {
        throw new ProviderError('config', 'Gemini realtime voice is not allowed.');
      }
      const createdAt = Date.now();
      // Expire the browser credential no later than the configured session
      // duration (and no later than the provider's 30-minute token ceiling).
      const sessionLifetimeSeconds = Math.max(60, Math.min(1800, Number(maxSeconds) || 300));
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uses: 1,
          expireTime: new Date(createdAt + sessionLifetimeSeconds * 1000).toISOString(),
          newSessionExpireTime: new Date(createdAt + 60 * 1000).toISOString(),
          liveConnectConstraints: {
            model,
            config: {
              responseModalities: ['AUDIO'],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              sessionResumption: {},
              systemInstruction: {
                parts: [{ text: String(instructions || 'You are NasrinAI. Keep replies brief, accurate, natural, and safe.') }]
              },
              generationConfig: {
                maxOutputTokens: Math.max(1, Math.min(1024, Number(maxOutputTokens) || 256))
              }
            }
          }
        })
      });
      const raw = await response.text();
      if (!response.ok) {
        let detail = '';
        try { detail = JSON.parse(raw)?.error?.message || ''; } catch {}
        throw new ProviderError(response.status === 401 || response.status === 403 ? 'config' : 'unavailable', detail || 'Gemini realtime session could not be created.');
      }
      let data;
      try { data = JSON.parse(raw); } catch { throw new ProviderError('unavailable', 'Gemini realtime session returned invalid data.'); }
      if (!data.name) throw new ProviderError('unavailable', 'Gemini realtime session did not return an ephemeral token.');
      return {
        value: data.name,
        provider: 'gemini',
        model,
        voice,
        maxSeconds,
        instructions: String(instructions || 'You are NasrinAI. Be natural, concise, accurate, and interruptible.')
      };
    }
  };
}
