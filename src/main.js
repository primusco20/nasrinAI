import { createRealtime } from './realtime.js';
import { createGeminiRealtime } from './gemini-realtime.js';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createApp } from './http/app.js';
import { createOwnerConsole } from './owner-console.js';
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
import { createOpenRouterClient, createOpenRouterVideoProvider } from './ai/openrouter.js';
import { createVideos } from './videos.js';
import { createElevenLabs } from './elevenlabs.js';
import { createVideoStudioExporter } from './video-studio-export.js';
import { createVideoStudioRenderWorker } from './video-studio-render-worker.js';
import { createPayMongo } from './payments/paymongo.js';
import { createPolicy } from './ai/policy.js';
import { createBudget } from './ai/budget.js';
import { loadPrices } from './ai/pricing.js';
import { createWebSearch } from './web/search.js';
import { createGoogleWebSearch } from './web/google-search.js';
import { createGeminiImage, createOpenAIImage, createOpenRouterImage } from './ai/image.js';
import { createImages } from './images.js';
import { basicTools } from './tools/basic.js';
import { createConnectors } from './connectors/index.js';
import { createConfirmations } from './tools/confirm.js';
import { createFacebook } from './channels/facebook.js';
import { createKnowledge } from './knowledge/index.js';
import { createMemory, memoryTools } from './knowledge/memory.js';
import { createCommunityLearning } from './knowledge/community-learning.js';
import { createFounderKnowledge } from './knowledge/founder.js';
import { createProductKnowledge } from './knowledge/product.js';
import { imagePrice } from './ai/pricing.js';
import { createOpenAISpeech, createGeminiSpeech, createOpenRouterSpeech, createResponsiveSpeech } from './ai/speech.js';
import { createVoice } from './voice.js';
import { createStorage } from './storage.js';
import { createUploads } from './uploads.js';
import { createVideoStudioAssets } from './video-studio-assets.js';
import { createResearch } from './research.js';
import { createProjects } from './projects.js';
import { createNcc } from './ncc.js';
import { createLibrary } from './library.js';
import { createConnect } from './connect/index.js';
import { createInstallRegistry } from './connect/provider-registry.js';
import { createSemanticCache } from './semanticCache.js';
import { createOpenAIEmbedder } from './ai/embeddings.js';
import { createOpenAITranscription, createOpenRouterTranscription } from './ai/transcription.js';
import { createOpenAIPdfOcr } from './ai/pdf-ocr.js';
import { createWebAnswers } from './web-answers.js';
import { createGithub } from './github/index.js';
import { createGoogleIntegration } from './google/index.js';
import { createGoogleReadWriteTools } from './google/read-write.js';
import { createCite } from './web/cite.js';
import { createSiteIcons } from './web/site-icon.js';
import { createImageSearch } from './web/image-search.js';
import { createPagePreviews } from './web/page-preview.js';
import { createWebCrawler } from './web/crawler.js';
import { createYouTubeSearch } from './web/youtube.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC_DIR = path.join(here, '..', 'public');

