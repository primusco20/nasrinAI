import { createOpenAIProvider } from './openai.js';
import { createFakeProvider } from './fake.js';
import { createLocalProvider } from './local.js';
import { createRouter } from './router.js';
import { createGeminiProvider } from './gemini.js';
import { assertProvider } from './provider.js';

// Builds the providers the settings ask for and puts the router in front.
//   AI_PROVIDER=openai  GPT only (needs OPENAI_API_KEY)
//   AI_PROVIDER=local   NasrinAI's own model only (LOCAL_AI_URL, LOCAL_AI_MODEL)
//   AI_PROVIDER=auto    both: own model first, GPT for GPT tiers and as fallback
//   AI_PROVIDER=fake    local echo, not allowed in production
//   AI_PROVIDER=none    chat answers "unavailable" (the default)
export function providerFromConfig(config, { logger = { info() {}, warn() {} } } = {}) {
  const mode = config.ai.provider;
  if (mode === 'none') return null;
  const providers = {};
  if (mode === 'openai' || mode === 'auto') {
    providers.openai = assertProvider(createOpenAIProvider({
      apiKey: config.ai.openaiApiKey,
      model: config.ai.openaiModel,
      temperature: config.ai.temperature,
      reasoningMaxTokens: config.ai.reasoningMaxTokens,
      reasoningEffort: config.ai.reasoningEffort
    }));
  }
  if (mode === 'local' || mode === 'auto') {
    const l = config.ai.local;
    providers.local = assertProvider(createLocalProvider({
      baseUrl: l.url,
      model: l.model,
      apiKey: l.apiKey,
      accessClientId: l.accessClientId,
      accessClientSecret: l.accessClientSecret,
      vision: l.vision,
      timeoutMs: l.timeoutMs
    }));
  }
  if (config.ai.geminiApiKey && mode !== 'fake') {
    const geminiModel = Object.values(config.ai.routing.levels).flat().find((s) => s.provider === 'gemini')?.model || 'gemini-3.1-flash-lite';
    providers.gemini = assertProvider(createGeminiProvider({ apiKey: config.ai.geminiApiKey, model: geminiModel, freeTier: config.ai.routing.geminiFreeTier }));
  }
  if (mode === 'fake') {
    if (config.isProduction) throw new Error('AI_PROVIDER=fake is not allowed in production');
    // Pretend every tier's model exists, so the tier menu shows locally.
    providers.fake = assertProvider(createFakeProvider({
      models: [...new Set(Object.values(config.ai.tiers).filter(Boolean).map((t) => t.model))]
    }));
  }
  return assertProvider(createRouter({ providers, config, logger }));
}
