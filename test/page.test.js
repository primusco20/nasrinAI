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
    assert.match(page.headers.get('content-security-policy'), /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
    assert.match(page.headers.get('content-security-policy'), /connect-src[^;]*https:\/\/owner\.nasrinai\.com/, 'signed-in owners can bootstrap the separate owner subdomain');
    assert.match(page.headers.get('content-security-policy'), /frame-src https:\/\/challenges\.cloudflare\.com/);
    assert.match(page.headers.get('content-security-policy'), /youtube-nocookie\.com/);
    assert.match(page.headers.get('content-security-policy'), /frame-src[^;]*https:\/\/www\.tiktok\.com/);
    assert.match(page.headers.get('content-security-policy'), /frame-src[^;]*https:\/\/www\.facebook\.com/);
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
    const statusOff = await (await fetch(a.url + '/v1/status')).json();
    const statusOn = await (await fetch(b.url + '/v1/status')).json();
    // The status endpoint now intentionally includes the known voice catalog
    // even when providers are unavailable; this test covers the remaining
    // status contract, while the dedicated voice tests cover catalog behavior.
    statusOff.speech = { ...statusOff.speech, voices: [], default: null };
    statusOn.speech = { ...statusOn.speech, voices: [], default: null };
    assert.deepEqual(statusOff,
      { ai_available: false, external_model: null, own_model: null, redacts_contact_details: false, files: { photos: false, pdfs: false }, legal: { terms_version: '2026-10-13', privacy_version: '2026-10-19a' }, github: { available: false, off: 'not_set' }, plans: true, library: true, projects: true, research: false, uploads: { direct: false }, images: { available: false }, videos: { available: false }, sign_in: { email: false, google: false }, turnstile: { site_key: null }, guest_session_hours: 24, speech: { available: false, voices: [], default: null, rate: 1.15 } });
    assert.deepEqual(statusOn,
      { ai_available: true, external_model: true, own_model: false, redacts_contact_details: true, files: { photos: true, pdfs: true }, legal: { terms_version: '2026-10-13', privacy_version: '2026-10-19a' }, github: { available: false, off: 'not_set' }, plans: true, library: true, projects: true, research: false, uploads: { direct: false }, images: { available: false }, videos: { available: false }, sign_in: { email: false, google: false }, turnstile: { site_key: null }, guest_session_hours: 24, speech: { available: false, voices: [], default: null, rate: 1.15 } });
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

test('NasrinAI Space uses the requested Connect mark and adapts every app icon background', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const connectMark = await readFile(new URL('../public/space-logos/nasrinai-connect-mark.svg', import.meta.url), 'utf8');
  assert.match(html, /id="spaceConnect"[\s\S]*?nasrinai-connect-mark\.svg/);
  assert.doesNotMatch(html, /id="spaceConnect"[\s\S]*?nasrinai-connect-dark\.svg/);
  assert.match(connectMark, /fill-rule="evenodd"/);
  // Library uses the one theme-adaptive glyph (owner request 2026-10-12), not a badge image.
  assert.match(html, /id="spaceLibrary"[\s\S]*?class="space-app-logo space-app-glyph lib-glyph"/);
  assert.match(html, /id="drawerLibrary"><svg class="lib-glyph"/);
  assert.match(css, /svg\.lib-glyph[^{]*\{ fill: currentColor; stroke: none; \}/);
  // Coding uses the pixel-robot Code logo (owner, 2026-10-12), chosen by theme and motion in CSS.
  assert.match(html, /id="spaceCoding">\s*<span class="space-app-icon" aria-hidden="true"><span class="space-app-logo code-logo"/);
  // Every app sits on the same tile (owner, 2026-10-13): light grey, lifted grey in dark mode.
  assert.equal((html.match(/<span class="space-app-icon"/g) || []).length, 8, 'Video Studio adds one Space tile');
  assert.match(css, /#pageSpace \.space-app-icon \{[^}]*background: #ECEBE7;/);
  assert.match(css, /:root\[data-theme="dark"\] #pageSpace \.space-app-icon \{ background: #3A3A3C; \}/);
  // The robot has no tile of its own; while busy it breaks into pixels and comes back.
  for (const f of ['code-bot-light.svg', 'code-bot-dark.svg', 'code-bot-light-busy.svg']) {
    const svg = await readFile(new URL('../public/space-logos/' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(svg, /<rect width="1024" height="1024"/, f + ' has no background tile');
  }
  const busy = await readFile(new URL('../public/space-logos/code-bot-light-busy.svg', import.meta.url), 'utf8');
  assert.match(busy, /animateTransform attributeName="transform" type="translate"/);
  // Grows from small, bursts and comes back; spins horizontally only while burst (owner, 2026-10-13).
  assert.doesNotMatch(busy, /type="rotate"/);
  // Perfect pixel (owner, 2026-10-13): no copies, no fading, no overlap. The
  // grid spreads evenly and bounces; the face (eyes, speckle) slides across
  // the fixed grid like a turning globe, in whole-pixel frames.
  assert.doesNotMatch(busy, /values="1 1;1 1;-1 1/);
  assert.match(busy, /type="scale" values="\.76;1\.02;\.9;\.9;\.69;\.76"[^>]*calcMode="spline"/);
  assert.equal((busy.match(/<rect /g) || []).length, 616);
  assert.doesNotMatch(busy, /attributeName="opacity"/);
  assert.match(busy, /attributeName="fill" calcMode="discrete" values="[^"]*#0b0b0c/);
  assert.match(busy, /type="translate" values="0 0;0 0;[^"]*"[^>]*calcMode="spline"/);
  // Two more moods (remember, write), light and dark, CSP-safe, chosen by the thinking line.
  for (const f of ['code-bot-light-remember.svg', 'code-bot-dark-remember.svg', 'code-bot-light-write.svg', 'code-bot-dark-write.svg']) {
    const svg = await readFile(new URL('../public/space-logos/' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(svg, /<style|style=|<script|href=/i, f);
    assert.match(css, new RegExp(f.replace('.', '\\.')), f);
  }
  for (const f of ['code-bot-light.svg', 'code-bot-dark.svg', 'code-bot-light-still.svg', 'code-bot-dark-still.svg', 'code-bot-light-busy.svg', 'code-bot-dark-busy.svg']) {
    assert.match(css, new RegExp(f.replace('.', '\\.')), f);
    const svg = await readFile(new URL('../public/space-logos/' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(svg, /<style|style=|<script|href=/i, f + ' needs no inline styles or scripts (strict CSP)');
  }
  assert.match(html, /id="spaceCloud"[\s\S]*?space-logos\/icon-cloud-orange\.svg/);
  assert.match(html, /id="pageSpace"[\s\S]*?nasrinai-space-icon\.svg/);
  assert.match(css, /html\[data-theme="light"\] #pageSpace \.space-app-logo:not\(\.space-app-logo-empty\):not\(\.space-cloud-logo\) \{ filter: invert\(1\); \}/);
  assert.match(css, /prefers-color-scheme: light/);
  assert.match(css, /prefers-color-scheme: dark/);
});

test('logging out requires confirmation before the sign-out action', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const handler = js.slice(js.indexOf("$('logoutBtn').addEventListener('click'"), js.indexOf('accountBtn.addEventListener(\'click\'', js.indexOf("$('logoutBtn').addEventListener('click'")));
  assert.match(handler, /window\.confirm\(/, 'logout must ask for confirmation');
  assert.match(handler, /if\s*\(!window\.confirm\([\s\S]*?\)\)\s*return;/, 'cancel must abort logout');
  assert.ok(handler.indexOf('window.confirm(') < handler.indexOf('accountBtn.click()'), 'sign-out action must occur only after confirmation');
});



test('voice settings keep provider catalogs visible when browser audio support is missing', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const renderStart = js.indexOf('function renderVoices()');
  const renderEnd = js.indexOf("if(canDevice&&'onvoiceschanged'", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart, 'voice renderer exists');
  const renderer = js.slice(renderStart, renderEnd);
  assert.match(renderer, /providerRows\('openai','ChatGPT \/ OpenAI'\)/);
  assert.match(renderer, /providerRows\('gemini','Gemini'\)/);
  assert.doesNotMatch(renderer, /speech\.available\s*&&\s*AudioCtx/, 'catalog visibility must not depend on Web Audio support');
  assert.match(renderer, /disabled:v\.available===false/, 'unconfigured providers remain visible but disabled');
});

test('status endpoint preserves unavailable voice catalog for Settings', async () => {
  const routes = await readFile(new URL('../src/routes.js', import.meta.url), 'utf8');
  assert.match(routes, /available:\s*Boolean\(voice\s*&&\s*voice\.available\)[\s\S]{0,400}voices:\s*voice\s*&&\s*Array\.isArray\(voice\.voices\)\s*\?\s*voice\.voices\s*:\s*\[\]/);
});

test('sign-in Turnstile widget is centered below the email form and smaller on phones', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(css, /\.signin-captcha \{[^}]*display: flex;[^}]*justify-content: center;/s, 'widget must be centered');
  assert.match(css, /@media \(max-width: 480px\) \{\s*\.signin-captcha \{[^}]*transform: scale\(0\.8\);[^}]*transform-origin: top center;/s,
    'widget must be scaled down from its top center on phones');
  const form = html.indexOf('id="emailForm"');
  const widget = html.indexOf('id="turnstileWidget"');
  const status = html.indexOf('id="signinStatus"');
  assert.ok(form > -1 && form < widget && widget < status, 'widget sits below the email form and above the status message');
});

test('a paste over 2,000 characters becomes a plain-text attachment; shorter stays text (spec section 4)', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\/paste\.js" defer><\/script>/, 'the rule is loaded on the page');
  assert.doesNotMatch(js, /pastedTextOverflows/, 'the old composer-height rule is gone');
  assert.match(js, /input\.addEventListener\('paste',[\s\S]{0,2400}NasrinPaste\.shouldAttach\(text\)/);
  assert.match(js, /if \(!text \|\| !NasrinPaste\.shouldAttach\(text\)\) return;/, 'short text continues to paste normally');
  assert.match(js, /new File\(\[text\], name, \{ type: 'text\/plain' \}\)/);
  assert.match(js, /The pasted text was kept in the message box instead/, 'a failed attach never loses the text');
});

test('a tech-style loader shows while a picture, video or file is being made (owner, 2026-10-13)', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const files = await readFile(new URL('../public/files.js', import.meta.url), 'utf8');
  // Built from elements, announced as a status, with the time so far.
  assert.match(js, /function genLoader\(text, \{ compact = false, timer = true \} = \{\}\) \{/);
  assert.match(js, /box\.setAttribute\('role', 'status'\);/);
  const loader = js.slice(js.indexOf('function genLoader('), js.indexOf('function clearScreen('));
  assert.doesNotMatch(loader, /innerHTML|insertAdjacentHTML/);
  // Used for the picture itself, the video and a file being written.
  assert.match(js, /if \(path === '\/v1\/images'\) \{[\s\S]{0,120}thinking = genLoader\(label\);/);
  assert.match(js, /const loader = genLoader\('Creating your video'\);/);
  assert.match(js, /fileLoader = genLoader\('Writing your file', \{ compact: true \}\)/);
  assert.doesNotMatch(files, /Writing your file…/);   // the loader replaces the old text note
  // Still when motion is reduced (system setting and the in-app setting).
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.gen-cell, \.gen-scan, \.gen-label > span:first-child \{ animation: none; \}/);
  assert.match(css, /:root\[data-motion="reduce"\] \.gen-scan \{ display: none; \}/);
});

test('replies fade in and the chat stays where the person is reading (owner, 2026-10-13)', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  // Following stops as soon as the person moves up, and only their own
  // scrolling can stop it; sending a message starts following again.
  assert.match(js, /function scrollToEnd\(el, \{ force = false, instant = false \} = \{\}\) \{\s*if \(force\) following = true;\s*if \(!following\) return;/);
  assert.match(js, /log\.addEventListener\('wheel', \(e\) => \{ touchedAt = Date\.now\(\); if \(e\.deltaY < 0\) up\(\); \}/);
  assert.match(js, /if \(Date\.now\(\) - touchedAt > 1000\) return;\s*following = log\.scrollHeight - log\.scrollTop - log\.clientHeight < 96;/);
  assert.match(js, /scrollToEnd\(el, \{ force: role === 'user' \}\);/);
  // Streaming text follows instantly (a smooth scroll per word would lag).
  assert.match(js, /strip\(raw\);[\s\S]{0,500}?scrollToEnd\(el, \{ instant: true \}\);\s*\},/);
  // Fade: the live reply, and a reply shown at once.
  assert.match(js, /el\.className = 'msg assistant is-live is-new';/);
  assert.match(css, /\.msg\.assistant\.is-new \{ animation: fade-in 360ms/);
});

test('web sources stay behind an accessible Sources and Resources toggle by default (owner, 2026-10-18)', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(js, /const cited = window\.NasrinFormat\.sources\(text\);\s*text = cited\.text;/);
  assert.match(js, /sourcesToggle\(actions, cited\.links\);/);
  assert.doesNotMatch(js, /if \(cited\.links\.length\) sourcesToggle/);
  assert.match(js, /No external sources were consulted for this reply\./);
  const toggle = js.slice(js.indexOf('function sourcesToggle('), js.indexOf('function replyActions('));
  assert.match(toggle, /list\.hidden = true;/);
  assert.match(toggle, /const heading = mk\('p', 'reply-sources-heading', 'Sources & Resources'\);/);
  assert.match(toggle, /b\.setAttribute\('aria-expanded', 'false'\);/);
  assert.match(toggle, /heading\.hidden = !open;/);
  assert.match(toggle, /a\.rel = 'noopener noreferrer';/);
  assert.doesNotMatch(toggle, /innerHTML/);
  // Copy, share and Save to Library keep the sources; read-aloud skips them.
  assert.match(js, /const plainText = window\.NasrinFormat\.plain\(full\);/);
  assert.match(css, /\.reply-sources\[hidden\] \{ display: none; \}/);
});

test('"clean this" with a spreadsheet runs the cleaner on the device, never the chat (owner, 2026-10-13)', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\/cleaner\.js" defer><\/script>/);
  // Asked to clean, with a .xlsx/.csv attached: cleaned here, no chat request.
  assert.match(js, /if \(!editing && !shortcut && CLEAN_ASK\.test\(text\) && pending\.some\(isSheetFile\)\) \{[\s\S]{0,120}return cleanFiles\(text, files\);/);
  assert.match(js, /const isSheetFile = \(f\) => f\.local && \/\\\.\(csv\|tsv\|xlsx\|xlsm\)\$\/i\.test/);
  const flow = js.slice(js.indexOf('async function cleanFiles('), js.indexOf('function cleanerCard('));
  assert.doesNotMatch(flow, /api\(|fetch\(|runTurn\(/);
  // The local File is kept on the item but never put in a request body.
  assert.match(js, /attachments: files\.map\(\(f\) => \(f\.upload \? \{ name: f\.name, type: f\.type, upload: f\.upload \} : \{ name: f\.name, type: f\.type, data: f\.data \}\)\)/);
  // The card: the check, a dashboard, the first rows, the full workbook to download.
  const card = js.slice(js.indexOf('function cleanerCard('), js.indexOf('// A file Nasrin wrote for the person'));
  assert.match(card, /values accounted for · nothing lost/);
  assert.match(card, /window\.NasrinCleaner\.workbook\(result, fileName\)/);
  assert.doesNotMatch(card, /innerHTML/);
});

test('chat follow-up questions are presented as a list with editable answers (owner, 2026-10-18)', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const card = js.slice(js.indexOf('function askCard('), js.indexOf('function show(role, text'));
  assert.match(card, /const questionList = document\.createElement\('ul'\);/);
  assert.match(card, /questionList\.className = 'ask-questions';/);
  assert.match(card, /item\.appendChild\(questionBox\(q,/);
  assert.match(js, /field\.placeholder = 'Type your answer';/);
  assert.match(js, /field\.addEventListener\('input', \(\) =>/);
  assert.match(css, /\.ask-card \.ask-questions/);
});

test('normal chats use a slightly smaller text size (owner, 2026-10-13)', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.msg\.assistant \{ align-self: flex-start; font-size: 0\.95rem; line-height: 1\.62; \}/);
  assert.match(css, /\.msg\.user \{[^}]*font-size: 0\.95rem;/);
  assert.match(css, /\.rich h3, \.rich h4 \{ font: 500 1rem\/1\.35 var\(--round\);/);
  // The coding chat keeps its own, smaller size.
  assert.match(css, /body\.coding-mode \.msg\.assistant \{ font-family: var\(--sans\); font-size: 0\.875rem;/);
});

test('the person’s message bubble is a softer charcoal in light mode only (owner, 2026-10-13)', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /:root \{[^}]*--bubble: color-mix\(in srgb, var\(--ink\) 76%, var\(--paper\)\);/);
  assert.match(css, /:root:not\(\[data-theme="light"\]\) \{[^}]*--bubble: var\(--ink\);/);
  assert.match(css, /:root\[data-theme="dark"\] \{[^}]*--bubble: var\(--ink\);/);
  assert.match(css, /\.msg\.user \{[^}]*background: var\(--bubble, var\(--ink\)\);/);
});

test('the Sources button shows overlapping site badges and the word Sources (owner, 2026-10-13)', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const toggle = js.slice(js.indexOf('function sourcesToggle('), js.indexOf('function replyActions('));
  assert.ok(toggle.includes("b.setAttribute('aria-label', `Show sources and resources (${links.length})`);"));
  assert.ok(toggle.includes("b.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} sources and resources (${links.length})`);"));
  assert.ok(toggle.includes('const hosts = [...new Set(links.map((l) => l.host))].slice(0, 3);'));
  assert.ok(toggle.includes("word.className = 'src-word';"));
  assert.ok(toggle.includes("character.className = 'src-letter';"));
  assert.ok(!toggle.includes('<img') && !toggle.includes('.src = ')); // no outside images (strict CSP, no third-party requests)
  assert.ok(css.includes('.src-face + .src-face { margin-left: -0.38rem; }'));
});

test('NCC (Nasrin Client Connect) is in NasrinAI Space for enterprises: contact the team (owner, 2026-10-13)', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="spaceNcc" aria-label="NCC, Nasrin Client Connect: CRM with automations for enterprises, contact the team"/);
  assert.match(html, /<span class="space-app-name">NCC<\/span>/);
  const ncc = js.slice(js.indexOf("if (spaceNcc) spaceNcc.addEventListener"), js.indexOf("// ---------- Terms acceptance"));
  assert.match(ncc, /mail\.href = 'mailto:support@nasrinai\.com\?subject='/);
  assert.match(ncc, /separate from Connect\. ', mail, ' to turn it on for your business\./);
  // Accounts the team turned on get a link to the NCC app; the server decides.
  assert.match(ncc, /open = await api\('\/v1\/ncc\/status'\)/);
  assert.match(ncc, /link\.rel = 'noopener';/);
  assert.doesNotMatch(ncc, /innerHTML/);
});

test('the NCC tile uses the owner’s chosen logo: B · Flow, three triangles (owner, 2026-10-13)', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const tile = html.slice(html.indexOf('id="spaceNcc"'), html.indexOf('</button>', html.indexOf('id="spaceNcc"')));
  assert.match(tile, /<svg class="space-app-logo space-app-glyph space-ncc-glyph" viewBox="0 0 120 120" aria-hidden="true">/);
  assert.equal((tile.match(/<path d="M[^"]+Z" fill="currentColor"/g) || []).length, 3);
  assert.doesNotMatch(tile, /space-movo-glyph|<circle/);
});


test('web-researched replies render safe, same-origin source image previews', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../src/routes.js', import.meta.url), 'utf8');
  const preview = await readFile(new URL('../src/web/page-preview.js', import.meta.url), 'utf8');
  assert.match(js, /renderWebPreviews\(el, cited\.links\)/);
  assert.match(js, /\/v1\/page-preview\?url=/);
  assert.match(js, /noopener noreferrer/);
  assert.match(css, /\.web-preview-grid/);
  assert.match(routes, /path: '\/v1\/page-preview'/);
  assert.match(preview, /image\/jpeg/);
  assert.match(preview, /readBytesImpl/);
});


test('tutorial intent uses a privacy-enhanced YouTube player and only trusted video IDs', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../src/routes.js', import.meta.url), 'utf8');
  const youtube = await readFile(new URL('../src/web/youtube.js', import.meta.url), 'utf8');
  assert.match(js, /const videoQuery = youtubeQueryForReply\(lastUserQuery, text\)/, 'resolve affirmative follow-ups against the assistant reply context');
  assert.match(js, /if \(videoQuery\) renderYouTubeVideos\(el, videoQuery, cited\.links\)/, 'render video results only when the resolved query has video intent');
  assert.match(js, /renderYouTubeVideos\(el, videoQuery, cited\.links\)/);
  assert.match(js, /if \(firstCard\) \{\s*section\.appendChild\(firstCard\)/, 'keep the main tutorial player inline in the answer and persist its metadata');
  assert.match(js, /!needsYouTubeVideos\(latestUserQuery\)/, 'skip follow-up questions for tutorial requests');
  assert.match(js, /https:\/\/www\.youtube-nocookie.com\/embed\//, 'use the privacy-enhanced YouTube iframe endpoint');
  assert.match(js, /if \(!videos\.length \|\| message\.querySelector\('\.youtube-results'\)\) return false;/, 'report failed or duplicate video rendering to the caller');
  assert.ok(js.includes('how (?:do i|to|do|does|can i|can you)'));
  assert.ok(js.includes('tutorialIntent'), 'tutorial terms are appended only when tutorial intent is detected');
  assert.match(js, /\/v1\/youtube\/search\?q=/);
  const youtubePlayer = js.slice(js.indexOf('function createYouTubeVideoCard'), js.indexOf('function mountPersistentYouTubePlayer'));
  assert.ok(youtubePlayer.includes("frame.referrerPolicy = 'strict-origin-when-cross-origin'"), 'set a referrer policy on the iframe');
  assert.ok(youtubePlayer.includes("frame.src = 'https://www.youtube-nocookie.com/embed/' + video.id + '?playsinline=1&rel=0&enablejsapi=0'"), 'enable inline playback with the privacy-enhanced YouTube embed URL');
  assert.ok(youtubePlayer.indexOf('frame.referrerPolicy =') < youtubePlayer.indexOf('frame.src ='), 'configure iframe policy before navigation starts');
  assert.match(js, /\^\[A-Za-z0-9_-\]\{11\}\$/);
  assert.match(css, /\.youtube-video-frame/);
  assert.ok(!youtubePlayer.includes('youtube-fullscreen-button'), 'do not add a custom fullscreen overlay over the video');
  assert.match(js, /frame\.allowFullscreen = true/, 'preserve the native YouTube fullscreen control');
  assert.match(css, /\.youtube-video-frame:fullscreen/);
  assert.match(js, /const PERSISTENT_YOUTUBE_KEY = 'nasrin\.persistentYoutubePlayer'/);
  assert.match(js, /function mountPersistentYouTubePlayer\(video, existingCard = null\)/);
  assert.match(js, /function restorePersistentYouTubePlayer\(\)/);
  assert.ok(js.includes('Do not delete a saved player because a verification/search API'));
  assert.ok(js.includes('Keep the most recently surfaced tutorial available when starting a new'));
  assert.ok(js.includes('localStorage.setItem(PERSISTENT_YOUTUBE_KEY, JSON.stringify({'));
  assert.match(js, /restorePersistentYouTubePlayer\(\);/);
  assert.match(js, /localStorage\.setItem\(PERSISTENT_YOUTUBE_KEY, JSON\.stringify\(state\)\)/);
  assert.match(js, /localStorage\.removeItem\(PERSISTENT_YOUTUBE_KEY\)/);
  assert.match(css, /\.persistent-youtube-player/);
  assert.match(css, /bottom: calc\(var\(--dock-h/);
  assert.match(js, /function renderSocialEmbeds\(message, links = \[\]\)/);
  assert.match(js, /renderSocialEmbeds\(el, cited\.links\)/);
  assert.match(js, /\/v1\/social\/oembed\?url=/);
  assert.match(js, /embedUrl\.origin === 'https:\/\/www\.tiktok\.com'/);
  assert.match(js, /embedUrl\.origin === 'https:\/\/www\.facebook\.com'/);
  assert.match(routes, /path: '\/v1\/social\/oembed'/);
  assert.match(routes, /https:\/\/www\.tiktok\.com\/oembed\?url=/);
  assert.match(routes, /https:\/\/graph\.facebook\.com\/v26\.0\//);
  assert.match(routes, /path: '\/v1\/youtube\/search'/);
  assert.ok(routes.includes("path: '/v1/youtube/verify'"));
  assert.match(youtube, /safeSearch: 'moderate'/);
  assert.match(youtube, /maxResults: '5'/);
});


test('chat page loads the client-side image crop tool', async () => {
  const js = await readFile(new URL('../public/image-crop.js', import.meta.url), 'utf8');
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.ok(html.includes('<script src="/image-crop.js" defer></script>'));
  assert.match(js, /canvas\.toBlob/);
  assert.match(js, /drawImage\(image, sx, sy, sw, sh/);
  assert.match(app, /NasrinImageCrop\.cropImage/);
  assert.match(app, /Cropped image added to your message/);
  assert.match(css, /\.image-crop-overlay/);
});

test('audio attachment chips expose manual transcription and keep transcript editable', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(app, /className = 'chip-transcribe'/);
  assert.match(app, /\/v1\/transcriptions\?name=/);
  assert.match(app, /Transcript added to your message\. Review it before sending\./);
  assert.match(app, /async function transcribeAudioChunks/);
  assert.match(app, /MAX_DURATION_SECONDS = 5 \* 60/);
  assert.match(app, /'Content-Type': 'audio\/wav'/);
  assert.match(app, /samplesPerChunk = SAMPLE_RATE \* CHUNK_SECONDS/);
  assert.ok(html.includes('/app.js'));
});

test('audio attachment MIME and extension checks use valid regex literals', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.ok(app.includes(String.raw`(/^audio\//i.test(f.type || '') || /\.(?:mp3|mpga|m4a|mp4|mpeg|mpg|mp2|wav|webm|ogg|oga|flac)$/i.test(f.name))`));
});

test('transcript text is joined with real blank lines, not the characters backslash-n', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /'\\\\n\\\\n'/, 'no over-escaped line breaks in app.js');
  assert.match(app, /transcripts\.filter\(Boolean\)\.join\('\\n\\n'\)/);
  assert.match(app, /existing \+ '\\n\\n' \+ transcript/);
});


test('reply details popover positions on mobile and includes a three-dot wave', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const start = js.indexOf("const positionPanel = () => {");
  const end = js.indexOf("details.addEventListener('click'", start);
  assert.ok(start >= 0 && end > start);
  const positioner = js.slice(start, end);
  assert.doesNotMatch(positioner, /window\.innerWidth\s*<=\s*600\)\s*return/);
  assert.match(positioner, /panel\.style\.position = 'fixed'/);
  assert.match(positioner, /panel\.style\.left = left \+ 'px'/);
  assert.match(positioner, /panel\.style\.top =/);
  assert.match(js, /reply-details-dot/);
  assert.match(js, /replayWave\(details, 'reply-details-wave'\)/);
  assert.match(js, /document\.body\.appendChild\(panel\)/, 'open panel must escape reply stacking contexts');
  assert.match(js, /const onScroll = \(\) => positionPanel\(\)/, 'scrolling must reposition rather than dismiss the panel on mobile');
  assert.match(js, /window\.addEventListener\('resize', onScroll/, 'viewport changes must reposition the panel');
  assert.match(css, /position:fixed!important; z-index:1000!important/, 'panel must use viewport coordinates and a high stacking level');
});

test('sources animate left-to-right and respect reduced-motion preferences', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(js, /classList\.add\('source-wave'\)/);
  assert.match(css, /\.sources-toggle\.source-wave \.src-face:nth-child\(1\)/);
  assert.ok(css.includes('.sources-toggle.source-wave .src-word .src-letter:nth-child(1) { animation-delay:225ms;'));
  assert.match(css, /prefers-reduced-motion:reduce/);
});


test('reply details panel uses transparent frosted glass and readable theme-aware text', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /background: rgba\(28, 29, 32, \.15\) !important/);
  assert.match(css, /backdrop-filter: blur\(28px\) saturate\(165%\)/);
  assert.match(css, /reply-details-panel \.reply-detail-label[\s\S]*?color: rgba\(255,255,255,\.9\)/);
  assert.match(css, /\.light \.reply-details-panel time[\s\S]*?color: #17191d/);
});

test('sources use the same wave animation as the three-dot reply-details control', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.sources-toggle\.source-wave \.src-face,[\s\S]*?animation: reply-dot-wave 480ms cubic-bezier\(\.2,\.75,\.25,1\) both/);
  assert.match(css, /\.sources-toggle\.source-wave \.src-word \{ animation-delay: 225ms/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});


test('reply details use 10% glass opacity, half-pixel border, regular text and requested margins', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /margin: 10px 15px !important/);
  assert.match(css, /background: rgba\(28, 29, 32, \.10\) !important/);
  assert.match(css, /border: \.5px solid rgba\(255, 255, 255, \.24\) !important/);
  assert.match(css, /backdrop-filter: blur\(34px\) saturate\(185%\) !important/);
  assert.match(css, /\.reply-details-panel,\s*\.reply-details-panel \*[\s\S]*?font-weight: 400 !important/);
  assert.match(css, /background: rgba\(255,255,255,\.10\) !important/);
});


test('reply details use extra-transparent glass, gray labels, and 10px padding', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /padding: 10px !important/);
  assert.match(css, /background: rgba\(28, 29, 32, \.06\) !important/);
  assert.match(css, /backdrop-filter: blur\(40px\) saturate\(200%\) !important/);
  assert.match(css, /\.reply-details-panel \.reply-detail-label \{[\s\S]*?color: #9a9da3 !important/);
  assert.match(css, /\.light \.reply-details-panel \.reply-detail-label \{[\s\S]*?color: #858991 !important/);
  assert.match(css, /background: rgba\(255, 255, 255, \.06\) !important/);
});


test('final reply details styling uses subtle glass, gray labels, and 20px horizontal padding', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const finalTuning = css.slice(css.lastIndexOf('/* Final reply-details tuning:'));
  assert.match(finalTuning, /padding: 10px 20px !important/);
  assert.match(finalTuning, /background: rgba\(28, 29, 32, \.06\) !important/);
  assert.match(finalTuning, /border: \.5px solid rgba\(255, 255, 255, \.18\) !important/);
  assert.match(finalTuning, /backdrop-filter: blur\(18px\) saturate\(120%\) !important/);
  assert.match(finalTuning, /\.reply-details-panel \.reply-detail-label \{[\s\S]*?color: #9a9da3 !important/);
  assert.match(finalTuning, /\.light \.reply-details-panel \.reply-detail-label \{[\s\S]*?color: #858991 !important/);
  assert.match(finalTuning, /font-weight: 400 !important/);
});


test('Sources label waves one letter at a time from S through s', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(js, /character\.className = 'src-letter'/);
  for (const [letterIndex, delay] of [[1,225],[2,270],[3,315],[4,360],[5,405],[6,450],[7,495]]) {
    assert.ok(css.includes(`.sources-toggle.source-wave .src-word .src-letter:nth-child(${letterIndex}) { animation-delay:${delay}ms;`));
  }
  assert.match(css, /prefers-reduced-motion:reduce/);
});

test('reply details panel uses the requested 5px blur and 50% saturation', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const finalTuning = css.slice(css.lastIndexOf('/* Final requested glass tuning:'));
  assert.match(finalTuning, /-webkit-backdrop-filter: blur\(5px\) saturate\(50%\) !important/);
  assert.match(finalTuning, /backdrop-filter: blur\(5px\) saturate\(50%\) !important/);
});

test('cited YouTube links render inline even when the user did not explicitly ask for videos', async () => {
  const js = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(js, /const hasCitedYouTube = Array\.isArray\(cited\.links\)/);
  assert.match(js, /else if \(hasCitedYouTube\) renderYouTubeVideos\(el, '', cited\.links, true\)/);
  assert.match(js, /function renderYouTubeVideos\(message, userQuery, sourceLinks = \[\], sourceOnly = false\)/);
  const renderer = js.slice(js.indexOf('function renderYouTubeVideos'), js.indexOf('function sourcesToggle'));
  assert.match(renderer, /if \(!sourceOnly\)/, 'direct cited videos should not trigger an unrelated YouTube search');
  assert.match(renderer, /youtube-nocookie\.com\/embed\//);
});


test('social video embeds allow only supported provider player origins', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../src/routes.js', import.meta.url), 'utf8');
  assert.ok(app.includes("host === 'instagram.com'"));
  assert.ok(app.includes("host === 'vimeo.com'"));
  assert.ok(app.includes("host === 'dailymotion.com'"));
  assert.ok(app.includes("embedUrl.origin === 'https://www.instagram.com'"));
  assert.ok(app.includes("embedUrl.origin === 'https://player.vimeo.com'"));
  assert.ok(app.includes("embedUrl.origin === 'https://www.dailymotion.com'"));
  assert.ok(routes.includes("https://graph.facebook.com/v26.0/instagram_oembed"));
  assert.ok(routes.includes("https://vimeo.com/api/oembed.json"));
  assert.ok(routes.includes("https://www.dailymotion.com/services/oembed"));
  assert.ok(routes.includes('Only TikTok, Facebook, Instagram, Vimeo, and Dailymotion URLs are supported'));
});


test('owner console overview binds aggregate account metrics and current migration number', async () => {
  const js = await readFile(new URL('../public/owner-console.js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../db/migrations/057_owner_console_metrics.sql', import.meta.url), 'utf8');
  const overview = js.slice(js.indexOf('function renderOverview'), js.indexOf('function renderModule'));
  assert.match(overview, /userSummary\s*=\s*data\s*&&\s*data\.user_summary/, 'overview defines its aggregate account summary before rendering');
  assert.match(overview, /userSummary\s*\?\s*numberText\(userSummary\.auth_user_records\)/);
  assert.match(overview, /migration 057/);
  assert.match(migration, /owner_console_user_summary/);
  assert.match(migration, /owner_console_growth_summary/);
  assert.match(js, /7d return rate/);
  assert.match(js, /Usage-based retention cohorts/);
  assert.match(js, /Feature activity · 7d/);
  assert.match(migration, /'features', coalesce/);
  assert.match(migration, /owner_console_retention_summary/);
  assert.match(js, /Recent production deployments/);
  assert.match(js, /OWNER_VERCEL_READONLY_TOKEN/);
  assert.match(migration, /owner_console_growth_summary/);
});


test('owner subdomain root redirects to the protected Owner Command Center route', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const route = config.redirects.find((item) => item.source === '/' && item.has?.some((condition) => condition.type === 'host' && condition.value === 'owner.nasrinai.com'));
  assert.ok(route, 'owner.nasrinai.com has a host-specific root redirect');
  assert.equal(route.destination, '/owner');
  assert.equal(route.permanent, false);
  assert.ok(config.rewrites.some((item) => item.source === '/owner' && item.destination === '/api/index?__path=/owner'), 'the protected /owner route is handled by the server function');
});


test('owner entry bootstraps on the dedicated host and expired sessions return to the main site', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const consoleJs = await readFile(new URL('../public/owner-console.js', import.meta.url), 'utf8');
  assert.match(app, /fetch\('https:\/\/owner\.nasrinai\.com\/v1\/owner\/session', \{\s*method: 'POST', credentials: 'include', mode: 'cors'/);
  assert.match(app, /window\.location\.href = 'https:\/\/owner\.nasrinai\.com\/owner'/);
  assert.doesNotMatch(consoleJs, /window\.location\.href = '\/'/);
  assert.match(consoleJs, /window\.location\.href = 'https:\/\/www\.nasrinai\.com\/'/);
});
