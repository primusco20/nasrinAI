import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry, ToolError } from '../src/tools/registry.js';
import { basicTools } from '../src/tools/basic.js';
import { checkArgs } from '../src/tools/schema.js';

const guest = { tenantId: 'tenant-a', actor: { type: 'guest', id: 'g1' } };
const user = { tenantId: 'tenant-a', actor: { type: 'user', id: 'u1' } };

function registry(extra = [], opts = {}) {
  const records = [];
  const usageLog = { record: async (caller, e) => { records.push({ caller, ...e }); } };
  return { reg: createToolRegistry({ tools: [...basicTools, ...extra], usageLog, ...opts }), records };
}
const code = (c) => (err) => err instanceof ToolError && err.code === c;

test('read-only tools give exact answers', async () => {
  const { reg } = registry();
  assert.deepEqual(await reg.run(guest, 'calculate', '{"expression":"(12.5 + 3) * 4"}'), { expression: '(12.5 + 3) * 4', value: 62 });
  assert.equal((await reg.run(guest, 'convert_units', { value: 5, from: 'km', to: 'mi' })).result, 3.106855961);
  assert.equal((await reg.run(guest, 'convert_units', { value: 98.6, from: 'f', to: 'c' })).result, 37);
  assert.match((await reg.run(guest, 'current_time', { time_zone: 'Asia/Manila' })).now, /\d{4}/);
  await assert.rejects(reg.run(guest, 'convert_units', { value: 1, from: 'kg', to: 'km' }), code('failed'));
  await assert.rejects(reg.run(guest, 'current_time', { time_zone: 'Mars/Olympus' }), code('failed'));
});

test('model arguments are checked strictly; nothing extra gets through', async () => {
  const { reg, records } = registry();
  await assert.rejects(reg.run(guest, 'shell', '{}'), code('unknown_tool'));
  await assert.rejects(reg.run(guest, 'calculate', 'not json'), code('invalid_arguments'));
  await assert.rejects(reg.run(guest, 'calculate', { expression: 'process.exit()' }), code('invalid_arguments'));
  await assert.rejects(reg.run(guest, 'calculate', { expression: '1+1', tenant_id: 'tenant-b' }), code('invalid_arguments'), 'unknown keys refused');
  await assert.rejects(reg.run(guest, 'calculate', {}), code('invalid_arguments'));
  await assert.rejects(reg.run(guest, 'convert_units', { value: '5', from: 'km', to: 'mi' }), code('invalid_arguments'));
  await assert.rejects(reg.run(guest, 'calculate', JSON.stringify({ expression: '1'.repeat(5000) })), code('invalid_arguments'));
  assert.ok(records.every((r) => r.task === 'tool' && r.outcome === 'rejected_output' && !('args' in r)), 'recorded, without arguments');
  assert.equal(checkArgs({ properties: { n: { type: 'integer' } } }, { n: 1.5 }), 'n must be a whole number');
});

test('permissions and risk are decided by code: actor types, confirmation, tenant from the credential', async () => {
  let seen = null;
  const write = { name: 'save_note', description: 'x', risk: 'write', who: ['user'], parameters: { properties: { text: { type: 'string', maxLength: 50 } }, required: ['text'] },
    run(args, ctx) { seen = ctx; return { saved: true }; } };
  const { reg } = registry([write]);
  assert.deepEqual(reg.specsFor(guest).map((s) => s.function.name), ['calculate', 'current_time', 'convert_units']);
  assert.equal(reg.specsFor(user).length, 4);
  assert.equal(reg.specsFor(user)[3].function.parameters.additionalProperties, false);
  await assert.rejects(reg.run(guest, 'save_note', { text: 'hi' }), code('not_allowed'));
  await assert.rejects(reg.run(user, 'save_note', { text: 'hi' }), code('needs_confirmation'), 'the model cannot confirm');
  assert.deepEqual(await reg.run(user, 'save_note', { text: 'hi' }, { confirmed: true }), { saved: true });
  assert.deepEqual([seen.tenantId, seen.actor.id], ['tenant-a', 'u1']);
  assert.throws(() => { seen.tenantId = 'tenant-b'; }, TypeError, 'context is read-only');
});

test('slow, failing or oversized tools are stopped and recorded', async () => {
  const slow = { name: 'slow', description: 'x', risk: 'read', who: ['guest'], parameters: { properties: {} }, run: () => new Promise(() => {}) };
  const big = { name: 'big', description: 'x', risk: 'read', who: ['guest'], parameters: { properties: {} }, run: () => ({ s: 'x'.repeat(10000) }) };
  const { reg, records } = registry([slow, big], { timeoutMs: 50 });
  await assert.rejects(reg.run(guest, 'slow', {}), code('timeout'));
  await assert.rejects(reg.run(guest, 'big', {}), code('failed'));
  assert.deepEqual(records.map((r) => [r.model, r.outcome]), [['slow', 'timeout'], ['big', 'provider_error']]);
  assert.throws(() => createToolRegistry({ tools: [{ ...slow, risk: undefined }] }), /risk/);
});
