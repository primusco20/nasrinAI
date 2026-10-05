import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Connector credentials are stored only encrypted: AES-256-GCM with the
// server's CONNECTOR_SECRET_KEY (32 bytes, hex or base64), bound to the
// tenant and connector name, so a stored value cannot be moved to another
// connector. Format: v1.<iv>.<tag>.<ciphertext> (base64url).

export function parseKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const buf = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64');
  return buf.length === 32 ? buf : null;
}

const aad = (tenantId, name) => Buffer.from(`${tenantId}:${name}`);

export function seal(key, plain, { tenantId, name }) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad(tenantId, name));
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), ct].map((x) => (typeof x === 'string' ? x : x.toString('base64url'))).join('.');
}

export function open(key, sealed, { tenantId, name }) {
  const [v, iv, tag, ct] = String(sealed || '').split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('not a sealed secret');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAAD(aad(tenantId, name));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}
