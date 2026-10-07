import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInstallRegistry } from '../src/connect/provider-registry.js';

test('unsupported provider cannot install', async () => {
  const registry = createInstallRegistry();
  await assert.rejects(registry.install('hosting', { authorized: true, approved: true }), /not ready/);
});

test('installation requires explicit approval', async () => {
  const registry = createInstallRegistry({ hosting: { install() {}, verify() {}, rollback() {} } });
  await assert.rejects(registry.install('hosting', { authorized: true }), /approval/);
});

test('verified install returns version', async () => {
  const registry = createInstallRegistry({ hosting: {
    async install() { return { deployment: 'abc' }; },
    async verify() { return { ok: true, version: 'v1' }; },
    async rollback() { throw Error('should not roll back'); }
  } });
  const result = await registry.install('hosting', { authorized: true, approved: true });
  assert.equal(result.version, 'v1');
});

test('failed verification triggers rollback', async () => {
  let rolledBack = false;
  const registry = createInstallRegistry({ hosting: {
    async install() { return { deployment: 'abc' }; },
    async verify() { return { ok: false }; },
    async rollback() { rolledBack = true; }
  } });
  await assert.rejects(registry.install('hosting', { authorized: true, approved: true }), /rolled back/);
  assert.equal(rolledBack, true);
});


test('provider install failure with rollback receipt triggers rollback', async () => {
  let rolledBack = false;
  const registry = createInstallRegistry({ hosting: {
    async install() { const e = new Error('partial'); e.receipt = { deployment: 'partial' }; throw e; },
    async verify() { throw Error('should not verify'); },
    async rollback({ receipt }) { rolledBack = receipt.deployment === 'partial'; }
  } });
  await assert.rejects(registry.install('hosting', { authorized: true, approved: true }), /Installation could not be completed/);
  assert.equal(rolledBack, true);
});

test('rollback failure is fail-closed', async () => {
  const registry = createInstallRegistry({ hosting: {
    async install() { return { deployment: 'abc' }; },
    async verify() { return { ok: false }; },
    async rollback() { throw Error('rollback unavailable'); }
  } });
  await assert.rejects(registry.install('hosting', { authorized: true, approved: true }), (error) => error.code === 'rollback_failed');
});

test('missing rollback receipt does not claim rollback', async () => {
  let rolledBack = false;
  const registry = createInstallRegistry({ hosting: {
    async install() { throw Error('failed before receipt'); },
    async verify() { throw Error('should not verify'); },
    async rollback() { rolledBack = true; }
  } });
  await assert.rejects(registry.install('hosting', { authorized: true, approved: true }), /Installation could not be completed/);
  assert.equal(rolledBack, false);
});
