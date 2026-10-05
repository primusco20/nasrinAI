import { createHash } from 'node:crypto';
import { HttpError } from '../http/errors.js';
import { EMAIL, pkcePair } from './supabase-auth.js';

// Sign-in routes for the chat page. The browser keeps only a short-lived
// access token in memory; the refresh token lives in an HttpOnly cookie that
// page scripts cannot read and other websites cannot send:
//   nasrin_rt    refresh token, SameSite=Strict, only sent to /v1/auth
//   nasrin_pkce  Google sign-in verifier, SameSite=Lax (the return from Google
//                is a top-level navigation), only sent to /v1/auth/google, 10 minutes
// Cookie-using routes also check that the request comes from this site.

const RT = 'nasrin_rt';
const PKCE = 'nasrin_pkce';
const MONTH = 30 * 24 * 3600;

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, { path, maxAge, sameSite }) {
  return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=${sameSite}`;
}

const setRefresh = (res, token) => res.appendHeader('Set-Cookie', cookie(RT, token, { path: '/v1/auth', maxAge: MONTH, sameSite: 'Strict' }));
const clearRefresh = (res) => res.appendHeader('Set-Cookie', cookie(RT, '', { path: '/v1/auth', maxAge: 0, sameSite: 'Strict' }));

// Browsers say where a request comes from; anything cross-site is refused.
function sameSite(req) {
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

function requireSameSite(req) {
  if (!sameSite(req)) throw new HttpError(403, 'forbidden', 'Sign in from the NasrinAI page.');
}

const emailKey = (email) => createHash('sha256').update(email).digest('hex').slice(0, 32);

function readEmail(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email)) throw new HttpError(400, 'invalid_email', 'Enter a valid email address.');
  return email;
}

const signedIn = (s) => ({ access_token: s.accessToken, expires_in: s.expiresIn, user: { email: s.user.email } });

export function authRoutes({ config, auth, limiter, logger }) {
  if (!auth) return [];
  const { limits } = config;
  const methods = config.auth;

  const routes = [
    {
      // Exchanges the refresh cookie for a new access token (and a new cookie).
      method: 'POST',
      path: '/v1/auth/refresh',
      public: true,
      handler: async ({ req, res, ip }) => {
        requireSameSite(req);
        const token = cookies(req)[RT];
        if (!token) return { status: 401, body: { error: { code: 'signed_out', message: 'Not signed in.' } } };
        await limiter.signIn(`rf:ip:${ip || 'unknown'}`, limits.signInRefreshIpHour);
        const s = await auth.refresh(token);
        if (!s) {
          clearRefresh(res);
          return { status: 401, body: { error: { code: 'signed_out', message: 'Please sign in again.' } } };
        }
        setRefresh(res, s.refreshToken);
        return { body: signedIn(s) };
      }
    },
    {
      method: 'POST',
      path: '/v1/auth/sign-out',
      public: true,
      handler: async ({ req, res }) => {
        requireSameSite(req);
        const header = String(req.headers.authorization || '');
        if (header.startsWith('Bearer ')) await auth.signOut(header.slice(7).trim());
        clearRefresh(res);
        return { body: { signed_out: true } };
      }
    }
  ];

  if (methods.email) {
    routes.push(
      {
        // Emails a sign-in code. Limited per IP and per address, so the page
        // cannot be used to flood someone's inbox.
        method: 'POST',
        path: '/v1/auth/email/start',
        public: true,
        body: true,
        handler: async ({ req, body, ip }) => {
          requireSameSite(req);
          const email = readEmail(body);
          await limiter.signIn(`code:ip:${ip || 'unknown'}`, limits.signInCodesIpHour);
          await limiter.signIn(`code:em:${emailKey(email)}`, limits.signInCodesEmailHour);
          await auth.sendCode(email);
          return { body: { sent: true } };
        }
      },
      {
        method: 'POST',
        path: '/v1/auth/email/verify',
        public: true,
        body: true,
        handler: async ({ req, res, body, ip }) => {
          requireSameSite(req);
          const email = readEmail(body);
          const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
          if (!/^\d{6,10}$/.test(code)) throw new HttpError(400, 'invalid_code', 'Enter the code from the email.');
          await limiter.signIn(`try:ip:${ip || 'unknown'}`, limits.signInTriesHour * 3);
          await limiter.signIn(`try:em:${emailKey(email)}`, limits.signInTriesHour);
          const s = await auth.verifyCode(email, code);
          setRefresh(res, s.refreshToken);
          logger.info('signed in', { method: 'email' });
          return { body: signedIn(s) };
        }
      }
    );
  }

  if (methods.google) {
    const callback = config.publicUrl + '/v1/auth/google/callback';
    const back = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };
    routes.push(
      {
        method: 'GET',
        path: '/v1/auth/google/start',
        public: true,
        handler: async ({ req, res, ip }) => {
          await limiter.signIn(`g:ip:${ip || 'unknown'}`, limits.signInCodesIpHour * 3);
          const { verifier, challenge } = pkcePair();
          res.appendHeader('Set-Cookie', cookie(PKCE, verifier, { path: '/v1/auth/google', maxAge: 600, sameSite: 'Lax' }));
          back(res, auth.googleUrl({ redirectTo: callback, challenge }));
        }
      },
      {
        method: 'GET',
        path: '/v1/auth/google/callback',
        public: true,
        handler: async ({ req, res }) => {
          const code = new URL(req.url, 'http://local').searchParams.get('code') || '';
          const verifier = cookies(req)[PKCE];
          res.appendHeader('Set-Cookie', cookie(PKCE, '', { path: '/v1/auth/google', maxAge: 0, sameSite: 'Lax' }));
          if (!code || !verifier || code.length > 512) return back(res, '/?signin=failed');
          try {
            const s = await auth.exchangeCode(code, verifier);
            setRefresh(res, s.refreshToken);
            logger.info('signed in', { method: 'google' });
            return back(res, '/?signin=ok');
          } catch (err) {
            logger.warn('google sign-in failed', { error: err.message });
            return back(res, '/?signin=failed');
          }
        }
      }
    );
  }
  return routes;
}
