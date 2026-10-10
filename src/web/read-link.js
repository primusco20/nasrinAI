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

// Parse all valid IPv6 spellings into eight groups, including embedded IPv4.
function parseIPv6(ip) {
  let value = String(ip).toLowerCase().split('%')[0];
  const tail = value.match(/^(.*:)(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$/);
  if (tail) {
    const octets = tail.slice(2).map(Number);
    if (octets.some((n) => n > 255)) return null;
    value = tail[1] + ((octets[0] << 8) | octets[1]).toString(16) + ':' + ((octets[2] << 8) | octets[3]).toString(16);
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...left, ...(halves.length === 2 ? Array(missing).fill('0') : []), ...right];
  const parsed = groups.map((part) => /^[0-9a-f]{1,4}$/.test(part) ? parseInt(part, 16) : NaN);
  return parsed.length === 8 && !parsed.some(Number.isNaN) ? parsed : null;
}

function publicIPv4(ip) {
  if (!net.isIPv4(ip)) return false;
  const [a, b, c] = ip.split('.').map(Number);
  // Reject special-use, private, loopback, link-local, shared, documentation,
  // benchmarking, multicast, and reserved IPv4 ranges.
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 88 && c === 99) return false; // deprecated 6to4 relay range
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export function isPublicAddress(ip) {
  if (net.isIPv4(ip)) return publicIPv4(ip);
  if (!net.isIPv6(ip)) return false;
  const g = parseIPv6(ip);
  if (!g) return false;
  const zeros = (from, to) => g.slice(from, to).every((n) => n === 0);
  if (zeros(0, 7) && g[7] <= 1) return false; // unspecified and loopback
  if (zeros(0, 5) && g[5] === 0xffff) return publicIPv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.')); // IPv4-mapped
  if (zeros(0, 6)) return false; // IPv4-compatible
  if (g[0] === 0x0064 && g[1] === 0xff9b && zeros(2, 6)) {
    return publicIPv4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.')); // well-known NAT64
  }
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 1) return false; // local-use NAT64 (64:ff9b:1::/48)
  if (g[0] === 0x2002) return publicIPv4([g[1] >> 8, g[1] & 255, g[2] >> 8, g[2] & 255].join('.')); // 6to4 embeds IPv4
  if (g[0] === 0x2001 && g[1] <= 0x01ff) return false; // IETF special-purpose 2001::/23
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation range
  // Permit only global-unicast IPv6 (2000::/3), excluding special forms above.
  return (g[0] & 0xe000) === 0x2000;
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
      headers: { 'User-Agent': 'NasrinAI-LinkReader/1.0 (+https://nasrinai.com)', Accept: 'text/html,text/plain;q=0.9,*/*;q=0.1' },
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
      const chunks = []; let size = 0; let tooLarge = false;
      for await (const c of res) {
        size += c.length;
        if (size > MAX_BYTES) { tooLarge = true; res.destroy(); break; }
        chunks.push(c);
      }
      if (tooLarge) return { url: raw, error: 'the page is too large' };
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
