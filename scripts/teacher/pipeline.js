import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { redactForProvider } from '../../src/ai/redact.js';
import { costOf, priceOf } from '../../src/ai/pricing.js';

// The GPT teacher / dataset pipeline (Phase 8). Owner-run, offline, not part
// of the web server. Steps (each reads and writes JSON Lines files):
//
//   seeds (written by the owner) -> generate (teacher model answers)
//   -> filter (rules: personal details, secrets, refusals, length, repeats)
//   -> review (a person approves or rejects each example)
//   -> build (a numbered, never-overwritten dataset with a manifest)
//   -> evaluate (score a model on the held-out part)
//
// No customer data: there is no code path that reads conversations, seeds
// with personal details or secrets are refused, and every manifest records
// customer_data: false. Using customer data would need their explicit
// permission and a separate, reviewed change.

export const FILTER_VERSION = 'f1';
const SECRETS = [
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'an API key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'a cloud access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./, 'a token'],
  [/\b(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}/, 'a code-host token'],
  [/\bnss_[0-9a-f]{12}_[0-9a-f]{48}\b/, 'a NasrinAI key'],
  [/\bxox[abpr]-[A-Za-z0-9-]{10,}/, 'a chat-app token'],
  [/\b(?:EAA|EAAG)[A-Za-z0-9]{40,}/, 'a Facebook token'],
  [/\b(?:password|passwd|pwd)\s*[:=]\s*\S{4,}/i, 'a password']
];
const REFUSAL = /\b(as an ai(?: language model)?|i(?:'m| am) (?:not able|unable) to|i can(?:no|')t (?:help|assist|do that)|i cannot (?:help|assist|provide))\b/i;

export function sensitive(text) {
  const t = String(text);
  const reasons = [];
  if (redactForProvider(t) !== t) reasons.push('personal details (email, phone or card number)');
  for (const [re, what] of SECRETS) if (re.test(t)) reasons.push(what);
  return reasons;
}

export const sha256 = (x) => createHash('sha256').update(x).digest('hex');
export function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l, i) => {
    try { return JSON.parse(l); } catch { throw new Error(`${file}: line ${i + 1} is not JSON`); }
  });
}
export function writeJsonl(file, rows) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}
export function appendJsonl(file, rows) {
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, rows.map((r) => JSON.stringify(r) + '\n').join(''));
}

const ID = /^[A-Za-z0-9_.-]{1,80}$/;

// Seeds: { id, prompt, tags? }. Returns { ok: [...], skipped: [{ id, reason }] }.
export function checkSeeds(seeds) {
  const ok = []; const skipped = []; const seen = new Set();
  for (const s of seeds) {
    const id = String(s?.id ?? '');
    if (!ID.test(id) || seen.has(id)) { skipped.push({ id, reason: 'id missing, invalid or repeated' }); continue; }
    seen.add(id);
    if (typeof s.prompt !== 'string' || !s.prompt.trim() || s.prompt.length > 4000) { skipped.push({ id, reason: 'prompt must be 1-4000 characters' }); continue; }
    const bad = sensitive(s.prompt);
    if (bad.length) { skipped.push({ id, reason: 'contains ' + bad.join(', ') }); continue; }
    ok.push({ id, prompt: s.prompt.trim(), tags: Array.isArray(s.tags) ? s.tags.slice(0, 10).map(String) : [] });
  }
  return { ok, skipped };
}

// Asks the teacher for each seed, stopping before maxUsd. An unknown price
// stops the run (never assumed free).
export async function generate({ seeds, teacher, prices, maxUsd = 1, system = 'You are Nasrin, a warm, accurate assistant. Answer clearly and concisely.', now = () => Date.now(), log = () => {} }) {
  const price = priceOf(prices, teacher.id, teacher.model);
  if (!price) throw new Error(`no price on file for ${teacher.id}:${teacher.model}; add it to config/model-prices.json`);
  const out = []; let spent = 0;
  for (const s of seeds) {
    if (spent >= maxUsd) { log(`budget reached ($${spent.toFixed(4)}); stopped before ${s.id}`); break; }
    let r;
    try {
      r = await teacher.generate({ system, messages: [{ role: 'user', content: s.prompt }], maxTokens: 1200 });
    } catch (err) { log(`${s.id}: teacher failed (${err.kind || err.message})`); continue; }
    spent += costOf(price, r) ?? 0;
    out.push({ id: s.id, prompt: s.prompt, answer: String(r.text || '').trim(), tags: s.tags, teacher: { provider: teacher.id, model: r.model || teacher.model }, created_at: new Date(now()).toISOString() });
  }
  return { candidates: out, spentUsd: spent };
}

const norm = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The rules every example must pass before a person sees it.
export function filter(candidates) {
  const seen = new Set();
  return candidates.map((c) => {
    const reasons = [];
    const answer = String(c.answer || '');
    if (answer.length < 20) reasons.push('answer too short');
    if (answer.length > 6000) reasons.push('answer too long');
    if (REFUSAL.test(answer)) reasons.push('refusal or boilerplate');
    for (const r of sensitive(c.prompt)) reasons.push('prompt contains ' + r);
    for (const r of sensitive(answer)) reasons.push('answer contains ' + r);
    const key = sha256(norm(c.prompt));
    if (seen.has(key)) reasons.push('repeats an earlier prompt');
    seen.add(key);
    return { ...c, filter: { passed: reasons.length === 0, reasons, version: FILTER_VERSION } };
  });
}

