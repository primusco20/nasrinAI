// Security headers. API responses can never be framed, sniffed or cached;
// pages get a strict CSP with no inline script (the lesson of audit finding M4).

export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://vitals.vercel-insights.com",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

export const API_CSP = "default-src 'none'; frame-ancestors 'none'";

export function setBaseHeaders(res, { isProduction }) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

export function setApiHeaders(res) {
  res.setHeader('Content-Security-Policy', API_CSP);
  res.setHeader('Cache-Control', 'no-store');
}

export function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(text));
  res.end(text);
}
