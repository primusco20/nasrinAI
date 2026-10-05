import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

// Reads a web page a person shared, for the model to use. The server fetches
// it, so the rules matter (SSRF):
//   - only http(s) on ports 80/443, no credentials in the URL
//   - the address is checked at connect time (not just looked up first), so a
//     name cannot switch to a private address in between (DNS rebinding)
//   - private, loopback, link-local, metadata and other internal ranges are refused
//   - at most 3 redirects, each checked the same way
//   - 8 seconds, 1.5 MB, text-like content only
// Returns readable text, never the raw HTML.

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8000;
const TYPES = /^(text\/html|text\/plain|application\/xhtml\+xml|application\/json|text\/markdown)/i;

export function isPublicAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;          // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return false;
    if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return false; // link-local
    if (v.startsWith('fc') || v.startsWith('fd')) return false;    // unique local
    if (v.startsWith('ff')) return false;                          // multicast
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPublicAddress(mapped[1]);
    return true;
  }
  return false;
}

// DNS lookup that refuses non-public answers; used by the socket itself.
export function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter((a) => isPublicAddress(a.address));
    if (!ok.length) return cb(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
    if (options && options.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

export function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) return null;
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) return null;
  return u;
}

function get(u) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: 'GET',
      lookup: safeLookup,
      headers: { 'User-Agent': 'NasrinAI-LinkReader/1.0 (+https://nasrinai.site)', Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
      timeout: TIMEOUT_MS
    }, (res) => resolve(res));
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end();
  });
}

// HTML to readable text: drops scripts, styles, navigation chrome and tags.
export function htmlToText(html) {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '';
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/tr|\/section|\/article)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) % 0x110000));
  const text = decode(body).replace(/[ \t\r\f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title: decode(title).replace(/\s+/g, ' ').trim().slice(0, 200), text };
}

// Resolves { url, title, text } or { url, error }.
export async function readLink(raw, { maxChars = 12_000, getImpl = get } = {}) {
  let u = checkUrl(raw);
  if (!u) return { url: raw, error: 'not a public web address' };
  try {
    for (let hop = 0; hop <= 3; hop++) {
      const res = await getImpl(u);
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = checkUrl(new URL(res.headers.location, u).href);
        if (!next) return { url: raw, error: 'redirects to a blocked address' };
        u = next;
        continue;
      }
      if (res.statusCode !== 200) { res.resume(); return { url: raw, error: `the site answered ${res.statusCode}` }; }
      const type = String(res.headers['content-type'] || '');
      if (!TYPES.test(type)) { res.resume(); return { url: raw, error: 'not a text page' }; }
      const chunks = []; let size = 0;
      for await (const c of res) {
        size += c.length;
        if (size > MAX_BYTES) { res.destroy(); break; }
        chunks.push(c);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const { title, text } = /html/i.test(type) ? htmlToText(body) : { title: '', text: body };
      if (!text.trim()) return { url: raw, error: 'the page has no readable text' };
      return { url: u.href, title, text: text.length > maxChars ? text.slice(0, maxChars) + '\n[… the page continues]' : text };
    }
    return { url: raw, error: 'too many redirects' };
  } catch (err) {
    return { url: raw, error: err?.code === 'EBLOCKED' ? 'not a public web address' : err?.code === 'ETIMEDOUT' ? 'the site did not answer in time' : 'the page could not be opened' };
  }
}

// The links in a message (at most `max`).
export function linksIn(text, max = 2) {
  const found = String(text || '').match(/https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g) || [];
  return [...new Set(found)].slice(0, max);
}
