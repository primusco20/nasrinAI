import { createRealtime } from './realtime.js';
import { createGeminiRealtime } from './gemini-realtime.js';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from './http/app.js';
import { createStatic } from './http/static.js';
import { createGateway } from './gateway/index.js';
import { createSettings } from './settings.js';
import { createSupabaseStore } from './store/supabase-store.js';
import { createMemoryStore } from './store/memory-store.js';
import { createSupabaseUserVerifier } from './auth/supabase-user.js';
import { createSupabaseAuth, createSupabaseAdmin } from './auth/supabase-auth.js';
import { createLegal } from './legal.js';
import { clientIpFrom } from './net.js';
import { buildRoutes } from './routes.js';
import { createLimiter, createUsageLog } from './limits.js';
import { createConversations } from './conversations.js';
import { createChat } from './chat.js';
import { createCoding } from './coding.js';
import { providerFromConfig } from './ai/registry.js';
import { createModelCatalog } from './ai/models.js';
import { createPlans } from './plans.js';
import { createVideoProvider } from './ai/video.js';
import { createVideos } from './videos.js';
import { createPayMongo } from './payments/paymongo.js';
import { createPolicy } from './ai/policy.js';
import { createBudget } from './ai/budget.js';
import { loadPrices } from './ai/pricing.js';
import { createWebSearch } from './web/search.js';
import { createGeminiImage, createOpenAIImage } from './ai/image.js';
import { createImages } from './images.js';
import { basicTools } from './tools/basic.js';
import { createConnectors } from './connectors/index.js';
import { createConfirmations } from './tools/confirm.js';
import { createFacebook } from './channels/facebook.js';
import { createKnowledge } from './knowledge/index.js';
import { createMemory, memoryTools } from './knowledge/memory.js';
import { createFounderKnowledge } from './knowledge/founder.js';
import { imagePrice } from './ai/pricing.js';
import { createOpenAISpeech, createGeminiSpeech, createResponsiveSpeech } from './ai/speech.js';
import { createVoice } from './voice.js';
import { createStorage } from './storage.js';
import { createProjects } from './projects.js';
import { createLibrary } from './library.js';
import { createConnect } from './connect/index.js';
import { createInstallRegistry } from './connect/provider-registry.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(here, '..', 'public');

