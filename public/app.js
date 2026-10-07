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
  const micBtn = $('mic');
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

  let conversationId = saved.get(KEYS.conversation);
  let busy = false;
  let aiAvailable = true;
  let listening = false;
  // Hands-free voice conversation (see "talking with Nasrin" below).
  const vc = { on: false, state: 'idle', muted: false, recognizer: null, run: 0, silence: null, idle: null, wake: null, quick: 0, watcher: null };

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
      if (site.verification?.token) {
        const code = document.createElement('code');
        code.className = 'connect-token';
        code.textContent = site.verification.token;
        code.title = 'One-time verification value. Treat it like a secret.';
        actions.append(code);
      }
      const verify = document.createElement('button');
      verify.type = 'button';
      verify.className = 'btn small outline';
      verify.textContent = 'Verify website';
      verify.addEventListener('click', async () => {
        const token = window.prompt('Paste the one-time NasrinAI verification value you published on this website.');
        if (!token) return;
        verify.disabled = true;
        connectStatus.textContent = 'Checking website control…';
        try {
          await window.NasrinAIConnect.verify(site.id, token.trim());
          connectStatus.textContent = 'Website authorized. No installation has happened.';
          await loadConnectSites();
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
    } else if (site.status === 'active') {
      const live = document.createElement('span');
      live.className = 'connect-live';
      live.textContent = 'SmartChat active';
      actions.append(live);
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
    document.querySelectorAll('.settings-page').forEach((p) => { p.hidden = p !== connectConfigPage; });
    const title = $('settingsTitle');
    if (title) title.textContent = 'Configure SmartChat';
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
    document.querySelectorAll('.settings-page').forEach((p) => { p.hidden = p !== pageConnect; });
    if (typeof window.setSettingsTitle === 'function') window.setSettingsTitle('NasrinAI Connect');
    else { const t = $('settingsTitle'); if (t) t.textContent = 'NasrinAI Connect'; }
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
    document.querySelectorAll('.settings-page').forEach((p) => { p.hidden = p !== connectPreviewPage; });
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
      await window.NasrinAIConnect.analyze(url);
      connectUrl.value = '';
      connectStatus.textContent = 'Website analyzed. Authorization is the next step; no installation has happened.';
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
    sendBtn.title = stopping ? 'Stop' : 'Send';
    sendBtn.setAttribute('aria-label', stopping ? 'Stop the reply' : 'Send');
    sendBtn.disabled = !stopping && (busy || !aiAvailable || preparing > 0 || (!input.value.trim() && !pending.length));
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