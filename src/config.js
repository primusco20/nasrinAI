// Reads settings from environment variables once, at start-up.
// Invalid or missing values stop the server in production instead of failing later.

export class ConfigError extends Error {}

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
  if (!['none', 'openai', 'fake'].includes(aiProvider)) throw new ConfigError('AI_PROVIDER: use none, openai or fake');
  if (aiProvider === 'fake' && isProduction) throw new ConfigError('AI_PROVIDER=fake is not allowed in production');
  if (aiProvider === 'openai' && !env.OPENAI_API_KEY) throw new ConfigError('AI_PROVIDER=openai needs OPENAI_API_KEY');
  let temperature = null;
  if (env.OPENAI_TEMPERATURE !== undefined && env.OPENAI_TEMPERATURE !== '') {
    temperature = Number(env.OPENAI_TEMPERATURE);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) throw new ConfigError('OPENAI_TEMPERATURE: a number from 0 to 2');
  }
  const redact = String(env.REDACT_FOR_EXTERNAL_AI ?? 'true').toLowerCase();
  if (!['true', 'false'].includes(redact)) throw new ConfigError('REDACT_FOR_EXTERNAL_AI: true or false');
  // NasrinAI tiers: what people pick in the chat. Each maps to a real model,
  // optionally with a reasoning effort: "gpt-5:high". Empty turns a tier off.
  const tierSpec = (name, value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const [model, effort, extra] = raw.split(':');
    if (extra !== undefined || !/^[A-Za-z0-9._-]{1,80}$/.test(model)) throw new ConfigError(`${name}: use a model name, optionally :low, :medium or :high`);
    if (effort !== undefined && !['minimal', 'low', 'medium', 'high'].includes(effort)) throw new ConfigError(`${name}: effort must be minimal, low, medium or high`);
    return Object.freeze({ model, effort: effort || null });
  };
  const tiers = Object.freeze({
    nasrinai: tierSpec('TIER_NASRINAI', env.TIER_NASRINAI ?? env.OPENAI_MODEL ?? 'gpt-4o-mini'),
    pro: tierSpec('TIER_PRO', env.TIER_PRO ?? 'gpt-5-mini'),
    max: tierSpec('TIER_MAX', env.TIER_MAX ?? 'gpt-5'),
    ultra: tierSpec('TIER_ULTRA', env.TIER_ULTRA ?? 'gpt-5:high')
  });
  if (!tiers.nasrinai) throw new ConfigError('TIER_NASRINAI: the default tier needs a model');
  const tierList = (name, value) => {
    const ids = String(value).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    for (const id of ids) if (!(id in tiers)) throw new ConfigError(`${name}: use nasrinai, pro, max, ultra`);
    return Object.freeze([...new Set(ids)]);
  };
  const guestTiers = tierList('TIERS_GUEST', env.TIERS_GUEST ?? 'nasrinai,pro');
  const userTiers = tierList('TIERS_USER', env.TIERS_USER ?? 'nasrinai,pro,max,ultra');
  const effort = String(env.OPENAI_REASONING_EFFORT || 'low').trim().toLowerCase();
  if (!['minimal', 'low', 'medium', 'high'].includes(effort)) throw new ConfigError('OPENAI_REASONING_EFFORT: minimal, low, medium or high');

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
    guestTtlSeconds: toInt('GUEST_SESSION_TTL_HOURS', env.GUEST_SESSION_TTL_HOURS, 24, 1, 168) * 3600,
    ai: Object.freeze({
      provider: aiProvider,
      openaiApiKey: String(env.OPENAI_API_KEY || ''),
      openaiModel: tiers.nasrinai.model,
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
      userDailyTokens: toInt('USER_DAILY_TOKEN_LIMIT', env.USER_DAILY_TOKEN_LIMIT, 100000, 0, 100000000)
    })
  });
}
