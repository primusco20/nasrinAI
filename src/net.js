import { isIP } from 'node:net';

// The client's IP. Behind N trusted proxies, each proxy appends the address it
// saw to X-Forwarded-For, so the real client is the Nth entry from the right.
// Entries further left were written by the client and cannot be trusted.
export function clientIpFrom(req, hops) {
  const direct = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (!hops) return direct;
  const header = req.headers['x-forwarded-for'];
  if (!header) return direct;
  const entries = String(header).split(',').map((s) => s.trim()).filter(Boolean);
  const candidate = entries[entries.length - hops];
  const ip = candidate ? candidate.replace(/^::ffff:/, '') : '';
  return isIP(ip) ? ip : direct;
}