// Minimal server-only PostgREST/RPC adapter for the semantic cache. Keep this
// dependency-free so importing the app in tests does not require the Supabase SDK.
function createSemanticCacheClient({ url, secretKey, fetchImpl = fetch }) {
  async function request(path, body, extraHeaders = {}) {
    const response = await fetchImpl(url + '/rest/v1/' + path, {
      method: 'POST',
      headers: {
        apikey: secretKey,
        Authorization: 'Bearer ' + secretKey,
        'Content-Type': 'application/json',
        ...extraHeaders
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof data?.message === 'string' ? data.message : 'Supabase request failed';
      return { data: null, error: { message, code: data?.code || String(response.status) } };
    }
    return { data, error: null };
  }
  return {
    rpc: (name, args) => request('rpc/' + name, args),
    from: (table) => ({
      insert: (row) => request(table, row, { Prefer: 'return=minimal' })
    })
  };
}

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
  const openRouterClient = config.ai.openrouterApiKey ? createOpenRouterClient({ apiKey: config.ai.openrouterApiKey }) : null;
  const gateway = createGateway({ store, guestSecret, verifyUser });
  const settings = verifyUser ? createSettings({ url: config.supabaseUrl, publishableKey: config.supabasePublishableKey, forgetToken: verifyUser.forget }) : null;
  const plans = createPlans({ store, config: effective, logger });
  const limiter = createLimiter({ store, limits: config.limits, plans });
  const uploads = config.uploads?.enabled ? createUploads({ config, limiter, logger }) : null;
  const videoStudioAssets = config.supabaseUrl && config.supabaseSecretKey ? createVideoStudioAssets({ config: effective, limiter, logger }) : null;
  const usageLog = createUsageLog({ store, logger });
  const conversations = createConversations({ store, config: effective, logger });
  const prices = loadPrices();
  // OpenRouter model selection reads the official live catalog in its adapter;
  // actual billing comes from OpenRouter usage.cost. Do not use local OpenRouter
  // snapshots or MODEL_PRICES_JSON to gate calls.
  delete prices.openrouter;
  const reasoningBudget = createBudget({ store, config: effective, logger });
  // Optional acceleration only: cache errors never make chat unavailable.
  // Embeddings come from OpenAI's API (src/ai/embeddings.js): the earlier
  // on-device model could not load on Vercel, so the cache never filled.
  const embedder = config.supabaseUrl && config.supabaseSecretKey && config.ai.openaiApiKey
    ? createOpenAIEmbedder({ apiKey: config.ai.openaiApiKey })
    : null;
  const semanticCache = embedder
    ? createSemanticCache({
        supabase: createSemanticCacheClient({ url: config.supabaseUrl, secretKey: config.supabaseSecretKey }),
        embed: (text) => embedder.embed(text),
        modelName: embedder.modelName
      })
    : null;
  const provider = providerFromConfig(config, { logger });
  if (provider) logger.info('AI provider ready', { provider: provider.id, model: provider.model });
  else logger.warn('AI_PROVIDER is none: chat will answer "unavailable"');
  const models = createModelCatalog({ provider, config: effective, logger });
  const admin = config.supabaseUrl ? createSupabaseAdmin({ url: config.supabaseUrl, serviceKey: config.supabaseSecretKey }) : null;
  const legal = createLegal({ store, config: effective, logger, deleteAuthUser: admin ? (id) => admin.deleteUser(id) : null });
  const payments = config.paymongo ? createPayMongo(config.paymongo) : null;
  const policy = provider && config.ai.routing.mode === 'smart'
    ? createPolicy({ config: effective, provider, prices, budget: reasoningBudget, logger })
    : null;
  const googleWebSearch = config.web.googleApiKey && config.web.googleEngineId
    ? createGoogleWebSearch({ apiKey: config.web.googleApiKey, engineId: config.web.googleEngineId })
    : null;
  if (googleWebSearch?.available) logger.info('Google web search adapter ready');
  const openRouterSearchEnabled = Boolean(config.web.searchModel && config.ai.openrouterApiKey);
  const webSearch = openRouterSearchEnabled || googleWebSearch?.available
    ? createWebSearch({ apiKey: openRouterSearchEnabled ? config.ai.openrouterApiKey : '', model: config.web.searchModel || 'openrouter/auto', googleSearch: googleWebSearch, baseUrl: 'https://openrouter.ai/api/v1' })
    : null;
  if (webSearch) logger.info('web search ready', { primary: openRouterSearchEnabled ? 'openrouter' : 'google-fallback', fallback: googleWebSearch?.available ? 'google' : 'none' });
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
        : slot.provider === 'openrouter'
          ? createOpenRouterImage({ client: openRouterClient, model: slot.model, quality: slot.quality, price, timeoutMs: ms })
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
  const videoProviders = effective.video?.enabled
    ? effective.video.provider === 'openrouter'
      ? Object.fromEntries(Object.entries(effective.video.tierRoutes || {}).map(([tier, route]) => [tier, createOpenRouterVideoProvider({
          client: openRouterClient,
          model: route.model, tier, maxSeconds: 8, resolution: route.resolution, allowedResolutions: route.allowedResolutions, allowedFrameRates: route.allowedFrameRates, allow4kAddon: route.allow4kAddon === true
        })]))
      : Object.fromEntries(['max', 'ultra'].map((tier) => [tier, createVideoProvider({ apiKey: config.ai.geminiApiKey, model: effective.video.model, resolution: effective.video.resolution })]))
    : null;
  const videos = createVideos({ store, plans, provider: videoProviders, limiter, usageLog, budget: reasoningBudget, config: effective, logger });
  const elevenlabs = createElevenLabs({ apiKey: process.env.ELEVENLABS_API_KEY || '' });
  const videoStudioExporter = createVideoStudioExporter();
  const videoStudioRenderWorker = config.supabaseUrl && config.supabaseSecretKey
    ? createVideoStudioRenderWorker({ config: effective, logger }) : null;
  // Tools: the basic ones for everyone, plus each business's own connectors.
  const knowledge = createKnowledge({ store, logger });
  const memory = createMemory({ store, logger });
  const communityLearning = createCommunityLearning({ store, logger });
  const library = createLibrary({ store, limiter, config: effective, logger });
  const projects = createProjects({ store, conversations, limiter, config: effective, logger });
  const ncc = createNcc({ store, limiter, config: effective, logger });
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
  const productKnowledge = createProductKnowledge();
  const github = createGithub({ config: effective, store, logger });
  const google = createGoogleIntegration({ config: effective, logger });
  const googleReadWrite = createGoogleReadWriteTools({ google, config: effective, logger });
  if (google.available) logger.info('Google Gmail/Calendar integration ready');
  const connectors = createConnectors({ store, baseTools: [...basicTools, ...memoryTools({ store }), ...github.tools, ...google.tools, ...googleReadWrite.tools], usageLog, config: effective, logger });
  const tools = config.tools.enabled ? connectors.toolbox : null;
  const confirmations = tools ? createConfirmations({ secret: guestSecret, store, tools, conversations, logger }) : null;
  const coding = createCoding({ store, config: effective });
  const crawler = config.supabaseUrl ? createWebCrawler({ store, logger }) : null;
  const research = config.research?.enabled ? createResearch({ store, limiter, library, webAnswers: createWebAnswers({ store, logger }), usageLog, provider, webSearch, crawler, config: effective, logger }) : null;
  const chat = createChat({ conversations, limiter, uploads, webAnswers: createWebAnswers({ store, logger }), usageLog, provider, models, coding, plans, policy, semanticCache, legal, webSearch, tools, confirmations, knowledge, memory, communityLearning, library, projects, storage, founder, productKnowledge, prices, budget: reasoningBudget, config: effective, logger });
  const facebook = config.facebook ? createFacebook({ config: effective, store, chat, conversations, logger }) : null;
  if (facebook) logger.info('messenger on');
  const sp = config.ai.speech;
  const openrouterSpeech = sp.enabled && sp.provider === 'openrouter' && openRouterClient
    ? createOpenRouterSpeech({ client: openRouterClient, model: sp.openrouterModel, provider: sp.openrouterProvider, rate: sp.rate, responseFormat: 'wav' })
    : null;
  const openaiSpeech = sp.enabled && config.ai.openaiApiKey
    ? createOpenAISpeech({ apiKey: config.ai.openaiApiKey, model: sp.model, fastModel: sp.fastModel, rate: sp.rate, responseFormat: 'wav' })
    : null;
  const geminiSpeech = sp.enabled && config.ai.geminiApiKey
    ? createGeminiSpeech({ apiKey: config.ai.geminiApiKey, model: sp.geminiModel, fastModel: sp.geminiFastModel, rate: sp.rate })
    : null;
  const engine = !sp.enabled ? null
    : sp.provider === 'openrouter' ? openrouterSpeech
    : sp.responsive && sp.provider === 'openai' && openaiSpeech && geminiSpeech
      ? createResponsiveSpeech({ openai: openaiSpeech, gemini: geminiSpeech, timeoutMs: sp.responsiveTimeoutMs })
      : sp.provider === 'gemini'
        ? geminiSpeech
        : openaiSpeech;
  const voice = createVoice({ engine, engines: { openai: openaiSpeech, gemini: geminiSpeech, openrouter: openrouterSpeech }, conversations, limiter, usageLog, budget: reasoningBudget, config: effective, logger });
  const transcription = config.ai.openaiApiKey
    ? createOpenAITranscription({ apiKey: config.ai.openaiApiKey })
    : openRouterClient ? createOpenRouterTranscription({ client: openRouterClient, model: String(process.env.OPENROUTER_STT_MODEL || '').trim() }) : null;
  const pdfOcr = config.ai.openaiApiKey ? createOpenAIPdfOcr({ apiKey: config.ai.openaiApiKey }) : null;

  const auth = config.auth.email || config.auth.google
    ? createSupabaseAuth({ url: config.supabaseUrl, publishableKey: config.supabasePublishableKey })
    : null;

  return createApp({
    config: effective,
    logger,
    gateway,
    ownerConsole: createOwnerConsole({ config: effective, verifyUser, store, limiter, clientIp: (req) => clientIpFrom(req, config.trustProxyHops), logger }),
    routes: buildRoutes({ config: effective, gateway, store, limiter, usageLog, conversations, chat, provider, models, voice, realtime: createRealtime({ apiKey: config.ai.openaiApiKey }), geminiRealtime: createGeminiRealtime({ apiKey: config.ai.geminiApiKey }), auth, plans, payments, images, videos, legal, connectors: connectors.manage, confirmations, facebook, hooks: [...connectors.routes, ...github.routes, ...google.routes], knowledge, memory, settings, library, projects, ncc, storage, uploads, videoStudioAssets, research, crawler, cite: createCite({ limiter }), siteIcons: createSiteIcons(), pagePreviews: createPagePreviews(), youtubeSearch: createYouTubeSearch({ apiKey: process.env.YOUTUBE_DATA_API_KEY }), imageSearch: createImageSearch(), connect, transcription, pdfOcr, elevenlabs, videoStudioExporter, videoStudioRenderWorker, budget: reasoningBudget, logger }),
    serveStatic: createStatic(PUBLIC_DIR),
    clientIp: (req) => clientIpFrom(req, config.trustProxyHops)
  });
}
