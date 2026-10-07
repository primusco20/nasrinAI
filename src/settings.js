import { HttpError } from './http/errors.js';

// A signed-in person's privacy preferences, kept with their sign-in account
// (Supabase Auth user metadata, under nasrin_prefs), so they follow the person
// to every device and are deleted with the account. Only known keys with the
// right type are stored. The server reads them from the person's own token on
// every request (gateway -> caller.prefs) and enforces them there; the page
// only shows them.
//
//   memory  true | false | null (not chosen yet = off). Opt-in: Nasrin proposes
//           memory notes and uses saved ones only when it is true.
//   notices { features, tips }: which optional notices to show (both on by
//           default). Security and action-needed notices always show.
//   seen    ids of notices the person closed (newest last, at most SEEN_MAX).
//   library true | false: matching parts of the person's Library may be used
//           in their chats (on unless turned off).
//   retention  null | 0 | whole days (1 to 3650): how long the person keeps their
//           stored data (chats, files, photos). null = not chosen (the usual
//           defaults: chats and files kept, pictures 30 days); 0 = keep until
//           they delete it.
export const RETENTION_MAX_DAYS = 3650;
export const DEFAULT_PREFS = Object.freeze({ memory: null, notices: Object.freeze({ features: true, tips: true }), seen: Object.freeze([]), library: true, retention: null });
export const validRetention = (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= RETENTION_MAX_DAYS);
export const NOTICE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const SEEN_MAX = 100;

export function readPrefs(metadata) {
  const raw = metadata && typeof metadata === 'object' ? metadata.nasrin_prefs : null;
  const out = { memory: null, notices: { ...DEFAULT_PREFS.notices }, seen: [], library: true, retention: null };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.memory === 'boolean') out.memory = raw.memory;
  if (typeof raw.library === 'boolean') out.library = raw.library;
  if (raw.retention !== null && raw.retention !== undefined && validRetention(raw.retention)) out.retention = raw.retention;
  if (raw.notices && typeof raw.notices === 'object') {
    for (const k of Object.keys(out.notices)) if (typeof raw.notices[k] === 'boolean') out.notices[k] = raw.notices[k];
  }
  if (Array.isArray(raw.seen)) out.seen = [...new Set(raw.seen.filter((x) => typeof x === 'string' && NOTICE_ID.test(x)))].slice(-SEEN_MAX);
  return out;
}

function cleanUpdate(body) {
  const out = {};
  if (body && typeof body === 'object' && 'memory' in body) {
    if (typeof body.memory !== 'boolean') throw new HttpError(400, 'invalid_settings', 'Use on or off.');
    out.memory = body.memory;
  }
  if (body && typeof body === 'object' && 'library' in body) {
    if (typeof body.library !== 'boolean') throw new HttpError(400, 'invalid_settings', 'Use on or off.');
    out.library = body.library;
  }
  if (body && typeof body === 'object' && 'retention' in body) {
    if (!validRetention(body.retention)) throw new HttpError(400, 'invalid_settings', `Choose a number of days from 1 to ${RETENTION_MAX_DAYS}, or keep everything until you delete it.`);
    out.retention = body.retention;
  }
  if (body && typeof body === 'object' && 'notices' in body) {
    const n = body.notices;
    if (!n || typeof n !== 'object' || Array.isArray(n)) throw new HttpError(400, 'invalid_settings', 'Use on or off.');
    const keys = Object.keys(n);
    if (!keys.length || keys.some((k) => !(k in DEFAULT_PREFS.notices) || typeof n[k] !== 'boolean')) throw new HttpError(400, 'invalid_settings', 'Use on or off.');
    out.notices = Object.fromEntries(keys.map((k) => [k, n[k]]));
  }
  if (!Object.keys(out).length) throw new HttpError(400, 'invalid_settings', 'Nothing to change.');
  return out;
}

// The full stored preferences: what the person had, with the change on top.
function merged(current, change) {
  const base = readPrefs({ nasrin_prefs: current || {} });
  return {
    memory: 'memory' in change ? change.memory : base.memory,
    notices: { ...base.notices, ...(change.notices || {}) },
    seen: change.seen || base.seen,
    library: 'library' in change ? change.library : base.library,
    retention: 'retention' in change ? change.retention : base.retention
  };
}

export function createSettings({ url, anonKey, fetchImpl = fetch, forgetToken = () => {} }) {
  return {
    get(caller) {
      if (caller.actor.type !== 'user') throw new HttpError(403, 'sign_in_required', 'Sign in to change these settings.');
      return readPrefs({ nasrin_prefs: caller.prefs || {} });
    },

    // Saved with the person's own access token: Supabase changes only that user.
    async update(caller, token, body) {
      if (caller.actor.type !== 'user') throw new HttpError(403, 'sign_in_required', 'Sign in to change these settings.');
      return save(token, merged(caller.prefs, cleanUpdate(body)));
    },

    // A notice the person closed is not shown to them again, on any device.
    async dismiss(caller, token, id) {
      if (caller.actor.type !== 'user') throw new HttpError(403, 'sign_in_required', 'Sign in to change these settings.');
      if (typeof id !== 'string' || !NOTICE_ID.test(id)) throw new HttpError(400, 'invalid_notice', 'That notice is not valid.');
      const before = readPrefs({ nasrin_prefs: caller.prefs || {} });
      if (before.seen.includes(id)) return before;
      return save(token, merged(caller.prefs, { seen: [...before.seen, id].slice(-SEEN_MAX) }));
    }
  };

  async function save(token, next) {
    let resp;
    try {
      resp = await fetchImpl(url + '/auth/v1/user', {
        method: 'PUT',
        headers: { apikey: anonKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { nasrin_prefs: next } }),
        signal: AbortSignal.timeout(5000)
      });
    } catch {
      throw new HttpError(503, 'settings_unavailable', 'Settings could not be saved right now. Please try again.');
    }
    if (resp.status === 401 || resp.status === 403) throw new HttpError(401, 'unauthenticated', 'Please sign in again.');
    if (!resp.ok) throw new HttpError(503, 'settings_unavailable', 'Settings could not be saved right now. Please try again.');
    const data = await resp.json().catch(() => null);
    forgetToken(token);
    return readPrefs(data && data.user_metadata);
  }
}
