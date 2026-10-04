import { randomUUID } from 'node:crypto';
import { HttpError, notFound } from './errors.js';
import { readJson } from './body.js';
import { createRouter } from './router.js';
import { setBaseHeaders, setApiHeaders, sendJson } from './headers.js';

// Builds the request handler. Every /v1 route either declares itself public or
// gets a caller from the gateway first; the gateway refuses anything it cannot
// identify (fail closed). Handlers never see an unidentified request.
//
// route: { method, path, public?: boolean, body?: boolean, scope?: string, handler }
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
        const match = router.match(req.method, pathname);
        if (!match) throw notFound();
        if (match.methodNotAllowed) throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');

        const { route, params } = match;
        const ip = clientIp(req);
        const caller = route.public ? null : await gateway.resolve(req, { scope: route.scope, ip });
        const body = route.body ? await readJson(req, config.maxBodyBytes) : undefined;
        const result = await route.handler({ req, res, params, caller, body, ip, requestId });
        if (!res.writableEnded) sendJson(res, result?.status || 200, result?.body ?? {});
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic && await serveStatic(req, res, pathname)) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Not found');
    } catch (err) {
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
