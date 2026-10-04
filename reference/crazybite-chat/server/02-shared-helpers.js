// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM server.js:244-270 | DEFAULT_SETTINGS + getSettings() (store settings, incl. chat_multilang_enabled)
const DEFAULT_SETTINGS = {
  delivery_fee_cents: 4900, delivery_per_km_cents: 1000, delivery_free_km: 0, delivery_max_km: 15,
  service_fee_cents: 1500, bpo_enabled: true, bpo_discount_percent: 10, bpo_start_time: '00:00', bpo_end_time: '03:00',
  payment_methods: { gcash: true, paymaya: true, card: true, cash: true }, receipt_paper_mm: 58,
  support_peer_id: 'cb-support-34045440', promo_enabled: false,
  chat_multilang_enabled: false, theme_enabled: false
};
let settingsCache = { at: 0, row: null };

// Fees and rules the owner edits in the console. Cached for 10 seconds only,
// so a change reaches the next checkout almost at once (v2 used constants,
// so console fee changes never changed what customers were charged).
async function getSettings(fresh) {
  if (!fresh && settingsCache.row && Date.now() - settingsCache.at < 10 * 1000) return settingsCache.row;
  // '*' so columns added by a later migration are picked up without a
  // redeploy, and a database that has not run it yet still works.
  const { data, error } = await db.from('store_settings').select('*').eq('id', 1).maybeSingle();
  if (error) {
    console.error('[settings] could not read store_settings: ' + error.message);
    if (settingsCache.row) return settingsCache.row;
    return Object.assign({}, DEFAULT_SETTINGS);
  }
  const row = Object.assign({}, DEFAULT_SETTINGS, data || {});
  row.payment_methods = Object.assign({}, DEFAULT_SETTINGS.payment_methods, (data && data.payment_methods) || {});
  settingsCache = { at: Date.now(), row };
  return row;
}
// @@ END VERBATIM

// @@ VERBATIM server.js:884-886 | cleanText() input sanitiser
function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}
// @@ END VERBATIM

// @@ VERBATIM server.js:1128-1162 | promoOffers() live promos fed to the AI
// The Limited Time Offers as the server sells them. Up to four can run at
// once: offer 1 lives in the promo_* columns, offers 2 to 4 in promo_extra.
// Each is on only between its start and end, at its own price, while fewer
// than its limit have been sold.
function promoOffers(settings) {
  const st = settings || {};
  const raw = [{
    slot: 1, enabled: st.promo_enabled, title: st.promo_title, image_url: st.promo_image_url,
    starts_at: st.promo_starts_at, ends_at: st.promo_ends_at, item_id: st.promo_item_id,
    price_cents: st.promo_price_cents, items: st.promo_items, limit: st.promo_limit, sold: st.promo_sold
  }].concat((Array.isArray(st.promo_extra) ? st.promo_extra : []).slice(0, 3));
  const now = Date.now();
  const out = [];
  raw.forEach((r) => {
    if (!r) return;
    const itemId = r.item_id;
    const items = (Array.isArray(r.items) ? r.items : [])
      .map((c) => ({ id: String(c && c.id || ''), qty: Math.max(1, Math.min(20, Math.floor(Number(c && c.qty) || 1))), name: String(c && c.name || '').slice(0, 80) }))
      .filter((c) => /^[0-9a-f-]{36}$/i.test(c.id));
    const priceCents = Math.round(Number(r.price_cents) || 0);
    if (!itemId || !items.length || !(priceCents > 0)) return;
    const started = !r.starts_at || new Date(r.starts_at).getTime() <= now;
    const notEnded = !r.ends_at || new Date(r.ends_at).getTime() > now;
    const title = String(r.title || '').trim() || 'Limited time offer';
    const limit = r.limit == null || r.limit === '' ? null : Math.max(0, Math.floor(Number(r.limit)));
    const left = limit == null ? 20 : Math.max(0, limit - (Number(r.sold) || 0));
    out.push({
      slot: Number(r.slot) || out.length + 1,
      itemId, items, priceCents, title, limit, left, imageUrl: String(r.image_url || ''),
      live: !!r.enabled && started && notEnded,
      lineName: (title + ' (' + items.map((c) => c.qty + '× ' + (c.name || 'item')).join(' + ') + ')').slice(0, 200)
    });
  });
  return out;
}
// @@ END VERBATIM
