import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readLink, checkUrl, isPublicAddress, htmlToText, linksIn } from '../src/web/read-link.js';
import { createWebSearch, needsWeb } from '../src/web/search.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN } from './helpers.js';

const page = (status, headers, body = '') => Object.assign(Readable.from([Buffer.from(body)]), { statusCode: status, headers });

test('link reader refuses internal addresses (SSRF)', () => {
  for (const u of ['http://127.0.0.1/', 'http://localhost:3000/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.5/', 'http://[::1]/',
    'file:///etc/passwd', 'ftp://example.com', 'https://user:pass@example.com', 'https://example.com:8443/', 'http://metadata.google.internal/']) {
    assert.equal(checkUrl(u), null, u);
  }
  assert.ok(checkUrl('https://example.com/a?b=1'));
  for (const ip of ['192.168.1.1', '172.20.0.1', '100.64.0.1', '0.0.0.0', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2002:7f00:1::', '2001:db8::1']) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(isPublicAddress('2606:2800:220:1:248:1893:25c8:1946'), true);
});

test('link reader: readable text, redirects checked, errors explained', async () => {
  const html = '<html><head><title>Shop &amp; Co</title><style>x{}</style></head><body><nav>menu</nav><h1>Hours</h1><p>Open 9&nbsp;am.</p><script>evil()</script></body></html>';
  const ok = await readLink('https://shop.example.com/', { getImpl: async () => page(200, { 'content-type': 'text/html; charset=utf-8' }, html) });
  assert.equal(ok.title, 'Shop & Co');
  assert.match(ok.text, /Hours[\s\S]*Open 9 am\./);
  assert.doesNotMatch(ok.text, /evil|menu/);

  const redirected = await readLink('https://a.example.com/', { getImpl: async () => page(302, { location: 'http://127.0.0.1/admin' }) });
  assert.equal(redirected.error, 'redirects to a blocked address');
  assert.equal((await readLink('https://a.example.com/', { getImpl: async () => page(404, {}) })).error, 'the site answered 404');
  assert.equal((await readLink('https://a.example.com/x.zip', { getImpl: async () => page(200, { 'content-type': 'application/zip' }) })).error, 'not a text page');
  assert.equal((await readLink('https://a.example.com/large', { getImpl: async () => page(200, { 'content-type': 'text/plain' }, 'x'.repeat(1_500_001)) })).error, 'the page is too large');
  assert.equal((await readLink('http://10.1.1.1/')).error, 'not a public web address');
  assert.deepEqual(linksIn('see https://a.com/x, and https://b.org/y. also https://a.com/x'), ['https://a.com/x', 'https://b.org/y']);
  assert.equal(htmlToText('<li>one</li><li>two</li>').text, '- one\n- two');
});

test('chat: a shared link is read and given to the model as data', async () => {
  const provider = createFakeProvider({ reply: () => 'Adobo is listed on the menu.' });
  const built = buildTestApp({ provider, readLinkImpl: async (u) => ({ url: u, title: 'Menu', text: 'Adobo 150 pesos' }) });
  const srv = await serve(built.app);
  try {
    const r = await postJson(srv.url + '/v1/chat', { message: 'How much is adobo here? https://resto.example.com/menu' }, bearer(USER_TOKEN));
    assert.equal(r.status, 200);
    const sent = provider.calls.at(-1).messages.at(-1).content;
    assert.match(sent, /Text of the web page https:\/\/resto\.example\.com\/menu \("Menu"\)[\s\S]*Adobo 150 pesos/);
    const saved = built.store;
    const history = await (await fetch(srv.url + `/v1/conversations/${(await r.json()).conversation_id}/messages`, { headers: bearer(USER_TOKEN) })).json();
    assert.doesNotMatch(JSON.stringify(history), /Adobo 150/, 'page text is not stored');
    assert.ok(saved);
  } finally { await srv.close(); }
});

test('web search: Responses API with the web_search tool; answer with sources; recorded', async () => {
  const calls = [];
  const ws = createWebSearch({ apiKey: 'sk-x', model: 'gpt-6-luna', fetchImpl: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Response.json({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'It is sunny in Cebu today.', annotations: [{ type: 'url_citation', url: 'https://weather.example.com/cebu', title: 'Cebu weather' }] }] }], usage: { input_tokens: 3000, output_tokens: 40 } });
  } });
  assert.equal(needsWeb('What is the weather in Cebu today?'), true);
  assert.equal(needsWeb('Explain photosynthesis'), false);
  assert.equal(needsWeb('Research recent AI API changes and cite sources'), true);

  const provider = createFakeProvider();
  const built = buildTestApp({ provider, webSearch: ws, env: { ROUTING: 'smart', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30) } });
  const srv = await serve(built.app);
  try {
    const r = await (await postJson(srv.url + '/v1/chat', { message: 'What is the weather in Cebu today?' }, bearer(USER_TOKEN))).json();
    assert.match(r.message.content, /sunny in Cebu[\s\S]*\*\*Sources\*\*\n- \[Cebu weather\]\(<https:\/\/weather\.example\.com\/cebu>\)/);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
    assert.deepEqual(calls[0].body.tools, [{ type: 'web_search' }]);
    assert.equal(provider.calls.length, 0, 'the search answered; no second model call');
    const e = built.store.usage.at(-1);
    assert.deepEqual([e.task, e.model], ['web', 'gpt-6-luna']);
    assert.ok(e.costUsd >= 0.01, 'search call price counted');
  } finally { await srv.close(); }
});


test('web search: does not present an answer without verifiable source links', async () => {
  const ws = createWebSearch({ apiKey: 'sk-x', model: 'gpt-6-luna', fetchImpl: async () => Response.json({
    output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'Unverified current claim.' }] }],
    usage: { input_tokens: 20, output_tokens: 10 }
  }) });
  const provider = createFakeProvider();
  const built = buildTestApp({ provider, webSearch: ws, env: { ROUTING: 'smart', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30) } });
  const srv = await serve(built.app);
  try {
    const r = await (await postJson(srv.url + '/v1/chat', { message: 'What is the weather in Cebu today?' }, bearer(USER_TOKEN))).json();
    assert.match(r.message.content, /could not verify source links/);
    assert.doesNotMatch(r.message.content, /Unverified current claim/);
    assert.equal(provider.calls.length, 0);
  } finally { await srv.close(); }
});

test('web search: streams first answer text before the response completes', async () => {
  const chunks = [
    'event: response.created\ndata: {"type":"response.created"}\n\n',
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"The answer is " }\n\n',
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"42."}\n\n',
    'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"The answer is 42.","annotations":[{"type":"url_citation","url":"https://example.com","title":"Example"}]}]}],"usage":{"input_tokens":10,"output_tokens":5}}}\n\n'
  ];
  const ws = createWebSearch({ apiKey: 'sk-x', model: 'gpt-6-luna', fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); }
  }), { headers: { 'content-type': 'text/event-stream' } }) });
  const seen = [];
  const found = await ws.search({ system: 'answer', messages: [{ role: 'user', content: 'what is 42?' }], onText: (t) => seen.push(t) });
  assert.deepEqual(seen, ['The answer is ', '42.']);
  assert.equal(found.text, 'The answer is 42.');
  assert.equal(found.citations[0].url, 'https://example.com/');
});
