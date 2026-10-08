import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';
import { HttpError } from '../http/errors.js';
import { crawlSite } from './site-knowledge.js';

const MAX_HTML = 512 * 1024;
const DEFAULT_APP_ORIGIN = 'https://nasrinai.com';
const HOSTED_CODE = /^[A-Za-z0-9_-]{22}$/;
const TIMEOUT_MS = 8_000;
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENETUNREACH',
  'EHOSTUNREACH', 'EHOSTDOWN', 'EPIPE', 'EADDRNOTAVAIL'
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

const blockedV4 = (n) =>
  n[0] === 10 || n[0] === 127 || n[0] === 0 || (n[0] === 169 && n[1] === 254) ||
  (n[0] === 192 && n[1] === 168) || (n[0] === 172 && n[1] >= 16 && n[1] <= 31) ||
  (n[0] >= 224) || (n[0] === 100 && n[1] >= 64 && n[1] <= 127);

// Expands any IPv6 text form (including an embedded dotted IPv4 tail) into
// eight 16-bit numbers. Returns null for anything that does not parse.
function parseV6(ip) {
  let s = String(ip).toLowerCase().split('%')[0];
  const tail = s.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (tail) {
    const o = tail.slice(2).map(Number);
    if (o.some((x) => x > 255)) return null;
    s = tail[1] + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...(halves.length === 2 ? Array(fill).fill('0') : []), ...rest];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.length === 8 && !nums.some(Number.isNaN) ? nums : null;
}

const v4Of = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];

// True when a destination must never be contacted. Anything that does not
// parse is treated as blocked (fail closed).
export const isBlockedAddress = (ip) => {
  const v = net.isIP(ip);
  if (v === 4) return blockedV4(ip.split('.').map(Number));
  if (v === 6) {
    const g = parseV6(ip);
    if (!g) return true;
    const zeros = (from, to) => g.slice(from, to).every((x) => x === 0);
    if (zeros(0, 7) && g[7] <= 1) return true;                          // :: and ::1
    if (zeros(0, 5) && g[5] === 0xffff) return blockedV4(v4Of(g[6], g[7])); // ::ffff:a.b.c.d (any text form)
    if (zeros(0, 6)) return true;                                       // IPv4-compatible ::a.b.c.d
    if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return blockedV4(v4Of(g[6], g[7])); // NAT64
    if (g[0] === 0x2002) return blockedV4(v4Of(g[1], g[2]));            // 6to4
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true;                // documentation range
    if ((g[0] & 0xfe00) === 0xfc00) return true;                        // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
    if ((g[0] & 0xff00) === 0xff00) return true;                        // multicast
    return false;
  }
  return true;
};
const blocked = isBlockedAddress;

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
  return { origin: `https://${host}`, host };
}

