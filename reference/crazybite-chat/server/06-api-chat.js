// Extracted verbatim from primusco20/Crazybite @ 0f305455e9d3. Do not hand-edit the blocks between the markers.

// @@ VERBATIM server.js:2636-2756 | POST /api/chat (CHAT_ACTIONS, optionalUser, knowledge builder, system prompt, OpenAI call, output validation)
// ---------------------------------------------------------------------------
// Smart Chat — OpenAI with the shop's real data, read here, never from the
// browser. Any failure returns { reply: null } and the page's own assistant
// answers instead.
// ---------------------------------------------------------------------------
const CHAT_ACTIONS = ['menu', 'orders', 'cart', 'track', 'contact', 'callsupport', 'address', 'branch', 'order'];

async function optionalUser(req) {
  const header = req.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    const { data } = await db.auth.getUser(header.slice(7).trim());
    return data && data.user ? data.user : null;
  } catch (e) { return null; }
}

app.post('/api/chat', chatLimiter, async (req, res, next) => {
  try {
    if (!OPENAI_API_KEY) return res.json({ reply: null });
    const message = cleanText((req.body || {}).message, 500);
    if (!message) return res.status(400).json({ error: 'Say something first.' });
    const history = (Array.isArray((req.body || {}).history) ? req.body.history : []).slice(-8)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: cleanText(m.content, 600) }));

    const user = await optionalUser(req);
    const [settings, menuRes, catRes, branchRes, ordersRes] = await Promise.all([
      getSettings(),
      db.from('menu_items').select('id, name, description, price_cents, available, stock, popular, flavours, category_id').order('name'),
      db.from('categories').select('id, name, active').order('sort_order'),
      db.from('branches').select('name, address, active').eq('active', true).order('sort_order'),
      user ? db.from('orders').select('code, mode, status, total_cents, placed_at, payment_status')
        .eq('customer_id', user.id).in('status', ['pending', 'preparing', 'ready', 'out_for_delivery'])
        .eq('payment_status', 'paid').order('placed_at', { ascending: false }).limit(5) : Promise.resolve({ data: [] })
    ]);
    const cats = Object.fromEntries((catRes.data || []).map((c) => [c.id, c.name]));
    const menu = (menuRes.data || []).filter((m) => m.available);
    const liveOffers = promoOffers(settings).filter((o) => o.live && o.left > 0);
    const labels = { pending: 'waiting for the kitchen', preparing: 'being prepared', ready: 'ready', out_for_delivery: 'on the way' };

    const knowledge = [
      'MENU (id | name | category | price | status):',
      ...menu.map((m) => m.id + ' | ' + m.name + ' | ' + (cats[m.category_id] || 'Menu') + ' | ' + PESO(m.price_cents)
        + ' | ' + (m.stock > 0 ? 'available' : 'SOLD OUT') + (m.popular ? ' | most ordered' : '')
        + (m.flavours && m.flavours.length ? ' | flavours: ' + m.flavours.join(', ') : '')
        + (m.description ? ' | ' + m.description : '')),
      'SIZES: Regular +₱0, Large +₱30, XL +₱50.',
      'FEES: delivery ' + PESO(settings.delivery_fee_cents) + ' plus ' + PESO(settings.delivery_per_km_cents)
        + ' per km from the branch (max ' + settings.delivery_max_km + ' km); service fee ' + PESO(settings.service_fee_cents)
        + '. Pick-up and dine-in have no delivery fee.',
      'PAYMENT: GCash, Maya or card, paid online at checkout.',
      'BRANCHES: ' + (branchRes.data || []).map((b) => b.name + (b.address ? ' (' + b.address + ')' : '')).join('; '),
      'HOURS: ' + (settings.business_hours || 'Daily, 10 AM to 10 PM') + '. PHONE: ' + (settings.business_phone || 'see the app'),
      'REWARDS: Bronze 10, Silver 20, Gold 30, Platinum 40 completed orders in a month; Platinum gets 20% off food. Discounts do not stack.',
      settings.bpo_enabled ? 'BPO: verified BPO employees get ' + settings.bpo_discount_percent + '% off between '
        + String(settings.bpo_start_time).slice(0, 5) + ' and ' + String(settings.bpo_end_time).slice(0, 5) + ' (apply in Profile).' : '',
      liveOffers.length
        ? 'CURRENT PROMOS: ' + liveOffers.map((o) => o.title + ' (' + PESO(o.priceCents) + ': ' + o.items.map((c) => c.qty + 'x ' + (c.name || 'item')).join(' + ') + ')').join('; ')
        : 'CURRENT PROMO: none',
      user ? 'THIS CUSTOMER\'S ACTIVE ORDERS: ' + ((ordersRes.data || []).map((o) => o.code + ' (' + o.mode + ', ' + (labels[o.status] || o.status) + ', ' + PESO(o.total_cents) + ')').join('; ') || 'none')
           : 'The customer is not signed in.'
    ].filter(Boolean).join('\n');

    // Owner console > Settings > "Smart chat language". When it is on, the AI
    // detects the language of every message and answers in that same language.
    // When it is off, the original English / Filipino / Taglish behaviour is kept.
    const multi = settings.chat_multilang_enabled === true;
    const languageRule = multi
      ? 'LANGUAGE: detect the language of the customer\'s LATEST message and reply in that same language — any language '
        + '(English, Filipino, Taglish, Bisaya/Cebuano, Spanish, Japanese, Korean, Mandarin, Arabic, Hindi, etc.). '
        + 'If they mix languages, use the one they mostly write in. If the message is too short to tell (one word, a number, an emoji), '
        + 'keep the language of the earlier conversation, otherwise use English. Write the button labels in that same language too. '
        + 'The facts below are in English: translate them naturally, but never change a name, price or fact; keep menu item names exactly as listed. '
        + 'Keep every "act" value exactly as allowed below (in English). Reply warmly and briefly (1–3 sentences). '
      : 'Answer in the customer\'s language (English, Filipino or Taglish), warmly and briefly (1–3 sentences). ';
    const jsonShape = multi
      ? '{"lang": string, "reply": string, "actions": [{"label": string, "act": string}]} where lang is the BCP-47 code of the language you replied in (for example en, fil, es, ja, ar) '
      : '{"reply": string, "actions": [{"label": string, "act": string}]} ';
    const system = 'You are Nasrin, the friendly assistant of The Crazy Bite Co., a burger and chicken shop in Davao, Philippines. '
      + languageRule
      + 'Use ONLY the facts below; never invent items, prices, promos or delivery times. Prices in pesos (₱). '
      + 'If an item is SOLD OUT, say so and suggest an available one. You cannot place orders or take payment yourself; '
      + 'guide them with buttons. Reply ONLY with JSON: ' + jsonShape
      + 'with at most 4 actions. Allowed act values: ' + CHAT_ACTIONS.join(', ') + ', or "pick:<menu id>" to start ordering that exact item.\n\n'
      + knowledge;

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + OPENAI_API_KEY },
      body: JSON.stringify({
        model: OPENAI_CHAT_MODEL,
        temperature: 0.4,
        max_tokens: multi ? 600 : 350,   // non-Latin scripts use more tokens per sentence
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }].concat(history, [{ role: 'user', content: message }])
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!resp.ok) {
      console.error('[chat] OpenAI returned ' + resp.status + ': ' + (await resp.text()).slice(0, 200));
      return res.json({ reply: null });
    }
    const data = await resp.json();
    let parsed;
    try { parsed = JSON.parse(data.choices[0].message.content); } catch (e) { return res.json({ reply: null }); }
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim().slice(0, 700) : '';
    if (!reply) return res.json({ reply: null });
    const menuIds = new Set(menu.filter((m) => m.stock > 0).map((m) => m.id));
    const actions = (Array.isArray(parsed.actions) ? parsed.actions : [])
      .filter((a) => a && typeof a.label === 'string' && typeof a.act === 'string')
      .filter((a) => CHAT_ACTIONS.includes(a.act) || (a.act.startsWith('pick:') && menuIds.has(a.act.slice(5))))
      .slice(0, 4)
      .map((a) => ({ label: a.label.slice(0, 40), act: a.act }));
    const lang = multi && typeof parsed.lang === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(parsed.lang.trim())
      ? parsed.lang.trim() : undefined;
    res.json({ reply, actions, lang });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return res.json({ reply: null });
    next(err);
  }
});
// @@ END VERBATIM
