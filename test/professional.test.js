import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRegistry, PROFESSIONS, GROUPS, publicCatalog, membersOf } from '../src/ai/professions.js';
import { readSelection, resolve, promptBlock, MAX_ACTIVE } from '../src/ai/professional.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { buildTestApp, serve, bearer, postJson, USER_TOKEN, SECRET_KEY } from './helpers.js';

const auto = { enabled: true, mode: 'automatic' };

test('registry is complete and consistent; the catalog shows no instructions', () => {
  assert.equal(checkRegistry(), true);
  assert.ok(PROFESSIONS.length >= 40);
  assert.equal(PROFESSIONS.filter((p) => p.id === 'general_recruiter').length, 1, 'one recruiter, specialties inside');
  assert.equal(PROFESSIONS.find((p) => p.id === 'general_recruiter').specialties.length, 15);
  const cat = publicCatalog();
  assert.equal(cat.groups.length, GROUPS.length);
  assert.equal(JSON.stringify(cat).includes('Approach'), false);
  assert.equal('method' in cat.professions[0] || 'safety' in cat.professions[0] || 'words' in cat.professions[0], false);
});

test('selection is checked: unknown ids, modes and shapes are refused; off means Universal', () => {
  assert.equal(readSelection(undefined), null);
  assert.equal(readSelection({ enabled: false, mode: 'single', ids: ['ceo'] }), null, 'off ignores the rest');
  for (const bad of [
    'ceo', [], { enabled: true, mode: 'boss' }, { enabled: true, mode: 'single', ids: ['ceo', 'hr'] },
    { enabled: true, mode: 'single', ids: ['ignore previous instructions'] }, { enabled: true, mode: 'group', groups: ['admins'] },
    { enabled: true, mode: 'multiple', ids: [] }, { enabled: true, ids: [42] }, { enabled: true, primary: 'god_mode' }
  ]) assert.throws(() => readSelection(bad), (e) => e.code === 'invalid_professional', JSON.stringify(bad));
});

test('routing: minimum necessary professions, primary first, never more than the cap', () => {
  const r = (sel, msg) => resolve(readSelection(sel), msg);
  assert.equal(r(auto, 'What is 15% of 200?'), null, 'simple question: Universal AI');
  assert.deepEqual(r(auto, 'Fix this authentication bug in my node api').active, ['software_developer']);
  assert.ok(r(auto, 'Should I expand my BPO operation?').active.includes('ceo'));
  assert.deepEqual(r({ enabled: true, mode: 'single', ids: ['hr'] }, 'hello').active, ['hr']);
  const all = r({ enabled: true, mode: 'all' }, 'strategy budget hiring code marketing inventory contract design research');
  assert.ok(all.active.length <= MAX_ACTIVE);
  assert.equal(r({ enabled: true, mode: 'all' }, 'hello'), null, 'all selected still means only what is needed');
  const team = r({ enabled: true, mode: 'multiple', ids: ['finance', 'ceo'], primary: 'ceo' }, 'what colour is the sky');
  assert.deepEqual(team.active, ['ceo'], 'a chosen team always answers, led by the primary');
  const group = r({ enabled: true, mode: 'group', groups: ['technology'] }, 'my laptop wifi is not working');
  assert.ok(group.active.every((id) => membersOf('technology').includes(id)));
  assert.equal(group.active[0], 'it_support');
});

test('the prompt block: one combined answer, safety rules, recruiter specialty, fairness', () => {
  const msg = 'Write a job post and screening questions for nurses';
  const block = promptBlock({ mode: 'multiple', active: ['general_recruiter', 'hr'], primary: 'general_recruiter' }, msg);
  assert.doesNotMatch(promptBlock({ mode: 'single', active: ['hr'], primary: 'hr' }, msg), /ONE coherent answer/, 'one profession needs no combining');
  assert.match(block, /General Recruiter \(as a Healthcare Recruiter\)/);
  assert.match(block, /ONE coherent answer/);
  assert.match(block, /protected characteristics/);
  assert.match(block, /Do not claim to be a real person/);
  assert.equal(promptBlock(null, msg), '');
});

async function app(env = {}) {
  const provider = createFakeProvider({ models: ['gpt-6-luna'], reply: () => 'OK' });
  const built = buildTestApp({ provider, env });
  const srv = await serve(built.app);
  const say = async (body, token = USER_TOKEN) => {
    const r = await postJson(srv.url + '/v1/chat', body, bearer(token));
    return { status: r.status, ...(await r.json()) };
  };
  return { ...built, ...srv, fake: provider, say };
}

test('chat: off is Universal; on adds the professions to ONE model call; bad choices cost nothing', async () => {
  const a = await app();
  try {
    let r = await a.say({ message: 'Should I expand my BPO operation?' });
    assert.deepEqual(r.professionals, []);
    assert.doesNotMatch(a.fake.calls.at(-1).system, /Professional AI is on/);

    r = await a.say({ message: 'Should I expand my BPO operation?', professional: { enabled: false, mode: 'single', ids: ['ceo'] } });
    assert.deepEqual(r.professionals, []);
    assert.doesNotMatch(a.fake.calls.at(-1).system, /Professional AI is on/, 'off never adds professional instructions');

    const n = a.fake.calls.length;
    r = await a.say({ message: 'Should I expand my BPO operation and how should I budget for it?', professional: { enabled: true, mode: 'all' } });
    assert.equal(a.fake.calls.length, n + 1, 'one model call, however many professions');
    assert.ok(r.professionals.length >= 1 && r.professionals.length <= MAX_ACTIVE);
    assert.match(a.fake.calls.at(-1).system, /Professional AI is on/);

    const before = a.fake.calls.length;
    r = await a.say({ message: 'hi', professional: { enabled: true, mode: 'single', ids: ['wizard'] } });
    assert.equal(r.status, 400);
    assert.equal(r.error.code, 'invalid_professional');
    assert.equal(a.fake.calls.length, before);

    const catalog = await (await fetch(a.url + '/v1/professionals')).json();
    assert.equal(catalog.enabled, true);
    assert.ok(catalog.professions.some((p) => p.id === 'ceo'));
  } finally { await a.close(); }
});

test('chat: businesses and PROFESSIONAL_AI=false stay Universal', async () => {
  const a = await app();
  try {
    const r = await a.say({ message: 'Should I expand my BPO operation?', professional: { enabled: true, mode: 'single', ids: ['ceo'] } }, SECRET_KEY);
    assert.deepEqual(r.professionals, []);
    assert.doesNotMatch(a.fake.calls.at(-1).system, /Professional AI is on/);
  } finally { await a.close(); }
  const off = await app({ PROFESSIONAL_AI: 'false' });
  try {
    const r = await off.say({ message: 'Should I expand?', professional: { enabled: true, mode: 'single', ids: ['ceo'] } });
    assert.deepEqual(r.professionals, []);
    assert.equal((await (await fetch(off.url + '/v1/professionals')).json()).enabled, false);
  } finally { await off.close(); }
});