function fetchPinned(url, ip, requestPath = '/') {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      protocol: 'https:',
      hostname: u.hostname,
      port: 443,
      path: requestPath,
      method: 'GET',
      servername: u.hostname,
      lookup: (_host, opts, cb) => (opts && opts.all ? cb(null, [{ address: ip, family: net.isIP(ip) }]) : cb(null, ip, net.isIP(ip))),
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

async function fetchPublicWebsite(origin, ips, path = '/') {
  let lastError;
  for (const ip of ips) {
    try {
      return await fetchPinned(origin, ip, path);
    } catch (err) {
      lastError = err;
      if (!RETRYABLE_NETWORK_CODES.has(err && err.code)) throw err;
    }
  }
  throw lastError;
}

// One page of a public site, SSRF-pinned like analysis. DNS is re-checked on every call.
export async function fetchPublicPage(origin, path) {
  const { origin: safe, host } = normalizeUrl(origin);
  return fetchPublicWebsite(safe, await publicAddresses(host), path);
}

export async function analyzeWebsite(value) {
  const { origin, host } = normalizeUrl(value);
  const ips = await publicAddresses(host);
  const result = await fetchPublicWebsite(origin, ips);
  if (result.status < 200 || result.status >= 400) throw Object.assign(new Error(`Website returned HTTP ${result.status}.`), { code: 'website_unavailable' });
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

function hashEquals(token, expected) {
  const a = Buffer.from(createHash('sha256').update(String(token)).digest('hex'), 'utf8');
  const b = Buffer.from(String(expected || ''), 'utf8');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

async function verifyPublishedToken(siteUrl, token) {
  const { origin, host } = normalizeUrl(siteUrl);
  const ips = await publicAddresses(host);
  const home = await fetchPinned(origin, ips[0], '/');
  const meta = home.body.match(/<meta[^>]+name=["']nasrinai-connect["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1]
    || home.body.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']nasrinai-connect["'][^>]*>/i)?.[1];
  if (meta && meta === token) return 'meta';
  try {
    const challenge = await fetchPinned(origin, ips[0], '/.well-known/nasrinai-connect.txt');
    if (challenge.status >= 200 && challenge.status < 300 && challenge.body.trim() === token) return 'well_known';
  } catch {}
  return null;
}


// True when the page HTML carries the SmartChat script tag with this exact
// widget key. Used to turn "ready" into "active" after a manual install.
const WIDGET_KEY = /^nsp_[0-9a-f]{12}$/;
export function hasWidgetTag(html, key) {
  if (!WIDGET_KEY.test(String(key))) return false;
  const tags = String(html).match(/<script\b[^>]*>/gi) || [];
  const wanted = new RegExp('data-nasrin-key\\s*=\\s*["\']' + key + '["\']', 'i');
  return tags.some((tag) => /\/connect\/smartchat\.js/i.test(tag) && wanted.test(tag));
}

// Does a Content-Security-Policy let a page load scripts from, and talk to, appOrigin?
// Returns the directives that would block it: a subset of ['script-src', 'connect-src'].
export function cspBlocks(policy, appOrigin) {
  const text = String(policy || '').trim();
  if (!text) return [];
  const directives = new Map();
  for (const part of text.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
  }
  let host = '';
  try { host = new URL(appOrigin).host.toLowerCase(); } catch { return []; }
  const allows = (sources) => sources.some((raw) => {
    const src = raw.toLowerCase();
    if (src === '*' || src === 'https:' || src === appOrigin.toLowerCase()) return true;
    const bare = src.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (bare === host) return true;
    if (bare.startsWith('*.') && host.endsWith(bare.slice(1))) return true;
    return false;
  });
  const blocked = [];
  for (const name of ['script-src', 'connect-src']) {
    const sources = directives.get(name) || directives.get('default-src');
    if (!sources) continue;
    const strict = name === 'script-src' && sources.some((x) => x.toLowerCase() === "'strict-dynamic'");
    if (strict || !allows(sources)) blocked.push(name);
  }
  return blocked;
}

const metaPolicy = (html) => {
  const tag = String(html).match(/<meta\b[^>]*http-equiv\s*=\s*["']content-security-policy["'][^>]*>/i);
  return tag ? (tag[0].match(/content\s*=\s*["']([^"']*)["']/i) || [])[1] || '' : '';
};

async function verifyPublishedWidget(siteUrl, key) {
  if (!WIDGET_KEY.test(String(key))) return { found: false, policies: [] };
  const { origin, host } = normalizeUrl(siteUrl);
  const ips = await publicAddresses(host);
  const home = await fetchPublicWebsite(origin, ips);
  if (home.status < 200 || home.status >= 300) return { found: false, policies: [] };
  const header = home.headers && home.headers['content-security-policy'];
  const policies = [Array.isArray(header) ? header.join(', ') : header, metaPolicy(home.body)].filter(Boolean);
  return { found: hasWidgetTag(home.body, key), policies };
}

const publicRow = (r) => ({
  id: r.id, site_origin: r.site_origin, site_host: r.site_host, status: r.status,
  platform: r.platform, installation_method: r.installation_method,
  authorization_method: r.authorization_method,
  verification_expires_at: r.verification_expires_at,
  activated_at: r.activated_at, removed_at: r.removed_at,
  last_verified_at: r.last_verified_at, last_error_code: r.last_error_code,
  created_at: r.created_at, updated_at: r.updated_at
});

// Analysis and storage failures are plain Errors with a code. Without this they
// all reach the person as a generic 500, hiding what to fix.
function publicConnectError(err) {
  if (err instanceof HttpError) return err;
  const code = err && err.code;
  const msg = {
    invalid_url: [400, 'Enter your website as https://yourdomain.com (no page path).'],
    invalid_host: [400, 'That website address is not supported.'],
    unsafe_destination: [400, 'That website address is not allowed.'],
    redirect_not_allowed: [422, 'That address redirects somewhere else. Enter the final address that opens directly, with or without www.'],
    website_unavailable: [422, err && err.message],
    not_html: [422, 'The website does not appear to be an HTML site.'],
    ENOTFOUND: [422, 'We could not find that website. Check the address and that its DNS is set up.'],
    EAI_AGAIN: [422, 'We could not look up that website. Please try again.'],
    ECONNREFUSED: [422, 'We could not reach that website.'],
    ECONNRESET: [422, 'We could not reach that website.'],
    ETIMEDOUT: [422, 'That website took too long to respond.'],
    CERT_HAS_EXPIRED: [422, 'That website has an invalid or expired HTTPS certificate.'],
    ERR_TLS_CERT_ALTNAME_INVALID: [422, 'That website has an invalid HTTPS certificate.'],
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: [422, 'That website has an invalid HTTPS certificate.'],
    DEPTH_ZERO_SELF_SIGNED_CERT: [422, 'That website has an invalid HTTPS certificate.'],
    response_too_large: [422, 'That website response is too large to analyze.'],
    ENODATA: [422, 'We could not find a usable DNS record for that website.'],
    ESERVFAIL: [422, 'That website DNS service is temporarily unavailable.'],
    EHOSTDOWN: [422, 'We could not reach that website.'],
    ENETUNREACH: [422, 'We could not reach that website from the network.'],
    EHOSTUNREACH: [422, 'We could not reach that website from the network.'],
    EPIPE: [422, 'The website connection closed unexpectedly.'],
    EADDRNOTAVAIL: [422, 'We could not establish a connection to that website.'],
    storage_error: [503, 'NasrinAI Connect is not set up on the server yet. Please try again later.'],
    storage_unavailable: [503, 'NasrinAI Connect storage is not responding. Please try again shortly.']
  }[code];
  if (msg) return new HttpError(msg[0], code, msg[1] || 'We could not analyze that website.');
  if (/timeout|timed out|aborted/i.test(String(err && err.message))) return new HttpError(422, 'website_timeout', 'That website took too long to respond.');
  if (/certificate|SSL|TLS|self.signed/i.test(String(err && (err.code || err.message)))) return new HttpError(422, 'website_tls', 'That website has an invalid HTTPS certificate.');
  return err;
}

export function createConnect({ url, secretKey, createPublishableKey = null, revokePublishableKey = null, installRegistry = null, fetchImpl = fetch, analyze = analyzeWebsite, verifyOwnership = verifyPublishedToken, verifyWidget = verifyPublishedWidget, knowledgeSink = null, crawl = crawlSite, fetchPage = fetchPublicPage }) {
  if (!url || !secretKey) return null;
  const base = String(url).replace(/\/+$/, '');

  async function request(method, path, body) {
    const where = method + ' ' + path.split('?')[0];
    let res;
    try {
      res = await fetchImpl(base + '/rest/v1/' + path, {
        method,
        headers: { apikey: secretKey, Authorization: 'Bearer ' + secretKey, 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000)
      });
    } catch (cause) {
      // fetch() throws a bare TypeError ('fetch failed') when the database
      // cannot be reached; without a code it became a generic 500.
      const why = (cause && cause.cause && (cause.cause.code || cause.cause.message)) || (cause && (cause.name || cause.message));
      const err = new Error('Connect storage is unreachable (' + where + '): ' + why);
      err.code = 'storage_unavailable';
      throw err;
    }
    if (!res.ok) {
      const detail = String(await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      const err = new Error('Connect storage request failed (HTTP ' + res.status + ' ' + where + ')' + (detail ? ': ' + detail : ''));
      err.code = res.status >= 500 ? 'storage_unavailable' : 'storage_error';
      throw err;
    }
    return res.status === 204 ? [] : await res.json().catch(() => []);
  }

  async function list(caller) {
    const rows = await request('GET', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&order=created_at.desc&select=id,site_origin,site_host,status,platform,installation_method,authorization_method,verification_expires_at,activated_at,removed_at,last_verified_at,last_error_code,created_at,updated_at');
    return rows.map(publicRow);
  }

  async function get(caller, id) {
    if (!UUID.test(String(id))) return null;
    const rows = await request('GET', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id + '&limit=1&select=*');
    return rows[0] ? publicRow(rows[0]) : null;
  }

  async function analyzeAndCreate(caller, siteUrl) {
    try { return await analyzeAndCreateInner(caller, siteUrl); } catch (err) {
      const mapped = publicConnectError(err);
      if (mapped !== err) console.error('connect analyze failed:', err && (err.code || err.message), err && err.message);
      throw mapped;
    }
  }

  async function analyzeAndCreateInner(caller, siteUrl) {
    const { origin } = normalizeUrl(siteUrl);
    const existing = (await request('GET', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&site_origin=eq.' + encodeURIComponent(origin) + '&limit=1&select=id,status'))[0];
    if (existing && existing.status !== 'removed') {
      throw new HttpError(409, 'already_connected', 'This website is already in your Connect workspace.');
    }
    const info = await analyze(siteUrl);
    const token = randomBytes(24).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const fresh = {
      status: 'verification_required', platform: info.platform,
      verification_token_hash: hash,
      verification_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      metadata: { analysis: info }
    };
    let rows;
    if (existing) {
      // A removed site starts over: new challenge, and no authorization,
      // configuration or approval carries across.
      rows = await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + existing.id + '&status=eq.removed', {
        ...fresh, installation_method: null, authorization_method: null, authorization_ref: null,
        activated_at: null, removed_at: null, last_verified_at: null, last_error_code: null, last_error_message: null,
        ai_config: {}, config_approved_at: null, config_approved_by: null, config_approval_hash: null,
        updated_at: new Date().toISOString()
      });
      if (!rows.length) throw new HttpError(409, 'already_connected', 'This website is already in your Connect workspace.');
    } else {
      rows = await request('POST', 'connect_installations', {
        tenant_id: caller.tenantId, site_origin: info.origin, site_host: info.host, ...fresh
      });
    }
    const row = rows[0];
    if (!row) throw Object.assign(new Error('Connect storage saved the site but returned no row'), { code: 'storage_error' });
    return { ...publicRow(row), verification: { required: true, method: 'authorization', token, expires_at: row.verification_expires_at } };
  }

  async function verify(caller, id, token) {
    if (!UUID.test(String(id)) || typeof token !== 'string' || token.length < 20 || token.length > 128) return null;
    const current = await get(caller, id);
    if (!current || current.status !== 'verification_required') return null;
    const rows = await request('GET', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id + '&limit=1&select=*');
    const row = rows[0];
    if (!row || !row.verification_token_hash || !row.verification_expires_at || Date.parse(row.verification_expires_at) <= Date.now()) return null;
    if (!hashEquals(token, row.verification_token_hash)) return null;
    const method = await verifyOwnership(row.site_origin, token);
    if (!method) return null;
    const updated = await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id, {
      status: 'authorized', authorization_method: method, authorization_ref: method + ':' + row.site_host,
      verification_token_hash: null, verification_expires_at: null, last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    return updated[0] ? publicRow(updated[0]) : null;
  }

  async function getRawMetadata(caller, id) {
    if (!UUID.test(String(id))) return {};
    const rows = await request('GET', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id + '&limit=1&select=metadata');
    return rows[0]?.metadata && typeof rows[0].metadata === 'object' ? rows[0].metadata : {};
  }

  const approvalCurrent = (row) => {
    if (!row.config_approval_hash || !row.config_approved_at) return false;
    return createHash('sha256').update(JSON.stringify(row.ai_config && typeof row.ai_config === 'object' ? row.ai_config : {})).digest('hex') === row.config_approval_hash;
  };

  function assertApproved(row, doing) {
    if (!row.config_approval_hash || !row.config_approved_at) {
      throw new HttpError(409, 'approval_required', 'Approve the SmartChat configuration before ' + doing + '.');
    }
    const currentHash = createHash('sha256').update(
      JSON.stringify(row.ai_config && typeof row.ai_config === 'object' ? row.ai_config : {})
    ).digest('hex');
    if (currentHash !== row.config_approval_hash) {
      throw new HttpError(409, 'approval_stale', 'The SmartChat configuration changed after approval. Approve the latest configuration before ' + doing + '.');
    }
  }

  async function provisionKey(caller, id) {
    const row = await getConfig(caller, id);
    if (!row) throw new HttpError(404, 'not_found', 'Connect site not found.');
    if (row.status === 'removed') throw new HttpError(409, 'removed', 'This Connect site has been removed.');
    if (!['ready', 'active'].includes(row.status)) {
      throw new HttpError(409, 'approval_required', 'Approve the SmartChat configuration before provisioning its widget key.');
    }
    assertApproved(row, 'provisioning its widget key');
    if (typeof createPublishableKey !== 'function') {
      throw new HttpError(503, 'key_provisioning_unavailable', 'SmartChat activation is not configured yet.');
    }
    const key = await createPublishableKey({
      tenantId: caller.tenantId,
      origin: row.site_origin,
      label: 'NasrinAI Connect'
    });
    await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id, {
      metadata: { ...(row.metadata || {}), widget_key_issued: true, widget_key_issued_at: new Date().toISOString() },
      updated_at: new Date().toISOString()
    });
    return { key, origin: row.site_origin };
  }

  function normalizeAiConfig(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'invalid_config', 'SmartChat configuration is invalid.');
    const allowedRoles = new Set(['customer_support', 'sales', 'booking', 'receptionist', 'product_advisor', 'lead_qualification', 'operations']);
    const roles = Array.isArray(input.roles) ? [...new Set(input.roles.filter((x) => typeof x === 'string' && allowedRoles.has(x)))].slice(0, 5) : [];
    if (!roles.length) throw new HttpError(400, 'invalid_config', 'Choose at least one AI role.');
    const tone = ['professional', 'friendly', 'concise', 'warm'].includes(input.tone) ? input.tone : 'professional';
    const welcome = typeof input.welcome === 'string' ? input.welcome.trim().slice(0, 280) : '';
    const handoff = Boolean(input.human_handoff);
    return Object.freeze({ roles, tone, welcome, human_handoff: handoff });
  }

  async function getConfig(caller, id) {
    if (!UUID.test(String(id))) return null;
    const rows = await request('GET', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id + '&limit=1&select=id,status,site_origin,site_host,platform,ai_config,metadata,config_approved_at,config_approved_by,config_approval_hash,updated_at');
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, status: row.status, site_origin: row.site_origin, site_host: row.site_host, platform: row.platform, ai_config: row.ai_config && typeof row.ai_config === 'object' ? row.ai_config : {}, config_approved_at: row.config_approved_at || null, config_approved_by: row.config_approved_by || null, config_approval_hash: row.config_approval_hash || null, metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {}, updated_at: row.updated_at };
  }

  async function previewConfig(caller, id) {
    const config = await getConfig(caller, id);
    if (!config) throw new HttpError(404, 'not_found', 'Connect site not found.');
    if (!['authorized', 'ready', 'paused', 'failed'].includes(config.status)) {
      throw new HttpError(409, 'authorization_required', 'Authorize the website before previewing SmartChat.');
    }
    if (!Array.isArray(config.ai_config.roles) || !config.ai_config.roles.length) {
      throw new HttpError(409, 'config_required', 'Save the SmartChat configuration before previewing it.');
    }
    const roleLabels = {
      customer_support: 'Customer Support',
      sales: 'Sales',
      booking: 'Booking',
      receptionist: 'Receptionist',
      product_advisor: 'Product Advisor',
      lead_qualification: 'Lead Qualification',
      operations: 'Operations'
    };
    return {
      site: { id: config.id, host: config.site_host, origin: config.site_origin, platform: config.platform },
      configuration: {
        roles: config.ai_config.roles.map((role) => roleLabels[role] || role),
        tone: config.ai_config.tone,
        welcome: config.ai_config.welcome,
        human_handoff: config.ai_config.human_handoff
      },
      effects: [
        'This preview does not modify your website.',
        'No provider credentials are created by preview.',
        'Installation requires a separate supported provider and your explicit approval.'
      ]
    };
  }

  async function saveConfig(caller, id, input) {
    const current = await getConfig(caller, id);
    if (!current) throw new HttpError(404, 'not_found', 'Connect site not found.');
    if (current.status === 'removed') throw new HttpError(409, 'removed', 'This Connect site has been removed.');
    if (!['authorized', 'ready', 'paused', 'failed'].includes(current.status)) {
      throw new HttpError(409, 'authorization_required', 'Authorize the website before configuring SmartChat.');
    }
    const config = normalizeAiConfig(input);
    const rows = await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id, {
      ai_config: config,
      status: current.status === 'authorized' ? 'ready' : current.status,
      config_approved_at: null,
      config_approved_by: null,
      config_approval_hash: null,
      updated_at: new Date().toISOString()
    });
    const row = rows[0];
    return row ? { id: row.id, status: row.status, ai_config: row.ai_config, updated_at: row.updated_at } : null;
  }

  async function approveConfig(caller, id) {
    const config = await getConfig(caller, id);
    if (!config) throw new HttpError(404, 'not_found', 'Connect site not found.');
    if (!['authorized', 'ready'].includes(config.status)) throw new HttpError(409, 'invalid_state', 'This website is not ready for configuration approval.');
    if (!Array.isArray(config.ai_config.roles) || !config.ai_config.roles.length) {
      throw new HttpError(409, 'config_required', 'Save the SmartChat configuration before approving it.');
    }
    const canonical = JSON.stringify(config.ai_config);
    const hash = createHash('sha256').update(canonical).digest('hex');
    const now = new Date().toISOString();
    const rows = await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id, {
      config_approved_at: now,
      config_approved_by: caller.actor?.id || null,
      config_approval_hash: hash,
      updated_at: now
    });
    if (!rows.length) throw new HttpError(404, 'not_found', 'Connect site not found.');
    return { approved: true, approved_at: now, approval_hash: hash };
  }

  async function install(caller, id, method) {
    const current = await getConfig(caller, id);
    if (!current) throw new HttpError(404, 'not_found', 'Connect site not found.');
    if (current.status === 'removed') throw new HttpError(409, 'removed', 'This Connect site has been removed.');
    if (current.status !== 'ready') throw new HttpError(409, 'invalid_state', 'This website is not ready for installation.');
    if (!current.config_approval_hash || !current.config_approved_at) throw new HttpError(409, 'approval_required', 'Approve the current SmartChat configuration before installation.');
    const currentHash = createHash('sha256').update(JSON.stringify(current.ai_config && typeof current.ai_config === 'object' ? current.ai_config : {})).digest('hex');
    if (currentHash !== current.config_approval_hash) throw new HttpError(409, 'approval_stale', 'The SmartChat configuration changed after approval.');
    if (typeof method !== 'string' || !method || method.length > 64) throw new HttpError(400, 'invalid_method', 'Choose a supported installation method.');
    if (!installRegistry || typeof installRegistry.install !== 'function') throw new HttpError(409, 'provider_unavailable', 'No supported installation provider is available for this website.');
    // Fail closed before touching the lifecycle: no registered provider, no "installing".
    if (typeof installRegistry.methods !== 'function' || !installRegistry.methods().includes(method)) {
      throw new HttpError(409, 'provider_unavailable', 'No supported installation provider is available for this website.');
    }

    // Atomically claim ready so concurrent requests cannot install twice.
    const now = new Date().toISOString();
    const claimed = await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id + '&status=eq.ready&config_approval_hash=eq.' + encodeURIComponent(current.config_approval_hash), {
      status: 'installing', installation_method: method, last_error_code: null, last_error_message: null, updated_at: now
    });
    if (!claimed.length) throw new HttpError(409, 'installation_in_progress', 'This website is already being installed or its approval changed.');

    try {
      const result = await installRegistry.install(method, {
        tenantId: caller.tenantId, siteId: current.id, origin: current.site_origin, host: current.site_host,
        platform: current.platform, config: current.ai_config, approved: true, authorized: true, actorId: caller.actor?.id || null
      });
      const verifiedAt = new Date().toISOString();
      const receiptHash = result.receipt === undefined
        ? null
        : createHash('sha256').update(JSON.stringify(result.receipt)).digest('hex');
      await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id + '&status=eq.installing', {
        status: 'active', activated_at: verifiedAt, last_verified_at: verifiedAt,
        metadata: {
          ...(current.metadata || {}),
          deployment_receipt_hash: receiptHash,
          version: result.version || null
        },
        updated_at: verifiedAt
      });
      // Never return or persist the provider receipt itself; it may contain
      // provider-specific deployment identifiers or sensitive material.
      return { active: true, version: result.version };
    } catch (error) {
      const failedAt = new Date().toISOString();
      const rollbackFailed = error?.code === 'rollback_failed';
      await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id + '&status=eq.installing', {
        status: 'failed', last_error_code: rollbackFailed ? 'rollback_failed' : (error?.code || 'installation_failed'),
        last_error_message: rollbackFailed ? 'Installation verification failed and automatic rollback could not complete.' : 'Installation failed; changes were rolled back when supported.',
        updated_at: failedAt
      });
      throw error;
    }
  }


  // Manual install: show the one script line the business pastes into its own
  // site. The widget key is public (origin-locked, chat only), so it is kept and
  // shown again rather than minted anew each time.
  async function installSnippet(caller, id, appOrigin) {
    const row = await getConfig(caller, id);
    if (!row) throw new HttpError(404, 'not_found', 'Connect site not found.');
    if (row.status === 'removed') throw new HttpError(409, 'removed', 'This Connect site has been removed.');
    if (!['ready', 'active'].includes(row.status)) {
      throw new HttpError(409, 'approval_required', 'Save and approve the SmartChat configuration before installing it.');
    }
    assertApproved(row, 'installing it');
    let key = row.metadata && row.metadata.widget_key;
    if (!WIDGET_KEY.test(String(key || '')) || row.metadata.widget_key_origin !== row.site_origin) {
      key = (await provisionKey(caller, id)).key;
      const meta = await getRawMetadata(caller, id);
      await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id, {
        metadata: { ...meta, widget_key: key, widget_key_origin: row.site_origin }, updated_at: new Date().toISOString()
      });
    }
    const app = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(String(appOrigin || '')) ? appOrigin : DEFAULT_APP_ORIGIN;
    const snippet = '<script defer src="' + app + '/connect/smartchat.js" data-nasrin-key="' + key + '"' +
      (app === DEFAULT_APP_ORIGIN ? '' : ' data-nasrin-api="' + app + '"') + '></script>';
    return { snippet, origin: row.site_origin };
  }

  // After the business pastes the snippet: look for it on the live home page.
  async function activate(caller, id, appOrigin) {
    try { return await activateInner(caller, id, appOrigin); } catch (err) {
      const mapped = publicConnectError(err);
      if (mapped !== err) console.error('connect activate failed:', err && (err.code || err.message));
      throw mapped;
    }
  }

  async function activateInner(caller, id, appOrigin) {
    const row = await getConfig(caller, id);
    if (!row) throw new HttpError(404, 'not_found', 'Connect site not found.');
    if (row.status === 'removed') throw new HttpError(409, 'removed', 'This Connect site has been removed.');
    if (!['ready', 'active'].includes(row.status)) throw new HttpError(409, 'invalid_state', 'This website is not ready for installation.');
    assertApproved(row, 'installing it');
    const key = row.metadata && row.metadata.widget_key;
    if (!WIDGET_KEY.test(String(key || ''))) throw new HttpError(409, 'snippet_required', 'Get the install code first, add it to your website, then check again.');
    const result = await verifyWidget(row.site_origin, key);
    const found = result === true || Boolean(result && result.found);
    if (!found) {
      throw new HttpError(409, 'widget_not_found', 'We could not find the SmartChat code on your home page yet. Add it, publish your site, then check again.');
    }
    // The code is on the page. A strict security policy can still stop the browser from running it.
    const app = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(String(appOrigin || '')) ? appOrigin : DEFAULT_APP_ORIGIN;
    const blocked = new Set();
    for (const policy of (result && result.policies) || []) for (const name of cspBlocks(policy, app)) blocked.add(name);
    const warnings = blocked.size ? [{
      code: 'csp_blocks_widget',
      blocked: [...blocked],
      message: 'SmartChat is on your page, but your website\'s security policy may stop it from loading. Ask whoever manages your website to allow ' + app + ' in the ' + [...blocked].join(' and ') + ' part of its Content-Security-Policy.'
    }] : [];
    if (row.status === 'active') return { active: true, warnings };
    const now = new Date().toISOString();
    const rows = await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id + '&status=eq.ready&config_approval_hash=eq.' + encodeURIComponent(row.config_approval_hash), {
      status: 'active', installation_method: 'manual', activated_at: now, last_verified_at: now, last_error_code: null, last_error_message: null, updated_at: now
    });
    if (!rows.length) throw new HttpError(409, 'invalid_state', 'This website changed while it was being checked. Please try again.');
    return { active: true, warnings };
  }

  // Hosted chat link: a NasrinAI-hosted page for this business, shared as a link or QR code.
  // Nothing on the customer's website changes. It needs a verified site and a current approval.
  async function hostedLink(caller, id, appOrigin) {
    const row = await getConfig(caller, id);
    if (!row) throw new HttpError(404, 'not_found', 'Connect site not found.');
    if (row.status === 'removed') throw new HttpError(409, 'removed', 'This Connect site has been removed.');
    if (!['ready', 'active'].includes(row.status)) {
      throw new HttpError(409, 'approval_required', 'Save and approve the SmartChat configuration before sharing a chat link.');
    }
    assertApproved(row, 'sharing a chat link');
    let code = row.metadata && row.metadata.hosted_code;
    if (!HOSTED_CODE.test(String(code || ''))) {
      code = randomBytes(16).toString('base64url');
      const meta = await getRawMetadata(caller, id);
      await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id, {
        metadata: { ...meta, hosted_code: code }, updated_at: new Date().toISOString()
      });
    }
    const app = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(String(appOrigin || '')) ? appOrigin : DEFAULT_APP_ORIGIN;
    return { url: app + '/chat/' + code };
  }

  // Public lookup behind a hosted chat link. Returns null unless the site is still live and
  // its configuration is still the approved one (editing it pauses the link until re-approved).
  async function hostedSite(code) {
    if (!HOSTED_CODE.test(String(code || ''))) return null;
    const rows = await request('GET', 'connect_installations?metadata->>hosted_code=eq.' + code + '&status=in.(ready,active)&limit=1&select=id,tenant_id,status,site_host,ai_config,config_approved_at,config_approval_hash');
    const row = rows && rows[0];
    if (!row || !approvalCurrent(row)) return null;
    const config = row.ai_config && typeof row.ai_config === 'object' ? row.ai_config : {};
    return {
      tenantId: row.tenant_id,
      name: row.site_host,
      welcome: typeof config.welcome === 'string' && config.welcome.trim() ? config.welcome : 'Hi! How can we help you today?'
    };
  }

  // ---- Website knowledge: read a VERIFIED site and hand its text to the business-knowledge store.
  // knowledgeSink = { add(caller, { title, content, source_url }) -> { id }, remove(caller, id) }.
  const CRAWL_STATES = new Set(['authorized', 'ready', 'installing', 'active']);
  const CRAWL_LOCK_MS = 5 * 60_000;

  const knowledgeStatus = (meta) => {
    const k = meta && meta.knowledge && typeof meta.knowledge === 'object' ? meta.knowledge : null;
    return k ? { status: k.status, pages: k.pages || 0, characters: k.characters || 0, truncated: !!k.truncated, crawled_at: k.crawled_at || null, urls: k.urls || [] } : { status: 'none', pages: 0, characters: 0, truncated: false, crawled_at: null, urls: [] };
  };

  async function saveKnowledgeMeta(caller, id, patch, extra = {}) {
    const meta = await getRawMetadata(caller, id); // re-read: other writers keep their keys
    await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id, {
      metadata: { ...meta, knowledge: patch }, ...extra, updated_at: new Date().toISOString()
    });
  }

  async function dropDocuments(caller, ids) {
    for (const docId of ids || []) {
      try { await knowledgeSink.remove(caller, docId); } catch (err) { console.error('connect knowledge remove failed:', err && err.message); }
    }
  }

  async function getKnowledge(caller, id) {
    if (!(await get(caller, id))) return null;
    return knowledgeStatus(await getRawMetadata(caller, id));
  }

  async function crawlKnowledge(caller, id) {
    if (!knowledgeSink) throw new HttpError(503, 'knowledge_unavailable', 'Website knowledge is not set up on the server yet.');
    if (!UUID.test(String(id))) return null;
    const rows = await request('GET', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id + '&limit=1&select=id,status,site_origin,metadata');
    const row = rows[0];
    if (!row) return null;
    // Ownership must be proven first. A URL alone never lets NasrinAI read a site into a tenant's knowledge.
    if (!CRAWL_STATES.has(row.status)) throw new HttpError(409, 'verification_required', 'Verify that you control this website before NasrinAI reads it.');
    const prior = row.metadata && row.metadata.knowledge;
    if (prior && prior.status === 'crawling' && Date.now() - Date.parse(prior.started_at || 0) < CRAWL_LOCK_MS) {
      throw new HttpError(409, 'crawl_in_progress', 'This website is already being read. Try again in a few minutes.');
    }
    const oldIds = (prior && prior.document_ids) || [];
    await saveKnowledgeMeta(caller, id, { ...(prior || {}), status: 'crawling', started_at: new Date().toISOString() });
    let result;
    try {
      result = await crawl(row.site_origin, fetchPage);
    } catch (err) {
      await saveKnowledgeMeta(caller, id, { ...(prior || {}), status: prior && prior.document_ids ? 'ready' : 'failed', error: String(err && (err.code || err.message) || 'crawl_failed').slice(0, 120) });
      throw publicConnectError(err);
    }
    if (!result.pages.length) {
      await saveKnowledgeMeta(caller, id, { ...(prior || {}), status: prior && prior.document_ids ? 'ready' : 'failed', error: 'no_readable_pages' });
      throw new HttpError(422, 'no_readable_pages', 'NasrinAI could not find readable public pages on this website. It may block crawlers (robots.txt) or need JavaScript to show its text.');
    }
    const documentIds = [];
    try {
      for (const page of result.pages) {
        const doc = await knowledgeSink.add(caller, { title: page.title, content: page.text, source_url: page.url });
        if (doc && doc.id) documentIds.push(doc.id);
      }
    } catch (err) {
      await dropDocuments(caller, documentIds); // never leave a half-imported site behind
      await saveKnowledgeMeta(caller, id, { ...(prior || {}), status: prior && prior.document_ids ? 'ready' : 'failed', error: 'import_failed' });
      throw err;
    }
    await dropDocuments(caller, oldIds); // replaced only after the new copy is safely stored
    await saveKnowledgeMeta(caller, id, {
      status: 'ready', crawled_at: new Date().toISOString(), pages: result.pages.length,
      characters: result.pages.reduce((n, p) => n + p.text.length, 0), truncated: !!result.truncated,
      urls: result.pages.map((p) => p.url), document_ids: documentIds
    });
    return knowledgeStatus({ knowledge: (await getRawMetadata(caller, id)).knowledge });
  }

  async function removeKnowledge(caller, id) {
    if (!UUID.test(String(id)) || !(await get(caller, id))) return false;
    const meta = await getRawMetadata(caller, id);
    if (knowledgeSink) await dropDocuments(caller, meta.knowledge && meta.knowledge.document_ids);
    if (meta.knowledge) {
      const { knowledge, ...rest } = meta;
      await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id, { metadata: rest, updated_at: new Date().toISOString() });
    }
    return true;
  }

  async function remove(caller, id) {
    if (!UUID.test(String(id))) return false;
    const current = await get(caller, id);
    if (!current) return false;
    if (current.status === 'removed') return true;
    if (current.status === 'installing') {
      throw new HttpError(409, 'installation_in_progress', 'This website is being installed. Try again when it finishes.');
    }
    const widgetKey = (await getRawMetadata(caller, id)).widget_key;
    try { await removeKnowledge(caller, id); } catch (err) { console.error('connect knowledge purge failed:', err && err.message); }
    // The status filter closes the gap between the check above and the write.
    const rows = await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id + '&status=neq.installing', {
      status: 'removed', removed_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    if (!rows.length) throw new HttpError(409, 'installation_in_progress', 'This website is being installed. Try again when it finishes.');
    // A removed site's widget must stop working: revoke its key (best effort, logged).
    if (WIDGET_KEY.test(String(widgetKey || '')) && typeof revokePublishableKey === 'function') {
      try { await revokePublishableKey({ tenantId: caller.tenantId, key: widgetKey }); }
      catch (err) { console.error('connect key revoke failed:', err && err.message); }
    }
    return true;
  }

  return { list, get, analyzeAndCreate, verify, getConfig, saveConfig, previewConfig, approveConfig, provisionKey, installSnippet, activate, hostedLink, hostedSite, install, remove, getKnowledge, crawlKnowledge, removeKnowledge };
}