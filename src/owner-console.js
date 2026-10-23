import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { API_CSP, PAGE_CSP, sendJson } from './http/headers.js';

const SESSION_COOKIE = 'nasrin_owner';
const SESSION_SECONDS = 10 * 60;
const NOT_FOUND = 'Page not found.';

function sendNotFound(res, head = false) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Vary', 'Cookie, Authorization');
  res.end(head ? undefined : NOT_FOUND);
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0 || part.slice(0, i).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
  }
  return '';
}

async function readOwnerJson(req, maxBytes = 8192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error('body too large');
    chunks.push(buffer);
  }
  if (!size) throw new Error('body required');
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
  return value;
}

function bearer(req) {
  const match = /^Bearer ([A-Za-z0-9._~-]{20,4096})$/.exec(String(req.headers.authorization || ''));
  return match ? match[1] : '';
}

function trustedSameOrigin(req) {
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  const origin = String(req.headers.origin || '');
  const host = String(req.headers.host || '').split(',')[0].trim().toLowerCase();
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

// The signed-in main site bootstraps a host-only session cookie on the owner
// subdomain. Cross-origin bootstrap is limited to the two canonical site
// origins, the exact owner host, and same-site browser requests.
function trustedBootstrapOrigin(req, res, config) {
  const origin = String(req.headers.origin || '').trim();
  const host = String(req.headers.host || '').split(',')[0].trim().toLowerCase();
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();

  // Production bootstrap must terminate on the dedicated owner host. A same-origin
  // request to nasrinai.com must not mint a cookie for the main application host.
  if (!config?.isProduction) return trustedSameOrigin(req);
  if (host !== 'owner.nasrinai.com') return false;
  if (origin === 'https://owner.nasrinai.com' &&
      (!fetchSite || fetchSite === 'same-origin' || fetchSite === 'none')) return true;
  if (!['https://nasrinai.com', 'https://www.nasrinai.com'].includes(origin) ||
      (fetchSite && fetchSite !== 'same-site')) return false;

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin, Cookie, Authorization');
  return true;
}

function normalizeIp(value) {
  const ip = String(value || '').trim().replace(/^::ffff:/, '');
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) === 6) {
    try { return new URL('http://[' + ip + ']/').hostname.slice(1, -1).toLowerCase(); } catch { return null; }
  }
  return null;
}

function configuredAllowlist(config) {
  const source = config?.ownerConsole;
  if (!source || source.enabled !== true || typeof source.sessionSecret !== 'string' || source.sessionSecret.length < 32) return null;
  if (!Array.isArray(source.emails) || !source.emails.length || !Array.isArray(source.ips) || !source.ips.length) return null;
  if (source.emails.some((email) => !/^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,63}$/.test(email))) return null;
  const ips = source.ips.map(normalizeIp);
  if (ips.some((ip) => !ip)) return null;
  return { ...source, ips };
}

function allowedRequest(req, config, clientIp) {
  const allowlist = configuredAllowlist(config);
  if (!allowlist) return null;
  let ip = '';
  try { ip = normalizeIp(clientIp(req)); } catch { return null; }
  if (!ip || !allowlist.ips.includes(ip)) return null;
  return allowlist;
}

function sign(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return encoded + '.' + signature;
}

function verifySession(token, secret, now) {
  if (!token || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  const expected = createHmac('sha256', secret).update(parts[0]).digest();
  let supplied;
  try { supplied = Buffer.from(parts[1], 'base64url'); } catch { return null; }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return null; }
  if (!payload || typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string') return null;
  if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.exp <= now || payload.iat > now + 30 || payload.exp - payload.iat > SESSION_SECONDS) return null;
  return payload;
}

function sessionCookie(value, maxAge, secure) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/owner; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

const dashboardHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>Owner Command Center · NasrinAI</title>
<link rel="stylesheet" href="/owner-console.css">
<script defer src="/owner-console.js"></script>
</head>
<body>
<div class="shell">
  <aside class="sidebar" aria-label="Owner navigation">
    <a class="brand" href="/owner" aria-label="NasrinAI Owner Command Center"><span class="brand-mark">N</span><span><strong>NasrinAI</strong><small>OWNER COMMAND CENTER</small></span></a>
    <div class="nav-label">WORKSPACE</div>
    <nav id="navigation">
      <button class="nav-item active" data-panel="overview"><span>◫</span>Overview</button>
      <button class="nav-item" data-panel="ai"><span>✳</span>AI Operations</button>
      <button class="nav-item" data-panel="users"><span>♙</span>Users &amp; Growth</button>
      <button class="nav-item" data-panel="infra"><span>⌘</span>Infrastructure &amp; Releases</button>
      <button class="nav-item" data-panel="security"><span>◇</span>Security &amp; Audit</button>
      <button class="nav-item" data-panel="automation"><span>↗</span>Automation &amp; Jobs</button>
      <button class="nav-item" data-panel="finance"><span>▤</span>Finance &amp; Costs</button>
      <button class="nav-item" data-panel="incidents"><span>◎</span>Incidents &amp; Alerts</button>
      <button class="nav-item" data-panel="reports"><span>▥</span>Reports &amp; Exports</button>
      <button class="nav-item" data-panel="settings"><span>⚙</span>Settings</button>
    </nav>
    <div class="sidebar-bottom"><span class="status-dot"></span><span>Private owner workspace</span></div>
  </aside>
  <main class="main">
    <header class="topbar"><div class="crumb">NasrinAI <span>/</span> <b id="crumb">Overview</b></div><div class="top-actions"><span class="live"><i></i>Private session</span><button id="signout" class="quiet-button">Sign out</button></div></header>
    <section class="page-heading"><div><p class="eyebrow">OPERATIONS INTELLIGENCE</p><h1 id="page-title">Good to have you back.</h1><p id="page-description">A clear view of platform health, AI operations, and business signals.</p></div><div class="heading-meta"><span class="pill"><i></i>Read-only mode</span><span class="freshness" id="freshness">Checking data sources…</span></div></section>
    <section id="content" aria-live="polite"><div class="loading"><span class="spinner"></span>Loading secure workspace…</div></section>
    <footer><span>NASRINAI · OWNER CONSOLE</span><span>Least privilege by default <b>·</b> Sensitive actions disabled until reviewed</span></footer>
  </main>
