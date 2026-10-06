import { HttpError } from './http/errors.js';

// A signed-in person's privacy preferences, kept with their sign-in account
// (Supabase Auth user metadata, under nasrin_prefs), so they follow the person
// to every device and are deleted with the account. Only known keys with the
// right type are stored. The server reads them from the person's own token on
// every request (gateway -> caller.prefs) and enforces them there; the page
// only shows them.
//
//   memory  (default true)  Nasrin may propose memory notes and uses saved notes
export const DEFAULT_PREFS = Object.freeze({ memory: true });

export function readPrefs(metadata) {
  const raw = metadata && typeof metadata === 'object' ? metadata.nasrin_prefs : null;
  const out = { ...DEFAULT_PREFS };
  if (raw && typeof raw === 'object' && typeof raw.memory === 'boolean') out.memory = raw.memory;
  return out;
}

function cleanUpdate(body) {
  const out = {};
  if (body && typeof body === 'object' && 'memory' in body) {
    if (typeof body.memory !== 'boolean') throw new HttpError(400, 'invalid_settings', 'Use on or off.');
    out.memory = body.memory;
  }
  if (!Object.keys(out).length) throw new HttpError(400, 'invalid_settings', 'Nothing to change.');
  return out;
}

export function createSettings({ url, anonKey, fetchImpl = fetch, forgetToken = () => {} }) {
  return {
    get(caller) {
      if (caller.actor.type !== 'user') throw new HttpError(403, 'sign_in_required', 'Sign in to change these settings.');
      return { ...DEFAULT_PREFS, ...(caller.prefs || {}) };
    },

    // Saved with the person's own access token: Supabase changes only that user.
    async update(caller, token, body) {
      if (caller.actor.type !== 'user') throw new HttpError(403, 'sign_in_required', 'Sign in to change these settings.');
      const next = { ...DEFAULT_PREFS, ...(caller.prefs || {}), ...cleanUpdate(body) };
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
  };
}
