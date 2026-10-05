import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAttachments, cleanName, attachmentNote } from '../src/attachments.js';
import { createOpenAIProvider } from '../src/ai/openai.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { ProviderError } from '../src/ai/provider.js';
import { buildTestApp, serve, bearer, postJson, testConfig } from './helpers.js';

const limits = testConfig().ai.attachments;
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PDF = b64(Buffer.from('%PDF-1.7\n...'));
const TEXT = b64(Buffer.from('name,qty\nrice,2\n'));

test('types come from the bytes, not the name or claimed type', () => {
  const out = parseAttachments([
    { name: 'a.txt', type: 'text/plain', data: PNG },
    { name: 'photo.jpg', type: 'image/jpeg', data: 'data:image/jpeg;base64,' + JPEG },
    { name: 'doc.pdf', data: PDF },
    { name: 'list.csv', type: 'text/csv', data: TEXT }
  ], limits);
  assert.deepEqual(out.map((f) => [f.kind, f.mime]), [['image', 'image/png'], ['image', 'image/jpeg'], ['pdf', 'application/pdf'], ['text', 'text/plain']]);
  assert.equal(out[3].text, 'name,qty\nrice,2\n');
});

test('unsupported, broken, binary and oversized files are refused', () => {
  const refuse = (list, code = 'invalid_attachment') => assert.throws(() => parseAttachments(list, limits), { code });
  refuse([{ name: 'x.exe', type: 'application/x-msdownload', data: b64([0x4d, 0x5a, 0x90, 0]) }]);
  refuse([{ name: 'x.bin', data: b64([0x00, 0x01, 0xfe, 0xff]) }], 'invalid_attachment');
  refuse([{ name: 'x.svg', type: 'image/svg+xml', data: b64(Buffer.from('<svg onload="x()"/>')) }]);
  refuse([{ name: 'x', data: 'not base64!' }]);
  refuse([{ name: 'x' }]);
  refuse('nope');
  refuse(Array(5).fill({ name: 'a', data: PNG }));
  const big = Buffer.alloc(limits.maxTotalBytes + 1, 0x20).toString('base64');
  refuse([{ name: 'big.txt', data: big }], 'attachments_too_large');
  assert.deepEqual(parseAttachments(undefined, limits), []);
});

test('names are cleaned and long text is cut', () => {
  assert.equal(cleanName('../../etc/<passwd>\n'), '....etcpasswd');
  assert.equal(cleanName(''), 'file');
  const long = parseAttachments([{ name: 'l.txt', data: b64(Buffer.from('a'.repeat(40000))) }], limits)[0];
  assert.ok(long.text.length < 31000 && long.text.endsWith('[… cut here: the file is longer]'));
  assert.equal(attachmentNote([{ name: 'a.jpg' }, { name: 'b.pdf' }]), '[Attached: a.jpg, b.pdf]');
});

test('OpenAI: photos and PDFs become content parts of the latest message', async () => {
  let sent;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })); };
  const p = createOpenAIProvider({ apiKey: 'sk-x', fetchImpl });
  await p.generate({
    system: 's',
    messages: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'yes' }, { role: 'user', content: 'what is this?' }],
    attachments: [{ kind: 'image', mime: 'image/png', name: 'a.png', data: PNG }, { kind: 'pdf', mime: 'application/pdf', name: 'd.pdf', data: PDF }]
  });
  const last = sent.messages.at(-1);
  assert.equal(sent.messages[1].content, 'earlier', 'earlier turns stay plain text');
  assert.deepEqual(last.content[0], { type: 'text', text: 'what is this?' });
  assert.equal(last.content[1].image_url.url, `data:image/png;base64,${PNG}`);
  assert.deepEqual(last.content[2], { type: 'file', file: { filename: 'd.pdf', file_data: `data:application/pdf;base64,${PDF}` } });
});

async function withApp(provider, fn) {
  const built = buildTestApp({ provider });
  const srv = await serve(built.app);
  try {
    const g = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    await fn({ ...built, url: srv.url, g });
  } finally { await srv.close(); }
}

test('end to end: files reach the model for this reply; only their names are saved', async () => {
  const provider = createFakeProvider({ dataLeavesServer: true, reply: () => 'Got it.' });
  await withApp(provider, async ({ url, g }) => {
    const r = await postJson(url + '/v1/chat', {
      message: 'Summarise these',
      attachments: [{ name: 'photo.jpg', data: JPEG }, { name: 'notes.txt', type: 'text/plain', data: b64(Buffer.from('Call 09171234567 tomorrow')) }]
    }, bearer(g));
    assert.equal(r.status, 200);
    const { conversation_id } = await r.json();

    const call = provider.calls[0];
    assert.equal(call.attachments.length, 1);
    assert.equal(call.attachments[0].kind, 'image');
    const sentText = call.messages.at(-1).content;
    assert.match(sentText, /Contents of the attached file "notes.txt"/);
    assert.match(sentText, /\[phone\]/, 'text files are redacted before leaving the server');

    const page = await (await fetch(`${url}/v1/conversations/${conversation_id}/messages`, { headers: bearer(g) })).json();
    assert.equal(page.messages[0].content, 'Summarise these\n\n[Attached: photo.jpg, notes.txt]');
    assert.doesNotMatch(JSON.stringify(page), /Call 0917|\/9j/);
  });
});

test('end to end: files without words, bad files, and a model that refuses files', async () => {
  const provider = createFakeProvider({
    failWith: (req) => (req.attachments?.length && req.model === 'gpt-4o-mini' ? new ProviderError('config', 'no vision', 400) : null)
  });
  await withApp(provider, async ({ url, g, models }) => {
    const bad = await postJson(url + '/v1/chat', { attachments: [{ name: 'x.exe', data: b64([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]) }] }, bearer(g));
    assert.equal(bad.status, 400);
    assert.equal(provider.calls.length, 0, 'refused before the model');

    const refused = await postJson(url + '/v1/chat', { attachments: [{ name: 'a.png', data: PNG }] }, bearer(g));
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).error.code, 'attachment_unsupported');
    assert.ok((await models.listFor({ tenantId: 't', actor: { type: 'guest', id: 'g' } })).models.length >= 1, 'tier not set aside');

    const words = await postJson(url + '/v1/chat', { message: 'hello' }, bearer(g));
    assert.equal(words.status, 200);
  });
});

test('the chat route accepts bodies big enough for files; other routes stay small', async () => {
  const provider = createFakeProvider();
  await withApp(provider, async ({ url, g }) => {
    const twoMb = Buffer.alloc(2 * 1024 * 1024, 0x61).toString('base64');
    const r = await postJson(url + '/v1/chat', { message: 'read this', attachments: [{ name: 'a.txt', data: twoMb }] }, bearer(g));
    assert.equal(r.status, 200);
    const other = await postJson(url + '/v1/guest/sessions', { padding: 'x'.repeat(20000) });
    assert.notEqual(other.status, 500);
  });
});
