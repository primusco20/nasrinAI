import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/log.js';
import { setBaseHeaders, setApiHeaders } from '../src/http/headers.js';

function responseMock() {
  const headers = new Map();
  return {
    headers,
    setHeader(name, value) { headers.set(name, value); }
  };
}

test('logger redacts credential-like values inside strings', () => {
  const value = 'Authorization: Bearer nss_super_secret_token sk-ant-abcdefghijklmnopqrstuvwxyz1234 access_token=topsecret';
  const redacted = redact(value);
  assert.equal(redacted.includes('nss_super_secret_token'), false);
  assert.equal(redacted.includes('sk-ant-abcdefghijklmnopqrstuvwxyz1234'), false);
  assert.equal(redacted.includes('topsecret'), false);
  assert.match(redacted, /Bearer \[redacted\]/);
  assert.match(redacted, /access_token=\[redacted\]/);
});

test('logger redacts sensitive object keys and nested credential values', () => {
  const redacted = redact({
    authorization: 'Bearer nss_super_secret_token',
    nested: { message: 'sk-ant-abcdefghijklmnopqrstuvwxyz1234' },
    normal: 'safe'
  });
  assert.equal(redacted.authorization, '[redacted]');
  assert.equal(redacted.nested.message, '[redacted]');
  assert.equal(redacted.normal, 'safe');
});

test('baseline headers include hardened browser controls', () => {
  const res = responseMock();
  setBaseHeaders(res, { isProduction: true });
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('X-DNS-Prefetch-Control'), 'off');
  assert.equal(res.headers.get('X-Permitted-Cross-Domain-Policies'), 'none');
  assert.equal(res.headers.get('Origin-Agent-Cluster'), '?1');
  assert.match(res.headers.get('Strict-Transport-Security'), /max-age=31536000/);
});

test('API responses remain uncacheable and frame-protected', () => {
  const res = responseMock();
  setApiHeaders(res);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.match(res.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
});
