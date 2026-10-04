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
    },

    // Counts one hit in a shared fixed window (database function rate_hit).
    async rateHit(bucket, windowSeconds, limit) {
      const rows = await request('POST', 'rpc/rate_hit', {
        body: { p_bucket: bucket, p_window_seconds: windowSeconds, p_limit: limit }
      });
      const r = Array.isArray(rows) ? rows[0] : rows;
      if (!r || typeof r.allowed !== 'boolean') throw new UpstreamError('rate_hit returned an unexpected shape');
      return { allowed: r.allowed, used: Number(r.used), retryAfter: Number(r.retry_after) };
    },

    async tokensSince({ since, tenantId = null, actorType = null, actorId = null }) {
      const n = await request('POST', 'rpc/usage_tokens_since', {
        body: { p_since: since.toISOString(), p_tenant: tenantId, p_actor_type: actorType, p_actor_id: actorId }
      });
      const value = Number(n);
      if (!Number.isFinite(value)) throw new UpstreamError('usage_tokens_since returned an unexpected shape');
      return value;
    },

    async recordUsage(e) {
      await request('POST', 'usage_events', {
        prefer: 'return=minimal',
        body: {
          tenant_id: e.tenantId, actor_type: e.actorType, actor_id: e.actorId,
          provider: e.provider, model: e.model,
          input_tokens: e.inputTokens, output_tokens: e.outputTokens,
          latency_ms: e.latencyMs, outcome: e.outcome
        }
      });
    }
  };
}
