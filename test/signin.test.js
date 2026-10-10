import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSupabaseAuth } from '../src/auth/supabase-auth.js';
import { loadConfig, ConfigError } from '../src/config.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { buildTestApp, serve, postJson, bearer, USER_TOKEN } from './helpers.js';

const SB = 'https://proj.supabase.co';
const ANON = 'sb_publishable_test';
const ENV = { SUPABASE_URL: SB, SUPABASE_PUBLISHABLE_KEY: ANON, SUPABASE_SECRET_KEY: 'sb_secret_test', CRON_SECRET: 'cron-test-' + 'x'.repeat(32) };

// A pretend Supabase Auth: code 123456 works for any address.
function fakeSupabase() {
  const calls = [];
  let n = 0;
  const owner = new Map();   // refresh token -> email; a used token stops working
  const sessionFor = (email) => {
    const rt = 'rt-' + (++n);
    owner.set(rt, email);
    return { access_token: USER_TOKEN, refresh_token: rt, expires_in: 3600, user: { id: 'user-1', email } };
  };
  const refreshed = (rt) => {
    const email = owner.get(rt) ?? (rt.startsWith('rt-') ? 'ana@example.com' : null);
    if (!email) return null;
    owner.set(rt, null);
    return sessionFor(email);
  };
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body || '{}');
    calls.push({ url, body, headers: init.headers });
    const path = url.replace(SB + '/auth/v1/', '');
    if (!path.startsWith('logout') && (init.headers.apikey !== ANON || init.headers.Authorization !== 'Bearer ' + ANON)) {
      return Response.json({}, { status: 401 });
    }
    if (path === 'otp') return Response.json({});
    if (path === 'verify') return body.token === '123456' ? Response.json(sessionFor(body.email)) : Response.json({ msg: 'expired' }, { status: 403 });
    if (path === 'token?grant_type=refresh_token') {
      const next = refreshed(body.refresh_token);
      return next ? Response.json(next) : Response.json({}, { status: 400 });
    }
    if (path === 'token?grant_type=pkce') return body.auth_code === 'good-code' && body.code_verifier ? Response.json(sessionFor('g@example.com')) : Response.json({}, { status: 400 });
    if (path.startsWith('logout')) return init.headers.Authorization === 'Bearer ' + USER_TOKEN ? new Response(null, { status: 204 }) : Response.json({}, { status: 401 });
    return Response.json({}, { status: 404 });
  };
  return { auth: createSupabaseAuth({ url: SB, publishableKey: ANON, fetchImpl }), calls };
}

test('refresh rate limiting is transient and does not become a signed-out result', async () => {
  const auth = createSupabaseAuth({
    url: SB,
    publishableKey: ANON,
    fetchImpl: async () => Response.json({ msg: 'rate limit' }, { status: 429 })
  });
  await assert.rejects(
    () => auth.refresh('refresh-token'),
    (err) => err && err.status === 503 && err.code === 'auth_unavailable'
  );
});

async function setup(env = {}) {
  const sb = fakeSupabase();
  const { app, store } = buildTestApp({ env: { ...ENV, ...env }, auth: sb.auth, provider: createFakeProvider({ models: ['gpt-4o-mini', 'gpt-5-mini', 'gpt-5'] }) });
  const s = await serve(app);
  return { ...s, sb, store };
}

const cookieOf = (resp, name) => (resp.headers.getSetCookie().find((c) => c.startsWith(name + '=')) || '');
const same = (url) => ({ Origin: new URL(url).origin, 'Sec-Fetch-Site': 'same-origin' });

