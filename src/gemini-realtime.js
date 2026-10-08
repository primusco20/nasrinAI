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
    async session({ model = 'gemini-3.8-live', voice = 'Kore', instructions, maxSeconds = 300 }) {
      if (model !== 'gemini-3.8-live' && model !== 'gemini-3.8-live-extended-thinking') {
        throw new ProviderError('config', 'Gemini realtime model is not allowed.');
      }
      if (!GEMINI_REALTIME_VOICES.includes(String(voice))) {
        throw new ProviderError('config', 'Gemini realtime voice is not allowed.');
      }
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uses: 1,
          expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
          liveConnectConstraints: {
            model,
            config: {
              responseModalities: ['AUDIO'],
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              sessionResumption: {}
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
