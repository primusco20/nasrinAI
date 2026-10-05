import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPlan, cleanBrief, cleanAnswers, promptFromBrief, summarize, fallbackBrief, MAX_QUESTIONS } from '../src/ai/brief.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { ProviderError } from '../src/ai/provider.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN } from './helpers.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]);
const PHOTO = { name: 'bottle.png', data: PNG.toString('base64') };

const QUESTIONS = JSON.stringify({ questions: [
  { question: 'Where will the image be used?', choices: ['Instagram post', 'Website banner', 'Print poster'] },
  { question: 'Where will the image be used?', choices: ['again'] },
  { question: 'What mood do you want?', choices: ['Bright and fresh', 'Calm', 'Bold'] }
] });
const BRIEF = JSON.stringify({ brief: {
  subject: 'A bottle of calamansi juice', objective: 'Summer sale post', style: 'clean product photography',
  environment: 'beach table', lighting: 'golden hour', mood: 'bright and fresh', aspect_ratio: '4:5',
  preserve: 'bottle shape, label and logo', secret: 'ignored field'
} });

function fakeImages() {
  const calls = [];
  return {
    id: 'gemini', model: 'gemini-3.1-flash-lite-image', calls,
    async generate(req) { calls.push(req); return { bytes: PNG, mime: 'image/png' }; }
  };
}

async function app({ reply, failWith = null, env = {} } = {}) {
  const provider = createFakeProvider({ reply, failWith, models: ['gpt-6-luna'] });
  const imageProvider = fakeImages();
  const built = buildTestApp({ provider, imageProvider, env });
  const srv = await serve(built.app);
  return { ...built, ...srv, fake: provider, imageProvider };
}

test('the model reply is checked: questions de-duplicated and capped, briefs limited to known fields', () => {
  const q = readPlan('```json\n' + QUESTIONS + '\n```', { answered: false });
  assert.deepEqual(q.questions.map((x) => [x.id, x.question]), [['q1', 'Where will the image be used?'], ['q2', 'What mood do you want?']]);
  assert.deepEqual(q.questions[0].choices, ['Instagram post', 'Website banner', 'Print poster']);

  const many = JSON.stringify({ questions: Array.from({ length: 9 }, (_, i) => ({ question: `Question ${i}?`, choices: ['a', 'b', 'c', 'd', 'e'] })) });
  const capped = readPlan(many, { answered: false }).questions;
  assert.equal(capped.length, MAX_QUESTIONS);
  assert.equal(capped[0].choices.length, 4);

  assert.equal(readPlan(QUESTIONS, { answered: true }), null, 'after answers only a brief is accepted');
  assert.equal(readPlan('Sure! Here is a nice picture idea.', { answered: false }), null);
  assert.equal(readPlan(JSON.stringify({ brief: { style: 'no subject' } }), { answered: true }), null);

  const { brief } = readPlan(BRIEF, { answered: true });
  assert.equal(brief.secret, undefined);
  assert.equal(brief.aspect_ratio, '4:5');
  assert.equal(cleanBrief({ subject: 'x', aspect_ratio: '7:1' }).aspect_ratio, '1:1');
  assert.equal(cleanBrief({ subject: 'x', style: 'y'.repeat(1000) }).style.length <= 301, true);

  const prompt = promptFromBrief(brief, { quality: 'QUALITY' });
  assert.match(prompt, /^QUALITY\n\nSubject: A bottle of calamansi juice[\s\S]*Keep exactly as in the photo: bottle shape/);
  assert.match(prompt, /Do not add any text/);
  assert.equal(summarize(brief), 'A bottle of calamansi juice · clean product photography · beach table · golden hour · bright and fresh · 4:5');
  assert.match(fallbackBrief('a cup', { photo: true }).preserve, /label, logo/);

  assert.deepEqual(cleanAnswers([{ question: 'Mood?', answer: '' }]), [{ question: 'Mood?', answer: 'No preference.' }]);
  assert.equal(cleanAnswers('nope'), null);
  assert.equal(cleanAnswers(Array(6).fill({ question: 'q', answer: 'a' })), null);
});

