import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/http/app.js';
import { createOwnerConsole } from '../src/owner-console.js';

const SECRET = ['owner-console-http-', 'signing-material-', 'x'.repeat(32)].join('');
const TOKEN = ['valid-access-', 'token-1234567890'].join('');

async function start(t) {
  const config = {
    // This HTTP integration suite runs on a local ephemeral host; production-host policy is covered by unit tests.
    isProduction: false,
    maxBodyBytes: 16384,
    ownerConsole: { enabled: true, emails: ['owner@example.com'], ips: ['127.0.0.1'], sessionSecret: SECRET }
  };
  const logger = { info() {}, warn() {}, error() {} };
  let staticCalls = 0;
  const ownerConsole = createOwnerConsole({
    config,
    verifyUser: async (token) => token === TOKEN ? { id: 'owner-id', email: 'owner@example.com' } : null,
    store: { kind: 'supabase', request: async (_method, path, options = {}) => {
      if (path === 'rpc/owner_console_record_audit') return null;
      if (path === 'rpc/owner_console_incidents_list') return { counts: { open: 0, acknowledged: 0, resolved: 0, critical_open: 0, high_open: 0 }, incidents: [] };
      if (path === 'rpc/owner_console_incident_create') return 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      if (path === 'rpc/owner_console_incident_update') return { id: options.body.p_incident_id, status: options.body.p_action === 'resolve' ? 'resolved' : 'acknowledged' };
      return [];
    } },
    clientIp: () => '127.0.0.1'
  });
  const app = createApp({
    config, logger, gateway: { resolve: async () => { throw new Error('owner request reached gateway'); } },
    ownerConsole, clientIp: () => '127.0.0.1',
    serveStatic: async (_req, _res, pathname) => { staticCalls++; return false; }
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: 'http://127.0.0.1:' + server.address().port, getStaticCalls: () => staticCalls };
}

test('unauthorized owner page is a genuine 404 and never falls through to static serving', async (t) => {
  const app = await start(t);
  const response = await fetch(app.url + '/owner', { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Page not found.');
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(app.getStaticCalls(), 0);
});

test('authorized browser flow bootstraps a cookie before loading the protected page and API', async (t) => {
  const app = await start(t);
  const origin = app.url;
  const boot = await fetch(app.url + '/v1/owner/session', {
    method: 'POST',
    headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', Authorization: 'Bearer ' + TOKEN }
  });
  assert.equal(boot.status, 204);
  const setCookie = boot.headers.get('set-cookie');
  assert.match(setCookie, /^nasrin_owner=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];

  const page = await fetch(app.url + '/owner', { headers: { Cookie: cookie, Accept: 'text/html' } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await page.text(), /Owner Command Center/);

  const metrics = await fetch(app.url + '/owner/api/overview', { headers: { Cookie: cookie, Accept: 'application/json' } });
  assert.equal(metrics.status, 200);
  const body = await metrics.json();
  assert.equal(body.mode, 'read_only');
  assert.equal(body.data_sources.ai_usage, 'unavailable');
  assert.equal(app.getStaticCalls(), 0);
});

test('unknown owner route variants are intercepted and do not fall through to public routing', async (t) => {
  const app = await start(t);
  for (const path of ['/owner/console', '/owner/api/unknown', '/v1/owner/unknown']) {
    const response = await fetch(app.url + path);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), 'Page not found.', path);
  }
  assert.equal(app.getStaticCalls(), 0);
});


test('durable incident APIs require an owner session, same-origin confirmation, and audit-backed RPCs', async (t) => {
  const app = await start(t);
  const origin = app.url;
  const boot = await fetch(app.url + '/v1/owner/session', { method: 'POST', headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', Authorization: 'Bearer ' + TOKEN } });
  assert.equal(boot.status, 204);
  const cookie = boot.headers.get('set-cookie').split(';')[0];
  const list = await fetch(app.url + '/owner/api/incidents', { headers: { Cookie: cookie, Accept: 'application/json' } });
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).incidents, []);
  const payload = { confirm: 'CREATE INCIDENT', title: 'Provider timeout spike', description: 'Several requests timed out.', severity: 'high', source: 'ai_usage' };
  const denied = await fetch(app.url + '/owner/api/incidents', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(denied.status, 404, 'missing same-origin header fails closed');
  const created = await fetch(app.url + '/owner/api/incidents', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal(created.status, 201);
  const incident = await created.json();
  assert.equal(incident.status, 'open');
  const ack = await fetch(app.url + '/owner/api/incidents/' + incident.id + '/acknowledge', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'ACKNOWLEDGE' }) });
  assert.equal(ack.status, 200);
  assert.equal((await ack.json()).status, 'acknowledged');
  const resolved = await fetch(app.url + '/owner/api/incidents/' + incident.id + '/resolve', { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'RESOLVE', resolution_note: 'Verified and mitigated.' }) });
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).status, 'resolved');
});
