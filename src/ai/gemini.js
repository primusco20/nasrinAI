import { createLocalProvider } from './local.js';

// Gemini through Google's OpenAI-compatible endpoint
// (https://generativelanguage.googleapis.com/v1beta/openai/, Bearer API key).
// The key stays on the server. On the free tier Google may use what is sent
// to improve its products, so the router only sends it messages it classifies
// as public (no contact details, no files) when GEMINI_FREE_TIER is on.
export function createGeminiProvider({ apiKey, model, freeTier = true, fetchImpl = fetch, timeoutMs = 60_000 }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required for Gemini');
  return createLocalProvider({
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model,
    apiKey,
    vision: true,
    timeoutMs,
    fetchImpl,
    id: 'gemini',
    external: true,
    trainsOnData: freeTier,
    tools: true
  });
}
