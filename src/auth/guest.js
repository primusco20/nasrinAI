import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { UUID } from '../tenants.js';

// Guest sessions: nsg_<payload>.<signature>
// The payload names the tenant, a random guest id and an expiry; the signature
// is an HMAC with GUEST_SESSION_SECRET, so a guest cannot change any of them.

const PREFIX = 'nsg_';
const GUEST_ID = /^[0-9a-f]{32}$/;

const sign = (secret, payload) => createHmac('sha256', secret).update(payload).digest('base64url');

export function newGuestId() {
  return randomBytes(16).toString('hex');
}

export function issueGuestToken({ secret, tenantId, guestId, ttlSeconds, origin = null, now = Date.now() }) {
  if (!secret) throw new Error('guest sessions are not configured');
  const exp = Math.floor(now / 1000) + ttlSeconds;
  const safeOrigin = typeof origin === 'string' && /^https:\/\/[^/]+$/.test(origin) ? origin.toLowerCase() : null;
  const payload = Buffer.from(JSON.stringify({ v: 1, t: tenantId, g: guestId, e: exp, ...(safeOrigin ? { o: safeOrigin } : {}) })).toString('base64url');
  return { token: PREFIX + payload + '.' + sign(secret, payload), expiresAt: new Date(exp * 1000).toISOString() };
}

// Returns { tenantId, guestId } or null. Never throws on bad input.
export function verifyGuestToken(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string' || !token.startsWith(PREFIX) || token.length > 512) return null;
  const [payload, signature, extra] = token.slice(PREFIX.length).split('.');
  if (!payload || !signature || extra !== undefined) return null;

  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (!data || data.v !== 1 || !UUID.test(String(data.t)) || !GUEST_ID.test(String(data.g))) return null;
  if (!Number.isInteger(data.e) || data.e * 1000 <= now) return null;
  const origin = data.o === undefined ? null : (typeof data.o === 'string' && /^https:\/\/[^/]+$/.test(data.o) ? data.o.toLowerCase() : null);
  if (data.o !== undefined && !origin) return null;
  return { tenantId: data.t.toLowerCase(), guestId: data.g, origin };
}

export const isGuestToken = (token) => typeof token === 'string' && token.startsWith(PREFIX);
