import { HttpError } from '../http/errors.js';
import { PROFESSIONS, GROUPS, BY_ID, GROUP_IDS, SAFETY, membersOf } from './professions.js';

// Professional AI: which professions shape an answer.
//
// The page sends the person's choice with each message:
//   professional: { enabled, mode, ids, groups, primary }
//     mode: automatic | single | multiple | group | all
// The server checks it (unknown ids are refused), and code (no model call)
// picks the professions this message actually needs: at most MAX_ACTIVE, the
// primary first. All of them go into ONE model call that gives one combined
// answer, so choosing many professions never multiplies the cost.
// Off (or missing): Universal AI, nothing professional is added.

export const MODES = Object.freeze(['automatic', 'single', 'multiple', 'group', 'all']);
export const MAX_ACTIVE = 3;

const bad = (msg) => new HttpError(400, 'invalid_professional', msg);

// The person's choice, checked. Returns null when Professional AI is off.
export function readSelection(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw bad('The professional choice is not valid.');
  if (raw.enabled !== true) return null;
  const mode = raw.mode === undefined ? 'automatic' : raw.mode;
  if (!MODES.includes(mode)) throw bad('Choose Automatic, one professional, several, a group or all.');
  const list = (v, max) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > max || !v.every((x) => typeof x === 'string')) throw bad('The professional choice is not valid.');
    return [...new Set(v)];
  };
  const ids = list(raw.ids, PROFESSIONS.length);
  const groups = list(raw.groups, GROUPS.length);
  for (const id of ids) if (!BY_ID.has(id)) throw bad('That professional is not available.');
  for (const g of groups) if (!GROUP_IDS.has(g)) throw bad('That group is not available.');
  const primary = raw.primary === undefined || raw.primary === null ? null : raw.primary;
  if (primary !== null && (typeof primary !== 'string' || !BY_ID.has(primary))) throw bad('That professional is not available.');
  if (mode === 'single' && ids.length !== 1) throw bad('Choose one professional.');
  if (mode === 'multiple' && ids.length < 1) throw bad('Choose at least one professional.');
  if (mode === 'group' && groups.length < 1) throw bad('Choose a group.');
  return { mode, ids, groups, primary };
}

const norm = (s) => ' ' + String(s || '').toLowerCase().replace(/[^\p{L}\p{N}%.+#-]+/gu, ' ') + ' ';

// How strongly a message points at a profession: matched words, longer
// (more specific) words count more.
export function score(profession, message) {
  const text = norm(message);
  let s = 0;
  for (const raw of profession.words) {
    const w = raw.trim();
    // Short words ("hr", "cv", "api") and words written with a trailing space
    // must stand alone; longer ones may be stems ("priorit" in "prioritise").
    const whole = w.length <= 3 || raw.endsWith(' ');
    if (whole ? text.includes(' ' + w + ' ') : text.includes(w)) s += w.length > 6 ? 2 : 1;
  }
  return s;
}

// The professions for this message. Null means Universal AI.
export function resolve(selection, message) {
  if (!selection) return null;
  const { mode, ids, groups, primary } = selection;
  let pool;
  if (mode === 'single') pool = ids;
  else if (mode === 'multiple') pool = ids;
  else if (mode === 'group') pool = [...new Set(groups.flatMap(membersOf).concat(ids))];
  else pool = PROFESSIONS.map((p) => p.id);   // automatic, all

  if (mode === 'single') return { mode, active: [ids[0]], primary: ids[0] };

  const ranked = pool.map((id) => ({ id, s: score(BY_ID.get(id), message) })).filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || pool.indexOf(a.id) - pool.indexOf(b.id));
  // Minimum necessary: a second or third profession joins only when the
  // message points at it clearly (at least 2 points and half the top score).
  const top = ranked.length ? ranked[0].s : 0;
  let active = ranked.filter((r, i) => i === 0 || r.s >= Math.max(2, top / 2)).map((r) => r.id);
  const lead = primary && pool.includes(primary) ? primary : null;
  if (lead) active = [lead, ...active.filter((id) => id !== lead)];
  // The person chose these professionals: at least one of them answers.
  if (!active.length && (mode === 'multiple' || mode === 'group')) active = [lead || pool[0]];
  active = active.slice(0, MAX_ACTIVE);
  // Automatic / all: nothing points at a profession, so Universal AI is enough.
  if (!active.length) return null;
  return { mode, active, primary: active[0] };
}

function specialty(profession, message) {
  if (!profession.specialties) return null;
  const text = norm(message);
  for (const [, name, words] of profession.specialties) {
    if (words.some((raw) => (raw.trim().length <= 3 || raw.endsWith(' ') ? text.includes(' ' + raw.trim() + ' ') : text.includes(raw)))) return name;
  }
  return null;
}

// The instructions added to the system prompt for this answer.
export function promptBlock(resolved, message) {
  if (!resolved) return '';
  const people = resolved.active.map((id) => BY_ID.get(id));
  const lines = ['Professional AI is on for this answer. Bring this expertise:'];
  for (const p of people) {
    const sp = specialty(p, message);
    lines.push(`- ${p.name}${sp && sp !== p.name ? ` (as a ${sp})` : ''}: focus on ${p.focus}. Approach: ${p.method}. A good answer gives ${p.output}.`);
  }
  if (people.length > 1) {
    lines.push('Combine these perspectives into ONE coherent answer: weigh them against each other, resolve disagreements, and give one recommendation. Do not split the answer by profession or write "the CEO says" unless the person asks for separate opinions.');
  }
  lines.push('You are still NasrinAI, applying this expertise. Do not claim to be a real person in that job, and say when a licensed or qualified professional is needed.');
  const rules = [...new Set(people.flatMap((p) => p.safety))];
  for (const r of rules) lines.push(SAFETY[r]);
  return lines.join('\n');
}
