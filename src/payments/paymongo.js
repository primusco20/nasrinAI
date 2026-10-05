import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { HttpError } from '../http/errors.js';

// PayMongo (GCash, Maya, cards) for Max and Ultra plans.
//
//   1. The server creates a hosted checkout (POST /v1/checkout_sessions) with
//      the plan, the price and the user in its metadata, and sends the person
//      to PayMongo's page. The browser never sees a PayMongo key.
//   2. PayMongo calls our webhook with checkout_session.payment.paid. We check
//      the Paymongo-Signature (HMAC-SHA256 of "<t>.<raw body>" with the webhook
//      secret), then read the session again from PayMongo with our secret key,
//      and only record the plan if PayMongo itself says the full amount is paid.
//   3. Each session is recorded once (its id is the payment reference).

const API = 'https://api.paymongo.com/v1';

const unavailable = () => new HttpError(503, 'payments_unavailable', 'Payments are not available right now. Please try again shortly.');

export function verifySignature(raw, header, secret, livemode) {
  if (typeof header !== 'string' || !secret) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => {
    const i = p.indexOf('=');
    return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : ['', ''];
  }));
  const given = livemode ? parts.li : parts.te;
  if (!parts.t || !/^\d{1,12}$/.test(parts.t) || !given || !/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = createHmac('sha256', secret).update(parts.t + '.').update(raw).digest();
  const got = Buffer.from(given, 'hex');
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function createPayMongo({ secretKey, webhookSecret, methods, fetchImpl = fetch, timeoutMs = 15_000 }) {
  const live = secretKey.startsWith('sk_live_');
  const auth = 'Basic ' + Buffer.from(secretKey + ':').toString('base64');

  async function call(method, path, body) {
    let resp;
    try {
      resp = await fetchImpl(API + path, {
        method,
        headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw unavailable();
    }
    const data = await resp.json().catch(() => null);
    if (!resp.ok) {
      const err = unavailable();
      err.detail = `PayMongo answered ${resp.status} for ${method} ${path.split('?')[0]}`;
      throw err;
    }
    return data;
  }

  return {
    live,

    // Returns { id, url } of a hosted checkout page.
    async createCheckout({ tenantId, userId, plan, planName, amount, days, successUrl, cancelUrl }) {
      const data = await call('POST', '/checkout_sessions', {
        data: {
          attributes: {
            line_items: [{ name: `NasrinAI ${planName}`, description: `${days} days of the ${planName} plan`, amount, currency: 'PHP', quantity: 1 }],
            payment_method_types: methods,
            description: `NasrinAI ${planName} plan, ${days} days`,
            reference_number: 'nsr_' + randomBytes(9).toString('hex'),
            send_email_receipt: true,
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: { tenant_id: tenantId, user_id: userId, plan, days: String(days), amount: String(amount) }
          }
        }
      });
      const id = data?.data?.id;
      const url = data?.data?.attributes?.checkout_url;
      if (typeof id !== 'string' || typeof url !== 'string' || !url.startsWith('https://')) throw unavailable();
      return { id, url };
    },

    // What PayMongo itself says about a checkout session.
    async readCheckout(id) {
      if (!/^cs_[A-Za-z0-9]{1,64}$/.test(String(id))) return null;
      const data = await call('GET', '/checkout_sessions/' + id);
      const a = data?.data?.attributes;
      if (!a) return null;
      const payments = Array.isArray(a.payments) ? a.payments : [];
      const paid = payments.filter((p) => p?.attributes?.status === 'paid' && p?.attributes?.currency === 'PHP');
      return {
        id,
        livemode: a.livemode === true,
        metadata: a.metadata && typeof a.metadata === 'object' ? a.metadata : {},
        paidAmount: paid.reduce((sum, p) => sum + (Number(p.attributes.amount) || 0), 0)
      };
    },

    verify(raw, header, livemode) {
      return verifySignature(raw, header, webhookSecret, livemode);
    }
  };
}
