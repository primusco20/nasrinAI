import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('owner console is disabled unless all server-side allowlist settings are valid', () => {
  const disabled = loadConfig({ NODE_ENV: 'test' });
  assert.equal(disabled.ownerConsole.enabled, false);
  assert.deepEqual(disabled.ownerConsole.emails, []);
  assert.deepEqual(disabled.ownerConsole.ips, []);
  assert.equal(disabled.ownerConsole.sessionSecret, '');
});

test('owner console accepts exact email and normalized IPv4/IPv6 allowlists from environment', () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    OWNER_ALLOWED_EMAILS: 'Owner@example.com, second@example.org',
    OWNER_ALLOWED_IPS: '203.0.113.7,2001:0db8:0:0:0:0:0:1',
    OWNER_SESSION_SECRET: 's'.repeat(40)
  });
  assert.equal(config.ownerConsole.enabled, true);
  assert.deepEqual(config.ownerConsole.emails, ['owner@example.com', 'second@example.org']);
  assert.deepEqual(config.ownerConsole.ips, ['203.0.113.7', '2001:db8::1']);
  assert.equal(config.ownerConsole.sessionSecret, 's'.repeat(40));
});

test('malformed entries or a short session secret disable the owner console without breaking the app config', () => {
  for (const env of [
    { OWNER_ALLOWED_EMAILS: 'not-an-email', OWNER_ALLOWED_IPS: '203.0.113.7', OWNER_SESSION_SECRET: 's'.repeat(40) },
    { OWNER_ALLOWED_EMAILS: 'owner@example.com', OWNER_ALLOWED_IPS: '203.0.113.0/24', OWNER_SESSION_SECRET: 's'.repeat(40) },
    { OWNER_ALLOWED_EMAILS: 'owner@example.com', OWNER_ALLOWED_IPS: 'not-an-ip', OWNER_SESSION_SECRET: 's'.repeat(40) },
    { OWNER_ALLOWED_EMAILS: 'owner@example.com', OWNER_ALLOWED_IPS: '203.0.113.7', OWNER_SESSION_SECRET: 'short' },
    { OWNER_ALLOWED_EMAILS: 'owner@example.com', OWNER_ALLOWED_IPS: '203.0.113.7,invalid', OWNER_SESSION_SECRET: 's'.repeat(40) }
  ]) {
    const config = loadConfig({ NODE_ENV: 'test', ...env });
    assert.equal(config.ownerConsole.enabled, false);
    assert.deepEqual(config.ownerConsole.emails, []);
    assert.deepEqual(config.ownerConsole.ips, []);
    assert.equal(config.ownerConsole.sessionSecret, '');
  }
});


test('optional Vercel deployment telemetry requires a token and exact project/team identifiers', () => {
  const base = { NODE_ENV: 'test', OWNER_ALLOWED_EMAILS: 'owner@example.com', OWNER_ALLOWED_IPS: '203.0.113.7', OWNER_SESSION_SECRET: 's'.repeat(40) };
  const disabled = loadConfig({ ...base });
  assert.equal(disabled.ownerConsole.vercel.enabled, false);
  const enabled = loadConfig({ ...base, OWNER_VERCEL_READONLY_TOKEN: 'v'.repeat(32), OWNER_VERCEL_PROJECT_ID: 'prj_ih4baHcswf8P9TuNNZGtb7ScEYwh', OWNER_VERCEL_TEAM_ID: 'team_KthCrTNwdIvA7rh12L0tB7Mh' });
  assert.equal(enabled.ownerConsole.vercel.enabled, true);
  assert.equal(enabled.ownerConsole.vercel.projectId, 'prj_ih4baHcswf8P9TuNNZGtb7ScEYwh');
  const malformed = loadConfig({ ...base, OWNER_VERCEL_READONLY_TOKEN: 'v'.repeat(32), OWNER_VERCEL_PROJECT_ID: 'not-a-project', OWNER_VERCEL_TEAM_ID: 'team_KthCrTNwdIvA7rh12L0tB7Mh' });
  assert.equal(malformed.ownerConsole.vercel.enabled, false);
  assert.equal(malformed.ownerConsole.vercel.token, '');
});
