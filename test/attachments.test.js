import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
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

test('broken and oversized files are refused', () => {
  const refuse = (list, code = 'invalid_attachment') => assert.throws(() => parseAttachments(list, limits), { code });
  refuse([{ name: 'x', data: 'not base64!' }]);
  refuse([{ name: 'x' }]);
  refuse('nope');
  refuse(Array(5).fill({ name: 'a', data: PNG }));
  const big = Buffer.alloc(limits.maxTotalBytes + 1, 0x20).toString('base64');
  refuse([{ name: 'big.txt', data: big }], 'attachments_too_large');
  assert.deepEqual(parseAttachments(undefined, limits), []);
});

test('any kind of file is accepted: text of every kind is read, the rest is marked unreadable', () => {
  const [svg, html, utf16, exe, bin, ole] = parseAttachments([
    { name: 'x.svg', type: 'image/svg+xml', data: b64(Buffer.from('<svg><text>hi</text></svg>')) },
    { name: 'page.html', type: 'text/html', data: b64(Buffer.from('<p>Kumusta</p>')) },
    { name: 'u16.txt', data: b64(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello', 'utf16le')])) },
    { name: 'x.exe', type: 'application/x-msdownload', data: b64([0x4d, 0x5a, 0x90, 0]) },
    { name: 'x.bin', data: b64([0x00, 0x01, 0xfe, 0xff]) },
    { name: 'old.doc', data: b64([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]) }
  ], { ...limits, maxCount: 10 });
  assert.equal(svg.kind, 'text'); assert.match(svg.text, /<text>hi<\/text>/);
  assert.equal(html.text, '<p>Kumusta</p>');
  assert.equal(utf16.text, 'hello');
  for (const f of [exe, bin, ole]) { assert.equal(f.kind, 'text'); assert.equal(f.unreadable, true); assert.match(f.text, /could not read the contents/); }
  assert.match(ole.text, /\.docx/);
});

// A tiny ZIP writer, so documents can be built here without any package.
function zipOf(files) {
  const parts = []; const central = []; let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const packed = deflateRawSync(raw);
    const nm = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nm.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(packed.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(nm.length, 28); cd.writeUInt32LE(offset, 42);
    parts.push(head, nm, packed); central.push(cd, nm);
    offset += 30 + nm.length + packed.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}
const read = (name, buf) => parseAttachments([{ name, data: buf.toString('base64') }], limits)[0];

test('Word, Excel, PowerPoint, OpenDocument and EPUB files are read as text', () => {
  const docx = read('a.docx', zipOf({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Plan &amp; budget</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Qty</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>' }));
  assert.equal(docx.kind, 'text');
  assert.match(docx.text, /Word document, converted to text\]\nPlan & budget\nItem\tQty/);

  const xlsx = read('a.xlsx', zipOf({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Sales" sheetId="1"/></sheets></workbook>',
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Rice</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1"><v>9</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>2.5</v></c></row></sheetData></worksheet>'
  }));
  assert.match(xlsx.text, /## Sheet: Sales\nName\t\t9\nRice\t2.5/);

  const pptx = read('a.pptx', zipOf({ 'ppt/slides/slide2.xml': '<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>', 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>' }));
  assert.match(pptx.text, /## Slide 1\nFirst\n\n## Slide 2\nSecond/);

  const odt = read('a.odt', zipOf({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<office:text><text:p>Hello</text:p><text:p>World</text:p></office:text>' }));
  assert.match(odt.text, /Hello\nWorld/);

  const epub = read('a.epub', zipOf({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/c.opf"/></rootfiles></container>',
    'OEBPS/c.opf': '<package><manifest><item id="b" href="b.xhtml"/><item id="a" href="a.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    'OEBPS/a.xhtml': '<html><body><p>Chapter one</p></body></html>', 'OEBPS/b.xhtml': '<html><body><p>Chapter two</p></body></html>'
  }));
  assert.match(epub.text, /Chapter one\n\nChapter two/);
});

test('malformed EPUB manifest URLs do not throw during file analysis', () => {
  const epub = read('bad.epub', zipOf({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/c.opf"/></rootfiles></container>',
    'OEBPS/c.opf': '<package><manifest><item id="a" href="%ZZ.xhtml"/></manifest><spine><itemref idref="a"/></spine></package>',
    'OEBPS/a.xhtml': '<html><body><p>Fallback chapter</p></body></html>'
  }));
  assert.equal(epub.kind, 'text');
  assert.match(epub.text, /Fallback chapter/);
});

test('RTF is read; other ZIPs list their files and show their text files; bombs and damage are handled', () => {
  const rtf = read('a.rtf', Buffer.from("{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Hello \\b World\\b0\\par Caf\\'e9}"));
  assert.match(rtf.text, /Hello World\nCafé/);
  assert.doesNotMatch(rtf.text, /Arial/);

  const zip = read('pack.zip', zipOf({ 'notes/a.txt': 'first file', 'img.bin': Buffer.from([0, 1, 2, 0xff]).toString('latin1') }));
  assert.match(zip.text, /ZIP archive/); assert.match(zip.text, /notes\/a.txt/); assert.match(zip.text, /first file/);

  // A file that unpacks far beyond the cap is skipped, not unpacked.
  const bomb = read('bomb.docx', zipOf({ 'word/document.xml': '<w:p>' + 'a'.repeat(7 * 1024 * 1024) + '</w:p>' }));
  assert.equal(bomb.unreadable, true);
  const broken = read('broken.zip', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40, 7)]));
  assert.equal(broken.unreadable, true);
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
    const bad = await postJson(url + '/v1/chat', { attachments: [{ name: 'x.txt', data: 'not base64!' }] }, bearer(g));
    assert.equal(bad.status, 400);
    assert.equal(provider.calls.length, 0, 'refused before the model');

    // Any other file type is accepted; the model is told its contents cannot be read.
    const exe = await postJson(url + '/v1/chat', { message: 'what is this?', attachments: [{ name: 'x.exe', data: b64([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]) }] }, bearer(g));
    assert.equal(exe.status, 200);
    assert.match(provider.calls.at(-1).messages.at(-1).content, /could not read the contents/);
    provider.calls.length = 0;

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
