import { inflateRawSync } from 'node:zlib';
import { HttpError } from './http/errors.js';

// Files sent with a chat message. Any kind of file can be sent; what NasrinAI
// can do with it depends on what it is:
//
//   photos, PDFs    -> given to the model as they are
//   text of any kind (notes, code, CSV, JSON, HTML, XML, logs, SVG ...)
//                   -> read as text
//   Word, Excel, PowerPoint (.docx .xlsx .pptx), OpenDocument (.odt .ods .odp),
//   EPUB, RTF, and ZIP archives
//                   -> their text is taken out here, on the server
//   anything else (audio, video, old .doc/.xls/.ppt, programs ...)
//                   -> accepted, but its contents cannot be read; the model is
//                      told so and says so plainly
//
// - The browser sends files as base64 inside the JSON body.
// - The type is decided by the file's first bytes, never by its name or the
//   type the browser claims.
// - Nothing is ever run or opened with a program. Documents are read as ZIP
//   data with Node's built-in zlib (no packages), with caps on how many
//   entries are read and how large they may grow (zip bombs).
// - Files are used for this one reply and are not stored. The saved message
//   records only their names.

const NAME_BAD = /[\u0000-\u001f\u007f\\/<>:"|?*]/g;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const ZIP_ENTRIES = 3000;          // central directory entries looked at
const ZIP_ENTRY_BYTES = 6 * 1024 * 1024;   // one entry, after unpacking
const ZIP_TOTAL_BYTES = 16 * 1024 * 1024;  // everything unpacked from one file
const SHEET_ROWS = 400;
const SHEET_COLS = 40;

function sniff(bytes) {
  const at = (i) => bytes[i];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (bytes.length >= 4 && at(0) === 0x50 && at(1) === 0x4b && (at(2) === 0x03 || at(2) === 0x05) && (at(3) === 0x04 || at(3) === 0x06)) return 'application/zip';
  if (bytes.length >= 8 && at(0) === 0xd0 && at(1) === 0xcf && at(2) === 0x11 && at(3) === 0xe0) return 'application/x-ole';
  if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '{\\rtf') return 'text/rtf';
  return null;
}

const bad = (message) => new HttpError(400, 'invalid_attachment', message);

export function cleanName(name) {
  const s = String(name || '').replace(NAME_BAD, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return s || 'file';
}

// ---------- ZIP (read only) ----------

// Lists a ZIP's entries from its central directory. Returns null when it is
// not a readable ZIP. read(entry) gives the entry's bytes, or null.
export function openZip(bytes) {
  // A ZIP end-of-central-directory record is at least 22 bytes. Reject shorter
  // buffers before readUInt32LE scans them, so truncated uploads stay unreadable.
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) return null;
  const eocdAt = (() => {
    const from = Math.max(0, bytes.length - 65557);
    for (let i = bytes.length - 22; i >= from; i--) if (bytes.readUInt32LE(i) === 0x06054b50) return i;
    return -1;
  })();
  if (eocdAt < 0) return null;
  const count = Math.min(bytes.readUInt16LE(eocdAt + 10), ZIP_ENTRIES);
  let p = bytes.readUInt32LE(eocdAt + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== 0x02014b50) break;
    const flags = bytes.readUInt16LE(p + 8);
    const method = bytes.readUInt16LE(p + 10);
    const size = bytes.readUInt32LE(p + 24);
    const nameLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const offset = bytes.readUInt32LE(p + 42);
    const name = bytes.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, flags, method, size, compSize: bytes.readUInt32LE(p + 20), offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!entries.length) return null;
  let unpacked = 0;
  return {
    entries,
    read(entry) {
      try {
        if ((entry.flags & 1) || entry.size > ZIP_ENTRY_BYTES || unpacked + entry.size > ZIP_TOTAL_BYTES) return null;   // encrypted or too big
        const o = entry.offset;
        if (o + 30 > bytes.length || bytes.readUInt32LE(o) !== 0x04034b50) return null;
        const start = o + 30 + bytes.readUInt16LE(o + 26) + bytes.readUInt16LE(o + 28);
        const raw = bytes.subarray(start, start + entry.compSize);
        const out = entry.method === 0 ? raw : entry.method === 8 ? inflateRawSync(raw, { maxOutputLength: ZIP_ENTRY_BYTES }) : null;
        if (out) unpacked += out.length;
        return out;
      } catch { return null; }
    }
  };
}

