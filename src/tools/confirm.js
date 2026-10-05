import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http/errors.js';
import { ToolError } from './registry.js';

// Confirmation for tools that change something (risk 'write' or 'money').
// The model can never confirm. When it asks for such a tool, the server makes
// a pending action instead: a signed token (HMAC-SHA256) naming the caller,
// the tool, the exact checked arguments, the conversation and an expiry
// (10 minutes). The page shows a card whose text code builds from the tool's
// declared description and the arguments, never from the model's words.
// Confirm re-checks everything (owner, tool, permissions, arguments) through
// the registry with confirmed = true, and runs it once: the token is spent in
// the shared rate counters, so it cannot be replayed on any server instance.

const TTL_MS = 10 * 60_000;
const b64 = (x) => Buffer.from(x).toString('base64url');

export function summarize(tool, args) {
  const parts = Object.entries(args).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 60)}`);
  return `${tool.description.replace(/\s*\(from [^)]*\)$/, '')}${parts.length ? ' — ' + parts.join(', ') : ''}`.slice(0, 300);
}

export function createConfirmations({ secret, store, tools, conversations, logger, now = () => Date.now() }) {
  const key = createHmac('sha256', String(secret)).update('nasrinai/tool-confirmations/v1').digest();
  const sign = (payload) => createHmac('sha256', key).update(payload).digest();
  const registryFor = (caller) => (tools.forCaller ? tools.forCaller(caller) : tools);

  function read(caller, token) {
    const [payload, mac] = String(token || '').split('.');
    if (!payload || !mac || payload.length > 6000) throw new HttpError(400, 'invalid_action', 'This request is no longer valid. Please ask again.');
    const given = Buffer.from(mac, 'base64url');
    const want = sign(payload);
    if (given.length !== want.length || !timingSafeEqual(given, want)) throw new HttpError(400, 'invalid_action', 'This request is no longer valid. Please ask again.');
    let p;
    try { p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new HttpError(400, 'invalid_action', 'This request is no longer valid. Please ask again.'); }
    if (p.t !== caller.tenantId || p.a !== caller.actor.type || p.i !== caller.actor.id) throw new HttpError(404, 'not_found', 'Not found.');
    if (!(p.e > now())) throw new HttpError(410, 'action_expired', 'This action has expired. Ask again.');
    return p;
  }

  async function spend(p) {
    const r = await store.rateHit(`act:${p.id}`, Math.ceil(TTL_MS / 1000) + 60, 1);
    if (!r.allowed) throw new HttpError(409, 'action_used', 'This action was already confirmed or cancelled.');
  }

  return {
    // A pending action for a tool call that needs confirmation.
    // args: the call's arguments (string or object), already checked by the registry.
    async create(caller, { name, args, conversationId }) {
      const reg = await registryFor(caller);
      const tool = reg.get(name);
      if (!tool) throw new Error('unknown tool');
      const parsed = typeof args === 'string' ? (args.trim() ? JSON.parse(args) : {}) : (args || {});
      const p = { v: 1, id: randomUUID(), t: caller.tenantId, a: caller.actor.type, i: caller.actor.id, n: name, g: parsed, c: conversationId, e: now() + TTL_MS };
      const payload = b64(JSON.stringify(p));
      return { token: `${payload}.${sign(payload).toString('base64url')}`, tool: name, risk: tool.risk, summary: summarize(tool, parsed), expires_at: new Date(p.e).toISOString() };
    },

    // The person tapped Confirm: run it once, add the outcome to the chat.
    async confirm(caller, token) {
      const p = read(caller, token);
      const conv = await conversations.get(caller, p.c);   // owner-checked
      await spend(p);
      const reg = await registryFor(caller);
      let result;
      try {
        result = await reg.run(caller, p.n, p.g, { confirmed: true });
      } catch (err) {
        const msg = err instanceof ToolError ? err.message : 'The action could not finish.';
        const m = await conversations.add(conv, 'assistant', `That did not go through: ${msg}`);
        logger.warn('confirmed action failed', { tool: p.n, code: err.code || 'error' });
        return { ok: false, message: { id: m.id, role: 'assistant', content: m.content } };
      }
      const ok = result?.ok !== false;
      const text = ok ? `Done: ${summarize(reg.get(p.n), p.g)}.` : `The business system did not accept it (status ${Number(result.status) || 'unknown'}).`;
      const m = await conversations.add(conv, 'assistant', text);
      logger.info('confirmed action', { tool: p.n, ok });
      return { ok, message: { id: m.id, role: 'assistant', content: m.content } };
    },

    async cancel(caller, token) {
      const p = read(caller, token);
      await spend(p);
      return { cancelled: true };
    }
  };
}
