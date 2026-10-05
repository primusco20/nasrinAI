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

// ---------- chat runs tools (Phase 5 step 2) ----------
import { createFakeProvider } from '../src/ai/fake.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN } from './helpers.js';

async function smartApp(reply, env = {}) {
  const provider = createFakeProvider({ models: ['gpt-6-luna'], reply });
  const built = buildTestApp({ provider, env: { ROUTING: 'smart', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30), ...env } });
  const srv = await serve(built.app);
  return { ...built, ...srv, fake: provider };
}
const ask = (a, message) => postJson(a.url + '/v1/chat', { message }, bearer(USER_TOKEN)).then((r) => r.json());

test('chat: the model asks for a tool, code runs it, the model answers with the result', async () => {
  const a = await smartApp((req) => {
    const last = req.messages.at(-1);
    if (last.role === 'tool') return `It is ${JSON.parse(last.content).result} °F.`;
    return { text: '', toolCalls: [{ id: 'c1', name: 'convert_units', arguments: '{"value":30,"from":"c","to":"f"}' }] };
  });
  try {
    const out = await ask(a, 'Convert 30 C to F please');
    assert.equal(out.message.content, 'It is 86 °F.');
    assert.equal(a.fake.calls.length, 2);
    assert.ok(a.fake.calls[0].tools.some((t) => t.function.name === 'convert_units'), 'tools offered');
    assert.deepEqual(a.fake.calls[1].messages.at(-2).toolCalls[0].name, 'convert_units');
    const u = a.store.usage;
    assert.deepEqual(u.filter((e) => e.task === 'tool').map((e) => [e.model, e.outcome]), [['convert_units', 'ok']]);
    assert.equal(u.filter((e) => e.provider === 'fake' || e.model === 'gpt-6-luna').length, 2, 'both model calls recorded');
    const again = await ask(a, 'Convert 30 C to F please');
    assert.equal(again.message.content, 'It is 86 °F.');
    assert.equal(a.fake.calls.length, 4, 'answers that used tools are not cached');
  } finally { await a.close(); }
});

test('chat: tool rounds are bounded; plain chat gets no tools; bad tool input is answered, not obeyed', async () => {
  const a = await smartApp((req) => (req.tools?.length
    ? { text: '', toolCalls: [{ id: 'x', name: 'calculate', arguments: '{"expression":"1+1","tenant_id":"other"}' }] }
    : 'Done without more tools.'));
  try {
    const out = await ask(a, 'What is 2 + 2 times 7, explain');
    assert.equal(out.message.content, 'Done without more tools.');
    assert.equal(a.fake.calls.length, 3, 'two tool rounds, then a forced answer');
    assert.equal(a.fake.calls[2].tools, undefined);
    assert.match(a.fake.calls[1].messages.at(-1).content, /unknown argument tenant_id/);
    assert.ok(a.store.usage.filter((e) => e.task === 'tool').every((e) => e.outcome === 'rejected_output'));

    await ask(a, 'hello there, how are you');
    assert.equal(a.fake.calls.at(-1).tools, undefined, 'no tools for plain chat');
  } finally { await a.close(); }

  const off = await smartApp(() => 'ok', { TOOLS_ENABLED: 'false' });
  try {
    await ask(off, 'Convert 5 km to miles');
    assert.equal(off.fake.calls[0].tools, undefined, 'TOOLS_ENABLED=false');
  } finally { await off.close(); }
});

test('OpenAI format: tools sent, tool turns converted, tool requests read and capped', async () => {
  const { createOpenAIProvider } = await import('../src/ai/openai.js');
  const sent = [];
  const p = createOpenAIProvider({ apiKey: 'sk-x', model: 'gpt-6-luna', fetchImpl: async (url, init) => {
    sent.push(JSON.parse(init.body));
    return Response.json({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [1, 2, 3, 4].map((n) => ({ id: 'c' + n, type: 'function', function: { name: 'calculate', arguments: '{"expression":"1+' + n + '"}' } })) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  } });
  const specs = [{ type: 'function', function: { name: 'calculate', parameters: { type: 'object' } } }];
  const out = await p.generate({ system: 'S', tools: specs, messages: [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c0', name: 'calculate', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'c0', content: '{"value":2}' }
  ] });
  assert.deepEqual(sent[0].tools, specs);
  assert.deepEqual(sent[0].messages[2], { role: 'assistant', content: null, tool_calls: [{ id: 'c0', type: 'function', function: { name: 'calculate', arguments: '{}' } }] });
  assert.deepEqual(sent[0].messages[3], { role: 'tool', tool_call_id: 'c0', content: '{"value":2}' });
  assert.equal(out.toolCalls.length, 3, 'at most 3 per turn');
  assert.deepEqual(out.toolCalls[0], { id: 'c1', name: 'calculate', arguments: '{"expression":"1+1"}' });
});

test('chat: a service that rejects the tool list still answers without tools', async () => {
  const { ProviderError } = await import('../src/ai/provider.js');
  const provider = createFakeProvider({ models: ['gpt-6-luna'], failWith: (req) => (req.tools ? new ProviderError('config', 'tools not supported', 400) : null), reply: () => 'Five km is about 3.1 miles.' });
  const built = buildTestApp({ provider, env: { ROUTING: 'smart', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30) } });
  const srv = await serve(built.app);
  try {
    const out = await (await postJson(srv.url + '/v1/chat', { message: 'Convert 5 km to miles' }, bearer(USER_TOKEN))).json();
    assert.equal(out.message.content, 'Five km is about 3.1 miles.');
    assert.equal(provider.calls.length, 2);
  } finally { await srv.close(); }
});

test('pending actions expire after 10 minutes', async () => {
  const { createConfirmations } = await import('../src/tools/confirm.js');
  const { createMemoryStore } = await import('../src/store/memory-store.js');
  let t = 1_000_000;
  const write = { name: 'save_note', description: 'Save a note', risk: 'write', who: ['user'], parameters: { properties: { text: { type: 'string' } }, required: ['text'] }, run: () => ({ ok: true }) };
  const reg = createToolRegistry({ tools: [write] });
  const conv = { id: 'c1' };
  const c = createConfirmations({ secret: 's', store: createMemoryStore(), tools: reg, conversations: { get: async () => conv, add: async (_, role, content) => ({ id: 'm', content }) }, logger: { info() {}, warn() {} }, now: () => t });
  const pa = await c.create(user, { name: 'save_note', args: '{"text":"hi"}', conversationId: 'c1' });
  assert.equal(pa.summary, 'Save a note — text: hi');
  t += 10 * 60_000 + 1;
  await assert.rejects(c.confirm(user, pa.token), { code: 'action_expired' });
});