// ---------- XML to text ----------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeXml = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => safeChar(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, d) => safeChar(Number(d)))
  .replace(/&(amp|lt|gt|quot|apos);/g, (m, n) => ENTITIES[n]);
function safeChar(n) { try { return n > 8 && n < 0x110000 ? String.fromCodePoint(n) : ''; } catch { return ''; } }

const tidy = (s) => s.replace(/[ \t]+\n/g, '\n').replace(/\t+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// Word: paragraphs, tabs, line breaks, table cells.
function docxText(xml) {
  return tidy(decodeXml(xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>\s*<\/w:tc>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')));
}

// PowerPoint: the text of a slide.
function slideText(xml) {
  return tidy(decodeXml(xml.replace(/<\/a:p>/g, '\n').replace(/<a:br\b[^>]*\/>/g, '\n').replace(/<[^>]+>/g, '')));
}

// OpenDocument text, sheets and slides share one content.xml.
function odfText(xml) {
  return tidy(decodeXml(xml
    .replace(/<text:tab\b[^>]*\/>/g, '\t')
    .replace(/<text:line-break\b[^>]*\/>/g, '\n')
    .replace(/<text:s\b[^>]*\/>/g, ' ')
    .replace(/<\/text:p>\s*<\/table:table-cell>/g, '\t')
    .replace(/<\/table:table-cell>/g, '\t')
    .replace(/<\/(?:table:table-row|text:p|text:h|text:list-item)>/g, '\n')
    .replace(/<[^>]+>/g, '')));
}

// A column letter (AB) to a 0-based number.
const colIndex = (ref) => [...(/^[A-Z]+/.exec(ref) || [''])[0]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

// Excel: each sheet as tab-separated rows.
function xlsxText(zip) {
  const get = (name) => { const e = zip.entries.find((x) => x.name === name); const b = e && zip.read(e); return b ? b.toString('utf8') : ''; };
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map((m) => decodeXml([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const names = [...get('xl/workbook.xml').matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeXml(m[1]));
  const sheets = zip.entries.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(a.name.match(/(\d+)\.xml$/)[1]) - Number(b.name.match(/(\d+)\.xml$/)[1]));
  const out = [];
  sheets.forEach((e, i) => {
    const xml = (zip.read(e) || Buffer.alloc(0)).toString('utf8');
    const rows = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= SHEET_ROWS) { rows.push('[… more rows not shown]'); break; }
      const cells = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const col = colIndex((/\br="([A-Z]+\d+)"/.exec(attrs) || [])[1] || '');
        if (col < 0 || col >= SHEET_COLS) continue;
        const type = (/\bt="(\w+)"/.exec(attrs) || [])[1];
        const body = c[2] || '';
        const v = (/<v>([\s\S]*?)<\/v>/.exec(body) || [])[1];
        let value = '';
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = decodeXml([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) value = decodeXml(v);
        while (cells.length < col) cells.push('');
        cells[col] = value.replace(/[\t\n\r]+/g, ' ');
      }
      if (cells.some(Boolean)) rows.push(cells.join('\t'));
    }
    if (rows.length) out.push(`## Sheet: ${names[i] || 'Sheet ' + (i + 1)}\n${rows.join('\n')}`);
  });
  return out.join('\n\n');
}

// EPUB: the book's pages in reading order.
function epubText(zip) {
  const get = (name) => { const e = zip.entries.find((x) => x.name === name); const b = e && zip.read(e); return b ? b.toString('utf8') : ''; };
  let pages = [];
  const rootPath = (/full-path="([^"]+)"/.exec(get('META-INF/container.xml')) || [])[1];
  if (rootPath) {
    const opf = get(rootPath);
    const dir = rootPath.includes('/') ? rootPath.slice(0, rootPath.lastIndexOf('/') + 1) : '';
    const manifest = new Map([...opf.matchAll(/<item\b[^>]*>/g)].map((m) => [(/\bid="([^"]*)"/.exec(m[0]) || [])[1], (/\bhref="([^"]*)"/.exec(m[0]) || [])[1]]));
    const decodeHref = (href) => {
      try { return decodeURIComponent(String(href).split(/[?#]/, 1)[0]); } catch { return null; }
    };
    pages = [...opf.matchAll(/<itemref\b[^>]*\bidref="([^"]*)"/g)]
      .map((m) => manifest.get(m[1])).filter(Boolean)
      .map((href) => { const decoded = decodeHref(href); return decoded === null ? null : dir + decoded; })
      .filter(Boolean);
  }
  if (!pages.length) pages = zip.entries.filter((e) => /\.(xhtml|html|htm)$/i.test(e.name)).map((e) => e.name).sort();
  const out = [];
  for (const name of pages) {
    const e = zip.entries.find((x) => x.name === name);
    const b = e && zip.read(e);
    if (!b) continue;
    out.push(tidy(decodeXml(b.toString('utf8')
      .replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, '')
      .replace(/<\/(?:p|div|h[1-6]|li|tr|br)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''))));
    if (out.join('\n\n').length > 200_000) break;
  }
  return out.filter(Boolean).join('\n\n');
}

// RTF: control words and groups removed, text kept.
const RTF_SKIP = /^\{\\(?:\*|fonttbl|colortbl|stylesheet|info|pict|header|footer|themedata|colorschememapping|latentstyles|datastore)/;
function rtfText(src) {
  let out = '';
  let skipDepth = 0;
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      depth += 1;
      if (!skipDepth && RTF_SKIP.test(src.slice(i, i + 20))) skipDepth = depth;
    } else if (ch === '}') {
      if (skipDepth === depth) skipDepth = 0;
      depth = Math.max(0, depth - 1);
    } else if (ch === '\\') {
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?|^\\'([0-9a-fA-F]{2})|^\\([\\{}])/.exec(src.slice(i, i + 40));
      if (!m) continue;
      i += m[0].length - 1;
      if (skipDepth) continue;
      if (m[3]) out += String.fromCharCode(parseInt(m[3], 16));
      else if (m[4]) out += m[4];
      else if (m[1] === 'par' || m[1] === 'line' || m[1] === 'row') out += '\n';
      else if (m[1] === 'tab' || m[1] === 'cell') out += '\t';
      else if (m[1] === 'u' && m[2]) { const n = Number(m[2]); out += String.fromCharCode(n < 0 ? n + 65536 : n); if (src[i + 1] === '?') i += 1; }
    } else if (!skipDepth && ch !== '\r' && ch !== '\n') out += ch;
  }
  return tidy(out);
}

// ZIP files that are documents: the text, and what kind of document it was.
function zipText(bytes, limits) {
  const zip = openZip(bytes);
  if (!zip) return null;
  const has = (re) => zip.entries.some((e) => re.test(e.name));
  const get = (name) => { const e = zip.entries.find((x) => x.name === name); const b = e && zip.read(e); return b ? b.toString('utf8') : ''; };

  if (has(/^word\/document\.xml$/)) {
    const parts = ['word/document.xml', ...zip.entries.filter((e) => /^word\/(?:footnotes|endnotes)\.xml$/.test(e.name)).map((e) => e.name)];
    return { source: 'Word document', text: parts.map((n) => docxText(get(n))).filter(Boolean).join('\n\n') };
  }
  if (has(/^xl\/workbook\.xml$/)) return { source: 'Excel workbook', text: xlsxText(zip) };
  if (has(/^ppt\/slides\/slide\d+\.xml$/)) {
    const slides = zip.entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
      .sort((a, b) => Number(a.name.match(/(\d+)\.xml$/)[1]) - Number(b.name.match(/(\d+)\.xml$/)[1]));
    const notes = (n) => slideText(get(`ppt/notesSlides/notesSlide${n}.xml`));
    return {
      source: 'PowerPoint presentation',
      text: slides.map((e) => {
        const n = e.name.match(/(\d+)\.xml$/)[1];
        const note = notes(n);
        return `## Slide ${n}\n${slideText((zip.read(e) || Buffer.alloc(0)).toString('utf8'))}${note ? `\n(Notes: ${note})` : ''}`;
      }).join('\n\n')
    };
  }
  if (has(/^content\.xml$/) && /^application\/vnd\.oasis\.opendocument\./.test(get('mimetype').trim())) {
    return { source: 'OpenDocument file', text: odfText(get('content.xml')) };
  }
  if (has(/^META-INF\/container\.xml$/) && /epub/.test(get('mimetype'))) return { source: 'EPUB book', text: epubText(zip) };

  // Any other ZIP: what is inside, and the text of the readable text files.
  const files = zip.entries.filter((e) => !e.name.endsWith('/'));
  const listing = files.slice(0, 200).map((e) => `- ${e.name} (${e.size} bytes)`).join('\n');
  let used = 0;
  const bodies = [];
  for (const e of files) {
    if (used > limits.maxTextChars || e.size > 200_000 || /^(__MACOSX\/|\.DS_Store)/.test(e.name)) continue;
    const b = zip.read(e);
    if (!b) continue;
    let t;
    try { t = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { continue; }
    if (t.includes('\u0000')) continue;
    used += t.length;
    bodies.push(`### ${e.name}\n${t}`);
  }
  return { source: 'ZIP archive', text: `Files inside (${files.length}):\n${listing}${bodies.length ? '\n\nText files:\n\n' + bodies.join('\n\n') : ''}` };
}

// Text that is not UTF-8 but says so in its first bytes (UTF-16 with a mark).
function decodeText(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
}

const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

// Returns [{ kind: 'image' | 'pdf' | 'text', mime, name, data (base64), text? }].
// Everything that is not a photo or PDF comes back as kind 'text', so the chat
// puts it in front of the model as the file's contents (data, not instructions).
// `unreadable: true` marks a file whose contents could not be read.
export function parseAttachments(list, limits) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw bad('attachments must be a list.');
  if (list.length > limits.maxCount) throw bad(`Send at most ${limits.maxCount} files at a time.`);

  let total = 0;
  return list.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.data !== 'string') throw bad('Each file needs its data.');
    const name = cleanName(item.name);
    const data = item.data.replace(/^data:[^;,]{1,100};base64,/, '');
    if (!data || data.length % 4 !== 0 || !BASE64.test(data)) throw bad(`"${name}" could not be read.`);
    const bytes = Buffer.from(data, 'base64');
    total += bytes.length;
    if (total > limits.maxTotalBytes) {
      throw new HttpError(413, 'attachments_too_large', `Files can be up to ${Math.round(limits.maxTotalBytes / 1048576)} MB in total.`);
    }

    const sniffed = sniff(bytes);
    if (sniffed === 'application/pdf') return { kind: 'pdf', mime: sniffed, name, data };
    if (sniffed && sniffed.startsWith('image/')) return { kind: 'image', mime: sniffed, name, data };

    const cut = (t) => (t.length > limits.maxTextChars ? t.slice(0, limits.maxTextChars) + '\n[… cut here: the file is longer]' : t);
    const unreadable = (why) => ({
      kind: 'text', mime: 'text/plain', name, data, unreadable: true,
      text: `[NasrinAI could not read the contents of this file (${why}; ${kb(bytes.length)}). Tell the person plainly that you cannot open it, and suggest a format you can read: a photo, PDF, Word, Excel, PowerPoint, text or CSV file.]`
    });

    if (sniffed === 'application/zip') {
      const doc = zipText(bytes, limits);
      if (!doc) return unreadable('a damaged or unsupported archive');
      const text = String(doc.text || '').replace(/\u0000/g, '').trim();
      if (!text) return unreadable(`a ${doc.source} with no readable text`);
      return { kind: 'text', mime: 'text/plain', name, data, text: cut(`[${doc.source}, converted to text]\n${text}`) };
    }
    if (sniffed === 'application/x-ole') return unreadable('an old Microsoft Office file; saving it as .docx, .xlsx or .pptx makes it readable');
    if (sniffed === 'text/rtf') {
      const text = rtfText(bytes.toString('latin1'));
      return text ? { kind: 'text', mime: 'text/plain', name, data, text: cut('[RTF document, converted to text]\n' + text) } : unreadable('an RTF file with no readable text');
    }

    // Anything else: readable if it is text, otherwise accepted but not read.
    const text = decodeText(bytes);
    if (text === null || text.includes('\u0000')) return unreadable('a binary file, such as audio, video, a program or an unknown format');
    return { kind: 'text', mime: 'text/plain', name, data, text: cut(text) };
  });
}

// The line saved with the message, so the conversation remembers what was sent.
export const attachmentNote = (files) => (files.length ? `[Attached: ${files.map((f) => f.name).join(', ')}]` : '');
