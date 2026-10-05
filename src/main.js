import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from './http/app.js';
import { createStatic } from './http/static.js';
import { createGateway } from './gateway/index.js';
import { createSupabaseStore } from './store/supabase-store.js';
import { createMemoryStore } from './store/memory-store.js';
import { createSupabaseUserVerifier } from './auth/supabase-user.js';
import { createSupabaseAuth } from './auth/supabase-auth.js';
import { clientIpFrom } from './net.js';
import { buildRoutes } from './routes.js';
import { createLimiter, createUsageLog } from './limits.js';
import { createConversations } from './conversations.js';
import { createChat } from './chat.js';
import { providerFromConfig } from './ai/registry.js';
import { createModelCatalog } from './ai/models.js';
import { createOpenAISpeech } from './ai/speech.js';
import { createVoice } from './voice.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(here, '..', 'public');

// Wires the real dependencies together. Tests call createApp with fakes instead.
export function buildApp({ config, logger }) {
  for (const w of config.warnings || []) logger.error('setting ignored', { problem: w });
  let store;
  let verifyUser = null;
  if (config.supabaseUrl) {
    store = createSupabaseStore({ url: config.supabaseUrl, serviceKey: config.supabaseServiceKey });
    if (config.supabaseAnonKey) verifyUser = createSupabaseUserVerifier({ url: config.supabaseUrl, anonKey: config.supabaseAnonKey });
  } else {
    // Only reachable outside production (config.js refuses it there).
    store = createMemoryStore();
    logger.warn('no database configured: using in-memory storage (development only)');
  }

  let guestSecret = config.guestSecret;
  if (!guestSecret) {
    guestSecret = randomBytes(32).toString('hex');
    logger.warn('GUEST_SESSION_SECRET not set: guest sessions end when the server restarts (development only)');
  }

  const effective = { ...config, guestSecret };
  const gateway = createGateway({ store, guestSecret, verifyUser });
  const limiter = createLimiter({ store, limits: config.limits });
  const usageLog = createUsageLog({ store, logger });
  const conversations = createConversations({ store, config: effective, logger });
  const provider = providerFromConfig(config);
  if (provider) logger.info('AI provider ready', { provider: provider.id, model: provider.model });
  else logger.warn('AI_PROVIDER is none: chat will answer "unavailable"');
  const models = createModelCatalog({ provider, config: effective, logger });
  const chat = createChat({ conversations, limiter, usageLog, provider, models, config: effective, logger });
  const engine = config.ai.speech.enabled ? createOpenAISpeech({ apiKey: config.ai.openaiApiKey, model: config.ai.speech.model }) : null;
  const voice = createVoice({ engine, conversations, limiter, usageLog, config: effective, logger });

  const auth = config.auth.email || config.auth.google
    ? createSupabaseAuth({ url: config.supabaseUrl, anonKey: config.supabaseAnonKey })
    : null;

  return createApp({
    config: effective,
    logger,
    gateway,
    routes: buildRoutes({ config: effective, gateway, store, limiter, usageLog, conversations, chat, provider, models, voice, auth, logger }),
    serveStatic: createStatic(PUBLIC_DIR),
    clientIp: (req) => clientIpFrom(req, config.trustProxyHops)
  });
}
