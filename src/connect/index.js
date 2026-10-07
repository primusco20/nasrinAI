import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';

const MAX_HTML = 512 * 1024;
const TIMEOUT_MS = 8_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
    const mapped = s.match(/^::ffff:(\d+\\.\d+\\.\d+\\.\d+)$/);
    if (mapped) return blocked(mapped[1]);
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


const publicRow = (r) => ({
  id: r.id, site_origin: r.site_origin, site_host: r.site_host, status: r.status,
  platform: r.platform, installation_method: r.installation_method,
  authorization_method: r.authorization_method,
  verification_expires_at: r.verification_expires_at,
  activated_at: r.activated_at, removed_at: r.removed_at,
  last_verified_at: r.last_verified_at, last_error_code: r.last_error_code,
  created_at: r.created_at, updated_at: r.updated_at
});

export function createConnect({ url, secretKey, createPublishableKey = null, installRegistry = null, fetchImpl = fetch }) {
  if (!url || !secretKey) return null;
  const base = String(url).replace(/\/+$/, '');

  async function request(method, path, body) {
    const res = await fetchImpl(base + '/rest/v1/' + path, {
      method,
      headers: { apikey: secretKey, Authorization: 'Bearer ' + secretKey, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) {
      const err = new Error('Connect storage request failed');
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
    const info = await analyzeWebsite(siteUrl);
    const token = randomBytes(24).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const rows = await request('POST', 'connect_installations', {
      tenant_id: caller.tenantId, site_origin: info.origin, site_host: info.host,
      status: 'verification_required', platform: info.platform,
      verification_token_hash: hash,
      verification_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      metadata: { analysis: info }
    });
    const row = rows[0];
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
    const method = await verifyPublishedToken(row.site_origin, token);
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

  async function provisionKey(caller, id) {
    const row = await getConfig(caller, id);
    if (!row) throw new HttpError(404, 'not_found', 'Connect site not found.');
    if (row.status === 'removed') throw new HttpError(409, 'removed', 'This Connect site has been removed.');
    if (!['ready', 'active'].includes(row.status)) {
      throw new HttpError(409, 'approval_required', 'Approve the SmartChat configuration before provisioning its widget key.');
    }
    if (!row.config_approval_hash || !row.config_approved_at) {
      throw new HttpError(409, 'approval_required', 'Approve the SmartChat configuration before provisioning its widget key.');
    }
    const currentHash = createHash('sha256').update(
      JSON.stringify(row.ai_config && typeof row.ai_config === 'object' ? row.ai_config : {})
    ).digest('hex');
    if (currentHash !== row.config_approval_hash) {
      throw new HttpError(409, 'approval_stale', 'The SmartChat configuration changed after approval. Approve the latest configuration before provisioning its widget key.');
    }
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
    if (!installRegistry || typeof installRegistry.install !== 'function') throw new HttpError(409, 'provider_unavailable', 'No supported installation provider is available for this website.');
    if (typeof method !== 'string' || method.length > 64) throw new HttpError(400, 'invalid_method', 'Choose a supported installation method.');

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

  async function remove(caller, id) {
    if (!UUID.test(String(id))) return false;
    const rows = await request('PATCH', 'connect_installations?tenant_id=eq.' + encodeURIComponent(caller.tenantId) + '&id=eq.' + id, {
      status: 'removed', removed_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    return rows.length > 0;
  }

  return { list, get, analyzeAndCreate, verify, getConfig, saveConfig, previewConfig, approveConfig, provisionKey, install, remove };
}
