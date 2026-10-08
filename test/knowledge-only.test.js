import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeProvider } from '../src/ai/fake.js';
import { hashSecret } from '../src/auth/keys.js';
import { KNOWLEDGE_ONLY_REPLIES } from '../src/chat.js';
import { KNOWLEDGE_ONLY_RULE } from '../src/ai/prompt.js';
import { mapTenant } from '../src/store/shape.js';
import { buildTestApp, serve, bearer, postJson, BIZ_TENANT, USER_TOKEN, PUB_KEY } from './helpers.js';

const KNOW = `nss_dddddddddd01_${'d'.repeat(48)}`;
const SERVICES = 'Starter website package costs 15,000 pesos and includes a five page site.\n\nGrowth package costs 50,000 pesos with booking and a smart chat.\n\nQuotations start with a free discovery call about your business, goals and budget.';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]).toString('base64');

async function app({ tenant = {}, env = {} } = {}) {
  const provider = createFakeProvider({ models: ['gpt-6-luna'], reply: (req) => 'ANSWER ' + req.messages.at(-1).content.slice(0, 60) });
  const built = buildTestApp({ provider, env, readLinkImpl: async (u) => ({ url: u, title: 'Outside', text: 'OUTSIDE PAGE TEXT' }) });
  built.store.addTenant({ id: BIZ_TENANT, knowledge_only: true, ...tenant });
  built.store.addApiKey({ id: 'dddddddddd01', tenant_id: BIZ_TENANT, kind: 'secret', secret_hash: hashSecret('d'.repeat(48)), scopes: ['chat', 'knowledge'] });
  const srv = await serve(built.app);
  await postJson(srv.url + '/v1/knowledge', { title: 'Services', text: SERVICES }, bearer(KNOW));
  const guest = (await (await fetch(srv.url + '/v1/guest/sessions', { method: 'POST', headers: { 'X-NasrinAI-Key': PUB_KEY, Origin: 'https://shop.example.com' } })).json()).token;
  const say = async (message, extra = {}, token = guest) => {
    const r = await postJson(srv.url + '/v1/chat', { message, ...extra }, bearer(token));
    return { status: r.status, ...(await r.json()) };
  };
  return { ...built, ...srv, fake: provider, say };
}

test('knowledge only: off-topic, greetings and thanks get fixed replies with no model call', async () => {
  const a = await app();
  try {
    const usageBefore = a.store.usage.length;
    let r = await a.say('What is the capital of France?');
    assert.equal(r.message.content, KNOWLEDGE_ONLY_REPLIES.offTopic);
    assert.equal((await a.say('hi!')).message.content, KNOWLEDGE_ONLY_REPLIES.hello);
    assert.equal((await a.say('Thank you so much')).message.content, KNOWLEDGE_ONLY_REPLIES.thanks);
    assert.equal((await a.say('salamat po')).message.content, KNOWLEDGE_ONLY_REPLIES.thanks);
    assert.equal(a.fake.calls.length, 0, 'no model call');
    assert.equal(a.store.usage.length, usageBefore, 'nothing spent');
    assert.ok(r.conversation_id, 'the conversation is kept as usual');
  } finally { await a.close(); }
});

test('knowledge only: on-topic answers use only the documents, with the rule; follow-ups and files work', async () => {
  const a = await app();
  try {
    const r = await a.say('How much is the starter website package?');
    assert.equal(r.status, 200);
    const req = a.fake.calls.at(-1);
    assert.ok(req.system.includes(KNOWLEDGE_ONLY_RULE));
    assert.match(req.messages.at(-1).content, /Starter website package costs 15,000 pesos/);

    // A follow-up with no matching words is looked up with the previous question.
    const n = a.fake.calls.length;
    await a.say('and does it include anything else?', { conversation_id: r.conversation_id });
    assert.equal(a.fake.calls.length, n + 1, 'answered, not refused');

    // A file sent for a quote is answered against the services.
    await a.say('', { attachments: [{ name: 'brief.png', data: PNG }] });
    assert.match(a.fake.calls.at(-1).messages.at(-1).content, /Growth package/);
  } finally { await a.close(); }
});

test('knowledge only: nothing from outside (links, calculations, tools, web); owner reply; others unaffected', async () => {
  const a = await app({ tenant: { off_topic_reply: 'Ask me about Nasrin’s services.' }, env: { ROUTING: 'smart', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30) } });
  try {
    assert.equal((await a.say('What is 12 * 7?')).message.content, 'Ask me about Nasrin’s services.', 'no calculator answer');
    assert.equal((await a.say('Summarize https://example.com/news')).message.content, 'Ask me about Nasrin’s services.');
    assert.equal(a.fake.calls.length, 0);

    await a.say('Is the growth package 50,000 pesos? See https://example.com/x what time is it');
    const req = a.fake.calls.at(-1);
    assert.equal(req.tools, undefined, 'no tools offered');
    assert.doesNotMatch(req.messages.at(-1).content, /OUTSIDE PAGE TEXT/, 'links are not read');

    // The platform (nasrinai.com) is unchanged: off-topic questions are answered.
    const before = a.fake.calls.length;
    const user = await a.say('What is the capital of France?', {}, USER_TOKEN);
    assert.notEqual(user.message.content, KNOWLEDGE_ONLY_REPLIES.offTopic);
    assert.equal(a.fake.calls.length, before + 1);
  } finally { await a.close(); }
});

test('tenant rows: off by default and before migration 011; reply trimmed and capped', () => {
  assert.equal(mapTenant({ id: 'x', kind: 'business', status: 'active', daily_token_limit: 1 }).knowledgeOnly, false);
  const t = mapTenant({ id: 'x', kind: 'business', status: 'active', daily_token_limit: 1, knowledge_only: true, off_topic_reply: '  ' });
  assert.deepEqual([t.knowledgeOnly, t.offTopicReply], [true, null]);
  assert.equal(mapTenant({ knowledge_only: 'yes', off_topic_reply: 'x'.repeat(900) }).offTopicReply.length, 500);
  assert.equal(mapTenant({ knowledge_only: 'yes' }).knowledgeOnly, false, 'only a real true turns it on');
});
