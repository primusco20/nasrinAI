import { UpstreamError } from '../http/errors.js';
import { UUID } from '../tenants.js';
import { mapKey, mapTenant } from './shape.js';

const KEY_ID = /^[0-9a-f]{12}$/;

// Talks to the NasrinAI Supabase project through its REST API with the
// service-role key, the same headers supabase-js sends. Every value placed in a
// URL is validated first, so nothing a caller sends can change the query.
export function createSupabaseStore({ url, serviceKey, fetchImpl = fetch, timeoutMs = 8000 }) {
  async function request(method, path, { body, prefer } = {}) {
    const headers = {
      apikey: serviceKey,
      Authorization: 'Bearer ' + serviceKey,
      Accept: 'application/json'
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;

    let resp;
    try {
      resp = await fetchImpl(url + '/rest/v1/' + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      throw new UpstreamError('database request failed: ' + (err?.name || 'error'));
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new UpstreamError(`database answered ${resp.status} for ${method} ${path.split('?')[0]}: ${text.slice(0, 200)}`);
    }
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    kind: 'supabase',
    request,

    async getApiKey(id) {
      if (!KEY_ID.test(String(id))) return null;
      const rows = await request('GET', `api_keys?id=eq.${id}&select=id,tenant_id,kind,secret_hash,scopes,allowed_origins,revoked_at&limit=1`);
      return rows && rows[0] ? mapKey(rows[0]) : null;
    },

    async getTenant(id) {
      if (!UUID.test(String(id))) return null;
      const rows = await request('GET', `tenants?id=eq.${id}&select=id,kind,status,daily_token_limit&limit=1`);
      return rows && rows[0] ? mapTenant(rows[0]) : null;
    }
  };
}
