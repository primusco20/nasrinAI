import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sensitive, checkSeeds, generate, filter, pending, build, evaluate, f1, readJsonl, writeJsonl } from '../scripts/teacher/pipeline.js';
import { createFakeProvider } from '../src/ai/fake.js';
import { loadPrices } from '../src/ai/pricing.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'teacher', 'cli.js');
const PRICES = loadPrices('{"fake":{"teacher-x":{"input":1,"output":2}}}');
const teacher = (reply) => Object.assign(createFakeProvider({ models: ['teacher-x'], reply }), { model: 'teacher-x' });

test('personal details and secrets are found', () => {
  assert.deepEqual(sensitive('How do I cook adobo?'), []);
  assert.match(sensitive('email me at ana@example.com').join(), /personal details/);
  assert.match(sensitive('call 0917 123 4567').join(), /personal details/);
  assert.match(sensitive('key sk-proj-abcdefghijklmnopqrstuvwxyz123').join(), /API key/);
  assert.match(sensitive('-----BEGIN RSA PRIVATE KEY-----').join(), /private key/);
  assert.match(sensitive('password: hunter22').join(), /password/);
});

test('seeds with personal details are refused; the teacher answers within budget; unknown price stops', async () => {
  const { ok, skipped } = checkSeeds([{ id: 's1', prompt: 'Explain inflation simply' }, { id: 's2', prompt: 'My email is a@b.co, write me a poem' }, { id: 's1', prompt: 'dup' }, { id: 'bad id!', prompt: 'x' }]);
  assert.deepEqual(ok.map((s) => s.id), ['s1']);
  assert.equal(skipped.length, 3);
  assert.match(skipped[0].reason, /personal details/);

  const t = teacher((req) => 'Inflation means prices rise over time, so money buys less. ' + req.messages[0].content);
  const many = Array.from({ length: 50 }, (_, i) => ({ id: 'q' + i, prompt: 'Question number ' + i + ' about budgeting', tags: [] }));
  const { candidates, spentUsd } = await generate({ seeds: many, teacher: t, prices: PRICES, maxUsd: 0.0005 });
  assert.ok(candidates.length > 0 && candidates.length < 50, 'stops at the budget');
  assert.ok(spentUsd >= 0.0005);
  assert.equal(candidates[0].teacher.model, 'teacher-x');
  await assert.rejects(generate({ seeds: ok, teacher: teacher(() => 'x'), prices: loadPrices(), maxUsd: 1 }), /no price on file/);
});

test('filter, review and versioned build: only approved, clean examples; never overwritten', () => {
  const rows = filter([
    { id: 'a', prompt: 'How to save money?', answer: 'Spend less than you earn and save a fixed amount each payday.' },
    { id: 'b', prompt: 'how to save money', answer: 'A different but long enough answer about saving.' },
    { id: 'c', prompt: 'Hi', answer: 'As an AI language model, I cannot help with that request.' },
    { id: 'd', prompt: 'Contact?', answer: 'Write to support@shop.example.com any time you need help.' },
    ...Array.from({ length: 40 }, (_, i) => ({ id: 'x' + i, prompt: `Tip ${i} for cooking rice`, answer: `Rinse the rice, use the right water ratio, tip ${i}.` }))
  ]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.filter]));
  assert.equal(byId.a.passed, true);
  assert.match(byId.b.reasons.join(), /repeats/);
  assert.match(byId.c.reasons.join(), /refusal/);
  assert.match(byId.d.reasons.join(), /personal details/);

  const reviews = [{ id: 'a', decision: 'approve', by: 'owner' }, ...Array.from({ length: 40 }, (_, i) => ({ id: 'x' + i, decision: i === 0 ? 'reject' : 'approve', by: 'owner' })), { id: 'x0', decision: 'approve', by: 'owner' }];
  assert.equal(pending(rows, []).length, 41);
  assert.equal(pending(rows, reviews).length, 0);

  const out = mkdtempSync(path.join(tmpdir(), 'ds-'));
  const v1 = build({ filtered: rows, reviews, name: 'nasrin-sft', outDir: out });
  assert.equal(v1.manifest.version, 1);
  assert.equal(v1.manifest.customer_data, false);
  assert.equal(v1.manifest.counts.approved, 41, 'the latest decision counts (x0 approved later)');
  assert.equal(v1.manifest.counts.train + v1.manifest.counts.eval, 41);
  const train = readJsonl(path.join(v1.dir, 'train.jsonl'));
  assert.ok(train.every((t) => t.messages.length === 2 && !/support@/.test(t.messages[1].content)));
  const v2 = build({ filtered: rows, reviews, name: 'nasrin-sft', outDir: out });
  assert.equal(v2.manifest.version, 2);
  assert.ok(existsSync(path.join(out, 'nasrin-sft', 'v1', 'manifest.json')), 'v1 kept');
  assert.deepEqual(readJsonl(path.join(v2.dir, 'eval.jsonl')).map((e) => e.id), readJsonl(path.join(v1.dir, 'eval.jsonl')).map((e) => e.id), 'same held-out ids');
  assert.throws(() => build({ filtered: rows, reviews: [], name: 'nasrin-sft', outDir: out }), /nothing approved/);
});

test('evaluation: F1 against the reference and an optional judge', async () => {
  assert.equal(f1('the cat sat', 'the cat sat'), 1);
  assert.equal(f1('dog', 'cat'), 0);
  const evalSet = [{ id: 'e1', messages: [{ role: 'user', content: 'Capital of the Philippines?' }, { role: 'assistant', content: 'Manila is the capital.' }] }];
  const model = createFakeProvider({ reply: () => 'The capital is Manila.' });
  const judge = createFakeProvider({ reply: () => '{"score": 4}' });
  const r = await evaluate({ evalSet, model, judge });
  assert.equal(r.count, 1);
  assert.ok(r.f1 > 0.5);
  assert.equal(r.judge, 4);
});

test('CLI: filter, review and build work offline in a working folder', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'teacher-'));
  mkdirSync(path.join(dir, 'data/teacher'), { recursive: true });
  writeJsonl(path.join(dir, 'data/teacher/candidates.jsonl'), [
    { id: 'k1', prompt: 'What is a budget?', answer: 'A budget is a plan for how you will spend and save your money.', teacher: { provider: 'openai', model: 'm' } },
    { id: 'k2', prompt: 'Email?', answer: 'Send it to boss@corp.example.com right away please.' }
  ]);
  const run = (...args) => execFileSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
  assert.match(run('filter'), /1 passed, 1 rejected/);
  assert.match(run('review', '--list'), /\[k1\][\s\S]*1 waiting/);
  assert.throws(() => run('review', '--reviewer', 'owner', '--approve', 'k2'), 'cannot approve a rejected example');
  assert.match(run('review', '--reviewer', 'owner', '--approve', 'k1'), /1 decisions recorded/);
  assert.match(run('build', '--name', 'test-set'), /built datasets[\\/]test-set[\\/]v1/);
  const m = JSON.parse(readFileSync(path.join(dir, 'datasets/test-set/v1/manifest.json'), 'utf8'));
  assert.deepEqual([m.counts.approved, m.reviewers, m.customer_data], [1, ['owner'], false]);
});