// Wires the real dependencies together. Tests call createApp with fakes instead.
export function buildApp({ config, logger }) {
  for (const w of config.warnings || []) logger.error('setting ignored', { problem: w });
  let store;
  let verifyUser = null;
  if (config.supabaseUrl) {
    store = createSupabaseStore({ url: config.supabaseUrl, serviceKey: config.supabaseSecretKey });
    if (config.supabasePublishableKey) verifyUser = createSupabaseUserVerifier({ url: config.supabaseUrl, publishableKey: config.supabasePublishableKey });
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
  const settings = verifyUser ? createSettings({ url: config.supabaseUrl, publishableKey: config.supabasePublishableKey, forgetToken: verifyUser.forget }) : null;
  const plans = createPlans({ store, config: effective, logger });
  const limiter = createLimiter({ store, limits: config.limits, plans });
  const usageLog = createUsageLog({ store, logger });
  const conversations = createConversations({ store, config: effective, logger });
  const provider = providerFromConfig(config, { logger });
  if (provider) logger.info('AI provider ready', { provider: provider.id, model: provider.model });
  else logger.warn('AI_PROVIDER is none: chat will answer "unavailable"');
  const models = createModelCatalog({ provider, config: effective, logger });
  const admin = config.supabaseUrl ? createSupabaseAdmin({ url: config.supabaseUrl, serviceKey: config.supabaseSecretKey }) : null;
  const legal = createLegal({ store, config: effective, logger, deleteAuthUser: admin ? (id) => admin.deleteUser(id) : null });
  const payments = config.paymongo ? createPayMongo(config.paymongo) : null;
  const prices = loadPrices(config.ai.routing.pricesJson);
  const policy = provider && config.ai.routing.mode === 'smart'
    ? createPolicy({ config: effective, provider, prices, budget: createBudget({ store, config: effective, logger }), logger })
    : null;
  const webSearch = policy && config.web.searchModel && config.ai.openaiApiKey
    ? createWebSearch({ apiKey: config.ai.openaiApiKey, model: config.web.searchModel })
    : null;
  if (policy) logger.info('smart routing on', { budget: config.ai.routing.budget });
  // Picture routes by tier. Everything must fit in the function's 120 s
  // (vercel.json): with a fallback, the primary (with its retries) gets 45 s
  // and the fallback 70 s; alone, the primary gets 105 s.
  const imageRoutes = {};
  for (const [n, t] of Object.entries(config.images.tiers)) {
    const make = (slot, ms) => {
      const price = slot.price ?? imagePrice(slot.provider, slot.model);
      if (price === null) { logger.warn('picture route has no price; it is off', { tier: Number(n), provider: slot.provider, model: slot.model }); return null; }
      const p = slot.provider === 'gemini'
        ? createGeminiImage({ apiKey: config.ai.geminiApiKey, model: slot.model, totalMs: ms })
        : createOpenAIImage({ apiKey: config.ai.openaiApiKey, model: slot.model, quality: slot.quality, timeoutMs: ms });
      return { p, price };
    };
    const primary = make(t.primary, t.fallback ? 45_000 : 105_000);
    if (!primary) continue;
    imageRoutes[n] = { primary, fallback: t.fallback ? make(t.fallback, 70_000) : null };
    logger.info('picture route ready', { tier: Number(n), primary: t.primary.model, fallback: t.fallback ? t.fallback.model : null });
  }
  const imageBudget = createBudget({ store, config: effective, logger, kind: 'image' });
  const images = createImages({ store, conversations, limiter, usageLog, routes: imageRoutes, plans, budget: imageBudget, provider, policy, legal, config: effective, logger });
  const videoProvider = effective.video?.enabled ? createVideoProvider({ apiKey: config.ai.geminiApiKey, model: effective.video.model, resolution: effective.video.resolution }) : null;
  const videos = createVideos({ store, plans, provider: videoProvider, limiter, config: effective, logger });
  // Tools: the basic ones for everyone, plus each business's own connectors.
  const knowledge = createKnowledge({ store, logger });
  const memory = createMemory({ store, logger });
  const library = createLibrary({ store, limiter, config: effective, logger });
  const projects = createProjects({ store, conversations, limiter, config: effective, logger });
  const storage = createStorage({ store, config: effective, conversations, library, logger });
  const connectProviders = createInstallRegistry({});
  const connect = createConnect({
    url: config.supabaseUrl,
    secretKey: config.supabaseSecretKey,
    createPublishableKey: store.createPublishableKey,
    revokePublishableKey: store.revokePublishableKey,
    installRegistry: connectProviders,
    // Crawled pages become ordinary business knowledge documents, so chat retrieval needs no changes.
    knowledgeSink: {
      add: (caller, doc) => knowledge.manage.add(caller, { title: doc.title, content: doc.content, source_url: doc.source_url }),
      remove: (caller, docId) => knowledge.manage.remove(caller, docId)
    }
  });
  const founder = config.founderKnowledgeUrl ? createFounderKnowledge({ url: config.founderKnowledgeUrl, logger }) : null;
  const connectors = createConnectors({ store, baseTools: [...basicTools, ...memoryTools({ store })], usageLog, config: effective, logger });
  const tools = config.tools.enabled ? connectors.toolbox : null;
  const confirmations = tools ? createConfirmations({ secret: guestSecret, store, tools, conversations, logger }) : null;
  const coding = createCoding({ store, config: effective });
  const chat = createChat({ conversations, limiter, usageLog, provider, models, coding, plans, policy, legal, webSearch, tools, confirmations, knowledge, memory, library, projects, storage, founder, prices, config: effective, logger });
  const facebook = config.facebook ? createFacebook({ config: effective, store, chat, conversations, logger }) : null;
  if (facebook) logger.info('messenger on');
  const sp = config.ai.speech;
  const openaiSpeech = sp.enabled && config.ai.openaiApiKey
    ? createOpenAISpeech({ apiKey: config.ai.openaiApiKey, model: sp.model, fastModel: sp.fastModel, rate: sp.rate, responseFormat: 'wav' })
    : null;
  const geminiSpeech = sp.enabled && config.ai.geminiApiKey
    ? createGeminiSpeech({ apiKey: config.ai.geminiApiKey, model: sp.geminiModel, fastModel: sp.geminiFastModel, rate: sp.rate })
    : null;
  const engine = !sp.enabled ? null
    : sp.responsive && sp.provider === 'openai' && openaiSpeech && geminiSpeech
      ? createResponsiveSpeech({ openai: openaiSpeech, gemini: geminiSpeech, timeoutMs: sp.responsiveTimeoutMs })
      : sp.provider === 'gemini'
        ? geminiSpeech
        : openaiSpeech;
  const voice = createVoice({ engine, engines: { openai: openaiSpeech, gemini: geminiSpeech }, conversations, limiter, usageLog, config: effective, logger });

  const auth = config.auth.email || config.auth.google
    ? createSupabaseAuth({ url: config.supabaseUrl, publishableKey: config.supabasePublishableKey })
    : null;

  return createApp({
    config: effective,
    logger,
    gateway,
    routes: buildRoutes({ config: effective, gateway, store, limiter, usageLog, conversations, chat, provider, models, voice, realtime: createRealtime({ apiKey: config.ai.openaiApiKey }), geminiRealtime: createGeminiRealtime({ apiKey: config.ai.geminiApiKey }), auth, plans, payments, images, videos, legal, connectors: connectors.manage, confirmations, facebook, hooks: connectors.routes, knowledge, memory, settings, library, projects, storage, connect, logger }),
    serveStatic: createStatic(PUBLIC_DIR),
    clientIp: (req) => clientIpFrom(req, config.trustProxyHops)
  });
}
