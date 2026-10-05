import { HttpError } from '../http/errors.js';
import { PLATFORM_TENANT_ID } from '../tenants.js';
import { planName } from '../plans.js';

// Buying a plan, and PayMongo's confirmation of the payment.
export function paymentRoutes({ config, payments, plans, store, limiter, legal = null, logger }) {
  if (!payments) return [];

  return [
    {
      // Starts a PayMongo checkout for Max or Ultra. Body: { plan }.
      method: 'POST',
      path: '/v1/plans/checkout',
      scope: 'chat',
      body: true,
      handler: async ({ caller, body }) => {
        if (caller.actor.type !== 'user') throw new HttpError(403, 'sign_in_required', 'Sign in to get a plan.');
        if (legal) await legal.require(caller);
        const plan = body.plan;
        if (plan !== 'max' && plan !== 'ultra') throw new HttpError(400, 'invalid_plan', 'Choose Max or Ultra.');
        const price = config.plans.prices[plan];
        if (!config.plans.enabled || !price) throw new HttpError(400, 'plan_not_for_sale', `${planName(plan)} is coming soon.`);
        await limiter.signIn(`pay:${caller.actor.id}`, 10);
        const days = config.plans.periodDays;
        const checkout = await payments.createCheckout({
          tenantId: caller.tenantId,
          userId: caller.actor.id,
          plan,
          planName: planName(plan),
          amount: price * 100,          // centavos
          days,
          successUrl: config.publicUrl + '/?plan=paid',
          cancelUrl: config.publicUrl + '/?plan=canceled'
        });
        logger.info('checkout started', { plan, session: checkout.id });
        return { body: { checkout_url: checkout.url } };
      }
    },
    {
      // PayMongo webhook: checkout_session.payment.paid.
      method: 'POST',
      path: '/v1/payments/paymongo',
      public: true,
      raw: true,
      maxBody: 256 * 1024,
      handler: async ({ req, raw }) => {
        let event;
        try { event = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'invalid_json', 'The request body must be JSON.'); }
        const attrs = event?.data?.attributes || {};
        const livemode = attrs.livemode === true;
        if (!payments.verify(raw, req.headers['paymongo-signature'], livemode)) {
          logger.warn('payment webhook with a bad signature');
          throw new HttpError(401, 'bad_signature', 'The signature is not valid.');
        }
        // Events for the other mode (test vs live) or of other types are acknowledged and ignored.
        if (livemode !== payments.live || attrs.type !== 'checkout_session.payment.paid') return { body: { ignored: true } };

        // Do not trust the event body: ask PayMongo for the session.
        const session = await payments.readCheckout(attrs.data?.id);
        const m = session?.metadata || {};
        const amount = Number(m.amount);
        const days = Number(m.days);
        const valid = session && session.livemode === payments.live
          && (m.plan === 'max' || m.plan === 'ultra')
          && m.tenant_id === PLATFORM_TENANT_ID
          && typeof m.user_id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(m.user_id)
          && Number.isInteger(amount) && amount > 0 && session.paidAmount >= amount
          && Number.isInteger(days) && days >= 1 && days <= 400;
        if (!valid) {
          logger.error('payment not recorded: session did not check out', { session: attrs.data?.id || null });
          return { body: { recorded: false } };
        }
        const id = await store.addPlanPeriod({
          tenantId: m.tenant_id, userId: m.user_id, plan: m.plan, days,
          provider: 'paymongo', ref: session.id, amount, currency: 'PHP'
        });
        if (plans) plans.forget({ tenantId: m.tenant_id, actor: { id: m.user_id } });
        logger.info('plan paid', { plan: m.plan, session: session.id, recorded: Boolean(id) });
        return { body: { recorded: true } };
      }
    }
  ];
}
