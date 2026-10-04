import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/log.js';

test('credentials are redacted from log fields, at any depth', () => {
  const out = redact({ user: 'a', authorization: 'Bearer x', nested: { apiKey: 'k', list: [{ password: 'p', ok: 1 }] } });
  assert.equal(out.authorization, '[redacted]');
  assert.equal(out.nested.apiKey, '[redacted]');
  assert.equal(out.nested.list[0].password, '[redacted]');
  assert.equal(out.nested.list[0].ok, 1);
  assert.equal(out.user, 'a');
});
