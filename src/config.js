// Reads settings from environment variables once, at start-up.
// Invalid or missing values stop the server in production instead of failing later.

import { parseKey as parseConnectorKey } from './connectors/secret.js';

export class ConfigError extends Error {}

// Reasoning efforts OpenAI models accept (each model supports a subset).
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function toInt(name, value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name}: expected an integer between ${min} and ${max}`);
  }
  return n;
}

function cleanOrigin(name, value) {
  if (!value) return '';
  try {
    const u = new URL(String(value).trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error();
    return u.origin;
  } catch {
    throw new ConfigError(`${name}: not a valid URL`);
  }
}

// What a Supabase key is, without trusting its label: legacy keys are JWTs
// with a role claim; new keys start with sb_publishable_ or sb_secret_.
export function supabaseKeyKind(key) {
  const k = String(key || '');
  if (k.startsWith('sb_secret_')) return 'secret';
  if (k.startsWith('sb_publishable_')) return 'public';
  try {
    const role = JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString('utf8')).role;
    if (role === 'service_role') return 'secret';
    if (role === 'anon') return 'public';
  } catch { /* not a JWT */ }
  return 'unknown';
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// Where NasrinAI's own model runs (AI_PROVIDER=local). Checked strictly:
// the URL and its credential travel with every message.
function localSettings(env, isProduction, auto = false) {
  let url;
  try {
    url = new URL(String(env.LOCAL_AI_URL || '').trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error();
  } catch {
    throw new ConfigError('LOCAL_AI_URL: the model server address, for example http://127.0.0.1:11434/v1');
  }
  if (url.username || url.password) throw new ConfigError('LOCAL_AI_URL: put credentials in LOCAL_AI_KEY, not in the URL');
  if (url.search || url.hash) throw new ConfigError('LOCAL_AI_URL: no ? or # parts');
  const model = String(env.LOCAL_AI_MODEL || '').trim();
  if (!model) throw new ConfigError('AI_PROVIDER=local needs LOCAL_AI_MODEL, for example llama3.1:8b');
  const apiKey = String(env.LOCAL_AI_KEY || '').trim();
  const accessClientId = String(env.LOCAL_AI_ACCESS_CLIENT_ID || '').trim();
  const accessClientSecret = String(env.LOCAL_AI_ACCESS_CLIENT_SECRET || '').trim();
  if (Boolean(accessClientId) !== Boolean(accessClientSecret)) {
    throw new ConfigError('set LOCAL_AI_ACCESS_CLIENT_ID and LOCAL_AI_ACCESS_CLIENT_SECRET together');
  }
  const onThisMachine = LOOPBACK.has(url.hostname);
  if (isProduction && !onThisMachine) {
    if (url.protocol !== 'https:') throw new ConfigError('LOCAL_AI_URL: use https:// when the model server is on another machine');
    if (!apiKey && !accessClientId) {
      throw new ConfigError('LOCAL_AI_URL is on another machine: set LOCAL_AI_KEY or the LOCAL_AI_ACCESS_* token so only NasrinAI can use it');
    }
  }
  const vision = String(env.LOCAL_AI_VISION ?? 'false').toLowerCase();
  if (!['true', 'false'].includes(vision)) throw new ConfigError('LOCAL_AI_VISION: true or false');
  return Object.freeze({
    url: url.href.replace(/\/+$/, ''),
    model,
    apiKey,
    accessClientId,
    accessClientSecret,
    vision: vision === 'true',
    // In auto mode the local model must answer soon enough to leave time for
    // the fallback within Vercel's 120 seconds.
    timeoutMs: toInt('LOCAL_AI_TIMEOUT_SECONDS', env.LOCAL_AI_TIMEOUT_SECONDS, auto ? 40 : 100, 10, auto ? 60 : 115) * 1000
  });
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  const supabaseUrl = cleanOrigin('SUPABASE_URL', env.SUPABASE_URL);
  const supabaseAnonKey = String(env.SUPABASE_ANON_KEY || '').trim();
  const supabaseServiceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const guestSecret = String(env.GUEST_SESSION_SECRET || '');

  if (isProduction) {
    const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'GUEST_SESSION_SECRET']
      .filter((k) => !env[k]);
    if (missing.length) throw new ConfigError('missing: ' + missing.join(', '));
  }
  if (guestSecret && guestSecret.length < 32) {
    throw new ConfigError('GUEST_SESSION_SECRET: use at least 32 random characters');
  }
  if (supabaseAnonKey && (supabaseAnonKey === supabaseServiceKey || supabaseKeyKind(supabaseAnonKey) === 'secret')) {
    throw new ConfigError('SUPABASE_ANON_KEY holds a secret key; put the anon / publishable key there');
  }
  if (supabaseServiceKey && supabaseKeyKind(supabaseServiceKey) === 'public') {
    throw new ConfigError('SUPABASE_SERVICE_ROLE_KEY holds the public key; put the service-role / secret key there');
  }
  if (Boolean(supabaseUrl) !== Boolean(supabaseServiceKey)) {
    throw new ConfigError('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY together');
  }

  const aiProvider = String(env.AI_PROVIDER || 'none').trim().toLowerCase();
  // GPT (openai), LOCAL (local) or AUTO (auto: own model first, GPT when it
  // is down or a tier asks for GPT).
  if (!['none', 'openai', 'local', 'auto', 'fake'].includes(aiProvider)) throw new ConfigError('AI_PROVIDER: use none, openai, local, auto or fake');
  if (aiProvider === 'fake' && isProduction) throw new ConfigError('AI_PROVIDER=fake is not allowed in production');
  if ((aiProvider === 'openai' || aiProvider === 'auto') && !env.OPENAI_API_KEY) throw new ConfigError(`AI_PROVIDER=${aiProvider} needs OPENAI_API_KEY`);
  const local = aiProvider === 'local' || aiProvider === 'auto' ? localSettings(env, isProduction, aiProvider === 'auto') : null;
  // Which providers tiers may name, and the one an unprefixed tier uses.
  const providerKeys = { openai: ['openai'], local: ['local'], auto: ['local', 'openai'], fake: ['fake'], none: ['openai'] }[aiProvider].slice();
  // Gemini (OpenAI-compatible endpoint) joins any mode when its key is set.
  const geminiKey = String(env.GEMINI_API_KEY || '').trim();
  if (geminiKey && aiProvider !== 'fake' && aiProvider !== 'none') providerKeys.push('gemini');
  const defaultKey = { openai: 'openai', local: 'local', auto: 'openai', fake: 'fake', none: 'openai' }[aiProvider];
  let temperature = null;
  if (env.OPENAI_TEMPERATURE !== undefined && env.OPENAI_TEMPERATURE !== '') {
    temperature = Number(env.OPENAI_TEMPERATURE);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new ConfigError('OPENAI_TEMPERATURE: a number from 0 to 2');
  }
  const redact = String(env.REDACT_FOR_EXTERNAL_AI ?? 'true').toLowerCase();
  if (!['true', 'false'].includes(redact)) throw new ConfigError('REDACT_FOR_EXTERNAL_AI: true or false');
  // NasrinAI tiers: what people pick in the chat. Each maps to a provider and
  // a real model. "local:" or "openai:" in front picks the provider (needed in
  // auto mode for local models); otherwise the mode's default is used.
  //   openai models:  "gpt-5", optionally with a reasoning effort: "gpt-5:high"
  //   local models:   the server's own names: "llama3.1:8b", "org/model"
  // Empty turns a tier off.
  const openaiSpec = (name, raw) => {
    const [model, effort, extra] = raw.split(':');
    if (extra !== undefined || !/^[A-Za-z0-9._-]{1,80}$/.test(model)) throw new ConfigError(`${name}: use a model name, optionally :low, :medium or :high`);
    if (effort !== undefined && !EFFORTS.includes(effort)) throw new ConfigError(`${name}: effort must be one of ${EFFORTS.join(', ')}`);
    return Object.freeze({ provider: 'openai', model, effort: effort || null });
  };
  const tierSpec = (name, value) => {
    let raw = String(value ?? '').trim();
    if (!raw) return null;
    let key = defaultKey;
    const prefixed = /^(local|openai|gemini|fake):(.+)$/.exec(raw);
    if (prefixed && aiProvider !== 'fake') {
      key = prefixed[1];
      raw = prefixed[2];
      if (!providerKeys.includes(key)) throw new ConfigError(`${name}: "${key}:" is not available (${key === 'gemini' ? 'set GEMINI_API_KEY' : `needs AI_PROVIDER=${key} or auto`})`);
    }
    if (key === 'openai') return openaiSpec(name, raw);
    if (!/^[A-Za-z0-9._/-]{1,120}(:[A-Za-z0-9._-]{1,60})?$/.test(raw)) throw new ConfigError(`${name}: not a valid model name`);
    return Object.freeze({ provider: key, model: raw, effort: null });
  };
  // Defaults: OpenAI models; with a local server, only NasrinAI (its model)
  // until the owner names a model for the others; in auto, NasrinAI is the
  // local model and Pro, Max, Ultra are GPT.
  const tiers = Object.freeze(aiProvider === 'local' ? {
    nasrinai: tierSpec('TIER_NASRINAI', env.TIER_NASRINAI || local.model),
    pro: tierSpec('TIER_PRO', env.TIER_PRO),
    max: tierSpec('TIER_MAX', env.TIER_MAX),
    ultra: tierSpec('TIER_ULTRA', env.TIER_ULTRA)
  } : aiProvider === 'auto' ? {
    nasrinai: tierSpec('TIER_NASRINAI', env.TIER_NASRINAI || 'local:' + local.model),
    pro: tierSpec('TIER_PRO', env.TIER_PRO ?? 'gpt-5-mini'),
    max: tierSpec('TIER_MAX', env.TIER_MAX ?? 'gpt-5'),
    ultra: tierSpec('TIER_ULTRA', env.TIER_ULTRA ?? 'gpt-5:high')
  } : {
    nasrinai: tierSpec('TIER_NASRINAI', env.TIER_NASRINAI ?? env.OPENAI_MODEL ?? 'gpt-4o-mini'),
    pro: tierSpec('TIER_PRO', env.TIER_PRO ?? 'gpt-5-mini'),
    max: tierSpec('TIER_MAX', env.TIER_MAX ?? 'gpt-5'),
    ultra: tierSpec('TIER_ULTRA', env.TIER_ULTRA ?? 'gpt-5:high')
  });
  if (!tiers.nasrinai) throw new ConfigError('TIER_NASRINAI: the default tier needs a model');
  // AUTO: when the own model is off or busy, answer with this GPT model instead
  // (AI_FALLBACK=none keeps every message on the own model).
  const fallbackMode = String(env.AI_FALLBACK ?? (aiProvider === 'auto' ? 'openai' : 'none')).trim().toLowerCase();
  if (!['openai', 'none'].includes(fallbackMode)) throw new ConfigError('AI_FALLBACK: openai or none');
  if (fallbackMode === 'openai' && aiProvider !== 'auto') throw new ConfigError('AI_FALLBACK=openai needs AI_PROVIDER=auto');
  const fallback = fallbackMode === 'openai' ? openaiSpec('OPENAI_FALLBACK_MODEL', String(env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini').trim()) : null;

  // Cost-aware routing (Phase 4.1). ROUTING=smart picks the cheapest capable
  // level for each message; ROUTING=fixed keeps one model per tier (TIER_*).
  // Levels: 1 cheapest/free, 2 low-cost GPT, 3 GPT-5-class, 4 GPT-6-class,
  // 5 strongest. Each ROUTE_LEVEL_n lists candidates in order of preference,
  // comma-separated, as provider:model[:effort]. Model ids live only here.
  const routingMode = String(env.ROUTING ?? (['openai', 'local', 'auto'].includes(aiProvider) ? 'smart' : 'fixed')).trim().toLowerCase();
  if (!['smart', 'fixed'].includes(routingMode)) throw new ConfigError('ROUTING: smart or fixed');
  const has = (k) => providerKeys.includes(k) && (k !== 'openai' || Boolean(env.OPENAI_API_KEY));
  const defaultsByLevel = {
    1: [has('local') && local ? 'local:' + local.model : '', has('gemini') ? 'gemini:gemini-3.1-flash-lite' : '', has('openai') ? 'openai:gpt-6-luna:none' : ''],
    2: [has('openai') ? 'openai:gpt-6-luna:low' : ''],
    3: [has('openai') ? 'openai:gpt-5.6-terra:medium' : ''],
    4: [has('openai') ? 'openai:gpt-6.1-sol:high' : ''],
    5: [has('openai') ? 'openai:gpt-6-astra:high' : '']
  };
  const levels = {};
  for (let n = 1; n <= 5; n++) {
    const raw = env['ROUTE_LEVEL_' + n];
    const list = raw !== undefined && String(raw).trim() !== '' ? String(raw).split(',') : defaultsByLevel[n];
    levels[n] = Object.freeze(list.map((x) => x.trim()).filter(Boolean).map((x) => tierSpec('ROUTE_LEVEL_' + n, x)));
    // A level with nothing configured uses the level below it.
    if (!levels[n].length && n > 1) levels[n] = levels[n - 1];
  }
  if (routingMode === 'smart' && !levels[1].length) throw new ConfigError('ROUTING=smart needs at least one model for ROUTE_LEVEL_1');
  // Which levels each tier may use: [lowest, highest]. Powerful levels must be
  // earned by the message; the tier only sets how high it may go.
  const range = (name, value, fallbackRange) => {
    const v = String(value ?? fallbackRange).trim();
    const m = /^([1-5])-([1-5])$/.exec(v);
    if (!m || Number(m[1]) > Number(m[2])) throw new ConfigError(`${name}: use a range like 1-3`);
    return Object.freeze([Number(m[1]), Number(m[2])]);
  };
  const usd = (name, value, fallbackValue) => {
    const v = value === undefined || String(value).trim() === '' ? fallbackValue : Number(String(value).trim());
    if (v === null) return null;
    if (!Number.isFinite(v) || v < 0 || v > 100000) throw new ConfigError(`${name}: a dollar amount, for example 1 or 0.25`);
    return v;
  };
  const routing = Object.freeze({
    mode: routingMode,
    levels: Object.freeze(levels),
    tierRange: Object.freeze({
      nasrinai: range('ROUTE_RANGE_NASRINAI', env.ROUTE_RANGE_NASRINAI, '1-2'),
      pro: range('ROUTE_RANGE_PRO', env.ROUTE_RANGE_PRO, '1-3'),
      max: range('ROUTE_RANGE_MAX', env.ROUTE_RANGE_MAX, '1-4'),
      ultra: range('ROUTE_RANGE_ULTRA', env.ROUTE_RANGE_ULTRA, '1-5')
    }),
    // Smallest sufficient context and output for each level (characters of
    // history, reply tokens).
    historyChars: Object.freeze({ 1: 6000, 2: 10000, 3: 16000, 4: 24000, 5: 32000 }),
    maxTokens: Object.freeze({ 1: 700, 2: 1000, 3: 1600, 4: 2400, 5: 3200 }),
    maxEscalations: toInt('MAX_ESCALATION_DEPTH', env.MAX_ESCALATION_DEPTH, 1, 0, 3),
    maxRetries: toInt('MAX_RETRIES', env.MAX_RETRIES, 1, 0, 3),
    cacheMinutes: toInt('RESPONSE_CACHE_MINUTES', env.RESPONSE_CACHE_MINUTES, 360, 0, 10080),
    geminiFreeTier: String(env.GEMINI_FREE_TIER ?? 'true').toLowerCase() !== 'false',
    pricesJson: String(env.MODEL_PRICES_JSON || '').trim(),
    // Spending limits in USD (estimated). Empty = no limit for that period.
    budget: Object.freeze({
      dailyUsd: usd('DAILY_BUDGET_USD', env.DAILY_BUDGET_USD, 0.25),
      weeklyUsd: usd('WEEKLY_BUDGET_USD', env.WEEKLY_BUDGET_USD, 1),
      monthlyUsd: usd('MONTHLY_BUDGET_USD', env.MONTHLY_BUDGET_USD, 4),
      maxRequestUsd: usd('MAX_REQUEST_COST_USD', env.MAX_REQUEST_COST_USD, 0.05)
    })
  });
  const tierList = (name, value) => {
    const ids = String(value).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    for (const id of ids) if (!(id in tiers)) throw new ConfigError(`${name}: use nasrinai, pro, max, ultra`);
    return Object.freeze([...new Set(ids)]);
  };
  const guestTiers = tierList('TIERS_GUEST', env.TIERS_GUEST ?? 'nasrinai,pro');
  const userTiers = tierList('TIERS_USER', env.TIERS_USER ?? 'nasrinai,pro,max,ultra');
  // Sign-in on the chat page (Supabase Auth). Email codes are on whenever
  // Supabase is set up; Google only after it is configured in Supabase.
  // A mistake here turns that sign-in method off (and is logged) instead of
  // taking the whole site down: off is the safe state for an optional feature.
  const warnings = [];

  // Read-aloud speed for both natural and phone voices (1 = normal).
  const SPEECH_RATE_DEFAULT = 1.15;
  let speechRate = SPEECH_RATE_DEFAULT;
  if (env.SPEECH_RATE !== undefined && String(env.SPEECH_RATE).trim() !== '') {
    const r = Number(String(env.SPEECH_RATE).trim());
    if (Number.isFinite(r) && r >= 0.5 && r <= 2) speechRate = Math.round(r * 100) / 100;
    else warnings.push(`SPEECH_RATE: use a number from 0.5 to 2, for example 1.2. Using ${SPEECH_RATE_DEFAULT}.`);
  }
  const softFlag = (name, value, fallback) => {
    const v = String(value ?? fallback).trim().toLowerCase();
    if (v === 'true' || v === 'false') return v === 'true';
    warnings.push(`${name}: use true or false. It is off until this is fixed.`);
    return false;
  };
  const canSignIn = Boolean(supabaseUrl && supabaseAnonKey);
  const authEmail = canSignIn && softFlag('AUTH_EMAIL', env.AUTH_EMAIL, 'true');
  let authGoogle = softFlag('AUTH_GOOGLE', env.AUTH_GOOGLE, 'false');
  let publicUrl = '';
  // SITE_URL: Vercel treats names starting with PUBLIC_ as public and will not
  // store them as sensitive, so the setting is called SITE_URL. PUBLIC_URL
  // still works if it was set earlier.
  const siteUrl = env.SITE_URL || env.PUBLIC_URL;
  if (siteUrl) {
    try { publicUrl = cleanOrigin('SITE_URL', siteUrl); } catch { warnings.push('SITE_URL: not a valid address, for example https://nasrinai.site'); }
  }
  if (isProduction && publicUrl && !publicUrl.startsWith('https://')) {
    warnings.push('SITE_URL: use https://');
    publicUrl = '';
  }
  if (authGoogle && !canSignIn) {
    warnings.push('AUTH_GOOGLE needs SUPABASE_URL and SUPABASE_ANON_KEY. Google sign-in is off.');
    authGoogle = false;
  }
  if (authGoogle && !publicUrl) {
    warnings.push('AUTH_GOOGLE needs SITE_URL, for example https://nasrinai.site. Google sign-in is off until it is set.');
    authGoogle = false;
  }

  // Picture routing by tier (Phase 4.2). Each tier has a primary and an
  // optional fallback: IMAGE_TIER_n_{PRIMARY,FALLBACK}_{PROVIDER,MODEL,PRICE}.
  // Tier 1 defaults to Gemini (GEMINI_API_KEY, IMAGE_MODEL) with the older
  // IMAGE_FALLBACK_MODEL / IMAGE_FALLBACK_PRICE as its fallback. Tiers 2-4
  // exist only when set. Model names and prices (USD per picture) come from
  // the providers' pricing pages; a Gemini price may come from
  // config/model-prices.json instead. A wrong slot is switched off with a
  // warning; the site keeps working.
  const imageKeys = { gemini: geminiKey, openai: String(env.OPENAI_API_KEY || '') };
  const imageSlot = (prefix, d = {}) => {
    const named = String(env[prefix + '_PROVIDER'] || d.provider || '').trim().toLowerCase();
    const provider = named === 'google' ? 'gemini' : named;   // google = gemini
    const model = String(env[prefix + '_MODEL'] || d.model || '').trim();
    const priceRaw = String(env[prefix + '_PRICE'] ?? d.price ?? '').trim();
    if (!provider && !model) return null;
    const off = (why) => { warnings.push(`${prefix}: ${why} This picture route is off.`); return null; };
    if (!(provider in imageKeys)) return off('_PROVIDER must be google (gemini) or openai.');
    if (!imageKeys[provider]) return off(`needs ${provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'}.`);
    if (!/^[a-z0-9][a-z0-9.-]{1,79}$/i.test(model)) return off('_MODEL: use the model name from the provider.');
    if (provider === 'openai' && !/^gpt-image/.test(model)) return off('_MODEL: use the GPT Image model name from OpenAI, for example gpt-image-….');
    let price = null;
    if (priceRaw) {
      price = Number(priceRaw);
      if (!Number.isFinite(price) || price <= 0 || price > 1) return off('_PRICE: the price of one picture in US dollars, for example 0.04.');
    } else if (provider !== 'gemini') return off('_PRICE: the price of one picture in US dollars is needed, for example 0.04.');
    // OpenAI's quality setting drives its price (OpenAI's default is high).
    const quality = String(env[prefix + '_QUALITY'] || '').trim().toLowerCase() || null;
    if (quality && (provider !== 'openai' || !['low', 'medium', 'high', 'xhigh', 'max', 'auto'].includes(quality))) return off('_QUALITY: low, medium, high, xhigh, max or auto (OpenAI only).');
    return Object.freeze({ provider, model, price, ...(quality ? { quality } : {}) });
  };
  const imageTiers = {};
  for (const n of [1, 2, 3, 4]) {
    const primary = imageSlot(`IMAGE_TIER_${n}_PRIMARY`, n === 1 && geminiKey ? { provider: 'gemini', model: env.IMAGE_MODEL || 'gemini-3.1-flash-lite-image' } : {});
    const legacy = n === 1 && (env.IMAGE_FALLBACK_MODEL || env.IMAGE_FALLBACK_PRICE)
      ? { provider: 'openai', model: env.IMAGE_FALLBACK_MODEL, price: env.IMAGE_FALLBACK_PRICE } : {};
    const fallback = imageSlot(`IMAGE_TIER_${n}_FALLBACK`, legacy);
    if (primary) imageTiers[n] = Object.freeze({ primary, fallback });
    else if (fallback) warnings.push(`IMAGE_TIER_${n}_FALLBACK is set without a primary. Tier ${n} pictures are off.`);
  }

  // Connectors (Phase 6): the key that encrypts businesses' API credentials.
  // 32 bytes as 64 hex characters or base64 (e.g. `openssl rand -hex 32`).
  let connectorKey = null;
  if (String(env.CONNECTOR_SECRET_KEY || '').trim()) {
    connectorKey = parseConnectorKey(env.CONNECTOR_SECRET_KEY);
    if (!connectorKey) warnings.push('CONNECTOR_SECRET_KEY: 64 hex characters (openssl rand -hex 32). Connectors with a key are off.');
  }

  // Facebook Messenger (Phase 6): one NasrinAI Meta app for every business
  // Page. On with the app secret, a verify token and CONNECTOR_SECRET_KEY
  // (Page tokens are stored encrypted with it).
  let facebook = null;
  const fbSecret = String(env.FACEBOOK_APP_SECRET || '').trim();
  const fbVerify = String(env.FACEBOOK_VERIFY_TOKEN || '').trim();
  const fbVersion = String(env.FACEBOOK_GRAPH_VERSION || '').trim();
  if (fbSecret || fbVerify) {
    if (!/^[0-9a-f]{32}$/i.test(fbSecret)) warnings.push('FACEBOOK_APP_SECRET: the 32-character App Secret from the Meta app (App settings > Basic). Messenger is off.');
    else if (fbVerify.length < 16 || fbVerify.length > 200) warnings.push('FACEBOOK_VERIFY_TOKEN: a random text of 16 or more characters, the same as in the Meta webhook setup. Messenger is off.');
    else if (fbVersion && !/^v\d{1,3}\.\d$/.test(fbVersion)) warnings.push('FACEBOOK_GRAPH_VERSION: like v23.0 (from the Meta app dashboard). Messenger is off.');
    else if (!connectorKey) warnings.push('Messenger needs CONNECTOR_SECRET_KEY (Page tokens are stored encrypted). Messenger is off.');
    else facebook = Object.freeze({ appSecret: fbSecret, verifyToken: fbVerify, graphVersion: fbVersion || null });
  }

  // The founder's public portfolio, read for questions about Nasrin Abubakar
  // (for example https://nasrinai.com/api/knowledge). Empty: off.
  let founderUrl = String(env.FOUNDER_KNOWLEDGE_URL || '').trim();
  if (founderUrl && !/^https:\/\/[^\s/?#@]+(\/[^\s]*)?$/.test(founderUrl)) {
    warnings.push('FOUNDER_KNOWLEDGE_URL: an https address, for example https://nasrinai.com/api/knowledge. It is off.');
    founderUrl = '';
  }

  // Tools in chat (Phase 5): on by default; TOOLS_ENABLED=false turns them off.
  const toolsEnabled = softFlag('TOOLS_ENABLED', env.TOOLS_ENABLED, 'true');
  // Professional AI: on by default; PROFESSIONAL_AI=false turns it off (Universal AI only).
  const professionalEnabled = softFlag('PROFESSIONAL_AI', env.PROFESSIONAL_AI, 'true');

  // Plans (Max, Ultra) for signed-in users. Prices are whole pesos; a plan
  // without a price is shown as "coming soon" and cannot be bought.
  const plansEnabled = softFlag('PLANS_ENABLED', env.PLANS_ENABLED, 'true');
  const price = (name, value) => {
    if (value === undefined || String(value).trim() === '') return null;
    const n = Number(String(value).trim());
    if (Number.isInteger(n) && n >= 20 && n <= 100000) return n;
    warnings.push(`${name}: a whole number of pesos from 20 to 100000. The plan is not for sale until this is fixed.`);
    return null;
  };

  // PayMongo: on when both keys and SITE_URL are set. A wrong or partial
  // setup turns payments off (logged); the rest of the site keeps working.
  const PAY_METHODS = new Set(['card', 'gcash', 'paymaya', 'grab_pay', 'qrph']);
  let paymongo = null;
  const pmKey = String(env.PAYMONGO_SECRET_KEY || '').trim();
  const pmHook = String(env.PAYMONGO_WEBHOOK_SECRET || '').trim();
  if (pmKey || pmHook) {
    const methods = String(env.PAYMONGO_METHODS || 'gcash,paymaya,card').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!/^sk_(test|live)_[A-Za-z0-9]{8,}$/.test(pmKey)) warnings.push('PAYMONGO_SECRET_KEY: use the secret key (sk_test_… or sk_live_…). Payments are off.');
    else if (!pmHook) warnings.push('PAYMONGO_WEBHOOK_SECRET is missing. Payments are off.');
    else if (!publicUrl) warnings.push('Payments need SITE_URL (where PayMongo sends people back). Payments are off.');
    else if (!methods.length || methods.some((x) => !PAY_METHODS.has(x))) warnings.push('PAYMONGO_METHODS: use card, gcash, paymaya, grab_pay, qrph. Payments are off.');
    else paymongo = Object.freeze({ secretKey: pmKey, webhookSecret: pmHook, methods: Object.freeze(methods) });
  }

  const effort = String(env.OPENAI_REASONING_EFFORT || 'low').trim().toLowerCase();
  if (!EFFORTS.includes(effort)) throw new ConfigError(`OPENAI_REASONING_EFFORT: one of ${EFFORTS.join(', ')}`);

  return Object.freeze({
    nodeEnv,
    isProduction,
    port: toInt('PORT', env.PORT, 10000, 1, 65535),
    // How many proxies sit in front of the server (Vercel or Render = 1).
    trustProxyHops: toInt('TRUST_PROXY_HOPS', env.TRUST_PROXY_HOPS, 1, 0, 5),
    maxBodyBytes: 16 * 1024,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceKey,
    guestSecret,
    publicUrl,
    auth: Object.freeze({ email: authEmail, google: authGoogle }),
    plans: Object.freeze({
      enabled: plansEnabled,
      periodDays: 30,
      prices: Object.freeze({ max: price('PLAN_MAX_PRICE', env.PLAN_MAX_PRICE), ultra: price('PLAN_ULTRA_PRICE', env.PLAN_ULTRA_PRICE) })
    }),
    paymongo,
    // Legal documents: versions people accept, and whether signed-in people
    // must accept the current Terms before using the service.
    legal: Object.freeze({
      terms: String(env.LEGAL_TERMS_VERSION || '2026-10-05c').trim().slice(0, 40),
      privacy: String(env.LEGAL_PRIVACY_VERSION || '2026-10-06c').trim().slice(0, 40),
      requireTerms: String(env.LEGAL_REQUIRE_TERMS ?? 'true').toLowerCase() !== 'false'
    }),
    // Pictures (Phase 4.2): Gemini image model, one image per request.
    images: Object.freeze({
      model: String(env.IMAGE_MODEL || 'gemini-3.1-flash-lite-image').trim(),
      perGuest: toInt('IMAGES_PER_GUEST', env.IMAGES_PER_GUEST, 1, 0, 20),
      perUserDay: toInt('IMAGES_USER_DAY', env.IMAGES_USER_DAY, 5, 0, 200),
      // Signed-in users on a plan, per day.
      perMaxDay: toInt('IMAGES_MAX_DAY', env.IMAGES_MAX_DAY, 20, 0, 1000),
      perUltraDay: toInt('IMAGES_ULTRA_DAY', env.IMAGES_ULTRA_DAY, 50, 0, 1000),
      // All guests together, per day: a ceiling on what guests can spend.
      guestDayTotal: toInt('IMAGES_GUEST_DAY_TOTAL', env.IMAGES_GUEST_DAY_TOTAL, 50, 0, 10000),
      // Signed-in users' pictures are deleted after this many days (owner's
      // decision: 30; 0 keeps them). Guests' go with their chats (24 hours).
      retentionDays: toInt('IMAGE_RETENTION_DAYS', env.IMAGE_RETENTION_DAYS, 30, 0, 3650),
      // Picture spending limits (USD, estimated), separate from chat budgets.
      budget: Object.freeze({
        dailyUsd: usd('IMAGE_DAILY_BUDGET_USD', env.IMAGE_DAILY_BUDGET_USD, 1),
        weeklyUsd: usd('IMAGE_WEEKLY_BUDGET_USD', env.IMAGE_WEEKLY_BUDGET_USD, 5),
        monthlyUsd: usd('IMAGE_MONTHLY_BUDGET_USD', env.IMAGE_MONTHLY_BUDGET_USD, 15)
      }),
      // Picture routes by tier: { n: { primary, fallback } } (see above).
      tiers: Object.freeze(imageTiers),
      // Tier 1's fallback (kept for older code and tests), or null.
      fallback: imageTiers[1]?.fallback ?? null
    }),
    // The internet: reading links people share, and web search for questions
    // that need fresh information (OpenAI web search tool).
    web: Object.freeze({
      links: String(env.WEB_LINKS ?? 'true').toLowerCase() !== 'false',
      searchModel: String(env.WEB_SEARCH_MODEL ?? (env.OPENAI_API_KEY && aiProvider !== 'fake' && aiProvider !== 'none' ? 'gpt-6-luna' : '')).trim()
    }),
    tools: Object.freeze({ enabled: toolsEnabled }),
    professional: Object.freeze({ enabled: professionalEnabled }),
    founderKnowledgeUrl: founderUrl || null,
    connectors: Object.freeze({ key: connectorKey }),
    facebook,
    // Settings that were wrong but only switched an optional feature off.
    warnings: Object.freeze(warnings),
    guestTtlSeconds: toInt('GUEST_SESSION_TTL_HOURS', env.GUEST_SESSION_TTL_HOURS, 24, 1, 168) * 3600,
    ai: Object.freeze({
      provider: aiProvider,
      openaiApiKey: String(env.OPENAI_API_KEY || ''),
      // The OpenAI provider's default model (usage records, health check).
      openaiModel: tiers.nasrinai.provider === 'openai' ? tiers.nasrinai.model : (fallback ? fallback.model : 'gpt-4o-mini'),
      // NasrinAI's own model server (AI_PROVIDER=local or auto), or null.
      local,
      // AUTO: the GPT model used when the own model cannot answer, or null.
      fallback,
      geminiApiKey: geminiKey,
      routing,
      temperature,
      maxReplyTokens: toInt('AI_MAX_REPLY_TOKENS', env.AI_MAX_REPLY_TOKENS, 800, 50, 8000),
      maxMessageChars: toInt('MESSAGE_MAX_CHARS', env.MESSAGE_MAX_CHARS, 4000, 100, 15000),
      historyChars: toInt('AI_HISTORY_CHARS', env.AI_HISTORY_CHARS, 12000, 1000, 100000),
      // Strip emails, phone and card numbers from what is sent to a model
      // outside this server. On by default.
      redactExternal: redact === 'true',
      // Thinking allowance for reasoning models (o-series, GPT-5), and effort.
      reasoningMaxTokens: toInt('OPENAI_REASONING_MAX_TOKENS', env.OPENAI_REASONING_MAX_TOKENS, 4000, 500, 32000),
      reasoningEffort: effort,
      // Natural voices (OpenAI speech). On when the OpenAI provider is used.
      speech: Object.freeze({
        enabled: (aiProvider === 'openai' || aiProvider === 'auto') && String(env.SPEECH_ENABLED ?? 'true').toLowerCase() !== 'false',
        model: String(env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts').trim(),
        rate: speechRate,
        maxChars: 4000
      }),
      // Files sent with a message: count, total size (decoded) and text length.
      attachments: Object.freeze({
        maxCount: toInt('ATTACHMENTS_MAX_COUNT', env.ATTACHMENTS_MAX_COUNT, 4, 0, 10),
        // Vercel accepts request bodies up to 4.5 MB; base64 adds a third.
        maxTotalBytes: toInt('ATTACHMENTS_MAX_MB', env.ATTACHMENTS_MAX_MB, 3, 1, 3) * 1024 * 1024,
        maxTextChars: 30000
      }),
      // Tiers and who may pick them. NasrinAI (the default) is open to everyone.
      tiers,
      guestTiers,
      userTiers
    }),
    // Abuse and cost limits. Hourly counts are shared by every server instance.
    limits: Object.freeze({
      guestSessionsPerIpHour: toInt('LIMIT_GUEST_SESSIONS_PER_IP_HOUR', env.LIMIT_GUEST_SESSIONS_PER_IP_HOUR, 10, 1, 1000),
      guestMessagesHour: toInt('LIMIT_GUEST_MESSAGES_HOUR', env.LIMIT_GUEST_MESSAGES_HOUR, 20, 1, 1000),
      userMessagesHour: toInt('LIMIT_USER_MESSAGES_HOUR', env.LIMIT_USER_MESSAGES_HOUR, 60, 1, 5000),
      serviceMessagesHour: toInt('LIMIT_SERVICE_MESSAGES_HOUR', env.LIMIT_SERVICE_MESSAGES_HOUR, 600, 1, 100000),
      ipMessagesHour: toInt('LIMIT_IP_MESSAGES_HOUR', env.LIMIT_IP_MESSAGES_HOUR, 120, 1, 10000),
      guestDailyTokens: toInt('GUEST_DAILY_TOKEN_CEILING', env.GUEST_DAILY_TOKEN_CEILING, 200000, 0, 100000000),
      userDailyTokens: toInt('USER_DAILY_TOKEN_LIMIT', env.USER_DAILY_TOKEN_LIMIT, 100000, 0, 100000000),
      guestSpeechHour: toInt('LIMIT_GUEST_SPEECH_HOUR', env.LIMIT_GUEST_SPEECH_HOUR, 20, 0, 1000),
      userSpeechHour: toInt('LIMIT_USER_SPEECH_HOUR', env.LIMIT_USER_SPEECH_HOUR, 120, 0, 5000),
      guestWebHour: toInt('LIMIT_GUEST_WEB_HOUR', env.LIMIT_GUEST_WEB_HOUR, 6, 0, 1000),
      userWebHour: toInt('LIMIT_USER_WEB_HOUR', env.LIMIT_USER_WEB_HOUR, 40, 0, 5000),
      // Sign-in: codes emailed per IP and per address, code tries per address, refreshes per IP.
      signInCodesIpHour: toInt('LIMIT_SIGNIN_CODES_IP_HOUR', env.LIMIT_SIGNIN_CODES_IP_HOUR, 10, 1, 1000),
      signInCodesEmailHour: toInt('LIMIT_SIGNIN_CODES_EMAIL_HOUR', env.LIMIT_SIGNIN_CODES_EMAIL_HOUR, 4, 1, 100),
      signInTriesHour: toInt('LIMIT_SIGNIN_TRIES_HOUR', env.LIMIT_SIGNIN_TRIES_HOUR, 10, 1, 100),
      signInRefreshIpHour: toInt('LIMIT_SIGNIN_REFRESH_IP_HOUR', env.LIMIT_SIGNIN_REFRESH_IP_HOUR, 300, 10, 10000)
    })
  });
}
