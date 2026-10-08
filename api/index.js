// Vercel entry point. vercel.json sends /v1/* and /healthz here; the page
// files in public/ are served by Vercel's CDN. Locally and on other hosts,
// server.js runs the same app.
import { loadConfig, ConfigError } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { buildApp } from '../src/main.js';

const logger = createLogger();
let app = null;

function startupError(err) {
  return {
    name: String(err?.name || 'Error'),
    message: String(err?.message || err || 'unknown startup error').slice(0, 500)
  };
}

// Diagnostic metadata is deliberately limited to non-secret configuration
// state. Never log API keys, tokens, or their values.
function runtimeProviderPresence() {
  const present = (name) =>
    typeof process.env[name] === 'string' && process.env[name].trim() !== '';

  return {
    nodeEnv: String(process.env.NODE_ENV || ''),
    vercelEnv: String(process.env.VERCEL_ENV || ''),
    aiProvider: String(process.env.AI_PROVIDER || 'none').trim().toLowerCase(),
    openaiKeyPresent: present('OPENAI_API_KEY'),
    anthropicKeyPresent: present('ANTHROPIC_API_KEY'),
    geminiKeyPresent: present('GEMINI_API_KEY'),
    routeLevel1Set: present('ROUTE_LEVEL_1'),
    routing: String(process.env.ROUTING || '').trim().toLowerCase() || '(default)'
  };
}

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
    logger.error('application initialization failed', {
      stage: 'buildApp',
      error: startupError(err)
    });
  }
} catch (err) {
  // Keep the function alive and fail closed. Do not expose internal startup
  // details to clients; the sanitized error is available in Vercel logs.
  logger.error('configuration initialization failed', {
    stage: 'loadConfig',
    error: startupError(err),
    config_error: err instanceof ConfigError,
    runtime: runtimeProviderPresence()
  });
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
