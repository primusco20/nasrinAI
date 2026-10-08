import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/http/app.js';
import { buildRoutes } from '../src/routes.js';
import { createGateway } from '../src/gateway/index.js';
import { createLimiter } from '../src/limits.js';
import { createStatic } from '../src/http/static.js';
import { testConfig, seededStore, memoryLogger, serve, postJson, bearer, BIZ_TENANT, GUEST_SECRET } from './helpers.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CODE = 'A'.repeat(22);

async function hostedApp() {
  const config = testConfig();
  const store = seededStore();
  const gateway = createGateway({ store, guestSecret: GUEST_SECRET, verifyUser: async () => null });
  const limiter = createLimiter({ store, limits: config.limits });
  const connect = {
    hostedSite: async (code) => (code === CODE ? { tenantId: BIZ_TENANT, name: 'shop.example.com', welcome: 'Hello there!' } : null)
  };
  const logger = memoryLogger();
  const app = createApp({
    config, logger, gateway,
    routes: buildRoutes({ config, gateway, store, limiter, connect, logger }),
    serveStatic: createStatic(PUBLIC_DIR),
    clientIp: () => '203.0.113.7'
  });
  return serve(app);
}

test('hosted chat: a valid link shows the business name and welcome, and nothing internal', async () => {
  const srv = await hostedApp();
  try {
    const ok = await fetch(srv.url + '/v1/connect/hosted/' + CODE);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { name: 'shop.example.com', welcome: 'Hello there!' });
    assert.equal((await fetch(srv.url + '/v1/connect/hosted/' + 'B'.repeat(22))).status, 404);
  } finally { await srv.close(); }
});

test('hosted chat: a session is chat-only for that business and bound to the page origin', async () => {
  const srv = await hostedApp();
  try {
    const res = await postJson(srv.url + '/v1/connect/hosted/' + CODE + '/session', {}, { Origin: 'https://nasrinai.com' });
    assert.equal(res.status, 201);
    const session = await res.json();
    assert.match(session.token, /^nsg_/);
    assert.equal(session.welcome, 'Hello there!');

    const who = await fetch(srv.url + '/v1/whoami', { headers: { ...bearer(session.token), Origin: 'https://nasrinai.com' } });
    assert.deepEqual(await who.json(), { actor_type: 'guest', tenant_id: BIZ_TENANT, scopes: ['chat'] });
    const stolen = await fetch(srv.url + '/v1/whoami', { headers: { ...bearer(session.token), Origin: 'https://evil.example' } });
    assert.equal(stolen.status, 403);

    const unknown = await postJson(srv.url + '/v1/connect/hosted/' + 'B'.repeat(22) + '/session', {});
    assert.equal(unknown.status, 404);
  } finally { await srv.close(); }
});

test('hosted chat: /chat/<code> serves the chat page with the strict page policy, other paths do not', async () => {
  const srv = await hostedApp();
  try {
    const page = await fetch(srv.url + '/chat/' + CODE);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /id="log"/);
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal((await fetch(srv.url + '/chat/short')).status, 404);
    assert.equal((await fetch(srv.url + '/chat/' + CODE + '/extra')).status, 404);
  } finally { await srv.close(); }
});

test('hosted chat: the page and its files follow the strict policy (no inline script or style)', async () => {
  const html = await readFile(path.join(PUBLIC_DIR, 'chat.html'), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /<style/i);
  assert.match(html, /name="robots" content="noindex/);
  const js = await readFile(path.join(PUBLIC_DIR, 'chat.js'), 'utf8');
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write|eval\(/);
});

test('qr: the generator makes valid, stable QR codes (checked against a real decoder when written)', async () => {
  await import('../public/connect/qr.js');
  const { matrix, svg } = globalThis.NasrinQR;
  const digest = (text) => createHash('sha256').update(matrix(text).modules.map((r) => r.map((v) => (v ? 1 : 0)).join('')).join('\n')).digest('hex');
  assert.equal(digest('hi'), '81240590f3a630b03aa70a8aaf521ec30c4911af3307da27eeb2126afcb5b39a');
  assert.equal(digest('https://nasrinai.com/chat/Zx9_aB-3kLmN0pQrStUvWx'), '1111c8f8b12691d1df60ac95048f07d9d0cb053d4b0f9f74c5b184a5083cfe8f');
  assert.equal(digest('https://www.nasrinai.com/chat/Zx9_aB-3kLmN0pQrStUvWx?x=1'), '9e735781a6d8f489078c917d96503b34be21e57f2a46690aae908dd5aee4f12d');

  const m = matrix('https://nasrinai.com/chat/Zx9_aB-3kLmN0pQrStUvWx');
  assert.equal(m.version, 4);
  assert.equal(m.size, 33);
  for (const [x, y] of [[0, 0], [m.size - 7, 0], [0, m.size - 7]]) {
    assert.equal(m.modules[y][x], true); assert.equal(m.modules[y + 3][x + 3], true); assert.equal(m.modules[y + 1][x + 1], false);
  }
  assert.match(svg('hi'), /^<svg [^>]*viewBox="0 0 29 29"/);
  assert.throws(() => matrix('x'.repeat(107)), /too long/);
});
