// NasrinAI chat page. Plain script, no libraries, no inline code (strict CSP).
// Every message is rendered with textContent, never as HTML.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const log = $('log');
  // The message box floats over the chat; the chat keeps room for it below.
  const dock = document.querySelector('.dock');
  const fitDock = () => document.documentElement.style.setProperty('--dock-h', Math.ceil(dock.getBoundingClientRect().height) + 'px');
  if (window.ResizeObserver) new ResizeObserver(fitDock).observe(dock);
  fitDock();
  const welcome = $('welcome');
  const hero = $('hero');
  const form = $('composer');
  const input = $('input');
  const sendBtn = $('send');
  const micBtn = sendBtn;
  const notice = $('notice');
  const settingsBtn = $('settingsBtn');
  const sheet = $('settings');
  const scrim = $('scrim');
  const readAloud = $('readAloud');
  const voicesBox = $('voices');
  const modelRow = $('modelRow');
  const modelBtn = $('modelBtn');
  const modelMenu = $('modelMenu');
  const tray = $('tray');
  const attachBtn = $('attach');
  const fileInput = $('fileInput');
  // Less motion: the device asks for it, or Settings > General > Reduce motion.
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => motionQuery.matches || document.documentElement.getAttribute('data-motion') === 'reduce';
  const Nasrin = window.Nasrin;

  // localStorage holds only the guest session, the current conversation id,
  // the signed-in email (for display; the sign-in itself is an HttpOnly cookie
  // scripts cannot read) and preferences. The conversation lives on the server.
  const KEYS = {
    session: 'nasrin.session', conversation: 'nasrin.conversation', speak: 'nasrin.speak',
    model: 'nasrin.model', theme: 'nasrin.theme', voice: 'nasrin.voice', account: 'nasrin.account',
    notice: 'nasrin.notice', motion: 'nasrin.motion', pro: 'nasrin.pro', memoryAsk: 'nasrin.memoryAsk',
    notices: 'nasrin.notices', left: 'nasrin.left'
  };
  const saved = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } }
  };

  let activeAccountEmail = null;
  const identityKey = (key) => activeAccountEmail ? `${key}:${encodeURIComponent(activeAccountEmail.toLowerCase())}` : key;
  let conversationId = saved.get(identityKey(KEYS.conversation));
  let busy = false;
  let aiAvailable = true;
  let listening = false;
  // Hands-free voice conversation (see "talking with Nasrin" below).
  const vc = { on: false, state: 'idle', muted: false, recognizer: null, run: 0, silence: null, idle: null, wake: null, quick: 0, watcher: null, realtimePc: null, realtimeEvents: null, realtimeStream: null, realtimeAudio: null, realtime: false, realtimeProvider: null, realtimeMaxSeconds: 0, realtimeTimer: null, geminiState: null };

  // ---------- the character ----------

  const heroChar = Nasrin.attach(hero, { tracks: true });
  if (!reduced()) {
    hero.classList.add('is-entering');
    setTimeout(() => hero.classList.remove('is-entering'), 1300);
  }
  const markChar = Nasrin.attach($('mark'));

  // What the character returns to after a reaction.
  Nasrin.setBase(() => {
    if (vc.on) return ({ listening: 'listening', thinking: 'thinking', speaking: 'speaking' })[vc.state] || 'idle';
    if (listening) return 'listening';
    if (busy) return 'thinking';
    if (document.activeElement === input && input.value.trim()) return 'typing';
    return 'idle';
  });

  // Tap the hero: it jumps. Three quick taps: it is delighted.
  let taps = [];
  hero.addEventListener('click', () => {
    const now = Date.now();
    taps = taps.filter((t) => now - t < 1400).concat(now);
    if (taps.length >= 3) { taps = []; Nasrin.flash('happy', 1600); } else Nasrin.flash('surprised', 650);
  });

  // ---------- NasrinAI Connect dashboard ----------
  const connectLabel = $('connectLabel');
  const connectMenu = $('connectMenu');
  const openConnect = $('openConnect');
  const pageConnect = $('pageConnect');
  const connectAddForm = $('connectAddForm');
  const connectUrl = $('connectUrl');
  const connectSites = $('connectSites');
  const connectStatus = $('connectStatus');

  function connectStatusText(status) {
    return ({
      discovered: 'Discovered',
      verification_required: 'Authorization required',
      authorized: 'Authorized',
      ready: 'Ready to activate',
      installing: 'Installing',
      active: 'Active',
      paused: 'Paused',
      failed: 'Needs attention',
      removed: 'Removed'
    })[status] || status;
  }

  // The one-time code is returned only when a site is analyzed (the server keeps just a hash).
  // Hold it in memory so the card can show it; a page reload means asking for a new code.
  const connectFresh = new Map();

  // Manual install: show the one script line to paste into the business's own site,
  // then check the live site for it. Nothing is changed on the website by NasrinAI.
  function connectInstallButton(site, card, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn small';
    button.textContent = label;
    let panel = null;
    button.addEventListener('click', async () => {
      if (panel) { panel.hidden = !panel.hidden; return; }
      button.disabled = true;
      connectStatus.textContent = 'Preparing your install code…';
      try {
        const data = await window.NasrinAIConnect.snippet(site.id);
        const install = (data && data.install) || {};
        panel = document.createElement('div');
        panel.className = 'connect-actions';
        const how = document.createElement('span');
        how.className = 'setting-hint';
        how.textContent = 'Paste this line into your website, just before </head> on your home page, then publish your site. Then tap Check installation.';
        const code = document.createElement('code');
        code.className = 'connect-token';
        code.textContent = install.snippet || '';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn small outline';
        copy.textContent = 'Copy code';
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(install.snippet || ''); copy.textContent = 'Copied'; } catch { copy.textContent = 'Press and hold the code to copy'; }
        });
        panel.append(how, code, copy);
        {
          const check = document.createElement('button');
          check.type = 'button';
          check.className = 'btn small';
          check.textContent = 'Check installation';
          check.addEventListener('click', async () => {
            check.disabled = true;
            connectStatus.textContent = 'Looking for SmartChat on your website…';
            try {
              const out = await window.NasrinAIConnect.activate(site.id);
              const warnings = (out && out.installation && out.installation.warnings) || [];
              connectStatus.textContent = warnings.length
                ? warnings.map((w) => w.message).join(' ')
                : 'SmartChat is installed and nothing is blocking it.';
              if (site.status !== 'active') await loadConnectSites();
            } catch (e) { connectStatus.textContent = e.message; }
            finally { check.disabled = false; }
          });
          panel.append(check);
        }
        card.append(panel);
        connectStatus.textContent = '';
      } catch (e) { connectStatus.textContent = e.message; }
      finally { button.disabled = false; }
    });
    return button;
  }

  // Website knowledge: NasrinAI reads the verified site's public pages so SmartChat can answer
  // questions about the business. Only offered once ownership is verified.
  function connectKnowledgeButton(site) {
    const wrap = document.createElement('span');
    wrap.className = 'connect-knowledge';
    const note = document.createElement('span');
    note.className = 'connect-note';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn small outline';
    const describe = (k) => {
      if (k && k.status === 'ready') {
        button.textContent = 'Re-read my website';
        note.textContent = 'SmartChat knows ' + k.pages + (k.pages === 1 ? ' page' : ' pages') + (k.truncated ? ' (large site: the first pages only)' : '') + '.';
      } else {
        button.textContent = 'Read my website';
        note.textContent = k && k.status === 'failed' ? 'We could not read this website last time.' : 'SmartChat does not know your pages yet.';
      }
    };
    describe(null);
    window.NasrinAIConnect.knowledge(site.id).then((out) => describe(out && out.knowledge)).catch(() => {});
    button.addEventListener('click', async () => {
      button.disabled = true;
      connectStatus.textContent = 'Reading your public pages. This can take up to a minute…';
      try {
        const out = await window.NasrinAIConnect.readWebsite(site.id);
        describe(out && out.knowledge);
        connectStatus.textContent = 'Done. SmartChat can now answer questions from your website.';
      } catch (e) { connectStatus.textContent = e.message; }
      finally { button.disabled = false; }
    });
    wrap.append(button, note);
    return wrap;
  }

  // Hosted chat link: a NasrinAI chat page for this business, shared as a link or QR code.
  // No change is made to the business's website.
  function connectLinkButton(site, card) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn small outline';
    button.textContent = 'Share chat link';
    let panel = null;
    button.addEventListener('click', async () => {
      if (panel) { panel.hidden = !panel.hidden; return; }
      button.disabled = true;
      connectStatus.textContent = 'Preparing your chat link…';
      try {
        const data = await window.NasrinAIConnect.link(site.id);
        const url = data && data.link && data.link.url;
        if (!url) throw new Error('The chat link could not be created.');
        panel = document.createElement('div');
        panel.className = 'connect-actions';
        const how = document.createElement('span');
        how.className = 'setting-hint';
        how.textContent = 'Share this link, or let people scan the code. Customers can chat with your AI right away. Nothing is added to your website, so you can also put the link on your site, social pages or messages.';
        const code = document.createElement('code');
        code.className = 'connect-token';
        code.textContent = url;
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn small outline';
        copy.textContent = 'Copy link';
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied'; } catch { copy.textContent = 'Press and hold the link to copy'; }
        });
        const open = document.createElement('a');
        open.className = 'btn small outline';
        open.href = url;
        open.target = '_blank';
        open.rel = 'noopener';
        open.textContent = 'Open chat';
        panel.append(how, code, copy, open);
        if (window.NasrinQR) {
          try {
            const qr = document.createElement('img');
            qr.alt = 'QR code for your chat link';
            qr.width = 200;
            qr.height = 200;
            qr.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(window.NasrinQR.svg(url));
            panel.append(qr);
          } catch { /* the link still works without the QR code */ }
        }
        const pause = document.createElement('span');
        pause.className = 'setting-hint';
        pause.textContent = 'If you change your SmartChat settings, approve them again so the link keeps working.';
        panel.append(pause);
        card.append(panel);
        connectStatus.textContent = '';
      } catch (e) { connectStatus.textContent = e.message; }
      finally { button.disabled = false; }
    });
    return button;
  }

  function connectSiteCard(site) {
    const card = document.createElement('div');
    card.className = 'menu-card connect-site';
    card.dataset.connectId = String(site.id || '');
    const top = document.createElement('div');
    top.className = 'connect-site-top';
    const title = document.createElement('strong');
    title.textContent = site.site_host || site.site_origin;
    const status = document.createElement('span');
    status.className = 'connect-status status-' + String(site.status || '').replace(/[^a-z_]/g, '');
    status.textContent = connectStatusText(site.status);
    top.append(title, status);
    const hint = document.createElement('span');
    hint.className = 'setting-hint';
    hint.textContent = site.platform ? site.platform + ' · ' + site.site_origin : site.site_origin;
    card.append(top, hint);

    const actions = document.createElement('div');
    actions.className = 'connect-actions';

    if (site.status === 'verification_required') {
      const info = document.createElement('span');
      info.className = 'setting-hint';
      info.textContent = 'Authorization is required. Add the one-time verification value to your website, then verify it here.';
      actions.append(info);
      const verification = site.verification || connectFresh.get(String(site.id));
      const knownToken = verification && verification.token;
      if (knownToken) {
        const tag = '<meta name="nasrinai-connect" content="' + knownToken + '">';
        const how = document.createElement('span');
        how.className = 'setting-hint';
        how.textContent = 'Add this line inside the <head> of your home page and publish it, then tap Verify. Or publish the code alone as the text file /.well-known/nasrinai-connect.txt. It expires in 30 minutes; remove it after verifying.';
        const code = document.createElement('code');
        code.className = 'connect-token';
        code.textContent = tag;
        code.title = 'One-time verification value. Treat it like a secret.';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn small outline';
        copy.textContent = 'Copy tag';
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(tag); copy.textContent = 'Copied'; } catch { copy.textContent = 'Press and hold the tag to copy'; }
        });
        actions.append(how, code, copy);
      } else {
        const lost = document.createElement('span');
        lost.className = 'setting-hint';
        lost.textContent = 'The one-time code is only shown right after analyzing. Get a new one to continue.';
        actions.append(lost);
        const renew = document.createElement('button');
        renew.type = 'button';
        renew.className = 'btn small';
        renew.textContent = 'Get new code';
        renew.addEventListener('click', async () => {
          renew.disabled = true;
          connectStatus.textContent = 'Creating a new code…';
          try {
            await window.NasrinAIConnect.remove(site.id);
            const out = await window.NasrinAIConnect.analyze(site.site_origin);
            if (out && out.site && out.site.id) connectFresh.set(String(out.site.id), out.site.verification);
            connectStatus.textContent = 'New code ready. Add it to your website, then verify.';
            await loadConnectSites();
          } catch (e) { connectStatus.textContent = e.message; renew.disabled = false; }
        });
        actions.append(renew);
      }
      const verify = document.createElement('button');
      verify.type = 'button';
      verify.className = 'btn small outline';
      verify.textContent = 'Verify website';
      verify.addEventListener('click', async () => {
        const token = knownToken || window.prompt('Paste the one-time NasrinAI verification value you published on this website.');
        if (!token) return;
        verify.disabled = true;
        connectStatus.textContent = 'Checking website control…';
        try {
          await window.NasrinAIConnect.verify(site.id, token.trim());
          connectFresh.delete(String(site.id));
          connectStatus.textContent = 'Website authorized. No installation has happened.';
          await loadConnectSites();
          // Best effort: start reading the site now so SmartChat is useful straight away.
          window.NasrinAIConnect.readWebsite(site.id)
            .then(() => { connectStatus.textContent = 'Website authorized and read. SmartChat can answer from your pages.'; return loadConnectSites(); })
            .catch(() => {});
        } catch (e) { connectStatus.textContent = e.message; verify.disabled = false; }
      });
      actions.append(verify);
    } else if (site.status === 'authorized' || site.status === 'ready') {
      const configure = document.createElement('button');
      configure.type = 'button';
      configure.className = 'btn';
      configure.textContent = 'Configure SmartChat';
      configure.addEventListener('click', () => openConnectConfig(site));
      actions.append(configure);
      if (site.status === 'ready') actions.append(connectInstallButton(site, card, 'Install on website'));
      if (site.status === 'ready') actions.append(connectLinkButton(site, card));
      actions.append(connectKnowledgeButton(site));
    } else if (site.status === 'active') {
      const live = document.createElement('span');
      live.className = 'connect-live';
      live.textContent = 'SmartChat active';
      actions.append(live, connectLinkButton(site, card), connectInstallButton(site, card, 'Show install code'), connectKnowledgeButton(site));
    }

    if (site.status !== 'removed') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn small outline';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        if (!confirm('Remove this Connect website from NasrinAI?')) return;
        remove.disabled = true;
        try { await api('/v1/connect/sites/' + encodeURIComponent(site.id), { method: 'DELETE' }); await loadConnectSites(); }
        catch (e) { connectStatus.textContent = e.message; remove.disabled = false; }
      });
      actions.append(remove);
    }

    card.append(actions);
    return card;
  }

  async function loadConnectSites() {
    if (!connectSites) return;
    connectSites.replaceChildren();
    connectStatus.textContent = 'Loading your websites…';
    try {
      const data = await window.NasrinAIConnect.sites();
      const sites = Array.isArray(data?.sites) ? data.sites : [];
      if (!sites.length) {
        const empty = document.createElement('div');
        empty.className = 'menu-card connect-empty';
        empty.textContent = 'No websites connected yet. Add your website above to get started.';
        connectSites.append(empty);
      } else sites.forEach((site) => connectSites.append(connectSiteCard(site)));
      connectStatus.textContent = '';
    } catch (e) { connectStatus.textContent = e.message; }
  }

  let connectConfigSiteId = null;
  const connectConfigPage = $('pageConnectConfig');
  const connectConfigForm = $('connectConfigForm');
  const connectConfigHost = $('connectConfigHost');
  const connectConfigOrigin = $('connectConfigOrigin');
  const connectConfigStatus = $('connectConfigStatus');

  async function openConnectConfig(site) {
    if (!connectConfigPage) return;
    connectConfigSiteId = site.id;
    showPage('connectConfig');
    if (connectConfigHost) connectConfigHost.textContent = site.site_host || site.site_origin;
    if (connectConfigOrigin) connectConfigOrigin.textContent = site.platform ? site.platform + ' · ' + site.site_origin : site.site_origin;
    if (connectConfigStatus) connectConfigStatus.textContent = 'Loading configuration…';
    try {
      const data = await window.NasrinAIConnect.config(site.id);
      const cfg = data?.config?.ai_config || {};
      connectConfigForm.querySelectorAll('input[name="role"]').forEach((el) => { el.checked = Array.isArray(cfg.roles) && cfg.roles.includes(el.value); });
      $('connectTone').value = ['professional','friendly','concise','warm'].includes(cfg.tone) ? cfg.tone : 'professional';
      $('connectWelcome').value = typeof cfg.welcome === 'string' ? cfg.welcome : '';
      $('connectHandoff').checked = Boolean(cfg.human_handoff);
      if (connectConfigStatus) connectConfigStatus.textContent = '';
    } catch (e) { if (connectConfigStatus) connectConfigStatus.textContent = e.message; }
  }

  function openConnectPage() {
    if (!pageConnect) return;
    showPage('connect');
    loadConnectSites();
  }

  if (connectConfigForm) connectConfigForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!connectConfigSiteId) return;
    const roles = [...connectConfigForm.querySelectorAll('input[name="role"]:checked')].map((el) => el.value);
    if (!roles.length) { connectConfigStatus.textContent = 'Choose at least one AI role.'; return; }
    const button = connectConfigForm.querySelector('button[type="submit"]');
    button.disabled = true;
    connectConfigStatus.textContent = 'Saving configuration…';
    try {
      await window.NasrinAIConnect.saveConfig(connectConfigSiteId, {
        roles,
        tone: $('connectTone').value,
        welcome: $('connectWelcome').value,
        human_handoff: $('connectHandoff').checked
      });
      connectConfigStatus.textContent = 'Configuration saved. No website installation has happened.';
    } catch (e) { connectConfigStatus.textContent = e.message; }
    finally { button.disabled = false; }
  });

  let connectPreviewSiteId = null;
  const connectPreviewPage = $('pageConnectPreview');
  const connectPreviewRoles = $('connectPreviewRoles');
  const connectPreviewHost = $('connectPreviewHost');
  const connectPreviewOrigin = $('connectPreviewOrigin');
  const connectPreviewTone = $('connectPreviewTone');
  const connectPreviewWelcome = $('connectPreviewWelcome');
  const connectPreviewHandoff = $('connectPreviewHandoff');
  const connectPreviewEffects = $('connectPreviewEffects');

  async function openConnectPreview(siteId) {
    if (!connectPreviewPage) return;
    connectPreviewSiteId = siteId;
    showPage('connectPreview');
    const title = $('settingsTitle');
    if (title) title.textContent = 'SmartChat Preview';
    try {
      const data = await window.NasrinAIConnect.preview(siteId);
      const p = data?.preview;
      connectPreviewHost.textContent = p?.site?.host || 'SmartChat';
      connectPreviewOrigin.textContent = p?.site?.platform ? p.site.platform + ' · ' + p.site.origin : (p?.site?.origin || '');
      connectPreviewRoles.replaceChildren(...(p?.configuration?.roles || []).map((role) => {
        const el = document.createElement('span'); el.className = 'connect-preview-pill'; el.textContent = role; return el;
      }));
      connectPreviewTone.textContent = p?.configuration?.tone || 'Professional';
      connectPreviewWelcome.textContent = p?.configuration?.welcome || 'Default welcome message';
      connectPreviewHandoff.textContent = p?.configuration?.human_handoff ? 'Enabled' : 'Not enabled';
      connectPreviewEffects.replaceChildren(...(p?.effects || []).map((effect) => {
        const el = document.createElement('div'); el.className = 'setting-hint'; el.textContent = '• ' + effect; return el;
      }));
    } catch (e) {
      if (connectStatus) connectStatus.textContent = e.message;
      openConnectConfig({ id: siteId, site_host: 'Website', site_origin: '' });
    }
  }

  if (connectConfigForm) {
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.className = 'btn small outline';
    previewButton.textContent = 'Preview';
    previewButton.addEventListener('click', () => connectConfigSiteId && openConnectPreview(connectConfigSiteId));

    const approveButton = document.createElement('button');
    approveButton.type = 'button';
    approveButton.className = 'btn small outline';
    approveButton.textContent = 'Approve configuration';
    approveButton.addEventListener('click', async () => {
      if (!connectConfigSiteId) return;
      approveButton.disabled = true;
      connectConfigStatus.textContent = 'Approving the current configuration…';
      try {
        await window.NasrinAIConnect.approve(connectConfigSiteId);
        connectConfigStatus.textContent = 'Configuration approved. No website installation has happened.';
        await loadConnectSites();
      } catch (e) {
        connectConfigStatus.textContent = e.message;
      } finally {
        approveButton.disabled = false;
      }
    });

    const actions = connectConfigForm.querySelector('.connect-config-actions');
    if (actions) {
      actions.insertBefore(approveButton, actions.firstChild);
      actions.insertBefore(previewButton, actions.firstChild);
    }
  }

  const connectConfigBack = $('connectConfigBack');
  if (connectConfigBack) connectConfigBack.addEventListener('click', openConnectPage);
  const connectPreviewBack = $('connectPreviewBack');
  const connectPreviewDone = $('connectPreviewDone');
  if (connectPreviewBack) connectPreviewBack.addEventListener('click', () => connectConfigSiteId && openConnectConfig({ id: connectConfigSiteId, site_host: connectPreviewHost?.textContent || 'Website', site_origin: connectPreviewOrigin?.textContent || '' }));
  if (connectPreviewDone) connectPreviewDone.addEventListener('click', () => connectConfigSiteId && openConnectConfig({ id: connectConfigSiteId, site_host: connectPreviewHost?.textContent || 'Website', site_origin: connectPreviewOrigin?.textContent || '' }));



  if (connectAddForm) connectAddForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const url = connectUrl.value.trim();
    if (!url) return;
    const submit = connectAddForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    connectStatus.textContent = 'Analyzing your website…';
    try {
      const out = await window.NasrinAIConnect.analyze(url);
      if (out && out.site && out.site.id) connectFresh.set(String(out.site.id), out.site.verification);
      connectUrl.value = '';
      connectStatus.textContent = 'Website analyzed. Add the verification tag below to your site, then tap Verify. No installation has happened.';
      await loadConnectSites();
    } catch (e) { connectStatus.textContent = e.message; }
    finally { submit.disabled = false; }
  });

  if (openConnect) openConnect.addEventListener('click', openConnectPage);
  function showConnectForSignedIn() {
    if (!connectMenu || !connectLabel) return;
    const visible = Boolean(account);
    connectMenu.hidden = !visible;
    connectLabel.hidden = !visible;
  }

  // ---------- talking to the server ----------

  async function errorFrom(resp) {
    let message = (resp.headers.get('content-type') || '').includes('json')
      ? 'Something went wrong. Please try again.'
      : 'NasrinAI\'s server is not reachable right now. Please try again in a moment.';
    let code;
    try {
      const body = await resp.json();
      if (body && body.error && typeof body.error.message === 'string') message = body.error.message;
      code = body && body.error && body.error.code;
    } catch { /* not JSON */ }
    const err = new Error(message);
    err.status = resp.status;
    err.code = code;
    return err;
  }

  // fetch, but a dropped connection becomes a plain message (never the
  // browser's raw error text).
  async function net(url, init) {
    try { return await fetch(url, init); } catch {
      throw Object.assign(new Error('You seem to be offline. Check your connection and try again.'), { code: 'offline' });
    }
  }

  async function guestToken(fresh) {
    const s = saved.get(KEYS.session);
    if (!fresh && s && typeof s.token === 'string' && Date.parse(s.expires_at) - Date.now() > 60_000) return s.token;
    const resp = await net('/v1/guest/sessions', { method: 'POST' });
    if (!resp.ok) throw await errorFrom(resp);
    const data = await resp.json();
    saved.set(KEYS.session, { token: data.token, expires_at: data.expires_at });
    return data.token;
  }

  // Signed in: a short-lived access token kept only in memory, renewed from the
  // sign-in cookie. Otherwise: the guest session.
  let account = null;            // { email, token, until }
  let refreshing = null;

  async function refreshAccount() {
    if (!refreshing) {
      refreshing = (async () => {
        const resp = await net('/v1/auth/refresh', { method: 'POST' });
        if (resp.status === 401) {
          const was = account;
          signedOut();
          if (was) switchIdentity();
          return null;
        }
        if (!resp.ok) throw await errorFrom(resp);
        const before = account && account.email;
        const now = signedIn(await resp.json());
        // Another tab switched accounts: this tab follows, never mixing two people's chats.
        if (before && now && now.email !== before) switchIdentity();
        return now;
      })().finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  async function credential(fresh) {
    if (account) {
      if (fresh || account.until - Date.now() < 60_000) await refreshAccount();
      if (account) return account.token;
    }
    return guestToken(fresh);
  }

  // Connect uses the same short-lived user access token as the main app. The
  // refresh cookie is scoped to /v1/auth, so Connect cannot authenticate from
  // the cookie alone. Keep the token in this closure; the Connect client gets
  // only a provider callback and can request a fresh token when needed.
  if (window.NasrinAIConnect && typeof window.NasrinAIConnect.setAccessTokenProvider === 'function') {
    window.NasrinAIConnect.setAccessTokenProvider((fresh = false) => account ? credential(fresh) : null);
  }

  async function api(path, options = {}, retried = false) {
    const token = await credential(retried);
    const resp = await net(path, { ...options, headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token } });
    if (resp.status === 401 && !retried) return api(path, options, true);   // session ended: start a new one once
    if (!resp.ok) throw await errorFrom(resp);
    return resp.status === 204 ? null : resp.json();
  }

  // ---------- the conversation on screen ----------

  function scrollToEnd(el) {
    el.scrollIntoView({ block: 'end', behavior: reduced() ? 'auto' : 'smooth' });
  }

  // Leaving the empty state: the big character glides up into the header.
  function startChat() {
    if (document.body.classList.contains('has-chat')) return;
    const from = heroChar.svg.getBoundingClientRect();
    document.body.classList.add('has-chat');
    welcome.hidden = true;
    const to = markChar.svg.getBoundingClientRect();
    if (reduced() || !from.width || !to.width || !markChar.svg.animate) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const s = from.width / to.width;
    markChar.svg.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }],
      { duration: 620, easing: 'cubic-bezier(.3, 1.2, .4, 1)' }
    );
  }

  // A reply longer than this also offers to be saved as a file.
  const LONG_REPLY = 5000;
  const FILE_KINDS = { docx: 'Word document', xlsx: 'Excel spreadsheet', pdf: 'PDF', md: 'Markdown', csv: 'CSV spreadsheet', txt: 'Text file', json: 'JSON', html: 'Web page' };

  // Builds the file here in the browser and hands it to the person to save.
  async function downloadFile(file, button) {
    if (button) button.disabled = true;
    try {
      const made = await window.NasrinFiles.make(file);
      const url = URL.createObjectURL(made.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = made.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return made;
    } catch {
      notice.textContent = 'That file could not be made. Try asking Nasrin again.';
      return null;
    } finally {
      if (button) button.disabled = false;
    }
  }

  // A file Nasrin wrote for the person: name, kind, and Download.
  function fileCard(file) {
    const card = document.createElement('div');
    card.className = 'file-card';
    const ext = document.createElement('span');
    ext.className = 'file-ext';
    ext.textContent = file.ext.slice(0, 4).toUpperCase();
    const meta = document.createElement('span');
    meta.className = 'file-meta';
    const name = document.createElement('strong');
    name.textContent = file.name;
    const kind = document.createElement('small');
    kind.textContent = FILE_KINDS[file.ext] || file.ext.toUpperCase() + ' file';
    meta.append(name, kind);
    const get = document.createElement('button');
    get.type = 'button';
    get.className = 'btn small';
    get.textContent = 'Download';
    get.addEventListener('click', async () => {
      const made = await downloadFile(file, get);
      if (made) kind.textContent = (FILE_KINDS[file.ext] || file.ext.toUpperCase() + ' file') + ' · ' + window.NasrinFiles.sizeLabel(made.size);
    });
    card.append(ext, meta, get);
    return card;
  }

  // A long answer that was not written as a file: offer the same answer as one.
  function saveAsFileCard(text) {
    const card = document.createElement('div');
    card.className = 'file-card is-offer';
    const meta = document.createElement('span');
    meta.className = 'file-meta';
    const title = document.createElement('strong');
    title.textContent = 'This is a long answer';
    const hint = document.createElement('small');
    hint.textContent = 'Save it as a file to keep it';
    meta.append(title, hint);
    const buttons = document.createElement('span');
    buttons.className = 'file-buttons';
    const first = (text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || 'nasrin-answer').replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 40) || 'nasrin-answer';
    for (const [ext, label] of [['docx', 'Word'], ['pdf', 'PDF'], ['txt', 'Text']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small outline';
      b.textContent = label;
      b.addEventListener('click', () => downloadFile({ name: `${first}.${ext}`, ext, content: ext === 'txt' ? window.NasrinFormat.plain(text) : text }, b));
      buttons.appendChild(b);
    }
    card.append(meta, buttons);
    return card;
  }

  // Questions Nasrin needs answered: tap a quick answer or type, then Send answers.
  // Only the button sends (never Enter).
  function askCard(asks) {
    const card = document.createElement('div');
    card.className = 'image-card ask-card';
    const lede = document.createElement('p');
    lede.className = 'card-lede';
    lede.textContent = asks.length === 1 ? 'Your answer:' : 'Your answers:';
    card.appendChild(lede);
    const picked = asks.map(() => '');
    asks.forEach((q, i) => card.appendChild(questionBox(q, (value) => { picked[i] = value; refresh(); })));
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn small';
    go.textContent = 'Send answers';
    go.disabled = true;
    actions.appendChild(go);
    card.appendChild(actions);
    function refresh() { go.disabled = !picked.some(Boolean); }
    go.addEventListener('click', () => {
      if (busy || !picked.some(Boolean)) return;
      const text = asks.length === 1
        ? picked[0]
        : asks.map((q, i) => (picked[i] ? `• ${q.question} ${picked[i]}` : '')).filter(Boolean).join('\n');
      send(text);
    });
    return card;
  }

  function show(role, text, { animate = true, files = [], id = null, regenerate = null, asks = true } = {}) {
    startChat();
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    if (files.length) {
      const row = document.createElement('div');
      row.className = 'files';
      for (const f of files) {
        if (f.thumb) {
          const img = document.createElement('img');
          img.src = f.thumb;
          img.alt = f.name;
          row.appendChild(img);
        } else {
          const tag = document.createElement('span');
          tag.className = 'file';
          tag.textContent = f.name;
          row.appendChild(tag);
        }
      }
      el.appendChild(row);
    }
    let made = { files: [], asks: [] };
    if (role === 'assistant') {
      // Files and questions are written into the reply as blocks; the page shows them as cards.
      made = window.NasrinFiles.parse(text);
      text = made.text || (made.files.length ? 'Here is your file.' : '');
      // A picture Nasrin made: "[image:<id>]" on the first line.
      const pic = /^\[image:([0-9a-f-]{36})\]\s*/.exec(text);
      if (pic) {
        el.appendChild(imageFigure(pic[1], regenerate));
        text = text.slice(pic[0].length) || 'Here is your picture.';
      }
      const body = document.createElement('div');
      body.className = 'msg-body rich';
      const { node, blocks } = window.NasrinFormat.render(text);
      body.appendChild(node);
      // Blocks fade in one after another (headings, paragraphs, lists, code).
      if (animate && !reduced()) blocks.forEach((b, i) => { b.classList.add('reveal'); b.style.setProperty('--d', Math.min(i, 12) * 70 + 'ms'); });
      el.appendChild(body);
      for (const f of made.files) el.appendChild(fileCard(f));
      if (!made.files.length && text.length > LONG_REPLY) el.appendChild(saveAsFileCard(text));
      if (asks && made.asks.length) el.appendChild(askCard(made.asks));
      el.appendChild(replyActions(text, id));
    } else if (text) {
      el.appendChild(document.createTextNode(text));
    }
    if (id) el.dataset.id = id;
    if (role === 'user') el.dataset.text = text;
    log.appendChild(el);
    scrollToEnd(el);
    return el;
  }

  // The reply appears word by word, quickly: the whole text in under a second.
  // Words are text nodes inside spans (never HTML); a screen reader gets it all at once.


  function showThinking(text = 'Thinking') {
    const row = document.createElement('div');
    row.className = 'thinking';
    row.setAttribute('role', 'status');
    const mini = document.createElement('span');
    mini.className = 'mini';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = text;
    row.append(mini, label);
    log.appendChild(row);
    const ch = Nasrin.attach(mini);
    scrollToEnd(row);
    return { remove() { ch.remove(); row.remove(); } };
  }

  function clearScreen() {
    // Leaving this chat: a reply still being written is stopped, an edit dropped.
    if (turn) turn.ctrl.abort();
    if (editing) cancelEdit();
    for (const el of [...log.children]) if (el !== welcome) el.remove();
    welcome.hidden = false;
    document.body.classList.remove('has-chat');
  }

  function refreshSendButton() {
    // While a reply is being written the button is Stop.
    const stopping = Boolean(turn);
    sendBtn.classList.toggle('is-stop', stopping);
    const hasText = Boolean(input.value.trim() || pending.length);
    sendBtn.classList.toggle('has-text', hasText || stopping);
    sendBtn.title = stopping ? 'Stop' : hasText ? 'Send' : 'Dictate';
    sendBtn.setAttribute('aria-label', stopping ? 'Stop the reply' : hasText ? 'Send message' : 'Dictate message');
    sendBtn.disabled = !stopping && (busy || !aiAvailable || preparing > 0 || (!hasText && !Recognition));
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 176) + 'px';
    refreshSendButton();
  }

  // ---------- photos and files ----------

  // Files wait in the tray until sent: { name, type, data (base64), bytes, thumb? }.
  const MAX_FILES = 4;
  const MAX_TOTAL = 3 * 1024 * 1024;
  const MAX_SIDE = 1600;              // photos are shrunk to this before upload
  let pending = [];
  let preparing = 0;

  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });

  // Draws the photo smaller as a JPEG: quicker to send, and it drops the
  // photo's hidden details (location, camera) along the way.
  async function shrinkPhoto(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.85));
  }

  function renderTray() {
    tray.replaceChildren(...pending.map((f, i) => {
      const chip = document.createElement('div');
      chip.className = 'chip ' + (f.thumb ? 'photo' : 'doc');
      if (f.thumb) {
        const img = document.createElement('img');
        img.src = f.thumb;
        img.alt = f.name;
        chip.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.className = 'doc-icon';
        icon.textContent = (f.name.split('.').pop() || 'file').slice(0, 4).toUpperCase();
        const name = document.createElement('span');
        name.className = 'doc-name';
        name.textContent = f.name;
        chip.append(icon, name);
      }
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip-x';
      x.textContent = '×';
      x.setAttribute('aria-label', 'Remove ' + f.name);
      x.addEventListener('click', () => {
        if (f.thumb) URL.revokeObjectURL(f.thumb);
        pending.splice(i, 1);
        renderTray();
      });
      chip.appendChild(x);
      return chip;
    }));
    tray.hidden = pending.length === 0;
    refreshSendButton();
  }

  async function addFiles(list) {
    notice.textContent = '';
    for (const file of list) {
      if (pending.length >= MAX_FILES) { notice.textContent = `You can send up to ${MAX_FILES} files at a time.`; break; }
      preparing += 1;
      refreshSendButton();
      try {
        let item;
        if (/^image\//.test(file.type) && file.type !== 'image/svg+xml') {
          let blob;
          try { blob = await shrinkPhoto(file); } catch { throw new Error(`"${file.name}" is a photo type that cannot be read here. Try a JPEG or PNG.`); }
          item = { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', bytes: blob.size, data: await toBase64(blob), thumb: URL.createObjectURL(blob) };
        } else {
          item = { name: file.name, type: file.type, bytes: file.size, data: await toBase64(file) };
        }
        const total = pending.reduce((n, f) => n + f.bytes, 0) + item.bytes;
        if (total > MAX_TOTAL) {
          if (item.thumb) URL.revokeObjectURL(item.thumb);
          throw new Error(`Files can be up to ${MAX_TOTAL / 1048576} MB in total.`);
        }
        pending.push(item);
        renderTray();
      } catch (err) {
        notice.textContent = err.message || `"${file.name}" could not be added.`;
      } finally {
        preparing -= 1;
        refreshSendButton();
      }
    }
    if (pending.length) Nasrin.flash('surprised', 500);
  }

  // Files can also be dropped on the page or pasted into the message box.
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    addFiles([...e.dataTransfer.files]);
  });
  input.addEventListener('paste', (e) => {
    const files = e.clipboardData ? [...e.clipboardData.files] : [];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });

  // ---------- the + menu: files, or creating a picture ----------

  const plusMenu = $('plusMenu');
  const modeChip = $('modeChip');
  let imagesOn = false;
  let libraryOn = false;   // the server offers the Library (signed-in people)
  let projectsOn = false;  // the server offers Projects (signed-in people)
  let chatProject = null;  // { id, name }: the project the open chat belongs to (or a new chat will)
  let imageMode = false;

  function closePlus() {
    if (plusMenu.hidden) return;
    plusMenu.hidden = true;
    attachBtn.setAttribute('aria-expanded', 'false');
  }
  attachBtn.addEventListener('click', () => {
    if (!imagesOn) { fileInput.click(); return; }
    if (!plusMenu.hidden) { closePlus(); return; }
    plusMenu.hidden = false;
    attachBtn.setAttribute('aria-expanded', 'true');
    $('pickFiles').focus();
  });
  $('pickFiles').addEventListener('click', () => { closePlus(); fileInput.click(); });
  $('pickImage').addEventListener('click', () => { closePlus(); setImageMode(true); input.focus(); });
  $('modeOff').addEventListener('click', () => { setImageMode(false); input.focus(); });
  document.addEventListener('pointerdown', (e) => { if (!plusMenu.hidden && !$('plusWrap').contains(e.target)) closePlus(); });
  plusMenu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePlus(); attachBtn.focus(); } });

  function setImageMode(on) {
    imageMode = on;
    modeChip.hidden = !on;
    input.placeholder = on ? 'Describe the picture you want…' : 'Message Nasrin';
    document.body.classList.toggle('image-mode', on);
    if (on) Nasrin.flash('happy', 700);
  }

  // Pictures are private: fetched with the person's credential, shown from memory.
  // `regenerate`: makes the same picture again (only while the brief is in memory).
  function imageFigure(imageId, regenerate = null) {
    const fig = document.createElement('figure');
    fig.className = 'made-image is-loading';
    const img = document.createElement('img');
    img.alt = 'Picture made by Nasrin';
    const bar = document.createElement('figcaption');
    const dl = document.createElement('a');
    dl.className = 'btn outline small';
    dl.textContent = 'Download';
    dl.setAttribute('download', `nasrin-${imageId.slice(0, 8)}.png`);
    dl.hidden = true;
    bar.appendChild(dl);
    if (regenerate) {
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn outline small';
      again.textContent = 'Regenerate';
      again.addEventListener('click', () => { if (!busy) regenerate(); });
      bar.appendChild(again);
    }
    fig.append(img, bar);
    (async () => {
      try {
        const token = await credential(false);
        const resp = await fetch('/v1/images/' + encodeURIComponent(imageId), { headers: { Authorization: 'Bearer ' + token } });
        if (!resp.ok) throw new Error('gone');
        const url = URL.createObjectURL(await resp.blob());
        img.src = url;
        dl.href = url;
        dl.setAttribute('download', `nasrin-${imageId.slice(0, 8)}.${(resp.headers.get('content-type') || 'image/png').split('/')[1]}`);
        dl.hidden = false;
        img.addEventListener('load', () => {
          fig.classList.remove('is-loading');
          // The newest picture: keep Download and Regenerate in view.
          const msg = fig.closest('.msg');
          if (msg && msg === log.lastElementChild) scrollToEnd(msg);
        }, { once: true });
      } catch {
        fig.classList.remove('is-loading');
        fig.classList.add('is-gone');
        bar.textContent = 'This picture is no longer available.';
      }
    })();
    return fig;
  }

  // ---------- confirming an action Nasrin proposed ----------
  // The card's text comes from the server (built from the business's own
  // description and the checked details), never from the model's reply.
  function actionCard(pa) {
    if (!pa || typeof pa.token !== 'string' || typeof pa.summary !== 'string') return;
    const card = document.createElement('div');
    card.className = 'msg assistant image-card action-card';
    const lede = document.createElement('p');
    lede.className = 'card-lede';
    lede.textContent = pa.risk === 'money' ? 'Confirm this payment?' : 'Confirm this action?';
    const what = document.createElement('p');
    what.className = 'brief-summary';
    what.textContent = pa.summary;
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'btn small';
    yes.textContent = 'Confirm';
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'btn outline small';
    no.textContent = 'Cancel';
    actions.append(yes, no);
    card.append(lede, what, actions);
    log.appendChild(card);
    scrollToEnd(card);
    const decide = async (path) => {
      if (busy) return;
      yes.disabled = true; no.disabled = true;
      busy = true;
      try {
        const res = await api('/v1/actions/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: pa.token }) });
        actions.remove();
        if (path === 'cancel') { lede.textContent = 'Cancelled.'; return; }
        lede.textContent = res.ok ? 'Confirmed.' : 'Not completed.';
        if (res.message) show('assistant', res.message.content, { id: res.message.id });
        Nasrin.flash(res.ok ? 'happy' : 'sad', 1600);
      } catch (err) {
        actions.remove();
        lede.textContent = err.message || 'This action could not be completed.';
        Nasrin.flash('sad', 1600);
      } finally {
        busy = false;
        refreshSendButton();
      }
    };
    yes.addEventListener('click', () => decide('confirm'));
    no.addEventListener('click', () => decide('cancel'));
  }

  // ---------- creating a picture: idea -> questions -> brief -> picture ----------
  // The page keeps the job (idea, photo, brief) in memory only; the server
  // checks everything again. Regenerate sends the same brief again: a new,
  // counted picture.

  // One request at a time, with Nasrin thinking; problems are shown plainly.
  async function imageStep(label, path, body) {
    busy = true;
    notice.textContent = '';
    stopSpeaking();
    refreshSendButton();
    Nasrin.mood('thinking');
    const thinking = showThinking(label);
    try {
      return await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (err) {
      show('problem', err.message || 'The picture could not be made. Please try again.');
      Nasrin.flash('sad', 2400);
      if (!account && err.code === 'image_limit' && (signInMethods.email || signInMethods.google)) openSignIn(err.message);
      return null;
    } finally {
      thinking.remove();
      busy = false;
      refreshSendButton();
    }
  }

  const jobBody = (job) => ({ prompt: job.prompt, ...(job.photo ? { photo: job.photo } : {}) });

  async function sendImage(text, files) {
    noticesOnSend();
    const photo = files.find((f) => f.type && f.type.startsWith('image/'));
    show('user', text, { files: photo ? [photo] : [] });
    input.value = '';
    autosize();
    setImageMode(false);
    const job = { prompt: text, photo: photo ? { name: photo.name, type: photo.type, data: photo.data } : null, brief: null };
    const data = await imageStep('Looking at your idea', '/v1/images/brief', jobBody(job));
    if (!data) return;
    if (data.questions && data.questions.length) return showQuestions(job, data.questions);
    showBrief(job, data);
  }

  // One question: tap a quick answer, or type your own right under it. `onChange(answer)`.
  function questionBox(q, onChange) {
    const box = document.createElement('fieldset');
    box.className = 'question';
    const legend = document.createElement('legend');
    legend.textContent = q.question;
    const chips = document.createElement('div');
    chips.className = 'answer-chips';
    const field = document.createElement('input');
    field.type = 'text';
    field.maxLength = 300;
    field.placeholder = 'Type your answer';
    field.setAttribute('aria-label', q.question);
    field.enterKeyHint = 'next';
    for (const choice of q.choices || []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'answer-chip';
      b.textContent = choice;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        for (const o of chips.children) o.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', String(on));
        field.value = on ? choice : '';
        onChange(on ? choice : '');
      });
      chips.appendChild(b);
    }
    field.addEventListener('input', () => {
      for (const o of chips.children) o.setAttribute('aria-pressed', String(o.textContent === field.value.trim()));
      onChange(field.value.trim());
    });
    // Enter never sends anything: it moves on to the next answer.
    field.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const all = [...field.closest('.image-card').querySelectorAll('.question input')];
      const next = all[all.indexOf(field) + 1];
      (next || field.closest('.image-card').querySelector('.card-actions button')).focus();
    });
    box.append(legend);
    if (chips.children.length) box.append(chips);
    box.append(field);
    return box;
  }

  // Nasrin's questions: quick answers to tap, and a box under each to type your own.
  function showQuestions(job, questions) {
    const card = document.createElement('div');
    card.className = 'msg assistant image-card';
    const lede = document.createElement('p');
    lede.className = 'card-lede';
    lede.textContent = questions.length === 1 ? 'One question before I start:' : `A few questions before I start (${questions.length}):`;
    card.appendChild(lede);
    const picked = questions.map(() => '');
    questions.forEach((q, i) => card.appendChild(questionBox(q, (value) => { picked[i] = value; })));
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn small';
    go.textContent = 'Continue';
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'btn outline small';
    skip.textContent = 'Skip';
    actions.append(go, skip);
    card.appendChild(actions);
    startChat();
    log.appendChild(card);
    scrollToEnd(card);
    Nasrin.mood('idle');

    const answer = async (answers) => {
      if (busy) return;
      for (const el of card.querySelectorAll('button, input')) el.disabled = true;
      const data = await imageStep('Writing the brief', '/v1/images/brief', { ...jobBody(job), answers });
      if (!data) { for (const el of card.querySelectorAll('button, input')) el.disabled = false; return; }
      actions.remove();
      showBrief(job, data);
    };
    go.addEventListener('click', () => answer(questions.map((q, i) => ({ question: q.question, answer: picked[i] }))));
    skip.addEventListener('click', () => answer([]));
  }

  // The brief's short summary, with Create.
  function showBrief(job, data) {
    job.brief = data.brief;
    const card = document.createElement('div');
    card.className = 'msg assistant image-card brief-card';
    const lede = document.createElement('p');
    lede.className = 'card-lede';
    lede.textContent = 'Here is the plan:';
    const summary = document.createElement('p');
    summary.className = 'brief-summary';
    summary.textContent = data.summary;
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'btn small';
    create.textContent = 'Create';
    actions.appendChild(create);
    card.append(lede, summary, actions);
    startChat();
    log.appendChild(card);
    scrollToEnd(card);
    Nasrin.flash('happy', 900);
    create.addEventListener('click', async () => {
      if (busy) return;
      create.disabled = true;
      if (await makeImage(job)) actions.remove();
      else create.disabled = false;
    });
  }

  // One picture from the brief. Resolves true when it was made.
  async function makeImage(job) {
    const data = await imageStep('Making your picture', '/v1/images', {
      ...jobBody(job),
      brief: job.brief,
      ...(conversationId ? { conversation_id: conversationId } : {})
    });
    if (!data) return false;
    conversationId = data.conversation_id;
    saved.set(KEYS.conversation, conversationId);
    show('assistant', data.message.content, { id: data.message.id, regenerate: () => makeImage(job) });
    Nasrin.flash('happy', 1800);
    return true;
  }

  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';                 // so the same file can be picked again
    addFiles(files);
  });

  // ---------- sending ----------

  // ---------- sending: streamed replies, Stop, Retry, Regenerate, Edit ----------

  let turn = null;      // the reply being written: { ctrl } (Stop aborts it)
  let editing = null;   // { id, el } while the person edits their last message

  // Asks for a reply and reads it as it is written (lines of JSON). Problems
  // found before the answer starts come back as ordinary errors.
  async function askStream(body, { onStart, onDelta, onReset, onAudio, signal }) {
    const go = async (fresh) => {
      const token = await credential(fresh);
      try {
        return await fetch('/v1/chat', {
          method: 'POST', signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ ...body, stream: true })
        });
      } catch (err) {
        if (signal.aborted) throw err;
        throw Object.assign(new Error('You seem to be offline. Check your connection and try again.'), { code: 'offline' });
      }
    };
    let resp = await go(false);
    if (resp.status === 401) resp = await go(true);   // session ended: start a new one once
    if (!(resp.headers.get('content-type') || '').includes('ndjson')) {
      if (!resp.ok) throw await errorFrom(resp);
      return resp.json();
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = null;
    const handle = (line) => {
      if (!line.trim()) return;
      let ev;
      try { ev = JSON.parse(line); } catch { return; }
      if (ev.type === 'start') onStart(ev);
      else if (ev.type === 'delta' && typeof ev.text === 'string') onDelta(ev.text);
      else if (ev.type === 'reset') onReset();
      else if (ev.type === 'audio' && typeof ev.data === 'string') { if (onAudio) onAudio(ev); }
      else if (ev.type === 'done') done = ev;
      else if (ev.type === 'error') {
        const e = ev.error || {};
        throw Object.assign(new Error(typeof e.message === 'string' ? e.message : 'Something went wrong. Please try again.'), { code: e.code });
      }
    };
    for (;;) {
      let chunk;
      try { chunk = await reader.read(); } catch (err) {
        if (signal.aborted) throw err;
        throw Object.assign(new Error('The connection dropped while Nasrin was answering. Tap Retry.'), { code: 'offline' });
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) { handle(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
    }
    handle(buffer);
    if (!done) throw Object.assign(new Error('The reply did not finish. Tap Retry.'), { code: 'incomplete' });
    return done;
  }

  // The reply while it is written: plain text (never HTML), replaced by the
  // fully checked and formatted reply when it is done.
  function liveBubble() {
    const el = document.createElement('div');
    el.className = 'msg assistant is-live';
    const body = document.createElement('div');
    body.className = 'msg-body';
    const text = document.createTextNode('');
    body.appendChild(text);
    el.appendChild(body);
    let shown = false;
    let raw = '';
    return {
      add(piece, thinking) {
        if (!shown) { thinking.remove(); startChat(); log.appendChild(el); shown = true; }
        raw += piece;
        text.data = window.NasrinFiles.strip(raw);   // questions and files appear as cards when the reply is done
        scrollToEnd(el);
      },
      clear() { raw = ''; text.data = ''; },
      text() { return raw; },
      remove() { el.remove(); }
    };
  }

  // Regenerate on the newest answer, Edit on the person's newest message.
  function refreshTurnControls() {
    for (const b of log.querySelectorAll('.act[data-kind="regen"], .edit-msg')) b.remove();
    if (busy) return;
    const msgs = [...log.querySelectorAll('.msg.user, .msg.assistant')];
    const last = msgs.at(-1);
    if (last && last.classList.contains('assistant') && !last.querySelector('.picture') && last.dataset.id && conversationId) {
      const row = last.querySelector('.reply-actions');
      if (row) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'act';
        b.dataset.kind = 'regen';
        b.setAttribute('aria-label', 'Regenerate reply');
        b.title = 'Regenerate';
        b.appendChild(svgIcon(ICON_REGEN));
        b.addEventListener('click', () => { if (!busy) runTurn({ regenerate: true, replace: last }); });
        row.appendChild(b);
      }
    }
    const lastUser = msgs.filter((m) => m.classList.contains('user')).at(-1);
    if (lastUser && lastUser.dataset.id && conversationId && !/^Create an image: /.test(lastUser.dataset.text || '')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'edit-msg';
      b.setAttribute('aria-label', 'Edit your message');
      b.title = 'Edit';
      b.appendChild(svgIcon(ICON_EDIT));
      b.addEventListener('click', () => startEdit(lastUser));
      lastUser.appendChild(b);
    }
  }

  function startEdit(el) {
    if (busy) return;
    editing = { id: el.dataset.id, el };
    input.value = el.dataset.text || '';
    $('editBar').hidden = false;
    autosize();
    input.focus();
  }
  function cancelEdit() {
    editing = null;
    $('editBar').hidden = true;
  }
  $('editCancel').addEventListener('click', () => { cancelEdit(); input.value = ''; autosize(); });

  async function send(raw) {
    const text = String(raw || '').trim();
    if (turn) return;
    if ((!text && !pending.length) || busy || preparing || !aiAvailable) return;
    if (imageMode) {
      if (!text) { notice.textContent = 'Describe the picture you want.'; return; }
      const files = pending;
      pending = [];
      renderTray();
      return sendImage(text, files);
    }
    const files = editing ? [] : pending;
    if (!editing) { pending = []; renderTray(); }
    return runTurn({ text, files, editId: editing ? editing.id : null, editEl: editing ? editing.el : null });
  }

  // One reply: a new message, Regenerate (replace: the old answer), Retry
  // (regenerate after a failure), or an edited last message.
  // spoken: this turn is part of a voice conversation (short, spoken-style reply).
  // speakVoice: a natural voice id; the server then sends the reply as speech while it is written (onAudio).
  // onPiece(text | null): the reply as it arrives (null: start over). onFail(err): it failed.
  // Resolves { data, shown } when a reply was shown, otherwise nothing.
  async function runTurn({ text = '', files = [], regenerate = false, replace = null, editId = null, editEl = null, spoken = false, speakVoice = null, onPiece = null, onAudio = null, onFail = null }) {
    busy = true;
    notice.textContent = '';
    stopSpeaking();
    noticesOnSend();
    hideMemoryAsk();
    if (editEl) {
      // The edited message and everything after it are replaced.
      let n = editEl;
      while (n) { const next = n.nextElementSibling; if (n !== welcome) n.remove(); n = next; }
      cancelEdit();
    }
    if (replace) replace.remove();
    for (const p of log.querySelectorAll('.msg.problem, .ask-card')) p.remove();
    const tone = Nasrin.tone(text);
    let userEl = null;
    if (!regenerate) {
      userEl = show('user', text, { files });
      userEl.dataset.text = text;
      input.value = '';
      autosize();
    }
    Nasrin.mood(tone === 'negative' ? 'concerned' : 'thinking');
    if (tone === 'negative') setTimeout(() => { if (busy) Nasrin.mood('thinking'); }, 900);
    const thinking = showThinking();
    const live = liveBubble();
    const ctrl = new AbortController();
    turn = { ctrl };
    refreshSendButton();
    refreshTurnControls();
    let started = null;   // { conversation_id, user_message_id } once the message is saved

    const body = (id) => ({
      ...(regenerate ? { regenerate: true } : { message: text }),
      blocks: true,
      ...(spoken ? { voice: true } : {}),
      ...(spoken && speakVoice ? { speak_voice: speakVoice } : {}),
      ...(editId ? { edit_message_id: editId } : {}),
      ...(id ? { conversation_id: id } : {}),
      ...(!id && chatProject ? { project_id: chatProject.id } : {}),
      ...(currentModel ? { model: currentModel } : {}),
      professional: proRequest(),
      ...(files.length ? { attachments: files.map((f) => ({ name: f.name, type: f.type, data: f.data })) } : {})
    });
    const hooks = {
      signal: ctrl.signal,
      onStart: (ev) => {
        started = ev;
        conversationId = ev.conversation_id;
        saved.set(KEYS.conversation, conversationId);
        if (userEl) userEl.dataset.id = ev.user_message_id;
      },
      onDelta: (piece) => { live.add(piece, thinking); if (onPiece) onPiece(piece); },
      onReset: () => { live.clear(); if (onPiece) onPiece(null); },
      onAudio
    };
    try {
      let data;
      try {
        data = await askStream(body(conversationId), hooks);
      } catch (err) {
        if (err.status !== 404 || !conversationId || regenerate || editId) throw err;
        // The earlier chat is gone (guest chats expire); carry on in a new one.
        conversationId = null;
        saved.del(identityKey(KEYS.conversation));
        notice.textContent = 'Your earlier chat has expired, so this message starts a new one.';
        data = await askStream(body(null), hooks);
      }
      thinking.remove();
      live.remove();
      conversationId = data.conversation_id;
      saved.set(KEYS.conversation, conversationId);
      if (userEl && data.user_message_id) userEl.dataset.id = data.user_message_id;
      if (data.project && typeof data.project.id === 'string') setChatProject(data.project);
      busy = false;
      if (!data.message) return;
      const shown = show('assistant', data.message.content, { id: data.message.id, animate: !live.text() });
      shown.dataset.id = data.message.id;
      const used = Array.isArray(data.professionals) ? data.professionals.map(proById).filter(Boolean) : [];
      if (used.length) {
        const note = document.createElement('p');
        note.className = 'pro-used';
        note.textContent = 'With the expertise of ' + used.map((p) => p.name).join(', ');
        shown.appendChild(note);
      }
      setProBadge(used.map((p) => p.id));
      const books = Array.isArray(data.library) ? data.library.filter((t) => typeof t === 'string').slice(0, 4) : [];
      if (books.length) {
        const note = document.createElement('p');
        note.className = 'pro-used';
        note.textContent = 'From your Library: ' + books.join(', ');
        shown.appendChild(note);
      }
      if (data.pending_action) actionCard(data.pending_action);
      if (speakOn && !spoken && !vc.on) shown.querySelector('.listen')?.click();
      // React to how the conversation feels.
      if (tone === 'negative') Nasrin.flash('concerned', 2600);
      else if (tone === 'positive' || Nasrin.tone(data.message.content) === 'positive') Nasrin.flash('happy', 1700);
      else { Nasrin.mood('idle'); Nasrin.blink(true); }
      return { data, shown };
    } catch (err) {
      thinking.remove();
      const partial = live.text();
      live.remove();
      busy = false;
      if (onFail) onFail(err, ctrl.signal.aborted);
      if (ctrl.signal.aborted) {
        // Stopped: what was written stays (the server kept it too).
        if (partial.trim()) {
          const shown = show('assistant', partial, { animate: false });
          const note = document.createElement('p');
          note.className = 'pro-used';
          note.textContent = 'Stopped';
          shown.appendChild(note);
        }
        Nasrin.mood('idle');
        return;
      }
      problem(err.message || 'Something went wrong. Please try again.', () => {
        // Saved on the server already: answer it again. Otherwise send it again.
        if (started || regenerate) runTurn({ regenerate: true });
        else { if (userEl) userEl.remove(); runTurn({ text, files }); }
      });
      Nasrin.flash('sad', 2600);
      if (err.code === 'model_not_allowed' || err.code === 'model_unavailable') loadModels();
      if (!account && (err.code === 'guest_limit' || err.code === 'model_not_allowed') && (signInMethods.email || signInMethods.google)) openSignIn(err.message);
      if (err.code === 'plan_required') openPlans(err.message);
      if (err.code === 'terms_required') checkTerms('update_prompt');
    } finally {
      busy = false;
      turn = null;
      refreshSendButton();
      refreshTurnControls();
    }
  }

  // A problem in the conversation, with Retry when it can be tried again.
  function problem(message, retry) {
    const el = show('problem', message);
    if (retry) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small outline retry';
      b.textContent = 'Retry';
      b.addEventListener('click', () => { if (!busy) { el.remove(); retry(); } });
      el.appendChild(b);
    }
    return el;
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); if (turn) { turn.ctrl.abort(); return; } send(input.value); });
  input.addEventListener('input', () => {
    autosize();
    if (busy || listening) return;
    if (input.value.trim()) {
      if (Nasrin.current !== 'typing') Nasrin.mood('typing');
      Nasrin.tick();
    } else if (Nasrin.current === 'typing') Nasrin.mood('idle');
  });
  input.addEventListener('focus', () => { if (!busy && !listening && input.value.trim()) Nasrin.mood('typing'); });
  input.addEventListener('blur', () => { if (Nasrin.current === 'typing') Nasrin.mood('idle'); });
  // Enter (and Shift+Enter) only start a new line. A message is sent only by tapping the Send button.
  for (const b of document.querySelectorAll('.starter:not(#starterImage)')) b.addEventListener('click', () => send(b.textContent));
  // "Create a picture" switches to picture mode; the person then describes it.
  $('starterImage').addEventListener('click', () => { setImageMode(true); input.focus(); });

  function startNewChat({ focus = true, message = '' } = {}) {
    setChatProject(null);
    conversationId = null;
    saved.del(identityKey(KEYS.conversation));
    stopSpeaking();
    notice.textContent = message;
    clearScreen();
    Nasrin.flash('happy', 1200);
    if (focus) input.focus();
    startNotes('new_chat');
  }
  $('newChat').addEventListener('click', () => startNewChat());

  // ---------- a fresh chat after 5 minutes away ----------
  // When the person leaves the app (the tab or app goes to the background or
  // closes) the time is noted on this device. Coming back after 5 minutes or
  // more, the app opens a new chat; the earlier one stays in Your chats. A
  // reply being written or a voice conversation is never interrupted.
  const AWAY_NEW_CHAT_MS = 5 * 60 * 1000;
  const markLeft = () => saved.set(KEYS.left, Date.now());
  const awayLong = () => {
    const at = Number(saved.get(KEYS.left));
    return Number.isFinite(at) && at > 0 && Date.now() - at >= AWAY_NEW_CHAT_MS;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { markLeft(); return; }
    const long = awayLong();
    saved.del(KEYS.left);
    if (long && conversationId && !busy && !vc.on) startNewChat({ focus: false, message: 'Started a new chat. Your last one is in Your chats.' });
  });
  window.addEventListener('pagehide', markLeft);

  // ---------- reading replies aloud ----------
  //
  // Two kinds of voice: natural voices from the server ("ai:coral"), which can
  // only read Nasrin's own replies, and the phone's own voices ("device:...").
  // Audio plays through Web Audio, unlocked by the first tap, so a reply can be
  // read aloud on iPhone even though it arrives after the tap.

  const canDevice = 'speechSynthesis' in window;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  let speech = { available: false, voices: [], default: null };
  let speakOn = saved.get(KEYS.speak) === true;
  let voiceChoice = saved.get(KEYS.voice);
  let speechRate = 1;   // read-aloud speed, set by the server (SPEECH_RATE)
  let playing = null;            // { stop(), button }

  const canSpeakAnything = () => canDevice || (speech.available && Boolean(AudioCtx));
  const currentVoice = () => {
    const ok = (v) => typeof v === 'string' && ((v.startsWith('ai:') && speech.available && speech.voices.some((x) => 'ai:' + x.id === v)) || (v.startsWith('device:') && canDevice));
    if (ok(voiceChoice)) return voiceChoice;
    if (speech.available && AudioCtx) return 'ai:' + (speech.default || speech.voices[0].id);
    return 'device:default';
  };

  function unlockAudio() {
    if (!AudioCtx) return;
    // iPhone: let read-aloud play like media, even with the ring/silent switch on.
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
    try {
      audioCtx = audioCtx || new AudioCtx();
      // A reply the person paused stays paused, whatever else they tap.
      if (audioCtx.state === 'suspended' && !(playing && playing.paused)) audioCtx.resume();
    } catch { audioCtx = null; }
  }
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlockAudio, { passive: true });

  function stopSpeaking() {
    if (playing) { const p = playing; playing = null; p.stop(); }
    if (canDevice) window.speechSynthesis.cancel();
  }

  const ICON_PLAY = 'M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z';
  const ICON_STOP = 'M8.5 7h7A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 15.5v-7A1.5 1.5 0 0 1 8.5 7Z';
  const ICON_PAUSE = 'M7.5 5.5h3v13h-3ZM13.5 5.5h3v13h-3Z';

  // Listen states: idle (Listen), loading (tap to cancel), playing (Pause),
  // paused (Resume). A small Stop button sits next to it while it is active.
  function setPlaying(button, on, loading = false, paused = false) {
    if (!button) return;
    button.classList.toggle('is-playing', on);
    button.classList.toggle('is-loading', on && loading);
    button.classList.toggle('is-paused', on && paused);
    const label = button.querySelector('.label');
    if (label) label.textContent = !on ? 'Listen' : loading ? 'Loading' : paused ? 'Resume' : 'Pause';
    const shape = button.querySelector('path');
    if (shape) shape.setAttribute('d', !on || paused ? ICON_PLAY : loading ? ICON_STOP : ICON_PAUSE);
    button.setAttribute('aria-pressed', String(on && !paused));
    button.setAttribute('aria-label', !on ? 'Listen to this reply' : loading ? 'Cancel listening' : paused ? 'Resume listening' : 'Pause listening');
    let stop = button.nextElementSibling && button.nextElementSibling.classList.contains('listen-stop') ? button.nextElementSibling : null;
    if (on && !loading && !stop) {
      stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'act listen-stop';
      stop.setAttribute('aria-label', 'Stop listening');
      stop.title = 'Stop';
      stop.appendChild(svgIcon(ICON_STOP, true));
      stop.addEventListener('click', () => stopSpeaking());
      button.after(stop);
    } else if ((!on || loading) && stop) stop.remove();
  }

  // Plays a reply with a natural voice. Long replies come in parts: the first
  // (short) part starts playing as soon as it arrives while the next is
  // fetched, and parts are scheduled back to back, so there is no long wait
  // and no gap. Resolves when it ends or is stopped.
  async function playServerAudio(body, button) {
    unlockAudio();
    if (!audioCtx) throw new Error('no audio');
    // The browser may keep sound blocked; don't spend a voice request or leave
    // Nasrin "speaking" silently when it does.
    if (audioCtx.state !== 'running') {
      await Promise.race([audioCtx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 800))]);
      if (audioCtx.state !== 'running') throw new Error('Sound is blocked by the browser. Tap Listen again.');
    }
    let stopped = false;
    const sources = [];
    let finished;
    const ended = new Promise((r) => { finished = r; });
    const finish = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(meter);
      Nasrin.talk(0);
      if (playing && playing.paused) { playing.paused = false; audioCtx.resume().catch(() => {}); }
      for (const src of sources) { try { src.stop(); } catch { /* not started */ } }
      setPlaying(button, false);
      if (Nasrin.current === 'speaking') Nasrin.mood('idle');
      finished();
    };
    playing = {
      stop: finish, button, loading: true, paused: false,
      pause() { if (stopped || this.loading) return; this.paused = true; audioCtx.suspend().catch(() => {}); setPlaying(button, true, false, true); if (Nasrin.current === 'speaking') Nasrin.mood('idle'); },
      resume() { if (stopped) return; this.paused = false; audioCtx.resume().catch(() => {}); setPlaying(button, true); Nasrin.mood('speaking'); }
    };
    const mine = playing;
    setPlaying(button, true, true);   // feedback right away, while the first part loads

    // In a voice conversation the character's mouth opens with the sound.
    let sink = audioCtx.destination;
    let meter = 0;
    if (vc.on) {
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.connect(audioCtx.destination);
      sink = analyser;
      const wave = new Uint8Array(analyser.fftSize);
      const follow = () => {
        analyser.getByteTimeDomainData(wave);
        let sum = 0;
        for (let i = 0; i < wave.length; i++) { const v = (wave[i] - 128) / 128; sum += v * v; }
        Nasrin.talk(Math.sqrt(sum / wave.length) * 5);
        meter = requestAnimationFrame(follow);
      };
      follow();
    }

    const fetchPart = async (part) => {
      const token = await credential(false);
      const resp = await fetch('/v1/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body.preview ? body : { ...body, part })
      });
      if (!resp.ok) throw await errorFrom(resp);
      const total = Math.max(1, Math.min(40, Number(resp.headers.get('X-Speech-Parts')) || 1));
      return { buf: await audioCtx.decodeAudioData(await resp.arrayBuffer()), total };
    };

    try {
      const first = await fetchPart(0);
      if (stopped) return;
      let at = audioCtx.currentTime + 0.05;
      const schedule = (buf) => {
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(sink);
        // A part that arrives late starts now, never on top of the one playing.
        at = Math.max(at, audioCtx.currentTime + 0.02);
        src.start(at);
        at += buf.duration;
        sources.push(src);
        return src;
      };
      mine.loading = false;
      setPlaying(button, true);
      Nasrin.mood('speaking');
      let last = schedule(first.buf);
      let next = first.total > 1 ? fetchPart(1) : null;
      for (let i = 1; i < first.total && !stopped; i++) {
        const part = await next;
        next = i + 1 < first.total ? fetchPart(i + 1) : null;
        if (stopped) break;
        last = schedule(part.buf);
      }
      if (!stopped) last.onended = finish;
    } catch (err) {
      const wasStopped = stopped;
      finish();
      if (!wasStopped) throw err;
    }
    return ended;
  }

  // Plays speech the server sends while a reply is still being written (the
  // hands-free voice conversation): each sentence arrives as its own MP3 and
  // is queued right behind the one before, so Nasrin starts talking after the
  // first sentence, not after the whole reply. add(base64) for each piece,
  // end() when no more will come; `done` resolves when it has all been
  // said, or was stopped. onFirst runs when the first sound starts.
  function liveAudio(onFirst) {
    unlockAudio();
    if (!audioCtx || audioCtx.state === 'closed') return null;
    audioCtx.resume().catch(() => {});
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(audioCtx.destination);
    const wave = new Uint8Array(analyser.fftSize);
    let meter = 0;
    const follow = () => {
      analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (let i = 0; i < wave.length; i++) { const v = (wave[i] - 128) / 128; sum += v * v; }
      Nasrin.talk(Math.sqrt(sum / wave.length) * 5);
      meter = requestAnimationFrame(follow);
    };
    const sources = new Set();
    let chain = Promise.resolve();   // decode in order
    let waiting = 0;                 // pieces received but not yet queued
    let at = 0;
    let stopped = false;
    let ended = false;
    let began = false;
    let finish;
    const done = new Promise((r) => { finish = r; });
    const close = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(meter);
      Nasrin.talk(0);
      for (const src of sources) { try { src.stop(); } catch { /* not started */ } }
      sources.clear();
      try { analyser.disconnect(); } catch { /* already apart */ }
      if (Nasrin.current === 'speaking') Nasrin.mood('idle');
      finish();
    };
    const check = () => { if (!stopped && ended && !waiting && !sources.size) close(); };
    playing = { stop: close, button: null, loading: false, paused: false, pause() {}, resume() {} };
    return {
      done,
      get started() { return began; },
      add(base64) {
        if (stopped) return;
        let bytes;
        try { bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)); } catch { return; }
        waiting += 1;
        chain = chain.then(async () => {
          try {
            const buf = await audioCtx.decodeAudioData(bytes.buffer);
            if (stopped) return;
            const src = audioCtx.createBufferSource();
            src.buffer = buf;
            src.connect(analyser);
            // A piece that arrives late starts now, never on top of the one playing.
            at = Math.max(at, audioCtx.currentTime + 0.02);
            src.start(at);
            at += buf.duration;
            sources.add(src);
            src.onended = () => { sources.delete(src); check(); };
            if (!began) { began = true; follow(); if (onFirst) onFirst(); }
          } catch { /* one piece that cannot be played is skipped */ } finally {
            waiting -= 1;
            check();
          }
        });
      },
      end() { ended = true; check(); },
      stop: close
    };
  }

  // The phone's own voice. Read sentence by sentence: some browsers stop long
  // utterances part-way, and the first words start sooner.
  function playDevice(text, voiceId, button) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      synth.cancel();
      const uri = voiceId.slice('device:'.length);
      const voiceObj = uri !== 'default' ? synth.getVoices().find((x) => x.voiceURI === uri) : null;
      const chunks = (window.NasrinFormat.plain(text).slice(0, 4000).match(/[^.!?\n]+[.!?]*\s*/g) || [text])
        .reduce((acc, s) => { if (acc.length && (acc[acc.length - 1] + s).length < 220) acc[acc.length - 1] += s; else acc.push(s); return acc; }, [])
        .map((c) => c.trim()).filter(Boolean);
      let done = false;
      // The phone's voice gives no sound to measure, so the mouth moves in a talking rhythm.
      const mouth = vc.on ? setInterval(() => Nasrin.talk(synth.paused ? 0 : 0.2 + Math.random() * 0.6), 120) : 0;
      const finish = () => { if (done) return; done = true; clearInterval(mouth); Nasrin.talk(0); setPlaying(button, false); if (Nasrin.current === 'speaking') Nasrin.mood('idle'); resolve(); };
      playing = {
        stop() { synth.cancel(); finish(); }, button, loading: false, paused: false,
        pause() { if (done) return; this.paused = true; synth.pause(); setPlaying(button, true, false, true); if (Nasrin.current === 'speaking') Nasrin.mood('idle'); },
        resume() { if (done) return; this.paused = false; synth.resume(); setPlaying(button, true); Nasrin.mood('speaking'); }
      };
      setPlaying(button, true);
      Nasrin.mood('speaking');
      chunks.forEach((c, i) => {
        const u = new SpeechSynthesisUtterance(c);
        if (voiceObj) { u.voice = voiceObj; u.lang = voiceObj.lang; }
        u.rate = speechRate;
        if (i === chunks.length - 1) { u.onend = finish; }
        u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') finish(); };
        synth.speak(u);
      });
      if (!chunks.length) finish();
    });
  }

  // Reads one reply. Natural voices need the reply's id; otherwise the phone reads it.
  async function readReply(text, id, button) {
    const voice = currentVoice();
    if (voice.startsWith('ai:') && id) {
      try {
        await playServerAudio({ voice: voice.slice(3), message_id: id }, button);
        return;
      } catch (err) {
        setPlaying(button, false);
        if (!canDevice) { notice.textContent = err.message || 'Voice replies are not available right now.'; return; }
      }
    }
    if (canDevice) await playDevice(text, voice.startsWith('device:') ? voice : 'device:default', button);
  }

  const svgIcon = (d, filled) => {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    if (filled) icon.classList.add('filled');
    for (const part of [].concat(d)) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', part);
      icon.appendChild(path);
    }
    return icon;
  };
  const ICON_COPY = ['M9 9h9.5A1.5 1.5 0 0 1 20 10.5V20a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 20v-9.5A1.5 1.5 0 0 1 9 9Z', 'M16.5 9V5.5A1.5 1.5 0 0 0 15 4H5.5A1.5 1.5 0 0 0 4 5.5V15a1.5 1.5 0 0 0 1.5 1.5h2'];
  const ICON_CHECK = 'M5 12.5 10 17.5 19 7';
  const ICON_REGEN = ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4.5v4h-4'];
  const ICON_EDIT = ['M15 5.5l3.5 3.5L9 18.5H5.5V15Z', 'M13 7.5l3.5 3.5'];
  const ICON_SAVE = 'M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z';
  const ICON_SHARE = ['M12 15V3.5', 'M7.5 8 12 3.5 16.5 8', 'M5 12v6.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V12'];

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      // Older browsers: a temporary selection.
      const area = document.createElement('textarea');
      area.value = text; area.setAttribute('readonly', ''); area.className = 'sr-only';
      document.body.appendChild(area); area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      area.remove();
      return ok;
    }
  }
  function flashDone(btn, label) {
    const before = btn.getAttribute('aria-label');
    btn.replaceChildren(svgIcon(ICON_CHECK));
    btn.classList.add('is-done');
    btn.setAttribute('aria-label', label);
    setTimeout(() => { btn.replaceChildren(svgIcon(btn.dataset.kind === 'share' ? ICON_SHARE : btn.dataset.kind === 'save' ? ICON_SAVE : ICON_COPY)); btn.classList.remove('is-done'); btn.setAttribute('aria-label', before); }, 1400);
  }

  // Under each reply: Listen, Copy, Share.
  function replyActions(text, id) {
    const row = document.createElement('div');
    row.className = 'reply-actions';
    if (canSpeakAnything()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'listen';
      b.setAttribute('aria-pressed', 'false');
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = 'Listen';
      b.append(svgIcon(ICON_PLAY, true), label);
      b.addEventListener('click', () => {
        const mine = playing && playing.button === b ? playing : null;
        if (mine && mine.loading) { stopSpeaking(); return; }   // cancel before it starts: no second request
        if (mine && mine.paused) { mine.resume(); return; }
        if (mine) { mine.pause(); return; }
        stopSpeaking();
        readReply(text, id, b);
      });
      row.appendChild(b);
    }
    const plainText = window.NasrinFormat.plain(text);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'act';
    copy.dataset.kind = 'copy';
    copy.setAttribute('aria-label', 'Copy reply');
    copy.title = 'Copy';
    copy.appendChild(svgIcon(ICON_COPY));
    copy.addEventListener('click', async () => { if (await copyText(plainText)) flashDone(copy, 'Copied'); });
    row.appendChild(copy);

    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'act';
    share.dataset.kind = 'share';
    share.setAttribute('aria-label', 'Share reply');
    share.title = 'Share';
    share.appendChild(svgIcon(ICON_SHARE));
    share.addEventListener('click', async () => {
      if (navigator.share) {
        try { await navigator.share({ title: 'From Nasrin', text: plainText }); } catch { /* closed */ }
        return;
      }
      if (await copyText(plainText)) { flashDone(share, 'Copied to share'); notice.textContent = 'Copied. Paste it anywhere to share.'; }
    });
    row.appendChild(share);

    if (libraryOn) {
      const keep = document.createElement('button');
      keep.type = 'button';
      keep.className = 'act';
      keep.dataset.kind = 'save';
      keep.setAttribute('aria-label', 'Save reply to your Library');
      keep.title = 'Save to Library';
      keep.appendChild(svgIcon(ICON_SAVE));
      keep.addEventListener('click', async () => {
        if (!account) { openSignIn('Sign in to save replies to your Library.'); return; }
        keep.disabled = true;
        const first = plainText.split('\n').map((l) => l.trim()).find(Boolean) || 'Saved reply';
        try {
          await api('/v1/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'reply', title: first.length > 60 ? first.slice(0, 59) + '…' : first, text }) });
          flashDone(keep, 'Saved to Library');
          notice.textContent = 'Saved to your Library.';
        } catch (err) {
          notice.textContent = err.message || 'That reply could not be saved.';
        } finally { keep.disabled = false; }
      });
      row.appendChild(keep);
    }
    return row;
  }

  // Code "Copy" buttons and step ticks inside replies.
  log.addEventListener('click', async (e) => {
    const code = e.target.closest('.code-copy');
    if (code) {
      if (await copyText(code.dataset.copy || '')) { code.textContent = 'Copied'; setTimeout(() => { code.textContent = 'Copy'; }, 1400); }
      return;
    }
    const tick = e.target.closest('.step-tick');
    if (tick) {
      const on = tick.getAttribute('aria-pressed') !== 'true';
      tick.setAttribute('aria-pressed', String(on));
      tick.closest('.step').classList.toggle('is-done', on);
      if (on && !reduced()) Nasrin.flash('happy', 700);
    }
  });

  // ---------- settings: appearance, read aloud, voice ----------

  const THEME_COLORS = { light: '#F4F4F1', dark: '#0C0C0D' };
  const themeMetas = [...document.querySelectorAll('meta[name="theme-color"]')];
  themeMetas.forEach((m) => { m.dataset.original = m.content; });

  function applyTheme(choice) {
    const t = choice === 'light' || choice === 'dark' ? choice : 'system';
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    themeMetas.forEach((m) => { m.content = t === 'system' ? m.dataset.original : THEME_COLORS[t]; });
    for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === t;
  }
  applyTheme(saved.get(KEYS.theme));
  for (const r of document.querySelectorAll('input[name="theme"]')) {
    r.addEventListener('change', () => {
      saved.set(KEYS.theme, r.value);
      applyTheme(r.value);
      Nasrin.blink(true);
    });
  }

  readAloud.checked = speakOn;
  readAloud.addEventListener('change', () => {
    speakOn = readAloud.checked;
    saved.set(KEYS.speak, speakOn);
    if (!speakOn) stopSpeaking();
  });

  const PREVIEW = 'Hi, I’m Nasrin. This is how I sound.';
  function deviceVoices() {
    if (!canDevice) return [];
    const lang = (navigator.language || 'en').slice(0, 2).toLowerCase();
    const all = window.speechSynthesis.getVoices();
    const mine = all.filter((v) => v.lang.toLowerCase().startsWith(lang));
    const english = lang === 'en' ? [] : all.filter((v) => v.lang.toLowerCase().startsWith('en'));
    const seen = new Set();
    return mine.concat(english).filter((v) => !seen.has(v.voiceURI) && seen.add(v.voiceURI)).slice(0, 6);
  }

  function voiceRow(value, name, preview) {
    // preview(button) plays a short sample in this voice
    const row = document.createElement('div');
    row.className = 'voice';
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'voice';
    radio.value = value;
    radio.checked = currentVoice() === value;
    const text = document.createElement('span');
    text.className = 'voice-name';
    text.textContent = name;
    label.append(radio, text);
    const selected = document.createElement('span');
    selected.className = 'voice-selected';
    selected.textContent = 'Selected';
    selected.hidden = currentVoice() !== value;
    radio.addEventListener('change', () => {
      voiceChoice = value;
      saved.set(KEYS.voice, value);
      renderVoices();
    });
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'play';
    play.setAttribute('aria-label', 'Preview ' + name);
    play.setAttribute('aria-pressed', 'false');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICON_PLAY);
    icon.appendChild(path);
    play.appendChild(icon);
    play.addEventListener('click', () => {
      const mine = playing && playing.button === play;
      stopSpeaking();
      if (!mine) preview(play).catch(() => { notice.textContent = 'That voice could not be played right now.'; });
    });
    row.append(label, selected, play);
    return row;
  }

  function renderVoices() {
    const rows = [];
    const heading = (t) => { const h = document.createElement('h3'); h.textContent = t; return h; };
    if (speech.available && AudioCtx) {
      rows.push(heading('Natural voices'));
      for (const v of speech.voices) {
        rows.push(voiceRow('ai:' + v.id, v.name, (b) => playServerAudio({ voice: v.id, preview: true }, b)));
      }
    }
    if (canDevice) {
      rows.push(heading('On this phone'));
      rows.push(voiceRow('device:default', 'Phone voice', (b) => playDevice(PREVIEW, 'device:default', b)));
      for (const v of deviceVoices()) {
        rows.push(voiceRow('device:' + v.voiceURI, v.name, (b) => playDevice(PREVIEW, 'device:' + v.voiceURI, b)));
      }
    }
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'This browser cannot read replies aloud.';
      rows.push(p);
    }
    voicesBox.replaceChildren(...rows);
  }
  if (canDevice && 'onvoiceschanged' in window.speechSynthesis) {
    window.speechSynthesis.addEventListener('voiceschanged', () => { if (!sheet.hidden) renderVoices(); });
  }

  let lastFocus = null;
  // Settings is a menu: rows open their own page; Back returns to the menu.
  const PAGES = { main: ['pageMain', 'Settings'], general: ['pageGeneral', 'General'], voice: ['pageVoice', 'Voice'],
    memory: ['pageMemory', 'What Nasrin remembers'], data: ['pageData', 'Data controls'], about: ['pageAbout', 'About'],
    security: ['pageSecurity', 'Security and devices'], privacy: ['pagePrivacy', 'Privacy'], retention: ['pageRetention', 'Data retention'],
    usage: ['pageUsage', 'Usage'], billing: ['pageBilling', 'Billing'], notices: ['pageNotices', 'Notifications'],
    connect: ['pageConnect', 'NasrinAI Connect'], connectConfig: ['pageConnectConfig', 'Configure SmartChat'], connectPreview: ['pageConnectPreview', 'Preview SmartChat'] };
  const BACK_TO = { connectConfig: 'connect', connectPreview: 'connectConfig' };
  function showPage(name) {
    for (const [key, [id]] of Object.entries(PAGES)) $(id).hidden = key !== name;
    $('settingsTitle').textContent = PAGES[name][1];
    $('settingsBack').hidden = name === 'main';
    if (name === 'voice') renderVoices();
    if (name === 'memory') loadMemories();
    if (name === 'privacy' || name === 'memory') loadPrivacy();
    if (name === 'retention') loadRetention();
    if (name === 'usage') loadUsage();
    if (name === 'billing') loadBilling();
    if (name === 'notices') loadNoticeChoices();
    for (const id of ['dataStatus', 'securityStatus', 'privacyStatus', 'noticesStatus']) $(id).textContent = '';
    sheet.scrollTop = 0;
    (name === 'main' ? $('settingsClose') : $('settingsBack')).focus();
  }
  for (const b of document.querySelectorAll('#settings [data-page]')) b.addEventListener('click', () => showPage(b.dataset.page));
  $('settingsBack').addEventListener('click', () => {
    const current = Object.keys(PAGES).find((k) => !$(PAGES[k][0]).hidden);
    showPage(BACK_TO[current] || 'main');
  });

  function openSettings() {
    lastFocus = document.activeElement;
    showPage('main');
    loadAccounts();
    scrim.hidden = false;
    sheet.hidden = false;
    settingsBtn.setAttribute('aria-expanded', 'true');
    $('settingsClose').focus();
  }
  function closeSettings() {
    if (sheet.hidden) return;
    sheet.hidden = true;
    scrim.hidden = true;
    settingsBtn.setAttribute('aria-expanded', 'false');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  const headerSignIn = $('headerSignIn');
  if (headerSignIn) headerSignIn.addEventListener('click', () => openSignIn());
  settingsBtn.addEventListener('click', () => (sheet.hidden ? openSettings() : closeSettings()));
  $('settingsClose').addEventListener('click', closeSettings);
  scrim.addEventListener('click', () => { closeSettings(); closeSignIn(); closePlans(); closeHistory(); closePro(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeVoice(); closeSettings(); closeSignIn(); closePlans(); closeHistory(); closePro(); closeMenu(true); } });

  // ---------- account and sign-in ----------

  const accountBox = $('account');
  const accountLabel = $('accountLabel');
  const accountHint = $('accountHint');
  const accountBtn = $('accountBtn');
  const signinSheet = $('signin');
  const emailForm = $('emailForm');
  const codeForm = $('codeForm');
  const emailInput = $('email');
  const codeInput = $('code');
  const signinStatus = $('signinStatus');
  let signInMethods = { email: false, google: false };
  let pendingEmail = '';

  function renderAccount() {
    const can = signInMethods.email || signInMethods.google;
    accountBox.hidden = !can && !account;
    accountBox.classList.toggle('is-in', Boolean(account));
    accountLabel.textContent = account ? (account.email || 'Signed in') : 'Not signed in';
    accountHint.textContent = account ? 'Signed in. Your chats are kept with your account.' : 'Sign in to use Max and Ultra and keep your chats.';
    accountBtn.textContent = 'Sign in';
    accountBtn.hidden = Boolean(account);
    if (headerSignIn) headerSignIn.hidden = Boolean(account);
    showConnectForSignedIn();
    $('logoutMenu').hidden = !account;
  }

  // A new identity starts a new chat: a guest's conversation is not the account's.
  // Account-local browser state: the conversation pointer is namespaced by account email. Server data remains account-scoped.
  // ---------- Terms acceptance (recorded on the server) ----------

  const termsSheet = $('termsSheet');
  let termsVersion = null;
  let termsMethod = 'signin';

  // How NasrinAI works (AI can be wrong, where messages go, guest chats, voice):
  // shown in the Terms sheet, and kept in Settings to read again.
  function renderNotes(parts) {
    const list = $('termsNotes');
    list.textContent = '';
    for (const p of parts) {
      const li = document.createElement('li');
      li.textContent = p;
      list.appendChild(li);
    }
    $('settingsNotes').textContent = parts.join(' ');
  }

  function openTerms(lede, { canSignOut }) {
    $('termsLede').textContent = lede;
    $('termsCheck').checked = false;
    $('termsAccept').disabled = true;
    $('termsStatus').textContent = '';
    $('termsLater').hidden = !canSignOut;
    closeSettings(); closeSignIn(); closePlans();
    scrim.hidden = false;
    termsSheet.hidden = false;
    $('termsCheck').focus();
  }

  // A guest's first visit: the same sheet, once per browser (nothing is sent
  // to the server; signed-in users' acceptance is recorded there).
  function showFirstVisitNotice() {
    if (account || saved.get(KEYS.notice)) return;
    termsMethod = 'first_visit';
    openTerms('Please read how NasrinAI works.', { canSignOut: false });
  }

  async function checkTerms(method = 'update_prompt') {
    if (!account) return true;
    try {
      const st = await api('/v1/legal');
      termsVersion = st.terms_version;
      if (st.accepted) return true;
    } catch { return true; }
    termsMethod = method;
    openTerms(method === 'signin'
      ? 'Please read and accept NasrinAI’s Terms of Service.'
      : 'NasrinAI’s Terms of Service have changed. Please read and accept them to continue.', { canSignOut: true });
    return false;
  }
  $('termsCheck').addEventListener('change', () => { $('termsAccept').disabled = !$('termsCheck').checked; });
  $('termsAccept').addEventListener('click', async () => {
    $('termsAccept').disabled = true;
    if (termsMethod === 'first_visit') {
      saved.set(KEYS.notice, true);
      termsSheet.hidden = true;
      scrim.hidden = true;
      Nasrin.flash('happy', 1200);
      return;
    }
    try {
      await api('/v1/legal/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ terms_version: termsVersion, method: termsMethod }) });
      saved.set(KEYS.notice, true);
      termsSheet.hidden = true;
      scrim.hidden = true;
      Nasrin.flash('happy', 1200);
    } catch (err) {
      $('termsStatus').textContent = err.message;
      $('termsAccept').disabled = false;
      if (err.code === 'terms_changed') checkTerms(termsMethod);
    }
  });
  $('termsLater').addEventListener('click', async () => {
    termsSheet.hidden = true;
    scrim.hidden = true;
    try { await fetch('/v1/auth/sign-out', { method: 'POST', headers: { Authorization: 'Bearer ' + account.token } }); } catch { /* offline */ }
    signedOut();
    switchIdentity();
  });

  function switchIdentity() {
    conversationId = saved.get(identityKey(KEYS.conversation)) || null;
    stopSpeaking();
    clearScreen();
    renderAccount();
    if (aiAvailable) loadModels();
    loadPlans();
    renderDataControls();
    // Each account has its own choices: forget the last one's, ask if needed.
    myPrefs = null;
    libForget();
    libFiles = [];
    setChatProject(null);
    forgetNotices();
    startNotes('open');
  }

  // ---------- your data: download, delete chats, delete account ----------

  function renderDataControls() {
    $('memoryBtn').hidden = !account;
    $('exportData').hidden = !account;
    $('deleteAccount').hidden = !account;
    $('securityMenu').hidden = !account;
    $('openPrivacy').hidden = !account;
    $('openBilling').hidden = !(account && plansEnabled);
  }

  // ---------- Settings pages that read the server ----------

  const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  // Privacy choices: kept with the account on the server and enforced there.
  // Memory is opt-in: null means not chosen yet (off).
  let myPrefs = null;
  const MEMORY_BOXES = [['memoryPref', 'privacyStatus'], ['memoryPrefMain', 'memoryPrefStatus']];
  function showMemoryChoice() {
    for (const [id] of MEMORY_BOXES) { $(id).checked = Boolean(myPrefs && myPrefs.memory === true); $(id).disabled = !myPrefs; }
    $('libraryPrefRow').hidden = !libraryOn;
    $('libraryPref').checked = !myPrefs || myPrefs.library !== false;
    $('libraryPref').disabled = !myPrefs;
  }
  $('libraryPref').addEventListener('change', async () => {
    const box = $('libraryPref');
    const status = $('privacyStatus');
    box.disabled = true;
    status.textContent = 'Saving…';
    try {
      myPrefs = (await api('/v1/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ library: box.checked }) })).prefs;
      status.textContent = myPrefs.library === false ? 'Your Library is kept out of your chats.' : 'Matching parts of your Library may be used in your chats.';
    } catch (err) {
      status.textContent = err.message;
    } finally {
      showMemoryChoice();
    }
  });
  async function loadPrefs() {
    if (!account) { myPrefs = null; return null; }
    try { myPrefs = (await api('/v1/settings')).prefs; } catch { myPrefs = null; }
    showMemoryChoice();
    return myPrefs;
  }
  async function loadPrivacy() {
    for (const [id] of MEMORY_BOXES) $(id).disabled = true;
    if (!(await loadPrefs())) $('privacyStatus').textContent = 'These settings are not available right now.';
  }
  async function setMemory(on, statusId) {
    const status = statusId ? $(statusId) : null;
    for (const [id] of MEMORY_BOXES) $(id).disabled = true;
    if (status) status.textContent = 'Saving…';
    try {
      myPrefs = (await api('/v1/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ memory: on }) })).prefs;
      if (status) status.textContent = myPrefs.memory ? 'Memory is on. Nasrin may offer to remember things; you confirm each note.' : 'Memory is off. Nasrin will not offer to remember things or use your notes.';
      hideMemoryAsk();
      return true;
    } catch (err) {
      if (status) status.textContent = err.message;
      return false;
    } finally {
      showMemoryChoice();
    }
  }
  for (const [id, statusId] of MEMORY_BOXES) $(id).addEventListener('change', () => setMemory($(id).checked, statusId));

  // The one-time question: signed in, memory not chosen yet, not dismissed on
  // this device. Shown when the app opens or a new chat starts; never during a reply.
  function hideMemoryAsk() {
    const was = !$('memoryAsk').hidden;
    $('memoryAsk').hidden = true;
    if (was && noticeQueue.length) renderNotice();   // a notice waiting behind the question
  }
  async function maybeAskMemory() {
    hideMemoryAsk();
    if (!account || saved.get(KEYS.memoryAsk)) return;
    const prefs = myPrefs || await loadPrefs();
    if (!prefs || prefs.memory !== null || !account || busy) return;
    $('memoryAsk').hidden = false;
  }
  $('memoryAskYes').addEventListener('click', async () => { if (await setMemory(true)) Nasrin.flash('happy', 1200); });
  $('memoryAskNo').addEventListener('click', () => setMemory(false));
  $('memoryAskClose').addEventListener('click', () => { saved.set(KEYS.memoryAsk, { dismissed: new Date().toISOString() }); hideMemoryAsk(); });

  // ---------- in-app notices ----------
  //
  // Short notes when the app opens or a new chat starts (the list is on the
  // server). One at a time, above the message box, never during a reply.
  // Security, warning and error notices stay until closed; others count as
  // seen once the person starts chatting. Signed in: choices and closed
  // notices are kept with the account; guests: on this device.
  const NOTICE_KIND = { info: 'Tip', success: 'Done', warning: 'Heads up', error: 'Problem', security: 'Security', feature: 'New' };
  const STICKY = ['security', 'warning', 'error'];
  const noticeBox = $('appNotice');
  let noticeQueue = [];
  let noticeShown = null;
  let noticeRun = 0;
  const localNotices = () => {
    const v = saved.get(KEYS.notices);
    const seen = v && Array.isArray(v.seen) ? v.seen.filter((x) => typeof x === 'string').slice(-100) : [];
    return { seen, features: !(v && v.features === false), tips: !(v && v.tips === false) };
  };
  const saveLocalNotices = (change) => saved.set(KEYS.notices, { ...localNotices(), ...change });

  function noticeUseful(n) {
    if (localNotices().seen.includes(n.id)) return false;
    // Nothing to offer when Professional AI is missing or already on.
    if (n.action && n.action.target === 'professional' && (!proCatalog || proState.enabled)) return false;
    return true;
  }

  function hideNotice() {
    noticeBox.hidden = true;
    noticeShown = null;
  }

  function renderNotice() {
    hideNotice();
    while (noticeQueue.length && !noticeUseful(noticeQueue[0])) noticeQueue.shift();
    const n = noticeQueue[0];
    if (!n) return;
    // One card at a time: the memory question goes first unless this is urgent.
    if (!$('memoryAsk').hidden && !STICKY.includes(n.type)) return;
    noticeShown = n;
    noticeBox.dataset.type = n.type;
    noticeBox.setAttribute('role', n.type === 'security' || n.type === 'error' ? 'alert' : 'status');
    $('appNoticeKind').textContent = NOTICE_KIND[n.type] || '';
    $('appNoticeTitle').textContent = n.title;
    $('appNoticeBody').textContent = n.body;
    $('appNoticeActions').hidden = !n.action;
    $('appNoticeAction').textContent = n.action ? n.action.label : '';
    noticeBox.hidden = false;
  }

  function dismissNotice(n) {
    if (!n) return;
    const { seen } = localNotices();
    if (!seen.includes(n.id)) saveLocalNotices({ seen: [...seen, n.id].slice(-100) });
    if (account) api('/v1/notices/' + encodeURIComponent(n.id) + '/dismiss', { method: 'POST' }).catch(() => {});
    noticeQueue = noticeQueue.filter((x) => x.id !== n.id);
  }

  async function maybeShowNotices(when) {
    const run = ++noticeRun;
    noticeQueue = noticeQueue.filter((n) => STICKY.includes(n.type));
    let list = [];
    try {
      if (account) list = (await api('/v1/notices/mine?when=' + when)).notices;
      else {
        const resp = await net('/v1/notices?when=' + when);
        list = resp.ok ? (await resp.json()).notices : [];
        const mine = localNotices();
        list = list.filter((n) => (n.type !== 'feature' || mine.features) && ((n.type !== 'info' && n.type !== 'success') || mine.tips));
      }
    } catch { list = []; }
    if (run !== noticeRun || busy || !Array.isArray(list)) return;
    for (const n of list) if (n && typeof n.id === 'string' && !noticeQueue.some((x) => x.id === n.id)) noticeQueue.push(n);
    renderNotice();
  }

  // The person started chatting: optional notices are done (counted as seen).
  function noticesOnSend() {
    noticeRun++;
    if (noticeShown && !STICKY.includes(noticeShown.type)) dismissNotice(noticeShown);
    noticeQueue = noticeQueue.filter((x) => STICKY.includes(x.type));   // not shown yet: maybe next time
    if (noticeShown && !STICKY.includes(noticeShown.type)) renderNotice();
  }

  // App open or new chat: the memory question first, then notices.
  async function startNotes(when) {
    await maybeAskMemory();
    maybeShowNotices(when);
  }

  function forgetNotices() {
    noticeRun++;
    noticeQueue = [];
    hideNotice();
  }

  $('appNoticeClose').addEventListener('click', () => {
    dismissNotice(noticeShown);
    renderNotice();
    if (noticeBox.hidden) input.focus();
  });
  noticeBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); $('appNoticeClose').click(); } });
  $('appNoticeAction').addEventListener('click', () => {
    const n = noticeShown;
    if (!n || !n.action) return;
    dismissNotice(n);
    renderNotice();
    const target = n.action.target;
    if (target === 'plans') openPlans();
    else if (target === 'professional') openPro();
    else if (target === 'signin') openSignIn();
    else {
      openSettings();
      if (target === 'privacy' && !$('openPrivacy').hidden) showPage('privacy');
      else if (target === 'security' && !$('securityMenu').hidden) showPage('security');
    }
  });

  // Settings > Notifications.
  const NOTICE_BOXES = [['noticeFeatures', 'features'], ['noticeTips', 'tips']];
  async function loadNoticeChoices() {
    let choice = localNotices();
    if (account) {
      for (const [id] of NOTICE_BOXES) $(id).disabled = true;
      const prefs = await loadPrefs();
      if (!prefs || !prefs.notices) { $('noticesStatus').textContent = 'These settings are not available right now.'; return; }
      choice = prefs.notices;
    }
    for (const [id, key] of NOTICE_BOXES) { $(id).checked = choice[key] !== false; $(id).disabled = false; }
  }
  for (const [id, key] of NOTICE_BOXES) {
    $(id).addEventListener('change', async () => {
      const on = $(id).checked;
      if (!account) { saveLocalNotices({ [key]: on }); $('noticesStatus').textContent = 'Saved on this device.'; return; }
      for (const [b] of NOTICE_BOXES) $(b).disabled = true;
      $('noticesStatus').textContent = 'Saving…';
      try {
        myPrefs = (await api('/v1/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notices: { [key]: on } }) })).prefs;
        $('noticesStatus').textContent = 'Saved.';
      } catch (err) {
        $('noticesStatus').textContent = err.message;
      }
      for (const [b, k] of NOTICE_BOXES) { $(b).checked = Boolean(myPrefs && myPrefs.notices ? myPrefs.notices[k] !== false : $(b).checked); $(b).disabled = false; }
    });
  }

  // Data retention: the Privacy Notice's own list, so the two never disagree.
  async function loadRetention() {
    const box = $('retentionDoc');
    try {
      const resp = await net('/legal/privacy.md');
      if (!resp.ok) throw new Error();
      const text = await resp.text();
      const start = text.indexOf('## 6.');
      const end = text.indexOf('\n## ', start + 5);
      if (start < 0) throw new Error();
      const part = text.slice(text.indexOf('\n', start) + 1, end < 0 ? undefined : end).trim();
      box.replaceChildren(window.NasrinFormat.render(part).node);
    } catch {
      box.replaceChildren(mk('p', 'setting-hint', 'The list could not be loaded. It is in section 6 of the Privacy Notice.'));
    }
  }

  // Usage: numbers from the server, the same counters the limits use.
  function meter(label, used, limit, foot) {
    const row = mk('div', 'usage-item menu-card');
    const top = mk('div', 'usage-top');
    top.append(mk('span', 'usage-label', label), mk('span', 'usage-value', limit ? `${Math.round((used / limit) * 100)}% used` : ''));
    const bar = mk('div', 'usage-bar');
    const fill = mk('span', 'usage-fill');
    fill.style.width = (limit ? Math.min(100, (used / limit) * 100) : 0) + '%';
    bar.appendChild(fill);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', label);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(limit));
    bar.setAttribute('aria-valuenow', String(Math.min(used, limit)));
    row.append(top, bar, mk('p', 'setting-hint', foot));
    return row;
  }
  async function loadUsage() {
    const list = $('usageList');
    list.replaceChildren();
    $('usageNote').textContent = '';
    $('usageStatus').textContent = 'Loading…';
    try {
      const u = await api('/v1/usage');
      $('usageStatus').textContent = '';
      const resets = 'Resets at midnight, Philippine time.';
      const planName = u.plan ? ({ free: 'Free', max: 'Max', ultra: 'Ultra' }[u.plan.id] || 'Free') : null;
      if (planName) {
        const card = mk('div', 'menu-card');
        card.append(mk('p', 'card-title', `${planName} plan`), mk('p', 'setting-hint', u.plan.ends_at ? `Active until ${fmtDate(u.plan.ends_at)}.` : 'No end date.'));
        list.appendChild(card);
      }
      if (u.chat) {
        const left = Math.max(0, u.chat.limit - u.chat.used);
        list.appendChild(meter('Chat today', u.chat.used, u.chat.limit, `${left ? Math.round((left / u.chat.limit) * 100) + '% left' : 'Used up for today'}. ${resets}`));
      }
      if (u.pictures) {
        const left = Math.max(0, u.pictures.limit - u.pictures.used);
        const per = u.pictures.period === 'day' ? 'today' : 'in this guest session';
        list.appendChild(meter(`Pictures ${per}`, u.pictures.used, u.pictures.limit,
          `${u.pictures.used} of ${u.pictures.limit} made, ${left} left.` + (u.pictures.period === 'day' ? ' ' + resets : ' Sign in for more.')));
      }
      if (u.hourly) {
        $('usageNote').textContent = `To keep things fair there are also hourly limits: up to ${u.hourly.messages} messages and ${u.hourly.read_aloud} read-aloud replies an hour.` +
          (u.chat ? '' : ' Guests share a daily allowance; sign in for your own.');
      }
    } catch (err) {
      $('usageStatus').textContent = err.message;
    }
  }

  // Billing: the plan and this account's own payments (no card details exist here).
  async function loadBilling() {
    const cur = $('billingCurrent');
    const hist = $('billingHistory');
    cur.replaceChildren(mk('p', 'setting-hint', 'Loading…'));
    hist.replaceChildren();
    try {
      const b = await api('/v1/billing');
      const name = (id) => ({ free: 'Free', max: 'Max', ultra: 'Ultra' }[id] || 'Free');
      const active = b.plan && b.plan.id !== 'free';
      cur.replaceChildren(
        mk('p', 'card-title', `${name(b.plan && b.plan.id)} plan`),
        mk('p', 'setting-hint', active ? `Active until ${fmtDate(b.plan.ends_at)}. It ends on its own; buy again to extend.` : 'Free. Max and Ultra are paid once per period.')
      );
      if (!b.payments.length) { hist.appendChild(mk('p', 'setting-hint', 'No payments yet.')); return; }
      for (const p of b.payments) {
        const row = mk('div', 'pay-row');
        const money = p.amount !== null ? `${p.currency === 'PHP' ? '₱' : (p.currency || '') + ' '}${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
        row.append(
          mk('span', 'pay-what', `${name(p.plan)} plan`),
          mk('span', 'pay-amount', money),
          mk('span', 'setting-hint', `${fmtDate(p.starts_at)} – ${fmtDate(p.ends_at)} · paid ${fmtDate(p.paid_at)}${p.via ? ' via ' + p.via : ''}`)
        );
        hist.appendChild(row);
      }
    } catch (err) {
      cur.replaceChildren(mk('p', 'setting-hint', err.message));
    }
  }
  $('billingPlans').addEventListener('click', () => openPlans());

  // Clear cache: only what this page saved on this device. Sign-in, the guest
  // session, appearance and everything on the server stay.
  $('clearCache').addEventListener('click', async () => {
    for (const k of [KEYS.conversation, KEYS.model, KEYS.voice, KEYS.speak]) saved.del(k);
    try { sessionStorage.clear(); } catch { /* blocked */ }
    try { if (window.caches) for (const k of await caches.keys()) await caches.delete(k); } catch { /* none */ }
    voiceChoice = null;
    speakOn = false;
    readAloud.checked = false;
    stopSpeaking();
    conversationId = null;
    clearScreen();
    if (aiAvailable) loadModels();
    $('dataStatus').textContent = 'Cache cleared. You are still signed in and your chats are safe on your account.';
  });

  // Reduce motion: this device only (it is about this screen).
  const motionBox = $('reduceMotion');
  motionBox.checked = reduced();
  motionBox.addEventListener('change', () => {
    if (motionBox.checked) { saved.set(KEYS.motion, 'reduce'); document.documentElement.setAttribute('data-motion', 'reduce'); }
    else { saved.del(KEYS.motion); document.documentElement.removeAttribute('data-motion'); }
    motionBox.checked = reduced();
  });
  // What Nasrin remembers: notes the person confirmed; each can be deleted.
  async function loadMemories() {
    const list = $('memoryList');
    list.replaceChildren();
    $('memoryStatus').textContent = 'Loading…';
    try {
      const { memories } = await api('/v1/memories');
      for (const m of memories || []) {
        const li = document.createElement('li');
        li.className = 'history-item';
        const t = document.createElement('span');
        t.className = 'history-open memory-text';
        t.textContent = m.text;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'text-btn';
        del.textContent = 'Delete';
        del.setAttribute('aria-label', `Delete “${m.text}”`);
        del.addEventListener('click', async () => {
          del.disabled = true;
          try { await api('/v1/memories/' + encodeURIComponent(m.id), { method: 'DELETE' }); li.remove(); if (!list.children.length) loadMemories(); }
          catch (err) { $('memoryStatus').textContent = err.message; del.disabled = false; }
        });
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'text-btn';
        edit.textContent = 'Edit';
        edit.setAttribute('aria-label', `Edit “${m.text}”`);
        edit.addEventListener('click', () => {
          const field = document.createElement('input');
          field.type = 'text';
          field.className = 'memory-edit';
          field.maxLength = 300;
          field.value = m.text;
          field.setAttribute('aria-label', 'Edit note');
          const save = document.createElement('button');
          save.type = 'button';
          save.className = 'text-btn';
          save.textContent = 'Save';
          const cancel = document.createElement('button');
          cancel.type = 'button';
          cancel.className = 'text-btn';
          cancel.textContent = 'Cancel';
          cancel.addEventListener('click', () => loadMemories());
          const commit = async () => {
            save.disabled = true;
            try {
              await api('/v1/memories/' + encodeURIComponent(m.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: field.value }) });
              loadMemories();
            } catch (err) { $('memoryStatus').textContent = err.message; save.disabled = false; }
          };
          save.addEventListener('click', commit);
          field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.stopPropagation(); loadMemories(); } });
          li.replaceChildren(field, save, cancel);
          field.focus();
        });
        li.append(t, edit, del);
        list.appendChild(li);
      }
      $('memoryStatus').textContent = list.children.length ? '' : 'Nothing yet. Ask Nasrin to remember something, then confirm it.';
      $('memoryClear').hidden = !list.children.length;
    } catch (err) {
      $('memoryStatus').textContent = err.message || 'Your notes could not be loaded. Please try again.';
    }
  }
  $('memoryClear').addEventListener('click', async () => {
    if (!window.confirm('Forget everything Nasrin remembers about you?')) return;
    try { await api('/v1/memories', { method: 'DELETE' }); loadMemories(); } catch (err) { $('memoryStatus').textContent = err.message; }
  });

  $('exportData').addEventListener('click', async () => {
    try {
      const token = await credential(false);
      const resp = await fetch('/v1/account/export', { headers: { Authorization: 'Bearer ' + token } });
      if (!resp.ok) throw await errorFrom(resp);
      const url = URL.createObjectURL(await resp.blob());
      const a = document.createElement('a');
      a.href = url; a.download = 'nasrinai-my-data.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) { notice.textContent = err.message || 'Your data could not be downloaded right now.'; }
  });
  $('deleteChats').addEventListener('click', async () => {
    if (!window.confirm('Delete all your chats? This cannot be undone.')) return;
    try {
      await api('/v1/conversations', { method: 'DELETE' });
      conversationId = null;
      saved.del(identityKey(KEYS.conversation));
      clearScreen();
      closeSettings();
      notice.textContent = 'All your chats were deleted.';
    } catch (err) { notice.textContent = err.message; }
  });
  $('deleteAccount').addEventListener('click', async () => {
    const typed = window.prompt('This deletes your account, chats and pictures. Payment and Terms records are kept as the Privacy Notice explains. Type DELETE to confirm.');
    if (typed !== 'DELETE') return;
    try {
      await api('/v1/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) });
      signedOut();
      closeSettings();
      switchIdentity();
      notice.textContent = 'Your account was deleted.';
    } catch (err) { notice.textContent = err.message; }
  });

  function signedIn(data) {
    if (!data || typeof data.access_token !== 'string') { signedOut(); return null; }
    const email = data.user && typeof data.user.email === 'string' ? data.user.email : '';
    activeAccountEmail = email;
    account = { email, token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    saved.set(KEYS.account, { email });
    renderAccount();
    return account;
  }

  function signedOut() {
    activeAccountEmail = null;
    account = null;
    saved.del(KEYS.account);
    renderAccount();
    renderImageHint();
  }

  function setSigninStep(step) {
    emailForm.hidden = step !== 'email';
    codeForm.hidden = step !== 'code';
    const google = signInMethods.google && step === 'email';
    $('googleBtn').hidden = !google;
    $('orLine').hidden = !(google && signInMethods.email);
    if (!signInMethods.email) emailForm.hidden = true;
  }

  function openSignIn(message) {
    closeSettings();
    lastFocus = document.activeElement;
    setSigninStep('email');
    signinStatus.textContent = message || '';
    scrim.hidden = false;
    signinSheet.hidden = false;
    (signInMethods.email ? emailInput : $('googleBtn')).focus();
  }
  function closeSignIn() {
    if (signinSheet.hidden) return;
    signinSheet.hidden = true;
    scrim.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('signinClose').addEventListener('click', closeSignIn);

  async function postAuth(path, body) {
    const resp = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!resp.ok) throw await errorFrom(resp);
    return resp.json();
  }

  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { signinStatus.textContent = 'Enter a valid email address.'; return; }
    $('emailBtn').disabled = true;
    signinStatus.textContent = 'Sending…';
    try {
      await postAuth('/v1/auth/email/start', { email });
      pendingEmail = email;
      $('codeLabel').textContent = `Enter the code we sent to ${email}`;
      setSigninStep('code');
      signinStatus.textContent = 'Check your inbox (and spam). The code works for a few minutes.';
      codeInput.value = '';
      codeInput.focus();
    } catch (err) {
      signinStatus.textContent = err.message;
    } finally {
      $('emailBtn').disabled = false;
    }
  });

  codeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = codeInput.value.replace(/\s+/g, '');
    if (!/^\d{6,10}$/.test(code)) { signinStatus.textContent = 'Enter the code from the email.'; return; }
    $('codeBtn').disabled = true;
    signinStatus.textContent = 'Signing in…';
    try {
      signedIn(await postAuth('/v1/auth/email/verify', { email: pendingEmail, code }));
      closeSignIn();
      switchIdentity();
      checkTerms('signin');
      Nasrin.flash('happy', 1600);
    } catch (err) {
      signinStatus.textContent = err.message;
      Nasrin.flash('concerned', 900);
    } finally {
      $('codeBtn').disabled = false;
    }
  });
  codeInput.addEventListener('input', () => {
    const digits = codeInput.value.replace(/\D/g, '');
    if (digits !== codeInput.value) codeInput.value = digits;
    if (digits.length === 6) codeForm.requestSubmit();
  });
  $('otherEmail').addEventListener('click', () => { setSigninStep('email'); signinStatus.textContent = ''; emailInput.focus(); });

  $('logoutBtn').addEventListener('click', () => accountBtn.click());
  accountBtn.addEventListener('click', async () => {
    if (!account) { openSignIn(); return; }
    accountBtn.disabled = true;
    try {
      await fetch('/v1/auth/sign-out', { method: 'POST', headers: { Authorization: 'Bearer ' + account.token } });
    } catch { /* offline: still sign out here */ }
    accountBtn.disabled = false;
    signedOut();
    closeSettings();
    switchIdentity();
    await afterSignOut();
  });

  // After logging out: one other account on this device takes over; with
  // several, the person chooses; with none, the sign-in sheet opens. An
  // account whose sign-in has expired is dropped by the server, never chosen.
  async function afterSignOut() {
    for (let tries = 0; tries < 3; tries++) {
      await loadAccounts();
      if (!otherAccounts.length) { openSignIn('You are signed out.'); return; }
      if (otherAccounts.length > 1) {
        openSettings();
        accountHint.textContent = 'You are signed out. Choose an account, or sign in.';
        return;
      }
      if (await switchAccount(otherAccounts[0])) return;
    }
  }

  // ---------- more than one account on this device ----------
  // The server keeps the other accounts' sign-in in an HttpOnly cookie; the
  // page only sees their emails. Each account has its own plan and chats.

  let otherAccounts = [];
  let maxAccounts = 3;

  function menuIcon(cls, d) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
  }

  function accountRow(label, icon, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-row';
    const span = document.createElement('span');
    span.textContent = label;
    b.append(menuIcon('ico', icon), span, menuIcon('chev', 'm9 6 6 6-6 6'));
    b.addEventListener('click', onClick);
    return b;
  }

  function renderAccounts() {
    const box = $('accountsMenu');
    box.textContent = '';
    for (const email of otherAccounts) {
      box.appendChild(accountRow(`Switch to ${email}`, 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0', () => switchAccount(email)));
    }
    if (account && otherAccounts.length < maxAccounts - 1) {
      box.appendChild(accountRow('Add account', 'M12 5v14M5 12h14', addAccount));
    }
    box.hidden = !box.firstChild;
  }

  async function loadAccounts() {
    if (!(signInMethods.email || signInMethods.google)) { otherAccounts = []; renderAccounts(); return; }
    try {
      const resp = await fetch('/v1/auth/accounts');
      const data = resp.ok ? await resp.json() : null;
      const list = data && Array.isArray(data.accounts) ? data.accounts : [];
      otherAccounts = list.map((a) => (a && typeof a.email === 'string' ? a.email : '')).filter((e) => e && e !== (account && account.email));
      if (data && Number.isInteger(data.max)) maxAccounts = data.max;
    } catch { otherAccounts = []; }
    renderAccounts();
  }

  async function addAccount() {
    try {
      await postAuth('/v1/auth/accounts/add', {});
    } catch (err) {
      if (err.code !== 'signed_out') { accountHint.textContent = err.message; return; }
    }
    signedOut();
    switchIdentity();
    await loadAccounts();
    openSignIn('Sign in with another account. Your other accounts stay on this device.');
  }

  async function switchAccount(email) {
    try {
      signedIn(await postAuth('/v1/auth/accounts/switch', { email }));
    } catch (err) {
      await loadAccounts();
      accountHint.textContent = err.message;
      return false;
    }
    closeSettings();
    switchIdentity();
    checkTerms('signin');
    loadAccounts();
    Nasrin.flash('happy', 1200);
    return true;
  }

  // Another tab signed in, out or switched: follow it.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEYS.account) return;
    const email = saved.get(KEYS.account)?.email || null;
    if (email !== (account ? account.email : null)) location.reload();
  });

  $('signOutOthers').addEventListener('click', async () => {
    const status = $('securityStatus');
    if (!account) return;
    if (!confirm('Sign out of NasrinAI on every other phone and computer? This one stays signed in.')) return;
    $('signOutOthers').disabled = true;
    status.textContent = 'Signing out other devices…';
    try {
      const resp = await net('/v1/auth/sign-out-others', { method: 'POST', headers: { Authorization: 'Bearer ' + (await credential(false)) } });
      if (!resp.ok) throw await errorFrom(resp);
      status.textContent = 'Done. Other devices will need to sign in again.';
    } catch (err) {
      status.textContent = err.message;
    } finally {
      $('signOutOthers').disabled = false;
    }
  });

  // Back from Google: /?signin=ok or /?signin=failed.
  const signinResult = new URLSearchParams(location.search).get('signin');
  if (signinResult) history.replaceState(null, '', location.pathname);

  // ---------- talking instead of typing ----------

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;

  function setListening(on) {
    listening = on;
    micBtn.setAttribute('aria-pressed', String(on));
    micBtn.title = on ? 'Stop listening' : 'Dictate message';
    micBtn.setAttribute('aria-label', on ? 'Stop listening' : 'Dictate message');
    if (on) Nasrin.mood('listening');
    else if (Nasrin.current === 'listening') Nasrin.mood('idle');
  }

  if (!Recognition) {
    // The combined composer remains the Send button; only dictation is unavailable.
  } else {
    $('voiceBtn').hidden = false;
    $('voiceBtn').addEventListener('click', openVoice);
    micBtn.addEventListener('click', (event) => {
      // One control: empty composer = speech-to-text; typed message = Send.
      if (input.value.trim() || pending.length || turn) return;
      event.preventDefault();
      if (recognizer) { recognizer.stop(); return; }
      stopSpeaking();
      notice.textContent = '';
      const before = input.value.trim();
      let heard = '';
      recognizer = new Recognition();
      recognizer.lang = navigator.language || 'en-US';
      recognizer.interimResults = true;
      recognizer.continuous = false;

      recognizer.onresult = (e) => {
        heard = '';
        for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
        input.value = (before ? before + ' ' : '') + heard.trim();
        autosize();
        Nasrin.tick();
      };
      recognizer.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          notice.textContent = 'Microphone access is blocked. Allow it in your browser settings to talk to Nasrin.';
        } else if (e.error === 'no-speech') {
          notice.textContent = 'Nothing was heard. Tap the mic and try again.';
        } else if (e.error !== 'aborted') {
          notice.textContent = 'Voice typing stopped. You can type instead.';
        }
      };
      // Dictation only fills the message box; the message is sent when Send is tapped.
      recognizer.onend = () => {
        recognizer = null;
        setListening(false);
        if (heard.trim()) input.focus();
      };

      try {
        recognizer.start();
        setListening(true);
      } catch {
        recognizer = null;
        notice.textContent = 'Voice typing could not start. You can type instead.';
      }
    });
  }


  // ---------- talking with Nasrin: a hands-free voice conversation ----------
  //
  // Tap the voice button once and just talk. Nasrin listens, notices when you
  // stop, answers out loud, then listens again, with no typing and no tapping.
  // The big character shows what is happening (listening, thinking, talking,
  // with a mouth that moves with the voice and an expression that follows the
  // mood of the reply) and a small chat box under it shows the conversation.
  // The same chat is kept in the main screen. While Nasrin talks (or
  // thinks) a second, watching microphone listens only for you speaking over her:
  // words that are not just her own voice coming back stop her at once and become
  // your turn. The microphone pauses after a quiet while.

  const voiceEl = $('voice');
  const voiceLog = $('voiceLog');
  const voiceStatus = $('voiceStatus');
  const voiceMute = $('voiceMute');
  const voiceSkip = $('voiceSkip');
  const SILENCE_MS = 800;       // this long after you stop talking, you are done
  const FINAL_SILENCE_MS = 350; // ...or this long once the phone has finalised your words
  const IDLE_MS = 90_000;       // nothing said for this long: the microphone pauses
  const MOODS = { listening: 'listening', thinking: 'thinking', speaking: 'speaking' };

  function voiceState(state, label) {
    vc.state = state;
    voiceEl.dataset.state = state;
    voiceStatus.textContent = label;
    voiceSkip.hidden = !(state === 'speaking' || state === 'thinking');
    Nasrin.mood(MOODS[state] || 'idle');
  }

  // One line in the small chat box. The newest 40 stay.
  function voiceSay(role, text) {
    const el = document.createElement('div');
    el.className = 'vmsg ' + role;
    el.textContent = text;
    voiceLog.appendChild(el);
    while (voiceLog.children.length > 40) voiceLog.firstElementChild.remove();
    voiceLog.scrollTop = voiceLog.scrollHeight;
    return el;
  }

  function voiceFiles(el, files) {
    for (const f of files) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vfile';
      b.textContent = 'Download ' + f.name;
      b.addEventListener('click', () => downloadFile(f, b));
      el.appendChild(b);
    }
  }

  function resetIdle() {
    clearTimeout(vc.idle);
    vc.idle = setTimeout(() => muteVoice(true, 'Paused. Tap Unmute to keep talking.'), IDLE_MS);
  }

  async function keepAwake() {
    try { if (navigator.wakeLock) vc.wake = await navigator.wakeLock.request('screen'); } catch { /* not allowed: fine */ }
  }

  function muteVoice(on, label) {
    vc.muted = on;
    voiceMute.setAttribute('aria-pressed', String(on));
    voiceMute.setAttribute('aria-label', on ? 'Unmute microphone' : 'Mute microphone');
    voiceMute.title = on ? 'Unmute microphone' : 'Mute microphone';
    if (on) {
      vc.run += 1;
      clearTimeout(vc.silence);
      clearTimeout(vc.idle);
      try { if (vc.recognizer) vc.recognizer.abort(); } catch { /* already stopped */ }
      vc.recognizer = null;
      stopWatching();
      if (vc.realtimeStream) vc.realtimeStream.getAudioTracks().forEach((t) => { t.enabled = false; });
      if (vc.state === 'listening') voiceState('paused', label || 'Mic is muted. Tap Unmute to talk.');
    } else if (vc.realtime) {
      if (vc.realtimeStream) vc.realtimeStream.getAudioTracks().forEach((t) => { t.enabled = true; });
      voiceState('listening', 'Listening…');
    } else if (vc.state === 'paused') {
      listenVoice();
    }
  }

  function listenVoice(seed = '') {
    if (!vc.on || vc.muted) return;
    stopWatching();
    const run = ++vc.run;
    // `seed`: what you had already said when you talked over Nasrin.
    const prefix = seed ? seed.trim() + ' ' : '';
    let heard = seed.trim();
    let done = false;
    let line = null;
    const startedAt = Date.now();
    const rec = new Recognition();
    vc.recognizer = rec;
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    voiceState('listening', 'Listening…');
    resetIdle();

    const finish = () => {
      if (done || run !== vc.run) return;
      const said = heard.trim();
      if (!said) return;
      done = true;
      clearTimeout(vc.silence);
      clearTimeout(vc.idle);
      try { rec.abort(); } catch { /* already stopped */ }
      vc.recognizer = null;
      line.classList.remove('is-live');
      line.textContent = said;
      answerVoice(said);
    };

    rec.onresult = (e) => {
      if (run !== vc.run) return;
      heard = prefix;
      for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
      if (!heard.trim()) return;
      vc.quick = 0;
      if (!line) { line = voiceSay('user is-live', ''); }
      line.textContent = heard.trim();
      voiceLog.scrollTop = voiceLog.scrollHeight;
      Nasrin.tick();
      resetIdle();
      clearTimeout(vc.silence);
      const lastResult = e.results[e.results.length - 1];
      vc.silence = setTimeout(finish, lastResult && lastResult.isFinal ? FINAL_SILENCE_MS : SILENCE_MS);
    };
    rec.onerror = (e) => {
      if (run !== vc.run) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') closeVoice('Microphone access is blocked. Allow it in your browser settings to talk to Nasrin.');
      else if (e.error === 'audio-capture') closeVoice('No microphone was found.');
      else if (e.error === 'network') closeVoice('Voice recognition needs an internet connection.');
    };
    rec.onend = () => {
      if (done || run !== vc.run) return;
      clearTimeout(vc.silence);
      vc.recognizer = null;
      if (heard.trim()) { finish(); return; }
      // The browser ends a quiet session by itself: start again, unless it keeps failing at once.
      vc.quick = Date.now() - startedAt < 700 ? vc.quick + 1 : 0;
      if (vc.quick >= 6) { closeVoice('Voice recognition stopped working. Try again in a moment.'); return; }
      setTimeout(listenVoice, 250);
    };
    try { rec.start(); } catch { closeVoice('Voice could not start. You can type instead.'); return; }
    if (seed.trim()) {
      line = voiceSay('user is-live', seed.trim());
      vc.silence = setTimeout(finish, SILENCE_MS);
    }
  }

  // ---- talking over Nasrin ----
  const wordsOf = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').split(/\s+/).filter(Boolean);

  // Is this you, or is it Nasrin's own voice coming back through the speaker?
  function isYou(heard, spoken) {
    const h = wordsOf(heard);
    if (!h.length || (h.length < 2 && heard.trim().length < 4)) return false;   // a stray noise
    if (!spoken) return true;
    const said = String(spoken).toLowerCase();
    if (said.includes(h.join(' '))) return false;                                 // a run of her own words
    const known = new Set(wordsOf(spoken));
    const echoed = h.filter((w) => known.has(w)).length;
    return echoed / h.length < 0.6;
  }

  function stopWatching() {
    const w = vc.watcher;
    vc.watcher = null;
    if (w) w.stop();
  }

  // Listens while Nasrin thinks and talks. `spoken()` gives the reply so far.
  function watchForInterrupt(run, spoken) {
    if (!Recognition || !vc.on || vc.muted) return;
    stopWatching();
    let rec;
    try { rec = new Recognition(); } catch { return; }
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    let off = false;
    let quick = 0;
    let began = Date.now();
    const handle = { stop() { off = true; try { rec.abort(); } catch { /* already stopped */ } } };
    rec.onresult = (e) => {
      if (off) return;
      if (!vc.on || run !== vc.run) { handle.stop(); return; }
      let heard = '';
      for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
      if (!isYou(heard, spoken())) return;
      // You spoke over her: she stops now, and what you said so far is your turn.
      handle.stop();
      if (vc.watcher === handle) vc.watcher = null;
      stopSpeaking();
      if (turn) turn.ctrl.abort();
      Nasrin.emotion(null);
      Nasrin.talk(0);
      listenVoice(heard.trim());
    };
    rec.onerror = () => { /* the main listener reports real problems */ };
    rec.onend = () => {
      if (off || !vc.on || run !== vc.run) return;
      // The browser ends a quiet session by itself: start again, unless it keeps failing at once.
      quick = Date.now() - began < 700 ? quick + 1 : 0;
      if (quick >= 4) return;
      began = Date.now();
      setTimeout(() => { if (!off && vc.on && run === vc.run) { try { rec.start(); } catch { /* gives up */ } } }, 200);
    };
    try { rec.start(); } catch { return; }
    vc.watcher = handle;
  }

  // The expression Nasrin shows while saying a reply.
  const emotionOf = (text) => ({ positive: 'happy', negative: 'concerned', neutral: null })[Nasrin.tone(text)];

  async function answerVoice(said) {
    const run = ++vc.run;
    voiceState('thinking', 'Thinking…');
    const reply = voiceSay('assistant is-live', '…');
    let raw = '';
    let live = null;   // speech that arrives while the reply is still being written
    const voice = currentVoice();
    const natural = voice.startsWith('ai:') && speech.available && Boolean(AudioCtx);
    watchForInterrupt(run, () => raw);
    const result = await runTurn({
      text: said, spoken: true,
      speakVoice: natural ? voice.slice(3) : null,
      onPiece: (piece) => {
        // Another model took over: what was said so far is dropped.
        if (piece === null && live) { stopSpeaking(); live = null; if (vc.on) voiceState('thinking', 'Thinking…'); }
        raw = piece === null ? '' : raw + piece;
        reply.textContent = window.NasrinFiles.strip(raw) || '…';
        voiceLog.scrollTop = voiceLog.scrollHeight;
      },
      onAudio: (ev) => {
        if (!vc.on || run !== vc.run) return;
        if (!live) {
          live = liveAudio(() => {
            if (!vc.on || run !== vc.run) return;
            voiceState('speaking', 'Talking…');
            Nasrin.emotion(emotionOf(window.NasrinFiles.strip(raw)));
          });
          if (!live) return;
        }
        live.add(ev.data);
      },
      onFail: (err, aborted) => {
        reply.classList.remove('is-live');
        if (aborted) reply.remove();
        else reply.textContent = err.message || 'Something went wrong.';
      }
    });
    if (!vc.on || run !== vc.run) return;
    if (!result || !result.data.message) {
      if (live) { stopSpeaking(); Nasrin.emotion(null); }
      if (reply.isConnected && reply.textContent === '…') reply.remove();
      setTimeout(listenVoice, 600);
      return;
    }
    const parsed = window.NasrinFiles.parse(result.data.message.content);
    reply.classList.remove('is-live');
    reply.textContent = parsed.text || 'Done. Your file is ready.';
    voiceFiles(reply, parsed.files);
    voiceLog.scrollTop = voiceLog.scrollHeight;

    if (live) {
      // The server has sent every sentence; let the last ones finish playing.
      live.end();
      await live.done;
      Nasrin.emotion(null);
      Nasrin.talk(0);
      if (!vc.on || run !== vc.run) return;
    } else if (parsed.text && canSpeakAnything()) {
      // No speech came with the reply (a phone voice, or the server could not make it): read it now.
      voiceState('speaking', 'Talking…');
      Nasrin.emotion(emotionOf(parsed.text));
      try { await readReply(parsed.text, result.data.message.id, null); } catch { /* the text is on screen */ }
      Nasrin.emotion(null);
      Nasrin.talk(0);
      if (!vc.on || run !== vc.run) return;
    }
    stopWatching();
    if (vc.on && !vc.muted) listenVoice();
    else if (vc.on) voiceState('paused', 'Mic is muted. Tap Unmute to talk.');
  }

  // Stops Nasrin talking (or thinking) so you can speak.
  function interruptVoice() {
    if (!vc.on) return;
    if (vc.realtime) {
      if (vc.realtimeProvider === 'gemini') { try { window.NasrinGeminiRealtime?.stop(vc.geminiState); } catch {} }
      else try { vc.realtimeEvents?.send(JSON.stringify({ type: 'response.cancel' })); } catch {}
      voiceState('listening', 'Listening…');
      return;
    }
    // The reply may still be being written while Nasrin talks: stop both.
    // Speech that is already done: the reply ends and listening starts again.
    if (vc.state === 'speaking') { stopSpeaking(); if (turn) turn.ctrl.abort(); }
    else if (vc.state === 'thinking' && turn) turn.ctrl.abort();
  }

  async function startRealtimeVoice() {
    const selected = currentVoice();
    if (!selected.startsWith('ai:')) return false;
    if (!window.RTCPeerConnection && !window.WebSocket) return false;
    try {
      voiceState('thinking', 'Starting secure realtime voice…');
      const session = await api('/v1/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: currentModel || undefined, voice: selected.slice(3) })
      });
      if (session.provider === 'gemini') {
        if (!window.NasrinGeminiRealtime) return false;
        const map = { coral:'Kore', nova:'Aoede', shimmer:'Leda', sage:'Charon', ash:'Puck', echo:'Orus', alloy:'Zephyr', ballad:'Fenrir', verse:'Puck', marin:'Kore', cedar:'Charon' };
        session.gemini_voice = map[selected.slice(3)] || 'Kore';
        vc.geminiState = await window.NasrinGeminiRealtime.start(session, {
          state: (s) => { vc.geminiState = s; vc.realtimeStream = s.stream; },
          active: () => vc.realtime, muted: () => vc.muted,
          open: () => { vc.realtimeProvider='gemini'; vc.realtime=true; voiceState('listening','Listening…'); Nasrin.mood('idle'); },
          input: (t) => { voiceSay('user',t); voiceState('thinking','Thinking…'); },
          output: (t) => { let x=voiceLog.querySelector('.voice-line.assistant.is-realtime'); if(!x){x=voiceSay('assistant is-live','');x.classList.add('is-realtime');} x.textContent+=t; voiceState('speaking','Talking…'); Nasrin.talk(1); },
          interrupted: () => { voiceState('listening','Listening…'); Nasrin.talk(0); },
          complete: () => { const x=voiceLog.querySelector('.voice-line.assistant.is-realtime'); if(x)x.classList.remove('is-realtime'); voiceState('listening','Listening…'); Nasrin.talk(0); },
          error: () => closeVoice('Gemini realtime voice stopped. Please try again.'),
          close: () => { if(vc.on&&vc.realtimeProvider==='gemini') closeVoice('Realtime voice connection ended. Please try again.'); }
        });
        vc.realtimeMaxSeconds = Number(session.max_seconds) || 300;
        clearTimeout(vc.realtimeTimer);
        vc.realtimeTimer = setTimeout(() => { if(vc.realtime) closeVoice('This realtime session reached its tier limit. Start a new session to continue.'); }, Math.max(60,vc.realtimeMaxSeconds)*1000);
        return true;
      }
      if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) return false;
      const pc = new RTCPeerConnection();
      const events = pc.createDataChannel('oai-events');
      const audio = document.createElement('audio');
      audio.autoplay = true; audio.playsInline = true; audio.setAttribute('aria-hidden', 'true'); audio.style.display = 'none';
      document.body.appendChild(audio);
      pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play().catch(() => {}); };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
      events.addEventListener('message', (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'input_audio_transcription.done' && msg.transcript) {
          voiceSay('user', msg.transcript); voiceLog.scrollTop = voiceLog.scrollHeight; voiceState('thinking', 'Thinking…');
        } else if ((msg.type === 'response.audio_transcript.delta' || msg.type === 'response.output_audio_transcript.delta') && msg.delta) {
          let last = voiceLog.querySelector('.voice-line.assistant.is-realtime');
          if (!last) { last = voiceSay('assistant is-live', ''); last.classList.add('is-realtime'); }
          last.textContent += msg.delta; voiceLog.scrollTop = voiceLog.scrollHeight; voiceState('speaking', 'Talking…'); Nasrin.talk(1);
        } else if (msg.type === 'response.audio_transcript.done' || msg.type === 'response.output_audio_transcript.done') {
          const last = voiceLog.querySelector('.voice-line.assistant.is-realtime'); if (last) last.classList.remove('is-realtime');
          voiceState('listening', 'Listening…'); Nasrin.talk(0);
        } else if (msg.type === 'input_audio_buffer.speech_started') {
          voiceState('listening', 'Listening…'); Nasrin.talk(0);
        } else if (msg.type === 'error') closeVoice(msg.error?.message || 'Realtime voice stopped. Please try again.');
      });
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      const answer = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST', headers: { Authorization: 'Bearer ' + session.value, 'Content-Type': 'application/sdp' }, body: offer.sdp
      });
      if (!answer.ok) throw new Error('Realtime connection could not be established.');
      await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
      vc.realtimePc = pc; vc.realtimeEvents = events; vc.realtimeStream = stream; vc.realtimeAudio = audio; vc.realtimeProvider = 'openai'; vc.realtime = true;
      vc.realtimeMaxSeconds = Number(session.max_seconds) || 900;
      clearTimeout(vc.realtimeTimer);
      vc.realtimeTimer = setTimeout(() => { if (vc.realtime) closeVoice('This realtime session reached its tier limit. Start a new session to continue.'); }, Math.max(60, vc.realtimeMaxSeconds) * 1000);
      voiceState('listening', 'Listening…'); Nasrin.mood('idle');
      return true;
    } catch (err) {
      closeRealtimeVoice();
      return false;
    }
  }

  function closeRealtimeVoice() {
    clearTimeout(vc.realtimeTimer);
    vc.realtimeTimer = null;
    try { vc.realtimeEvents?.send(JSON.stringify({ type: 'response.cancel' })); } catch {}
    try { vc.realtimeEvents?.close(); } catch {}
    try { window.NasrinGeminiRealtime?.stop(vc.geminiState); } catch {}
    try { vc.geminiState?.ws?.close(); } catch {}
    try { vc.geminiState?.processor?.disconnect(); } catch {}
    try { vc.geminiState?.ctx?.close(); } catch {}
    try { vc.realtimePc?.close(); } catch {}
    try { vc.realtimeStream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { vc.realtimeAudio?.remove(); } catch {}
    vc.realtimePc = null; vc.realtimeEvents = null; vc.realtimeStream = null; vc.realtimeAudio = null; vc.geminiState = null;
    vc.realtimeProvider = null; vc.realtime = false;
  }

  async function openVoice() {
    if (vc.on) return;
    if (!aiAvailable) { notice.textContent = 'Nasrin is not switched on yet. Please check back soon.'; return; }
    stopSpeaking();
    closePlus();
    vc.on = true;
    vc.muted = false;
    vc.quick = 0;
    voiceMute.setAttribute('aria-pressed', 'false');
    voiceMute.setAttribute('aria-label', 'Mute microphone');
    voiceMute.title = 'Mute microphone';
    voiceLog.replaceChildren();
    voiceSay('hint', 'Realtime voice is on. Just talk naturally — you can interrupt Nasrin at any time.');
    voiceEl.hidden = false;
    document.body.classList.add('voice-open');
    keepAwake();
    $('voiceEnd').focus();
    const realtime = await startRealtimeVoice();
    if (!vc.on) return;
    if (!realtime) {
      voiceSay('hint', 'Using compatibility voice mode. Talk naturally and Nasrin will answer out loud.');
      if (Recognition) listenVoice();
      else closeVoice('Realtime voice could not start, and this browser has no voice fallback.');
    }
  }

  function closeVoice(message) {
    if (!vc.on) return;
    vc.on = false;
    closeRealtimeVoice();
    vc.run += 1;
    clearTimeout(vc.silence);
    clearTimeout(vc.idle);
    try { if (vc.recognizer) vc.recognizer.abort(); } catch { /* already stopped */ }
    vc.recognizer = null;
    stopWatching();
    stopSpeaking();
    if (turn) turn.ctrl.abort();
    try { if (vc.wake) vc.wake.release(); } catch { /* released */ }
    vc.wake = null;
    Nasrin.emotion(null);
    Nasrin.talk(0);
    voiceEl.hidden = true;
    document.body.classList.remove('voice-open');
    Nasrin.mood('idle');
    if (message) notice.textContent = message;
    if (!$('voiceBtn').hidden) $('voiceBtn').focus();
  }

  $('voiceEnd').addEventListener('click', () => closeVoice());
  $('voiceClose').addEventListener('click', () => closeVoice());
  voiceSkip.addEventListener('click', interruptVoice);
  voiceMute.addEventListener('click', () => muteVoice(!vc.muted));
  // Coming back to the tab: the browser may have stopped listening.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && vc.on) { keepAwake(); if (vc.state === 'listening' && !vc.recognizer) listenVoice(); }
  });

  // ---------- choosing NasrinAI, Pro, Max or Ultra ----------
  // A round button with signal bars (one per level). Tapping it opens a menu
  // of the tiers; ones that need sign-in or a plan say so and lead there.

  const LEVEL = { nasrinai: 1, pro: 2, max: 3, ultra: 4 };
  const BLURB = {
    nasrinai: 'Quick everyday answers',
    pro: 'Smarter, for harder questions',
    max: 'Thinks longer, more careful',
    ultra: 'Deepest thinking for the hardest tasks'
  };
  const PLAN_NAME = { max: 'Max', ultra: 'Ultra' };
  let modelList = [];
  let currentModel = '';
  let plansEnabled = false;

  function barsIcon(level) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('bars');
    [[4, 13, 6], [8.5, 10, 9], [13, 7, 12], [17.5, 4, 15]].forEach(([x, y, h], i) => {
      const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', 3); r.setAttribute('height', h); r.setAttribute('rx', 1.5);
      if (i < level) r.classList.add('on');
      svg.appendChild(r);
    });
    return svg;
  }

  function showCurrentModel(bump) {
    const m = modelList.find((x) => x.id === currentModel);
    const level = LEVEL[currentModel] || 1;
    modelBtn.querySelectorAll('.bars rect').forEach((r, i) => r.classList.toggle('on', i < level));
    const label = m ? `Model: ${m.name}` : 'Choose a model';
    $('modelBtnLabel').textContent = label;
    modelBtn.title = m ? m.name : 'Choose a model';
    if (bump && !reduced()) {
      modelBtn.classList.remove('bump');
      void modelBtn.offsetWidth;   // restart the animation
      modelBtn.classList.add('bump');
    }
  }

  function lockLabel(m) {
    if (m.needs === 'sign_in') return 'Sign in';
    if (m.needs === 'plan') return `${PLAN_NAME[m.plan] || 'Plan'} plan`;
    return '';
  }

  function renderMenu() {
    const rows = modelList.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'model-option' + (m.locked ? ' is-locked' : '');
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(m.id === currentModel));
      b.dataset.id = m.id;
      const text = document.createElement('span');
      text.className = 'text';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = m.name;
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = BLURB[m.id] || '';
      text.append(name, desc);
      b.append(barsIcon(LEVEL[m.id] || 1), text);
      if (m.locked) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = lockLabel(m);
        b.appendChild(badge);
      } else if (m.id === currentModel) {
        const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        check.setAttribute('viewBox', '0 0 24 24');
        check.setAttribute('aria-hidden', 'true');
        check.classList.add('check');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M5 12.5 10 17.5 19 7');
        check.appendChild(path);
        b.appendChild(check);
      }
      b.addEventListener('click', () => pickModel(m));
      return b;
    });
    if (plansEnabled && modelList.some((m) => m.locked && m.needs === 'plan')) {
      const foot = document.createElement('button');
      foot.type = 'button';
      foot.className = 'menu-foot';
      foot.textContent = 'See plans';
      foot.addEventListener('click', () => { closeMenu(); openPlans(); });
      rows.push(foot);
    }
    modelMenu.replaceChildren(...rows);
  }

  function openMenu() {
    renderMenu();
    modelMenu.hidden = false;
    modelBtn.setAttribute('aria-expanded', 'true');
    const selected = modelMenu.querySelector('[aria-selected="true"]') || modelMenu.querySelector('.model-option');
    if (selected) selected.focus();
  }
  function closeMenu(refocus) {
    if (modelMenu.hidden) return;
    modelMenu.hidden = true;
    modelBtn.setAttribute('aria-expanded', 'false');
    if (refocus) modelBtn.focus();
  }

  function pickModel(m) {
    closeMenu(true);
    if (m.locked && m.needs === 'sign_in') { openSignIn(`Sign in to use ${m.name}.`); return; }
    if (m.locked && m.needs === 'plan') { openPlans(`${m.name} comes with the ${PLAN_NAME[m.plan] || ''} plan.`); return; }
    if (m.id === currentModel) return;
    currentModel = m.id;
    saved.set(KEYS.model, currentModel);
    showCurrentModel(true);
    Nasrin.flash('surprised', 520);
  }

  modelBtn.addEventListener('click', () => (modelMenu.hidden ? openMenu() : closeMenu(true)));
  document.addEventListener('pointerdown', (e) => {
    if (!modelMenu.hidden && !modelRow.contains(e.target)) closeMenu(false);
  });
  modelMenu.addEventListener('keydown', (e) => {
    const items = [...modelMenu.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
    else if (e.key === 'Escape') { e.stopPropagation(); closeMenu(true); }
    else if (e.key === 'Tab') closeMenu(false);
  });

  async function loadModels() {
    try {
      const data = await api('/v1/models');
      modelList = (Array.isArray(data.models) ? data.models : [])
        .filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string')
        .map((m) => ({ id: m.id, name: m.name, locked: m.locked === true, needs: m.needs, plan: m.plan }));
      const open = modelList.filter((m) => !m.locked).map((m) => m.id);
      if (modelList.length < 2) { modelRow.hidden = true; currentModel = ''; return; }
      const wanted = saved.get(KEYS.model);
      currentModel = open.includes(wanted) ? wanted : (open.includes(data.default) ? data.default : open[0] || '');
      showCurrentModel(false);
      if (!modelMenu.hidden) renderMenu();
      modelRow.hidden = false;
    } catch {
      modelRow.hidden = true;   // the server then uses its default
    }
  }

  // ---------- plans (Max, Ultra) ----------

  const plansSheet = $('plans');
  const planList = $('planList');
  const plansStatus = $('plansStatus');
  let planInfo = null;
  let imageLimits = null;   // from /v1/status; enforced by the server, shown here only

  // The + menu hint: guests and Free see their picture limit; Max and Ultra
  // see none. The plan comes from the server (/v1/plans), and the limits are
  // enforced there, so changing this text changes nothing else.
  function renderImageHint() {
    const hint = $('imageHint');
    const base = 'Describe a picture and Nasrin makes it';
    const plan = account && planInfo ? planInfo.current : null;
    let limit = '';
    if (imageLimits && !account && imageLimits.perGuest) limit = imageLimits.perGuest === 1 ? ' (1 as a guest)' : ` (${imageLimits.perGuest} as a guest)`;
    else if (imageLimits && account && plan !== 'max' && plan !== 'ultra' && imageLimits.perUserDay) limit = ` (${imageLimits.perUserDay} a day)`;
    hint.textContent = base + limit;
  }

  function money(price) {
    return '₱' + Number(price.amount).toLocaleString('en-PH');
  }

  async function loadPlans() {
    if (!account) { planInfo = null; renderPlanRow(); return null; }
    try {
      planInfo = await api('/v1/plans');
    } catch {
      planInfo = null;
    }
    renderPlanRow();
    return planInfo;
  }

  function renderPlanRow() {
    renderImageHint();
    const row = $('planRow');
    row.hidden = !plansEnabled;
    if (!plansEnabled) return;
    const current = planInfo && planInfo.current;
    const named = { free: 'Free', max: 'Max', ultra: 'Ultra' }[current] || 'Free';
    $('planLabel').textContent = account ? `${named} plan` : 'Plans';
    $('planHint').textContent = account && planInfo && planInfo.ends_at && current !== 'free'
      ? `Until ${new Date(planInfo.ends_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : 'Get Max and Ultra';
  }

  function planCard(p, current) {
    const card = document.createElement('article');
    card.className = 'plan-card' + (p.id === current ? ' is-current' : '');
    const top = document.createElement('div');
    top.className = 'plan-top';
    const h = document.createElement('h3');
    h.textContent = p.name;
    const price = document.createElement('span');
    if (p.id === 'free') { price.className = 'price'; price.textContent = '₱0'; }
    else if (p.price) {
      price.className = 'price';
      price.textContent = money(p.price) + ' ';
      const per = document.createElement('small');
      per.textContent = `/ ${p.price.days} days`;
      price.appendChild(per);
    } else { price.className = 'soon'; price.textContent = 'Coming soon'; }
    top.append(h, price);
    const inc = document.createElement('p');
    inc.className = 'includes';
    inc.textContent = Array.isArray(p.tiers) ? p.tiers.join(' · ') : '';
    const btn = document.createElement('button');
    btn.type = 'button';
    if (p.id === current) { btn.className = 'btn outline'; btn.textContent = 'Your plan'; btn.disabled = true; }
    else if (p.id === 'free') { btn.className = 'btn outline'; btn.textContent = 'Included'; btn.disabled = true; }
    else if (!account) { btn.className = 'btn'; btn.textContent = 'Sign in to get ' + p.name; btn.addEventListener('click', () => { closePlans(); openSignIn(); }); }
    else if (p.available) { btn.className = 'btn'; btn.textContent = 'Get ' + p.name; btn.addEventListener('click', () => buyPlan(p, btn)); }
    else { btn.className = 'btn outline'; btn.textContent = 'Coming soon'; btn.disabled = true; }
    card.append(top, inc, btn);
    return card;
  }

  async function openPlans(message) {
    closeSettings();
    closeSignIn();
    lastFocus = document.activeElement;
    plansStatus.textContent = message || '';
    scrim.hidden = false;
    plansSheet.hidden = false;
    $('plansClose').focus();
    const info = account ? await loadPlans() : null;
    const plansShown = info && Array.isArray(info.plans) ? info.plans : [
      { id: 'free', name: 'Free', tiers: ['Quick', 'Pro'], price: null },
      { id: 'max', name: 'Max', tiers: ['Quick', 'Pro', 'Max'], price: null },
      { id: 'ultra', name: 'Ultra', tiers: ['Quick', 'Pro', 'Max', 'Ultra'], price: null }
    ];
    const current = info ? info.current : null;
    $('plansLede').textContent = account ? 'More thinking power when you need it.' : 'Sign in first, then pick a plan.';
    planList.replaceChildren(...plansShown.map((p) => planCard(p, current)));
  }
  function closePlans() {
    if (plansSheet.hidden) return;
    plansSheet.hidden = true;
    scrim.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('plansClose').addEventListener('click', closePlans);

  // ---------- Professional AI ----------
  // The choice lives on this device; the server checks it on every message and
  // decides which professions an answer actually needs (at most 3, one call).
  // Off: Universal AI. The page never decides what the person may use.

  const proSheet = $('proSheet');
  let proCatalog = null;   // { groups: [{ id, name, members }], professions: [{ id, name, groups, accessory, focus }] }
  const proState = (() => {
    const s = saved.get(KEYS.pro);
    const ok = s && typeof s === 'object';
    return {
      enabled: ok && s.enabled === true,
      mode: ok && s.mode === 'custom' ? 'custom' : 'automatic',
      ids: ok && Array.isArray(s.ids) ? s.ids.filter((x) => typeof x === 'string').slice(0, 100) : [],
      primary: ok && typeof s.primary === 'string' ? s.primary : null
    };
  })();
  const proById = (id) => proCatalog && proCatalog.professions.find((p) => p.id === id);

  // The Nasrin ball wearing a profession's accessory (one per family), drawn
  // in the character's own coordinates (ball at 100,100, r 82; eyes at 75 and
  // 125). Avatars are circles; the overlay sits on the header bot itself.
  const NB = 'http://www.w3.org/2000/svg';
  const ACCESSORY = {
    // Every accessory stays inside the ball (r 82) so it reads on any background.
    tie: [['path', { d: 'M89 140h22l-4 12H93Z' }], ['path', { d: 'M93 152l-8 18 15 9 15-9-8-18Z' }]],
    glasses: [['circle', { cx: 75, cy: 111, r: 21, line: 1 }], ['circle', { cx: 125, cy: 111, r: 21, line: 1 }], ['path', { d: 'M96 108h8', line: 1 }]],
    headset: [['path', { d: 'M30 108a70 70 0 0 1 140 0', line: 1 }], ['rect', { x: 22, y: 98, width: 16, height: 30, rx: 7 }], ['rect', { x: 162, y: 98, width: 16, height: 30, rx: 7 }], ['path', { d: 'M32 126q8 34 44 36', line: 1 }]],
    chart: [['rect', { x: 78, y: 152, width: 10, height: 18, rx: 2 }], ['rect', { x: 95, y: 144, width: 10, height: 26, rx: 2 }], ['rect', { x: 112, y: 138, width: 10, height: 32, rx: 2 }]],
    hardhat: [['path', { d: 'M40 80a60 60 0 0 1 120 0Z' }], ['rect', { x: 28, y: 76, width: 144, height: 11, rx: 5.5 }]],
    pen: [['path', { d: 'M114 170l42-42 9 9-42 42Z' }], ['path', { d: 'M114 170l-5 14 14-5Z' }]],
    clipboard: [['rect', { x: 82, y: 140, width: 36, height: 38, rx: 5 }], ['rect', { x: 92, y: 135, width: 16, height: 9, rx: 3, ink: 1 }], ['path', { d: 'M90 156h20M90 166h14', ink: 1, line: 1 }]],
    badge: [['path', { d: 'M100 134v8', line: 1 }], ['rect', { x: 84, y: 142, width: 32, height: 34, rx: 5 }], ['path', { d: 'M92 166h16', ink: 1, line: 1 }], ['circle', { cx: 100, cy: 154, r: 5, ink: 1 }]]
  };

  function drawAccessory(svg, accessory) {
    for (const [tag, attrs] of ACCESSORY[accessory] || []) {
      const node = document.createElementNS(NB, tag);
      for (const [k, v] of Object.entries(attrs)) if (k !== 'line' && k !== 'ink') node.setAttribute(k, v);
      node.setAttribute('class', attrs.line && attrs.ink ? 'nb-line-ink' : attrs.line ? 'nb-line' : attrs.ink ? 'nb-ink' : 'nb-acc');
      svg.appendChild(node);
    }
  }
  // A round avatar: the Nasrin ball, eyes, and the accessory (none = Universal AI).
  function nasrinAvatar(accessory) {
    const svg = document.createElementNS(NB, 'svg');
    svg.setAttribute('viewBox', '8 8 184 196');
    svg.setAttribute('class', 'nb');
    svg.setAttribute('aria-hidden', 'true');
    const ball = document.createElementNS(NB, 'circle');
    ball.setAttribute('cx', 100); ball.setAttribute('cy', 100); ball.setAttribute('r', 82);
    ball.setAttribute('class', 'nb-ball');
    svg.appendChild(ball);
    for (const cx of [75, 125]) {
      const eye = document.createElementNS(NB, 'rect');
      eye.setAttribute('x', cx - 8.5); eye.setAttribute('y', 91); eye.setAttribute('width', 17); eye.setAttribute('height', 41); eye.setAttribute('rx', 8.5);
      eye.setAttribute('class', 'nb-eye');
      svg.appendChild(eye);
    }
    if (accessory) drawAccessory(svg, accessory);
    return svg;
  }

  // What goes with each message.
  function proRequest() {
    if (!proCatalog || !proState.enabled) return { enabled: false };
    if (proState.mode !== 'custom' || !proState.ids.length) return { enabled: true, mode: 'automatic' };
    if (proState.ids.length === proCatalog.professions.length) return { enabled: true, mode: 'all' };
    if (proState.ids.length === 1) return { enabled: true, mode: 'single', ids: proState.ids.slice() };
    return { enabled: true, mode: 'multiple', ids: proState.ids.slice(), ...(proState.primary ? { primary: proState.primary } : {}) };
  }

  function saveProState() {
    if (proCatalog) proState.ids = proState.ids.filter((id) => proById(id));
    if (proState.primary && !proState.ids.includes(proState.primary)) proState.primary = proState.ids[0] || null;
    saved.set(KEYS.pro, { enabled: proState.enabled, mode: proState.mode, ids: proState.ids, primary: proState.primary });
    renderProButton();
  }

  function renderProButton() {
    const btn = $('proBtn');
    btn.hidden = !proCatalog;
    $('openPro').hidden = !proCatalog;
    if (!proCatalog) return;
    let label = 'Universal AI';
    let icon = null;
    const req = proRequest();
    if (req.enabled && req.mode === 'automatic') label = 'Automatic';
    else if (req.mode === 'all') label = 'All professionals';
    else if (req.enabled) {
      const lead = proById(proState.primary || proState.ids[0]);
      label = lead ? lead.name + (proState.ids.length > 1 ? ` + ${proState.ids.length - 1}` : '') : 'Professional';
      icon = lead ? lead.accessory : null;
    }
    $('proBtnLabel').textContent = label;
    $('proBtnIcon').replaceChildren(nasrinAvatar(icon));
    btn.classList.toggle('is-on', req.enabled);
    btn.title = req.enabled ? `Professional AI: ${label}` : 'Universal AI (Professional AI is off)';
    btn.setAttribute('aria-label', btn.title);
    if (!req.enabled) setProBadge([]);
  }

  // The header bot wears the lead profession's accessory of the last answer;
  // a small circle counts the rest of the team.
  function setProBadge(ids) {
    const badge = $('proBadge');
    const lead = ids.length ? proById(ids[0]) : null;
    if (!lead) { badge.classList.remove('is-shown'); badge.hidden = true; return; }
    const svg = document.createElementNS(NB, 'svg');
    svg.setAttribute('viewBox', '0 0 200 212');
    svg.setAttribute('class', 'nb nb-overlay');
    drawAccessory(svg, lead.accessory);
    const parts = [svg];
    if (ids.length > 1) { const b = document.createElement('b'); b.textContent = '+' + (ids.length - 1); parts.push(b); }
    badge.replaceChildren(...parts);
    badge.hidden = false;
    badge.classList.remove('is-shown');
    void badge.offsetWidth;   // the accessory settles in briefly; the bot itself stays still
    badge.classList.add('is-shown');
  }

  function proCheckbox(checked, indeterminate, label) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.indeterminate = indeterminate;
    box.setAttribute('aria-label', label);
    return box;
  }

  function renderProSheet() {
    $('proEnabled').checked = proState.enabled;
    $('proOptions').hidden = !proState.enabled;
    for (const r of document.querySelectorAll('input[name="proMode"]')) r.checked = r.value === proState.mode;
    $('proCustom').hidden = proState.mode !== 'custom';
    $('proModeNote').textContent = proState.mode === 'automatic'
      ? 'NasrinAI picks the expertise each question needs, and answers as a general assistant when none is needed.'
      : 'Pick professionals or whole groups. Each answer uses only the ones the question needs, led by your ★ primary.';
    if (proState.mode !== 'custom') return;
    const q = $('proSearch').value.trim().toLowerCase();
    const chosen = new Set(proState.ids);
    $('proCount').textContent = chosen.size ? `${chosen.size} selected` : 'None selected';
    const blocks = [];
    for (const g of proCatalog.groups) {
      const members = g.members.map(proById).filter(Boolean)
        .filter((p) => !q || p.name.toLowerCase().includes(q) || p.focus.toLowerCase().includes(q) || g.name.toLowerCase().includes(q));
      if (!members.length) continue;
      const on = g.members.filter((id) => chosen.has(id)).length;
      const block = document.createElement('fieldset');
      block.className = 'pro-group';
      const head = document.createElement('label');
      head.className = 'pro-group-head';
      const gbox = proCheckbox(on === g.members.length, on > 0 && on < g.members.length, `Select all in ${g.name}`);
      gbox.addEventListener('change', () => {
        const all = on === g.members.length;
        proState.ids = all ? proState.ids.filter((id) => !g.members.includes(id)) : [...new Set([...proState.ids, ...g.members])];
        saveProState();
        renderProSheet();
      });
      const gname = document.createElement('span');
      gname.textContent = g.name;
      const ghint = document.createElement('small');
      ghint.textContent = on ? `${on} of ${g.members.length}` : 'Select all in group';
      head.append(gbox, gname, ghint);
      block.appendChild(head);
      for (const p of members) {
        const row = document.createElement('div');
        row.className = 'pro-row';
        const lab = document.createElement('label');
        const box = proCheckbox(chosen.has(p.id), false, p.name);
        box.addEventListener('change', () => {
          proState.ids = box.checked ? [...new Set([...proState.ids, p.id])] : proState.ids.filter((id) => id !== p.id);
          if (box.checked && !proState.primary) proState.primary = p.id;
          saveProState();
          renderProSheet();
        });
        const text = document.createElement('span');
        const name = document.createElement('strong');
        name.textContent = p.name;
        const focus = document.createElement('small');
        focus.textContent = p.focus;
        text.append(name, focus);
        const face = document.createElement('span');
        face.className = 'pro-face';
        face.appendChild(nasrinAvatar(p.accessory));
        lab.append(box, face, text);
        row.appendChild(lab);
        if (chosen.has(p.id) && chosen.size > 1) {
          const star = document.createElement('button');
          star.type = 'button';
          star.className = 'pro-star';
          const isPrimary = (proState.primary || proState.ids[0]) === p.id;
          star.textContent = isPrimary ? '★' : '☆';
          star.setAttribute('aria-pressed', String(isPrimary));
          star.setAttribute('aria-label', `Make ${p.name} the primary professional`);
          star.title = isPrimary ? 'Primary professional' : 'Make primary';
          star.addEventListener('click', () => { proState.primary = p.id; saveProState(); renderProSheet(); });
          row.appendChild(star);
        }
        block.appendChild(row);
      }
      blocks.push(block);
    }
    if (!blocks.length) {
      const none = document.createElement('p');
      none.className = 'setting-note';
      none.textContent = 'No professional matches that search.';
      blocks.push(none);
    }
    $('proGroups').replaceChildren(...blocks);
  }

  function openPro() {
    if (!proCatalog) return;
    closeSettings();
    closeSignIn();
    closePlans();
    lastFocus = document.activeElement;
    renderProSheet();
    scrim.hidden = false;
    proSheet.hidden = false;
    $('proEnabled').focus();
  }
  function closePro() {
    if (proSheet.hidden) return;
    proSheet.hidden = true;
    scrim.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('proBtn').addEventListener('click', openPro);
  $('openPro').addEventListener('click', openPro);
  $('proClose').addEventListener('click', closePro);
  $('proDone').addEventListener('click', closePro);
  $('proEnabled').addEventListener('change', () => { proState.enabled = $('proEnabled').checked; saveProState(); renderProSheet(); });
  for (const r of document.querySelectorAll('input[name="proMode"]')) {
    r.addEventListener('change', () => { if (r.checked) { proState.mode = r.value; saveProState(); renderProSheet(); } });
  }
  $('proSearch').addEventListener('input', renderProSheet);
  $('proAll').addEventListener('click', () => { proState.ids = proCatalog.professions.map((p) => p.id); saveProState(); renderProSheet(); });
  $('proClear').addEventListener('click', () => { proState.ids = []; proState.primary = null; saveProState(); renderProSheet(); });

  async function loadProfessionals() {
    try {
      const resp = await net('/v1/professionals');
      const data = resp.ok ? await resp.json() : null;
      proCatalog = data && data.enabled && Array.isArray(data.professions) && data.professions.length ? data : null;
    } catch { proCatalog = null; }
    if (proCatalog) saveProState(); else renderProButton();
  }

  // ---------- your chats (history) ----------
  // The server lists only the caller's own conversations, newest first.

  const historySheet = $('history');
  const historyList = $('historyList');

  const when = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days < 1 && d.getDate() === new Date().getDate()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  function historyRow(c) {
    const li = document.createElement('li');
    li.className = 'history-item' + (c.id === conversationId ? ' is-current' : '');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'history-open';
    const title = document.createElement('span');
    title.className = 'history-title';
    title.textContent = c.title || 'Untitled chat';
    const time = document.createElement('span');
    time.className = 'history-time';
    time.textContent = when(c.updated_at || c.created_at);
    open.append(title, time);
    open.addEventListener('click', () => openChat(c.id));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn history-delete';
    del.title = 'Delete this chat';
    del.setAttribute('aria-label', `Delete “${title.textContent}”`);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12');
    svg.appendChild(path);
    del.appendChild(svg);
    del.addEventListener('click', async () => {
      if (!window.confirm('Delete this chat? This cannot be undone.')) return;
      del.disabled = true;
      try {
        await api('/v1/conversations/' + encodeURIComponent(c.id), { method: 'DELETE' });
        li.remove();
        if (c.id === conversationId) { conversationId = null; saved.del(identityKey(KEYS.conversation)); clearScreen(); }
        if (!historyList.children.length) $('historyStatus').textContent = 'No chats yet.';
      } catch (err) {
        $('historyStatus').textContent = err.message || 'That chat could not be deleted.';
        del.disabled = false;
      }
    });
    li.append(open, del);
    return li;
  }

  async function openHistory(tab = 'chats') {
    closeSettings(); closeSignIn(); closePlans();
    lastFocus = document.activeElement;
    scrim.hidden = false;
    historySheet.hidden = false;
    $('historyClose').focus();
    // The tabs show whenever the server offers them. Signed out, a tab asks
    // the person to sign in (the server serves these to signed-in people only).
    const can = { library: libraryOn, projects: projectsOn };
    $('tabLibrary').hidden = !can.library;
    $('tabProjects').hidden = !can.projects;
    $('historyTabs').hidden = !can.library && !can.projects;
    $('historyTabs').dataset.count = String(1 + can.library + can.projects);
    showTab(can[tab] ? tab : 'chats');
    const lede = $('historyLede');
    lede.hidden = Boolean(account);
    if (!account) lede.textContent = 'Guest chats are deleted after 24 hours. Sign in to keep your chats.';
    historyList.replaceChildren();
    $('historyStatus').textContent = 'Loading…';
    try {
      const data = await api('/v1/conversations');
      const list = (data.conversations || []).filter((c) => c && typeof c.id === 'string');
      historyList.replaceChildren(...list.map(historyRow));
      $('historyStatus').textContent = list.length ? '' : 'No chats yet.';
    } catch (err) {
      $('historyStatus').textContent = err.message || 'Your chats could not be loaded.';
    }
  }
  function closeHistory() {
    if (historySheet.hidden) return;
    historySheet.hidden = true;
    scrim.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  // Opens a past chat; the next message continues it.
  async function openChat(id) {
    if (busy) return;
    closeHistory();
    stopSpeaking();
    notice.textContent = '';
    conversationId = id;
    saved.set(KEYS.conversation, id);
    clearScreen();
    await loadConversation();
    if (!conversationId) notice.textContent = 'That chat is no longer available.';
  }
  $('historyBtn').addEventListener('click', () => (historySheet.hidden ? openHistory() : closeHistory()));
  $('spaceSignIn').addEventListener('click', () => { closeHistory(); openSignIn(); });
  // Settings > Your space: Library and Projects open in the same sheet as the chats.
  for (const b of document.querySelectorAll('#spaceMenu [data-open-tab]')) b.addEventListener('click', () => openHistory(b.dataset.openTab));
  function renderSpaceMenu() {
    $('openLibrary').hidden = !libraryOn;
    $('openProjects').hidden = !projectsOn;
    $('spaceMenu').hidden = $('spaceLabel').hidden = !libraryOn && !projectsOn;
    $('historyBtnLabel').textContent = libraryOn ? 'Your chats and Library' : 'Your chats';
    $('historyBtn').title = libraryOn ? 'Chats and Library' : 'Your chats';
  }
  $('historyClose').addEventListener('click', closeHistory);

  // ---------- the Library (signed in) ----------
  // The person's own files, notes and saved replies; only text is kept. The
  // server checks everything; this page only shows it.

  const TABS = { chats: ['tabChats', 'chatsPane', 'Your chats'], library: ['tabLibrary', 'libraryPane', 'Your Library'], projects: ['tabProjects', 'projectsPane', 'Your projects'] };
  const SPACE_GUEST = {
    library: 'Sign in to keep your chats, files and photos in your Library.',
    projects: 'Sign in to keep chats, files, tasks and instructions together in projects.'
  };
  function showTab(name) {
    const gated = name !== 'chats' && !account;
    for (const [key, [tabId, paneId]] of Object.entries(TABS)) {
      const on = key === name;
      $(tabId).setAttribute('aria-selected', String(on));
      $(tabId).tabIndex = on ? 0 : -1;
      $(paneId).hidden = !on || gated;
    }
    $('historyTitle').textContent = TABS[name][2];
    $('spaceGuest').hidden = !gated;
    if (gated) { $('spaceGuestText').textContent = SPACE_GUEST[name]; return; }
    if (name === 'library') { libShow('list'); loadLibrary(); }
    if (name === 'projects') { prjShow('list'); loadProjects(); }
  }
  for (const key of Object.keys(TABS)) $(TABS[key][0]).addEventListener('click', () => showTab(key));
  $('historyTabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const shown = Object.keys(TABS).filter((k) => !$(TABS[k][0]).hidden);
    const at = shown.findIndex((k) => $(TABS[k][0]).getAttribute('aria-selected') === 'true');
    const next = shown[(at + (e.key === 'ArrowRight' ? 1 : shown.length - 1)) % shown.length];
    showTab(next);
    $(TABS[next][0]).focus();
    e.preventDefault();
  });

  // The Library is a storage of the person's data: chats, files, notes and saved
  // replies, photos and files they sent, and pictures Nasrin made. The server
  // lists and deletes (GET /v1/storage); this page only shows it.
  const LIB_KIND = { chat: 'Chat', file: 'File', note: 'Note', reply: 'Saved reply', photo_sent: 'Photo sent', file_sent: 'File sent', photo_generated: 'Photo generated' };
  const LIB_GROUP = { file: ['file', 'file_sent'], note: ['note', 'reply'] };
  const LIB_PHOTO_PATH = { photo_sent: (id) => '/v1/storage/sent/' + encodeURIComponent(id), file_sent: (id) => '/v1/storage/sent/' + encodeURIComponent(id), photo_generated: (id) => '/v1/images/' + encodeURIComponent(id) };
  const libList = $('libList');
  let libFiles = [];    // everything stored, as the server lists it
  let libInfo = null;   // { counts, used, retention }
  let libOpen = null;   // the item being viewed
  let libQuery = 0;
  const libSize = (n) => (n >= 1000 ? Math.round(n / 100) / 10 + 'k' : String(n)) + ' characters';
  const bytesText = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
  const libBlobs = new Map();   // path -> object URL of a picture or file already fetched

  function libShow(view) {
    $('libListView').hidden = view !== 'list';
    $('libItemView').hidden = view !== 'item';
    $('libNoteView').hidden = view !== 'note';
    $('libStatus').textContent = '';
  }

  // A picture or file from the server, fetched with the person's sign-in.
  async function libBlob(path) {
    if (libBlobs.has(path)) return libBlobs.get(path);
    const resp = await net(path, { headers: { Authorization: 'Bearer ' + (await credential(false)) } });
    if (!resp.ok) throw await errorFrom(resp);
    const url = URL.createObjectURL(await resp.blob());
    libBlobs.set(path, url);
    return url;
  }
  function libForget() { for (const u of libBlobs.values()) URL.revokeObjectURL(u); libBlobs.clear(); }

  async function loadLibrary() {
    const run = ++libQuery;
    $('libStatus').textContent = 'Loading…';
    try {
      const data = await api('/v1/storage');
      if (run !== libQuery) return;
      libFiles = (data.items || []).filter((f) => f && typeof f.id === 'string' && LIB_KIND[f.kind]);
      libInfo = data;
      renderKeep();
      renderLibrary();
    } catch (err) {
      if (run !== libQuery) return;
      libFiles = [];
      libInfo = null;
      libList.replaceChildren();
      $('libSummary').textContent = '';
      $('libStatus').textContent = err.message || 'Your Library could not be loaded.';
    }
  }

  function renderLibrary() {
    const kind = $('libFilter').value;
    const sort = $('libSort').value;
    const q = $('libSearch').value.trim().toLowerCase();
    const inKind = (f) => kind === 'all' || (LIB_GROUP[kind] || [kind]).includes(f.kind);
    const stamp = (f) => String(f.updated_at || f.created_at);
    const list = libFiles.filter((f) => inKind(f) && (!q || String(f.title).toLowerCase().includes(q))).sort((a, b) => (
      sort === 'name' ? String(a.title).localeCompare(String(b.title))
        : sort === 'old' ? stamp(a).localeCompare(stamp(b))
          : stamp(b).localeCompare(stamp(a))));
    const c = (libInfo && libInfo.counts) || {};
    const n = (k) => Number(c[k]) || 0;
    $('libSummary').textContent = libInfo
      ? `${n('chat')} chats · ${n('file') + n('file_sent')} files · ${n('photo_sent')} photos sent · ${n('photo_generated')} photos generated`
        + (libInfo.used && libInfo.used.bytes ? ` · ${bytesText(libInfo.used.bytes)} of ${bytesText(libInfo.used.max_bytes)} used by what you send` : '')
      : '';
    let thumbs = 0;
    libList.replaceChildren(...list.map((f) => {
      const li = document.createElement('li');
      li.className = 'history-item';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'history-open lib-open';
      const col = mk('span', 'lib-text-col');
      const metaBits = [LIB_KIND[f.kind], when(f.updated_at || f.created_at)];
      if (f.kind === 'file' || f.kind === 'note' || f.kind === 'reply') metaBits.push(libSize(f.size || 0));
      else if (f.size) metaBits.push(bytesText(f.size));
      if (f.expires_at) metaBits.push('until ' + fmtDate(f.expires_at));
      col.append(mk('span', 'history-title', f.title), mk('span', 'history-time', metaBits.join(' · ')));
      if ((f.kind === 'photo_sent' || f.kind === 'photo_generated') && thumbs++ < 30) {
        const img = document.createElement('img');
        img.className = 'lib-thumb';
        img.alt = '';
        img.loading = 'lazy';
        libBlob(LIB_PHOTO_PATH[f.kind](f.id)).then((u) => { img.src = u; }).catch(() => img.remove());
        open.appendChild(img);
      }
      open.appendChild(col);
      open.addEventListener('click', () => {
        if (f.kind === 'chat') openChat(f.id);
        else if (f.kind === 'file' || f.kind === 'note' || f.kind === 'reply') openLibraryItem(f.id);
        else openStoredItem(f);
      });
      li.appendChild(open);
      return li;
    }));
    $('libStatus').textContent = list.length ? '' : q ? 'Nothing found.' : kind !== 'all' ? 'Nothing here yet.'
      : 'Your Library is empty. Chats, photos and files you send or make will be kept here.';
  }

  // Photos and files the person sent, and pictures Nasrin made.
  async function openStoredItem(f) {
    libShow('item');
    $('libMoveRow').hidden = true;
    $('libDownloadRow').hidden = true;
    libOpen = f;
    $('libItemTitle').textContent = f.title;
    $('libItemMeta').textContent = `${LIB_KIND[f.kind]}${f.size ? ' · ' + bytesText(f.size) : ''} · ${fmtDate(f.created_at)}`;
    const body = $('libItemBody');
    body.replaceChildren();
    const path = LIB_PHOTO_PATH[f.kind](f.id);
    $('libDownloadRow').hidden = false;
    if (f.kind === 'file_sent') body.replaceChildren(mk('p', 'setting-hint', 'Tap Download to save this file.'));
    else {
      $('libStatus').textContent = 'Loading…';
      try {
        const img = document.createElement('img');
        img.className = 'lib-photo';
        img.alt = f.title;
        img.src = await libBlob(path);
        if (libOpen !== f) return;
        body.replaceChildren(img);
        $('libStatus').textContent = '';
      } catch (err) { $('libStatus').textContent = err.message || 'That picture could not be opened.'; }
    }
    $('libBack').focus();
  }
  $('libDownload').addEventListener('click', async () => {
    if (!libOpen || !LIB_PHOTO_PATH[libOpen.kind]) return;
    try {
      const a = document.createElement('a');
      a.href = await libBlob(LIB_PHOTO_PATH[libOpen.kind](libOpen.id));
      a.download = libOpen.kind === 'photo_generated' ? 'nasrin-picture.png' : libOpen.title;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) { $('libStatus').textContent = err.message || 'That could not be downloaded.'; }
  });

  // Keep my data for: Standard, 30 days, 1 year, custom, or until I delete it.
  function keepLabel(days) { return days === 365 ? '1 year' : days % 365 === 0 && days > 365 ? `${days / 365} years` : `${days} day${days === 1 ? '' : 's'}`; }
  function renderKeep() {
    const r = libInfo && libInfo.retention;
    const sel = $('libKeepSel');
    if (!r) { $('libKeepHint').textContent = ''; return; }
    const days = r.days;
    sel.value = days === null ? 'default' : days === 0 ? '0' : days === 30 ? '30' : days === 365 ? '365' : 'custom';
    $('libKeepCustom').hidden = sel.value !== 'custom';
    if (sel.value === 'custom') $('libKeepDays').value = String(days);
    const pic = r.picture_default_days;
    $('libKeepHint').textContent = days === null
      ? `Standard: chats and files stay until you delete them. ${pic ? `Pictures Nasrin makes are deleted after ${pic} days.` : 'Pictures stay until you delete them.'}`
      : days === 0 ? 'Everything stays until you delete it.'
        : `Chats, files, photos and pictures older than ${keepLabel(days)} are deleted automatically (chats count from their last message).`;
  }
  async function saveKeep(days) {
    const status = $('libStatus');
    if (days !== null && days > 0) {
      const cutoff = Date.now() - days * 86400_000;
      const old = libFiles.filter((f) => Date.parse(f.updated_at || f.created_at) < cutoff).length;
      if (old && !window.confirm(`This deletes ${old} item${old === 1 ? '' : 's'} older than ${keepLabel(days)} right now. This cannot be undone. Continue?`)) { renderKeep(); return; }
    }
    $('libKeepSel').disabled = true;
    status.textContent = 'Saving…';
    try {
      const data = await api('/v1/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ retention: days }) });
      if (data && data.prefs) myPrefs = data.prefs;
      await loadLibrary();
      status.textContent = 'Saved.';
    } catch (err) {
      status.textContent = err.message || 'That could not be saved. Please try again.';
      renderKeep();
    } finally { $('libKeepSel').disabled = false; }
  }
  $('libKeepSel').addEventListener('change', () => {
    const v = $('libKeepSel').value;
    $('libKeepCustom').hidden = v !== 'custom';
    if (v === 'custom') { $('libKeepDays').focus(); return; }
    saveKeep(v === 'default' ? null : Number(v));
  });
  $('libKeepSave').addEventListener('click', () => {
    const n = Number($('libKeepDays').value);
    if (!Number.isInteger(n) || n < 1 || n > 3650) { $('libStatus').textContent = 'Enter a whole number of days from 1 to 3650.'; return; }
    saveKeep(n);
  });

  async function openLibraryItem(id, projectId) {
    libShow('item');
    $('libMoveRow').hidden = true;
    $('libDownloadRow').hidden = true;
    $('libItemTitle').textContent = '';
    $('libItemMeta').textContent = '';
    $('libItemBody').replaceChildren();
    $('libStatus').textContent = 'Loading…';
    try {
      const f = await api('/v1/library/' + encodeURIComponent(id));
      libOpen = f;
      $('libItemTitle').textContent = f.title;
      $('libItemMeta').textContent = `${LIB_KIND[f.kind] || ''} · ${libSize(f.chars)} · ${fmtDate(f.created_at)}`;
      // Markdown is shown with the safe formatter; everything else as plain text.
      if (f.format === 'markdown') $('libItemBody').replaceChildren(window.NasrinFormat.render(String(f.text || '')).node);
      else $('libItemBody').replaceChildren(mk('pre', 'lib-pre', String(f.text || '')));
      $('libStatus').textContent = '';
      $('libBack').focus();
      if (projectsOn) showLibMove(f.id, projectId !== undefined ? projectId : (libFiles.find((x) => x.id === f.id) || {}).project_id || null);
    } catch (err) {
      $('libStatus').textContent = err.message || 'That item could not be opened.';
    }
  }

  async function addLibrary(body) {
    $('libStatus').textContent = 'Saving…';
    try {
      await api('/v1/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      libShow('list');
      $('libSearch').value = '';
      await loadLibrary();
      $('libStatus').textContent = 'Added to your Library.';
      return true;
    } catch (err) {
      $('libStatus').textContent = err.message || 'That could not be added.';
      return false;
    }
  }

  $('libSearch').addEventListener('input', () => renderLibrary());
  $('libFilter').addEventListener('change', () => renderLibrary());
  $('libSort').addEventListener('change', () => renderLibrary());
  $('libAdd').addEventListener('click', () => $('libFile').click());
  $('libFile').addEventListener('change', async () => {
    const file = $('libFile').files && $('libFile').files[0];
    $('libFile').value = '';
    if (!file) return;
    if (!/\.(txt|text|log|md|markdown|csv|tsv|json)$/i.test(file.name)) { $('libStatus').textContent = 'Add .txt, .md, .csv or .json files. PDFs and pictures are not supported in the Library yet.'; return; }
    if (file.size > 800_000) { $('libStatus').textContent = 'That file is too big for the Library.'; return; }
    let text;
    try { text = await file.text(); } catch { $('libStatus').textContent = 'That file could not be read.'; return; }
    addLibrary({ kind: 'file', title: file.name, text });
  });
  $('libNew').addEventListener('click', () => { libShow('note'); $('libNoteTitle').value = ''; $('libNoteText').value = ''; $('libNoteTitle').focus(); });
  $('libNoteBack').addEventListener('click', () => { libShow('list'); renderLibrary(); });
  $('libNoteView').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('libNoteSave');
    btn.disabled = true;
    await addLibrary({ kind: 'note', title: $('libNoteTitle').value, text: $('libNoteText').value, format: 'markdown' });
    btn.disabled = false;
  });
  $('libBack').addEventListener('click', () => { libOpen = null; libShow('list'); renderLibrary(); });
  $('libDelete').addEventListener('click', async () => {
    if (!libOpen || !window.confirm(`Delete “${libOpen.title}” from your Library? This cannot be undone.`)) return;
    const btn = $('libDelete');
    btn.disabled = true;
    try {
      await api('/v1/storage/' + encodeURIComponent(libOpen.kind) + '/' + encodeURIComponent(libOpen.id), { method: 'DELETE' });
      libOpen = null;
      libShow('list');
      await loadLibrary();
      $('libStatus').textContent = 'Deleted.';
    } catch (err) {
      $('libStatus').textContent = err.message || 'That item could not be deleted.';
    } finally { btn.disabled = false; }
  });

  // Which project a Library item belongs to (none: the general Library).
  async function showLibMove(fileId, current) {
    const sel = $('libMove');
    let list = [];
    try { list = (await api('/v1/projects')).projects || []; } catch { return; }
    if (!libOpen || libOpen.id !== fileId) return;
    sel.replaceChildren(mk('option', '', 'No project'), ...list.map((p) => { const o = mk('option', '', p.name); o.value = p.id; return o; }));
    sel.firstChild.value = '';
    sel.value = current && list.some((p) => p.id === current) ? current : '';
    sel.dataset.file = fileId;
    $('libMoveRow').hidden = false;
  }
  $('libMove').addEventListener('change', async () => {
    const sel = $('libMove');
    sel.disabled = true;
    try {
      await api('/v1/project-links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'file', id: sel.dataset.file, project_id: sel.value || null }) });
      const f = libFiles.find((x) => x.id === sel.dataset.file);
      if (f) f.project_id = sel.value || null;
      $('libStatus').textContent = sel.value ? 'Moved to the project. Only that project’s chats use it now.' : 'Moved to your general Library.';
    } catch (err) {
      $('libStatus').textContent = err.message || 'That could not be moved.';
    } finally { sel.disabled = false; }
  });

  // ---------- Projects (signed in) ----------
  // The person's own workspaces. A project's chats get its instructions, open
  // tasks and only its Library items; the server keeps each project apart.

  const PRJ_STATUS = { active: 'Active', paused: 'Paused', done: 'Done' };
  let prjOpen = null;      // the project being viewed (with tasks, chats, files)
  let prjEditing = null;   // id while editing, null while creating
  let prjRun = 0;

  function setChatProject(p) {
    chatProject = p && typeof p.id === 'string' ? { id: p.id, name: String(p.name || 'Project') } : null;
    $('projectBar').hidden = !chatProject;
    $('projectBarName').textContent = chatProject ? 'In project: ' + chatProject.name : '';
  }
  $('projectLeave').addEventListener('click', () => $('newChat').click());

  function prjShow(view) {
    $('prjListView').hidden = view !== 'list';
    $('prjFormView').hidden = view !== 'form';
    $('prjItemView').hidden = view !== 'item';
    $('prjStatusMsg').textContent = '';
  }

  async function loadProjects() {
    const run = ++prjRun;
    $('prjStatusMsg').textContent = 'Loading…';
    try {
      const data = await api('/v1/projects');
      if (run !== prjRun) return;
      const list = (data.projects || []).filter((p) => p && typeof p.id === 'string');
      $('prjList').replaceChildren(...list.map((p) => {
        const li = mk('li', 'history-item');
        const open = mk('button', 'history-open lib-open');
        open.type = 'button';
        open.append(mk('span', 'history-title', p.name), mk('span', 'history-time', `${PRJ_STATUS[p.status] || ''} · ${when(p.updated_at)}`));
        open.addEventListener('click', () => openProject(p.id));
        li.appendChild(open);
        return li;
      }));
      $('prjStatusMsg').textContent = list.length ? '' : 'No projects yet. A project keeps chats, files, tasks and instructions together.';
    } catch (err) {
      if (run !== prjRun) return;
      $('prjList').replaceChildren();
      $('prjStatusMsg').textContent = err.message || 'Your projects could not be loaded.';
    }
  }

  function openProjectForm(p) {
    prjEditing = p ? p.id : null;
    prjShow('form');
    $('prjName').value = p ? p.name : '';
    $('prjDesc').value = p ? p.description : '';
    $('prjInstr').value = p ? p.instructions : '';
    $('prjStatus').value = p ? p.status : 'active';
    $('prjStatusRow').hidden = !p;
    $('prjFormBack').textContent = p ? '‹ ' + p.name : '‹ Projects';
    $('prjName').focus();
  }
  $('prjNew').addEventListener('click', () => openProjectForm(null));
  $('prjEdit').addEventListener('click', () => { if (prjOpen) openProjectForm(prjOpen); });
  $('prjFormBack').addEventListener('click', () => (prjEditing ? openProject(prjEditing) : (prjShow('list'), loadProjects())));
  $('prjFormView').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('prjSave');
    btn.disabled = true;
    $('prjStatusMsg').textContent = 'Saving…';
    const body = { name: $('prjName').value, description: $('prjDesc').value, instructions: $('prjInstr').value, ...(prjEditing ? { status: $('prjStatus').value } : {}) };
    try {
      const p = await api(prjEditing ? '/v1/projects/' + encodeURIComponent(prjEditing) : '/v1/projects', {
        method: prjEditing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      if (chatProject && chatProject.id === p.id) setChatProject(p);
      await openProject(p.id);
      $('prjStatusMsg').textContent = 'Saved.';
    } catch (err) {
      $('prjStatusMsg').textContent = err.message || 'The project could not be saved.';
    } finally { btn.disabled = false; }
  });

  async function openProject(id) {
    prjShow('item');
    $('prjStatusMsg').textContent = 'Loading…';
    try {
      const p = await api('/v1/projects/' + encodeURIComponent(id));
      prjOpen = p;
      renderProject();
      $('prjStatusMsg').textContent = '';
      $('prjBack').focus();
    } catch (err) {
      prjOpen = null;
      $('prjStatusMsg').textContent = err.message || 'That project could not be opened.';
    }
  }

  function taskRow(t) {
    const li = mk('li', 'prj-task' + (t.done ? ' is-done' : ''));
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = t.done;
    box.id = 'task-' + t.id;
    box.setAttribute('aria-label', (t.done ? 'Mark not done: ' : 'Mark done: ') + t.text);
    const label = mk('label', 'prj-task-text', t.text);
    label.htmlFor = box.id;
    const del = mk('button', 'icon-btn prj-task-del');
    del.type = 'button';
    del.setAttribute('aria-label', 'Delete task: ' + t.text);
    del.title = 'Delete task';
    del.appendChild(svgIcon('M6 6l12 12M18 6 6 18'));
    box.addEventListener('change', async () => {
      box.disabled = true;
      try {
        const u = await api(`/v1/projects/${encodeURIComponent(prjOpen.id)}/tasks/${encodeURIComponent(t.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ done: box.checked }) });
        t.done = u.done;
        li.classList.toggle('is-done', t.done);
        prjMeta();
        if (t.done && !reduced()) Nasrin.flash('happy', 700);
      } catch (err) {
        box.checked = t.done;
        $('prjStatusMsg').textContent = err.message || 'That task could not be changed.';
      } finally { box.disabled = false; }
    });
    del.addEventListener('click', async () => {
      del.disabled = true;
      try {
        await api(`/v1/projects/${encodeURIComponent(prjOpen.id)}/tasks/${encodeURIComponent(t.id)}`, { method: 'DELETE' });
        prjOpen.tasks = prjOpen.tasks.filter((x) => x.id !== t.id);
        li.remove();
        prjMeta();
      } catch (err) {
        del.disabled = false;
        $('prjStatusMsg').textContent = err.message || 'That task could not be deleted.';
      }
    });
    li.append(box, label, del);
    return li;
  }

  function prjMeta() {
    const p = prjOpen;
    const open = p.tasks.filter((t) => !t.done).length;
    $('prjMeta').textContent = `${PRJ_STATUS[p.status] || ''} · ${open} open task${open === 1 ? '' : 's'} · updated ${when(p.updated_at)}`;
  }

  function renderProject() {
    const p = prjOpen;
    $('prjTitle').textContent = p.name;
    prjMeta();
    $('prjDescShown').textContent = p.description || '';
    $('prjDescShown').hidden = !p.description;
    $('prjTasks').replaceChildren(...p.tasks.map(taskRow));
    const row = (title, meta, onOpen) => {
      const li = mk('li', 'history-item');
      const b = mk('button', 'history-open lib-open');
      b.type = 'button';
      b.append(mk('span', 'history-title', title), mk('span', 'history-time', meta));
      b.addEventListener('click', onOpen);
      li.appendChild(b);
      return li;
    };
    $('prjChats').replaceChildren(...(p.chats.length ? p.chats.map((c) => row(c.title || 'Untitled chat', when(c.updated_at), () => openChat(c.id))) : [mk('li', 'setting-hint prj-empty', 'No chats yet.')]));
    $('prjFiles').replaceChildren(...(p.files.length ? p.files.map((f) => row(f.title, LIB_KIND[f.kind] || '', () => { showTab('library'); openLibraryItem(f.id, p.id); })) : [mk('li', 'setting-hint prj-empty', 'No files yet. Only this project’s chats use its files.')]));
  }

  $('prjBack').addEventListener('click', () => { prjOpen = null; prjShow('list'); loadProjects(); });
  $('prjChat').addEventListener('click', () => {
    if (!prjOpen || busy) return;
    const p = { id: prjOpen.id, name: prjOpen.name };
    closeHistory();
    $('newChat').click();
    setChatProject(p);
    input.focus();
  });
  $('prjTaskForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('prjTaskText').value.trim();
    if (!text || !prjOpen) return;
    $('prjTaskText').disabled = true;
    try {
      const t = await api(`/v1/projects/${encodeURIComponent(prjOpen.id)}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
      prjOpen.tasks.push(t);
      $('prjTasks').appendChild(taskRow(t));
      prjMeta();
      $('prjTaskText').value = '';
    } catch (err) {
      $('prjStatusMsg').textContent = err.message || 'That task could not be added.';
    } finally { $('prjTaskText').disabled = false; $('prjTaskText').focus(); }
  });
  $('prjAddFile').addEventListener('click', () => $('prjFile').click());
  $('prjFile').addEventListener('change', async () => {
    const file = $('prjFile').files && $('prjFile').files[0];
    $('prjFile').value = '';
    if (!file || !prjOpen) return;
    if (!/\.(txt|text|log|md|markdown|csv|tsv|json)$/i.test(file.name)) { $('prjStatusMsg').textContent = 'Add .txt, .md, .csv or .json files.'; return; }
    if (file.size > 800_000) { $('prjStatusMsg').textContent = 'That file is too big for the Library.'; return; }
    let text;
    try { text = await file.text(); } catch { $('prjStatusMsg').textContent = 'That file could not be read.'; return; }
    $('prjStatusMsg').textContent = 'Saving…';
    try {
      await api('/v1/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'file', title: file.name, text, project_id: prjOpen.id }) });
      await openProject(prjOpen.id);
      $('prjStatusMsg').textContent = 'Added to the project.';
    } catch (err) {
      $('prjStatusMsg').textContent = err.message || 'That file could not be added.';
    }
  });
  $('prjDelete').addEventListener('click', async () => {
    if (!prjOpen || !window.confirm(`Delete the project “${prjOpen.name}”? Its tasks and instructions are deleted. Its chats and files are kept, outside any project.`)) return;
    const btn = $('prjDelete');
    btn.disabled = true;
    try {
      await api('/v1/projects/' + encodeURIComponent(prjOpen.id), { method: 'DELETE' });
      if (chatProject && chatProject.id === prjOpen.id) setChatProject(null);
      prjOpen = null;
      prjShow('list');
      await loadProjects();
      $('prjStatusMsg').textContent = 'Project deleted.';
    } catch (err) {
      $('prjStatusMsg').textContent = err.message || 'The project could not be deleted.';
    } finally { btn.disabled = false; }
  });

  $('planBtn').addEventListener('click', () => openPlans());

  // Payment checkout (PayMongo) is added in the next step.
  async function buyPlan(p, btn) {
    btn.disabled = true;
    plansStatus.textContent = 'Opening checkout…';
    try {
      const data = await api('/v1/plans/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: p.id }) });
      if (data && typeof data.checkout_url === 'string' && data.checkout_url.startsWith('https://')) {
        location.assign(data.checkout_url);
        return;
      }
      throw new Error('Checkout is not available right now.');
    } catch (err) {
      plansStatus.textContent = err.message;
      btn.disabled = false;
    }
  }

  // ---------- start-up ----------

  async function loadStatus() {
    try {
      const resp = await fetch('/v1/status');
      if (!resp.ok) return;
      const s = await resp.json();
      aiAvailable = s.ai_available === true;
      plansEnabled = s.plans === true;
      libraryOn = s.library === true;
      projectsOn = s.projects === true;
      renderSpaceMenu();
      imagesOn = Boolean(s.images && s.images.available);
      $('pickImage').hidden = !imagesOn;
      $('starterImage').hidden = !imagesOn;
      imageLimits = imagesOn ? { perGuest: Number(s.images.per_guest) || 0, perUserDay: Number(s.images.per_user_day) || 0 } : null;
      renderImageHint();
      if (s.sign_in && typeof s.sign_in === 'object') signInMethods = { email: s.sign_in.email === true, google: s.sign_in.google === true };
      if (s.speech && Number.isFinite(s.speech.rate)) speechRate = Math.min(2, Math.max(0.5, s.speech.rate));
      if (s.speech && s.speech.available && Array.isArray(s.speech.voices) && s.speech.voices.length) {
        speech = { available: true, voices: s.speech.voices.filter((v) => v && typeof v.id === 'string' && typeof v.name === 'string'), default: s.speech.default };
      }
      const parts = ['Replies come from an AI and can be wrong. Check anything important.'];
      if (s.own_model && s.external_model) parts.push('Answers come from NasrinAI’s own model when it can; otherwise messages go to an outside AI service.');
      else if (s.own_model) parts.push('Answers come from NasrinAI’s own model; messages are not sent to an outside AI company.');
      // Any file can be added; Nasrin says plainly when she cannot read one.
      attachBtn.title = 'Add photos and files';
      attachBtn.setAttribute('aria-label', attachBtn.title);
      if (s.external_model && !s.own_model) {
        parts.push(s.redacts_contact_details
          ? 'Messages are sent to an outside AI service to be answered, with emails, phone and card numbers removed first.'
          : 'Messages are sent to an outside AI service to be answered.');
      }
      parts.push(`Guest chats are deleted after ${s.guest_session_hours} hours.`);
      if (Recognition) parts.push('Voice typing uses your browser\'s speech service.');
      renderNotes(parts);
      if (!aiAvailable) { notice.textContent = 'Nasrin is not switched on yet. Please check back soon.'; Nasrin.mood('sleepy'); }
    } catch { /* offline: keep the default text */ }
    refreshSendButton();
  }

  async function loadConversation() {
    if (!conversationId) return;
    try {
      const data = await api(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`);
      setChatProject(data.project && typeof data.project.id === 'string' ? data.project : null);
      data.messages.forEach((m, i) => show(m.role === 'user' ? 'user' : 'assistant', m.content, { animate: false, id: m.id, asks: i === data.messages.length - 1 }));
      refreshTurnControls();
    } catch {
      conversationId = null;
      saved.del(identityKey(KEYS.conversation));
      clearScreen();
    }
  }

  // Signed in before (or just back from Google): renew the session first, so
  // the models and the conversation load for the right person.
  async function restoreAccount() {
    renderAccount();
    if (!(signInMethods.email || signInMethods.google)) return;
    // The sign-in cookie, not this device's storage, says who is signed in: a
    // phone may clear a web app's storage while the cookie stays, so always ask.
    // A weak connection is retried, never mistaken for being signed out.
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await refreshAccount(); break; } catch {
        if (attempt < 2) await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
      }
    }
    if (account) {
      conversationId = saved.get(identityKey(KEYS.conversation)) || null;
      if (signinResult === 'ok') Nasrin.flash('happy', 1600);
    }
    if (account) checkTerms(signinResult === 'ok' ? 'signin' : 'update_prompt');
    renderDataControls();
  }
  // Back online after opening offline: pick the sign-in up again.
  window.addEventListener('online', () => { if (!account && saved.get(KEYS.account)) location.reload(); });

  showConnectForSignedIn();
  autosize();
  let loadingPro = null;
  loadStatus()
    .then(restoreAccount)
    .then(() => {
      showFirstVisitNotice();
      if (signinResult === 'failed') openSignIn('Google sign-in did not finish. Please try again.');
      if (aiAvailable) { loadModels(); loadingPro = loadProfessionals(); }
      loadPlans();
      if (new URLSearchParams(location.search).get('plan') === 'paid') {
        history.replaceState(null, '', location.pathname);
        openPlans('Thank you! Your plan is active once the payment is confirmed (usually within a minute).');
      }
      if (awayLong() && conversationId) { conversationId = null; saved.del(identityKey(KEYS.conversation)); notice.textContent = 'Started a new chat. Your last one is in Your chats.'; }
      saved.del(KEYS.left);
      return loadConversation();
    })
    .finally(() => Promise.resolve(loadingPro).then(() => startNotes('open')));
})();