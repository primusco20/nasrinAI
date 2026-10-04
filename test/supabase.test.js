import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStore } from '../src/store/supabase-store.js';
import { createSupabaseUserVerifier } from '../src/auth/supabase-user.js';
import { UpstreamError, HttpError } from '../src/http/errors.js';

// A fetch that records requests and answers from a script.
function fakeFetch(answer) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, ...init });
    const { status = 200, body = [] } = typeof answer === 'function' ? answer(url, init) : answer;
    return new Response(body === null ? null : JSON.stringify(body), { status });
  };
  f.calls = calls;
  return f;
}

test('store requests use the service key and validated ids only', async () => {
  const f = fakeFetch({ body: [{ id: 'aaaaaaaaaaaa', tenant_id: 't', kind: 'secret', secret_hash: 'h', scopes: ['chat'], allowed_origins: [], revoked_at: null }] });
  const store = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: f });

  const key = await store.getApiKey('aaaaaaaaaaaa');
  assert.equal(key.kind, 'secret');
  assert.equal(key.revoked, false);
  assert.match(f.calls[0].url, /^https:\/\/p\.supabase\.co\/rest\/v1\/api_keys\?id=eq\.aaaaaaaaaaaa&/);
  assert.equal(f.calls[0].headers.apikey, 'svc');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer svc');

  // anything that is not a well-formed id never reaches the database
  assert.equal(await store.getApiKey('aaaa&id=neq.x'), null);
  assert.equal(await store.getTenant('not-a-uuid'), null);
  assert.equal(f.calls.length, 1);
});

test('database failures become UpstreamError (shown to callers as a 503)', async () => {
  const down = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down.getTenant('00000000-0000-0000-0000-000000000001'), UpstreamError);
  const err = createSupabaseStore({ url: 'https://p.supabase.co', serviceKey: 'svc', fetchImpl: fakeFetch({ status: 500, body: { message: 'boom' } }) });
  await assert.rejects(err.getTenant('00000000-0000-0000-0000-000000000001'), UpstreamError);
});

test('user check: valid, invalid, outage, and caching of valid answers', async () => {
  let n = 0;
  const f = fakeFetch((url, init) => {
    n += 1;
    const token = init.headers.Authorization.slice(7);
    if (token === 'good.good.good') return { body: { id: 'u1' } };
    if (token === 'down.down.down') return { status: 502, body: {} };
    return { status: 401, body: {} };
  });
  const verify = createSupabaseUserVerifier({ url: 'https://p.supabase.co', anonKey: 'anon', fetchImpl: f });

  assert.deepEqual(await verify('good.good.good'), { id: 'u1' });
  assert.deepEqual(await verify('good.good.good'), { id: 'u1' });
  assert.equal(n, 1, 'second check served from the short cache');
  assert.equal(f.calls[0].url, 'https://p.supabase.co/auth/v1/user');
  assert.equal(f.calls[0].headers.apikey, 'anon');

  assert.equal(await verify('bad.bad.bad'), null);
  await assert.rejects(verify('down.down.down'), (e) => e instanceof HttpError && e.status === 503);
  assert.equal(await verify('not a jwt'), null);
});
