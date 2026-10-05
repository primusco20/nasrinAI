import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../http/errors.js';

// Signing in through Supabase Auth, called by the server only, so the page
// never talks to Supabase and its CSP stays 'self'.
//
//   Email code: POST /auth/v1/otp, then POST /auth/v1/verify (type "email")
//   Google:     /auth/v1/authorize with PKCE, then POST /auth/v1/token?grant_type=pkce
//   Refresh:    POST /auth/v1/token?grant_type=refresh_token
//   Sign out:   POST /auth/v1/logout
//
// Errors from Supabase are turned into plain messages; Supabase's own text is
// logged by the caller, never shown.

const unavailable = () => new HttpError(503, 'auth_unavailable', 'Sign-in is temporarily unavailable. Please try again shortly.');

export const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;

export function pkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// Only what the page needs: the access token and who is signed in.
function session(data) {
  if (!data || typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: Number(data.expires_in) || 3600,
    user: { id: String(data.user?.id || ''), email: String(data.user?.email || '') }
  };
}

export function createSupabaseAuth({ url, anonKey, fetchImpl = fetch, timeoutMs = 8000 }) {
  async function call(path, body, { bearer } = {}) {
    let resp;
    try {
      resp = await fetchImpl(url + '/auth/v1/' + path, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: 'Bearer ' + (bearer || anonKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw unavailable();
    }
    const data = await resp.json().catch(() => null);
    return { status: resp.status, ok: resp.ok, data };
  }

  return {
    // Sends a sign-in code by email; creates the account on first sign-in.
    async sendCode(email) {
      const r = await call('otp', { email, create_user: true });
      if (r.ok) return;
      if (r.status === 429) throw new HttpError(429, 'rate_limited', 'Too many codes were sent. Please wait a few minutes and try again.', { retryAfter: 60 });
      if (r.status >= 500) throw unavailable();
      throw new HttpError(400, 'email_not_sent', 'We could not send a code to that address. Check it and try again.');
    },

    async verifyCode(email, code) {
      const r = await call('verify', { type: 'email', email, token: code });
      const s = r.ok ? session(r.data) : null;
      if (s) return s;
      if (r.status >= 500) throw unavailable();
      throw new HttpError(400, 'invalid_code', 'That code is wrong or has expired. Ask for a new one.');
    },

    // Rotates the refresh token. Null when it is no longer valid.
    async refresh(refreshToken) {
      const r = await call('token?grant_type=refresh_token', { refresh_token: refreshToken });
      if (r.ok) return session(r.data);
      if (r.status >= 500) throw unavailable();
      return null;
    },

    googleUrl({ redirectTo, challenge }) {
      const q = new URLSearchParams({ provider: 'google', redirect_to: redirectTo, code_challenge: challenge, code_challenge_method: 's256' });
      return url + '/auth/v1/authorize?' + q;
    },

    async exchangeCode(code, verifier) {
      const r = await call('token?grant_type=pkce', { auth_code: code, code_verifier: verifier });
      const s = r.ok ? session(r.data) : null;
      if (s) return s;
      if (r.status >= 500) throw unavailable();
      throw new HttpError(400, 'sign_in_failed', 'Google sign-in did not finish. Please try again.');
    },

    // Ends the session at Supabase (all refresh tokens of this sign-in). Best effort.
    async signOut(accessToken) {
      await call('logout', {}, { bearer: accessToken }).catch(() => {});
    }
  };
}
