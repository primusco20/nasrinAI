import { HttpError } from './errors.js';

// Reads a JSON object body, never more than `limit` bytes.
export async function readJson(req, limit) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw new HttpError(415, 'unsupported_media_type', 'Send the request body as JSON.');
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, 'too_large', 'That request is too large.');
  }

  const raw = await readRaw(req, limit);
  let parsed;
  try {
    parsed = JSON.parse(raw.toString('utf8') || 'null');
  } catch {
    throw new HttpError(400, 'invalid_json', 'That request was not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'invalid_json', 'Send a JSON object.');
  }
  return parsed;
}

// Reads the body as bytes, never more than `limit`. Used where the exact bytes
// matter, such as checking a payment provider's signature.
export async function readRaw(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, 'too_large', 'That request is too large.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too_large', 'That request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
