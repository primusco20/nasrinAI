// Vercel entry point. vercel.json sends /v1/* and /healthz here; the page
// files in public/ are served by Vercel's CDN. Locally and on other hosts,
// server.js runs the same app.
import { loadConfig, ConfigError } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { buildApp } from '../src/main.js';

const logger = createLogger();
let app = null;

try {
  app = buildApp({ config: loadConfig(), logger });
} catch (err) {
  // A function must not exit the process. Stay up and refuse every request
  // (fail closed); the reason is in Vercel's logs.
  logger.error('invalid configuration', { error: err instanceof ConfigError ? err.message : String(err?.stack || err) });
}

// Vercel's rewrite also passes the original path as ?__path=. If the request
// arrives addressed to /api/index, put the original path back so the app's
// router sees /v1/... . Only /v1 and /healthz paths are accepted.
export function restorePath(url) {
  const u = new URL(url || '/', 'http://local');
  const original = u.searchParams.get('__path');
  if (!original) return url;
  if (!/^\/(v1(\/[A-Za-z0-9_\-/]*)?|healthz)$/.test(original)) return url;
  u.searchParams.delete('__path');
  const rest = u.searchParams.toString();
  return original + (rest ? '?' + rest : '');
}

export default function handler(req, res) {
  req.url = restorePath(req.url);
  if (app) return app(req, res);
  const body = JSON.stringify({ error: { code: 'not_configured', message: 'NasrinAI is not set up correctly yet. The server log says which setting is wrong.' } });
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}
