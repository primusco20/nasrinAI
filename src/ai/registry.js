import { createOpenAIProvider } from './openai.js';
import { createFakeProvider } from './fake.js';
import { createLocalProvider } from './local.js';
import { assertProvider } from './provider.js';

// Picks the one configured provider. Phase 4 replaces this with the policy
// router (LOCAL / GPT / AUTO); until then there is exactly one.
//   AI_PROVIDER=openai  needs OPENAI_API_KEY
//   AI_PROVIDER=local   NasrinAI's own model server, needs LOCAL_AI_URL and LOCAL_AI_MODEL
//   AI_PROVIDER=fake    local echo, not allowed in production
//   AI_PROVIDER=none    chat answers "unavailable" (the default)
export function providerFromConfig(config) {
  switch (config.ai.provider) {
    case 'openai':
      return assertProvider(createOpenAIProvider({
        apiKey: config.ai.openaiApiKey,
        model: config.ai.openaiModel,
        temperature: config.ai.temperature,
        reasoningMaxTokens: config.ai.reasoningMaxTokens,
        reasoningEffort: config.ai.reasoningEffort
      }));
    case 'local': {
      const l = config.ai.local;
      return assertProvider(createLocalProvider({
        baseUrl: l.url,
        model: config.ai.tiers.nasrinai.model,
        apiKey: l.apiKey,
        accessClientId: l.accessClientId,
        accessClientSecret: l.accessClientSecret,
        vision: l.vision,
        timeoutMs: l.timeoutMs
      }));
    }
    case 'fake':
      if (config.isProduction) throw new Error('AI_PROVIDER=fake is not allowed in production');
      // Pretend the key can use every tier's model, so the tier menu shows locally.
      return assertProvider(createFakeProvider({
        models: [...new Set(Object.values(config.ai.tiers).filter(Boolean).map((t) => t.model))]
      }));
    default:
      return null;
  }
}
