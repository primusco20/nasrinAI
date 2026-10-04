import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/http/app.js';
import { createStatic } from '../src/http/static.js';
import { createClosedGateway } from '../src/gateway/index.js';
import { buildRoutes } from '../src/routes.js';
import { PUBLIC_DIR } from '../src/main.js';
import { testConfig, memoryLogger, serve, postJson } from './helpers.js';

let srv;
const logger = memoryLogger();

before(async () => {
  const routes = buildRoutes().concat([
    { method: 'POST', path: '/v1/test/echo', public: true, body: true, handler: async ({ body }) => ({ body }) },
    { method: 'GET', path: '/v1/test/boom', public: true, handler: async () => { throw new Error('database password is hunter2'); } }
  ]);
  srv = await serve(createApp({
    config: testConfig(), logger, gateway: createClosedGateway(), routes, serveStatic: createStatic(PUBLIC_DIR)
  }));
});
after(() => srv.close());

test('health check answers ok with security headers', async () => {
  const r = await fetch(srv.url + '/healthz');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.ok(r.headers.get('x-request-id'));
});

test('protected routes are refused when nobody is identified (fail closed)', async () => {
  const r = await fetch(srv.url + '/v1/whoami');
  assert.equal(r.status, 401);
  const body = await r.json();
  assert.equal(body.error.code, 'unauthenticated');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
});

test('unknown API paths are 404 JSON, wrong methods 405', async () => {
  assert.equal((await fetch(srv.url + '/v1/nothing-here')).status, 404);
  assert.equal((await fetch(srv.url + '/v1/whoami', { method: 'DELETE' })).status, 405);
});

test('JSON bodies: valid, wrong type, invalid, not an object, too large', async () => {
  const ok = await postJson(srv.url + '/v1/test/echo', { a: 1 });
  assert.deepEqual(await ok.json(), { a: 1 });

  const wrongType = await fetch(srv.url + '/v1/test/echo', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hi' });
  assert.equal(wrongType.status, 415);

  const invalid = await fetch(srv.url + '/v1/test/echo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
  assert.equal(invalid.status, 400);

  const array = await postJson(srv.url + '/v1/test/echo', [1, 2]);
  assert.equal(array.status, 400);

  const big = await postJson(srv.url + '/v1/test/echo', { text: 'x'.repeat(20_000) });
  assert.equal(big.status, 413);
});

test('internal errors are hidden from the caller and logged', async () => {
  const r = await fetch(srv.url + '/v1/test/boom');
  assert.equal(r.status, 500);
  const text = await r.text();
  assert.doesNotMatch(text, /hunter2|database/);
  assert.match(text, /request_id/);
  assert.ok(logger.lines.some((l) => l.level === 'error' && /hunter2/.test(l.error)));
});

test('the page is served with a strict CSP and no inline script allowed', async () => {
  const r = await fetch(srv.url + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
});

test('static files cannot escape the public folder', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/%2e%2e%2fserver.js', '/.env', '/x%00.html']) {
    const r = await fetch(srv.url + p);
    assert.equal(r.status, 404, p);
  }
  assert.equal((await fetch(srv.url + '/', { method: 'POST' })).status, 405);
});

// fetch() normalises "../" before sending; a raw request sends the path as written.
test('raw traversal paths are refused too', async () => {
  const { request } = await import('node:http');
  const port = new URL(srv.url).port;
  const raw = (path) => new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => { res.resume(); resolve(res.statusCode); });
    r.on('error', reject);
    r.end();
  });
  for (const p of ['/../package.json', '/../../etc/passwd', '/..%2f..%2fpackage.json', '/public/../server.js']) {
    assert.equal(await raw(p), 404, p);
  }
});
