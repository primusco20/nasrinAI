// NasrinAI Connect customer dashboard client.
// Authentication stays in the existing HttpOnly session cookie. This client
// never accepts, stores, or exposes provider credentials or secret business keys.
(() => {
  'use strict';
  const api = async (path, options = {}) => {
    const headers = { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    const res = await fetch(path, { ...options, headers, credentials: 'same-origin' });
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
    sites: () => api('/v1/connect/sites'),
    analyze: (url) => api('/v1/connect/sites/analyze', { method: 'POST', body: JSON.stringify({ url }) }),
    verify: (id, token) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/verify', { method: 'POST', body: JSON.stringify({ token }) }),
    get: (id) => api('/v1/connect/sites/' + encodeURIComponent(id)),
    remove: (id) => api('/v1/connect/sites/' + encodeURIComponent(id), { method: 'DELETE' })
  });
})();
