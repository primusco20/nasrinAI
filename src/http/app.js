import { randomUUID } from 'node:crypto';
import { HttpError, UpstreamError, notFound } from './errors.js';
import { readJson, readRaw } from './body.js';
import { createRouter } from './router.js';
import { setBaseHeaders, setApiHeaders, sendJson } from './headers.js';

// Builds the request handler. Every /v1 route either declares itself public or
// gets a caller from the gateway first; the gateway refuses anything it cannot
// identify (fail closed). Handlers never see an unidentified request.
//
// route: { method, path, public?: boolean, body?: boolean, raw?: boolean, maxBody?: bytes, scope?: string, handler }
export function createApp({ config, logger, gateway, routes = [], serveStatic = null, clientIp = () => '' }) {
  const router = createRouter(routes);

  return async function handle(req, res) {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    setBaseHeaders(res, config);

    let pathname = '/';
    try {
      pathname = new URL(req.url, 'http://local').pathname;

      if (pathname === '/healthz') {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(req.method === 'HEAD' ? undefined : 'ok');
        return;
      }

      if (pathname === '/v1' || pathname.startsWith('/v1/')) {
        setApiHeaders(res);
        // CORS: websites embedding the widget call the API from their own origin.
        // Access is decided by the credential (and, for publishable keys, by the
        // origin check in the gateway), never by CORS. Credentials are never
        // allowed, so reflecting the origin grants nothing. The only cookie is the
        // sign-in cookie: SameSite, path /v1/auth, and those routes refuse other sites.
        if (req.headers.origin) {
          res.setHeader('Access-Control-Allow-Origin', String(req.headers.origin));
          res.setHeader('Vary', 'Origin');
        }
        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-NasrinAI-Key');
          res.setHeader('Access-Control-Max-Age', '600');
          res.statusCode = 204;
          res.end();
          return;
        }
        const match = router.match(req.method, pathname);
        if (!match) throw notFound();
        if (match.methodNotAllowed) throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');

        const { route, params } = match;
        const ip = clientIp(req);
        const caller = route.public ? null : await gateway.resolve(req, { scope: route.scope, ip });
        const body = route.body ? await readJson(req, route.maxBody || config.maxBodyBytes) : undefined;
        const raw = route.raw ? await readRaw(req, route.maxBody || config.maxBodyBytes) : undefined;
        const result = await route.handler({ req, res, params, caller, body, raw, ip, requestId });
        if (!res.writableEnded) sendJson(res, result?.status || 200, result?.body ?? {});
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic && await serveStatic(req, res, /^\/chat\/[A-Za-z0-9_-]{22}$/.test(pathname) ? '/chat.html' : pathname)) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
    } catch (caught) {
      let err = caught;
      if (err instanceof UpstreamError) {
        logger.warn('dependency failed', { requestId, path: pathname, error: err.message });
        err = new HttpError(503, 'service_unavailable', 'A service NasrinAI depends on is not responding. Please try again shortly.');
      }
      const known = err instanceof HttpError;
      if (!known) logger.error('request failed', { requestId, method: req.method, path: pathname, error: err?.stack || String(err) });
      if (res.headersSent) { res.destroy(); return; }
      setApiHeaders(res);
      if (known && err.extra.retryAfter) res.setHeader('Retry-After', String(err.extra.retryAfter));
      sendJson(res, known ? err.status : 500, {
        error: known
          ? { code: err.code, message: err.publicMessage }
          : { code: 'internal', message: 'Something went wrong on our side. Please try again.' },
        request_id: requestId
      });
    }
  };
}