// Review decisions are appended (never edited); the latest per id counts.
export function decisions(reviews) {
  const m = new Map();
  for (const r of reviews) if (ID.test(String(r.id)) && (r.decision === 'approve' || r.decision === 'reject')) m.set(r.id, r);
  return m;
}
export function pending(filtered, reviews) {
  const d = decisions(reviews);
  return filtered.filter((c) => c.filter?.passed && !d.has(c.id));
}

// A new dataset version: only examples that passed the filter AND were
// approved by a person. About 10% (fixed by id) is held out for evaluation.
export function build({ filtered, reviews, name, outDir, seedsHash = null, now = () => Date.now() }) {
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(name)) throw new Error('name: a-z, 0-9 and -');
  const d = decisions(reviews);
  const approved = filtered.filter((c) => c.filter?.passed && d.get(c.id)?.decision === 'approve');
  if (!approved.length) throw new Error('nothing approved yet');
  const base = path.join(outDir, name);
  mkdirSync(base, { recursive: true });
  const versions = readdirSync(base).map((v) => /^v(\d+)$/.exec(v)?.[1]).filter(Boolean).map(Number);
  const version = (versions.length ? Math.max(...versions) : 0) + 1;
  const dir = path.join(base, 'v' + version);
  mkdirSync(dir);
  const toExample = (c) => ({ messages: [{ role: 'user', content: c.prompt }, { role: 'assistant', content: c.answer }] });
  const held = (c) => parseInt(sha256('holdout:' + c.id).slice(0, 2), 16) < 26;
  const train = approved.filter((c) => !held(c)).map(toExample);
  const evalSet = approved.filter(held).map((c) => ({ id: c.id, ...toExample(c) }));
  writeJsonl(path.join(dir, 'train.jsonl'), train);
  writeJsonl(path.join(dir, 'eval.jsonl'), evalSet);
  const manifest = {
    name, version, created_at: new Date(now()).toISOString(),
    counts: { approved: approved.length, train: train.length, eval: evalSet.length, rejected_by_filter: filtered.filter((c) => !c.filter?.passed).length },
    files: { 'train.jsonl': sha256(readFileSync(path.join(dir, 'train.jsonl'))), 'eval.jsonl': sha256(readFileSync(path.join(dir, 'eval.jsonl'))) },
    teachers: [...new Set(approved.map((c) => `${c.teacher?.provider}:${c.teacher?.model}`))],
    reviewers: [...new Set(approved.map((c) => d.get(c.id).by))],
    filter_version: FILTER_VERSION,
    seeds_sha256: seedsHash,
    customer_data: false
  };
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { dir, manifest };
}

// Token-overlap F1 between a model answer and the reference.
export function f1(answer, reference) {
  const a = norm(answer).split(' ').filter(Boolean); const b = norm(reference).split(' ').filter(Boolean);
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  for (const w of b) counts.set(w, (counts.get(w) || 0) + 1);
  let same = 0;
  for (const w of a) if (counts.get(w) > 0) { same++; counts.set(w, counts.get(w) - 1); }
  if (!same) return 0;
  const p = same / a.length; const r = same / b.length;
  return (2 * p * r) / (p + r);
}

// Scores a model on the held-out set; optionally a judge model rates 1-5.
export async function evaluate({ evalSet, model, judge = null, log = () => {} }) {
  const items = [];
  for (const ex of evalSet) {
    const prompt = ex.messages.find((m) => m.role === 'user')?.content;
    const reference = ex.messages.find((m) => m.role === 'assistant')?.content;
    let answer = '';
    try { answer = String((await model.generate({ system: 'You are Nasrin, a warm, accurate assistant.', messages: [{ role: 'user', content: prompt }], maxTokens: 1200 })).text || ''); }
    catch (err) { log(`${ex.id}: model failed (${err.kind || err.message})`); }
    const item = { id: ex.id, f1: Number(f1(answer, reference).toFixed(4)) };
    if (judge && answer) {
      try {
        const j = await judge.generate({ system: 'Rate how well ANSWER answers QUESTION compared with REFERENCE, for accuracy and helpfulness. Reply with JSON only: {"score": 1-5}.',
          messages: [{ role: 'user', content: `QUESTION:\n${prompt}\n\nREFERENCE:\n${reference}\n\nANSWER:\n${answer}` }], maxTokens: 50 });
        const s = Number(/"score"\s*:\s*([1-5])/.exec(j.text || '')?.[1]);
        if (s) item.judge = s;
      } catch (err) { log(`${ex.id}: judge failed (${err.kind || err.message})`); }
    }
    items.push(item);
  }
  const mean = (k) => { const v = items.map((i) => i[k]).filter((x) => typeof x === 'number'); return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(4)) : null; };
  return { count: items.length, f1: mean('f1'), judge: mean('judge'), items };
}