test('email code: send, verify, refresh rotates, sign out clears', async () => {
  const { url, close, sb } = await setup();
  try {
    const sent = await postJson(url + '/v1/auth/email/start', { email: ' Ana@Example.com ' }, same(url));
    assert.equal(sent.status, 200);
    assert.deepEqual(sb.calls[0].body, { email: 'ana@example.com', create_user: true });
    assert.equal(sb.calls[0].headers.apikey, ANON, 'only the public key is used for sign-in');

    const wrong = await postJson(url + '/v1/auth/email/verify', { email: 'ana@example.com', code: '000000' }, same(url));
    assert.equal(wrong.status, 400);
    assert.equal((await wrong.json()).error.code, 'invalid_code');

    const ok = await postJson(url + '/v1/auth/email/verify', { email: 'ana@example.com', code: '123 456' }, same(url));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.deepEqual(body, { access_token: USER_TOKEN, expires_in: 3600, user: { email: 'ana@example.com' } });
    assert.equal('refresh_token' in body, false, 'the refresh token never reaches page scripts');
    const rt = cookieOf(ok, 'nasrin_rt');
    assert.match(rt, /^nasrin_rt=rt-1; Path=\/v1\/auth; Max-Age=31536000; HttpOnly; Secure; SameSite=None$/);

    // The access token works with the API as a signed-in user.
    const who = await (await fetch(url + '/v1/whoami', { headers: bearer(body.access_token) })).json();
    assert.equal(who.actor_type, 'user');

    const r = await fetch(url + '/v1/auth/refresh', { method: 'POST', headers: { ...same(url), Cookie: 'nasrin_rt=rt-1' } });
    assert.equal(r.status, 200);
    assert.match(cookieOf(r, 'nasrin_rt'), /^nasrin_rt=rt-2;/);

    const out = await fetch(url + '/v1/auth/sign-out', { method: 'POST', headers: { ...same(url), ...bearer(USER_TOKEN), Cookie: 'nasrin_rt=rt-2' } });
    assert.equal(out.status, 200);
    assert.match(cookieOf(out, 'nasrin_rt'), /Max-Age=0/);
    assert.ok(sb.calls.some((c) => c.url.endsWith('/logout?scope=local') && c.headers.Authorization === 'Bearer ' + USER_TOKEN), 'log out ends only this device');
  } finally { await close(); }
});

test('refresh without a valid cookie is signed out and clears the cookie', async () => {
  const { url, close } = await setup();
  try {
    const none = await fetch(url + '/v1/auth/refresh', { method: 'POST', headers: same(url) });
    assert.equal(none.status, 401);
    const bad = await fetch(url + '/v1/auth/refresh', { method: 'POST', headers: { ...same(url), Cookie: 'nasrin_rt=stolen' } });
    assert.equal(bad.status, 401);
    assert.equal(cookieOf(bad, 'nasrin_rt'), '', 'a stale failed refresh must not clear a newer cookie set by another tab');
  } finally { await close(); }
});

test('other websites cannot use the sign-in routes', async () => {
  const { url, close } = await setup();
  try {
    for (const headers of [{ Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'same-site' }]) {
      const r = await fetch(url + '/v1/auth/refresh', { method: 'POST', headers: { ...headers, Cookie: 'nasrin_rt=rt-1' } });
      assert.equal(r.status, 403, JSON.stringify(headers));
      const e = await postJson(url + '/v1/auth/email/start', { email: 'ana@example.com' }, headers);
      assert.equal(e.status, 403);
    }
    const r = await fetch(url + '/v1/auth/refresh', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } });
    assert.equal(r.headers.get('access-control-allow-credentials'), null, 'never credentialed CORS');
  } finally { await close(); }
});

test('codes are limited per address and checked', async () => {
  const { url, close, sb } = await setup({ LIMIT_SIGNIN_CODES_EMAIL_HOUR: '2' });
  try {
    assert.equal((await postJson(url + '/v1/auth/email/start', { email: 'not-an-email' }, same(url))).status, 400);
    for (const expected of [200, 200, 429]) {
      assert.equal((await postJson(url + '/v1/auth/email/start', { email: 'b@example.com' }, same(url))).status, expected);
    }
    assert.equal(sb.calls.filter((c) => c.url.endsWith('/otp')).length, 2, 'the third was never sent');
    assert.equal((await postJson(url + '/v1/auth/email/verify', { email: 'b@example.com', code: 'abc' }, same(url))).status, 400);
  } finally { await close(); }
});