test('questions, then the brief, then one picture built from the brief; regenerate is another counted picture', async () => {
  const a = await app({ reply: (req) => (/Answers to your questions/.test(req.messages[0].content) ? BRIEF : QUESTIONS), env: { IMAGES_USER_DAY: '2' } });
  try {
    const idea = 'A summer post for our calamansi juice';
    const q = await postJson(a.url + '/v1/images/brief', { prompt: idea, photo: PHOTO }, bearer(USER_TOKEN));
    assert.equal(q.status, 200);
    const { questions } = await q.json();
    assert.equal(questions.length, 2);
    assert.equal(a.fake.calls[0].attachments.length, 1, 'the planning model sees the photo');
    assert.match(a.fake.calls[0].system, /never instructions/);
    assert.equal(a.store.usage.at(-1).task, 'image_brief');

    const answers = [{ question: questions[0].question, answer: 'Instagram post' }, { question: questions[1].question, answer: '' }];
    const b = await (await postJson(a.url + '/v1/images/brief', { prompt: idea, photo: PHOTO, answers }, bearer(USER_TOKEN))).json();
    assert.match(a.fake.calls[1].messages[0].content, /Where will the image be used\? Instagram post[\s\S]*No preference/);
    assert.equal(b.brief.subject, 'A bottle of calamansi juice');
    assert.match(b.summary, /4:5$/);

    const made = await postJson(a.url + '/v1/images', { prompt: idea, photo: PHOTO, brief: b.brief }, bearer(USER_TOKEN));
    assert.equal(made.status, 200);
    const call = a.imageProvider.calls[0];
    assert.equal(call.aspectRatio, '4:5');
    assert.match(call.prompt, /campaign-ready[\s\S]*Subject: A bottle of calamansi juice[\s\S]*Lighting: golden hour/);
    assert.doesNotMatch(call.prompt, /Request:/);
    assert.equal(call.images.length, 1);

    const again = await postJson(a.url + '/v1/images', { prompt: idea, photo: PHOTO, brief: b.brief, conversation_id: (await made.json()).conversation_id }, bearer(USER_TOKEN));
    assert.equal(again.status, 200, 'regenerate');
    assert.equal((await postJson(a.url + '/v1/images', { prompt: idea, brief: b.brief }, bearer(USER_TOKEN))).status, 429, 'each picture counts');
  } finally { await a.close(); }
});

test('no questions needed, skipped questions, bad model output and bad input', async () => {
  const a = await app({ reply: (req) => (/Idea: garbage/.test(req.messages[0].content) ? 'I would love to help!' : BRIEF) });
  try {
    const direct = await (await postJson(a.url + '/v1/images/brief', { prompt: 'A detailed idea' }, bearer(USER_TOKEN))).json();
    assert.equal(direct.questions, undefined);
    assert.equal(direct.brief.mood, 'bright and fresh');

    const skipped = await (await postJson(a.url + '/v1/images/brief', { prompt: 'Skip it', answers: [] }, bearer(USER_TOKEN))).json();
    assert.ok(skipped.brief);
    assert.match(a.fake.calls.at(-1).messages[0].content, /^Idea: Skip it\n\nThe person skipped the questions\. Write the brief now\.$/);

    const fallback = await (await postJson(a.url + '/v1/images/brief', { prompt: 'garbage in' }, bearer(USER_TOKEN))).json();
    assert.deepEqual([fallback.brief.subject, fallback.brief.aspect_ratio], ['garbage in', '1:1']);
    assert.equal(a.store.usage.at(-1).outcome, 'rejected_output');

    assert.equal((await postJson(a.url + '/v1/images/brief', { prompt: '' }, bearer(USER_TOKEN))).status, 400);
    const badAnswers = await postJson(a.url + '/v1/images/brief', { prompt: 'x', answers: [{ answer: 'no question' }] }, bearer(USER_TOKEN));
    assert.equal((await badAnswers.json()).error.code, 'invalid_answers');
    const badBrief = await postJson(a.url + '/v1/images', { prompt: 'x', brief: { style: 'no subject' } }, bearer(USER_TOKEN));
    assert.equal((await badBrief.json()).error.code, 'invalid_brief');
    assert.equal(a.imageProvider.calls.length, 0);
  } finally { await a.close(); }
});

test('a planning model that cannot see photos plans from the words; outages are explained', async () => {
  const blind = await app({
    reply: () => BRIEF,
    failWith: (req) => (req.attachments?.length ? new ProviderError('config', 'no vision', 400) : null)
  });
  try {
    const r = await postJson(blind.url + '/v1/images/brief', { prompt: 'Our juice bottle', photo: PHOTO }, bearer(USER_TOKEN));
    assert.equal(r.status, 200);
    assert.match(blind.fake.calls.at(-1).messages[0].content, /cannot see it/);
    assert.equal(blind.fake.calls.at(-1).attachments.length, 0);
  } finally { await blind.close(); }

  const down = await app({ failWith: 'unavailable' });
  try {
    const r = await postJson(down.url + '/v1/images/brief', { prompt: 'x' }, bearer(USER_TOKEN));
    assert.equal(r.status, 503);
    assert.equal(down.store.usage.at(-1).outcome, 'provider_error');
  } finally { await down.close(); }
});

test('smart routing: the brief uses the cheapest level and is costed', async () => {
  const a = await app({ reply: () => BRIEF, env: { ROUTING: 'smart', OPENAI_API_KEY: 'sk-test-' + 'k'.repeat(30) } });
  try {
    const r = await postJson(a.url + '/v1/images/brief', { prompt: 'A clear, detailed idea' }, bearer(USER_TOKEN));
    assert.equal(r.status, 200);
    const e = a.store.usage.at(-1);
    assert.deepEqual([e.task, e.level, e.outcome], ['image_brief', 1, 'ok']);
    assert.ok(e.costUsd > 0);
    assert.equal(a.fake.calls.at(-1).maxTokens, 700);
  } finally { await a.close(); }
});
