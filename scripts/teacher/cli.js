#!/usr/bin/env node
// The teacher / dataset pipeline (Phase 8), run by the owner. See docs/teacher.md.
//
//   node scripts/teacher/cli.js generate --seeds data/teacher/seeds.jsonl --model <openai model> [--max-usd 1]
//   node scripts/teacher/cli.js filter
//   node scripts/teacher/cli.js review --list
//   node scripts/teacher/cli.js review --reviewer <name> --approve id1,id2 [--reject id3]
//   node scripts/teacher/cli.js build --name nasrin-sft
//   node scripts/teacher/cli.js eval --dataset datasets/nasrin-sft/v1 --provider local|openai --model <id> [--judge <openai model>]
//
// Keys come from the environment (OPENAI_API_KEY, LOCAL_AI_URL), never flags.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createOpenAIProvider } from '../../src/ai/openai.js';
import { createLocalProvider } from '../../src/ai/local.js';
import { loadPrices } from '../../src/ai/pricing.js';
import { checkSeeds, generate, filter, pending, build, evaluate, readJsonl, writeJsonl, appendJsonl, sha256 } from './pipeline.js';

const DATA = 'data/teacher';
const FILES = { candidates: `${DATA}/candidates.jsonl`, filtered: `${DATA}/filtered.jsonl`, reviews: `${DATA}/reviews.jsonl` };

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); out[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
    else out._.push(argv[i]);
  }
  return out;
}
const fail = (m) => { console.error(m); process.exit(1); };
const openai = (model) => {
  if (!process.env.OPENAI_API_KEY) fail('OPENAI_API_KEY is not set.');
  return createOpenAIProvider({ apiKey: process.env.OPENAI_API_KEY, model });
};

const a = args(process.argv.slice(2));
const cmd = a._[0];

if (cmd === 'generate') {
  if (!a.seeds || !a.model) fail('generate needs --seeds and --model');
  const { ok, skipped } = checkSeeds(readJsonl(a.seeds));
  for (const s of skipped) console.log(`skipped ${s.id || '(no id)'}: ${s.reason}`);
  const maxUsd = Number(a['max-usd'] ?? 1);
  if (!(maxUsd > 0 && maxUsd <= 50)) fail('--max-usd: more than 0, at most 50');
  const { candidates, spentUsd } = await generate({ seeds: ok, teacher: openai(a.model), prices: loadPrices(process.env.MODEL_PRICES_JSON || ''), maxUsd, log: console.log });
  appendJsonl(FILES.candidates, candidates);
  writeFileSync(`${DATA}/seeds.sha256`, sha256(readFileSync(a.seeds)) + '\n');
  console.log(`${candidates.length} candidates added, about $${spentUsd.toFixed(4)}`);
} else if (cmd === 'filter') {
  const rows = filter(readJsonl(FILES.candidates));
  writeJsonl(FILES.filtered, rows);
  const passed = rows.filter((r) => r.filter.passed).length;
  console.log(`${passed} passed, ${rows.length - passed} rejected`);
  for (const r of rows.filter((x) => !x.filter.passed)) console.log(`  ${r.id}: ${r.filter.reasons.join('; ')}`);
} else if (cmd === 'review') {
  const filtered = readJsonl(FILES.filtered);
  const reviews = readJsonl(FILES.reviews);
  if (a.list) {
    for (const c of pending(filtered, reviews)) console.log(`\n[${c.id}]\nQ: ${c.prompt}\nA: ${c.answer}`);
    console.log(`\n${pending(filtered, reviews).length} waiting for review`);
  } else {
    if (typeof a.reviewer !== 'string' || !/^[\p{L}\p{N} ._-]{1,40}$/u.test(a.reviewer)) fail('review needs --reviewer <name>');
    const known = new Set(filtered.filter((c) => c.filter?.passed).map((c) => c.id));
    const ids = (k) => (typeof a[k] === 'string' ? a[k].split(',').map((x) => x.trim()).filter(Boolean) : []);
    const rows = [...ids('approve').map((id) => ({ id, decision: 'approve' })), ...ids('reject').map((id) => ({ id, decision: 'reject' }))];
    for (const r of rows) if (!known.has(r.id)) fail(`${r.id} is not a filtered, passed example`);
    appendJsonl(FILES.reviews, rows.map((r) => ({ ...r, by: a.reviewer, at: new Date().toISOString() })));
    console.log(`${rows.length} decisions recorded`);
  }
} else if (cmd === 'build') {
  let seedsHash = null;
  try { seedsHash = readFileSync(`${DATA}/seeds.sha256`, 'utf8').trim(); } catch { /* none */ }
  const { dir, manifest } = build({ filtered: readJsonl(FILES.filtered), reviews: readJsonl(FILES.reviews), name: String(a.name || 'nasrin-sft'), outDir: 'datasets', seedsHash });
  console.log(`built ${dir}: ${manifest.counts.train} train, ${manifest.counts.eval} eval`);
} else if (cmd === 'eval') {
  if (!a.dataset || !a.model) fail('eval needs --dataset and --model');
  const model = a.provider === 'local'
    ? createLocalProvider({ baseUrl: process.env.LOCAL_AI_URL || fail('LOCAL_AI_URL is not set.'), model: a.model, apiKey: process.env.LOCAL_AI_KEY || '' })
    : openai(a.model);
  const report = await evaluate({ evalSet: readJsonl(path.join(a.dataset, 'eval.jsonl')), model, judge: typeof a.judge === 'string' ? openai(a.judge) : null, log: console.log });
  const file = path.join(a.dataset, `report-${a.provider || 'openai'}-${a.model.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`);
  writeFileSync(file, JSON.stringify({ model: a.model, provider: a.provider || 'openai', at: new Date().toISOString(), ...report }, null, 2) + '\n');
  console.log(`${report.count} examples: F1 ${report.f1}${report.judge !== null ? `, judge ${report.judge}/5` : ''} -> ${file}`);
} else {
  console.log('Commands: generate, filter, review, build, eval. See docs/teacher.md.');
}
