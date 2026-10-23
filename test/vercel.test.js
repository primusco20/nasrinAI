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

test('retention stays hourly, the web crawler runs every five minutes, and render jobs are polled every minute', () => {
  assert.deepEqual(config.crons, [
    { path: '/v1/internal/retention', schedule: '0 * * * *' },
    { path: '/v1/internal/web-crawl', schedule: '*/5 * * * *' },
    { path: '/v1/internal/video-studio-render', schedule: '* * * * *' }
  ]);
});

test('the page CSP on Vercel is exactly the one the server sends', () => {
  assert.equal(header('Content-Security-Policy'), PAGE_CSP);
  assert.equal(header('X-Frame-Options'), 'DENY');
  assert.equal(header('X-Content-Type-Options'), 'nosniff');
  assert.equal(header('Referrer-Policy'), 'no-referrer');
  assert.match(header('Strict-Transport-Security'), /max-age=31536000/);
});

test('page headers apply to public files, not API, owner, or health routes', () => {
  for (const p of ['/', '/index.html', '/app.js', '/app.css', '/icon.svg', '/v1x', '/healthzz']) assert.ok(matches(p), p);
  for (const p of ['/v1', '/v1/', '/v1/chat', '/v1/conversations/abc/messages', '/healthz', '/owner', '/owner/', '/owner/api/overview']) assert.ok(!matches(p), p);
});

test('Studio root redirects only on the Studio hostname', () => {
  const studioRedirect = config.redirects.find((r) =>
    r.source === '/' &&
    r.destination === 'https://nasrinai.com/video-studio.html' &&
    r.has?.some((condition) => condition.type === 'host' && condition.value === 'studio.nasrinai.com')
  );
  assert.ok(studioRedirect, 'Studio host has an explicit root redirect');
  assert.equal(studioRedirect.permanent, false, 'use a temporary redirect while validating routing');
  assert.equal(config.redirects.some((r) => r.source === '/' && r.destination === 'https://nasrinai.com/video-studio.html' && !r.has), false,
    'do not redirect the main site root to Video Studio');
});

test('API and protected owner paths are sent to the function, with the original path passed along', () => {
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
  assert.equal(dest('/owner'), '/api/index?__path=/owner');
  assert.equal(dest('/owner/'), '/api/index?__path=/owner/');
  assert.equal(dest('/owner/api/overview'), '/api/index?__path=/owner/api/overview');
  assert.equal(dest('/'), null, 'page root is handled by CDN/host redirects, not API rewrites');
  assert.equal(config.functions['api/index.js'].maxDuration, 120);
});

test('the function restores only API and protected owner paths', async () => {
  const { restorePath } = await import('../api/index.js');
  assert.equal(restorePath('/api/index?__path=/v1/chat'), '/v1/chat');
  assert.equal(restorePath('/v1/chat?__path=/v1/chat'), '/v1/chat');
  assert.equal(restorePath('/api/index?__path=/healthz'), '/healthz');
  assert.equal(restorePath('/api/index?__path=/owner'), '/owner');
  assert.equal(restorePath('/api/index?__path=/owner/'), '/owner/');
  assert.equal(restorePath('/api/index?__path=/owner/api/overview'), '/owner/api/overview');
  assert.equal(restorePath('/api/index?__path=/v1/conversations/abc/messages&x=1'), '/v1/conversations/abc/messages?x=1');
  for (const bad of ['//evil.com', '/v1/../etc', '/admin', '/owner/../private', 'http://x/v1']) {
    assert.equal(restorePath('/api/index?__path=' + encodeURIComponent(bad)), '/api/index?__path=' + encodeURIComponent(bad));
  }
});

test('on Vercel the script, styles and manifest are revalidated on every load', () => {
  const fresh = config.headers.find((r) => r.headers.some((h) => h.key === 'Cache-Control' && h.value === 'no-cache'));
  assert.ok(fresh, 'a no-cache rule exists');
  const re = new RegExp('^' + fresh.source + '$');
  for (const p of ['/app.js', '/app.css', '/format.js', '/connect/smartchat.js', '/manifest.webmanifest']) assert.ok(re.test(p), p);
  for (const p of ['/icon.svg', '/v1/chat', '/']) assert.ok(!re.test(p), p);
});
