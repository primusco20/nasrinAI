import { HttpError } from './http/errors.js';

// Files sent with a chat message: photos, PDFs and plain-text files.
//
// - The browser sends them as base64 inside the JSON body.
// - The type is decided by the file's first bytes, never by its name or the
//   type the browser claims. Anything else is refused.
// - Text files must be valid UTF-8 with no NUL bytes.
// - They are used for this one reply and are not stored. The saved message
//   records only their names.

const NAME_BAD = /[\u0000-\u001f\u007f\\/<>:"|?*]/g;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const TEXT_TYPES = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json']);

function sniff(bytes) {
  const at = (i) => bytes[i];
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.length >= 5 && bytes.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

const bad = (message) => new HttpError(400, 'invalid_attachment', message);

export function cleanName(name) {
  const s = String(name || '').replace(NAME_BAD, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return s || 'file';
}

// Returns [{ kind: 'image' | 'pdf' | 'text', mime, name, data (base64), text? }].
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
    if (sniffed) return { kind: 'image', mime: sniffed, name, data };

    // Not an image or PDF: accept it only as UTF-8 text.
    const claimed = String(item.type || '').toLowerCase().split(';')[0].trim();
    if (claimed && !TEXT_TYPES.has(claimed)) throw bad(`"${name}" is not a supported file. Send photos, PDFs or text files.`);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = null; }
    if (text === null || text.includes('\u0000')) throw bad(`"${name}" is not a supported file. Send photos, PDFs or text files.`);
    if (text.length > limits.maxTextChars) text = text.slice(0, limits.maxTextChars) + '\n[… cut here: the file is longer]';
    return { kind: 'text', mime: 'text/plain', name, data, text };
  });
}

// The line saved with the message, so the conversation remembers what was sent.
export const attachmentNote = (files) => (files.length ? `[Attached: ${files.map((f) => f.name).join(', ')}]` : '');
