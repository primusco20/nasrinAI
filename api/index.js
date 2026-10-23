// Vercel entry point. vercel.json sends /v1/* and /healthz here; the page
// files in public/ are served by Vercel's CDN. Locally and on other hosts,
// server.js runs the same app.
import { loadConfig, ConfigError } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { buildApp } from '../src/main.js';
import { createStartupDiagnostic } from '../src/startup-diagnostics.js';

const logger = createLogger();
let app = null;
let startupDiagnostic = null;

try {
  const config = loadConfig();
  logger.info('configuration loaded');
  try {
    app = buildApp({ config, logger });
    logger.info('application initialized');
  } catch (err) {
    // Keep the function alive and fail closed. Log the initialization stage
    // separately so Vercel logs identify whether config or app construction
    // is the source of a startup failure.
    startupDiagnostic = createStartupDiagnostic('buildApp', err);
    logger.error('application initialization failed', startupDiagnostic.log);
  }
} catch (err) {
  // Keep the function alive and fail closed. Do not expose internal startup
  // details to clients; the sanitized error is available in Vercel logs.
  startupDiagnostic = createStartupDiagnostic('loadConfig', err);
  logger.error('configuration initialization failed', { ...startupDiagnostic.log, config_error: err instanceof ConfigError });
}

// Vercel's rewrite also passes the original path as ?__path=. If the request
// arrives addressed to /api/index, put the original path back so the app's
// router sees /v1/... . Only known API, owner-console, and health paths are accepted.
export function restorePath(url) {
  const u = new URL(url || '/', 'http://local');
  const original = u.searchParams.get('__path');
  if (!original) return url;
  if (!/^\/(v1(\/[A-Za-z0-9_\-/]*)?|owner(\/[A-Za-z0-9_\-/]*)?|healthz)$/.test(original)) return url;
  u.searchParams.delete('__path');
  const rest = u.searchParams.toString();
  return original + (rest ? '?' + rest : '');
}

export default function handler(req, res) {
  req.url = restorePath(req.url);
  if (app) return app(req, res);
  const body = JSON.stringify(startupDiagnostic?.response || { error: { code: 'not_configured', message: 'NasrinAI is not set up correctly yet. Please try again later.' } });
  res.statusCode = 503;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (startupDiagnostic?.id) res.setHeader('X-NasrinAI-Incident-ID', startupDiagnostic.id);
  res.end(body);
}
