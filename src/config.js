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

  return Object.freeze({
    nodeEnv,
    isProduction,
    port: toInt('PORT', env.PORT, 10000, 1, 65535),
    // How many proxies sit in front of the server (Render = 1).
    trustProxyHops: toInt('TRUST_PROXY_HOPS', env.TRUST_PROXY_HOPS, 1, 0, 5),
    maxBodyBytes: 16 * 1024,
    supabaseUrl,
    supabaseAnonKey,
    supabaseServiceKey,
    guestSecret,
    guestTtlSeconds: toInt('GUEST_SESSION_TTL_HOURS', env.GUEST_SESSION_TTL_HOURS, 24, 1, 168) * 3600,
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
