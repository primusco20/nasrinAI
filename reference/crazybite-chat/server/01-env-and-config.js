// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM server.js:1-36 | Header doc: every env var (OPENAI_API_KEY, OPENAI_CHAT_MODEL, OPENAI_TTS_*)
/**
 * server.js — Crazy Bite production backend (v3)
 * ===========================================================================
 * Express (runs on Vercel as a function, or anywhere Node runs), Supabase for
 * data and auth, PayMongo for payment, OpenAI for the chat and voice, Web Push
 * for phone notifications.
 *
 * The rule the whole file is built around: the browser never decides what
 * anything costs. priceOrder() reads prices, fees and discounts from the
 * database and does the arithmetic here; the order is written with the
 * service-role key. Nothing the customer posts is trusted beyond ids,
 * quantities, choices and codes. Order status is changed only through
 * POST /api/orders/:id/status, which checks who is allowed to do what.
 *
 * Required environment (Vercel > Project > Settings > Environment Variables):
 *   SUPABASE_URL                 https://xxxx.supabase.co
 *   SUPABASE_SECRET_KEY    server-side only; bypasses RLS
 *   SUPABASE_PUBLISHABLE_KEY            handed to the browser
 *   PAYMONGO_SECRET_KEY          sk_live_... / sk_test_...
 *   PAYMONGO_WEBHOOK_SECRET      whsk_... from the webhook you register
 *   APP_URL                      https://your-site.vercel.app (exact public origin)
 * Optional:
 *   OPENAI_API_KEY               enables the smart chat and the OpenAI voice
 *   OPENAI_CHAT_MODEL            default gpt-4o-mini
 *   OPENAI_TTS_VOICE / _MODEL    default coral / tts-1
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@shop.com)
 *                                phone notifications. Optional: without them the
 *                                server makes a key pair once and keeps it in
 *                                app_private_config, so push works with no setup.
 *   CRON_SECRET                  protects /api/cron/expire (Vercel Cron sends it)
 *   ROUTING_URL                  default https://router.project-osrm.org
 *   ORDER_PAYMENT_WINDOW_MIN     minutes an unpaid app order waits, default 30
 *   PEER_HOST / PEER_PORT / PEER_PATH  where the support-call broker runs
 *   EXTRA_ORIGINS                optional, comma-separated extra CORS origins
 */

// @@ END VERBATIM

// @@ VERBATIM server.js:72-72 | OPENAI_CHAT_MODEL constant
const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
// @@ END VERBATIM

// @@ VERBATIM server.js:130-130 | PESO() money formatter used in the AI knowledge text
const PESO = (cents) => '₱' + (Number(cents || 0) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// @@ END VERBATIM
