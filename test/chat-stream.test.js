import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError } from '../src/ai/provider.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { IDENTITY } from '../src/ai/output.js';
import { liveText } from '../src/chat.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN } from './helpers.js';

const OTHER = 'other.user.token';
const users = async (t) => (t === USER_TOKEN ? { id: 'user-1' } : t === OTHER ? { id: 'user-2' } : null);

async function app(provider, env = {}) {
  const built = buildTestApp({ provider, env, verifyUser: users });
  const srv = await serve(built.app);
  return { ...built, ...srv };
}

// Reads a streamed reply: the events in order.
async function streamed(url, body, token = USER_TOKEN, { abortAfter = 0 } = {}) {
  const ctrl = new AbortController();
  const resp = await fetch(url + '/v1/chat', { method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, stream: true }), signal: ctrl.signal });
  if (!(resp.headers.get('content-type') || '').includes('ndjson')) return { status: resp.status, json: await resp.json(), events: [] };
  const events = [];
  let buf = '';
  const dec = new TextDecoder();
  try {
    for await (const chunk of resp.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { events.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
      if (abortAfter && events.filter((e) => e.type === 'delta').length >= abortAfter) { ctrl.abort(); break; }
    }
  } catch (err) { if (err.name !== 'AbortError') throw err; }
  return { status: resp.status, events };
}
const textOf = (events) => events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
const until = async (check, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await new Promise((r) => setTimeout(r, 20)); } return false; };

test('live text: whole sentences, checked like the final reply, capped', () => {
  const out = [];
  const live = liveText({ onText: (t) => out.push(t), reset: () => out.push('<reset>') }, 60);
  for (const p of ['Hello', ' there.', ' I am ChatGPT,', ' made by OpenAI.', ' Bye\u0007 now.']) live.push(p);
  live.flush();
  const shown = out.join('');
  assert.match(shown, /^Hello there\./);
  assert.ok(shown.includes(IDENTITY));
  assert.doesNotMatch(shown, /ChatGPT|\u0007/);
  assert.ok(shown.length <= 60);
  live.reset();
  assert.equal(out.at(-1), '<reset>');
});

test('streaming: pieces arrive, then the saved reply; errors before the start are plain JSON', async () => {
  const a = await app(createFakeProvider({ reply: () => 'First sentence here. Second sentence follows! And a third one.' }));
  try {
    const r = await streamed(a.url, { message: 'hi' });
    assert.equal(r.status, 200);
    const done = r.events.at(-1);
    assert.equal(done.type, 'done');
    assert.deepEqual(r.events[0], { type: 'start', conversation_id: done.conversation_id, user_message_id: done.user_message_id });
    assert.ok(r.events.filter((e) => e.type === 'delta').length >= 2, 'sent in pieces');
    assert.equal(textOf(r.events).trim(), done.message.content);
    const hist = await (await fetch(a.url + '/v1/conversations/' + done.conversation_id + '/messages', { headers: bearer(USER_TOKEN) })).json();
    assert.deepEqual(hist.messages.map((m) => m.role), ['user', 'assistant']);

    const bad = await streamed(a.url, { message: '' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'invalid_message');
  } finally { await a.close(); }
});

test('streaming: a failed attempt is cleared before the next model answers', async () => {
  let n = 0;
  const flaky = {
    id: 'fake', model: 'gpt-6-luna', calls: [],
    capabilities: () => ({ local: false, dataLeavesServer: true, tools: true }),
    async generate(req) {
      n += 1;
      if (n === 1) { req.onText?.('Half an answer. '); req.onText?.('More of it. '); throw new ProviderError('unavailable', 'dropped'); }
      req.onText?.('The real answer. ');
      return { text: 'The real answer.', toolCalls: [], inputTokens: 5, outputTokens: 5, finishReason: 'stop', model: req.model };
    },
    async listModels() { return ['gpt-6-luna']; }, async healthCheck() { return true; }
  };
  const a = await app(flaky, { ROUTING: 'smart', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30) });
  try {
    const r = await streamed(a.url, { message: 'Tell me something about the history of the Philippines and its islands' });
    const types = r.events.map((e) => e.type);
    assert.ok(types.includes('reset'), types.join(','));
    const after = r.events.slice(types.lastIndexOf('reset') + 1);
    assert.equal(textOf(after).trim(), 'The real answer.');
    assert.equal(r.events.at(-1).message.content, 'The real answer.');
  } finally { await a.close(); }
});

