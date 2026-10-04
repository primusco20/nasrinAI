// Reads settings from environment variables once, at start-up.
// Invalid values stop the server in production instead of failing later.

export class ConfigError extends Error {}

function toInt(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`expected an integer between ${min} and ${max}, got "${value}"`);
  }
  return n;
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  return Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: toInt(env.PORT, 10000, 1, 65535),
    // How many proxies sit in front of the server (Render adds one).
    // Used to pick the real client IP from X-Forwarded-For.
    trustProxyHops: toInt(env.TRUST_PROXY_HOPS, 1, 0, 5),
    maxBodyBytes: 16 * 1024
  });
}
