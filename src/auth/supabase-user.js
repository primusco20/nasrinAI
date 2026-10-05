import { createHash } from 'node:crypto';
import { HttpError } from '../http/errors.js';
import { readPrefs } from '../settings.js';

// Checks a Supabase Auth access token by asking Supabase Auth itself, so a
// signed-out or deleted user is refused. Good answers are remembered for a short
// time (30 s by default) to avoid a round trip on every message.
export function createSupabaseUserVerifier({ url, anonKey, fetchImpl = fetch, cacheMs = 30_000, maxEntries = 1000 }) {
  const cache = new Map();
  const keyOf = (token) => createHash('sha256').update(String(token)).digest('hex');

  async function verifyUser(token) {
    if (typeof token !== 'string' || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token) || token.length > 4096) return null;
    const key = keyOf(token);
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.user;

    let resp;
    try {
      resp = await fetchImpl(url + '/auth/v1/user', {
        headers: { apikey: anonKey, Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(5000)
      });
    } catch {
      throw new HttpError(503, 'auth_unavailable', 'Sign-in is temporarily unavailable. Please try again shortly.');
    }
    if (resp.status === 401 || resp.status === 403) return null;
    if (!resp.ok) throw new HttpError(503, 'auth_unavailable', 'Sign-in is temporarily unavailable. Please try again shortly.');

    const data = await resp.json().catch(() => null);
    if (!data || typeof data.id !== 'string') return null;
    const user = { id: data.id, prefs: readPrefs(data.user_metadata) };

    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(key, { user, until: Date.now() + cacheMs });
    return user;
  }
  // After the person changes a setting: their next request reads it fresh.
  verifyUser.forget = (token) => cache.delete(keyOf(token));
  return verifyUser;
}
