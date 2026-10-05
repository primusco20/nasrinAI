import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PAGE_CSP } from '../src/http/headers.js';

// On Vercel, files in public/ are served by the CDN, not by our server, so
// their security headers come from vercel.json. These checks keep the two in
// step, and keep the page headers off the API (which sets its own).

const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const rule = config.headers[0];
const header = (name) => rule.headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;
const matches = (path) => new RegExp('^' + rule.source + '$').test(path);

test('runs in Singapore', () => {
  assert.deepEqual(config.regions, ['sin1']);
});

test('the page CSP on Vercel is exactly the one the server sends', () => {
  assert.equal(header('Content-Security-Policy'), PAGE_CSP);
  assert.equal(header('X-Frame-Options'), 'DENY');
  assert.equal(header('X-Content-Type-Options'), 'nosniff');
  assert.equal(header('Referrer-Policy'), 'no-referrer');
  assert.match(header('Strict-Transport-Security'), /max-age=31536000/);
});

test('page headers apply to the page files, not to the API or health check', () => {
  for (const p of ['/', '/index.html', '/app.js', '/app.css', '/icon.svg', '/v1x', '/healthzz']) assert.ok(matches(p), p);
  for (const p of ['/v1', '/v1/', '/v1/chat', '/v1/conversations/abc/messages', '/healthz']) assert.ok(!matches(p), p);
});

test('API paths are sent to the function, with the original path passed along', () => {
  const dest = (p) => {
    for (const r of config.rewrites) {
      const re = new RegExp('^' + r.source.replace(':path*', '(.*)') + '$');
      const m = re.exec(p);
      if (m) return r.destination.replace(':path*', m[1] ?? '');
    }
    return null;
  };
  assert.equal(dest('/v1/chat'), '/api/index?__path=/v1/chat');
  assert.equal(dest('/v1'), '/api/index?__path=/v1');
  assert.equal(dest('/healthz'), '/api/index?__path=/healthz');
  assert.equal(dest('/'), null, 'the page stays on the CDN');
  assert.equal(config.functions['api/index.js'].maxDuration, 120);
});

test('the function restores only API paths', async () => {
  const { restorePath } = await import('../api/index.js');
  assert.equal(restorePath('/api/index?__path=/v1/chat'), '/v1/chat');
  assert.equal(restorePath('/v1/chat?__path=/v1/chat'), '/v1/chat');
  assert.equal(restorePath('/api/index?__path=/healthz'), '/healthz');
  assert.equal(restorePath('/api/index?__path=/v1/conversations/abc/messages&x=1'), '/v1/conversations/abc/messages?x=1');
  for (const bad of ['//evil.com', '/v1/../etc', '/admin', 'http://x/v1']) {
    assert.equal(restorePath('/api/index?__path=' + encodeURIComponent(bad)), '/api/index?__path=' + encodeURIComponent(bad));
  }
});
