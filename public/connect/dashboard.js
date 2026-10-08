// NasrinAI Connect customer dashboard client.
// Authentication stays in the existing HttpOnly session cookie. This client
// never accepts, stores, or exposes provider credentials or secret business keys.
(() => {
  'use strict';
  let accessTokenProvider = null;
  const api = async (path, options = {}, retried = false) => {
    const headers = { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    if (!headers.Authorization && accessTokenProvider) {
      const token = await accessTokenProvider(retried);
      if (token) headers.Authorization = 'Bearer ' + token;
    }
    const res = await fetch(path, { ...options, headers, credentials: 'same-origin' });
    if (res.status === 401 && !retried && accessTokenProvider) {
      const token = await accessTokenProvider(true);
      if (token) {
        const retryHeaders = { ...headers, Authorization: 'Bearer ' + token };
        return api(path, { ...options, headers: retryHeaders }, true);
      }
    }
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
    setAccessTokenProvider: (provider) => { accessTokenProvider = typeof provider === 'function' ? provider : null; },
    sites: () => api('/v1/connect/sites'),
    analyze: (url) => api('/v1/connect/sites/analyze', { method: 'POST', body: JSON.stringify({ url }) }),
    verify: (id, token) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/verify', { method: 'POST', body: JSON.stringify({ token }) }),
    get: (id) => api('/v1/connect/sites/' + encodeURIComponent(id)),
    remove: (id) => api('/v1/connect/sites/' + encodeURIComponent(id), { method: 'DELETE' }),
    config: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/config'),
    preview: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/preview'),
    snippet: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/snippet', { method: 'POST', body: '{}' }),
    link: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/link', { method: 'POST', body: '{}' }),
    knowledge: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/knowledge'),
    readWebsite: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/knowledge/crawl', { method: 'POST', body: '{}' }),
    forgetWebsite: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/knowledge', { method: 'DELETE' }),
    activate: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/activate', { method: 'POST', body: '{}' }),
    approve: (id) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/approve', { method: 'POST' }),
    saveConfig: (id, config) => api('/v1/connect/sites/' + encodeURIComponent(id) + '/config', { method: 'PUT', body: JSON.stringify(config) })
  });
})();
