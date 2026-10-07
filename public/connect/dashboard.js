// NasrinAI Connect customer dashboard client.
// Authentication stays in the existing HttpOnly session cookie. This client
// never accepts, stores, or exposes provider credentials or secret business keys.
(() => {
  'use strict';
  // The app gives this client a function that returns the signed-in access token.
  // The refresh cookie is scoped to /v1/auth, so it is never sent to /v1/connect.
  let tokenProvider = null;
  const api = async (path, options = {}, retried = false) => {
    const headers = { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    if (tokenProvider) {
      try { headers.Authorization = 'Bearer ' + await tokenProvider(retried); } catch { /* the server answers 401 below */ }
    }
    const res = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    if (res.status === 401 && tokenProvider && !retried) return api(path, options, true);   // renew the token once
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) {
      const error = data && data.error;
      const e = new Error(error?.message || 'Connect is temporarily unavailable. Please try again.');
      e.code = error?.code || 'connect_error';
      e.status = res.status;
      throw e;
    }
    return data;
  };

  window.NasrinAIConnect = Object.freeze({
    useAuth: (provider) => { tokenProvider = typeof provider === 'function' ? provider : null; },
    sites: () => api('/v1/connect/sites'),
    analyze: (url) => api('/v1/connect/sites/analyze', { method: 'POST', body: JSON.stringify({ url }) }),
    verify: (id, token) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/verify', { method: 'POST', body: JSON.stringify({ token }) }),
    get: (id) => api('/v1/connect/sites/' + encodeURIComponent(id)),
    remove: (id) => api('/v1/connect/sites/' + encodeURIComponent(id), { method: 'DELETE' }),
    config: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/config'),
    preview: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/preview'),
    approve: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/approve', { method: 'POST' }),
    saveConfig: (id, config) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/config', { method: 'PUT', body: JSON.stringify(config) })
  });
})();