</div>
</body>
</html>`;

const panels = {
  overview: { title: 'Good to have you back.', description: 'A clear view of platform health, AI operations, and business signals.' },
  ai: { title: 'AI Operations', description: 'Provider performance, routing, latency, and token usage — only from verified telemetry.' },
  users: { title: 'Users & Growth', description: 'Adoption and account trends, with personal data minimized by default.' },
  infra: { title: 'Infrastructure & Releases', description: 'Deployment and dependency status from explicitly connected sources.' },
  security: { title: 'Security & Audit', description: 'Authorization health, security events, and a traceable record of owner actions.' },
  automation: { title: 'Automation & Jobs', description: 'Workflow health, queue state, retries, and execution outcomes.' },
  finance: { title: 'Finance & Costs', description: 'Separate provider estimates, reservations, settled costs, and verified billing.' },
  incidents: { title: 'Incidents & Alerts', description: 'Operational issues and alert delivery, with clear status and ownership.' },
  reports: { title: 'Reports & Exports', description: 'Date-scoped reports from verified data sources.' },
  settings: { title: 'Settings', description: 'Owner-console preferences and access status. Allowlist values stay in Vercel.' }
};

function jsonError(res, head = false) { sendNotFound(res, head); }

export function createOwnerConsole({ config, verifyUser, store = null, limiter = null, clientIp = () => '', now = () => Date.now(), logger = null, fetchImpl = globalThis.fetch }) {
  async function usageSince(since) {
    if (typeof store?.request !== 'function') return null;
    try {
      const value = await store.request('POST', 'rpc/owner_console_usage_summary', {
        body: { p_since: new Date(since).toISOString() }
      });
      const summary = Array.isArray(value) ? value[0] : value;
      return summary && typeof summary === 'object' && Number.isFinite(Number(summary.request_count)) ? summary : null;
    } catch {
      logger?.warn?.('owner metrics source unavailable', { source: 'usage_events' });
      return null;
    }
  }

  async function rateAllowed(req) {
    if (!limiter || typeof limiter.signIn !== 'function') return true;
    let ip = '';
    try { ip = normalizeIp(clientIp(req)); } catch { return false; }
    if (!ip) return false;
    const limit = Math.min(Number(config?.limits?.signInRefreshIpHour) || 120, 300);
    try { await limiter.signIn('owner-console:' + ip, limit); return true; } catch { return false; }
  }

  async function automationSince(since) {
    if (store?.kind !== 'supabase' || typeof store.request !== 'function') return null;
    try {
      const value = await store.request('POST', 'rpc/owner_console_automation_summary', {
        body: { p_since: new Date(since).toISOString() }
      });
      const summary = Array.isArray(value) ? value[0] : value;
      return summary && typeof summary === 'object' && Number.isFinite(Number(summary.run_count)) ? summary : null;
    } catch {
      logger?.warn?.('owner automation source unavailable', { source: 'automation_runs' });
      return null;
    }
  }

  async function vercelDeploymentSummary() {
    const source = config?.ownerConsole?.vercel;
    if (!source?.enabled || typeof fetchImpl !== 'function') return null;
    try {
      const query = new URLSearchParams({ projectId: source.projectId, limit: '10', target: 'production', teamId: source.teamId });
      const response = await fetchImpl('https://api.vercel.com/v6/deployments?' + query.toString(), {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + source.token, Accept: 'application/json' },
        signal: AbortSignal.timeout(4000)
      });
      if (!response?.ok) throw new Error('deployment source unavailable');
      const payload = await response.json();
      if (!Array.isArray(payload?.deployments)) throw new Error('invalid deployment response');
      const deployments = payload.deployments.slice(0, 10).map((item) => ({
        state: typeof item?.state === 'string' ? item.state.toLowerCase() : 'unknown',
        url: typeof item?.url === 'string' ? item.url.slice(0, 240) : null,
        target: typeof item?.target === 'string' ? item.target : null,
        created_at: Number.isFinite(Number(item?.created)) ? new Date(Number(item.created)).toISOString() : null,
        branch: typeof item?.meta?.githubCommitRef === 'string' ? item.meta.githubCommitRef.slice(0, 120) : null,
        commit: typeof item?.meta?.githubCommitSha === 'string' && /^[a-f0-9]{7,40}$/i.test(item.meta.githubCommitSha) ? item.meta.githubCommitSha : null
      }));
      return { deployment_count: deployments.length, ready_count: deployments.filter((item) => item.state === 'ready').length, failed_count: deployments.filter((item) => ['error','canceled','cancelled'].includes(item.state)).length, latest: deployments[0] || null, deployments };
    } catch {
      logger?.warn?.('owner Vercel deployment telemetry unavailable', { source: 'vercel_api' });
      return null;
    }
  }

  async function incidentSince(since) {
    if (store?.kind !== 'supabase' || typeof store.request !== 'function') return null;
    try {
      const value = await store.request('POST', 'rpc/owner_console_incident_summary', {
        body: { p_since: new Date(since).toISOString() }
      });
      const summary = Array.isArray(value) ? value[0] : value;
      return summary && typeof summary === 'object' && Number.isFinite(Number(summary.ai_failed_requests)) ? summary : null;
    } catch {
      logger?.warn?.('owner operational signals unavailable', { source: 'usage_events,automation_runs' });
      return null;
    }
  }

  async function plansSince(since) {
    if (typeof store?.request !== 'function') return null;
    try {
      const value = await store.request('POST', 'rpc/owner_console_plan_summary', {
        body: { p_since: new Date(since).toISOString() }
      });
      const summary = Array.isArray(value) ? value[0] : value;
      return summary && typeof summary === 'object' && Number.isFinite(Number(summary.active_paid_periods)) ? summary : null;
    } catch {
      logger?.warn?.('owner plan entitlement source unavailable', { source: 'plan_periods' });
      return null;
    }
  }

  async function growthSummary() {
    if (typeof store?.request !== 'function') return null;
    try {
      const value = await store.request('POST', 'rpc/owner_console_growth_summary', { body: {} });
      const summary = Array.isArray(value) ? value[0] : value;
      return summary && typeof summary === 'object' && Number.isFinite(Number(summary.active_user_ids_24h)) ? summary : null;
    } catch {
      logger?.warn?.('owner growth summary unavailable', { source: 'usage_events' });
      return null;
    }
  }

  async function retentionSummary() {
    if (typeof store?.request !== 'function') return null;
    try {
      const value = await store.request('POST', 'rpc/owner_console_retention_summary', { body: {} });
      const summary = Array.isArray(value) ? value[0] : value;
      return summary && typeof summary === 'object' && Array.isArray(summary.cohorts) ? summary : null;
    } catch {
      logger?.warn?.('owner retention cohort source unavailable', { source: 'usage_events' });
      return null;
    }
  }

  async function userSummary() {
    if (typeof store?.request !== 'function') return null;
    try {
      const value = await store.request('POST', 'rpc/owner_console_user_summary', { body: {} });
      const summary = Array.isArray(value) ? value[0] : value;
      return summary && typeof summary === 'object' && Number.isFinite(Number(summary.auth_user_records)) ? summary : null;
    } catch {
      logger?.warn?.('owner account summary unavailable', { source: 'auth.users' });
      return null;
    }
  }

  async function auditSince(since) {
    if (store?.kind !== 'supabase' || typeof store.request !== 'function') return null;
    try {
      const value = await store.request('POST', 'rpc/owner_console_audit_summary', {
        body: { p_since: new Date(since).toISOString() }
      });
      const summary = Array.isArray(value) ? value[0] : value;
      return summary && typeof summary === 'object' && Number.isFinite(Number(summary.event_count)) ? summary : null;
    } catch {
      logger?.warn?.('owner audit summary unavailable', { source: 'owner_audit_events' });
      return null;
    }
  }

  async function authAuditSince(since) {
    if (store?.kind !== 'supabase' || typeof store.request !== 'function') return null;
    try {
      const value = await store.request('POST', 'rpc/owner_console_auth_audit_summary', {
        body: { p_since: new Date(since).toISOString() }
      });
      const summary = Array.isArray(value) ? value[0] : value;
      return summary && typeof summary === 'object' &&
        typeof summary.available === 'boolean' &&
        Number.isFinite(Number(summary.event_count)) &&
        Array.isArray(summary.by_category) ? summary : null;
    } catch {
      logger?.warn?.('owner platform auth audit source unavailable', { source: 'auth.audit_log_entries' });
      return null;
    }
  }

  async function recordAudit(eventType, actorId, req) {
    if (typeof store?.request !== 'function') return false;
    let ip = '';
    try { ip = normalizeIp(clientIp(req)); } catch { return false; }
    if (!ip || typeof actorId !== 'string' || !actorId) return false;
    const ipHash = createHash('sha256').update(ip).digest('hex');
    try {
      await store.request('POST', 'rpc/owner_console_record_audit', {
        body: { p_event_type: eventType, p_actor_id: actorId, p_ip_hash: ipHash, p_outcome: 'success' }
      });
      return true;
    } catch {
      logger?.warn?.('owner audit write unavailable', { source: 'owner_audit_events', event_type: eventType });
      return false;
    }
  }

  async function handle(req, res, pathname) {
    const ownerPath = pathname === '/owner' || pathname.startsWith('/owner/');
    const bootstrapPath = pathname === '/v1/owner/session';
    const reservedOwnerApi = pathname === '/v1/owner' || pathname.startsWith('/v1/owner/');
    const incidentCollectionPath = pathname === '/owner/api/incidents';
    const incidentAction = /^\/owner\/api\/incidents\/([0-9a-f-]{36})\/(acknowledge|resolve)$/.exec(pathname);
    const incidentWrite = req.method === 'POST' && (incidentCollectionPath || Boolean(incidentAction));
    if (!ownerPath && !bootstrapPath && !reservedOwnerApi) return false;

    // In production the console UI/API exists only on the dedicated subdomain.
    // Keep the bootstrap endpoint separate because it is called cross-origin by the main site.
    const requestHost = String(req.headers.host || '').split(',')[0].trim().toLowerCase();
    if (ownerPath && config?.isProduction && requestHost !== 'owner.nasrinai.com') {
      sendNotFound(res, req.method === 'HEAD');
      return true;
    }

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Content-Security-Policy', pathname === '/owner' || pathname === '/owner/' ? PAGE_CSP : API_CSP);
    res.setHeader('Vary', 'Cookie, Authorization');

    if (reservedOwnerApi && !bootstrapPath) { sendNotFound(res, req.method === 'HEAD'); return true; }

    if (bootstrapPath) {
      const trustedOrigin = trustedBootstrapOrigin(req, res, config);
      if (req.method === 'OPTIONS') {
        if (!trustedOrigin) { jsonError(res); return true; }
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
        res.statusCode = 204;
        res.end();
        return true;
      }
      if (req.method !== 'POST' || !trustedOrigin) { jsonError(res, req.method === 'HEAD'); return true; }
      const allowlist = allowedRequest(req, config, clientIp);
      if (!allowlist || !(await rateAllowed(req))) { jsonError(res); return true; }
      const token = bearer(req);
      if (!token || typeof verifyUser !== 'function') { jsonError(res); return true; }
      let user;
      try { user = await verifyUser(token); } catch { jsonError(res); return true; }
      if (!user?.id || !user?.email || !allowlist.emails.includes(String(user.email).trim().toLowerCase())) { jsonError(res); return true; }
      if (!(await recordAudit('session_issued', user.id, req))) { jsonError(res); return true; }
      const issued = Math.floor(now() / 1000);
      const value = sign({ sub: user.id, email: String(user.email).trim().toLowerCase(), iat: issued, exp: issued + SESSION_SECONDS, jti: randomUUID() }, allowlist.sessionSecret);
      const secure = config?.isProduction === true || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
      res.setHeader('Set-Cookie', sessionCookie(value, SESSION_SECONDS, secure));
      res.statusCode = 204;
      res.end();
      return true;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD' && !(pathname === '/owner/api/session' && req.method === 'DELETE') && !incidentWrite) {
      sendNotFound(res, req.method === 'HEAD'); return true;
    }
    const allowlist = allowedRequest(req, config, clientIp);
    const session = allowlist && verifySession(readCookie(req, SESSION_COOKIE), allowlist.sessionSecret, Math.floor(now() / 1000));
    if (!allowlist || !session || !allowlist.emails.includes(session.email)) {
      sendNotFound(res, req.method === 'HEAD'); return true;
    }
    if (!(await rateAllowed(req))) { sendNotFound(res, req.method === 'HEAD'); return true; }

    if (pathname === '/owner/api/session' && req.method === 'DELETE') {
      if (!trustedSameOrigin(req)) { sendNotFound(res); return true; }
      const secure = config?.isProduction === true || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
      await recordAudit('session_revoked', session.sub, req);
      res.setHeader('Set-Cookie', sessionCookie('', 0, secure));
      res.statusCode = 204;
      res.end();
      return true;
    }
    if (incidentCollectionPath && (req.method === 'GET' || req.method === 'HEAD')) {
      try {
        const value = await store.request('POST', 'rpc/owner_console_incidents_list', { body: { p_limit: 50 } });
        const result = Array.isArray(value) ? value[0] : value;
        if (!result || typeof result !== 'object') throw new Error('invalid incident response');
        sendJson(res, 200, result);
      } catch {
        logger?.warn?.('owner incident list unavailable', { source: 'owner_console_incidents' });
        sendJson(res, 503, { error: { code: 'incident_source_unavailable', message: 'Incident storage is unavailable.' } });
      }
      return true;
    }
    if (incidentWrite) {
      if (!trustedSameOrigin(req) || String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') { sendNotFound(res); return true; }
      if (!store || typeof store.request !== 'function') { sendJson(res, 503, { error: { code: 'incident_source_unavailable', message: 'Incident storage is unavailable.' } }); return true; }
      let body;
      try { body = await readOwnerJson(req); } catch { sendJson(res, 400, { error: { code: 'invalid_request', message: 'A valid JSON request is required.' } }); return true; }
      let ip = '';
      try { ip = normalizeIp(clientIp(req)); } catch {}
      if (!ip) { sendNotFound(res); return true; }
      const ipHash = createHash('sha256').update(ip).digest('hex');
      if (incidentCollectionPath) {
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const description = typeof body.description === 'string' ? body.description.trim() : '';
        const severity = typeof body.severity === 'string' ? body.severity : '';
        const source = typeof body.source === 'string' ? body.source : 'manual';
        if (body.confirm !== 'CREATE INCIDENT' || !title || title.length > 160 || description.length > 1200 || !['low','medium','high','critical'].includes(severity) || !['manual','ai_usage','automation','infrastructure','security'].includes(source)) {
          sendJson(res, 400, { error: { code: 'invalid_incident', message: 'Confirm the action and provide a valid title, severity, source, and description.' } }); return true;
        }
        try {
          const value = await store.request('POST', 'rpc/owner_console_incident_create', { body: { p_title: title, p_description: description, p_severity: severity, p_source: source, p_actor_id: session.sub, p_ip_hash: ipHash } });
          const id = Array.isArray(value) ? value[0] : value;
          if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('invalid incident id');
          sendJson(res, 201, { id, status: 'open' });
        } catch {
          logger?.warn?.('owner incident create failed', { source: 'owner_console_incidents' });
          sendJson(res, 503, { error: { code: 'incident_write_unavailable', message: 'The incident could not be recorded. Please try again later.' } });
        }
        return true;
      }
      if (body.confirm !== (incidentAction[2] === 'acknowledge' ? 'ACKNOWLEDGE' : 'RESOLVE')) { sendJson(res, 400, { error: { code: 'confirmation_required', message: 'Explicit confirmation is required.' } }); return true; }
      const note = typeof body.resolution_note === 'string' ? body.resolution_note.trim() : '';
      if (incidentAction[2] === 'resolve' && (note.length < 3 || note.length > 1200)) { sendJson(res, 400, { error: { code: 'resolution_note_required', message: 'Add a resolution note between 3 and 1200 characters.' } }); return true; }
      try {
        const value = await store.request('POST', 'rpc/owner_console_incident_update', { body: { p_incident_id: incidentAction[1], p_action: incidentAction[2], p_actor_id: session.sub, p_ip_hash: ipHash, p_resolution_note: note } });
        const result = Array.isArray(value) ? value[0] : value;
        sendJson(res, 200, result && typeof result === 'object' ? result : { id: incidentAction[1], status: incidentAction[2] === 'resolve' ? 'resolved' : 'acknowledged' });
      } catch {
        logger?.warn?.('owner incident update failed', { source: 'owner_console_incidents', action: incidentAction[2] });
        sendJson(res, 409, { error: { code: 'incident_transition_failed', message: 'The incident status could not be changed. Refresh and try again.' } });
      }
      return true;
    }

    if (pathname === '/owner' || pathname === '/owner/') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Length', Buffer.byteLength(dashboardHtml));
      res.end(req.method === 'HEAD' ? undefined : dashboardHtml);
      return true;
    }
    if (pathname === '/owner/api/overview') {
      const at = now();
      let databaseHealth = 'unavailable';
      if (typeof store?.request === 'function') {
        try {
          const rows = await store.request('GET', 'tenants?select=id&limit=1');
          if (Array.isArray(rows)) databaseHealth = 'available';
        } catch {
          logger?.warn?.('owner database health check unavailable', { source: 'database' });
        }
      }
      const [usage24h, usage7d, automation24h, automation7d, audit24h, authAudit24h, plans24h, users, incidents24h, growth, retention, deployments] = await Promise.all([
        usageSince(at - 24 * 60 * 60 * 1000),
        usageSince(at - 7 * 24 * 60 * 60 * 1000),
        automationSince(at - 24 * 60 * 60 * 1000),
        automationSince(at - 7 * 24 * 60 * 60 * 1000),
        auditSince(at - 24 * 60 * 60 * 1000),
        authAuditSince(at - 24 * 60 * 60 * 1000),
        plansSince(at - 24 * 60 * 60 * 1000),
        userSummary(),
        incidentSince(at - 24 * 60 * 60 * 1000),
        growthSummary(),
        retentionSummary(),
        vercelDeploymentSummary()
      ]);
      sendJson(res, 200, {
        generated_at: new Date(at).toISOString(),
        mode: 'read_only',
        data_sources: {
          ai_usage: usage24h || usage7d ? ((Number(usage24h?.request_count || 0) + Number(usage7d?.request_count || 0)) > 0 ? 'available' : 'no_data') : 'unavailable',
          users: users || growth ? ((Number(users?.auth_user_records || 0) + Number(growth?.active_user_ids_24h || 0) + Number(growth?.active_guest_ids_24h || 0)) > 0 ? 'available' : 'no_data') : 'unavailable',
          retention: retention ? (retention.cohorts.length > 0 ? 'available' : 'no_data') : 'unavailable',
          infrastructure: deployments ? (deployments.deployment_count > 0 ? 'available' : 'no_data') : 'unavailable',
          database: databaseHealth,
          security_audit: audit24h ? (Number(audit24h.event_count || 0) > 0 ? 'available' : 'no_data') : 'unavailable',
          platform_security: authAudit24h?.available === true ? (Number(authAudit24h.event_count || 0) > 0 ? 'available' : 'no_data') : 'unavailable',
          automation: automation24h || automation7d ? ((Number(automation24h?.run_count || 0) + Number(automation7d?.run_count || 0)) > 0 ? 'available' : 'no_data') : 'unavailable',
          finance: plans24h && Number.isFinite(Number(plans24h.paid_payment_count))
            ? (Number(plans24h.paid_payment_count) > 0 ? 'available' : 'no_data') : 'unavailable',
          plan_entitlements: plans24h ? ((Number(plans24h.active_paid_periods || 0) + Number(plans24h.new_periods || 0)) > 0 ? 'available' : 'no_data') : 'unavailable',
          incidents: incidents24h ? ((Number(incidents24h.ai_failed_requests || 0) + Number(incidents24h.automation_failed_runs || 0) + Number(incidents24h.stale_running_runs || 0)) > 0 ? 'available' : 'no_data') : 'unavailable'
        },
        database_health: { status: databaseHealth, checked_at: new Date(at).toISOString() },
        usage_24h: usage24h,
        usage_7d: usage7d,
        automation_24h: automation24h,
        automation_7d: automation7d,
        audit_24h: audit24h,
        platform_auth_audit_24h: authAudit24h,
        plans_24h: plans24h,
        user_summary: users,
        growth_summary: growth,
        retention_summary: retention,
        deployment_summary: deployments,
        incidents_24h: incidents24h,
        panels
      });
      return true;
    }
    if (pathname === '/owner/api/export' && req.method === 'GET') {
      const url = new URL(req.url, 'http://local');
      const windowName = url.searchParams.get('window') || '24h';
      if (!['24h', '7d'].includes(windowName)) {
        sendJson(res, 400, { error: { code: 'invalid_window', message: 'Choose 24h or 7d.' } });
        return true;
      }
      const at = now();
      const summary = await usageSince(at - (windowName === '24h' ? 24 : 168) * 60 * 60 * 1000);
      if (!summary) {
        sendJson(res, 503, { error: { code: 'data_unavailable', message: 'Usage telemetry is unavailable until its verified data source is connected.' } });
        return true;
      }
      if (!(await recordAudit('usage_export', session.sub, req))) {
        sendJson(res, 503, { error: { code: 'audit_unavailable', message: 'The export audit service is unavailable. Please try again later.' } });
        return true;
      }
      const columns = ['record_type','window','generated_at','window_start','window_end','provider','model','requests','successes','failures','input_tokens','output_tokens','total_tokens','active_user_ids','active_guest_ids','latency_p50_ms','latency_p95_ms','estimated_cost_usd','cost_estimate_rows'];
      const rows = [columns, [
        'summary', windowName, new Date(at).toISOString(), summary.window_start, summary.window_end, '',
        '', summary.request_count, summary.success_count, summary.failure_count, summary.input_tokens,
        summary.output_tokens, summary.total_tokens, summary.active_user_ids, summary.active_guest_ids,
        summary.latency_p50_ms, summary.latency_p95_ms, summary.estimated_cost_usd, summary.cost_estimate_rows
      ]];
      for (const item of Array.isArray(summary.providers) ? summary.providers : []) {
        rows.push([
          'provider', windowName, new Date(at).toISOString(), summary.window_start, summary.window_end,
          item.provider, item.model, item.requests, item.successes, null, item.input_tokens,
          item.output_tokens, Number(item.input_tokens || 0) + Number(item.output_tokens || 0),
          null, null, null, null, item.estimated_cost_usd, null
        ]);
      }
      const csv = rows.map((row) => row.map((value) => {
        const cell = value === null || value === undefined ? '' : String(value);
        const safeCell = typeof value === 'string' && /^[=+@\t\r-]/.test(cell) ? "'" + cell : cell;
        return '"' + safeCell.replace(/"/g, '""') + '"';
      }).join(',')).join('\r\n') + '\r\n';
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="nasrinai-owner-usage-' + windowName + '.csv"');
      res.setHeader('Content-Length', Buffer.byteLength(csv));
      res.end(csv);
      return true;
    }
    jsonError(res, req.method === 'HEAD');
    return true;
  }
  return { handle };
}

export const OWNER_SESSION_SECONDS = SESSION_SECONDS;
export const OWNER_SESSION_COOKIE = SESSION_COOKIE;
