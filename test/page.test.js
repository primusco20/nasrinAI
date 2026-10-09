import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/http/app.js';
import { createStatic } from '../src/http/static.js';
import { PUBLIC_DIR } from '../src/main.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { buildTestApp, serve, testConfig, memoryLogger } from './helpers.js';

test('the chat page loads its script and styles as files that the strict CSP allows', async () => {
  const app = createApp({ config: testConfig(), logger: memoryLogger(), gateway: {}, serveStatic: createStatic(PUBLIC_DIR) });
  const srv = await serve(app);
  try {
    const page = await fetch(srv.url + '/');
    const html = await page.text();
    assert.match(html, /<link rel="icon" type="image\/png" href="\/logo\.png">/, 'Google-search favicon points to logo.png');
    assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(html, /<script src="\/app\.js" defer><\/script>/);

    for (const [path, type] of [['/app.js', /javascript/], ['/character.js', /javascript/], ['/app.css', /text\/css/], ['/icon.svg', /image\/svg\+xml/], ['/apple-touch-icon.png', /image\/png/], ['/icon-512.png', /image\/png/], ['/logo.png', /image\/png/], ['/favicon.ico', /image\/x-icon/], ['/manifest.webmanifest', /application\/manifest\+json/]]) {
      const r = await fetch(srv.url + path);
      assert.equal(r.status, 200, path);
      assert.match(r.headers.get('content-type'), type, path);
    }
  } finally { await srv.close(); }
});

test('the page has no inline script, inline handlers, inline styles or HTML-injection sinks', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'inline <script>');
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'inline event handler');
  assert.doesNotMatch(html, /\sstyle\s*=/i, 'inline style attribute');
  assert.doesNotMatch(html, /<style/i, 'inline <style>');

  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const character = await readFile(new URL('../public/character.js', import.meta.url), 'utf8');
  for (const code of [js, character]) {
    assert.doesNotMatch(code, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|setAttribute\(\s*['"]style/);
  }
  assert.match(js, /createTextNode\(text\)/);
  assert.match(html, /<script src="\/character\.js" defer><\/script>/);
});

test('status tells the page whether the AI is on and whether messages leave the server', async () => {
  const off = buildTestApp({ provider: null });
  const on = buildTestApp({ provider: createFakeProvider({ dataLeavesServer: true }) });
  const a = await serve(off.app);
  const b = await serve(on.app);
  try {
    assert.deepEqual(await (await fetch(a.url + '/v1/status')).json(),
      { ai_available: false, external_model: null, own_model: null, redacts_contact_details: false, files: { photos: false, pdfs: false }, legal: { terms_version: '2026-10-07d', privacy_version: '2026-10-07a' }, plans: true, library: true, projects: true, images: { available: false }, videos: { available: false }, sign_in: { email: false, google: false }, guest_session_hours: 24, speech: { available: false, voices: [], default: null, rate: 1.15 } });
    assert.deepEqual(await (await fetch(b.url + '/v1/status')).json(),
      { ai_available: true, external_model: true, own_model: false, redacts_contact_details: true, files: { photos: true, pdfs: true }, legal: { terms_version: '2026-10-07d', privacy_version: '2026-10-07a' }, plans: true, library: true, projects: true, images: { available: false }, videos: { available: false }, sign_in: { email: false, google: false }, guest_session_hours: 24, speech: { available: false, voices: [], default: null, rate: 1.15 } });
  } finally { await a.close(); await b.close(); }
});

test('system-dark composer keeps the same compact padding as dark theme', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /:root:not\(\[data-theme="light"\]\) #input \{[^}]*padding: 0\.4rem 0\.8rem 0\.45rem;/s,
    'system-dark composer must use the compact message-field padding');
  assert.doesNotMatch(css, /padding: 2\.65rem 2\.25rem 0\.45rem/,
    'oversized composer padding must not return');
});

// A missing element that app.js dereferences at start-up throws before the code
// that restores the sign-in and loads the tiers, so Google sign-in "does nothing"
// and the model picker never appears. Every $('id') must exist in index.html,
// unless it is read into a variable that is checked, or used with ?.
test('app.js never dereferences a page element that index.html does not have', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const unsafe = [];
  for (const m of js.matchAll(/\$\('([^']+)'\)(\??\.)?/g)) {
    const id = m[1];
    if (ids.has(id)) continue;
    const before = js.slice(Math.max(0, m.index - 40), m.index);
    const isOptionalRead = /\b(?:const|let)\s+\w+\s*=\s*$/.test(before);   // const x = $('id'); checked later
    const usesOptionalChain = m[2] === '?.';
    if (!isOptionalRead && !usesOptionalChain) unsafe.push(id);
  }
  assert.deepEqual([...new Set(unsafe)], [], 'elements used without a check but missing from index.html');
});