test('Google: PKCE start, callback sets the session, failures go back to the page', async () => {
  const { url, close, sb } = await setup({ AUTH_GOOGLE: 'true', SITE_URL: 'https://nasrinai.com' });
  try {
    const start = await fetch(url + '/v1/auth/google/start', { redirect: 'manual' });
    assert.equal(start.status, 302);
    const to = new URL(start.headers.get('location'));
    assert.equal(to.origin + to.pathname, SB + '/auth/v1/authorize');
    assert.equal(to.searchParams.get('provider'), 'google');
    assert.equal(to.searchParams.get('redirect_to'), 'https://nasrinai.com/v1/auth/google/callback');
    assert.equal(to.searchParams.get('code_challenge_method'), 's256');
    assert.equal(to.searchParams.get('prompt'), 'select_account', 'Google asks which account, so another one can be added');
    const pkce = cookieOf(start, 'nasrin_pkce');
    assert.match(pkce, /Path=\/v1\/auth\/google; Max-Age=600; HttpOnly; Secure; SameSite=None$/);
    const verifier = decodeURIComponent(pkce.split(';')[0].split('=')[1]);
    assert.equal(createHash('sha256').update(verifier).digest('base64url'), to.searchParams.get('code_challenge'));

    const ok = await fetch(url + '/v1/auth/google/callback?code=good-code', { redirect: 'manual', headers: { Cookie: 'nasrin_pkce=' + verifier } });
    assert.equal(ok.headers.get('location'), '/?signin=ok');
    assert.match(cookieOf(ok, 'nasrin_rt'), /^nasrin_rt=rt-/);
    assert.equal(sb.calls.at(-1).body.code_verifier, verifier);

    for (const [q, cookie] of [['?code=good-code', ''], ['?code=bad', 'nasrin_pkce=v'], ['?error=access_denied', 'nasrin_pkce=v']]) {
      const r = await fetch(url + '/v1/auth/google/callback' + q, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
      assert.equal(r.headers.get('location'), '/?signin=failed', q);
      assert.equal(cookieOf(r, 'nasrin_rt'), '');
    }
  } finally { await close(); }
});

test('status and models tell the page about sign-in; guests see locked tiers', async () => {
  const { url, close } = await setup();
  try {
    const status = await (await fetch(url + '/v1/status')).json();
    assert.deepEqual(status.sign_in, { email: true, google: false });
    assert.equal((await fetch(url + '/v1/auth/google/start', { redirect: 'manual' })).status, 404, 'Google is off until configured');
    const g = (await (await fetch(url + '/v1/guest/sessions', { method: 'POST' })).json()).token;
    const list = await (await fetch(url + '/v1/models', { headers: bearer(g) })).json();
    assert.deepEqual(list.models.map((m) => [m.id, Boolean(m.locked)]), [['nasrinai', false], ['pro', true], ['max', true], ['ultra', true]]);
    const r = await postJson(url + '/v1/chat', { message: 'hi', model: 'max' }, bearer(g));
    assert.equal(r.status, 400, 'locked tiers are still refused for guests');
  } finally { await close(); }
});

test('config: sign-in settings', () => {
  assert.deepEqual(loadConfig(ENV).auth, { email: true, google: false });
  assert.deepEqual(loadConfig({}).auth, { email: false, google: false }, 'no Supabase, no sign-in');
  assert.deepEqual(loadConfig({ ...ENV, AUTH_EMAIL: 'false', AUTH_GOOGLE: 'true', SITE_URL: 'https://nasrinai.com/' }).auth, { email: false, google: true });
  // A sign-in mistake switches that method off and is reported; the site stays up.
  for (const [env, auth, problem] of [
    [{ ...ENV, AUTH_GOOGLE: 'true' }, { email: true, google: false }, /AUTH_GOOGLE needs SITE_URL/],
    [{ AUTH_GOOGLE: 'true', SITE_URL: 'https://x.y' }, { email: false, google: false }, /needs SUPABASE_URL/],
    [{ ...ENV, AUTH_EMAIL: 'yes' }, { email: false, google: false }, /AUTH_EMAIL: use true or false/],
    [{ ...ENV, AUTH_GOOGLE: 'true', SITE_URL: '"https://nasrinai.com"' }, { email: true, google: false }, /SITE_URL: not a valid address/],
    [{ ...ENV, NODE_ENV: 'production', GUEST_SESSION_SECRET: 'g'.repeat(40), CRON_SECRET: 'c'.repeat(40), AUTH_GOOGLE: 'true', SITE_URL: 'http://nasrinai.com' }, { email: true, google: false }, /SITE_URL: use https/]
  ]) {
    const c = loadConfig(env);
    assert.deepEqual(c.auth, auth, JSON.stringify(env));
    assert.ok(c.warnings.some((w) => problem.test(w)), JSON.stringify(c.warnings));
  }
  assert.deepEqual(loadConfig({ ...ENV, AUTH_GOOGLE: ' TRUE ', SITE_URL: 'https://nasrinai.com' }).warnings, []);
  assert.deepEqual(loadConfig({ ...ENV, AUTH_GOOGLE: 'true', PUBLIC_URL: 'https://nasrinai.com' }).auth, { email: true, google: true }, 'the old name still works');
});

const cookieValue = (resp, name) => decodeURIComponent((cookieOf(resp, name).split(';')[0] || '').slice(name.length + 1));

test('accounts: add up to 3 on a device, switch keeps the others, each signs in as itself', async () => {
  const { url, close } = await setup();
  try {
    const signIn = async (email) => {
      const r = await postJson(url + '/v1/auth/email/verify', { email, code: '123456' }, same(url));
      return cookieValue(r, 'nasrin_rt');
    };
    const call = (path, jar, body) => fetch(url + path, {
      method: body === undefined && path.endsWith('/accounts') ? 'GET' : 'POST',
      headers: { ...same(url), 'Content-Type': 'application/json', Cookie: jar },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const jarOf = (rt, acc) => [rt && `nasrin_rt=${encodeURIComponent(rt)}`, acc && `nasrin_acc=${encodeURIComponent(acc)}`].filter(Boolean).join('; ');

    // Ana stays signed in while the next account is pending.
    let rt = await signIn('ana@example.com');
    let r = await call('/v1/auth/accounts/add', jarOf(rt));
    assert.equal(r.status, 200);
    assert.match(cookieOf(r, 'nasrin_rt'), /^nasrin_rt=rt-/);
    const pending = cookieOf(r, 'nasrin_add').split(';')[0];
    assert.match(cookieOf(r, 'nasrin_add'), /Path=\/v1\/auth; Max-Age=600; HttpOnly; Secure; SameSite=None$/);
    let acc = '';

    // The pending Ana account is saved only when Ben successfully signs in.
    const ben = await fetch(url + '/v1/auth/email/verify', {
      method: 'POST',
      headers: { ...same(url), 'Content-Type': 'application/json', Cookie: [jarOf(rt), pending].filter(Boolean).join('; ') },
      body: JSON.stringify({ email: 'ben@example.com', code: '123456' })
    });
    assert.equal(ben.status, 200);
    rt = cookieValue(ben, 'nasrin_rt');
    acc = cookieValue(ben, 'nasrin_acc');
    assert.match(cookieOf(ben, 'nasrin_acc'), /Path=\/v1\/auth; Max-Age=31536000; HttpOnly; Secure; SameSite=None$/);
    assert.deepEqual(JSON.parse(acc).map((a) => a.e), ['ana@example.com']);

    const list = await (await call('/v1/auth/accounts', jarOf(null, acc))).json();
    assert.deepEqual(list, { accounts: [{ email: 'ana@example.com' }], max: 3 });
    assert.equal(JSON.stringify(list).includes('rt-'), false, 'refresh tokens never reach the page');

    // Ben adds his account; it is committed when Cy signs in.
    r = await call('/v1/auth/accounts/add', jarOf(rt, acc));
    assert.equal(r.status, 200);
    const pendingBen = cookieOf(r, 'nasrin_add').split(';')[0];
    const cy = await fetch(url + '/v1/auth/email/verify', {
      method: 'POST',
      headers: { ...same(url), 'Content-Type': 'application/json', Cookie: [jarOf(rt, acc), pendingBen].filter(Boolean).join('; ') },
      body: JSON.stringify({ email: 'cy@example.com', code: '123456' })
    });
    assert.equal(cy.status, 200);
    rt = cookieValue(cy, 'nasrin_rt');
    acc = cookieValue(cy, 'nasrin_acc');
    assert.deepEqual(JSON.parse(acc).map((a) => a.e), ['ben@example.com', 'ana@example.com']);
    const full = await call('/v1/auth/accounts/add', jarOf(rt, acc));
    assert.equal(full.status, 400);
    assert.equal((await full.json()).error.code, 'too_many_accounts');

    // Cy switches to Ana: Ana is active, Cy and Ben are kept.
    r = await call('/v1/auth/accounts/switch', jarOf(rt, acc), { email: 'Ana@example.com' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).user.email, 'ana@example.com');
    rt = cookieValue(r, 'nasrin_rt');
    acc = cookieValue(r, 'nasrin_acc');
    assert.deepEqual(JSON.parse(acc).map((a) => a.e), ['cy@example.com', 'ben@example.com']);

    // Signing out the active account removes only its refresh session.
    const signedOut = await fetch(url + '/v1/auth/sign-out', {
      method: 'POST',
      headers: { ...same(url), ...bearer(USER_TOKEN), Cookie: jarOf(rt, acc) }
    });
    assert.equal(signedOut.status, 200);
    assert.match(cookieOf(signedOut, 'nasrin_rt'), /Max-Age=0/);
    assert.equal(cookieOf(signedOut, 'nasrin_acc'), '', 'sign-out leaves the saved-account cookie untouched');
    assert.deepEqual(JSON.parse(acc).map((a) => a.e), ['cy@example.com', 'ben@example.com']);

    // The saved accounts remain independently available after sign-out.
    const savedAfterSignOut = await call('/v1/auth/accounts', jarOf(null, acc));
    assert.deepEqual((await savedAfterSignOut.json()).accounts.map((a) => a.email), ['cy@example.com', 'ben@example.com']);

    // The new active token renews as Ana.
    const again = await call('/v1/auth/refresh', jarOf(rt, acc));
    assert.equal((await again.json()).user.email, 'ana@example.com');

    // Unknown account, other sites, and broken cookies.
    assert.equal((await call('/v1/auth/accounts/switch', jarOf(rt, acc), { email: 'zed@example.com' })).status, 404);
    const cross = await fetch(url + '/v1/auth/accounts', { headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', Cookie: jarOf(null, acc) } });
    assert.equal(cross.status, 403);
    assert.deepEqual((await (await call('/v1/auth/accounts', 'nasrin_acc=%7Bbroken')).json()).accounts, []);
  } finally { await close(); }
});

test('accounts: add keeps the current session until the new account signs in', async () => {
  const { url, close } = await setup();
  try {
    const headers = (jar) => ({ ...same(url), 'Content-Type': 'application/json', Cookie: jar });
    const verify = (email, jar) => fetch(url + '/v1/auth/email/verify', {
      method: 'POST',
      headers: headers(jar),
      body: JSON.stringify({ email, code: '123456' })
    });
    const first = await postJson(url + '/v1/auth/email/verify', { email: 'ana@example.com', code: '123456' }, same(url));
    const firstRt = cookieValue(first, 'nasrin_rt');

    const add = await fetch(url + '/v1/auth/accounts/add', {
      method: 'POST',
      headers: headers('nasrin_rt=' + encodeURIComponent(firstRt))
    });
    assert.equal(add.status, 200);
    let rotatedRt = cookieValue(add, 'nasrin_rt');
    assert.notEqual(rotatedRt, firstRt);
    assert.match(cookieOf(add, 'nasrin_add'), /Path=\/v1\/auth; Max-Age=600; HttpOnly; Secure; SameSite=None$/);
    assert.deepEqual((await (await fetch(url + '/v1/auth/accounts', { headers: headers('nasrin_rt=' + encodeURIComponent(rotatedRt)) })).json()).accounts, []);

    // The original account is still active while the new account is pending.
    const refreshed = await fetch(url + '/v1/auth/refresh', {
      method: 'POST',
      headers: headers('nasrin_rt=' + encodeURIComponent(rotatedRt) + '; ' + cookieOf(add, 'nasrin_add').split(';')[0])
    });
    assert.equal(refreshed.status, 200);
    assert.equal((await refreshed.clone().json()).user.email, 'ana@example.com');
    rotatedRt = cookieValue(refreshed, 'nasrin_rt');
    const pendingCookie = cookieOf(refreshed, 'nasrin_add').split(';')[0];

    // A failed sign-in does not consume the pending add or sign out Ana.
    const bad = await postJson(url + '/v1/auth/email/verify', { email: 'ben@example.com', code: '000000' }, headers('nasrin_rt=' + encodeURIComponent(rotatedRt) + '; ' + pendingCookie));
    assert.equal(bad.status, 400);

    // The new account is committed only after successful authentication.
    const ok = await verify('ben@example.com', 'nasrin_rt=' + encodeURIComponent(rotatedRt) + '; ' + pendingCookie);
    assert.equal(ok.status, 200);
    const saved = JSON.parse(cookieValue(ok, 'nasrin_acc'));
    assert.deepEqual(saved.map((a) => a.e), ['ana@example.com']);
    assert.equal((await ok.clone().json()).user.email, 'ben@example.com');
    assert.notEqual(cookieValue(ok, 'nasrin_rt'), rotatedRt);
    assert.match(cookieOf(ok, 'nasrin_add'), /Max-Age=0/);
  } finally { await close(); }
});

test('accounts: an expired kept account is removed; signing in again with a kept account keeps it once', async () => {
  const { url, close } = await setup();
  try {
    const headers = (jar) => ({ ...same(url), 'Content-Type': 'application/json', Cookie: jar });
    const acc = encodeURIComponent(JSON.stringify([{ e: 'old@example.com', t: 'expired' }, { e: 'ana@example.com', t: 'rt-x' }]));
    const r = await fetch(url + '/v1/auth/accounts/switch', { method: 'POST', headers: headers(`nasrin_acc=${acc}`), body: JSON.stringify({ email: 'old@example.com' }) });
    assert.equal(r.status, 401);
    assert.deepEqual(JSON.parse(cookieValue(r, 'nasrin_acc')).map((a) => a.e), ['ana@example.com']);

    // Ana is active again (rt-5 belongs to the fake's default, Ana), so her kept copy goes.
    const ref = await fetch(url + '/v1/auth/refresh', { method: 'POST', headers: headers(`nasrin_rt=rt-5; nasrin_acc=${acc}`) });
    assert.equal(ref.status, 200);
    assert.deepEqual(JSON.parse(cookieValue(ref, 'nasrin_acc')).map((a) => a.e), ['old@example.com']);
  } finally { await close(); }
});

test('sign out of other devices: this session stays, needs a valid token and this site', async () => {
  const { url, close, sb } = await setup();
  try {
    const ok = await fetch(url + '/v1/auth/sign-out-others', { method: 'POST', headers: { ...same(url), ...bearer(USER_TOKEN), Cookie: 'nasrin_rt=rt-1' } });
    assert.equal(ok.status, 200);
    assert.equal(cookieOf(ok, 'nasrin_rt'), '', 'the sign-in cookie on this device is untouched');
    assert.ok(sb.calls.some((c) => c.url.endsWith('/logout?scope=others')));
    assert.equal((await fetch(url + '/v1/auth/sign-out-others', { method: 'POST', headers: same(url) })).status, 401);
    assert.equal((await fetch(url + '/v1/auth/sign-out-others', { method: 'POST', headers: { ...same(url), Authorization: 'Bearer x.y.z' } })).status, 401);
    const cross = await fetch(url + '/v1/auth/sign-out-others', { method: 'POST', headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site', ...bearer(USER_TOKEN) } });
    assert.equal(cross.status, 403);
  } finally { await close(); }
});