test('Stop: what was written is kept, and the tokens still count', async () => {
  const words = Array.from({ length: 80 }, (_, i) => `Word${i}.`).join(' ');
  const a = await app(createFakeProvider({ reply: () => ({ text: words, delayMs: 15 }) }));
  try {
    const before = a.store.usage.length;
    const r = await streamed(a.url, { message: 'tell me a long story' }, USER_TOKEN, { abortAfter: 3 });
    assert.ok(r.events.length >= 3);
    assert.ok(await until(() => a.store.usage.length > before), 'usage recorded after stopping');
    const used = a.store.usage.at(-1);
    assert.ok(used.outputTokens > 0 && used.outputTokens < words.length / 4, 'partial output counted');
    const convs = await (await fetch(a.url + '/v1/conversations', { headers: bearer(USER_TOKEN) })).json();
    const hist = await (await fetch(a.url + '/v1/conversations/' + convs.conversations[0].id + '/messages', { headers: bearer(USER_TOKEN) })).json();
    const reply = hist.messages.at(-1);
    assert.equal(reply.role, 'assistant');
    assert.ok(reply.content.length > 0 && reply.content.length < words.length, 'the partial reply is saved');
  } finally { await a.close(); }
});

test('Retry, Regenerate and Edit change only the end of the person’s own conversation', async () => {
  let n = 0;
  let fail = false;
  const a = await app(createFakeProvider({ reply: () => `Answer ${++n}.`, failWith: () => (fail ? new ProviderError('unavailable', 'down') : null) }));
  const say = async (body, token = USER_TOKEN) => { const r = await postJson(a.url + '/v1/chat', body, bearer(token)); return { status: r.status, ...(await r.json()) }; };
  const messages = async (id, token = USER_TOKEN) => (await (await fetch(a.url + '/v1/conversations/' + id + '/messages', { headers: bearer(token) })).json()).messages;
  try {
    const first = await say({ message: 'Question one' });
    const id = first.conversation_id;
    // Regenerate: the last answer is replaced, the question is not repeated.
    const again = await say({ conversation_id: id, regenerate: true });
    assert.equal(again.status, 200);
    assert.deepEqual((await messages(id)).map((m) => [m.role, m.content]), [['user', 'Question one'], ['assistant', again.message.content]]);
    assert.notEqual(again.message.content, first.message.content);

    // Retry after a failure: the question was saved once, then answered.
    fail = true;
    assert.equal((await say({ conversation_id: id, message: 'Question two' })).status, 503);
    fail = false;
    const retry = await say({ conversation_id: id, regenerate: true });
    assert.equal(retry.status, 200);
    assert.deepEqual((await messages(id)).map((m) => m.content).slice(-2), ['Question two', retry.message.content]);

    // Edit: only the last question; its answer goes, the new one is answered.
    const hist = await messages(id);
    const lastQ = hist.filter((m) => m.role === 'user').at(-1);
    const firstQ = hist[0];
    assert.equal((await say({ conversation_id: id, edit_message_id: firstQ.id, message: 'Changed' })).status, 400, 'older messages cannot be edited');
    const edited = await say({ conversation_id: id, edit_message_id: lastQ.id, message: 'Question two, better' });
    assert.equal(edited.status, 200);
    const after = await messages(id);
    assert.deepEqual(after.map((m) => m.content).slice(-2), ['Question two, better', edited.message.content]);
    assert.equal(after.length, 4);

    // Someone else's conversation: not found, nothing changes.
    assert.equal((await say({ conversation_id: id, regenerate: true }, OTHER)).status, 404);
    assert.equal((await say({ conversation_id: id, edit_message_id: lastQ.id, message: 'x' }, OTHER)).status, 404);
    assert.equal((await messages(id)).length, 4);
    // Without a conversation, or with a bad id: refused.
    assert.equal((await say({ regenerate: true })).status, 400);
    assert.equal((await say({ conversation_id: id, edit_message_id: 42, message: 'x' })).status, 400);
  } finally { await a.close(); }
});

test('pictures keep their own Regenerate', async () => {
  const a = await app(createFakeProvider({ reply: () => 'ok' }));
  try {
    const conv = await a.store.createConversation({ tenantId: '00000000-0000-0000-0000-000000000001', ownerType: 'user', ownerId: 'user-1', expiresAt: null });
    await a.store.addMessage({ conversationId: conv.id, tenantId: conv.tenantId, role: 'user', content: 'Create an image: a cat' });
    await a.store.addMessage({ conversationId: conv.id, tenantId: conv.tenantId, role: 'assistant', content: '[image:abc]\nHere is your picture.' });
    const r = await postJson(a.url + '/v1/chat', { conversation_id: conv.id, regenerate: true }, bearer(USER_TOKEN));
    assert.equal(r.status, 400);
    assert.equal((await a.store.listMessages(conv.id)).length, 2, 'nothing removed');
  } finally { await a.close(); }
});
