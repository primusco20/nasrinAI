// Creates a short-lived OpenAI Realtime client secret.
// The permanent OpenAI API key never leaves NasrinAI's server.
import { ProviderError } from './ai/provider.js';

const OPENAI_REALTIME_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const REALTIME_VOICES = new Set(['alloy','ash','ballad','coral','echo','sage','shimmer','verse','marin','cedar']);

export const REALTIME_VOICES_LIST = Object.freeze([...REALTIME_VOICES]);

export function createRealtime({ apiKey, fetchImpl = fetch }) {
  if (!apiKey) return null;

  return {
    async session({ model, voice = 'coral', instructions, reasoningEffort = 'low', maxOutputTokens = 512, maxSeconds = 900 }) {
      if (!/^gpt-realtime(?:-2\.1(?:-mini)?|-2|-1\.5)$/.test(String(model))) {
        throw new ProviderError('config', 'Realtime model is not allowed.');
      }
      if (!REALTIME_VOICES.has(String(voice))) {
        throw new ProviderError('config', 'Realtime voice is not allowed.');
      }
      const session = {
        type: 'realtime',
        model,
        instructions: String(instructions || 'You are NasrinAI, a helpful voice assistant. Be concise and natural.'),
        audio: {
          output: { voice },
          input: {
            turn_detection: {
              type: 'semantic_vad',
              eagerness: 'high',
              create_response: true,
              interrupt_response: true
            }
          }
        },
        output_modalities: ['audio'],
        max_output_tokens: Math.max(1, Math.min(4096, Number(maxOutputTokens) || 512))
      };
      if (reasoningEffort && reasoningEffort !== 'none') session.reasoning = { effort: reasoningEffort };
      // Keep the session itself bounded. The browser also closes at this limit;
      // this value is a safety ceiling, not a billing guarantee.
      session.expiration = { anchor: 'created_at', seconds: Math.max(60, Math.min(3600, Number(maxSeconds) || 900)) };

      const response = await fetchImpl(OPENAI_REALTIME_URL, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session })
      });
      const raw = await response.text();
      if (!response.ok) {
        let detail = '';
        try { detail = JSON.parse(raw)?.error?.message || ''; } catch {}
        throw new ProviderError(response.status === 401 || response.status === 403 ? 'config' : 'unavailable', detail || 'Realtime session could not be created.');
      }
      let data;
      try { data = JSON.parse(raw); } catch { throw new ProviderError('unavailable', 'Realtime session returned invalid data.'); }
      const value = data.value || data.client_secret?.value;
      if (!value) throw new ProviderError('unavailable', 'Realtime session did not return a client secret.');
      return { value, expiresAt: data.expires_at || data.client_secret?.expires_at || null, model, voice, maxSeconds };
    }
  };
}
