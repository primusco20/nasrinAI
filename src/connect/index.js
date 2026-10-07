import { createHash, randomBytes } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';

const MAX_HTML = 512 * 1024;
const TIMEOUT_MS = 8_000;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const blocked = (ip) => {
  const v = net.isIP(ip);
  if (v === 4) {
    const n = ip.split('.').map(Number);
    return n[0] === 10 || n[0] === 127 || n[0] === 0 || (n[0] === 169 && n[1] === 254) ||
      (n[0] === 192 && n[1] === 168) || (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
      (n[0] >= 224) || (n[0] === 100 && n[1] >= 64 && n[1] <= 127);
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    return s === '::1' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80:') || s.startsWith('ff');
  }
  return true;
};

async function publicAddresses(host) {
  if (net.isIP(host)) {
    if (blocked(host)) throw Object.assign(new Error('private destination'), { code: 'unsafe_destination' });
    return [host];
  }
  if (!DOMAIN.test(host) || host === 'localhost' || host.endsWith('.local')) {
    throw Object.assign(new Error('invalid or local host'), { code: 'invalid_host' });
  }
  const rows = await dns.lookup(host, { all: true, verbatim: true });
  const ips = [...new Set(rows.map((x) => x.address))];
  if (!ips.length || ips.some(blocked)) throw Object.assign(new Error('host resolves to a blocked address'), { code: 'unsafe_destination' });
  return ips;
}

function normalizeUrl(value) {
  let u;
  try { u = new URL(String(value || '').trim()); } catch { throw Object.assign(new Error('Enter a valid website URL.'), { code: 'invalid_url' }); }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || u.search || u.hash || u.pathname !== '/') {
    throw Object.assign(new Error('Use the public HTTPS website origin only.'), { code: 'invalid_url' });
  }
  const host = u.hostname.toLowerCase();
  if (!DOMAIN.test(host) || host === 'localhost' || host.endsWith('.local')) throw Object.assign(new Error('That website address is not supported.'), { code: 'invalid_host' });
  return { origin: \`https://\${host}\`, host };
}

function fetchPinned(url, ip) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      protocol: 'https:',
      hostname: u.hostname,
      port: 443,
      path: '/',
      method: 'GET',
      servername: u.hostname,
      lookup: (_host, _opts, cb) => cb(null, ip, net.isIP(ip)),
      rejectUnauthorized: true,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'NasrinAI-Connect/1.0', Accept: 'text/html,application/xhtml+xml' }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        reject(Object.assign(new Error('redirects are not followed'), { code: 'redirect_not_allowed' }));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_HTML) {
          req.destroy();
          reject(Object.assign(new Error('website response is too large'), { code: 'response_too_large' }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        type: String(res.headers['content-type'] || ''),
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('website request timed out'), { code: 'timeout' })));
    req.on('error', reject);
    req.end();
  });
}

const titleOf = (html) => String(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);

const platformOf = (html, headers) => {
  const h = String(html).toLowerCase();
  const server = String(headers?.server || '').toLowerCase();
  if (h.includes('wp-content') || h.includes('wordpress')) return 'wordpress';
  if (h.includes('cdn.shopify.com') || h.includes('shopify')) return 'shopify';
  if (h.includes('__next_data__') || h.includes('/_next/')) return 'nextjs';
  if (h.includes('wixstatic.com') || h.includes('wix.com')) return 'wix';
  if (h.includes('webflow') || h.includes('webflow.com')) return 'webflow';
  if (server.includes('vercel')) return 'vercel';
  if (server.includes('cloudflare')) return 'cloudflare';
  return 'custom';
};

export function normalizeConnectUrl(value) {
  return normalizeUrl(value);
}

export async function analyzeWebsite(value) {
  const { origin, host } = normalizeUrl(value);
  const ips = await publicAddresses(host);
  const result = await fetchPinned(origin, ips[0]);
  if (result.status < 200 || result.status >= 400) throw Object.assign(new Error(\`Website returned HTTP \${result.status}.\`), { code: 'website_unavailable' });
  if (!/^text\/(html|xhtml)/i.test(result.type)) throw Object.assign(new Error('The website does not appear to be an HTML site.'), { code: 'not_html' });
  const html = result.body;
  const scripts = (html.match(/<script\b/gi) || []).length;
  return {
    origin, host, reachable: true, status: result.status, title: titleOf(html),
    platform: platformOf(html, result.headers), scripts,
    content_bytes: Buffer.byteLength(html),
    installation_paths: ['authorized_script', 'managed', 'manual']
  };
}

export function newVerificationToken() {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}
