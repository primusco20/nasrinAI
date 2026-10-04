import { createHash, timingSafeEqual } from 'node:crypto';

// Business API keys, as made by public.create_api_key() in the database:
//   nsp_<12 hex>              publishable (public, origin-locked, widget only)
//   nss_<12 hex>_<48 hex>     secret (server to server; only its hash is stored)

const PUBLISHABLE = /^nsp_([0-9a-f]{12})$/;
const SECRET = /^nss_([0-9a-f]{12})_([0-9a-f]{48})$/;

export function parseKey(value) {
  const s = String(value || '').trim();
  let m = PUBLISHABLE.exec(s);
  if (m) return { kind: 'publishable', id: m[1] };
  m = SECRET.exec(s);
  if (m) return { kind: 'secret', id: m[1], secret: m[2] };
  return null;
}

// Must match encode(extensions.digest(secret, 'sha256'), 'hex') in SQL.
export const hashSecret = (secret) => createHash('sha256').update(secret).digest('hex');

export function secretMatches(secret, storedHash) {
  if (typeof storedHash !== 'string' || !/^[0-9a-f]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
