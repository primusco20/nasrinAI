// NasrinAI chat page. Plain script, no libraries, no inline code (strict CSP).
// Every message is rendered with textContent, never as HTML.
(() => {
  'use strict';

  // Google sign-in: when the sign-in service does not accept our return
  // address it sends people back to the home page with ?code=… instead of
  // /v1/auth/google/callback. Hand the code to the callback (same site, so the
  // one-time PKCE cookie goes with it); without that cookie the code is useless.
  {
    const q = new URLSearchParams(location.search);
    const code = q.get('code');
    if (code && !q.get('signin') && !q.get('installation_id') && !q.get('setup_action') && /^[A-Za-z0-9._~-]{8,512}$/.test(code)) {
      location.replace('/v1/auth/google/callback?code=' + encodeURIComponent(code));
      return;
    }
  }

  const $ = (id) => document.getElementById(id);
  // Delegate desktop navigation to the established controls to preserve behavior.
  $('desktopNewChat')?.addEventListener('click', () => $('newChat')?.click());
  $('desktopSettingsBtn')?.addEventListener('click', () => $('settingsBtn')?.click());
  const log = $('log');
  // The message box floats over the chat; the chat keeps room for it below.
  const dock = document.querySelector('.dock');
  const fitDock = () => document.documentElement.style.setProperty('--dock-h', Math.ceil(dock.getBoundingClientRect().height) + 'px');
  if (window.ResizeObserver) new ResizeObserver(fitDock).observe(dock);
  fitDock();
  const welcome = $('welcome');
  // Dedicated animated welcome for an empty coding chat. It stays in the log
  // across clearScreen(), but CSS hides it outside coding mode or once a turn
  // has started.
  const codingEmptyState = document.createElement('section');
  codingEmptyState.className = 'coding-empty-state';
  codingEmptyState.setAttribute('aria-label', 'Coding chat welcome');
  const makeCodingWelcomeNode = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const codingArt = makeCodingWelcomeNode('div', 'coding-empty-art');
  codingArt.setAttribute('aria-hidden', 'true');
  codingArt.append(
    makeCodingWelcomeNode('span', 'coding-empty-orbit coding-empty-orbit-one'),
    makeCodingWelcomeNode('span', 'coding-empty-orbit coding-empty-orbit-two'),
    makeCodingWelcomeNode('span', 'coding-empty-spark coding-empty-spark-two', '＋'),
    makeCodingWelcomeNode('span', 'code-logo coding-empty-logo is-busy'),
    makeCodingWelcomeNode('span', 'coding-empty-cursor')
  );
  const codingTitle = makeCodingWelcomeNode('h1', 'coding-empty-title', 'What are we building today?');
  const codingSubtitle = makeCodingWelcomeNode('p', 'coding-empty-subtitle', 'Your next idea starts here.');
  const codingWords = makeCodingWelcomeNode('div', 'coding-empty-words');
  codingWords.setAttribute('aria-label', 'Websites, apps, tools, and more');
  const codingWordTrack = makeCodingWelcomeNode('div', 'coding-empty-word-track');
  codingWordTrack.setAttribute('aria-hidden', 'true');
  for (const word of ['A website', 'An app', 'A smart tool', 'Something amazing', 'A website']) {
    codingWordTrack.appendChild(makeCodingWelcomeNode('span', '', word));
  }
  codingWords.appendChild(codingWordTrack);
  const codingSphere = makeCodingWelcomeNode('span', 'coding-empty-sphere');
  codingSphere.setAttribute('aria-hidden', 'true');
  codingArt.prepend(codingSphere);
  codingEmptyState.append(codingArt, codingTitle, codingSubtitle, codingWords);
  log.appendChild(codingEmptyState);
  const hero = $('hero');
  const form = $('composer');
  const input = $('input');
  const sendBtn = $('send');
  const micBtn = sendBtn;
  const notice = $('notice');
  // The small inline status banner (including the coding-chat hint) must
  // never remain stuck on screen. The separate new-user welcome card
  // (#appNotice) is intentionally unaffected and remains dismissible by its
  // close button.
  let inlineNoticeTimer = null;
  if (notice && window.MutationObserver) {
    const inlineNoticeObserver = new MutationObserver(() => {
      if (inlineNoticeTimer !== null) {
        clearTimeout(inlineNoticeTimer);
        inlineNoticeTimer = null;
      }
      const message = notice.textContent;
      if (!message || !message.trim()) return;
      inlineNoticeTimer = setTimeout(() => {
        inlineNoticeTimer = null;
        if (notice.textContent === message) notice.textContent = '';
      }, 3000);
    });
    inlineNoticeObserver.observe(notice, { childList: true, characterData: true, subtree: true });
  }
  const settingsBtn = $('settingsBtn');
  const sheet = $('settings');
  const scrim = $('scrim');
  const readAloud = $('readAloud');
  const voicesBox = $('voices');
  const languagePreference = $('languagePreference');
  const modelRow = $('modelRow');
  const modelBtn = $('modelBtn');
  const modelMenu = $('modelMenu');
  const tray = $('tray');
  const attachBtn = $('attach');
  const fileInput = $('fileInput');
  // Less motion: the device asks for it, or Settings > General > Reduce motion.
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => motionQuery.matches || document.documentElement.getAttribute('data-motion') === 'reduce';
  dotSphere(codingSphere);
  const Nasrin = window.Nasrin;

  // localStorage holds only the guest session, the current conversation id,
  // the signed-in email (for display; the sign-in itself is an HttpOnly cookie
  // scripts cannot read) and preferences. The conversation lives on the server.
  const KEYS = {
    session: 'nasrin.session', conversation: 'nasrin.conversation', speak: 'nasrin.speak',
    model: 'nasrin.model', theme: 'nasrin.theme', palette: 'nasrin.palette', tabbar: 'nasrin.tabbar', voice: 'nasrin.voice', account: 'nasrin.account',
    notice: 'nasrin.notice', citeStyle: 'nasrin.citeStyle', motion: 'nasrin.motion', pro: 'nasrin.pro', coding: 'nasrin.coding', codeChats: 'nasrin.codeChats', proCatalog: 'nasrin.proCatalog', libraryOn: 'nasrin.libraryOn', memoryAsk: 'nasrin.memoryAsk',
    notices: 'nasrin.notices', deviceRealtime: 'nasrin.deviceRealtime', deviceNotified: 'nasrin.deviceNotified', speechRate: 'nasrin.speechRate', language: 'nasrin.language', left: 'nasrin.left'
  };
  const saved = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } }
  };

  const LANGUAGE_OPTIONS = [
    ['auto','Device default','Detect from this device'],['en','English','English'],['fil','Filipino','Filipino'],['ceb','Cebuano','Cebuano'],
    ['es','Español','Spanish'],['fr','Français','French'],['de','Deutsch','German'],['it','Italiano','Italian'],['pt','Português','Portuguese'],
    ['nl','Nederlands','Dutch'],['pl','Polski','Polish'],['uk','Українська','Ukrainian'],['ru','Русский','Russian'],['tr','Türkçe','Turkish'],
    ['ar','العربية','Arabic'],['he','עברית','Hebrew'],['fa','فارسی','Persian'],['hi','हिन्दी','Hindi'],['bn','বাংলা','Bangla'],['ur','اردو','Urdu'],
    ['gu','ગુજરાતી','Gujarati'],['mr','मराठी','Marathi'],['ta','தமிழ்','Tamil'],['te','తెలుగు','Telugu'],['ml','മലയാളം','Malayalam'],['kn','ಕನ್ನಡ','Kannada'],
    ['th','ไทย','Thai'],['vi','Tiếng Việt','Vietnamese'],['id','Bahasa Indonesia','Indonesian'],['ms','Bahasa Melayu','Malay'],
    ['ja','日本語','Japanese'],['ko','한국어','Korean'],['zh','中文','Chinese'],['yue','廣東話','Cantonese'],['el','Ελληνικά','Greek'],
    ['sv','Svenska','Swedish'],['da','Dansk','Danish'],['no','Norsk','Norwegian'],['fi','Suomi','Finnish'],['cs','Čeština','Czech'],
    ['hu','Magyar','Hungarian'],['ro','Română','Romanian'],['bg','Български','Bulgarian'],['hr','Hrvatski','Croatian'],['sk','Slovenčina','Slovak'],
    ['sr','Српски','Serbian'],['sw','Kiswahili','Swahili'],['am','አማርኛ','Amharic'],['my','မြန်မာ','Burmese'],['km','ខ្មែរ','Khmer'],
    ['lo','ລາວ','Lao'],['ne','नेपाली','Nepali'],['pa','ਪੰਜਾਬੀ','Punjabi'],['et','Eesti','Estonian'],['lv','Latviešu','Latvian'],
    ['lt','Lietuvių','Lithuanian'],['sl','Slovenščina','Slovenian'],['is','Íslenska','Icelandic'],['ga','Gaeilge','Irish'],
    ['af','Afrikaans','Afrikaans'],['sq','Shqip','Albanian'],['hy','Հայերեն','Armenian'],['ka','ქართული','Georgian'],['kk','Қазақша','Kazakh'],
    ['uz','Oʻzbekcha','Uzbek'],['az','Azərbaycanca','Azerbaijani']
  ];
  const languageBase = () => {
    const value = saved.get(KEYS.language);
    if (value && value !== 'auto') return value;
    return String(navigator.language || 'en').toLowerCase().split('-')[0];
  };
  function renderLanguageOptions() {
    if (!languagePreference) return;
    const selected = saved.get(KEYS.language) || 'auto';
    languagePreference.replaceChildren(...LANGUAGE_OPTIONS.map(([code,native,english]) => {
      const option = document.createElement('option');
      option.value = code; option.textContent = code === 'auto' ? native : native + ' — ' + english; option.selected = selected === code;
      return option;
    }));
  }
  renderLanguageOptions();
  if (languagePreference) languagePreference.addEventListener('change', () => { saved.set(KEYS.language, languagePreference.value); renderLanguageOptions(); renderVoices(); });

  let activeAccountEmail = null;
  const identityKey = (key) => activeAccountEmail ? `${key}:${encodeURIComponent(activeAccountEmail.toLowerCase())}` : key;
  let conversationId = saved.get(identityKey(KEYS.conversation));
  // Which chats are coding chats (and their project), on this device, so the
  // menu can list them apart and reopen them in the coding chat.
  const codeChats = () => { const m = saved.get(identityKey(KEYS.codeChats)); return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; };
  function rememberCodeChat(id, p) {
    if (typeof id !== 'string' || !p || typeof p.id !== 'string') return;
    const m = codeChats();
    if (m[id] && m[id].id === p.id) return;
    delete m[id];
    m[id] = { id: p.id, name: String(p.name || 'Project').slice(0, 80) };
    const ids = Object.keys(m);
    for (const old of ids.slice(0, Math.max(0, ids.length - 200))) delete m[old];
    saved.set(identityKey(KEYS.codeChats), m);
  }
  // Each visible conversation has a generation number. A request from an older
  // view can finish and persist without writing into the newly opened chat.
  let chatViewEpoch = 0;
  // The coding chat (Code in the menu): a project-scoped chat with coding experts.
  let github = { available: false, connected: false, login: null, install: null, autoPr: false, accounts: [], max: 10 };   // GitHub connection (docs/github.md)
  let codingProject = null;   // { id, name } while the coding chat is open
  let busy = false;
  let aiAvailable = true;
  let listening = false;
  // Hands-free voice conversation (see "talking with Nasrin" below).
  const vc = { on: false, state: 'idle', muted: false, recognizer: null, run: 0, silence: null, idle: null, wake: null, quick: 0, watcher: null, realtimePc: null, realtimeEvents: null, realtimeStream: null, realtimeAudio: null, realtime: false, realtimeProvider: null, realtimeMaxSeconds: 0, realtimeTimer: null, realtimeReconnectTimer: null, realtimeRetryCount: 0, geminiState: null, audioCtx: null, audioEl: null };

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
  let connectPlanEligible = false;

  function showConnectForSignedIn() {
    if (!connectMenu || !connectLabel) return;
    const visible = Boolean(account) && connectPlanEligible;
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
  async function net(url, init = {}) {
    try { return await fetch(url, { ...init, credentials: 'same-origin' }); } catch {
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
  let sessionReauthPrompted = false;

  async function refreshAccount() {
    if (!refreshing) {
      refreshing = (async () => {
        // One refresh at a time across every tab of this site (Web Locks):
        // the sign-in service ends the whole sign-in when the same refresh
        // token is used twice, and two tabs share one refresh cookie.
        const oneAtATime = (fn) => (navigator.locks && typeof navigator.locks.request === 'function'
          ? navigator.locks.request('nasrin-auth-refresh', fn) : fn());
        const resp = await oneAtATime(async () => {
          let r;
          // A different tab may have just rotated the shared refresh cookie. Retry
          // one 401 after a short pause before treating the session as unavailable.
          for (let attempt = 0; attempt < 2; attempt++) {
            r = await net('/v1/auth/refresh', { method: 'POST' });
            if (r.status !== 401 || attempt === 1) break;
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          return r;
        });
        if (resp.status === 401) {
          const was = account;
          signedOut();
          if (was) {
            switchIdentity();
            // Do not silently downgrade an expired signed-in session to a guest
            // session: that makes account settings appear broken and stay disabled.
            if (!sessionReauthPrompted) {
              sessionReauthPrompted = true;
              void openSignIn('Your sign-in session expired. Please sign in again to change your privacy settings.');
            }
          }
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

  let ownerBootstrapToken = '';
  let ownerBootstrapAt = 0;

  async function syncOwnerConsoleEntry(token) {
    if (!token || (ownerBootstrapToken === token && Date.now() - ownerBootstrapAt < 8 * 60 * 1000)) return;
    ownerBootstrapToken = token;
    ownerBootstrapAt = Date.now();
    const existing = $('ownerConsoleEntry');
    if (existing) existing.remove();
    try {
      const response = await fetch('https://owner.nasrinai.com/v1/owner/session', {
        method: 'POST', credentials: 'include', mode: 'cors', cache: 'no-store',
        headers: { Authorization: 'Bearer ' + token }
      });
      if (response.status === 204 && !document.getElementById('ownerConsoleEntry')) {
        const button = document.createElement('button');
        button.type = 'button'; button.id = 'ownerConsoleEntry'; button.className = 'menu-row';
        button.textContent = 'Owner Command Center';
        button.addEventListener('click', async () => { await syncOwnerConsoleEntry(account && account.token); window.location.href = 'https://owner.nasrinai.com/owner'; });
        $('pageMain')?.appendChild(button);
      } else if (response.status !== 204) $('ownerConsoleEntry')?.remove();
    } catch {
      ownerBootstrapAt = Date.now();
      $('ownerConsoleEntry')?.remove();
    }
  }

  async function credential(fresh) {
    if (account) {
      const hadSignedInAccount = account;
      if (fresh || account.until - Date.now() < 60_000) await refreshAccount();
      if (account) return account.token;
      if (hadSignedInAccount) {
        // Preserve the distinction between an expired account and a real guest.
        // A protected settings call must not be retried using a guest credential.
        throw Object.assign(new Error('Your sign-in session expired. Please sign in again.'), {
          code: 'session_expired', status: 401
        });
      }
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

  // The chat follows new text only while the person is at the bottom. If they
  // scroll up to read, it stays where they are until they scroll back down
  // (or send a message). Only the person's own scrolling (wheel, touch, keys)
  // can unstick it; the page's own scrolling never does.
  let following = true;
  let touchedAt = 0;
  let touchY = 0;
  // Moving up stops following at once (before the scroll itself lands, so a
  // word arriving in between cannot pull the chat back down).
  const up = () => { touchedAt = Date.now(); following = false; };
  log.addEventListener('wheel', (e) => { touchedAt = Date.now(); if (e.deltaY < 0) up(); }, { passive: true });
  log.addEventListener('touchstart', (e) => { touchedAt = Date.now(); touchY = e.touches[0]?.clientY || 0; }, { passive: true });
  log.addEventListener('touchmove', (e) => { touchedAt = Date.now(); if ((e.touches[0]?.clientY || 0) > touchY + 4) up(); }, { passive: true });
  log.addEventListener('pointerdown', () => { touchedAt = Date.now(); }, { passive: true });
  document.addEventListener('keydown', (e) => { if (['PageUp', 'ArrowUp', 'Home'].includes(e.key) && e.target === log) up(); });
  log.addEventListener('scroll', () => {
    if (Date.now() - touchedAt > 1000) return;
    following = log.scrollHeight - log.scrollTop - log.clientHeight < 96;
  }, { passive: true });
  function scrollToEnd(el, { force = false, instant = false } = {}) {
    if (force) following = true;
    if (!following) return;
    el.scrollIntoView({ block: 'end', behavior: instant || reduced() ? 'auto' : 'smooth' });
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

  // ---------- citations (public/cite.js, POST /v1/cite) ----------

  // "cite …", "citation for …", "reference for …" with one link or DOI.
  function citeTarget(text) {
    if (!/\b(cite|citation|citations|reference|bibliography|bibtex)\b/i.test(text)) return null;
    const doi = (/\b(10\.\d{4,9}\/[^\s"<>]+)/i.exec(text) || [])[1];
    const urls = text.match(/https?:\/\/[^\s<>"']+/g) || [];
    if (urls.length > 1) return null;
    if (urls.length === 1) return { url: urls[0].replace(/[.,;)\]]+$/, '') };
    return doi ? { doi: doi.replace(/[.,;)\]]+$/, '') } : null;
  }

  async function citeMessage(text, target) {
    noticesOnSend();
    show('user', text);
    input.value = '';
    autosize();
    busy = true;
    refreshSendButton();
    startChat();
    const loading = genLoader('Finding the publication details', { compact: true, timer: false });
    loading.el.classList.add('msg', 'assistant');
    log.appendChild(loading.el);
    scrollToEnd(loading.el);
    try {
      const { citation } = await api('/v1/cite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) });
      loading.remove();
      const el = mk('div', 'msg assistant is-new');
      el.appendChild(citeCard(citation));
      log.appendChild(el);
      scrollToEnd(el);
    } catch (err) {
      loading.remove();
      show('problem', err.message || 'The publication details could not be found.');
    } finally {
      busy = false;
      refreshSendButton();
    }
  }

  // Under a source in a reply's Sources list: open (or close) its citation.
  async function toggleCite(li, button, target) {
    const open = li.querySelector('.cite-card');
    if (open) { open.remove(); button.setAttribute('aria-expanded', 'false'); return; }
    button.disabled = true;
    button.textContent = 'Looking up…';
    try {
      const { citation } = await api('/v1/cite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(target) });
      li.appendChild(citeCard(citation));
      button.setAttribute('aria-expanded', 'true');
    } catch (err) {
      notice.textContent = err.message || 'The publication details could not be found.';
    } finally {
      button.disabled = false;
      button.textContent = 'Cite';
    }
  }

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const fullName = (a) => a.literal || [a.given, a.family].filter(Boolean).join(' ');

  // The details, organized, then the citation in the chosen style with Copy.
  function citeCard(c) {
    const card = mk('section', 'cite-card');
    card.setAttribute('aria-label', 'Citation');
    const dl = mk('dl', 'cite-details');
    const row = (label, value, href) => {
      if (!value) return;
      dl.appendChild(mk('dt', '', label));
      const dd = mk('dd');
      if (href) {
        const a = mk('a', '', value);
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        dd.appendChild(a);
      } else dd.textContent = value;
      dl.appendChild(dd);
    };
    const p = c.published;
    row(c.authors.length === 1 ? 'Author' : 'Authors', c.authors.map(fullName).join('; '));
    row('Title', c.title);
    row(c.type === 'webpage' || c.type === 'article' ? 'Website' : 'Published in', c.container);
    row('Published', p ? [p.day, p.month ? MONTH_NAMES[p.month - 1] : '', p.year].filter(Boolean).join(' ') : '');
    row('Volume / issue', [c.volume ? 'Vol. ' + c.volume : '', c.issue ? 'No. ' + c.issue : ''].filter(Boolean).join(', '));
    row('Pages', c.pages);
    row('Publisher', c.publisher);
    row('ISSN', c.issn);
    row('ISBN', c.isbn);
    row('DOI', c.doi, c.doi ? 'https://doi.org/' + c.doi : '');
    if (!c.doi && /^https?:\/\//.test(c.url || '')) row('Link', c.url.replace(/^https?:\/\//, ''), c.url);
    row('Accessed', c.accessed);
    card.appendChild(dl);
    card.appendChild(mk('p', 'cite-from', c.from === 'crossref'
      ? 'Details from Crossref, the publisher’s DOI record.'
      : 'Details from the page’s own publication information. Check them against the source before you rely on them.'));
    const missing = [!c.authors.length ? 'author' : '', !p ? 'date' : ''].filter(Boolean);
    if (missing.length) card.appendChild(mk('p', 'cite-from', `No ${missing.join(' or ')} was given by the source, so none is shown.`));

    const styles = mk('div', 'cite-styles');
    styles.setAttribute('role', 'radiogroup');
    styles.setAttribute('aria-label', 'Citation style');
    const out = mk('div', 'cite-out');
    out.setAttribute('aria-live', 'polite');
    let style = saved.get(KEYS.citeStyle) || 'apa';
    if (!window.NasrinCite.STYLES.some((x) => x.id === style)) style = 'apa';
    let parts = [];
    const render = () => {
      parts = window.NasrinCite.format(c, style);
      out.replaceChildren(...parts.map((x) => (x.i ? mk('i', '', x.t) : document.createTextNode(x.t))));
      out.classList.toggle('is-code', style === 'bibtex');
      for (const b of styles.children) b.setAttribute('aria-checked', String(b.dataset.style === style));
    };
    for (const s of window.NasrinCite.STYLES) {
      const b = mk('button', 'cite-style', s.label);
      b.type = 'button';
      b.dataset.style = s.id;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => { style = s.id; saved.set(KEYS.citeStyle, style); render(); });
      styles.appendChild(b);
    }
    const copy = mk('button', 'btn small cite-copy', 'Copy citation');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      const text = window.NasrinCite.plain(parts);
      let ok = false;
      // With italics for Word and Google Docs, where the browser allows it.
      if (window.ClipboardItem && navigator.clipboard?.write && style !== 'bibtex') {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([window.NasrinCite.html(parts)], { type: 'text/html' }) })]);
          ok = true;
        } catch { ok = false; }
      }
      if (!ok) ok = await copyText(text);
      if (ok) { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy citation'; }, 1600); }
    });
    card.append(styles, out, copy);
    render();
    return card;
  }

  // ---------- the messy-file cleaner (public/cleaner.js) ----------

  const CLEAN_ASK = /\b(clean|cleanup|tidy|organi[sz]e|sort out|fix|messy|dashboard|arrange)\b/i;
  const isSheetFile = (f) => f.local && /\.(csv|tsv|xlsx|xlsm)$/i.test(f.name || '');
  const inflateRaw = async (u8) => {
    if (typeof DecompressionStream !== 'function') throw Object.assign(new Error('This browser cannot open Excel files here. Save the file as CSV, then try again.'), { code: 'clean_refused' });
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  };
  const fmtNum = (n, pct) => (pct ? (n * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '%' : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));

  async function cleanFiles(text, files) {
    noticesOnSend();
    show('user', text, { files });
    input.value = '';
    autosize();
    busy = true;
    refreshSendButton();
    const sheetFiles = files.filter(isSheetFile);
    for (const f of sheetFiles) {
      startChat();
      const loading = genLoader('Cleaning ' + f.name, { compact: true });
      loading.el.classList.add('msg', 'assistant');
      log.appendChild(loading.el);
      scrollToEnd(loading.el);
      try {
        const bytes = new Uint8Array(await f.local.arrayBuffer());
        const sheets = await window.NasrinCleaner.read({ name: f.name, bytes }, inflateRaw);
        const result = await window.NasrinCleaner.clean(sheets);
        loading.remove();
        const el = mk('div', 'msg assistant is-new');
        el.appendChild(cleanerCard(result, f.name));
        log.appendChild(el);
        scrollToEnd(el);
      } catch (err) {
        loading.remove();
        show('problem', err.code === 'clean_refused' ? err.message : `"${f.name}" could not be cleaned. Check that it is a .xlsx or .csv file.`);
      }
    }
    if (sheetFiles.length < files.length) show('problem', 'Only spreadsheets and CSV files can be cleaned; the other files were not used.');
    busy = false;
    refreshSendButton();
    Nasrin.flash('happy', 1600);
  }

  // The result: the check, what was done, a small dashboard per sheet, the
  // first rows, and the cleaned workbook to download.
  function cleanerCard(result, fileName) {
    const card = mk('section', 'clean-card');
    card.setAttribute('aria-label', 'Cleaned ' + fileName);
    card.appendChild(mk('h3', 'clean-title', 'Cleaned · ' + fileName));
    const check = mk('p', 'clean-check' + (result.check.ok ? ' is-ok' : ' is-warn'),
      result.check.ok
        ? `All ${result.check.values.toLocaleString()} values accounted for · nothing lost`
        : 'Not verified: some values could not be matched. Compare with the original before using it.');
    check.setAttribute('role', 'status');
    card.appendChild(check);
    for (const s of result.sheets) {
      const sec = mk('div', 'clean-sheet');
      if (result.sheets.length > 1) sec.appendChild(mk('h4', 'clean-sheet-name', s.name));
      const c = s.counts;
      const facts = mk('ul', 'clean-facts');
      const fact = (t) => facts.appendChild(mk('li', '', t));
      fact(`${c.rows.toLocaleString()} rows · ${c.columns} columns`);
      if (s.headerRow) fact(`Headers found on row ${s.headerRow}`); else fact('No header row found; columns were numbered');
      const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
      const empties = [c.emptyRows ? plural(c.emptyRows, 'empty row') : '', c.emptyCols ? plural(c.emptyCols, 'empty column') : ''].filter(Boolean);
      if (empties.length) fact('Removed ' + empties.join(' and '));
      if (c.repeatedHeaders) fact(`Removed ${c.repeatedHeaders} repeated header row${c.repeatedHeaders === 1 ? '' : 's'}`);
      if (c.changed) fact(`${c.changed.toLocaleString()} numbers and dates written one way (listed in Changes)`);
      if (c.review) fact(`${c.review} value${c.review === 1 ? '' : 's'} to look at, kept as written (listed in Summary)`);
      if (c.duplicates) fact(`${c.duplicates} row${c.duplicates === 1 ? '' : 's'} look the same as another (kept, listed)`);
      for (const n of s.notes) fact('Note from the file: ' + n);
      sec.appendChild(facts);
      // Dashboard
      const d = s.dashboard;
      if (d.numbers.length || d.dates.length || d.categories.length) {
        const tiles = mk('div', 'clean-tiles');
        for (const n of d.numbers) {
          const t = mk('div', 'clean-tile');
          t.append(mk('span', 'clean-tile-label', n.label), mk('strong', 'clean-tile-value', n.percent ? fmtNum(n.avg, true) + ' avg' : fmtNum(n.sum)),
            mk('span', 'clean-tile-sub', n.percent ? `${fmtNum(n.min, true)} – ${fmtNum(n.max, true)}` : `avg ${fmtNum(n.avg)} · ${fmtNum(n.min)} – ${fmtNum(n.max)}`));
          tiles.appendChild(t);
        }
        for (const x of d.dates) {
          const t = mk('div', 'clean-tile');
          t.append(mk('span', 'clean-tile-label', x.label), mk('strong', 'clean-tile-value', x.first === x.last ? x.first : `${x.first} → ${x.last}`), mk('span', 'clean-tile-sub', `${x.count} dates`));
          tiles.appendChild(t);
        }
        sec.appendChild(tiles);
        for (const cat of d.categories) {
          const box = mk('div', 'clean-bars');
          box.appendChild(mk('span', 'clean-tile-label', `${cat.label} · top ${cat.top.length} of ${cat.distinct}`));
          const max = cat.top[0].count;
          for (const item of cat.top) {
            const row = mk('div', 'clean-bar');
            const fill = mk('span', 'clean-bar-fill');
            fill.style.setProperty('--w', Math.max(4, Math.round((item.count / max) * 100)) + '%');
            row.append(mk('span', 'clean-bar-name', item.value), fill, mk('span', 'clean-bar-count', String(item.count)));
            box.appendChild(row);
          }
          sec.appendChild(box);
        }
      }
      // The first rows
      const wrap = mk('div', 'clean-table-wrap');
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'First rows of ' + s.name);
      const table = mk('table', 'clean-table');
      const head = mk('tr');
      for (const h of s.header) head.appendChild(mk('th', '', h));
      table.appendChild(mk('thead')).appendChild(head);
      const body = mk('tbody');
      for (const r of s.rows.slice(0, 20)) {
        const tr = mk('tr');
        r.cells.forEach((cell) => tr.appendChild(mk('td', cell.t === 'number' || cell.t === 'percent' ? 'is-num' : '', cell.t === 'blank' ? '' : cell.t === 'number' ? fmtNum(cell.v) : cell.t === 'percent' ? fmtNum(cell.v, true) : String(cell.v))));
        body.appendChild(tr);
      }
      table.appendChild(body);
      wrap.appendChild(table);
      sec.appendChild(wrap);
      if (s.rows.length > 20) sec.appendChild(mk('p', 'clean-more', `Showing 20 of ${s.rows.length.toLocaleString()} rows. The download has them all.`));
      card.appendChild(sec);
    }
    const get = mk('button', 'btn small clean-get', 'Download cleaned workbook');
    get.type = 'button';
    get.addEventListener('click', () => {
      const blob = window.NasrinCleaner.workbook(result, fileName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace(/\.[^.]+$/, '') + '-cleaned.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
    card.appendChild(get);
    card.appendChild(mk('p', 'clean-foot', 'Cleaned on this device by fixed rules; the file was not sent anywhere. Your original file is unchanged.'));
    return card;
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
    const questionList = document.createElement('ul');
    questionList.className = 'ask-questions';
    questionList.setAttribute('aria-label', 'Follow-up questions');
    asks.forEach((q, i) => {
      const item = document.createElement('li');
      item.appendChild(questionBox(q, (value) => { picked[i] = value; refresh(); }));
      questionList.appendChild(item);
    });
    card.appendChild(questionList);
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

  function show(role, text, { animate = true, files = [], id = null, regenerate = null, asks = true, fresh = false, responseMetadata = null } = {}) {
    startChat();
    const attachmentRefs = [...String(text || '').matchAll(/\[attachment:([0-9a-f-]{36})\|([^|\]]*)\|([^|\]]*)\]/g)].map((m) => {
      let name = 'Attachment';
      let mime = 'application/octet-stream';
      try { name = decodeURIComponent(m[2]) || name; } catch {}
      try { mime = decodeURIComponent(m[3]) || mime; } catch {}
      return { id: m[1], name, mime };
    });
    text = String(text || '').replace(/\[attachment:[0-9a-f-]{36}\|[^|\]]*\|[^|\]]*\]/g, '').trim();
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
          img.tabIndex = 0;
          img.setAttribute('role', 'button');
          img.setAttribute('aria-label', 'Preview ' + f.name);
          img.addEventListener('click', () => openAttachmentPreview(f.thumb, f.name, false));
          img.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openAttachmentPreview(f.thumb, f.name, false);
            }
          });
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
    if (attachmentRefs.length) {
      const row = document.createElement('div');
      row.className = 'chat-attachments';
      row.setAttribute('aria-label', 'Message attachments');
      for (const ref of attachmentRefs) row.appendChild(attachmentFigure(ref));
      el.appendChild(row);
    }
    let made = { files: [], asks: [] };
    let hasLocationCta = false;
    const raw = text;
    if (role === 'assistant') {
      // Files and questions are written into the reply as blocks; the page shows them as cards.
      // The coding chat settled on a repository for this project: keep it.
      const chosenRepo = codingProject && fresh ? window.NasrinFiles.repoOf(text) : null;
      if (chosenRepo) saved.set(KEYS.coding + ':repo:' + codingProject.id, chosenRepo);
      made = window.NasrinFiles.parse(text);
      text = made.text || (made.files.length ? 'Here is your file.' : '');
      // Image markers can appear after explanatory prose, not only at the start
      // of a reply. Extract every valid marker before formatting text so internal
      // storage IDs are never shown as raw assistant content.
      const pics = [...text.matchAll(/\[image:([0-9a-f-]{36})\]/g)];
      const generatedImageIds = pics.map((pic) => pic[1]);
      if (generatedImageIds.length) {
        text = text.replace(/\s*\[image:[0-9a-f-]{36}\]\s*/g, '\n\n').trim();
        if (!text) text = generatedImageIds.length === 1 ? 'Here is your picture.' : 'Here are your pictures.';
      }
      // Screen recordings from render-and-test, right under the screenshot.
      for (let vid = /^\[video:([0-9a-f-]{36})\]\s*/.exec(text); vid; vid = /^\[video:([0-9a-f-]{36})\]\s*/.exec(text)) {
        el.appendChild(recordingFigure(vid[1]));
        text = text.slice(vid[0].length) || 'Here is the recording.';
      }
      // Pull request chips the server made from GitHub's answer: Diff +/- and
      // merged or not, linking to the pull request.
      const chips = [];
      for (let m = PR_CHIP.exec(text); m; m = PR_CHIP.exec(text)) { chips.push(m); text = text.slice(m[0].length); }
      if (chips.length) el.appendChild(prChips(chips));
      // Web sources fold away under a Sources button beside the reply actions.
      const full = text;
      const cited = window.NasrinFormat.sources(text);
      text = cited.text;
      const body = document.createElement('div');
      body.className = 'msg-body rich';
      const { node, blocks } = window.NasrinFormat.render(text);
      body.appendChild(node);
      // Blocks fade in one after another (headings, paragraphs, lists, code).
      if (animate && !reduced()) blocks.forEach((b, i) => { b.classList.add('reveal'); b.style.setProperty('--d', Math.min(i, 12) * 70 + 'ms'); });
      el.appendChild(body);
      // Show generated images after the reply text, preserving the natural reading order.
      if (generatedImageIds?.length) {
        if (generatedImageIds.length > 10) {
          const grid = document.createElement('div');
          grid.className = 'image-gallery-grid';
          grid.setAttribute('aria-label', 'Generated pictures');
          let shown = 0;
          const pageSize = 8;
          const renderNext = () => {
            for (const imageId of generatedImageIds.slice(shown, shown + pageSize)) {
              grid.appendChild(imageFigure(imageId, regenerate, true));
            }
            shown = Math.min(shown + pageSize, generatedImageIds.length);
            grid.querySelector('.image-gallery-more')?.remove();
            if (shown < generatedImageIds.length) {
              const button = document.createElement('button');
              button.type = 'button';
              button.className = 'image-gallery-more';
              button.textContent = 'Show more';
              button.setAttribute('aria-label', 'Show more generated pictures');
              button.addEventListener('click', renderNext);
              grid.appendChild(button);
            }
          };
          renderNext();
          el.appendChild(grid);
        } else {
          for (const imageId of generatedImageIds) el.appendChild(imageFigure(imageId, regenerate));
        }
      }
      // Consent-based location CTA, rendered inside a location-related assistant reply.
      if (/(?:cannot|can't|unable to|do not|don't)[\\s\\S]{0,140}(?:gps|current|device)?\\s*location|provide (?:your )?(?:current )?(?:location|street|address|landmark)/i.test(full)) {
        hasLocationCta = true;
        const card = document.createElement('div');
        card.className = 'location-cta';
        const copy = document.createElement('p');
        copy.className = 'location-cta-copy';
        copy.textContent = 'Share your current location to get more accurate nearby results and directions.';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'location-cta-button';
        const locationGlyph = document.createElement('span');
        locationGlyph.setAttribute('aria-hidden', 'true');
        locationGlyph.textContent = '⌖';
        const locationLabel = document.createElement('span');
        locationLabel.textContent = 'Use my location';
        button.append(locationGlyph, locationLabel);
        button.setAttribute('aria-label', 'Use my current location to answer location questions');
        const status = document.createElement('p');
        status.className = 'location-cta-status';
        status.setAttribute('role', 'status');
        const manual = document.createElement('form');
        manual.className = 'location-cta-manual';
        const manualInput = document.createElement('input');
        manualInput.type = 'text';
        manualInput.autocomplete = 'street-address';
        manualInput.placeholder = 'City, address, or landmark';
        manualInput.setAttribute('aria-label', 'Enter a city, address, or landmark');
        const manualButton = document.createElement('button');
        manualButton.type = 'submit';
        manualButton.className = 'location-cta-manual-button';
        manualButton.textContent = 'Use this place';
        manual.addEventListener('submit', (event) => {
          event.preventDefault();
          const place = manualInput.value.trim();
          if (!place) {
            manualInput.focus();
            status.textContent = 'Enter a city, address, or landmark to continue.';
            return;
          }
          button.disabled = true;
          manualButton.disabled = true;
          status.textContent = 'Searching for ' + place + '…';
          Promise.resolve(runTurn({
            text: 'Use this location for my previous nearby-place or directions question: ' + place + '. Use live map or web tools when available. If live routing is unavailable, provide a Google Maps route link and clearly say that live travel time could not be verified. Do not invent routes, distances, opening hours, or travel times.',
          })).then(() => {
            status.textContent = 'Location sent with your question. See the reply below for results.';
            button.disabled = false;
            manualButton.disabled = false;
          }).catch(() => {
            status.textContent = 'Could not search this location. Please try again.';
            button.disabled = false;
            manualButton.disabled = false;
          });
        });
        manual.append(manualInput, manualButton);
        button.addEventListener('click', () => {
          if (!navigator.geolocation) {
            status.textContent = 'Location is not supported by this browser. Enter a city, address, or landmark instead.';
            return;
          }
          if (!window.isSecureContext) {
            status.textContent = 'Location access requires a secure HTTPS connection. Enter a city, address, or landmark instead.';
            return;
          }
          button.disabled = true;
          status.textContent = 'Waiting for your location permission…';
          navigator.geolocation.getCurrentPosition((position) => {
            status.textContent = 'Location received. Finding relevant results…';
            runTurn({
              text: 'Use my current location to answer my previous location, nearby-place, or directions question. Use live map or web tools when available; do not invent routes or travel times.',
              locationContext: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null
              }
            }).then(() => { status.textContent = 'Location shared for this request. See the reply below for results.'; })
              .catch(() => { button.disabled = false; status.textContent = 'Could not use that location. Please try again or enter a location manually.'; });
          }, (error) => {
            button.disabled = false;
            status.textContent = error.code === 1
              ? 'Location permission was denied. Allow location in your browser settings, or enter a city, address, or landmark.'
              : error.code === 3
                ? 'Location took too long. Try again, or enter a location manually.'
                : 'We could not determine your location. Check your device settings or enter a location manually.';
          }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
        });
        card.append(copy, button, manual, status);
        el.appendChild(card);
      }
      // Coding chat with GitHub on: more than five files become one card
      // (pull request), never a pile of files in the chat. With automatic pull
      // requests on, a fresh reply's files go straight to a pull request.
      const sources = made.files.length ? window.NasrinFiles.sources(raw) : [];
      const many = sources.length > MANY_FILES && codingProject && github.available;
      if (many) el.appendChild(changesCard(sources, made.text, fresh));
      else {
        for (const f of made.files) el.appendChild(fileCard(f));
        // Shown only in the coding chat with GitHub on (CSS: body.coding-mode.github-on).
        if (sources.length) {
          const b = prButton(sources, made.text);
          el.appendChild(b);
          if (fresh && codingProject && github.autoPr) {
            const status = mk('p', 'pr-card-status');
            status.setAttribute('role', 'status');
            el.appendChild(status);
            autoOpen(sources, made.text, status, b);
          }
        }
      }
      if (!made.files.length && text.length > LONG_REPLY) el.appendChild(saveAsFileCard(text));
      // The location card already has a place field; don't show a duplicate follow-up card.
      const priorUserMessages = log.querySelectorAll('.msg.user');
      const latestUserMessage = priorUserMessages[priorUserMessages.length - 1] || null;
      const latestUserQuery = latestUserMessage ? String(latestUserMessage.dataset.text || latestUserMessage.textContent || '').trim() : '';
      if (asks && made.asks.length && !hasLocationCta && !needsYouTubeVideos(latestUserQuery)) el.appendChild(askCard(made.asks.slice(0, 1)));
      if (cited.links.length) renderWebPreviews(el, cited.links);
      if (cited.links.length) renderSocialEmbeds(el, cited.links);
      if (fresh && role === 'assistant') {
        const userMessages = log.querySelectorAll('.msg.user');
        const lastUser = userMessages[userMessages.length - 1] || null;
        const lastUserQuery = lastUser ? String(lastUser.dataset.text || lastUser.textContent || '').trim() : '';
        // Short affirmative replies may accept the assistant's offer to find videos.
        const videoQuery = youtubeQueryForReply(lastUserQuery, text);
        // A cited direct video URL is sufficient to render its player even when
        // the person asked a factual question rather than explicitly requesting videos.
        const hasCitedYouTube = Array.isArray(cited.links) && cited.links.some((source) => {
          try {
            const url = new URL(typeof source === 'string' ? source : source?.url || source?.href || '');
            if (url.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(url.hostname.toLowerCase())) return false;
            const id = url.hostname.toLowerCase() === 'youtu.be' ? url.pathname.split('/').filter(Boolean)[0] : (url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] || '');
            return /^[A-Za-z0-9_-]{11}$/.test(String(id || ''));
          } catch { return false; }
        });
        if (videoQuery) renderYouTubeVideos(el, videoQuery, cited.links);
        else if (hasCitedYouTube) renderYouTubeVideos(el, '', cited.links, true);
      }
      const actions = replyActions(text, id, full, responseMetadata);
      el.appendChild(actions);
      sourcesToggle(actions, cited.links);
      const disclaimer = document.createElement('p');
      disclaimer.className = 'reply-disclaimer';
      disclaimer.setAttribute('role', 'note');
      disclaimer.textContent = 'NasrinAI is AI and can make mistakes.';
      el.appendChild(disclaimer);
    } else if (text) {
      el.appendChild(document.createTextNode(text));
    }
    if (id) el.dataset.id = id;
    if (role === 'user') el.dataset.text = text;
    if (role === 'assistant' && animate) el.classList.add('is-new');
    log.appendChild(el);
    scrollToEnd(el, { force: role === 'user' });
    return el;
  }

  // The reply appears word by word, quickly: the whole text in under a second.
  // Words are text nodes inside spans (never HTML); a screen reader gets it all at once.


  // The "thinking" line sets expectations: a first guess from the message,
  // what the server says it is doing (`status` in the chat stream), and, as
  // time passes, "Putting it together" then "Almost done".
  const STAGE_TEXT = {
    files: 'Reading your file', links: 'Reading the link', library: 'Checking your Library',
    memory: 'Remembering', web: 'Browsing the internet'
  };
  function guessThinking(text) {
    const t = String(text || '').toLowerCase();
    if (/https?:\/\//.test(t)) return 'Reading the link';
    if (/\b(latest|today|news|current|this week|right now|price of|weather|score)\b/.test(t)) return 'Browsing the internet';
    if (/\b(remember|last time|we talked|earlier chat|you said)\b/.test(t)) return 'Remembering';
    if (/\b(recipe|cook|bake|dish|meal)\b/.test(t)) return 'Cooking up an answer';
    if (/\b(code|function|bug|error|script|javascript|python|sql)\b/.test(t)) return 'Writing code';
    if (/\b(write|draft|letter|email|essay|story|poem|caption)\b/.test(t)) return 'Writing';
    if (/\b(plan|itinerary|schedule|steps)\b/.test(t)) return 'Making your plan';
    if (/\b(calculate|compute|how much|how many|convert)\b/.test(t)) return 'Working it out';
    return 'Thinking';
  }
  // The thinking sign: a sphere of dots that turns a full circle around its
  // upright axis, like a globe, expanding evenly in every direction (it stays
  // a sphere) and shrinking back on the way.
  // Dots nearer the front are larger and brighter. Drawn frame by frame; with
  // reduced motion it stays still (app.css .dots pulses softly instead).
  // Two later steps have their own sign (stage()), in every chat:
  // 'gather' ("Putting it together"): scattered dots fly in from all around and
  //   assemble into the sphere, again and again;
  // 'beep' ("Almost done"): the sphere holds still-ish while its dots beep,
  //   flashes rippling out from the middle twice a cycle, like a heartbeat.
  function dotSphere(box) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('dots');
    const n = 64, tilt = 0.35, R = 10.5, TAU = Math.PI * 2;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    // beep / gather: 0 … 1, eased toward their goals so changes blend smoothly.
    let cycle = 2400, beep = 0, goal = 0, gather = 0, goalG = 0;
    const dots = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.39996;
      const c = document.createElementNS(NS, 'circle');
      svg.appendChild(c);
      dots.push({ c, x: Math.cos(a) * r, y, z: Math.sin(a) * r,
        // gather: where the dot starts, and how late it sets off
        from: i * 4.08 + 1, far: 1.9 + 0.8 * ((i * 29) % 13) / 13, late: ((i * 53) % 17) / 17 * 0.35 });
    }
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const draw = (t) => {
      // Sphere: a full turn at a steady speed, and a burst that peaks near the middle.
      const turn = t * TAU;   // steady: it keeps turning while it grows and shrinks
      const burst = (1 - beep) * (1 - gather) * Math.sin(Math.PI * Math.min(Math.max((t - 0.12) / 0.66, 0), 1)) ** 2;
      // One unified mark: the particle sphere expands as the face recedes,
      // then contracts and reveals the face again. Keep the burst inside the art bounds.
      box.style.setProperty('--sphere-burst', burst.toFixed(3));
      const ca = Math.cos(turn), sa = Math.sin(turn);
      // Beep: a ring of light runs out from the middle, twice a cycle.
      const wave = (t * 2) % 1;
      for (const d of dots) {
        const sx = d.x * ca + d.z * sa, z1 = -d.x * sa + d.z * ca;
        const sy = d.y * ct - z1 * st, sz = d.y * st + z1 * ct;
        let x = sx, y = sy, z = sz;
        // Gather: fly in from far away to the dot's place on the sphere, hold,
        // then fade and start again.
        const p = ease(Math.min(Math.max((t - d.late) / 0.45, 0), 1));
        const fx = Math.cos(d.from) * d.far, fy = Math.sin(d.from) * d.far;
        const shown = Math.min(Math.max((t - d.late) / 0.08, 0), 1) * (t > 0.9 ? 1 - (t - 0.9) / 0.1 : 1);
        x += (fx + (sx - fx) * p - x) * gather; y += (fy + (sy - fy) * p - y) * gather; z += (sz * p - z) * gather;
        const k = R * (1 + burst * 0.75), depth = (z + 1) / 2;   // every dot moves out alike
        const flash = Math.exp(-(((Math.hypot(sx, sy) - wave * 1.2) * 5) ** 2));
        const glow = (1 + (0.3 + 0.9 * flash - 1) * beep) * (1 + (shown - 1) * gather);
        d.c.setAttribute('cx', (20 + x * k).toFixed(2));
        d.c.setAttribute('cy', (20 + y * k).toFixed(2));
        d.c.setAttribute('r', ((0.55 + 0.75 * depth) * (1 - 0.35 * burst) * (1 + 0.8 * flash * beep)).toFixed(2));
        d.c.setAttribute('fill-opacity', ((0.3 + 0.7 * depth) * (1 - 0.3 * burst) * glow).toFixed(2));
      }
    };
    draw(0);
    let frame = 0, phase = 0, before = 0;
    const still = reduced();
    if (!still) {
      const tick = (now) => {
        const dt = before ? now - before : 0;
        phase = (phase + dt / cycle) % 1;   // smooth when the speed changes
        beep += (goal - beep) * Math.min(1, dt / 250);
        gather += (goalG - gather) * Math.min(1, dt / 250);
        before = now;
        draw(phase);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }
    box.classList.add('dot-sphere');
    box.appendChild(svg);
    return {
      stage(name) {
        goal = name === 'beep' ? 1 : 0;
        goalG = name === 'gather' ? 1 : 0;
        cycle = name === 'beep' ? 1600 : name === 'gather' ? 2200 : 2400;
        if (still) { beep = 0; gather = 0; draw(0); }   // still: just the sphere
      },
      remove() { cancelAnimationFrame(frame); svg.remove(); }
    };
  }

  function showThinking(text = 'Thinking', { timed = true } = {}) {
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
    // The dotted sphere, in the normal chat and the coding chat alike.
    const ch = dotSphere(mini);
    scrollToEnd(row);
    const set = (words) => {
      if (!words || label.textContent === words) return;
      label.textContent = words;
      // Every chat: "Putting it together" gathers the dots, "Almost done" makes them beep.
      ch.stage(/^Almost done/.test(words) ? 'beep' : /^Putting it together/.test(words) ? 'gather' : null);
      label.classList.remove('is-new');
      void label.offsetWidth;   // restart the fade
      label.classList.add('is-new');
    };
    const timers = timed ? [
      setTimeout(() => set('Putting it together'), 7000),
      setTimeout(() => set('Almost done'), 16000)
    ] : [];
    return {
      set,
      stage(name) { if (STAGE_TEXT[name]) set(STAGE_TEXT[name]); },
      remove() { timers.forEach(clearTimeout); ch.remove(); row.remove(); }
    };
  }

  // While a picture, video or file is being made: a pixel grid that lights up
  // in waves under a moving scan line, with what is happening and the time so
  // far. Built from elements (no HTML strings); still when motion is reduced.
  function genLoader(text, { compact = false, timer = true } = {}) {
    const box = document.createElement('div');
    box.className = 'gen-loader' + (compact ? ' is-compact' : '');
    box.setAttribute('role', 'status');
    const screen = document.createElement('div');
    screen.className = 'gen-screen';
    screen.setAttribute('aria-hidden', 'true');
    const cols = compact ? 24 : 16, rows = compact ? 3 : 16;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement('span');
        cell.className = 'gen-cell';
        // A diagonal wave, with a few cells out of step so it looks alive.
        cell.style.setProperty('--d', ((r + c) * 70 + ((r * 7 + c * 13) % 5 === 0 ? 400 : 0)) + 'ms');
        screen.appendChild(cell);
      }
    }
    const scan = document.createElement('span');
    scan.className = 'gen-scan';
    screen.appendChild(scan);
    const label = document.createElement('p');
    label.className = 'gen-label';
    const words = document.createElement('span');
    words.textContent = text;
    const time = document.createElement('span');
    time.className = 'gen-time';
    label.append(words, time);
    box.append(screen, label);
    const started = Date.now();
    const tick = timer ? setInterval(() => { time.textContent = Math.round((Date.now() - started) / 1000) + 's'; }, 1000) : null;
    return {
      el: box,
      set(t) { if (t && words.textContent !== t) words.textContent = t; },
      remove() { if (tick) clearInterval(tick); box.remove(); }
    };
  }

  function clearScreen() {
    // Keep the most recently surfaced tutorial available when starting a new
    // conversation. The persistent player owns a separate iframe/card, so the
    // old message can be cleared without stopping the user's video.
    try {
      const state = JSON.parse(localStorage.getItem(PERSISTENT_YOUTUBE_KEY) || 'null');
      if (state && /^[A-Za-z0-9_-]{11}$/.test(String(state.id || ''))) {
        const existing = document.querySelector('#persistent-youtube-player .youtube-video-card');
        if (!existing) mountPersistentYouTubePlayer(state);
      }
    } catch {}
    // Leaving this chat: a reply still being written is stopped, an edit dropped.
    if (turn) turn.ctrl.abort();
    if (editing) cancelEdit();
    for (const el of [...log.children]) if (el !== welcome && el !== codingEmptyState) el.remove();
    welcome.hidden = false;
    document.body.classList.remove('has-chat');
  }

  function refreshSendButton() {
    // While a reply is being written the button is Stop. While you dictate it
    // stops listening (it never sends then), so it shows Stop too, even once
    // words have arrived; after that it sends.
    const stopping = Boolean(turn);
    sendBtn.classList.toggle('is-stop', stopping);
    sendBtn.classList.toggle('is-listening', listening && !stopping);
    const hasText = Boolean(input.value.trim() || pending.length);
    sendBtn.classList.toggle('has-text', hasText || stopping);
    sendBtn.title = stopping ? 'Stop' : listening ? 'Stop listening' : hasText ? 'Send' : 'Dictate';
    sendBtn.setAttribute('aria-label', stopping ? 'Stop the reply' : listening ? 'Stop listening' : hasText ? 'Send message' : 'Dictate message');
    // Keep Send actionable for typed messages; send() reports availability errors in-chat.
    sendBtn.disabled = !stopping && (busy || preparing > 0 || (!hasText && !Recognition));
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 176) + 'px';
    refreshSendButton();
  }

  // Video Studio handoff: the Studio sends a compact project brief in the URL
  // fragment (never to the server). Remove it immediately, validate the shape,
  // and prefill the composer without sending anything until the user chooses.
  {
    const hash = location.hash;
    const prefix = '#studio_context=';
    if (hash.startsWith(prefix) && hash.length <= 12000) {
      history.replaceState(null, '', location.pathname + location.search);
      try {
        const brief = JSON.parse(decodeURIComponent(hash.slice(prefix.length)));
        if (brief && brief.source === 'NasrinAI Video Studio' && typeof brief.name === 'string') {
          const clips = Array.isArray(brief.clips) ? brief.clips.slice(0, 30) : [];
          const generated = Array.isArray(brief.generated) ? brief.generated.slice(0, 20) : [];
          const lines = [
            'Continue helping me with this NasrinAI Video Studio project.',
            'Project: ' + brief.name.slice(0, 80),
            'Template: ' + String(brief.template || 'custom').slice(0, 40),
            'Aspect ratio: ' + String(brief.aspect || 'not specified').slice(0, 10),
            'Current generation prompt: ' + String(brief.prompt || '(none)').slice(0, 1800),
            'Timeline clips:',
            ...(clips.length ? clips.map((clip, i) => (i + 1) + '. ' + String(clip.name || 'Untitled clip').slice(0, 100) + ' [' + String(clip.kind || 'clip').slice(0, 20) + ', ' + (Number(clip.duration) || 0) + ' sec]' + (clip.title ? ', title: ' + String(clip.title).slice(0, 140) : '') + (clip.video_id ? ', video job ID: ' + String(clip.video_id).slice(0, 100) : '')) : ['(empty timeline)']),
            ...(generated.length ? ['Generated scenes:', ...generated.map(item => '- ' + String(item.name || 'Generated scene').slice(0, 100) + (item.video_id ? ' (video job ID: ' + String(item.video_id).slice(0, 100) + ')' : ''))] : []),
            'Note: ' + String(brief.note || 'Media files are not attached.').slice(0, 300),
            'Please help me continue from this project brief. Do not claim to modify or export the Studio project unless the relevant tools are available.'
          ];
          input.value = lines.join('\n').slice(0, 6000);
          autosize();
          notice.textContent = 'Video Studio project brief loaded. Review it and send when you are ready.';
        }
      } catch {
        notice.textContent = 'The Video Studio project brief could not be loaded. Please return to Studio and try again.';
      }
    }
  }

  // ---------- photos and files ----------

  // Files wait in the tray until sent: { name, type, bytes, thumb?, and either
  // data (base64, sent inside the request) or upload (id of a direct upload)}.
  const MAX_FILES = 4;
  const MAX_INLINE = 3 * 1024 * 1024;   // what fits inside one request on Vercel
  // Direct uploads (docs/uploads.md), when /v1/status offers them: files other
  // than photos go straight to storage, so they can be larger.
  let directUploads = null;           // { maxBytes } or null
  const maxTotal = () => (directUploads ? directUploads.maxBytes : MAX_INLINE);
  const MAX_SIDE = 1600;              // photos are shrunk to this before upload
  let pending = [];
  let preparing = 0;

  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(blob);
  });

  // Raster photos are normalized to JPEG before upload. This reduces bandwidth
  // and strips EXIF metadata such as GPS coordinates and camera details.
  // Some browsers cannot decode every image type with createImageBitmap, so
  // fall back to the browser's image decoder before asking the person to convert it.
  const PHOTO_EXTENSIONS = /\.(?:jpe?g|png|webp|gif|bmp|tiff?|heic|heif|avif|jxl)$/i;
  const isPhotoFile = (file) => /^image\//i.test(file.type || '') || PHOTO_EXTENSIONS.test(file.name || '');

  async function loadPhoto(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(file);
        return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
      } catch { /* try the browser's HTML image decoder below */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => img.naturalWidth && img.naturalHeight ? resolve(img) : reject(new Error('empty image'));
        img.onerror = () => reject(new Error('decode failed'));
        img.src = url;
      });
      return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
  }

  async function shrinkPhoto(file) {
    const source = await loadPhoto(file);
    try {
      const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source.width * scale));
      canvas.height = Math.max(1, Math.round(source.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas unavailable');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source.image, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.85));
    } finally {
      source.close?.();
    }
  }

  // Decode audio into bounded, valid PCM WAV chunks. Check duration before
  // AudioContext decoding because compressed media can expand dramatically in RAM.
  async function transcribeAudioChunks(file, language, token) {
    const MAX_SOURCE_BYTES = 100 * 1024 * 1024;
    const MAX_DURATION_SECONDS = 5 * 60;
    const SAMPLE_RATE = 16000;
    const CHUNK_SECONDS = 120;
    if (file.size > MAX_SOURCE_BYTES) throw new Error('This recording is over 100 MB. Please split it into smaller files before transcription.');
    const objectUrl = URL.createObjectURL(file);
    let duration;
    try {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.src = objectUrl;
      duration = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Audio duration could not be checked safely. Try a shorter WAV, MP3 or M4A file.')), 15000);
        const cleanup = () => { clearTimeout(timeout); audio.removeAttribute('src'); audio.load(); };
        audio.onloadedmetadata = () => {
          const value = audio.duration; cleanup();
          if (!Number.isFinite(value) || value <= 0) reject(new Error('This recording has no readable duration.'));
          else resolve(value);
        };
        audio.onerror = () => { cleanup(); reject(new Error('This audio format cannot be checked by this browser. Try WAV, MP3 or M4A.')); };
      });
      if (duration > MAX_DURATION_SECONDS) throw new Error('For safe mobile processing, transcribe recordings up to five minutes at a time. Split this recording into shorter clips and retry.');
    } finally { URL.revokeObjectURL(objectUrl); }

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('Audio conversion is not supported by this browser.');
    const context = new AudioContextCtor();
    let decoded;
    try { decoded = await context.decodeAudioData(await file.arrayBuffer()); }
    catch { throw new Error('This audio format cannot be decoded by this browser. Try WAV, MP3 or M4A.'); }
    finally { await context.close().catch(() => {}); }
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > MAX_DURATION_SECONDS) {
      throw new Error('For safe mobile processing, transcribe recordings up to five minutes at a time.');
    }
    const channels = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
    const ratio = decoded.sampleRate / SAMPLE_RATE;
    const mono = new Float32Array(Math.ceil(decoded.length / ratio));
    for (let i = 0; i < mono.length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(decoded.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0, count = 0;
      for (let j = start; j < end; j++) {
        let sample = 0;
        for (const channel of channels) sample += channel[j] || 0;
        sum += sample / channels.length; count++;
      }
      if (count) mono[i] = sum / count;
    }
    const samplesPerChunk = SAMPLE_RATE * CHUNK_SECONDS;
    const transcripts = [];
    for (let chunk = 0; chunk < Math.ceil(mono.length / samplesPerChunk); chunk++) {
      const start = chunk * samplesPerChunk;
      const count = Math.min(samplesPerChunk, mono.length - start);
      const wav = new ArrayBuffer(44 + count * 2);
      const view = new DataView(wav);
      const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
      write(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); write(8, 'WAVE');
      write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true);
      view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      write(36, 'data'); view.setUint32(40, count * 2, true);
      for (let i = 0; i < count; i++) {
        const sample = Math.max(-1, Math.min(1, mono[start + i]));
        view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
      }
      const suffix = '-part-' + String(chunk + 1).padStart(3, '0') + '.wav';
      const response = await net('/v1/transcriptions?name=' + encodeURIComponent((file.name.replace(/\\.[^.]+$/, '') || 'recording') + suffix) + (language ? '&language=' + encodeURIComponent(language) : ''), {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'audio/wav' },
        body: new Blob([wav], { type: 'audio/wav' })
      });
      if (!response.ok) throw await errorFrom(response);
      const result = await response.json();
      if (!result || typeof result.text !== 'string') throw new Error('The transcription service returned an invalid result.');
      transcripts.push(result.text.trim());
    }
    return transcripts.filter(Boolean).join('\n\n');
  }

  // Register seek handlers before changing currentTime so fast decoders cannot
  // fire seeked between the assignment and listener registration.
  async function seekVideoTo(video, time, timeoutMs = 10000) {
    await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener('seeked', onSeeked);
        video.removeEventListener('error', onError);
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error); else resolve();
      };
      const onSeeked = () => finish();
      const onError = () => finish(new Error('Could not seek to a video frame.'));
      const timeout = setTimeout(() => finish(new Error('Seeking to a video frame timed out. Try a shorter video or another format.')), timeoutMs);
      video.addEventListener('seeked', onSeeked);
      video.addEventListener('error', onError);
      try { video.currentTime = time; } catch (error) { finish(error); }
    });
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
        const crop = document.createElement('button');
        crop.type = 'button';
        crop.className = 'chip-crop';
        crop.textContent = 'Crop';
        crop.setAttribute('aria-label', 'Crop ' + f.name);
        crop.addEventListener('click', async () => {
          if (!window.NasrinImageCrop?.cropImage) {
            notice.textContent = 'Image cropping is unavailable. Reload the page and try again.';
            return;
          }
          crop.disabled = true;
          try {
            const blob = await window.NasrinImageCrop.cropImage({ src: f.thumb, name: f.name });
            if (!blob) { crop.disabled = false; return; }
            // Keep cropped attachments comfortably below request-body limits.
            // Prefer lossless PNG, but fall back to JPEG when a screenshot crop is large.
            let croppedBlob = blob;
            if (croppedBlob.size > 3 * 1024 * 1024) {
              const imageUrl = URL.createObjectURL(croppedBlob);
              try {
                const image = new Image();
                image.src = imageUrl;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth;
                canvas.height = image.naturalHeight;
                const context = canvas.getContext('2d');
                if (!context) throw new Error('Canvas is unavailable');
                context.drawImage(image, 0, 0);
                croppedBlob = await new Promise((resolve, reject) => canvas.toBlob(
                  (value) => value ? resolve(value) : reject(new Error('Could not compress crop')),
                  'image/jpeg', 0.84
                ));
              } finally { URL.revokeObjectURL(imageUrl); }
            }
            if (croppedBlob.size > 4 * 1024 * 1024) {
              notice.textContent = 'That crop is too large to send. Select a smaller area and try again.';
              crop.disabled = false;
              return;
            }
            const oldThumb = f.thumb;
            f.name = f.name.replace(/\.[^.]+$/, '') + (croppedBlob.type === 'image/jpeg' ? '-crop.jpg' : '-crop.png');
            f.type = croppedBlob.type || 'image/png';
            f.bytes = croppedBlob.size;
            f.data = await toBase64(croppedBlob);
            f.upload = undefined;
            f.local = undefined;
            f.thumb = URL.createObjectURL(croppedBlob);
            URL.revokeObjectURL(oldThumb);
            notice.textContent = 'Cropped image added to your message.';
            renderTray();
          } catch {
            notice.textContent = 'Could not prepare the cropped image. Please try again.';
            crop.disabled = false;
          }
        });
        chip.appendChild(crop);
      } else {
        const icon = document.createElement('span');
        icon.className = 'doc-icon';
        icon.textContent = (f.name.split('.').pop() || 'file').slice(0, 4).toUpperCase();
        const name = document.createElement('span');
        name.className = 'doc-name';
        name.textContent = f.name;
        chip.append(icon, name);
      }
      if ((/^audio\//i.test(f.type || '') || /\.(?:mp3|mpga|m4a|mp4|mpeg|mpg|mp2|wav|webm|ogg|oga|flac)$/i.test(f.name)) && f.local instanceof File) {
        const language = document.createElement('select');
        language.className = 'chip-transcribe-language';
        language.setAttribute('aria-label', 'Transcription language');
        for (const [value, label] of [['', 'Auto language'], ['en', 'English'], ['tl', 'Filipino'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ja', 'Japanese'], ['zh', 'Chinese']]) {
          const option = document.createElement('option'); option.value = value; option.textContent = label; language.appendChild(option);
        }
        const transcribe = document.createElement('button');
        transcribe.type = 'button';
        transcribe.className = 'chip-transcribe';
        transcribe.textContent = 'Transcribe';
        transcribe.title = 'Converts supported audio into ordered 2-minute chunks. For safe mobile processing, recordings are limited to five minutes.';
        transcribe.setAttribute('aria-label', 'Transcribe ' + f.name);
        transcribe.addEventListener('click', async () => {
          if (transcribe.disabled) return;
          transcribe.disabled = true;
          language.disabled = true;
          transcribe.textContent = 'Preparing audio…';
          try {
            const token = await credential();
            const transcript = await transcribeAudioChunks(f.local, language.value, token);
            if (!transcript) throw new Error('No speech was detected in this audio.');
            const existing = input.value.trim();
            input.value = existing ? existing + '\n\n' + transcript : transcript;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
            notice.textContent = 'Transcript added to your message. Review it before sending.';
            transcribe.textContent = 'Transcribed';
            language.disabled = true;
          } catch (err) {
            notice.textContent = err.message || 'Could not transcribe this audio. Please try again.';
            transcribe.disabled = false;
            transcribe.textContent = 'Retry transcription';
            language.disabled = false;
          }
        });
        chip.append(language, transcribe);
      }
      if (/\.pdf$/i.test(f.name) && f.local instanceof File) {
        const ocr = document.createElement('button');
        ocr.type = 'button';
        ocr.className = 'chip-transcribe';
        ocr.textContent = f.bytes > 6 * 1024 * 1024 ? 'Too large' : 'Extract text';
        ocr.disabled = f.bytes > 6 * 1024 * 1024;
        ocr.setAttribute('aria-label', 'Extract text from ' + f.name);
        ocr.addEventListener('click', async () => {
          if (ocr.disabled) return;
          ocr.disabled = true;
          ocr.textContent = 'Reading PDF…';
          try {
            const token = await credential();
            const response = await net('/v1/pdf-ocr?name=' + encodeURIComponent(f.name), {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/pdf' },
              body: f.local
            });
            if (!response.ok) throw await errorFrom(response);
            const result = await response.json();
            if (!result || typeof result.text !== 'string' || !result.text.trim()) throw new Error('No readable text was found in this PDF.');
            const existing = input.value.trim();
            input.value = existing ? existing + '\n\n' + result.text.trim() : result.text.trim();
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
            notice.textContent = 'Extracted PDF text added to your message. Review it before sending.';
            ocr.textContent = 'Text extracted';
          } catch (err) {
            notice.textContent = err.message || 'Could not extract text from this PDF. Please try again.';
            ocr.disabled = false;
            ocr.textContent = 'Retry extraction';
          }
        });
        chip.appendChild(ocr);
      }
      if ((/^video\//i.test(f.type || '') || /\.(?:mp4|mov|webm|m4v|mpeg|mpg|ogv)$/i.test(f.name)) && f.local instanceof File) {
        const frames = document.createElement('button');
        frames.type = 'button';
        frames.className = 'chip-transcribe';
        frames.textContent = 'Extract frames';
        frames.setAttribute('aria-label', 'Extract frames from ' + f.name);
        frames.addEventListener('click', async () => {
          frames.disabled = true;
          frames.textContent = 'Extracting…';
          let objectUrl = '';
          try {
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            objectUrl = URL.createObjectURL(f.local);
            video.src = objectUrl;
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(new Error('Video metadata took too long to load. Try a shorter video or another format.')), 15000);
              video.onloadedmetadata = () => { clearTimeout(timeout); resolve(); };
              video.onerror = () => { clearTimeout(timeout); reject(new Error('This video format could not be opened on this device.')); };
            });
            if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('The video has no readable duration.');
            const duration = video.duration;
            if (duration > 15 * 60) throw new Error('This video is longer than 15 minutes. Choose a shorter clip to extract frames safely.');
            // Short clips get three representative frames. For longer clips, inspect
            // low-resolution candidates and prefer timestamps with the largest visual
            // changes, while enforcing temporal spacing and a hard eight-frame cap.
            // This is a lightweight scene-change heuristic, not semantic recognition.
            const frameCount = duration < 6 ? 3 : 8;
            const times = duration < 6
              ? [...new Set([Math.min(0.05, duration / 4), duration * 0.5, Math.max(0, duration - Math.min(0.15, duration / 4))])]
              : await (async () => {
                  const candidateCount = 24;
                  const candidates = [];
                  let previousPixels = null;
                  const probe = document.createElement('canvas');
                  probe.width = 32;
                  probe.height = 18;
                  const probeContext = probe.getContext('2d', { willReadFrequently: true });
                  if (!probeContext) throw new Error('Frame analysis is not supported by this device.');
                  for (let i = 0; i < candidateCount; i++) {
                    const time = duration * (i + 0.5) / candidateCount;
                    await seekVideoTo(video, time);
                    probeContext.drawImage(video, 0, 0, probe.width, probe.height);
                    const pixels = probeContext.getImageData(0, 0, probe.width, probe.height).data;
                    let score = 0;
                    if (previousPixels) {
                      for (let p = 0; p < pixels.length; p += 4) {
                        score += Math.abs(pixels[p] - previousPixels[p]) +
                          Math.abs(pixels[p + 1] - previousPixels[p + 1]) +
                          Math.abs(pixels[p + 2] - previousPixels[p + 2]);
                      }
                      score /= (pixels.length / 4) * 3 * 255;
                    }
                    candidates.push({ time, score });
                    previousPixels = new Uint8ClampedArray(pixels);
                  }
                  const selected = [candidates[0], candidates[7], candidates[15], candidates[23]];
                  const minGap = duration / 16;
                  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
                    if (selected.length >= frameCount) break;
                    if (selected.every((item) => Math.abs(item.time - candidate.time) >= minGap)) selected.push(candidate);
                  }
                  return selected.sort((a, b) => a.time - b.time).slice(0, frameCount).map((item) => item.time);
                })();
            const extracted = [];
            for (let index = 0; index < times.length; index++) {
              if (pending.length + extracted.length >= MAX_FILES) break;
              await seekVideoTo(video, times[index]);
              const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
              canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
              const ctx = canvas.getContext('2d');
              if (!ctx) throw new Error('Frame extraction is not supported by this device.');
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Could not encode a video frame.')), 'image/jpeg', 0.84));
              const stamp = Math.round(times[index] * 1000);
              extracted.push(new File([blob], f.name.replace(/\.[^.]+$/, '') + '-frame-' + (index + 1) + '-' + stamp + 'ms.jpg', { type: 'image/jpeg' }));
            }
            if (!extracted.length) throw new Error('There is no room for more frames. Remove a file and try again.');
            await addFiles(extracted);
            notice.textContent = 'Extracted ' + extracted.length + ' frame(s). Review the image attachments before sending.';
            frames.textContent = 'Frames extracted';
          } catch (err) {
            notice.textContent = err.message || 'Could not extract video frames. Please try again.';
            frames.disabled = false;
            frames.textContent = 'Retry frames';
          } finally {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
          }
        });
        chip.appendChild(frames);
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

  const tooBig = () => `Files can be up to ${Math.round(maxTotal() / 1048576)} MB in total.`;

  // A direct upload: a one-time link from the server, then the file goes
  // straight to storage. Answers the upload id the message names.
  async function uploadFile(file) {
    const link = await api('/v1/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, type: file.type || '', size: file.size })
    });
    if (!link || typeof link.id !== 'string' || typeof link.upload_url !== 'string' || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/upload\/sign\//.test(link.upload_url)) {
      throw new Error(`"${file.name}" could not be uploaded. Please try again.`);
    }
    let resp;
    try {
      resp = await fetch(link.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    } catch { resp = null; }
    if (!resp || !resp.ok) throw new Error(`"${file.name}" could not be uploaded. Please try again.`);
    return link.id;
  }

  async function addFiles(list) {
    notice.textContent = '';
    for (const file of list) {
      if (pending.length >= MAX_FILES) { notice.textContent = `You can send up to ${MAX_FILES} files at a time.`; break; }
      preparing += 1;
      refreshSendButton();
      try {
        let item;
        if (isPhotoFile(file) && file.type !== 'image/svg+xml') {
          let blob;
          try { blob = await shrinkPhoto(file); } catch { throw new Error(`"${file.name}" could not be decoded by this device. Try exporting the picture as JPEG or PNG.`); }
          item = { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', type: 'image/jpeg', bytes: blob.size, data: await toBase64(blob), thumb: URL.createObjectURL(blob) };
        } else if (directUploads) {
          // Checked before uploading, so nothing too big is sent.
          if (pending.reduce((n, f) => n + f.bytes, 0) + file.size > maxTotal()) throw new Error(tooBig());
          item = { name: file.name, type: file.type, bytes: file.size, upload: await uploadFile(file), local: file };
        } else {
          item = { name: file.name, type: file.type, bytes: file.size, data: await toBase64(file), local: file };
        }
        const total = pending.reduce((n, f) => n + f.bytes, 0) + item.bytes;
        const inline = pending.reduce((n, f) => n + (f.data ? f.bytes : 0), 0) + (item.data ? item.bytes : 0);
        if (total > maxTotal() || inline > MAX_INLINE) {
          if (item.thumb) URL.revokeObjectURL(item.thumb);
          throw new Error(tooBig());
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
  // One paste of up to 2,000 characters stays editable text; 2,001 or more is
  // attached as a UTF-8 .txt file (public/paste.js). Only the pasted text is
  // counted, never what is already typed, and images/files are handled above.
  input.addEventListener('paste', (e) => {
    const clipboard = e.clipboardData;
    const files = clipboard ? [...clipboard.files] : [];
    if (files.length) { e.preventDefault(); addFiles(files); return; }

    const text = clipboard ? clipboard.getData('text/plain') : '';
    if (!text || !NasrinPaste.shouldAttach(text)) return;
    if (pending.length >= MAX_FILES) { notice.textContent = `You can send up to ${MAX_FILES} files at a time. The long paste was kept as text.`; return; }
    e.preventDefault();
    const name = NasrinPaste.fileName(pending.map((f) => f.name));
    const file = new File([text], name, { type: 'text/plain' });
    const before = pending.length;
    addFiles([file]).then(() => {
      if (pending.length > before) {
        notice.textContent = `Long paste attached as ${name} (${NasrinPaste.count(text).toLocaleString('en-US')} characters).`;
      } else {
        // Nothing is lost: the text goes into the box so it can be sent as text.
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        input.setRangeText(text, start, end, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        notice.textContent = (notice.textContent ? notice.textContent + ' ' : '') + 'The pasted text was kept in the message box instead.';
      }
    });
  });

  // ---------- the + menu: files, or creating a picture ----------

  const plusMenu = $('plusMenu');
  const modeChip = $('modeChip');
  let imagesOn = false;
  let libraryOn = saved.get(KEYS.libraryOn) === true;   // the server offers the Library; last answer kept so the label does not change after load
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
  // A browser recording (owner-checked GET /v1/recordings/:id), played inline.
  const PR_CHIP = /^\[(?:pr:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d{1,9}) (open|closed|merged|draft) \+(\d{1,9}) -(\d{1,9})|prs:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) (\d{1,3}))\][ \t]*(?:\r?\n|$)/;
  const PR_STATE = { open: 'Open', closed: 'Closed', merged: 'Merged', draft: 'Draft' };
  function prIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of [['circle', { cx: 6, cy: 6, r: 2.2 }], ['circle', { cx: 6, cy: 18, r: 2.2 }], ['circle', { cx: 18, cy: 18, r: 2.2 }],
      ['path', { d: 'M6 8.2v7.6' }], ['path', { d: 'M18 15.8V9a3 3 0 0 0-3-3h-4' }], ['path', { d: 'm13 3.5-2.5 2.5L13 8.5' }]]) {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      svg.appendChild(n);
    }
    return svg;
  }
  function prChips(list) {
    const row = document.createElement('div');
    row.className = 'pr-chips';
    const chip = (href, label) => {
      const a = document.createElement('a');
      a.className = 'pr-chip';
      a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', label);
      return a;
    };
    const span = (cls, text) => { const n = document.createElement('span'); n.className = cls; n.textContent = text; return n; };
    for (const m of list) {
      if (m[1]) {
        const url = 'https://github.com/' + m[1] + '/pull/' + m[2];
        const diff = chip(url + '/files', 'Diff: ' + m[4] + ' lines added, ' + m[5] + ' removed');
        diff.append(span('pr-chip-name', 'Diff'), span('pr-add', '+' + Number(m[4]).toLocaleString()));
        if (Number(m[5])) diff.appendChild(span('pr-del', '\u2212' + Number(m[5]).toLocaleString()));
        const pr = chip(url, 'Pull request #' + m[2] + ': ' + PR_STATE[m[3]]);
        pr.classList.add('is-' + m[3]);
        pr.append(prIcon(), span('pr-chip-name', '#' + m[2]), span('pr-chip-dot', '\u00b7'), span('pr-state', PR_STATE[m[3]]));
        row.append(diff, pr);
      } else {
        const all = chip('https://github.com/' + m[6] + '/pulls', m[7] + ' pull requests');
        all.append(prIcon(), span('pr-chip-name', 'Pull requests'), span('pr-chip-dot', '\u00b7'), span('pr-count', m[7]));
        row.appendChild(all);
      }
    }
    return row;
  }

  function recordingFigure(videoId) {
    const fig = document.createElement('figure');
    fig.className = 'made-image made-video is-loading';
    const video = document.createElement('video');
    video.controls = true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-label', 'Screen recording of the app');
    const bar = document.createElement('figcaption');
    const dl = document.createElement('a');
    dl.className = 'btn outline small';
    dl.textContent = 'Download';
    dl.hidden = true;
    bar.appendChild(dl);
    fig.append(video, bar);
    (async () => {
      try {
        const token = await credential(false);
        const resp = await fetch('/v1/recordings/' + encodeURIComponent(videoId), { headers: { Authorization: 'Bearer ' + token } });
        if (!resp.ok) throw new Error('gone');
        const type = resp.headers.get('content-type') === 'video/mp4' ? 'mp4' : 'webm';
        const url = URL.createObjectURL(await resp.blob());
        dl.href = url;
        dl.setAttribute('download', `nasrin-recording-${videoId.slice(0, 8)}.${type}`);
        dl.hidden = false;
        video.addEventListener('loadeddata', () => { fig.classList.remove('is-loading'); fig.classList.add('is-ready'); }, { once: true });
        video.src = url;
      } catch {
        fig.classList.remove('is-loading');
        const gone = document.createElement('p');
        gone.className = 'setting-hint';
        gone.textContent = 'This recording is no longer available.';
        fig.replaceChildren(gone);
      }
    })();
    return fig;
  }

  function openAttachmentPreview(url, name, revokeOnClose = false) {
    const dialog = document.createElement('dialog');
    dialog.className = 'attachment-lightbox';
    dialog.setAttribute('aria-label', 'Image preview: ' + name);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'attachment-lightbox-close';
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close image preview');
    const image = document.createElement('img');
    image.src = url;
    image.alt = name;
    dialog.append(close, image);
    const cleanup = () => {
      dialog.close();
      dialog.remove();
      if (revokeOnClose) URL.revokeObjectURL(url);
    };
    close.addEventListener('click', cleanup);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) cleanup(); });
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    document.body.appendChild(dialog);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else {
      dialog.setAttribute('open', '');
      dialog.classList.add('is-fallback-open');
    }
  }

  function attachmentFigure(ref) {
    const card = document.createElement('figure');
    card.className = 'chat-attachment is-loading';
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'chat-attachment-open';
    preview.setAttribute('aria-label', 'Open attachment ' + ref.name);
    const label = document.createElement('span');
    label.className = 'chat-attachment-name';
    label.textContent = ref.name;
    const status = document.createElement('span');
    status.className = 'chat-attachment-status';
    status.textContent = 'Loading attachment…';
    preview.append(label);
    card.append(preview, status);
    (async () => {
      try {
        const token = await credential(false);
        const response = await fetch('/v1/storage/sent/' + encodeURIComponent(ref.id), {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (!response.ok) throw new Error('Attachment unavailable');
        const blob = await response.blob();
        const mime = response.headers.get('content-type') || ref.mime || blob.type || 'application/octet-stream';
        const url = URL.createObjectURL(blob);
        card.classList.remove('is-loading');
        status.textContent = mime.startsWith('image/') ? 'Tap to preview' : 'Tap to open or download';
        if (mime.startsWith('image/')) {
          const image = document.createElement('img');
          image.src = url;
          image.alt = ref.name;
          image.loading = 'lazy';
          preview.prepend(image);
          preview.addEventListener('click', () => openAttachmentPreview(url, ref.name));
        } else {
          preview.addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = ref.name || 'attachment';
            a.rel = 'noopener';
            a.click();
          });
        }
      } catch {
        card.classList.remove('is-loading');
        card.classList.add('is-unavailable');
        status.textContent = 'This attachment is unavailable. It may have been deleted or reached its retention limit.';
        preview.disabled = true;
      }
    })();
    return card;
  }

  function imageFigure(imageId, regenerate = null, compact = false) {
    const fig = document.createElement('figure');
    fig.className = 'made-image is-loading' + (compact ? ' is-compact' : '');
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
        dl.href = url;
        dl.setAttribute('download', `nasrin-${imageId.slice(0, 8)}.${(resp.headers.get('content-type') || 'image/png').split('/')[1]}`);
        dl.hidden = false;
        // Register before setting src so cached/fast image loads cannot skip
        // the entrance transition. Reveal only after the image has decoded.
        img.addEventListener('load', () => {
          fig.classList.remove('is-loading');
          fig.classList.add('is-ready');
          // The newest picture: keep Download and Regenerate in view.
          const msg = fig.closest('.msg');
          if (msg && msg === log.lastElementChild) scrollToEnd(msg);
        }, { once: true });
        img.src = url;
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
    // Making the picture itself takes longest: the generation loader, sized
    // like the picture to come. The quick steps keep the thinking line.
    let thinking;
    if (path === '/v1/images') {
      startChat();
      thinking = genLoader(label);
      thinking.el.classList.add('msg', 'assistant');
      log.appendChild(thinking.el);
      scrollToEnd(thinking.el);
    } else thinking = showThinking(label);
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

  async function sendImage(text, files, { executeFirst = false, prompt = text } = {}) {
    noticesOnSend();
    const photo = files.find((f) => f.type && f.type.startsWith('image/') && f.data);
    show('user', text, { files: photo ? [photo] : [] });
    input.value = '';
    autosize();
    setImageMode(false);
    const job = { prompt, photo: photo ? { name: photo.name, type: photo.type, data: photo.data } : null, brief: null };
    // Slash commands are explicit execution requests: use sensible defaults and
    // skip the optional brief questions and confirmation sheet. Server-side
    // plan, ownership, privacy, budget and safety checks still apply.
    if (executeFirst) return makeImage(job, { confirm: false });
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
    card.className = 'msg assistant image-card ask-card';
    const lede = document.createElement('p');
    lede.className = 'card-lede';
    lede.textContent = questions.length === 1 ? 'One question before I start:' : `A few questions before I start (${questions.length}):`;
    card.appendChild(lede);
    const picked = questions.map(() => '');
    const questionList = document.createElement('ol');
    questionList.className = 'ask-questions';
    questionList.setAttribute('aria-label', 'Follow-up questions');
    questions.forEach((q, i) => {
      const item = document.createElement('li');
      item.appendChild(questionBox(q, (value) => { picked[i] = value; }));
      questionList.appendChild(item);
    });
    card.appendChild(questionList);
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
  async function makeImage(job, { confirm = true } = {}) {
    if (confirm && !window.confirm('Create this picture now? NasrinAI will send your prompt and selected image details to the configured AI image service. Choose Cancel to stop.')) return false;
    const data = await imageStep('Making your picture', '/v1/images', {
      ...jobBody(job),
      ...(job.brief ? { brief: job.brief } : {}),
      tier: currentModel || 'nasrinai',
      ...(conversationId ? { conversation_id: conversationId } : {})
    });
    if (!data) return false;
    conversationId = data.conversation_id;
    saved.set(identityKey(KEYS.conversation), conversationId);
    show('assistant', data.message.content, { id: data.message.id, regenerate: () => makeImage(job) });
    Nasrin.flash('happy', 1800);
    deviceNotify('NasrinAI picture ready', 'Your image has finished generating.', 'nasrinai-image-' + (data.message?.id || Date.now()));
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
  async function askStream(body, { onStart, onDelta, onReset, onAudio, onStatus = null, signal }) {
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
      else if (ev.type === 'status' && typeof ev.stage === 'string') { if (onStatus) onStatus(ev.stage); }
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
    el.className = 'msg assistant is-live is-new';
    const body = document.createElement('div');
    body.className = 'msg-body';
    const text = document.createTextNode('');
    body.appendChild(text);
    el.appendChild(body);
    let shown = false;
    let raw = '';
    let fileLoader = null;
    return {
      add(piece, thinking) {
        if (!shown) { thinking.remove(); startChat(); log.appendChild(el); shown = true; }
        raw += piece;
        text.data = window.NasrinFiles.strip(raw);   // questions and files appear as cards when the reply is done
        // A file being written: the compact generation loader under the text.
        const making = /\[\[file\b/i.test(raw);
        if (making && !fileLoader) { fileLoader = genLoader('Writing your file', { compact: true }); body.appendChild(fileLoader.el); }
        if (!making && fileLoader) { fileLoader.remove(); fileLoader = null; }
        scrollToEnd(el, { instant: true });
      },
      clear() { raw = ''; text.data = ''; if (fileLoader) { fileLoader.remove(); fileLoader = null; } },
      text() { return raw; },
      remove() { if (fileLoader) fileLoader.remove(); el.remove(); }
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

  async function sendVideo(text) {
    const videoTier = String(currentModel || 'nasrinai').trim().toLowerCase();
    const defaultResolution = videoTier === 'pro' ? '480p' : '720p';
    // Keep the client choices aligned with server-enforced base entitlements.
    // 4K remains hidden until a verified account-level add-on entitlement exists.
    const resolutionChoices = videoTier === 'pro' ? '360p or 480p' : '360p, 480p, 720p, 1080p, or 4k';
    const resolutionInput = window.prompt('Video resolution (default ' + defaultResolution + '). Available base options: ' + resolutionChoices + '.', defaultResolution);
    if (resolutionInput === null) return;
    const resolution = String(resolutionInput || defaultResolution).trim().toLowerCase();
    const allowedChoices = videoTier === 'pro' ? ['360p', '480p'] : ['360p', '480p', '720p', '1080p', '4k'];
    if (!allowedChoices.includes(resolution)) {
      show('problem', 'Choose a resolution available on your selected plan: ' + resolutionChoices + '.');
      return;
    }
    const fpsInput = window.prompt('Video frame rate (default 30 FPS). Enter 30 or 60.', '30');
    if (fpsInput === null) return;
    const fps = Number(fpsInput || 30);
    if (![30, 60].includes(fps)) {
      show('problem', 'Choose 30 or 60 FPS.');
      return;
    }
    if (!window.confirm('Create this video at ' + resolution + ' / ' + fps + ' FPS? NasrinAI will use your weekly video-seconds allowance. Your plan and the provider determine the final available quality.')) return;
    noticesOnSend();
    show('user', text);
    input.value = '';
    autosize();
    setImageMode(false);
    try {
      const data = await api('/v1/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: text, seconds: 8, tier: currentModel || 'nasrinai', resolution, fps, conversation_id: conversationId || undefined }) });
      const id = data.video_id;
      if (!id) throw new Error('The video job could not be started.');
      const card = document.createElement('div');
      card.className = 'msg assistant';
      const body = document.createElement('div');
      body.className = 'msg-body';
      body.textContent = 'I’m creating your video. You can keep using NasrinAI while it renders.';
      const loader = genLoader('Creating your video');
      card.append(body, loader.el);
      log.appendChild(card);
      scrollToEnd(card);
      const poll = async () => {
        try {
          const state = await api('/v1/videos/' + encodeURIComponent(id));
          if (state.status === 'completed') {
            loader.remove();
            body.textContent = 'Your video is ready.';
            const a = document.createElement('a');
            a.className = 'btn small';
            a.href = state.download;
            a.download = '';
            a.textContent = 'Download MP4';
            card.appendChild(a);
            deviceNotify('NasrinAI video ready', 'Your Ultra video has finished rendering.', 'nasrinai-video-' + id);
            return;
          }
          if (state.status === 'failed') { loader.remove(); body.textContent = state.error?.message || 'The video could not be completed.'; return; }
          loader.set('Creating your video · ' + Math.max(1, Number(state.progress) || 1) + '%');
          setTimeout(poll, 10000);
        } catch (err) {
          if (err.code === 'video_plan_required' || err.status === 403) { loader.remove(); body.textContent = err.message || 'Video creation is available on Ultra.'; return; }
          setTimeout(poll, 15000);
        }
      };
      poll();
    } catch (err) {
      show('problem', err.message || 'The video could not be started.');
      Nasrin.flash('sad', 2400);
    }
  }

  function shortcutImagePrompt(shortcut) {
    const extra = shortcut.args ? '\n\nAdditional direction: ' + shortcut.args : '';
    if (shortcut.name === 'clone') return 'Clone the attached reference image’s visual style, lighting, mood, and composition. Preserve its main subject and key content.' + extra;
    if (shortcut.name === 'blur') return 'Edit the attached image by blurring its background while keeping the main subject sharp. Use a natural, professional depth-of-field effect.' + extra;
    if (shortcut.name === 'remove-background') return 'Remove the background from the attached image and preserve clean edges around the subject.' + extra;
    if (shortcut.name === 'upscale') return 'Enhance and upscale the attached image, preserving its subject, composition, and natural details. Avoid inventing new content.' + extra;
    if (shortcut.name === 'animate') return 'Animate the attached image into a short cinematic video, preserving the main subject and composition.' + extra;
    if (shortcut.name === 'video') return 'Create a short cinematic video' + (shortcut.args ? ': ' + shortcut.args : ' inspired by the current conversation, using sensible defaults.');
    return 'Create an image' + (shortcut.args ? ': ' + shortcut.args : ' inspired by NasrinAI’s minimal monochrome visual identity.');
  }

  // Route explicit job-search requests into public research rather than generic advice.
  const isJobSearchRequest = (value) => {
    const q = String(value || '').trim();
    const topic = /\b(jobs?|job openings?|vacancies|career opportunities|hiring|recruitment|positions?|employment|work opportunities)\b/i.test(q);
    const action = /\b(search|find|look(?:ing)? for|show|list|discover|get me|browse|fetch)\b/i.test(q);
    const platform = /\b(linkedin|indeed|glassdoor|jobstreet|seek)\b/i.test(q);
    return q.length <= 500 && topic && (action || platform);
  };
  async function runChatJobSearch(originalMessage) {
    const query = String(originalMessage || '').trim()
      .replace(/^(?:please\s+)?(?:search|find|look\s+for|show(?:\s+me)?|list|discover|get\s+me|browse|fetch)\s+(?:for\s+)?/i, '')
      .replace(/\b(on|in|from)\s+(?:linkedin|indeed|glassdoor|jobstreet|seek)\b/ig, '')
      .replace(/\b(jobs?|job openings?|vacancies|career opportunities|hiring|recruitment|positions?|employment|work opportunities)\b/ig, ' ')
      .replace(/\s+/g, ' ').trim() || 'job opportunities';
    show('user', originalMessage);
    const pendingReply = show('thinking', 'Searching public job listings and extracting available details…');
    busy = true; refreshSendButton();
    try {
      const result = await api('/v1/professional-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        query: query + '. Find up to 20 distinct publicly accessible job listings. Extract exact title, employer, location/work arrangement, salary, requirements, benefits, responsibilities and original source URL. Use only retrieved evidence, mark missing fields Not disclosed, and do not tell the user to search manually.',
        category: 'jobs_hiring', source: 'public_web', location: '', date_range: 'any'
      }) });
      const group = result?.professional_search?.source_groups?.find((item) => item.id === 'public_web');
      const sources = Array.isArray(group?.sources) ? group.sources : (Array.isArray(result?.sources) ? result.sources : []);
      const facts = Array.isArray(group?.facts) ? group.facts : (Array.isArray(result?.facts) ? result.facts : []);
      const records = new Map();
      for (const item of sources) {
        try { const url = new URL(String(item?.url || '')); if (['http:', 'https:'].includes(url.protocol)) records.set(url.href, item); } catch {}
      }
      for (const fact of facts) {
        try { const url = new URL(String(fact?.url || '')); if (['http:', 'https:'].includes(url.protocol) && !records.has(url.href)) records.set(url.href, { url: url.href, title: url.hostname }); } catch {}
      }
      const output = ['## Job opportunities', '', 'Search: ' + query, ''];
      let n = 0;
      for (const [url, item] of records) {
        if (n >= 20) break;
        const related = facts.filter((f) => { try { return new URL(String(f?.url || '')).href === url; } catch { return false; } }).map((f) => String(f?.fact || '').trim()).filter(Boolean);
        const field = (label, pattern, direct) => {
          if (typeof direct === 'string' && direct.trim()) return direct.trim();
          const fact = related.find((value) => pattern.test(value));
          if (!fact) return 'Not disclosed';
          const match = fact.match(/^[^:—-]{2,32}\s*[:—-]\s*(.+)$/);
          return match ? match[1] : fact;
        };
        output.push('### ' + (n + 1) + '. ' + String(item?.title || 'Job opportunity').replace(/[\r\n]+/g, ' ').trim());
        output.push('- **Company:** ' + field('company', /\b(company|employer|hiring organization|posted by)\b/i, item?.company || item?.employer));
        output.push('- **Location:** ' + field('location', /\b(location|remote|hybrid|on.?site|based in)\b/i, item?.location));
        output.push('- **Salary:** ' + field('salary', /\b(salary|pay|compensation|hourly rate|per month|per year|₱|PHP|\$)\b/i, item?.salary));
        output.push('- **Requirements:** ' + field('requirements', /\b(requirements?|qualifications?|experience required|must have|skills required|degree)\b/i, item?.requirements));
        output.push('- **Benefits:** ' + field('benefits', /\b(benefits?|allowance|health insurance|paid leave|bonus|perks)\b/i, item?.benefits));
        output.push('- **Responsibilities:** ' + field('responsibilities', /\b(responsibilities|duties|you will|role involves|responsible for)\b/i, item?.responsibilities));
        output.push('- **Source:** ' + url, '');
        n++;
      }
      pendingReply.remove();
      show('assistant', n ? output.join('\n') + '\nFound ' + n + ' distinct public source(s). Verify details on the original listing.' : 'I couldn’t retrieve job listings for **' + query + '** from the public sources available. I have not fabricated results. Try broader keywords or another location.');
    } catch (error) {
      pendingReply.remove();
      show('assistant', 'I couldn’t complete the job search because the search service returned an error: ' + (error.message || 'Unknown error') + '. No results were fabricated. Please try again.');
    } finally {
      busy = false;
      refreshSendButton();
    }
  }

  async function runYouTubeFirst(query) {
    if (busy || preparing || editing || pending.length) return;
    busy = true;
    notice.textContent = '';
    stopSpeaking();
    noticesOnSend();
    hideMemoryAsk();
    refreshSendButton();
    refreshTurnControls();
    input.value = '';
    autosize();
    show('user', query);
    const assistant = show('assistant', 'Searching YouTube for videos matching your request…');
    const showSearchFallback = () => {
      const body = assistant.querySelector('.msg-body') || assistant;
      body.replaceChildren();
      const note = document.createElement('p');
      note.textContent = 'I couldn’t load embedded results right now. You can still search directly on YouTube.';
      const link = document.createElement('a');
      link.href = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query.slice(0, 180));
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Search on YouTube';
      body.append(note, link);
    };
    try {
      const rendered = await renderYouTubeVideos(assistant, query);
      if (!rendered) showSearchFallback();
    } catch (error) {
      console.warn('YouTube embed search failed; showing direct search fallback.', error);
      showSearchFallback();
    } finally {
      busy = false;
      refreshSendButton();
      refreshTurnControls();
      Nasrin.mood('idle');
    }
  }

  async function send(raw) {
    const text = String(raw || '').trim();
    if (turn) return;
    if ((!text && !pending.length) || busy || preparing) return;
    // Keep the normal answer path for every query. The assistant renderer may
    // append verified, relevant video embeds after the answer when available.
    if (!aiAvailable) {
      show('user', text);
      problem('NasrinAI is temporarily unavailable for this message. Please try again shortly.');
      return;
    }
    if (!imageMode && !editing && !pending.length && isJobSearchRequest(text)) return runChatJobSearch(text);
    const shortcut = window.NasrinCreativeIntent.parseShortcut(text);
    const intent = shortcut ? (shortcut.capability === 'chat' ? null : shortcut.capability) : window.NasrinCreativeIntent.detect(text);
    if (shortcut && shortcut.requiresPhoto && !pending.some((f) => f.type && f.type.startsWith('image/') && f.data)) {
      notice.textContent = 'Attach the image for /' + shortcut.name + ', then run the shortcut again.';
      return;
    }
    if (!shortcut && window.NasrinCreativeIntent.isImageEnhancement(text) && !pending.some((f) => f.type && f.type.startsWith('image/') && f.data)) {
      notice.textContent = 'Attach the photo you want enhanced, then send your request again.';
      return;
    }
    if (!imageMode && intent === 'video') {
      const prompt = shortcut ? shortcutImagePrompt(shortcut) : text;
      return sendVideo(prompt);
    }
    if (!imageMode && intent === 'image') {
      const files = pending;
      pending = [];
      renderTray();
      const directEdit = Boolean(shortcut || window.NasrinCreativeIntent.isImageEnhancement(text));
      return sendImage(text, files, directEdit ? { executeFirst: true, prompt: shortcut ? shortcutImagePrompt(shortcut) : text } : {});
    }
    if (imageMode) {
      if (!text) { notice.textContent = 'Describe the picture you want.'; return; }
      const files = pending;
      pending = [];
      renderTray();
      return sendImage(text, files);
    }
    // "Cite <link or DOI>": the source's publication details and citation
    // formats, looked up (facts only), not written by the AI.
    const citeAsk = !editing && !shortcut && !pending.length && citeTarget(text);
    if (citeAsk) return citeMessage(text, citeAsk);
    // "Clean this file" with a spreadsheet or CSV: cleaned here, in the
    // browser, by fixed rules (no AI, nothing sent).
    if (!editing && !shortcut && CLEAN_ASK.test(text) && pending.some(isSheetFile)) {
      const files = pending;
      pending = [];
      renderTray();
      return cleanFiles(text, files);
    }
    const files = editing ? [] : pending;
    if (!editing) { pending = []; renderTray(); }
    // Supported chat shortcuts are explicit instructions. Keep the original
    // command in the conversation so it remains visible and auditable.
    return runTurn({ text, files, editId: editing ? editing.id : null, editEl: editing ? editing.el : null });
  }


  function showLocationPermissionCard() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div'); overlay.className = 'location-consent-overlay';
      const card = document.createElement('section'); card.className = 'location-consent-card';
      card.setAttribute('role','dialog'); card.setAttribute('aria-modal','true');
      card.setAttribute('aria-labelledby','locationConsentTitle'); card.setAttribute('aria-describedby','locationConsentDescription');
      const header = document.createElement('div'); header.className = 'location-consent-header';
      const iconBox = document.createElement('div'); iconBox.className = 'location-consent-icon'; iconBox.setAttribute('aria-hidden','true');
      const pinSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      pinSvg.setAttribute('viewBox', '0 0 24 24');
      pinSvg.setAttribute('fill', 'none');
      pinSvg.setAttribute('stroke', 'currentColor');
      pinSvg.setAttribute('stroke-width', '1.8');
      pinSvg.setAttribute('stroke-linecap', 'round');
      pinSvg.setAttribute('stroke-linejoin', 'round');
      const pinPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pinPath.setAttribute('d', 'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z');
      const pinCenter = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      pinCenter.setAttribute('cx', '12');
      pinCenter.setAttribute('cy', '10');
      pinCenter.setAttribute('r', '2.7');
      pinSvg.append(pinPath, pinCenter);
      iconBox.append(pinSvg);
      const copy = document.createElement('div'); copy.className = 'location-consent-copy';
      const title = document.createElement('h2'); title.id = 'locationConsentTitle'; title.textContent = 'Allow NasrinAI to access your location?';
      const desc = document.createElement('p'); desc.id = 'locationConsentDescription'; desc.textContent = 'Your location helps provide local weather, nearby places, and directions.';
      copy.append(title,desc); header.append(iconBox,copy);
      const divider = document.createElement('div'); divider.className = 'location-consent-divider';
      const actions = document.createElement('div'); actions.className = 'location-consent-actions';
      const choice = (label,hint,extra) => { const b=document.createElement('button'); b.type='button'; b.className='location-consent-choice'+(extra?' '+extra:''); const a=document.createElement('span'); a.textContent=label; const h=document.createElement('span'); h.textContent=hint; b.append(a,h); return b; };
      const cancel=choice('Cancel','Continue without location',''), allow=choice('Allow location','Then request browser permission','location-consent-allow');
      actions.append(cancel,allow); card.append(header,divider,actions); overlay.append(card); document.body.append(overlay);
      const finish = (value) => { overlay.remove(); document.removeEventListener('keydown', keydown); resolve(value); };
      const keydown = (event) => { if(event.key==='Escape') finish(false); };
      cancel.addEventListener('click',()=>finish(false)); allow.addEventListener('click',()=>finish(true));
      overlay.addEventListener('click',(event)=>{if(event.target===overlay)finish(false);});
      document.addEventListener('keydown',keydown); allow.focus();
    });
  }
  function getDeviceLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation || !window.isSecureContext) return resolve(null);
      let settled=false; const finish=(value)=>{if(!settled){settled=true;resolve(value);}};
      navigator.geolocation.getCurrentPosition((p)=>finish({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:Number.isFinite(p.coords.accuracy)?p.coords.accuracy:null}),()=>finish(null),{enableHighAccuracy:false,maximumAge:120000,timeout:15000});
      // Allow time for the native browser permission prompt before falling back.
      setTimeout(()=>finish(null),16000);
    });
  }

  // One reply: a new message, Regenerate (replace: the old answer), Retry
  // (regenerate after a failure), or an edited last message.
  // spoken: this turn is part of a voice conversation (short, spoken-style reply).
  // speakVoice: a natural voice id; the server then sends the reply as speech while it is written (onAudio).
  // onPiece(text | null): the reply as it arrives (null: start over). onFail(err): it failed.
  // Resolves { data, shown } when a reply was shown, otherwise nothing.
  async function runTurn({ text = '', files = [], regenerate = false, replace = null, editId = null, editEl = null, spoken = false, speakVoice = null, onPiece = null, onAudio = null, onFail = null, locationContext = null }) {
    const needsDeviceLocation = !locationContext && !regenerate && !files.length && /\b(?:weather|forecast|temperature|rain(?:ing)?|near(?:by)? me|near me|closest to me|around me|directions? from here|route from here|where am i|my location|current location|nearby places)\b/i.test(text);
    if (needsDeviceLocation && navigator.geolocation && window.isSecureContext) {
      // Lock the composer before awaiting consent so a second submit cannot
      // open another permission card or send the same message twice.
      busy = true;
      refreshSendButton();
      const consent = await showLocationPermissionCard();
      if (consent) locationContext = await getDeviceLocation();
    }
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
    const viewEpoch = chatViewEpoch;
    let turnConversationId = conversationId;
    const turnProject = chatProject ? { id: chatProject.id, name: chatProject.name } : null;
    const isCurrentView = () => viewEpoch === chatViewEpoch;
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
    const thinking = showThinking(regenerate ? 'Thinking again' : files.length ? 'Reading your file' : guessThinking(text));
    const live = liveBubble();
    const ctrl = new AbortController();
    const turnState = { ctrl, viewEpoch };
    turn = turnState;
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
      ...(!id && turnProject ? { project_id: turnProject.id } : {}),
      ...(currentModel ? { model: currentModel } : {}),
      professional: proRequest(),
      ...(locationContext ? { location_context: locationContext } : {}),
      ...(codingProject ? { coding: true, ...(saved.get(KEYS.coding + ':repo:' + codingProject.id) ? { repo: saved.get(KEYS.coding + ':repo:' + codingProject.id) } : {}) } : {}),
      ...(files.length ? { attachments: files.map((f) => (f.upload ? { name: f.name, type: f.type, upload: f.upload } : { name: f.name, type: f.type, data: f.data })) } : {})
    });
    const turnCoding = codingProject ? { id: codingProject.id, name: codingProject.name } : null;
    const hooks = {
      signal: ctrl.signal,
      onStart: (ev) => {
        started = ev;
        turnConversationId = ev.conversation_id;
        if (turnCoding) rememberCodeChat(ev.conversation_id, turnCoding);
        if (isCurrentView()) {
          conversationId = turnConversationId;
          saved.set(identityKey(KEYS.conversation), conversationId);
        }
        if (userEl && typeof ev.user_message_id === 'string') userEl.dataset.id = ev.user_message_id;
      },
      onDelta: (piece) => { live.add(piece, thinking); if (onPiece) onPiece(piece); },
      onReset: () => { live.clear(); if (onPiece) onPiece(null); },
      onStatus: (name) => thinking.stage(name),
      onAudio
    };
    try {
      let data;
      try {
        data = await askStream(body(turnConversationId), hooks);
      } catch (err) {
        if (err.status !== 404 || !turnConversationId || regenerate || editId) throw err;
        // The earlier chat is gone (guest chats expire); carry on in a new one.
        turnConversationId = null;
        if (isCurrentView()) {
          conversationId = null;
          saved.del(identityKey(KEYS.conversation));
          notice.textContent = 'Your earlier chat has expired, so this message starts a new one.';
        }
        data = await askStream(body(null), hooks);
      }
      thinking.remove();
      live.remove();
      turnConversationId = data.conversation_id;
      if (turnCoding) rememberCodeChat(turnConversationId, turnCoding);
      if (isCurrentView()) {
        conversationId = turnConversationId;
        saved.set(identityKey(KEYS.conversation), conversationId);
        if (data.project && typeof data.project.id === 'string') setChatProject(data.project);
      }
      if (userEl && typeof data.user_message_id === 'string') userEl.dataset.id = data.user_message_id;
      if (!isCurrentView()) return { data, shown: null, background: true };
      busy = false;
      if (!data.message) return;
      const shown = show('assistant', data.message.content, { id: data.message.id, animate: !live.text(), fresh: true, responseMetadata: data.response_metadata || null });
      // Explicit requests for real internet photos get a separate inline gallery.
      // Keep this opt-in by intent so ordinary replies never gain unrelated images.
      if (!turnCoding && /\b(show|find|search|display|give me)\b.{0,70}\b(real )?(photos?|pictures?|images?)\b/i.test(text)
          && /\b(internet|online|from the web|web search|from the internet)\b/i.test(text)) {
        const query = text
          .replace(/\b(show|find|search|display|give me)\b/ig, ' ')
          .replace(/\b\d+\b/ig, ' ')
          .replace(/\b(real|actual|photos?|pictures?|images?|from|the|internet|online|web|search|directly|inside|this|chat|with|captions?|source|links?|please|do not|only)\b/ig, ' ')
          .replace(/\s+/g, ' ').trim().slice(0, 160);
        if (query.length >= 2) {
          const gallery = document.createElement('section');
          gallery.className = 'internet-image-gallery';
          gallery.setAttribute('aria-label', 'Internet image results');
          const label = document.createElement('p');
          label.className = 'internet-image-heading';
          label.textContent = 'Photos from the internet';
          gallery.appendChild(label);
          const loading = document.createElement('p');
          loading.className = 'internet-image-status';
          loading.textContent = 'Finding real photos…';
          gallery.appendChild(loading);
          shown.appendChild(gallery);
          api('/v1/web-images/search?q=' + encodeURIComponent(query)).then(({ images = [] }) => {
            loading.remove();
            if (!images.length) {
              loading.textContent = 'No suitable photos were found. Try a more specific place or subject.';
              gallery.appendChild(loading);
              return;
            }
            const grid = document.createElement('div');
            grid.className = 'internet-image-grid';
            for (const item of images.slice(0, 5)) {
              let imageUrl, sourceUrl;
              try {
                imageUrl = new URL(item.image_url);
                sourceUrl = new URL(item.source_url);
              } catch { continue; }
              if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'upload.wikimedia.org'
                  || sourceUrl.protocol !== 'https:' || sourceUrl.hostname !== 'commons.wikimedia.org') continue;
              const card = document.createElement('article');
              card.className = 'internet-image-card';
              const image = document.createElement('img');
              image.src = imageUrl.href;
              image.alt = String(item.title || 'Internet photo').slice(0, 160);
              image.loading = 'lazy';
              image.referrerPolicy = 'no-referrer';
              image.addEventListener('error', () => card.remove(), { once: true });
              card.appendChild(image);
              const caption = document.createElement('p');
              caption.className = 'internet-image-caption';
              caption.textContent = item.title || 'Photo';
              card.appendChild(caption);
              const credit = document.createElement('p');
              credit.className = 'internet-image-credit';
              credit.textContent = [item.artist, item.license].filter(Boolean).join(' · ');
              if (credit.textContent) card.appendChild(credit);
              const source = document.createElement('a');
              source.href = sourceUrl.href;
              source.target = '_blank';
              source.rel = 'noopener noreferrer';
              source.textContent = 'View source';
              card.appendChild(source);
              grid.appendChild(card);
            }
            if (grid.children.length) gallery.appendChild(grid);
            else {
              loading.textContent = 'The images could not be loaded. Please try again.';
              gallery.appendChild(loading);
            }
          }).catch(() => {
            loading.textContent = 'Internet image search is temporarily unavailable.';
          });
        }
      }
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
      if (document.hidden) deviceNotify('NasrinAI work complete', 'Your request has finished.', 'nasrinai-chat-' + (data.message?.id || Date.now()));
      return { data, shown };
    } catch (err) {
      thinking.remove();
      const partial = live.text();
      live.remove();
      if (isCurrentView()) busy = false;
      if (onFail && isCurrentView()) onFail(err, ctrl.signal.aborted);
      if (ctrl.signal.aborted) {
        // Stopped: what was written stays (the server kept it too).
        if (isCurrentView() && partial.trim()) {
          const shown = show('assistant', partial, { animate: false });
          const note = document.createElement('p');
          note.className = 'pro-used';
          note.textContent = 'Stopped';
          shown.appendChild(note);
        }
        if (isCurrentView()) Nasrin.mood('idle');
        return;
      }
      if (!isCurrentView()) {
        if (document.hidden) deviceNotify('NasrinAI work failed', 'A reply in your previous chat could not be completed.', 'nasrinai-chat-failed-' + Date.now());
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
      // A background turn must never clear the busy state of a newer turn.
      if (turn === turnState) {
        busy = false;
        turn = null;
        refreshSendButton();
        refreshTurnControls();
      }
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
  // Desktop (mouse and keyboard): Enter sends, Shift+Enter starts a new line.
  // Phones and tablets: Enter starts a new line; the Send button sends.
  // Typing with an input method (IME, e.g. Japanese) never sends early, and
  // Enter never stops a reply that is being written.
  const desktopKeys = window.matchMedia('(hover: hover) and (pointer: fine)');
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.isComposing || e.keyCode === 229 || !desktopKeys.matches) return;
    e.preventDefault();
    if (!turn) send(input.value);
  });
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
  // Starter actions take people directly to the capability they selected.
  const starterActions = {
    // Space lives inside Settings: open the sheet first, then its Space page.
    space: () => { openSettings(); openNasrinSpace?.click(); },
    library: () => spaceLibrary?.click(),
    coding: () => spaceCoding?.click(),
    connect: () => spaceConnect?.click()
  };
  for (const b of document.querySelectorAll('.starter[data-starter-action]')) {
    b.addEventListener('click', () => starterActions[b.dataset.starterAction]?.());
  }

  // Detaches a reply still being written from the screen without stopping it:
  // it finishes and is saved in its own chat. True when one was running.
  function detachTurn() {
    const continuing = Boolean(turn);
    chatViewEpoch++;
    turn = null;
    busy = false;
    return continuing;
  }
  const BACKGROUND_NOTE = 'Your previous reply is continuing in the background and will be saved in Your chats.';

  function startNewChat({ focus = true, message = '', keepCoding = false } = {}) {
    if (codingProject && !keepCoding) setCoding(null);
    const continuingTurn = detachTurn();
    setChatProject(null);
    conversationId = null;
    saved.del(identityKey(KEYS.conversation));
    stopSpeaking();
    notice.textContent = message || (continuingTurn ? BACKGROUND_NOTE : '');
    clearScreen();
    refreshSendButton();
    refreshTurnControls();
    Nasrin.flash('happy', 1200);
    if (focus) input.focus();
    startNotes('new_chat');
  }
  // In the coding chat, New chat opens a fresh coding chat in the same
  // project; leaving the coding chat is the header's leave button.
  $('newChat').addEventListener('click', () => (codingProject ? enterCoding(codingProject) : startNewChat()));

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
  // Coral can sound unusually bright on some devices. Migrate the previous default
  // to Cedar once so existing users receive the more grounded voice by default.
  if (voiceChoice === 'ai:coral' || voiceChoice === 'ai:openai:coral') {
    voiceChoice = 'ai:openai:cedar';
    saved.set(KEYS.voice, voiceChoice);
  }
  // Reading speed comes from the server's setting (the voice screen no longer
  // has a speed button); an old per-device choice is cleared.
  let speechRate = 1;
  saved.del(KEYS.speechRate);
  let playing = null;            // { stop(), button }

  const canSpeakAnything = () => canDevice || (speech.available && Boolean(AudioCtx));
  const currentVoice = () => {
    if (typeof voiceChoice === 'string' && voiceChoice.startsWith('ai:')) {
      const raw = voiceChoice.slice(3);
      voiceChoice = raw.includes(':') ? 'ai:' + raw : 'ai:openai:' + raw;
    }
    const ok = (v) => typeof v === 'string' && (
      (v.startsWith('ai:') && speech.available && speech.voices.some((x) => 'ai:' + x.id === v.slice(3) && x.available !== false)) ||
      (v.startsWith('device:') && canDevice)
    );
    if (ok(voiceChoice)) return voiceChoice;
    if (speech.available && AudioCtx) {
      const v = speech.voices.find((x) => x.id === 'openai:cedar' && x.available !== false) || speech.voices.find((x) => x.id === 'gemini:Charon' && x.available !== false) || speech.voices.find((x) => x.available !== false);
      if (v) return 'ai:' + v.id;
    }
    return 'device:default';
  };

  function unlockAudio() {
    if (!AudioCtx) return;
    // iPhone: let read-aloud play like media, even with the ring/silent switch on.
    // Not during a voice conversation: it needs the microphone, and 'playback'
    // would cut the call's sound.
    try { if (!vc.on && navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
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
  // One play/stop button per reply: idle shows play; while loading or reading
  // it shows stop, and tapping it stops.
  function setPlaying(button, on, loading = false) {
    if (!button) return;
    button.classList.toggle('is-playing', on);
    button.classList.toggle('is-loading', on && loading);
    const shape = button.querySelector('path');
    if (shape) shape.setAttribute('d', on ? ICON_STOP : ICON_PLAY);
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Stop reading aloud' : 'Play reply aloud');
    button.title = on ? 'Stop' : 'Play';
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
      resume() { if (stopped) return; this.paused = false; audioCtx.resume().catch(() => {}); setPlaying(button, true); Nasrin.mood('speaking'); },
      setRate(rate) { for (const src of sources) { try { src.playbackRate.value = rate; } catch {} } }
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
        src.playbackRate.value = speechRate;
        src.connect(sink);
        // A part that arrives late starts now, never on top of the one playing.
        at = Math.max(at, audioCtx.currentTime + 0.02);
        src.start(at);
        at += buf.duration / speechRate;
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
    playing = { stop: close, button: null, loading: false, paused: false, pause() {}, resume() {}, setRate(rate) { for (const src of sources) { try { src.playbackRate.value = rate; } catch {} } } };
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
            src.playbackRate.value = speechRate;
            src.connect(analyser);
            // A piece that arrives late starts now, never on top of the one playing.
            at = Math.max(at, audioCtx.currentTime + 0.02);
            src.start(at);
            at += buf.duration / speechRate;
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
  // A site's real logo, through our own server (GET /v1/site-icon?host=…, so
  // the page's CSP stays 'self'). The letter shows until it loads, and stays
  // if the site has no usable logo.
  function siteLogo(holder, host) {
    const h = String(host || '').toLowerCase();
    if (!/^[a-z0-9.-]{3,253}$/.test(h)) return;
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => holder.classList.add('has-logo'), { once: true });
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = '/v1/site-icon?host=' + encodeURIComponent(h);
    holder.appendChild(img);
  }

  // The Sources button (site badges + "Sources"): a folded list of the pages a web answer used, opened in a
  // new tab (never with the page's access to this one).
  let sourcesCount = 0;
  // Show source-page images when web research has useful Open Graph/Twitter
  // thumbnails. Images are fetched through our same-origin, raster-only proxy.
  function renderWebPreviews(message, links) {
    const candidates = links.filter((link) => /^https?:$/.test((() => { try { return new URL(link.url).protocol; } catch { return ''; } })())).slice(0, 3);
    if (!candidates.length) return;
    const section = document.createElement('section');
    section.className = 'web-preview-grid';
    section.setAttribute('aria-label', 'Images from web sources');
    let loaded = 0;
    for (const source of candidates) {
      const card = document.createElement('a');
      card.className = 'web-preview-card';
      card.href = source.url;
      card.target = '_blank';
      card.rel = 'noopener noreferrer';
      card.setAttribute('aria-label', 'Open source: ' + (source.title || source.host));
      const img = document.createElement('img');
      img.className = 'web-preview-image';
      img.alt = (source.title || 'Web source image').slice(0, 180);
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.src = '/v1/page-preview?url=' + encodeURIComponent(source.url);
      img.addEventListener('load', () => {
        loaded++;
        section.classList.add('has-images');
      }, { once: true });
      img.addEventListener('error', () => {
        card.remove();
        if (!section.querySelector('.web-preview-card')) section.remove();
      }, { once: true });
      const caption = document.createElement('span');
      caption.className = 'web-preview-caption';
      caption.textContent = (source.title || source.host || 'Source image').slice(0, 100);
      card.append(img, caption);
      section.appendChild(card);
    }
    message.appendChild(section);
  }

  async function renderSocialEmbeds(message, links = []) {
    if (message.querySelector('.social-embed-results')) return;
    const candidates = [];
    const seen = new Set();
    for (const link of Array.isArray(links) ? links : []) {
      try {
        const url = new URL(link?.url || link?.href || '');
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        const supported = host === 'tiktok.com' || host === 'm.tiktok.com' || host === 'facebook.com' || host === 'm.facebook.com' || host === 'fb.watch' || host === 'instagram.com' || host === 'm.instagram.com' || host === 'vimeo.com' || host === 'm.vimeo.com' || host === 'dailymotion.com' || host === 'dai.ly';
        if (url.protocol !== 'https:' || !supported || seen.has(url.href)) continue;
        if (host.includes('tiktok') && !/^\/@[A-Za-z0-9._-]+\/video\/\d+/.test(url.pathname)) continue;
        if ((host === 'facebook.com' || host === 'm.facebook.com') && !/(^\/watch(?:\/|$)|\/videos\/|\/posts\/|\/permalink\/|\/reel\/|\/photo(?:s)?\/)/i.test(url.pathname)) continue;
        if ((host === 'instagram.com' || host === 'm.instagram.com') && !/^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) continue;
        if ((host === 'vimeo.com' || host === 'm.vimeo.com') && !/^\/\d+\/?$/.test(url.pathname)) continue;
        if (host === 'dailymotion.com' && !/^\/video\/[A-Za-z0-9]+(?:_[^/]+)?\/?$/.test(url.pathname)) continue;
        if (host === 'dai.ly' && !/^\/[A-Za-z0-9]+\/?$/.test(url.pathname)) continue;
        seen.add(url.href);
        candidates.push({ url: url.href, title: String(link.title || '').slice(0, 240) });
        if (candidates.length >= 5) break;
      } catch {}
    }
    if (!candidates.length) return;
    const token = account?.token || await guestToken(false);
    const section = document.createElement('section');
    section.className = 'social-embed-results';
    section.setAttribute('aria-label', 'Embedded social media');
    for (const candidate of candidates) {
      try {
        const response = await net('/v1/social/oembed?url=' + encodeURIComponent(candidate.url), {
          headers: { Authorization: 'Bearer ' + token }
        });
        if (!response.ok) continue;
        const data = await response.json();
        const embedUrl = new URL(data.embedUrl || '');
        const allowed = data.provider === 'tiktok'
          ? embedUrl.origin === 'https://www.tiktok.com' && /^\/player\/v1\/\d+$/.test(embedUrl.pathname)
          : data.provider === 'facebook'
            ? embedUrl.origin === 'https://www.facebook.com' && /^\/plugins\/(?:video|post)\.php$/.test(embedUrl.pathname)
            : data.provider === 'instagram'
              ? embedUrl.origin === 'https://www.instagram.com' && /^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/embed\/$/.test(embedUrl.pathname)
              : data.provider === 'vimeo'
                ? embedUrl.origin === 'https://player.vimeo.com' && /^\/video\/\d+$/.test(embedUrl.pathname)
                : data.provider === 'dailymotion'
                ? embedUrl.origin === 'https://www.dailymotion.com' && /^\/embed\/video\/[A-Za-z0-9]+$/.test(embedUrl.pathname)
                : false;
        if (!allowed) continue;
        const card = document.createElement('article');
        card.className = 'social-embed-card social-embed-' + data.provider;
        const heading = document.createElement('p');
        heading.className = 'social-embed-title';
        heading.textContent = String(data.title || candidate.title || ({ tiktok: 'TikTok video', facebook: 'Facebook post', instagram: 'Instagram post', vimeo: 'Vimeo video', dailymotion: 'Dailymotion video' }[data.provider] || 'Video')).slice(0, 240);
        const frame = document.createElement('iframe');
        frame.loading = 'lazy';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.title = heading.textContent;
        frame.src = embedUrl.href;
        frame.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
        frame.allowFullscreen = true;
        const source = document.createElement('a');
        source.href = candidate.url;
        source.target = '_blank';
        source.rel = 'noopener noreferrer';
        source.textContent = ({ tiktok: 'Open on TikTok', facebook: 'Open on Facebook', instagram: 'Open on Instagram', vimeo: 'Open on Vimeo', dailymotion: 'Open on Dailymotion' }[data.provider] || 'Open source');
        card.append(heading, frame, source);
        section.appendChild(card);
      } catch {
        // A blocked/private post should not break the answer or other embeds.
      }
    }
    if (section.children.length) (message.querySelector('.msg-body') || message).appendChild(section);
  }

  function needsYouTubeVideos(query) {
    const q = String(query || '').trim();
    if (q.length < 5 || q.length > 600) return false;
    // Generic assistant greetings are not video-search intent ("How can I help you?").
    if (/\bhow can i help you\b/i.test(q)) return false;
    // Do not append unrelated YouTube results to a request about another platform.
    const asksOtherPlatform = /\b(?:tiktok|tik tok|facebook|instagram)\b/i.test(q);
    const explicitlyAsksYouTube = /\b(?:youtube|yt)\b/i.test(q);
    if (asksOtherPlatform && !explicitlyAsksYouTube) return false;
    return /\b(?:youtube|video(?:s)?|tutorial|walkthrough|step[- ]by[- ]step|show me how|teach me how|how (?:do i|to|do|does|can i|can you)|learn how to|demonstration|demo|directions? (?:to|from)|from here to|how to get to|how do i get to|navigate to|route to|walking directions|driving directions)\b/i.test(q);
  }


  function youtubeQueryForReply(userQuery, assistantText) {
    const query = String(userQuery || '').trim();
    const reply = String(assistantText || '').trim();
    // A vague request for the embed should reuse the video the assistant just
    // mentioned, not search YouTube for the literal phrase "embedded videos".
    const vagueEmbedRequest = /^(?:embedded videos?|embed(?:ded)?(?: it| them| the videos?| player)?|play(?: it| them| the video)?|show(?: me)? the (?:embedded )?video player)[.!\s]*$/i.test(query);
    if (vagueEmbedRequest && needsYouTubeVideos(reply)) {
      const title = reply.match(/(?:watch|video)\s+["“]([^"”]{3,200})["”]\s+(?:on YouTube|video)/i);
      return title ? title[1].trim() : reply.slice(0, 600);
    }
    if (needsYouTubeVideos(query)) return query;
    const affirmative = /^(?:yes|yeah|yep|yup|sure|please(?: do)?|go ahead|sounds good|that would be great|of course|okay|ok|search|find them|show me)(?:[,.! ]+(?:please|do|it|them|the videos|the latest videos))*[.!\s]*$/i.test(query);
    if (affirmative && needsYouTubeVideos(reply)) return reply.slice(0, 600);
    return '';
  }

  function youtubeResultsHeading(query) {
    const q = String(query || '');
    if (/\b(?:directions?|navigate|route|walking|driving|from here to|how to get to|how do i get to)\b/i.test(q)) return 'Related video guides';
    if (/\b(?:trending|trends|viral|popular|top|latest)\b/i.test(q)) return 'Trending videos';
    if (/\b(?:tutorial|walkthrough|step[- ]by[- ]step|show me how|teach me how|how (?:do i|to|do|does|can i|can you)|learn how to|demonstration)\b/i.test(q)) return 'Video tutorials';
    return 'Videos';
  }

  const PERSISTENT_YOUTUBE_KEY = 'nasrin.persistentYoutubePlayer';

  function createYouTubeVideoCard(video) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(video?.id || ''))) return null;
    const card = document.createElement('article');
    card.className = 'youtube-video-card';
    const frameWrap = document.createElement('div');
    frameWrap.className = 'youtube-video-frame';
    const frame = document.createElement('iframe');
    frame.title = String(video.title || 'YouTube video').slice(0, 240);
    frame.loading = 'lazy';
    // Set playback permissions and referrer policy BEFORE src. Assigning src
    // first can start navigation immediately, before Safari applies the policy;
    // YouTube may then reject the embed when it receives no usable referrer.
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen');
    frame.allowFullscreen = true;
    frame.setAttribute('loading', 'lazy');
    frame.setAttribute('playsinline', '');
    frame.src = 'https://www.youtube-nocookie.com/embed/' + video.id + '?playsinline=1&rel=0&enablejsapi=0';
    frameWrap.appendChild(frame);
    const details = document.createElement('div');
    details.className = 'youtube-video-details';
    const title = document.createElement('p');
    title.className = 'youtube-video-title';
    title.textContent = String(video.title || 'YouTube video').slice(0, 240);
    const channel = document.createElement('p');
    channel.className = 'youtube-video-channel';
    channel.textContent = String(video.channelTitle || 'YouTube').slice(0, 120);
    const open = document.createElement('a');
    open.className = 'youtube-video-link';
    open.href = 'https://www.youtube.com/watch?v=' + video.id;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = 'Watch on YouTube';
    details.append(title, channel, open);
    card.append(frameWrap, details);
    return card;
  }

  function mountPersistentYouTubePlayer(video, existingCard = null) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(String(video?.id || ''))) return;
    const state = { id: video.id, title: String(video.title || 'YouTube video').slice(0, 240), channelTitle: String(video.channelTitle || 'YouTube').slice(0, 120) };
    try { localStorage.setItem(PERSISTENT_YOUTUBE_KEY, JSON.stringify(state)); } catch {}
    let panel = document.getElementById('persistent-youtube-player');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'persistent-youtube-player';
      panel.className = 'persistent-youtube-player';
      panel.setAttribute('aria-label', 'Persistent video player');
      panel.setAttribute('role', 'region');
      const header = document.createElement('div');
      header.className = 'persistent-youtube-header';
      const label = document.createElement('span');
      label.className = 'persistent-youtube-label';
      label.textContent = 'Continue watching';
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'persistent-youtube-close';
      close.setAttribute('aria-label', 'Close persistent video player');
      close.title = 'Close video player';
      close.textContent = '×';
      close.addEventListener('click', () => {
        panel.remove();
        try { localStorage.removeItem(PERSISTENT_YOUTUBE_KEY); } catch {}
      });
      header.append(label, close);
      panel.appendChild(header);
      document.body.appendChild(panel);
    }
    let card = existingCard;
    if (!card) card = createYouTubeVideoCard(state);
    if (!card) return;
    panel.querySelector('.youtube-video-card')?.remove();
    panel.appendChild(card);
    panel.dataset.videoId = state.id;
  }

  let persistentYouTubeRestore = null;
  function restorePersistentYouTubePlayer() {
    if (persistentYouTubeRestore) return persistentYouTubeRestore;
    persistentYouTubeRestore = Promise.resolve().then(() => {
      let state;
      try { state = JSON.parse(localStorage.getItem(PERSISTENT_YOUTUBE_KEY) || 'null'); } catch { return; }
      if (!state || !/^[A-Za-z0-9_-]{11}$/.test(String(state.id || ''))) return;
      const mounted = document.getElementById('persistent-youtube-player');
      if (mounted?.dataset.videoId === state.id) return;
      // Do not delete a saved player because a verification/search API is
      // temporarily unavailable. YouTube's own embed handles playback status.
      mountPersistentYouTubePlayer(state);
    }).finally(() => { persistentYouTubeRestore = null; });
    return persistentYouTubeRestore;
  }

  function isYouTubeSearchRequest(query) {
    const q = String(query || '').trim();
    if (!needsYouTubeVideos(q)) return false;
    // Requests that explicitly ask for interpretation still need the normal AI answer.
    if (/\b(?:explain|summari[sz]e|analy[sz]e|review|compare|breakdown|tell me about)\b/i.test(q)) return false;
    if (/\b(?:create|generate|make|render|produce|animate)\b.{0,50}\b(?:a |an |the )?(?:video|clip|movie)\b/i.test(q)) return false;
    // Bare terms such as "youtube" are ordinary messages, not a reason to
    // divert submission into a specialized flow that can fail silently.
    return /\b(?:latest|newest|recent|trending|trends|viral|popular|top|find|search(?:\s+for)?|look for|watch|videos?\s+(?:of|from|by|about|on)|video\s+(?:of|from|by|about|on))\b/i.test(q);
  }

  async function renderYouTubeVideos(message, userQuery, sourceLinks = [], sourceOnly = false) {
    if (message.querySelector('.youtube-results')) return true;
    const nav = /\b(?:directions?|navigate|route|walking|driving|from here to|how to get to|how do i get to)\b/i.test(userQuery);
    const tutorialIntent = /\b(?:tutorial|walkthrough|step[- ]by[- ]step|show me how|teach me how|how (?:do i|to|do|does|can i|can you)|learn how to|demonstration)\b/i.test(userQuery);
    const query = (userQuery + (nav ? ' route directions travel guide' : tutorialIntent ? ' tutorial walkthrough' : '')).slice(0, 180);
    try {
      let videos = [];
      try {
        if (!sourceOnly) {
          const token = account?.token || await guestToken(false);
          const response = await net('/v1/youtube/search?q=' + encodeURIComponent(query), {
            headers: { Authorization: 'Bearer ' + token }
          });
          if (response.ok) {
            const data = await response.json();
            videos = Array.isArray(data.videos) ? data.videos.slice(0, 3) : [];
          }
        }
      } catch {
        // Fall back to a validated, direct YouTube source link below.
      }
      // If server-side search is unavailable or has no verified results, a
      // cited direct YouTube URL may still be embedded. Only accept official
      // YouTube hosts and an exact 11-character video ID; never embed arbitrary URLs.
      if (!videos.length && Array.isArray(sourceLinks)) {
        videos = sourceLinks.slice(0, 8).flatMap((source) => {
          const raw = typeof source === 'string' ? source : source?.url || source?.href || '';
          let url;
          try { url = new URL(raw); } catch { return []; }
          if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(url.hostname.toLowerCase())) return [];
          const id = url.hostname.toLowerCase() === 'youtu.be'
            ? url.pathname.split('/').filter(Boolean)[0]
            : (url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] || '');
          if (!/^[A-Za-z0-9_-]{11}$/.test(String(id || ''))) return [];
          return [{
            id,
            title: String((typeof source === 'object' && source.title) || 'YouTube video').slice(0, 240),
            channelTitle: 'YouTube',
            watchUrl: 'https://www.youtube.com/watch?v=' + id,
            embedUrl: 'https://www.youtube-nocookie.com/embed/' + id
          }];
        });
      }
      if (!videos.length || message.querySelector('.youtube-results')) return false;
      const section = document.createElement('section');
      section.className = 'youtube-results';
      section.setAttribute('aria-label', 'Relevant YouTube videos');
      const heading = document.createElement('h3');
      heading.className = 'youtube-results-heading';
      heading.textContent = youtubeResultsHeading(userQuery);
      section.appendChild(heading);
      // Keep the primary player inline in the assistant answer. Moving it into
      // the persistent mini-player detaches it from the tutorial card.
      const firstCard = createYouTubeVideoCard(videos[0]);
      if (firstCard) {
        section.appendChild(firstCard);
        // Persist metadata as soon as an inline video is shown. Never store
        // tokens or private conversation text—only the validated video ID/title.
        try {
          localStorage.setItem(PERSISTENT_YOUTUBE_KEY, JSON.stringify({
            id: videos[0].id,
            title: String(videos[0].title || 'YouTube video').slice(0, 240),
            channelTitle: String(videos[0].channelTitle || 'YouTube').slice(0, 120)
          }));
        } catch {}
      }
      for (const video of videos.slice(1)) {
        const card = createYouTubeVideoCard(video);
        if (card) section.appendChild(card);
      }
      if (section.querySelector('.youtube-video-card')) {
        const body = message.querySelector('.msg-body');
        (body || message).appendChild(section);
        return true;
      }
      return false;
    } catch {
      // Video search is an enhancement; it must never break the chat reply.
      return false;
    }
  }

  function sourcesToggle(row, links) {
    const list = document.createElement('ul');
    list.className = 'reply-sources';
    list.id = 'reply-sources-' + (++sourcesCount);
    list.hidden = true;
    const heading = mk('p', 'reply-sources-heading', 'Sources & Resources');
    heading.hidden = true;
    heading.id = list.id + '-heading';
    list.setAttribute('aria-labelledby', heading.id);
    for (const l of links) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const t = document.createElement('span');
      t.className = 'reply-source-title';
      t.textContent = l.title;
      const h = document.createElement('span');
      h.className = 'reply-source-host';
      h.textContent = l.host;
      // The site's own logo, credited next to its name.
      const logo = mk('span', 'reply-source-logo', (l.host.replace(/^(?:www|m|en)\./, '')[0] || '?').toUpperCase());
      logo.setAttribute('aria-hidden', 'true');
      siteLogo(logo, l.host);
      const words = mk('span', 'reply-source-words');
      words.append(t, h);
      a.append(logo, words);
      const cite = mk('button', 'cite-btn', 'Cite');
      cite.type = 'button';
      cite.setAttribute('aria-label', 'Cite ' + l.title);
      cite.addEventListener('click', () => toggleCite(li, cite, { url: l.url }));
      li.append(a, cite);
      list.appendChild(li);
    }
    // Never imply sources were consulted when none were available.
    if (links.length) {
      const credit = mk('li', 'reply-sources-credit', 'Logos and names belong to their sites and are shown to credit each source.');
      list.appendChild(credit);
    } else {
      list.appendChild(mk('li', 'reply-sources-empty', 'No external sources were consulted for this reply.'));
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'act sources-toggle';
    b.dataset.kind = 'sources';
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', list.id);
    b.setAttribute('aria-label', `Show sources and resources (${links.length})`);
    // Overlapping round badges, one per site (its first letter; no outside
    // images, so the strict CSP holds), then the word Sources.
    const faces = mk('span', 'src-faces');
    faces.setAttribute('aria-hidden', 'true');
    const hosts = [...new Set(links.map((l) => l.host))].slice(0, 3);
    hosts.forEach((h, i) => {
      const f = mk('span', 'src-face', (h.replace(/^(?:www|m|en)\./, '')[0] || '?').toUpperCase());
      f.dataset.n = String(i);
      siteLogo(f, h);
      faces.appendChild(f);
    });
    b.title = 'Sources & Resources';
    const word = document.createElement('span');
    word.className = 'src-word';
    for (const letter of 'Sources') {
      const character = document.createElement('span');
      character.className = 'src-letter';
      character.textContent = letter;
      word.appendChild(character);
    }
    b.append(faces, word);
    b.addEventListener('click', () => {
      b.classList.remove('source-wave');
      void b.offsetWidth;
      b.classList.add('source-wave');
      const open = list.hidden;
      list.hidden = !open;
      heading.hidden = !open;
      b.setAttribute('aria-expanded', String(open));
      b.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} sources and resources (${links.length})`);
    });
    row.appendChild(b);
    row.after(heading, list);
  }

  function replyActions(text, id, full = text, responseMetadata = null) {
    const row = document.createElement('div');
    row.className = 'reply-actions';
    if (canSpeakAnything()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'act listen';
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', 'Play reply aloud');
      b.title = 'Play';
      b.append(svgIcon(ICON_PLAY, true));
      b.addEventListener('click', () => {
        // Tapping again (while loading or reading) stops; no second request.
        if (playing && playing.button === b) { stopSpeaking(); return; }
        stopSpeaking();
        readReply(text, id, b);
      });
      row.appendChild(b);
    }
    const plainText = window.NasrinFormat.plain(full);   // copies keep the sources
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

    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'act reply-details-toggle';
    details.setAttribute('aria-label', 'Show reply details');
    details.setAttribute('aria-expanded', 'false');
    details.title = 'Reply details';
    details.append(...[0, 1, 2].map((index) => {
      const dot = document.createElement('span');
      dot.className = 'reply-details-dot';
      dot.dataset.n = String(index);
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '•';
      return dot;
    }));
    const replayWave = (button, className) => {
      button.classList.remove(className);
      void button.offsetWidth;
      button.classList.add(className);
    };
    details.addEventListener('animationend', (event) => {
      if (event.target?.dataset?.n === '2') details.classList.remove('reply-details-wave');
    });
    const panel = document.createElement('div');
    panel.className = 'reply-details-panel';
    panel.hidden = true;
    const makeDetailIcon = (kind) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '14');
      svg.setAttribute('height', '14');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      svg.classList.add('reply-detail-icon', 'reply-detail-icon-' + kind);
      const paths = {
        calendar: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
        duration: 'M12 7v5l3 2 M21 12a9 9 0 1 1-2.64-6.36 M21 3v6h-6',
        tokens: 'M12 3 20 7.5 12 12 4 7.5 12 3Z M4 12l8 4.5 8-4.5 M4 16.5 12 21l8-4.5'
      };
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', paths[kind] || paths.tokens);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.7');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(path);
      return svg;
    };
    const addDetailIcon = (label, kind) => {
      label.classList.add('reply-detail-label-row');
      label.prepend(makeDetailIcon(kind));
    };
    const created = responseMetadata?.timestamp ? new Date(responseMetadata.timestamp) : new Date();
    const date = document.createElement('time');
    date.dateTime = created.toISOString();
    date.textContent = created.toLocaleString();
    const dateLabel = document.createElement('div');
    dateLabel.className = 'reply-detail-label';
    dateLabel.textContent = 'Date & time';
    addDetailIcon(dateLabel, 'calendar');
    const durationLabel = document.createElement('div');
    durationLabel.className = 'reply-detail-label reply-detail-spaced';
    durationLabel.textContent = 'Time to complete';
    addDetailIcon(durationLabel, 'duration');
    const duration = document.createElement('div');
    const elapsedMs = Number(responseMetadata?.duration_ms);
    duration.textContent = Number.isFinite(elapsedMs) && elapsedMs >= 0
      ? (responseMetadata?.duration_estimated ? '≈ ' : '') + (elapsedMs >= 60000 ? (elapsedMs / 60000).toFixed(1) + ' min' : (elapsedMs / 1000).toFixed(1) + ' sec')
      : 'Not reported';
    if (responseMetadata?.duration_estimated) durationLabel.title = 'Approximate elapsed time between the saved user message and assistant reply; exact generation latency was not persisted.';
    const inputLabel = document.createElement('div');
    inputLabel.className = 'reply-detail-label reply-detail-spaced';
    inputLabel.textContent = 'Input tokens';
    addDetailIcon(inputLabel, 'tokens');
    const inputTokens = document.createElement('div');
    inputTokens.textContent = Number.isFinite(responseMetadata?.usage?.input_tokens)
      ? (responseMetadata.usage.estimated ? '≈ ' : '') + responseMetadata.usage.input_tokens.toLocaleString() + (responseMetadata.usage.estimated ? ' estimated' : '')
      : 'Not reported';
    if (responseMetadata?.usage?.estimated) inputLabel.title = 'Text-length estimate; original provider token usage was not saved for this historical reply.';
    const outputLabel = document.createElement('div');
    outputLabel.className = 'reply-detail-label reply-detail-spaced';
    outputLabel.textContent = 'Output tokens';
    addDetailIcon(outputLabel, 'tokens');
    const outputTokens = document.createElement('div');
    outputTokens.textContent = Number.isFinite(responseMetadata?.usage?.output_tokens)
      ? (responseMetadata.usage.estimated ? '≈ ' : '') + responseMetadata.usage.output_tokens.toLocaleString() + (responseMetadata.usage.estimated ? ' estimated' : '')
      : 'Not reported';
    if (responseMetadata?.usage?.estimated) outputLabel.title = 'Text-length estimate; original provider token usage was not saved for this historical reply.';
    const totalLabel = document.createElement('div');
    totalLabel.className = 'reply-detail-label reply-detail-spaced';
    totalLabel.textContent = 'Total tokens';
    addDetailIcon(totalLabel, 'tokens');
    const totalTokens = document.createElement('div');
    totalTokens.textContent = Number.isFinite(responseMetadata?.usage?.input_tokens) && Number.isFinite(responseMetadata?.usage?.output_tokens)
      ? (responseMetadata.usage.estimated ? '≈ ' : '') + (responseMetadata.usage.input_tokens + responseMetadata.usage.output_tokens).toLocaleString() + (responseMetadata.usage.estimated ? ' estimated' : '')
      : 'Not reported';
    if (responseMetadata?.usage?.estimated) totalLabel.title = 'Text-length estimate; original provider token usage was not saved for this historical reply.';
    panel.append(dateLabel, date, durationLabel, duration, inputLabel, inputTokens, outputLabel, outputTokens, totalLabel, totalTokens);
    details.setAttribute('aria-controls', 'reply-details-' + id);
    panel.id = 'reply-details-' + id;
    const closePanel = () => {
      panel.hidden = true;
      details.setAttribute('aria-expanded', 'false');
      // While open, the panel is portalled to body to escape ancestor
      // stacking contexts. Restore it to its reply row when dismissed.
      if (panel.parentElement === document.body) row.appendChild(panel);
    };
    const positionPanel = () => {
      if (panel.hidden) return;
      const trigger = details.getBoundingClientRect();
      if (trigger.bottom < 0 || trigger.top > window.innerHeight) { closePanel(); return; }
      const dockEl = document.querySelector('.dock');
      const dockRect = dockEl ? dockEl.getBoundingClientRect() : null;
      const edge = 12, gap = 8, width = Math.min(248, window.innerWidth - 40);
      panel.style.position = 'fixed';
      panel.style.width = width + 'px';
      panel.style.maxWidth = 'calc(100vw - 40px)';
      panel.style.maxHeight = 'min(55vh, 22rem)';
      const left = Math.max(20, Math.min(trigger.left + trigger.width / 2 - width / 2, window.innerWidth - width - 20));
      const naturalHeight = Math.min(panel.scrollHeight || 240, window.innerHeight * 0.55, 352);
      const composerTop = dockRect && dockRect.height > 0 ? dockRect.top - 12 : window.innerHeight - 180;
      const belowSpace = Math.max(0, Math.min(window.innerHeight - trigger.bottom - gap - edge, composerTop - trigger.bottom - gap));
      const aboveSpace = Math.max(0, trigger.top - gap - edge);
      const placeBelow = naturalHeight <= belowSpace || (belowSpace >= 150 && belowSpace >= aboveSpace);
      const height = Math.max(96, Math.min(naturalHeight, placeBelow ? belowSpace : aboveSpace));
      panel.style.left = left + 'px';
      panel.style.top = Math.max(edge, placeBelow ? trigger.bottom + gap : trigger.top - gap - height) + 'px';
      panel.style.maxHeight = height + 'px';
    };
    details.addEventListener('click', (event) => {
      event.stopPropagation();
      const opening = panel.hidden;
      document.querySelectorAll('.reply-details-panel').forEach((other) => {
        if (other !== panel) {
          other.hidden = true;
          const otherButton = document.querySelector('[aria-controls="' + other.id + '"]');
          if (otherButton) {
            otherButton.setAttribute('aria-expanded', 'false');
            if (other.parentElement === document.body) otherButton.parentElement.appendChild(other);
          }
        }
      });
      replayWave(details, 'reply-details-wave');
      if (!opening) { closePanel(); return; }
      // A body-level layer prevents transformed reply containers and new
      // messages from trapping the panel underneath conversation content.
      if (panel.parentElement !== document.body) document.body.appendChild(panel);
      panel.hidden = false;
      details.setAttribute('aria-expanded', 'true');
      positionPanel();
    });
    const onScroll = () => positionPanel();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('pointerdown', (event) => {
      if (!panel.hidden && !panel.contains(event.target) && !details.contains(event.target)) closePanel();
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !panel.hidden) { closePanel(); details.focus(); }
    });
    document.addEventListener('input', (event) => {
      if (!panel.hidden && event.target instanceof HTMLElement &&
          event.target.matches('input, textarea, [contenteditable="true"]')) closePanel();
    }, true);
    row.appendChild(details);
    row.appendChild(panel);

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
          await api('/v1/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'reply', title: first.length > 60 ? first.slice(0, 59) + '…' : first, text: full }) });
          flashDone(keep, 'Saved to Library');
          notice.textContent = 'Saved to your Library.';
        } catch (err) {
          notice.textContent = err.message || 'That reply could not be saved.';
        } finally { keep.disabled = false; }
      });
      row.insertBefore(keep, details);
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

  const PALETTES = ['orange', 'charcoal', 'galaxy', 'rose-quartz', 'ocean', 'forest', 'sunset', 'midnight'];   // Mono is the default: no attribute
  function paintThemeColor() {
    // The phone's status bar follows the page: the default Mono colours, or the
    // chosen theme's paper colour.
    const t = document.documentElement.getAttribute('data-theme') || 'system';
    const themed = document.documentElement.hasAttribute('data-palette');
    const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    themeMetas.forEach((m) => { m.content = themed && paper ? paper : t === 'system' ? m.dataset.original : THEME_COLORS[t]; });
  }
  function applyTheme(choice) {
    const t = choice === 'light' || choice === 'dark' ? choice : 'system';
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    paintThemeColor();
    for (const r of document.querySelectorAll('input[name="theme"]')) r.checked = r.value === t;
  }
  function applyPalette(choice) {
    const c = PALETTES.includes(choice) ? choice : 'mono';
    if (c === 'mono') document.documentElement.removeAttribute('data-palette');
    else document.documentElement.setAttribute('data-palette', c);
    paintThemeColor();
    for (const r of document.querySelectorAll('input[name="palette"]')) r.checked = r.value === c;
  }
  applyPalette(saved.get(KEYS.palette));
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paintThemeColor);
  for (const r of document.querySelectorAll('input[name="palette"]')) {
    r.addEventListener('change', () => {
      saved.set(KEYS.palette, r.value);
      applyPalette(r.value);
      Nasrin.blink(true);
    });
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
    const lang = languageBase();
    const all = window.speechSynthesis.getVoices();
    const mine = all.filter((v) => v.lang.toLowerCase().startsWith(lang));
    const english = lang === 'en' ? [] : all.filter((v) => v.lang.toLowerCase().startsWith('en'));
    const seen = new Set();
    return mine.concat(english).filter((v) => !seen.has(v.voiceURI) && seen.add(v.voiceURI)).slice(0, 6);
  }

  function voiceRow(value, name, preview, { disabled = false, provider = '' } = {}) {
    const row = document.createElement('div'); row.className = 'voice' + (disabled ? ' is-unavailable' : '');
    const label = document.createElement('label');
    const radio = document.createElement('input'); radio.type='radio'; radio.name='voice'; radio.value=value; radio.checked=currentVoice()===value; radio.disabled=disabled;
    const text=document.createElement('span'); text.className='voice-name'; text.textContent=name; label.append(radio,text);
    const selected=document.createElement('span'); selected.className='voice-selected'; selected.textContent=disabled?'Unavailable':'Selected'; selected.hidden=disabled||currentVoice()!==value;
    radio.addEventListener('change',()=>{voiceChoice=value;saved.set(KEYS.voice,value);renderVoices();});
    const play=document.createElement('button'); play.type='button'; play.className='play'; play.disabled=disabled; play.setAttribute('aria-label','Preview '+name+(provider?' — '+provider:'')); play.setAttribute('aria-pressed','false');
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'); icon.setAttribute('viewBox','0 0 24 24'); icon.setAttribute('aria-hidden','true');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path'); path.setAttribute('d',ICON_PLAY); icon.appendChild(path); play.appendChild(icon);
    play.addEventListener('click',()=>{const mine=playing&&playing.button===play;stopSpeaking();if(!mine&&!disabled)preview(play).catch(()=>{notice.textContent='That voice could not be played right now.';});});
    row.append(label,selected,play); return row;
  }
  function renderVoices() {
    const rows=[]; const heading=(t)=>{const h=document.createElement('h3');h.textContent=t;return h;};
    const providerRows=(provider,label)=>{const list=speech.voices.filter(v=>v.provider===provider);if(!list.length)return;rows.push(heading(label));for(const v of list)rows.push(voiceRow('ai:'+v.id,v.name,b=>playServerAudio({voice:v.id,preview:true},b),{disabled:v.available===false,provider:label}));};
    if(Array.isArray(speech.voices)){providerRows('openai','ChatGPT / OpenAI');providerRows('gemini','Gemini');}
    if(canDevice){rows.push(heading('On this phone'));rows.push(voiceRow('device:default','Phone voice',b=>playDevice(PREVIEW,'device:default',b),{provider:'Device'}));for(const v of deviceVoices())rows.push(voiceRow('device:'+v.voiceURI,v.name,b=>playDevice(PREVIEW,'device:'+v.voiceURI,b),{provider:'Device'}));}
    if(!rows.length){const p=document.createElement('p');p.className='empty';p.textContent='No speech voices are available in this browser.';rows.push(p);}
    voicesBox.replaceChildren(...rows);
  }
  if(canDevice&&'onvoiceschanged' in window.speechSynthesis)window.speechSynthesis.addEventListener('voiceschanged',()=>{if(!sheet.hidden)renderVoices();});
  let lastFocus = null;
  // Settings is a menu: rows open their own page; Back returns to the menu.
  const PAGES = { main: ['pageMain', 'Settings'], account: ['pageAccount', 'Signed in account'], space: ['pageSpace', 'NasrinAI Space'],
    general: ['pageGeneral', 'Preferences'], team: ['pageTeam', 'Team'], voice: ['pageVoice', 'Voice'], language: ['pageLanguage', 'Language'],
    memory: ['pageMemory', 'What Nasrin remembers'], data: ['pageData', 'Data controls'], about: ['pageAbout', 'About'],
    security: ['pageSecurity', 'Security & Devices'], privacy: ['pagePrivacy', 'Data Privacy & Permissions'], retention: ['pageRetention', 'Data Retention'],
    usage: ['pageUsage', 'Usage'], billing: ['pageBilling', 'Billing'], notices: ['pageNotices', 'Notifications'],
    helpSupport: ['pageHelpSupport', 'Help & Support'],
    connect: ['pageConnect', 'NasrinAI Connect'], connectConfig: ['pageConnectConfig', 'Configure SmartChat'], connectPreview: ['pageConnectPreview', 'Preview SmartChat'] };
  const BACK_TO = { account: 'main', space: 'main', connectConfig: 'connect', connectPreview: 'connectConfig' };
  function showPage(name) {
    for (const [key, [id]] of Object.entries(PAGES)) $(id).hidden = key !== name;
    $('settingsTitle').textContent = PAGES[name][1];
    $('settingsBack').hidden = name === 'main';
    if (name === 'voice') renderVoices();
    if (name === 'language') renderLanguageOptions();
    if (name === 'memory') loadMemories();
    if (name === 'privacy' || name === 'memory') loadPrivacy();
    if (name === 'retention') loadRetention();
    if (name === 'usage') loadUsage();
    if (name === 'billing') loadBilling();
    if (name === 'notices') loadNoticeChoices();
    for (const id of ['dataStatus', 'securityStatus', 'privacyStatus', 'noticesStatus']) $(id).textContent = '';
    const activePage = $(PAGES[name][0]);
    if (activePage) activePage.scrollTop = 0;
    if (name === 'helpSupport') loadSupportFaq();
    (name === 'main' ? $('settingsClose') : $('settingsBack')).focus();
  }
  // The Help & Support page is backed by a real Markdown document so the FAQ
  // can be updated as documentation without changing the settings markup.
  async function loadSupportFaq() {
    const box = $('supportFaq');
    if (!box || !window.NasrinFormat) return;
    box.replaceChildren();
    try {
      const resp = await net('/faq.md');
      if (!resp.ok) throw new Error();
      const text = await resp.text();
      box.appendChild(window.NasrinFormat.render(text).node);
    } catch {
      const p = document.createElement('p');
      p.className = 'setting-hint';
      p.textContent = 'The FAQ could not be loaded right now. Please try again later.';
      box.appendChild(p);
    }
  }

  // Google Team contacts are local to the signed-in account and never grant access automatically.
  const googleTeamStorageKey = () => identityKey('nasrin.google-team.v1');
  let googleTeamContacts = [];
  function readGoogleTeam() {
    try {
      const value = JSON.parse(localStorage.getItem(googleTeamStorageKey()) || '[]');
      googleTeamContacts = Array.isArray(value) ? value.filter((x) =>
        x && typeof x.id === 'string' && typeof x.email === 'string' &&
        /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(x.email) && ['to','cc','bcc'].includes(x.role)
      ) : [];
    } catch { googleTeamContacts = []; }
  }
  function saveGoogleTeam() {
    try { localStorage.setItem(googleTeamStorageKey(), JSON.stringify(googleTeamContacts)); return true; }
    catch { const status = $('googleTeamStatus'); if (status) status.textContent = 'Could not save contacts in this browser. Check available storage and try again.'; return false; }
  }
  function renderGoogleTeam() {
    const list = $('googleTeamList');
    if (!list) return;
    list.replaceChildren();
    if (!googleTeamContacts.length) { list.appendChild(mk('p', 'setting-hint', 'No team members yet. Add an email address above.')); return; }
    for (const contact of googleTeamContacts) {
      const item = mk('div', 'setting-row google-team-member');
      const details = mk('div', 'google-team-details');
      details.append(mk('strong', 'google-team-name', contact.name || contact.email));
      if (contact.name) details.appendChild(mk('span', 'setting-hint', contact.email));
      const controls = mk('div', 'google-team-controls');
      const role = document.createElement('select');
      role.setAttribute('aria-label', 'Default email role for ' + contact.email);
      for (const [value, label] of [['to','To'],['cc','CC'],['bcc','BCC']]) {
        const option = document.createElement('option'); option.value = value; option.textContent = label; role.appendChild(option);
      }
      role.value = contact.role;
      role.addEventListener('change', () => { contact.role = role.value; if (saveGoogleTeam()) $('googleTeamStatus').textContent = 'Saved role for ' + contact.email + '.'; });
      const remove = mk('button', 'btn small outline', 'Remove'); remove.type = 'button';
      remove.addEventListener('click', () => { googleTeamContacts = googleTeamContacts.filter((x) => x.id !== contact.id); if (saveGoogleTeam()) { renderGoogleTeam(); $('googleTeamStatus').textContent = 'Removed ' + contact.email + '.'; } });
      controls.append(role, remove); item.append(details, controls); list.appendChild(item);
    }
  }
  function initGoogleTeamSettings() {
    readGoogleTeam(); renderGoogleTeam();
    $('googleTeamForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const name = $('googleTeamName').value.trim(), email = $('googleTeamEmail').value.trim().toLowerCase(), role = $('googleTeamRole').value, status = $('googleTeamStatus');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = 'Enter a valid email address.'; $('googleTeamEmail').focus(); return; }
      const existing = googleTeamContacts.find((x) => x.email.toLowerCase() === email);
      if (existing) { existing.name = name || existing.name || ''; existing.role = role; status.textContent = 'Updated ' + email + '.'; }
      else { googleTeamContacts.push({ id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)), name, email, role }); status.textContent = 'Added ' + email + '.'; }
      if (saveGoogleTeam()) { $('googleTeamName').value = ''; $('googleTeamEmail').value = ''; $('googleTeamRole').value = 'to'; renderGoogleTeam(); }
    });
    $('googleTeamClear')?.addEventListener('click', () => {
      if (!googleTeamContacts.length) { $('googleTeamStatus').textContent = 'There are no team members to remove.'; return; }
      googleTeamContacts = []; if (saveGoogleTeam()) { renderGoogleTeam(); $('googleTeamStatus').textContent = 'All team members removed.'; }
    });
  }
  // Defer rendering until the full IIFE has initialized helpers such as mk().
  queueMicrotask(initGoogleTeamSettings);

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
  headerSignIn.addEventListener('click', () => openSignIn());
  settingsBtn.addEventListener('click', () => (sheet.hidden ? openSettings() : closeSettings()));

  // Canonical FAQ deep link: open the same in-app Help & Support page used by
  // Settings, instead of exposing the raw Markdown source as a public link.
  // Defer until the page has fully initialized so account/settings state exists.
  window.addEventListener('load', () => {
    const params = new URLSearchParams(location.search);
    if (params.get('faq') !== '1') return;
    params.delete('faq');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    openSettings();
    showPage('helpSupport');
  }, { once: true });
  $('settingsClose').addEventListener('click', closeSettings);
  scrim.addEventListener('click', () => { closeSettings(); closeSignIn(); closePlans(); closeHistory(); closePro(); closeReceipt(); closeCodePicker(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeVoice(); closeSettings(); closeSignIn(); closePlans(); closeHistory(); closePro(); closeReceipt(); closeMenu(true); } });

  // ---------- account and sign-in ----------

  const accountBox = $('account');
  const accountLabel = $('accountLabel');
  const accountHint = $('accountHint');
  const accountBtn = $('accountBtn');
  const accountOpen = $('accountOpen');
  const accountDetailEmail = $('accountDetailEmail');
  const accountSwitchMenu = $('accountSwitchMenu');
  const accountAddBtn = $('accountAddBtn');
  const openNasrinSpace = $('openNasrinSpace');
  const spaceConnect = $('spaceConnect');
  const spaceLibrary = $('spaceLibrary');
  const spaceCoding = $('spaceCoding');
  const spaceProjects = $('spaceProjects');
  const spaceCloud = $('spaceCloud');
  const spaceStudio = $('spaceStudio');
  const spaceFinance = $('spaceFinance');
  const spaceNcc = $('spaceNcc');
  const signinSheet = $('signin');
  const emailForm = $('emailForm');
  const codeForm = $('codeForm');
  const emailInput = $('email');
  const codeInput = $('code');
  const signinStatus = $('signinStatus');
  let signInMethods = { email: false, google: false };
  let turnstileSiteKey = '';
  let turnstileWidgetId = null;
  let turnstileToken = '';
  let turnstileReady = null;
  let turnstileWaiters = [];   // sign-in taps waiting for the invisible check to finish
  const settleTurnstile = (err) => { const w = turnstileWaiters; turnstileWaiters = []; for (const f of w) f(err); };
  let authMethodsLoaded = false;
  let authMethodsLoading = null;
  let pendingEmail = '';

  async function loadAuthMethods() {
    // /v1/status may load sign-in methods before the sign-in sheet opens.
    // Do not skip Turnstile setup merely because those methods are already cached.
    if (authMethodsLoaded && (!turnstileSiteKey || turnstileWidgetId !== null)) return signInMethods;
    if (!authMethodsLoading) {
      authMethodsLoading = (async () => {
        try {
          const resp = await net('/v1/status');
          if (!resp.ok) throw new Error('status');
          const s = await resp.json();
          turnstileSiteKey = typeof s.turnstile?.site_key === 'string' ? s.turnstile.site_key : '';
          if (turnstileSiteKey) {
            $('turnstileWidget').hidden = false;
            await setupTurnstile();
          }
          if (s.sign_in && typeof s.sign_in === 'object') {
            signInMethods = {
              email: s.sign_in.email === true,
              google: s.sign_in.google === true
            };
          } else {
            signInMethods = { email: false, google: false };
          }
          authMethodsLoaded = true;
          renderAccount();
          return signInMethods;
        } catch {
          return signInMethods;
        } finally {
          authMethodsLoading = null;
        }
      })();
    }
    return authMethodsLoading;
  }

  async function setupTurnstile() {
    if (!turnstileSiteKey) return;
    if (!turnstileReady) {
      turnstileReady = new Promise((resolve, reject) => {
        if (window.turnstile) { resolve(); return; }
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Security check could not load. Please refresh and try again.'));
        document.head.append(script);
      });
    }
    await turnstileReady;
    if (turnstileWidgetId === null) {
      turnstileWidgetId = window.turnstile.render('#turnstileWidget', {
        sitekey: turnstileSiteKey,
        // Keep the widget out of the way unless Cloudflare actually needs interaction.
        appearance: 'interaction-only',
        callback: (token) => { turnstileToken = token; settleTurnstile(null); },
        'expired-callback': () => { turnstileToken = ''; },
        'error-callback': () => { turnstileToken = ''; settleTurnstile(new Error('The security check could not finish. Please try again.')); }
      });
    }
  }

  // The check runs invisibly and can take a few seconds: a tap waits for it
  // instead of failing with "Complete the security check first".
  async function getCaptchaToken() {
    if (!turnstileSiteKey) return '';
    if (!turnstileToken) {
      await setupTurnstile();
      if (!turnstileToken) {
        signinStatus.textContent = 'Checking your connection is secure…';
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            turnstileWaiters = turnstileWaiters.filter((f) => f !== done);
            reject(new Error('The security check is taking too long. Check your connection and try again.'));
          }, 20000);
          const done = (err) => { clearTimeout(timer); if (err) reject(err); else resolve(); };
          turnstileWaiters.push(done);
        });
      }
    }
    const token = turnstileToken;
    // A Turnstile token is single-use. Consume it here, but don't reset the
    // widget until the protected request finishes; resetting here immediately
    // starts another verification while the current request is still running.
    turnstileToken = '';
    return token;
  }

  function resetCaptchaWidget() {
    turnstileToken = '';
    if (window.turnstile && turnstileWidgetId !== null) window.turnstile.reset(turnstileWidgetId);
  }

  function renderAccount() {
    if (account && account.token) void syncOwnerConsoleEntry(account.token);
    // Until the server has said sign-in is off, keep Sign in on screen: a slow
    // or failed /v1/status must never leave a guest with no way to sign in.
    const can = signInMethods.email || signInMethods.google || !authMethodsLoaded;
    accountBox.hidden = !can && !account;
    accountBox.classList.toggle('is-in', Boolean(account));
    accountLabel.textContent = account ? (account.email || 'Signed in') : 'Not signed in';
    accountHint.textContent = account ? 'Signed in to NasrinAI' : 'Sign in to use Max and Ultra and keep your chats.';
    accountBtn.textContent = 'Sign in';
    accountBtn.hidden = Boolean(account);
    if (accountOpen) accountOpen.hidden = !account;
    if (accountDetailEmail) accountDetailEmail.textContent = account ? (account.email || 'Signed in') : 'Not signed in';
    headerSignIn.hidden = Boolean(account) || !can;
    restorePersistentYouTubePlayer();
  showConnectForSignedIn();
    $('logoutMenu').hidden = !account;
  }

  // A new identity starts a new chat: a guest's conversation is not the account's.
  // Account-local browser state: the conversation pointer is namespaced by account email. Server data remains account-scoped.
  function renderAccountDetail() {
    if (!accountSwitchMenu) return;
    const pageLabel = document.querySelector('#pageAccount .menu-label');
    const detailHint = document.querySelector('#pageAccount .account-detail .setting-hint');
    if (pageLabel) pageLabel.textContent = account ? 'Signed in account' : 'Saved accounts on this device';
    if (detailHint) detailHint.textContent = account
      ? 'Your chats, Library, memory and connected services stay scoped to this account.'
      : 'These accounts remain saved on this device. Choose one to sign in; signing out of another account does not remove these saved sessions.';
    accountSwitchMenu.replaceChildren();
    for (const email of otherAccounts) {
      accountSwitchMenu.appendChild(accountRow('Sign in to ' + email, 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0', () => switchAccount(email)));
    }
    accountSwitchMenu.hidden = !accountSwitchMenu.firstChild;
    accountSwitchMenu.setAttribute('aria-hidden', String(accountSwitchMenu.hidden));
    if (accountAddBtn) accountAddBtn.hidden = !account || otherAccounts.length >= maxAccounts - 1;
    const actions = $('accountActionsMenu');
    if (actions) actions.hidden = !account;
  }

  function openAccountPage() {
    if (!account && !otherAccounts.length) { openSignIn(); return; }
    showPage('account');
    loadAccounts().then(renderAccountDetail);
  }

  if (accountOpen) accountOpen.addEventListener('click', openAccountPage);
  if (openNasrinSpace) openNasrinSpace.addEventListener('click', () => {
    const status = $('spaceStatus');
    if (status) status.textContent = '';
    if (spaceProjects) spaceProjects.hidden = !projectsOn;
    showPage('space');
  });
  if (spaceConnect) spaceConnect.addEventListener('click', () => account ? openConnectPage() : openSignIn('Sign in to use NasrinAI Connect.'));
  if (spaceLibrary) spaceLibrary.addEventListener('click', () => account ? openHistory('library') : openSignIn('Sign in to use your Library.'));
  // Projects: Open, Chat and Code sit under each project's arrow.
  if (spaceProjects) spaceProjects.addEventListener('click', () => account ? openHistory('projects') : openSignIn('Sign in to keep chats, files, tasks and instructions together in projects.'));
  // Coding (Space tile and the "Start coding" starter) opens the coding chat's project picker.
  if (spaceCoding) spaceCoding.addEventListener('click', () => { closeSettings(); openCodePicker(); });
  if (spaceStudio) spaceStudio.addEventListener('click', () => { window.location.assign('/video-studio.html'); });
  if (spaceCloud) spaceCloud.addEventListener('click', () => {
    const status = $('spaceStatus');
    if (status) status.textContent = 'Cloud will appear here when its secure NasrinAI connection is ready.';
  });
  if (spaceFinance) spaceFinance.addEventListener('click', () => {
    const status = $('spaceStatus');
    if (status) status.textContent = 'Movo is planned as a separate financial tracking app.';
  });
  // NCC (Nasrin Client Connect): the enterprise CRM with automations,
  // separate from Connect and not self-serve: businesses contact the team (docs/ncc.md).
  // NCC is its own app (ncc.nasrinai.com). Accounts the team turned on get a
  // link to open it; everyone else is told to contact the team. The server
  // decides (GET /v1/ncc/status).
  if (spaceNcc) spaceNcc.addEventListener('click', async () => {
    const status = $('spaceStatus');
    if (!status) return;
    let open = null;
    if (account) {
      try { open = await api('/v1/ncc/status'); } catch { /* fall through to the enquiry message */ }
    }
    if (open && open.enabled && typeof open.url === 'string' && /^https:\/\/[a-z0-9.-]+$/i.test(open.url)) {
      const link = mk('a', '', 'Open NCC');
      link.href = open.url + '/';
      link.target = '_blank';
      link.rel = 'noopener';
      status.replaceChildren('NCC (Nasrin Client Connect) is on for your business. ', link, ' (opens in a new tab).');
      return;
    }
    const mail = mk('a', '', 'Contact the NasrinAI team');
    mail.href = 'mailto:support@nasrinai.com?subject=' + encodeURIComponent('NCC (Nasrin Client Connect) enterprise enquiry');
    status.replaceChildren('NCC (Nasrin Client Connect) is the CRM with automations for enterprises, separate from Connect. ', mail, ' to turn it on for your business.');
  });

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
    $('exportData').hidden = !account;
    $('deleteAccount').hidden = !account;
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
  let prefsLoadError = null;
  async function loadPrefs() {
    if (!account) {
      myPrefs = null;
      prefsLoadError = Object.assign(new Error('Sign in to change Memory and privacy settings.'), { code: 'sign_in_required' });
      showMemoryChoice();
      return null;
    }
    try {
      myPrefs = (await api('/v1/settings')).prefs;
      prefsLoadError = null;
    } catch (err) {
      myPrefs = null;
      prefsLoadError = err;
    }
    showMemoryChoice();
    return myPrefs;
  }
  let improvementConsentVersion = null;
  let improvementConsentValue = false;
  async function loadImprovementConsent() {
    const control = $('improvementConsent');
    const status = $('improvementConsentStatus');
    if (!control || !status) return;
    control.disabled = true;
    try {
      const result = await api('/v1/improvement-consent');
      improvementConsentVersion = result.version;
      improvementConsentValue = result.enabled === true;
      control.checked = improvementConsentValue;
      control.disabled = false;
      status.textContent = improvementConsentValue
        ? 'Your optional preference is on. No chat content is currently collected for improvement.'
        : 'Off by default. No chat content is currently collected for improvement.';
    } catch (err) {
      improvementConsentVersion = null;
      improvementConsentValue = false;
      control.checked = false;
      control.disabled = true;
      status.textContent = err && (err.status === 401 || err.status === 403 || err.code === 'session_expired' || err.code === 'sign_in_required')
        ? 'Your sign-in session is unavailable. Please sign in again. This choice stays off.'
        : 'Privacy settings could not be verified. This choice stays off; please try again later.';
    }
  }
  async function setImprovementConsent(enabled) {
    const control = $('improvementConsent');
    const status = $('improvementConsentStatus');
    if (!control || !status || !improvementConsentVersion) {
      if (control) control.checked = false;
      return;
    }
    const previous = improvementConsentValue;
    control.disabled = true;
    status.textContent = 'Saving your choice…';
    try {
      const result = await api('/v1/improvement-consent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, version: improvementConsentVersion })
      });
      improvementConsentValue = result.enabled === true;
      control.checked = improvementConsentValue;
      status.textContent = improvementConsentValue
        ? 'Preference saved. No chat content is currently collected for improvement.'
        : 'Preference saved. Improvement consent is off.';
    } catch (err) {
      improvementConsentValue = previous;
      control.checked = previous;
      status.textContent = err.message || 'Could not save this choice. No content will be collected.';
    } finally {
      control.disabled = false;
    }
  }
  $('improvementConsent')?.addEventListener('change', () => setImprovementConsent($('improvementConsent').checked));

  async function loadPrivacy() {
    for (const [id] of MEMORY_BOXES) $(id).disabled = true;
    await Promise.all([loadImprovementConsent(), loadPrefs()]);
    if (!myPrefs) {
      $('privacyStatus').textContent = prefsLoadError && prefsLoadError.message
        ? prefsLoadError.message
        : 'These settings are not available right now.';
    }
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
  let noticeAutoDismissTimer = null;
  let noticeQueue = [];
  let noticeShown = null;
  let noticeRun = 0;
  const localNotices = () => {
    const v = saved.get(KEYS.notices);
    const seen = v && Array.isArray(v.seen) ? v.seen.filter((x) => typeof x === 'string').slice(-100) : [];
    return { seen, features: !(v && v.features === false), tips: !(v && v.tips === false) };
  };
  const saveLocalNotices = (change) => saved.set(KEYS.notices, { ...localNotices(), ...change });

  // Device notifications are an explicit, device-local opt-in. They are
  // checked while NasrinAI is open; no account data is stored in this setting.
  const DEVICE_NOTICE_INTERVAL = 30000;
  let deviceNoticeTimer = null;
  const deviceNotified = () => {
    const v = saved.get(KEYS.deviceNotified);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(-100) : [];
  };
  const saveDeviceNotified = (ids) => saved.set(KEYS.deviceNotified, ids.slice(-100));

  function deviceRealtimeOn() {
    return saved.get(KEYS.deviceRealtime) === true;
  }

  function stopDeviceNoticePolling() {
    if (deviceNoticeTimer) clearInterval(deviceNoticeTimer);
    deviceNoticeTimer = null;
  }

  async function checkDeviceNotices() {
    if (!deviceRealtimeOn() || !('Notification' in window) || Notification.permission !== 'granted') return;
    let list = [];
    try {
      if (account) list = (await api('/v1/notices/mine?when=open')).notices;
      else {
        const resp = await net('/v1/notices?when=open');
        list = resp.ok ? (await resp.json()).notices : [];
      }
    } catch { return; }
    if (!Array.isArray(list)) return;
    const notified = new Set(deviceNotified());
    const seen = new Set(localNotices().seen);
    for (const n of list) {
      if (!n || typeof n.id !== 'string' || notified.has(n.id) || seen.has(n.id)) continue;
      try {
        const notification = new Notification(n.title || 'NasrinAI', {
          body: n.body || 'You have a new NasrinAI notice.',
          tag: 'nasrinai-' + n.id
        });
        notification.onclick = () => {
          try { window.focus(); notification.close(); } catch { /* browser may block focus */ }
        };
        notified.add(n.id);
      } catch { return; }
    }
    saveDeviceNotified([...notified]);
  }

  function syncDeviceNoticePolling() {
    stopDeviceNoticePolling();
    if (!deviceRealtimeOn()) return;
    checkDeviceNotices();
    deviceNoticeTimer = setInterval(checkDeviceNotices, DEVICE_NOTICE_INTERVAL);
  }

  function deviceNotify(title, body, tag) {
    if (!deviceRealtimeOn() || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, { body, tag: tag || 'nasrinai-work-complete' });
      n.onclick = () => { try { window.focus(); n.close(); } catch {} };
    } catch {}
  }

  function noticeUseful(n) {
    if (localNotices().seen.includes(n.id)) return false;
    // Nothing to offer when Professional AI is missing or already on.
    if (n.action && n.action.target === 'professional' && (!proCatalog || proState.enabled)) return false;
    return true;
  }

  function hideNotice() {
    if (noticeAutoDismissTimer !== null) {
      clearTimeout(noticeAutoDismissTimer);
      noticeAutoDismissTimer = null;
    }
    noticeBox.hidden = true;
    noticeShown = null;
  }

  function isNewUserNotice(n) {
    if (!n) return false;
    const identity = [n.id, n.title, n.body].filter(Boolean).join(' ').toLowerCase();
    return /new[-_ ]user|welcome|getting started|first[-_ ]time/.test(identity);
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

    // Brief in-app notices auto-dismiss after three seconds. Keep the
    // new-user welcome notice visible until the user closes it explicitly.
    if (!isNewUserNotice(n)) {
      noticeAutoDismissTimer = setTimeout(() => {
        noticeAutoDismissTimer = null;
        if (noticeShown !== n) return;
        dismissNotice(n);
        renderNotice();
      }, 3000);
    }
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
      if (target === 'privacy') showPage('privacy');
      else if (target === 'security') showPage('security');
    }
  });

  // Settings > Notifications.
  const NOTICE_BOXES = [['noticeFeatures', 'features'], ['noticeTips', 'tips']];
  async function loadNoticeChoices() {
    const deviceBox = $('noticeDeviceRealtime');
    const deviceSupported = 'Notification' in window;
    const permission = deviceSupported ? Notification.permission : 'unsupported';
    const enabled = deviceRealtimeOn() && permission === 'granted';
    deviceBox.checked = enabled;
    deviceBox.disabled = false;
    if (deviceRealtimeOn() && permission !== 'granted') saved.set(KEYS.deviceRealtime, false);
    if (!deviceSupported) $('noticesStatus').textContent = 'Device notifications are not supported by this browser.';
    else if (permission === 'denied') $('noticesStatus').textContent = 'Device notifications are blocked. Enable them in your browser or device settings.';
    else if (enabled) $('noticesStatus').textContent = 'Device notifications are on.';
    syncDeviceNoticePolling();

    let choice = localNotices();
    if (account) {
      for (const [id] of NOTICE_BOXES) $(id).disabled = true;
      const prefs = await loadPrefs();
      if (!prefs || !prefs.notices) {
        $('noticesStatus').textContent = deviceSupported
          ? 'Your in-app notification settings are not available right now.'
          : 'Device notifications are not supported by this browser.';
        return;
      }
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

  $('noticeDeviceRealtime').addEventListener('change', async () => {
    const box = $('noticeDeviceRealtime');
    if (!box.checked) {
      saved.set(KEYS.deviceRealtime, false);
      stopDeviceNoticePolling();
      $('noticesStatus').textContent = 'Device notifications are off.';
      return;
    }
    if (!('Notification' in window)) {
      box.checked = false;
      saved.set(KEYS.deviceRealtime, false);
      $('noticesStatus').textContent = 'Device notifications are not supported by this browser.';
      return;
    }
    let permission = Notification.permission;
    if (permission === 'default') {
      try { permission = await Notification.requestPermission(); } catch { permission = 'denied'; }
    }
    if (permission !== 'granted') {
      box.checked = false;
      saved.set(KEYS.deviceRealtime, false);
      $('noticesStatus').textContent = permission === 'denied'
        ? 'Device notifications are blocked. Enable them in your browser or device settings.'
        : 'Device notifications could not be enabled.';
      return;
    }
    saved.set(KEYS.deviceRealtime, true);
    $('noticesStatus').textContent = 'Device notifications are on.';
    syncDeviceNoticePolling();
  });

  // Resume an explicitly enabled device notification preference on app load.
  syncDeviceNoticePolling();

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
  function meter(label, used, limit) {
    const row = mk('div', 'usage-item menu-card');
    const top = mk('div', 'usage-top');
    top.append(mk('span', 'usage-label', label), mk('span', 'usage-value', limit ? `${Math.round((used / limit) * 100)}% used` : ''));
    const bar = mk('div', 'usage-bar');
    const fill = mk('span', 'usage-fill');
    const targetWidth = (limit ? Math.min(100, (used / limit) * 100) : 0) + '%';
    fill.style.width = '0%';
    fill.style.transition = 'width 850ms cubic-bezier(.2,.8,.2,1)';
    window.requestAnimationFrame(() => { fill.style.width = targetWidth; });
    bar.appendChild(fill);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', label);
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(limit));
    bar.setAttribute('aria-valuenow', String(Math.min(used, limit)));
    row.append(top, bar);
    return row;
  }
  async function loadUsage() {
    const list = $('usageList');
    const status = $('usageStatus');
    if (!list || !status) return;
    const loading = $('usageLoading');
    if (loading) loading.hidden = false;
    list.setAttribute('aria-busy', 'true');
    status.textContent = '';
    try {
      const u = await api('/v1/usage');
      const next = document.createDocumentFragment();
      if (u.chat?.period === 'unlimited') {
        const card = mk('div', 'menu-card usage-unlimited');
        card.append(mk('p', 'card-title', 'Unlimited Quick chat'), mk('p', 'setting-hint', 'Chat continues on Quick. Paid-model access returns when your weekly allowance resets.'));
        next.appendChild(card);
      } else if (u.chat) {
        next.appendChild(meter(u.chat.period === 'week' ? 'Weekly token usage' : 'Chat today', u.chat.used, u.chat.limit));
        if (u.chat.exhausted) {
          const fallback = mk('div', 'menu-card usage-fallback');
          fallback.append(mk('p', 'card-title', 'Continuing on Quick'), mk('p', 'setting-hint', 'Your paid-model allowance is used. Chat remains available on Quick until the weekly reset.'));
          next.appendChild(fallback);
        }
      }
      if (u.pictures) {
        const left = Math.max(0, u.pictures.limit - u.pictures.used);
        const per = u.pictures.period === 'day' ? 'today' : 'in this guest session';
        next.appendChild(meter(`Pictures ${per}`, u.pictures.used, u.pictures.limit));
      }
      list.replaceChildren(next);
      $('usageNote').textContent = '';
      status.textContent = '';
    } catch (err) {
      status.textContent = err.message || 'Usage could not be updated.';
    } finally {
      if (loading) loading.hidden = true;
      list.setAttribute('aria-busy', 'false');
    }
  }
  // Keep the usage display current while the billing sheet is open; the server
  // remains authoritative and no page refresh is required.
  if (!window.__nasrinUsageRefresh) {
    window.__nasrinUsageRefresh = window.setInterval(() => {
      const page = $('pageBilling');
      const usagePage = $('pageUsage');
      if (usagePage && !usagePage.hidden && !document.hidden) loadUsage();
    }, 15000);
  }

  const receiptSheet = $('receiptSheet');
  const receiptBody = $('receiptBody');

  function closeReceipt() {
    if (receiptSheet.hidden) return;
    receiptSheet.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  async function openReceipt(id) {
    if (!id) return;
    receiptBody.replaceChildren(mk('p', 'setting-hint', 'Loading receipt…'));
    receiptSheet.hidden = false;
    try {
      const r = await api('/v1/billing/receipts/' + encodeURIComponent(id));
      const name = ({ max: 'Max', ultra: 'Ultra' }[r.plan] || r.plan || 'Plan');
      const row = (label, value, extra = '') => {
        const el = mk('div', 'receipt-row' + extra);
        el.append(mk('span', 'receipt-label', label), mk('span', 'receipt-value', value));
        return el;
      };
      const amount = Number.isFinite(Number(r.amount))
        ? (r.currency === 'PHP' ? '₱' : (r.currency || '') + ' ') + Number(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : '—';
      receiptBody.replaceChildren(
        row('Receipt number', r.receipt_number || '—'),
        row('Plan', name),
        row('Paid', fmtDate(r.paid_at)),
        row('Coverage', fmtDate(r.starts_at) + ' – ' + fmtDate(r.ends_at)),
        row('Payment method', r.via || '—'),
        row('Reference', r.provider_reference || '—'),
        row('Total', amount, ' receipt-total')
      );
      receiptBody.appendChild(mk('p', 'setting-hint', 'This receipt is available from your NasrinAI billing history while the payment record is retained.'));
    } catch (err) {
      receiptBody.replaceChildren(mk('p', 'setting-hint', err.message || 'This receipt could not be opened.'));
    }
  }

  // Billing: the plan and this account's own payments (no card details exist here).
  async function loadBilling() {
    const cur = $('billingCurrent');
    const hist = $('billingHistory');
    // Billing belongs to an account: signed out, offer Sign in instead of asking
    // the server (which refuses) and showing an empty Payments box.
    $('billingPaymentsLabel').hidden = hist.hidden = !account;
    hist.replaceChildren();
    if (!account) {
      const go = mk('button', 'btn small', 'Sign in');
      go.type = 'button';
      go.addEventListener('click', () => { closeSettings(); openSignIn(); });
      cur.replaceChildren(mk('p', 'card-title', 'Sign in to see your plan and payments'), mk('p', 'setting-hint', 'Plans and receipts are kept with your account.'), go);
      return;
    }
    cur.replaceChildren(mk('p', 'setting-hint', 'Loading…'));
    try {
      const b = await api('/v1/billing');
      const name = (id) => ({ free: 'Free', max: 'Max', ultra: 'Ultra' }[id] || 'Free');
      const active = b.plan && b.plan.id !== 'free';
      cur.replaceChildren(
        mk('p', 'card-title', `Your current plan: ${name(b.plan && b.plan.id)}`),
        mk('p', 'setting-hint', active ? `Active until ${fmtDate(b.plan.ends_at)}.` : 'Quick is free. Paid plans unlock higher-tier models.')
      );
      if (!b.payments.length) { hist.appendChild(mk('p', 'setting-hint', 'No payments yet.')); return; }
      for (const p of b.payments) {
        const row = mk('div', 'pay-row');
        const money = p.amount !== null ? `${p.currency === 'PHP' ? '₱' : (p.currency || '') + ' '}${p.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
        const info = mk('div', 'pay-info');
        info.append(mk('span', 'pay-what', name(p.plan) + ' plan' + (p.term === 'annual' ? ' · annual' : '')),
          mk('span', 'pay-amount', money),
          mk('span', 'setting-hint', fmtDate(p.starts_at) + ' – ' + fmtDate(p.ends_at) + ' · paid ' + fmtDate(p.paid_at) + (p.via ? ' via ' + p.via : '')));
        row.appendChild(info);
        if (p.receipt_available && p.id) {
          const receipt = mk('button', 'text-btn pay-receipt', 'View receipt');
          receipt.type = 'button';
          receipt.addEventListener('click', () => openReceipt(p.id));
          row.appendChild(receipt);
        }
        hist.appendChild(row);
      }
    } catch (err) {
      cur.replaceChildren(mk('p', 'setting-hint', err.message));
    }
  }
  $('billingPlans').addEventListener('click', () => openPlans());
  $('receiptClose').addEventListener('click', closeReceipt);

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
        li.className = 'history-item' + (['file', 'note', 'reply'].includes(f.kind) ? ' lib-document-item' : '');
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
    sessionReauthPrompted = false;
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
    ownerBootstrapToken = '';
    ownerBootstrapAt = 0;
    saved.del(KEYS.account);
    $('ownerConsoleEntry')?.remove();
    void fetch('/owner/api/session', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store' }).catch(() => {});
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
    if (!signInMethods.email && !signInMethods.google) {
      emailForm.hidden = true;
      codeForm.hidden = true;
    }
  }

  async function openSignIn(message) {
    closeSettings();
    lastFocus = document.activeElement;
    signinStatus.textContent = message || 'Checking sign-in options…';
    scrim.hidden = false;
    signinSheet.hidden = false;

    await loadAuthMethods();

    if (!signInMethods.email && !signInMethods.google) {
      setSigninStep('email');
      signinStatus.textContent = 'Sign-in is temporarily unavailable. Please try again shortly.';
      return;
    }

    setSigninStep('email');
    signinStatus.textContent = message || '';
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
      const captcha_token = await getCaptchaToken();
      await postAuth('/v1/auth/email/start', { email, ...(captcha_token ? { captcha_token } : {}) });
      pendingEmail = email;
      $('codeLabel').textContent = `Enter the code we sent to ${email}`;
      setSigninStep('code');
      signinStatus.textContent = 'Check your inbox (and spam). The code works for a few minutes.';
      codeInput.value = '';
      codeInput.focus();
    } catch (err) {
      signinStatus.textContent = err.message;
    } finally {
      resetCaptchaWidget();
      $('emailBtn').disabled = false;
    }
  });

  $('googleBtn').addEventListener('click', async () => {
    $('googleBtn').disabled = true;
    signinStatus.textContent = 'Starting Google sign-in…';
    try {
      const captcha_token = await getCaptchaToken();
      const result = await postAuth('/v1/auth/google/start', captcha_token ? { captcha_token } : {});
      const target = typeof result.url === 'string' ? new URL(result.url) : null;
      if (!target || target.protocol !== 'https:' || target.pathname !== '/auth/v1/authorize') throw new Error('Google sign-in is temporarily unavailable.');
      window.location.assign(target.href);
    } catch (err) {
      signinStatus.textContent = err.message;
      $('googleBtn').disabled = false;
    } finally {
      resetCaptchaWidget();
    }
  });

  // Back from Google (Safari restores the page from its cache): the button and
  // the single-use security check start fresh.
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    $('googleBtn').disabled = false;
    if (signinStatus.textContent === 'Starting Google sign-in…') signinStatus.textContent = '';
    resetCaptchaWidget();
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

  $('logoutBtn').addEventListener('click', () => {
    if (!account) return;
    if (!window.confirm('Are you sure you want to log out of this NasrinAI account?')) return;
    accountBtn.click();
  });
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

  // Signing out ends only the active account's session. If another account is
  // already signed in on this device, switch to it automatically. Each account
  // retains its own isolated chats, preferences, Library and plan.
  async function afterSignOut() {
    await loadAccounts();
    if (otherAccounts.length) {
      const nextAccount = otherAccounts[0];
      if (await switchAccount(nextAccount)) return;
      // If the saved session expired or switching failed, let the person choose.
      openSettings();
      showPage('account');
      accountHint.textContent = 'The other saved account could not be activated. Choose an account to try again.';
      renderAccountDetail();
      return;
    }
    openSignIn('You are signed out.');
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
    // Account switching is intentionally hidden from the main Settings page.
    // Alternate identities are rendered only inside Signed in account.
    renderAccountDetail();
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
    renderAccountDetail();
  }

  async function addAccount() {
    try {
      await postAuth('/v1/auth/accounts/add', {});
    } catch (err) {
      if (err.code !== 'signed_out') { accountHint.textContent = err.message; return; }
    }
    await loadAccounts();
    openSignIn('Sign in with another account. Your current account stays signed in until the new account is successfully authenticated.');
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

  if (accountAddBtn) accountAddBtn.addEventListener('click', addAccount);

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
  let listeningRequested = false;
  let recognitionFailures = 0;          // errors in a row with no words heard in between
  let recognitionLangFallback = false;  // the chosen language was refused: use the phone's
  let recognitionRestartTimer = null;
  let recognitionRun = 0;
  let voiceMeter = null;
  let composerWave = null;

  // The sound wave in the message box (voice-wave.js). It takes its own row between
  // the text and the buttons, so words never run under it. No second microphone is
  // opened next to SpeechRecognition: the wave estimates your level from the
  // recognizer's own events (see startRecognition).
  if (form) {
    voiceMeter = document.createElement('div');
    voiceMeter.className = 'voice-frequency-wave';
    voiceMeter.setAttribute('aria-hidden', 'true');
    form.insertBefore(voiceMeter, form.querySelector('.tools') || null);
    composerWave = window.NasrinWave ? window.NasrinWave.composer(voiceMeter) : null;
  }

  function setListening(on) {
    listening = on;
    form?.classList.toggle('is-listening', on);
    voiceMeter?.classList.toggle('is-active', on);
    micBtn.setAttribute('aria-pressed', String(on));
    refreshSendButton();   // the icon and name follow: Stop while listening, then Send or Dictate
    if (on) Nasrin.mood('listening');
    else if (Nasrin.current === 'listening') Nasrin.mood('idle');
  }

  function stopDictation() {
    listeningRequested = false;
    recognitionRun++;
    if (recognitionRestartTimer) {
      clearTimeout(recognitionRestartTimer);
      recognitionRestartTimer = null;
    }
    const activeRecognizer = recognizer;
    recognizer = null;
    setListening(false);
    if (activeRecognizer) {
      try { activeRecognizer.stop(); } catch { /* already stopped */ }
    }
  }

  function startRecognition(run, prefix = '') {
    if (!listeningRequested || run !== recognitionRun || !Recognition) return;
    let activeRecognizer;
    try {
      activeRecognizer = new Recognition();
      recognizer = activeRecognizer;
      activeRecognizer.lang = recognitionLangFallback ? (navigator.language || 'en-US') : (languageBase() || navigator.language || 'en-US');
      activeRecognizer.interimResults = true;
      activeRecognizer.continuous = true;
      let sessionTranscript = '';
      let spokenLen = 0;

      activeRecognizer.onspeechstart = () => composerWave?.speechOn(true);
      activeRecognizer.onspeechend = () => composerWave?.speechOn(false);
      activeRecognizer.onresult = (event) => {
        if (!listeningRequested || run !== recognitionRun) return;
        sessionTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          sessionTranscript += event.results[i][0].transcript;
        }
        // The wave grows with how fast your words arrive.
        composerWave?.hear(0.5 + Math.min(0.5, Math.max(0, sessionTranscript.length - spokenLen) / 16));
        spokenLen = sessionTranscript.length;
        recognitionFailures = 0;
        input.value = [prefix, sessionTranscript.trim()].filter(Boolean).join(' ');
        autosize();
        Nasrin.tick();
      };

      activeRecognizer.onerror = (event) => {
        const code = event.error;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          stopDictation();
          notice.textContent = 'Microphone access is blocked. Allow it in your browser settings to talk to Nasrin.';
        } else if (code !== 'no-speech' && code !== 'aborted') {
          // A hiccup is retried quietly (onend starts a fresh session). Only when it keeps
          // failing does dictation stop, with a plain reason, so it never loops or sticks.
          if (code === 'language-not-supported') recognitionLangFallback = true;
          recognitionFailures++;
          if (recognitionFailures >= 3) {
            stopDictation();
            notice.textContent =
              code === 'network' ? 'Voice typing needs an internet connection. Tap the mic to try again.'
              : code === 'audio-capture' ? 'The microphone is busy or unavailable. Close other apps using it, then tap the mic to try again.'
              : code === 'language-not-supported' ? 'Voice typing does not support the chosen language. Pick another in Settings, then tap the mic.'
              : 'Voice typing stopped (' + String(code || 'unknown') + '). Tap the mic to try again.';
          }
        }
      };

      activeRecognizer.onend = () => {
        if (recognizer === activeRecognizer) recognizer = null;
        if (!listeningRequested || run !== recognitionRun) return;

        // Carry the visible transcript into the next recognition session.
        const nextPrefix = input.value.trim();
        if (recognitionRestartTimer) clearTimeout(recognitionRestartTimer);
        recognitionRestartTimer = setTimeout(() => {
          recognitionRestartTimer = null;
          if (listeningRequested && run === recognitionRun && !recognizer) {
            startRecognition(run, nextPrefix);
          }
        }, recognitionFailures ? 700 : 250);
      };

      activeRecognizer.start();
    } catch {
      if (recognizer === activeRecognizer) recognizer = null;
      notice.textContent = 'Voice typing could not start. Check microphone permission and try again.';
      stopDictation();
    }
  }

  if (!Recognition) {
    // The combined composer remains the Send button; speech recognition is unavailable in this browser.
  } else {
    $('voiceBtn').hidden = false;
    $('voiceBtn').addEventListener('click', openVoice);
    micBtn.addEventListener('click', (event) => {
      // While dictation is active, this control always stops it—even after text appears.
      if (listeningRequested) {
        event.preventDefault();
        stopDictation();
        return;
      }
      // Preserve the existing send behavior when dictation is not active.
      if (input.value.trim() || pending.length || turn) return;
      event.preventDefault();
      stopSpeaking();
      notice.textContent = '';
      try { recognizer?.abort(); } catch { /* already stopped */ }   // never start on top of an old session
      recognizer = null;
      recognitionFailures = 0;
      recognitionLangFallback = false;
      listeningRequested = true;
      recognitionRun++;
      setListening(true);
      startRecognition(recognitionRun, input.value.trim());
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
  const voicePlus = $('voicePlus');
  const voicePlusMenu = $('voicePlusMenu');
  const voicePickFiles = $('voicePickFiles');
  const voicePickImage = $('voicePickImage');
  const voiceTier = $('voiceTier');
  const voiceTierMenu = $('voiceTierMenu');
  const voiceTierLabel = $('voiceTierLabel');
  const SILENCE_MS = 800;       // this long after you stop talking, you are done
  const FINAL_SILENCE_MS = 350; // ...or this long once the phone has finalised your words
  const IDLE_MS = 90_000;       // nothing said for this long: the microphone pauses
  const MOODS = { listening: 'listening', thinking: 'thinking', speaking: 'speaking' };

  function closeVoicePopover(menu, button) {
    if (!menu) return;
    menu.hidden = true;
    button?.setAttribute('aria-expanded', 'false');
  }

  function closeVoiceMenus() {
    closeVoicePopover(voicePlusMenu, voicePlus);
    closeVoicePopover(voiceTierMenu, voiceTier);
  }

  function renderVoiceTier() {
    if (!voiceTierMenu || !voiceTierLabel) return;
    const names = { nasrinai: 'Quick', pro: 'Pro', max: 'Max', ultra: 'Ultra' };
    const current = names[currentModel] || 'Quick';
    voiceTierLabel.textContent = current;
    // The same signal bars as the chat's model button: one bar per level.
    const level = Math.max(1, ['nasrinai', 'pro', 'max', 'ultra'].indexOf(currentModel) + 1);
    voiceTier.querySelectorAll('.bars rect').forEach((r, i) => r.classList.toggle('on', i < level));
    voiceTier.setAttribute('aria-label', 'AI tier: ' + current);
    voiceTier.title = 'AI tier: ' + current;
    voiceTierMenu.replaceChildren();
    const descriptions = { nasrinai: 'Fast everyday work', pro: 'Smarter professional work', max: 'Longer, deeper thinking', ultra: 'Deepest reasoning' };
    const quota = planInfo && planInfo.quota;
    if (quota && quota.used >= quota.limit && quota.reset_at) {
      const notice = document.createElement('div');
      notice.className = 'tier-quota-notice';
      const reset = new Date(quota.reset_at);
      notice.textContent = names[quota.plan] + ' allowance used. Quick chat stays unlimited; coding is paused until ' +
        reset.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) + ' Manila time.';
      voiceTierMenu.appendChild(notice);
    }
    for (const id of ['nasrinai', 'pro', 'max', 'ultra']) {
      const button = document.createElement('button');
      button.type = 'button'; button.role = 'menuitem'; button.className = 'voice-tier-option';
      const copy = document.createElement('span'); copy.className = 'tier-copy';
      const name = document.createElement('strong'); name.textContent = names[id];
      const desc = document.createElement('small'); desc.className = 'tier-desc'; desc.textContent = descriptions[id];
      copy.append(name, desc); button.append(copy);
      const model = modelList.find((m) => m.id === id);
      if (!model || model.locked) {
        button.disabled = true;
        button.title = model?.needs === 'sign_in' ? 'Sign in to use this tier' : 'Plan required';
      } else {
        button.addEventListener('click', () => {
          pickModel(model);
          renderVoiceTier();
          closeVoicePopover(voiceTierMenu, voiceTier);
        });
      }
      if (id === currentModel) button.setAttribute('aria-current', 'true');
      voiceTierMenu.appendChild(button);
    }
  }

  function voiceState(state, label) {
    vc.state = state;
    voiceEl.dataset.state = state;
    voiceStatus.textContent = label;
    // The orb stops Nasrin while she talks or thinks.
    voiceSkip.disabled = !(state === 'speaking' || state === 'thinking');
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
    let heardLen = heard.length;
    let done = false;
    let line = null;
    const startedAt = Date.now();
    const rec = new Recognition();
    vc.recognizer = rec;
    rec.lang = languageBase() || navigator.language || 'en-US';
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
      // No second microphone here, so the wave estimates your level from how fast words arrive.
      window.NasrinVoiceWave?.hear(0.5 + Math.min(0.5, Math.max(0, heard.length - heardLen) / 16));
      heardLen = heard.length;
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
    rec.onspeechstart = () => window.NasrinVoiceWave?.speechOn(true);
    rec.onspeechend = () => window.NasrinVoiceWave?.speechOn(false);
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

  function scheduleRealtimeReconnect(message = 'Realtime voice connection lost. Please try again.') {
    if (!vc.on || vc.realtimeReconnectTimer) return;
    if (vc.realtimeRetryCount >= 3) {
      closeVoice(message);
      return;
    }
    vc.realtimeRetryCount += 1;
    const delay = Math.min(1000 * (2 ** (vc.realtimeRetryCount - 1)), 4000);
    closeRealtimeVoice();
    voiceState('thinking', 'Restoring voice connection…');
    vc.realtimeReconnectTimer = setTimeout(async () => {
      vc.realtimeReconnectTimer = null;
      if (!vc.on) return;
      const connected = await startRealtimeVoice();
      if (connected) {
        vc.realtimeRetryCount = 0;
        return;
      }
      scheduleRealtimeReconnect(message);
    }, delay);
  }

  window.addEventListener('offline', () => {
    if (vc.on && vc.realtime) voiceState('paused', 'Network unavailable. Reconnecting when online…');
  });
  window.addEventListener('online', () => {
    if (vc.on && (vc.realtimeProvider === 'gemini' || vc.realtimeProvider === 'openai')) {
      scheduleRealtimeReconnect('Realtime voice could not reconnect. Please restart voice.');
    }
  });

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
          audioContext: vc.audioCtx,
          audioElement: vc.audioEl,
          state: (s) => { vc.geminiState = s; vc.realtimeStream = s.stream; window.NasrinVoiceWave?.attach(s.stream); },
          active: () => vc.realtime, muted: () => vc.muted,
          open: () => { vc.realtimeRetryCount=0; vc.realtimeProvider='gemini'; vc.realtime=true; voiceState('listening','Listening…'); Nasrin.mood('idle'); },
          input: (t) => { voiceSay('user',t); voiceState('thinking','Thinking…'); },
          output: (t) => { let x=voiceLog.querySelector('.vmsg.assistant.is-realtime'); if(!x){x=voiceSay('assistant is-live','');x.classList.add('is-realtime');} x.textContent+=t; voiceState('speaking','Talking…'); Nasrin.talk(1); },
          interrupted: () => { voiceState('listening','Listening…'); Nasrin.talk(0); },
          complete: () => { const x=voiceLog.querySelector('.vmsg.assistant.is-realtime'); if(x)x.classList.remove('is-realtime','is-live'); voiceState('listening','Listening…'); Nasrin.talk(0); },
          error: (message) => scheduleRealtimeReconnect(message || 'Voice connection interrupted. Reconnecting…'),
          close: () => { if(vc.on&&vc.realtimeProvider==='gemini') scheduleRealtimeReconnect('Voice connection ended. Reconnecting…'); }
        });
        vc.realtimeMaxSeconds = Number(session.max_seconds) || 300;
        clearTimeout(vc.realtimeTimer);
        vc.realtimeTimer = setTimeout(() => { if(vc.realtime) closeVoice('This realtime session reached its tier limit. Start a new session to continue.'); }, Math.max(60,vc.realtimeMaxSeconds)*1000);
        return true;
      }
      if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) return false;
      // STUN is required for reliable candidate discovery across common NATs.
      // Configure a TURN relay for restrictive networks in production.
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      vc.realtimePc = pc;
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          scheduleRealtimeReconnect('Realtime voice could not reconnect. Please restart voice.');
        } else if (pc.connectionState === 'disconnected' && vc.realtime) {
          voiceState('thinking', 'Restoring voice connection…');
          // Allow short mobile-network handoffs to recover before replacing the session.
          setTimeout(() => {
            if (vc.on && vc.realtimePc === pc && pc.connectionState === 'disconnected') {
              scheduleRealtimeReconnect('Realtime voice could not reconnect. Please restart voice.');
            }
          }, 1800);
        }
      };
      const events = pc.createDataChannel('oai-events');
      const audio = vc.audioEl || document.createElement('audio');
      vc.audioEl = null;
      audio.autoplay = true; audio.playsInline = true; audio.setAttribute('aria-hidden', 'true'); audio.style.display = 'none';
      if (!audio.isConnected) document.body.appendChild(audio);
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        audio.play().catch(() => {
          // Never swallow autoplay failures: the session may be connected but
          // silent until the user performs a playback-enabling gesture.
          voiceState('paused', 'Audio playback is blocked. Tap to enable sound.');
          const resume = () => {
            audio.play().then(() => {
              document.removeEventListener('pointerdown', resume);
              document.removeEventListener('keydown', resume);
              if (vc.realtime) voiceState('listening', 'Listening…');
            }).catch(() => {});
          };
          document.addEventListener('pointerdown', resume, { once: true });
          document.addEventListener('keydown', resume, { once: true });
        });
      };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      vc.realtimeStream = stream;
      stream.getAudioTracks().forEach((track) => pc.addTrack(track, stream));
      window.NasrinVoiceWave?.attach(stream);   // the wave follows your voice level
      events.addEventListener('message', (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'input_audio_transcription.done' && msg.transcript) {
          voiceSay('user', msg.transcript); voiceLog.scrollTop = voiceLog.scrollHeight; voiceState('thinking', 'Thinking…');
        } else if ((msg.type === 'response.audio_transcript.delta' || msg.type === 'response.output_audio_transcript.delta') && msg.delta) {
          let last = voiceLog.querySelector('.vmsg.assistant.is-realtime');
          if (!last) { last = voiceSay('assistant is-live', ''); last.classList.add('is-realtime'); }
          last.textContent += msg.delta; voiceLog.scrollTop = voiceLog.scrollHeight; voiceState('speaking', 'Talking…'); Nasrin.talk(1);
        } else if (msg.type === 'response.audio_transcript.done' || msg.type === 'response.output_audio_transcript.done') {
          const last = voiceLog.querySelector('.vmsg.assistant.is-realtime'); if (last) last.classList.remove('is-realtime', 'is-live');
          voiceState('listening', 'Listening…'); Nasrin.talk(0);
        } else if (msg.type === 'input_audio_buffer.speech_started') {
          voiceState('listening', 'Listening…'); Nasrin.talk(0);
        } else if (msg.type === 'error') closeVoice(msg.error?.message || 'Realtime voice stopped. Please try again.');
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // The SDP endpoint needs the gathered ICE candidates. Posting the initial
      // offer immediately can produce a connection that never establishes.
      if (pc.iceGatheringState !== 'complete') {
        await new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            pc.removeEventListener('icegatheringstatechange', onGathering);
            resolve();
          };
          const onGathering = () => {
            if (pc.iceGatheringState === 'complete') finish();
          };
          const timeout = setTimeout(finish, 5000);
          pc.addEventListener('icegatheringstatechange', onGathering);
          onGathering();
        });
      }
      const localSdp = pc.localDescription?.sdp;
      if (!localSdp) throw new Error('Realtime offer could not be created.');
      const answer = await fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST', headers: { Authorization: 'Bearer ' + session.value, 'Content-Type': 'application/sdp' }, body: localSdp
      });
      if (!answer.ok) throw new Error('Realtime connection could not be established.');
      await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
      vc.realtimePc = pc; vc.realtimeEvents = events; vc.realtimeStream = stream; vc.realtimeAudio = audio; vc.realtimeProvider = 'openai'; vc.realtime = true; vc.realtimeRetryCount = 0;
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
    try { window.NasrinVoiceWave?.detach(); } catch {}
    try { vc.realtimeEvents?.send(JSON.stringify({ type: 'response.cancel' })); } catch {}
    try { vc.realtimeEvents?.close(); } catch {}
    try { window.NasrinGeminiRealtime?.stop(vc.geminiState); } catch {}
    try { vc.geminiState?.ws?.close(); } catch {}
    try { vc.geminiState?.processor?.disconnect(); } catch {}
    try { vc.geminiState?.ctx?.close(); } catch {}
    try { vc.realtimePc?.close(); } catch {}
    try { vc.realtimeStream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { vc.realtimeAudio?.remove(); } catch {}
    try { vc.audioEl?.remove(); } catch {}
    try { if (vc.audioCtx && vc.audioCtx !== vc.geminiState?.ctx) vc.audioCtx.close(); } catch {}
    vc.audioEl = null; vc.audioCtx = null;
    vc.realtimePc = null; vc.realtimeEvents = null; vc.realtimeStream = null; vc.realtimeAudio = null; vc.geminiState = null;
    vc.realtimeProvider = null; vc.realtime = false;
  }

  async function openVoice() {
    if (vc.on) return;
    if (!aiAvailable) { notice.textContent = 'Nasrin is not switched on yet. Please check back soon.'; return; }
    stopSpeaking();
    closePlus();
    vc.on = true;
    vc.realtimeRetryCount = 0;
    vc.muted = false;
    vc.quick = 0;
    // Phones (iOS above all) only let sound start from the tap itself: make
    // the realtime voice's audio output now, before anything is awaited.
    // iPhone: undo the 'playback' set by this tap (unlockAudio); with the
    // microphone on, Safari then picks its own talk-and-listen mode.
    try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch { /* not supported */ }
    try { if (AudioCtx) { vc.audioCtx = new AudioCtx(); vc.audioCtx.resume().catch(() => {}); } } catch { vc.audioCtx = null; }
    try { vc.audioEl = document.createElement('audio'); vc.audioEl.style.display = 'none'; document.body.appendChild(vc.audioEl); vc.audioEl.play().catch(() => {}); } catch { vc.audioEl = null; }
    voiceMute.setAttribute('aria-pressed', 'false');
    voiceMute.setAttribute('aria-label', 'Mute microphone');
    voiceMute.title = 'Mute microphone';
    closeVoiceMenus();
    renderVoiceTier();
    voiceLog.replaceChildren();
    voiceEl.hidden = false;
    document.body.classList.add('voice-open');
    keepAwake();
    $('voiceEnd').focus();
    const realtime = await startRealtimeVoice();
    if (!vc.on) return;
    // Say which mode is on only once it is known.
    if (realtime) voiceSay('hint', 'Realtime voice is on. Just talk naturally — you can interrupt Nasrin at any time.');
    if (!realtime) {
      // When an AI realtime voice is selected, fail clearly rather than
      // silently switching to a separate STT/TTS cascade.
      if (currentVoice().startsWith('ai:')) {
        // Initial connection failures must use the same bounded retry path as
        // dropped sessions; do not close the voice UI after the first failure.
        scheduleRealtimeReconnect('Voice could not start. Retrying the connection…');
        return;
      }
      voiceSay('hint', 'Using compatibility voice mode. Talk naturally and Nasrin will answer out loud.');
      if (Recognition) listenVoice();
      else closeVoice('Realtime voice could not start, and this browser has no voice fallback.');
    }
  }

  function closeVoice(message) {
    if (!vc.on) return;
    vc.on = false;
    clearTimeout(vc.realtimeReconnectTimer);
    vc.realtimeReconnectTimer = null;
    vc.realtimeRetryCount = 0;
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
  voiceSkip.addEventListener('click', interruptVoice);
  voiceMute.addEventListener('click', () => {
    muteVoice(!vc.muted);
    try { navigator.vibrate?.(12); } catch { /* not supported: fine */ }   // a small tap you can feel
  });

  voicePlus?.addEventListener('click', () => {
    const open = voicePlusMenu && voicePlusMenu.hidden;
    closeVoiceMenus();
    if (open && voicePlusMenu) { voicePlusMenu.hidden = false; voicePlus.setAttribute('aria-expanded', 'true'); voicePickFiles?.focus(); }
  });
  voicePickFiles?.addEventListener('click', () => { closeVoiceMenus(); $('pickFiles')?.click(); });
  voicePickImage?.addEventListener('click', () => { closeVoiceMenus(); $('pickImage')?.click(); });
  voiceTier?.addEventListener('click', () => {
    const open = voiceTierMenu && voiceTierMenu.hidden;
    closeVoiceMenus();
    if (open && voiceTierMenu) { renderVoiceTier(); voiceTierMenu.hidden = false; voiceTier.setAttribute('aria-expanded', 'true'); }
  });
  document.addEventListener('pointerdown', (e) => {
    if (voicePlusMenu && !voicePlusMenu.hidden && !voicePlus.contains(e.target) && !voicePlusMenu.contains(e.target)) closeVoicePopover(voicePlusMenu, voicePlus);
    if (voiceTierMenu && !voiceTierMenu.hidden && !voiceTier.contains(e.target) && !voiceTierMenu.contains(e.target)) closeVoicePopover(voiceTierMenu, voiceTier);
  });
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
  // The tier bars show the saved choice at once; they never wait for the
  // model list to arrive.
  {
    const level = LEVEL[saved.get(KEYS.model)] || 1;
    modelBtn.querySelectorAll('.bars rect').forEach((r, i) => r.classList.toggle('on', i < level));
  }

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
    renderVoiceTier();
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
      // A valid one-tier catalog is still a usable selector; hide only when the API returns no tiers.
      if (modelList.length === 0) { currentModel = 'nasrinai'; showCurrentModel(false); return; }
      const wanted = saved.get(KEYS.model);
      currentModel = open.includes(wanted) ? wanted : (open.includes(data.default) ? data.default : open[0] || '');
      showCurrentModel(false);
      if (!modelMenu.hidden) renderMenu();
      modelRow.hidden = false;
    } catch {
      // A stale guest token or a just-rotated sign-in token can make the first
      // catalog request fail. Retry once with a fresh credential before hiding
      // the picker; api(..., {}, true) renews the account or starts a new guest session.
      try {
        const data = await api('/v1/models', {}, true);
        modelList = (Array.isArray(data.models) ? data.models : [])
          .filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string')
          .map((m) => ({ id: m.id, name: m.name, locked: m.locked === true, needs: m.needs, plan: m.plan }));
        const open = modelList.filter((m) => !m.locked).map((m) => m.id);
        if (modelList.length === 0) { modelRow.hidden = true; currentModel = ''; return; }
        const wanted = saved.get(KEYS.model);
        currentModel = open.includes(wanted) ? wanted : (open.includes(data.default) ? data.default : open[0] || '');
        showCurrentModel(false);
        if (!modelMenu.hidden) renderMenu();
        modelRow.hidden = false;
      } catch {
        // Keep the picker discoverable if the catalog endpoint is temporarily
        // unreachable. The server remains authoritative and enforces every tier
        // on chat requests; this fallback does not grant access to paid tiers.
        if (modelList.length === 0) {
          modelList = [
            { id: 'nasrinai', name: 'Quick' },
            { id: 'pro', name: 'Pro', locked: true, needs: 'sign_in' },
            { id: 'max', name: 'Max', locked: true, needs: 'sign_in' },
            { id: 'ultra', name: 'Ultra', locked: true, needs: 'sign_in' }
          ];
        }
        currentModel = modelList.some((m) => m.id === currentModel && !m.locked)
          ? currentModel
          : (modelList.find((m) => !m.locked)?.id || 'nasrinai');
        showCurrentModel(false);
        if (!modelMenu.hidden) renderMenu();
        modelRow.hidden = false;
      }
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
    showConnectForSignedIn();
    return planInfo;
  }

  function renderPlanRow() {
    renderImageHint();
    const row = $('planRow');
    row.hidden = !plansEnabled;
    if (!plansEnabled) return;
    const current = planInfo && planInfo.current;
    connectPlanEligible = current === 'max' || current === 'ultra';
    const named = { free: 'Free', max: 'Max', ultra: 'Ultra' }[current] || 'Free';
    $('planLabel').textContent = account ? `${named} plan` : 'Plans';
    const billingPlanLabel = $('billingPlanLabel');
    if (billingPlanLabel) {
      const billingPlanName = { free: 'Free', pro: 'Pro', max: 'Max', ultra: 'Ultra' }[current];
      billingPlanLabel.textContent = billingPlanName || '';
      billingPlanLabel.hidden = !account || !billingPlanName;
    }
    $('planHint').textContent = account && planInfo && planInfo.ends_at && current !== 'free'
      ? `Until ${new Date(planInfo.ends_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
      : 'Get Max and Ultra';
    showConnectForSignedIn();
  }

  const PLAN_DETAILS = Object.freeze({
    free: {
      summary: 'Unlimited everyday chat on Quick.',
      features: ['Quick tier for everyday questions', 'Unlimited chat on Quick', 'Up to 2 image generations per day', 'Coding is unavailable on Quick', 'Video creation is not included']
    },
    pro: {
      summary: 'More capable AI for professional everyday work.',
      features: ['Pro tier for harder questions and analysis', 'Automatically continues on unlimited Quick chat when the allowance is used', 'Coding and paid-tier tools pause until the weekly reset', 'Subscription billing will be enabled after recurring checkout is configured']
    },
    max: {
      summary: 'More thinking power for complex work.',
      features: ['Everything in Pro', 'Max tier for harder reasoning and complex tasks', 'Automatically continues on unlimited Quick chat when the allowance is used', 'Coding and paid-tier tools pause until the weekly reset', 'AI video generation up to 1 minute', 'No automatic renewal']
    },
    ultra: {
      summary: 'The deepest thinking available in NasrinAI.',
      features: ['Everything in Max', 'Ultra tier for the most demanding tasks', 'Automatically continues on unlimited Quick chat when the allowance is used', 'Coding and paid-tier tools pause until the weekly reset', 'No automatic renewal', 'AI video generation up to 1 minute']
    }
  });

  function planCard(p, current) {
    const card = document.createElement('article');
    card.className = 'plan-card' + (p.id === current ? ' is-current' : '');

    const top = document.createElement('div');
    top.className = 'plan-top';
    const h = document.createElement('h3');
    h.textContent = p.name;
    const price = document.createElement('span');
    price.className = 'price';
    const basePrice = p.price ? money(p.price) : null;
    const annualPrice = p.annual_price ? money(p.annual_price) : null;
    if (p.id === 'free') price.textContent = '₱0';
    else if (basePrice) {
      price.textContent = basePrice + ' ';
      const per = document.createElement('small');
      per.textContent = '/ 30 days';
      price.appendChild(per);
    } else { price.className = 'soon'; price.textContent = 'Coming soon'; }
    top.append(h, price);

    const inc = document.createElement('p');
    inc.className = 'includes';
    inc.textContent = (Array.isArray(p.tiers) ? p.tiers.join(' · ') : '') + (p.weekly_tokens ? ' · ' + Number(p.weekly_tokens).toLocaleString() + ' tokens/week' : p.id === 'free' ? ' · Unlimited Quick chat' : '');

    const details = PLAN_DETAILS[p.id] || {
      summary: 'See what this plan includes.',
      features: Array.isArray(p.tiers) ? p.tiers.map((tier) => tier + ' tier') : []
    };
    const detailsToggle = document.createElement('button');
    detailsToggle.type = 'button';
    detailsToggle.className = 'plan-details-toggle';
    detailsToggle.setAttribute('aria-expanded', 'false');
    const detailsLabel = document.createElement('span');
    detailsLabel.textContent = 'Features & benefits';
    const detailsIcon = document.createElement('span');
    detailsIcon.className = 'plan-details-icon';
    detailsIcon.setAttribute('aria-hidden', 'true');
    detailsIcon.textContent = '+';
    detailsToggle.append(detailsLabel, detailsIcon);

    const weeklyAllowance = Number(p.weekly_tokens);
    const planFeatures = p.id !== 'free' && Number.isSafeInteger(weeklyAllowance) && weeklyAllowance > 0
      ? [weeklyAllowance.toLocaleString() + ' tokens per week', ...details.features.filter((feature) => !/tokens per week/i.test(feature))]
      : details.features;

    const detailsPanel = document.createElement('div');
    detailsPanel.className = 'plan-details';
    detailsPanel.hidden = true;
    const summary = document.createElement('p');
    summary.className = 'plan-details-summary';
    summary.textContent = details.summary;
    const list = document.createElement('ul');
    for (const feature of planFeatures) {
      const li = document.createElement('li');
      li.textContent = feature;
      list.appendChild(li);
    }
    detailsPanel.append(summary, list);
    detailsToggle.addEventListener('click', () => {
      const open = detailsPanel.hidden;
      detailsPanel.hidden = !open;
      detailsToggle.setAttribute('aria-expanded', String(open));
      detailsIcon.textContent = open ? '−' : '+';
    });

    if (p.id === 'free' || !account) {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (p.id === 'free') {
        btn.className = 'btn outline';
        btn.textContent = 'Included';
        btn.disabled = true;
      } else {
        btn.className = 'btn';
        btn.textContent = 'Sign in to get ' + p.name;
        btn.addEventListener('click', () => { closePlans(); openSignIn(); });
      }
      card.append(top, inc, detailsToggle, detailsPanel, btn);
      return card;
    }

    const rank = { free: 0, pro: 1, max: 2, ultra: 3 };
    const same = p.id === current;
    const upgrade = current && rank[p.id] > rank[current];
    const lower = current && rank[p.id] < rank[current];
    let term = 'period';

    const termBox = document.createElement('div');
    termBox.className = 'plan-term';
    const periodBtn = document.createElement('button');
    periodBtn.type = 'button';
    periodBtn.textContent = '30 days' + (basePrice ? ' · ' + basePrice : '');
    periodBtn.setAttribute('aria-pressed', 'true');
    periodBtn.disabled = !p.available || lower;
    const annualBtn = document.createElement('button');
    annualBtn.type = 'button';
    annualBtn.textContent = annualPrice ? 'Annual · ' + annualPrice : 'Annual · unavailable';
    annualBtn.setAttribute('aria-pressed', 'false');
    annualBtn.disabled = !p.annual_available || lower;
    termBox.append(periodBtn, annualBtn);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    const update = () => {
      const annual = term === 'annual';
      periodBtn.setAttribute('aria-pressed', String(!annual));
      annualBtn.setAttribute('aria-pressed', String(annual));
      const enabled = annual ? p.annual_available : p.available;
      btn.disabled = !enabled || Boolean(lower);
      if (lower) btn.textContent = 'Included in ' + (current === 'ultra' ? 'Ultra' : 'your plan');
      else if (same) btn.textContent = annual ? 'Extend 1 year' : 'Extend 30 days';
      else if (upgrade) btn.textContent = annual ? 'Upgrade · 1 year' : 'Upgrade';
      else btn.textContent = annual ? 'Get 1 year' : 'Get ' + p.name;
    };
    periodBtn.addEventListener('click', () => { term = 'period'; update(); });
    annualBtn.addEventListener('click', () => { term = 'annual'; update(); });
    btn.addEventListener('click', () => buyPlan(p, btn, term));
    update();

    card.append(top, inc, detailsToggle, detailsPanel, termBox, btn);
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
      { id: 'free', name: 'Quick', tiers: ['Quick'], price: null },
      { id: 'pro', name: 'Pro', tiers: ['Quick', 'Pro'], price: null },
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
  // The public catalog is kept on this device so the toolbar shows the right
  // choice at once; the server copy replaces it as soon as it arrives.
  const validCatalog = (data) => (data && data.enabled && Array.isArray(data.groups) && Array.isArray(data.professions) && data.professions.length ? data : null);
  let proCatalog = validCatalog(saved.get(KEYS.proCatalog));   // { groups: [{ id, name, members }], professions: [{ id, name, groups, accessory, focus }] }
  // Asked for right away (a public list): it no longer waits behind status and sign-in.
  const proFetch = net('/v1/professionals').then((r) => (r.ok ? r.json() : null)).catch(() => null);
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
    // The coding chat always asks the Technology experts; the server picks the ones a message needs.
    if (codingProject) return { enabled: true, mode: 'group', groups: ['technology'] };
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
    btn.hidden = false;
    const openProRow = $('openPro');   // optional Settings row: the page may not have it
    if (openProRow) openProRow.hidden = !proCatalog;
    if (!proCatalog) {
      $('proBtnLabel').textContent = proState.enabled ? 'Automatic' : 'Universal AI';
      $('proBtnIcon').replaceChildren(nasrinAvatar(null));
      btn.classList.remove('is-on');
      btn.title = 'Professional AI settings loading';
      btn.setAttribute('aria-label', btn.title);
      return;
    }
    if (codingProject) {
      $('proBtnLabel').textContent = 'Code experts';
      $('proBtnIcon').replaceChildren(nasrinAvatar('glasses'));
      btn.classList.add('is-on');
      btn.title = 'Coding experts: Software and Web Developer, QA, Cybersecurity, Data and IT experts';
      btn.setAttribute('aria-label', btn.title);
      return;
    }
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
    if (codingProject) { notice.textContent = 'In the coding chat Nasrin uses its coding experts. Leave the coding chat to choose others.'; return; }
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
  $('openPro')?.addEventListener('click', openPro);   // optional: a missing row must never stop start-up
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
    proCatalog = validCatalog(await proFetch);
    if (proCatalog) saved.set(KEYS.proCatalog, proCatalog); else saved.del(KEYS.proCatalog);
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
    if (codingProject) setCoding(null);
    // A reply still being written keeps going in its own chat (like New chat).
    const continuing = detachTurn();
    refreshSendButton();
    refreshTurnControls();
    closeHistory();
    stopSpeaking();
    notice.textContent = continuing ? BACKGROUND_NOTE : '';
    conversationId = id;
    saved.set(identityKey(KEYS.conversation), id);
    clearScreen();
    await loadConversation();
    if (!conversationId) { notice.textContent = 'That chat is no longer available.'; return; }
    // A coding chat opens in the coding chat, in its project.
    const p = codeChats()[id];
    if (p && account && projectsOn) setCoding(p);
  }
  $('historyBtn').addEventListener('click', () => (historySheet.hidden ? openHistory() : closeHistory()));
  $('spaceSignIn').addEventListener('click', () => { closeHistory(); openSignIn(); });
  // Settings > Your space: Library and Projects open in the same sheet as the chats.
  // Library and Projects are opened from NasrinAI Space.
  function renderSpaceMenu() {
    // Library/Projects now live inside NasrinAI Space.
    $('historyBtnLabel').textContent = libraryOn ? 'Your chats and Library' : 'Your chats';
    $('historyBtn').title = libraryOn ? 'Chats and Library' : 'Your chats';
  }
  $('historyClose').addEventListener('click', closeHistory);

  // Menu drawer on phones and tablets (docs/mobile-nav.md): Library, Projects,
  // Your chats, the latest chats, New chat and Settings. It reuses the
  // existing screens; it only opens them.
  const drawer = $('drawer');
  const drawerScrim = $('drawerScrim');
  const menuBtn = $('menuBtn');
  function closeDrawer(restore = true) {
    if (drawer.hidden) return;
    drawer.hidden = true;
    drawerScrim.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
    if (restore) menuBtn.focus();
  }
  async function openDrawer() {
    closeSettings(); closeHistory(); closeSignIn(); closePlans();
    drawer.hidden = false;
    drawerScrim.hidden = false;
    menuBtn.setAttribute('aria-expanded', 'true');
    $('drawerLibrary').hidden = !libraryOn;
    $('drawerProjects').hidden = !projectsOn;
    $('drawerSearch').focus();
    const list = $('drawerChats');
    const status = $('drawerStatus');
    list.replaceChildren();
    status.textContent = 'Loading…';
    try {
      const data = await api('/v1/conversations');
      drawerAll = (data.conversations || []).filter((c) => c && typeof c.id === 'string');
      renderDrawerChats();
    } catch (err) {
      status.textContent = err.message || 'Your chats could not be loaded.';
    }
  }
  // Recent: normal chats and coding chats, in two tabs.
  let drawerAll = [];
  let drawerTab = 'chats';
  function renderDrawerChats() {
    const list = $('drawerChats');
    const status = $('drawerStatus');
    const code = codeChats();
    for (const [id, name] of [['drawerTabChats', 'chats'], ['drawerTabCode', 'code']]) {
      $(id).classList.toggle('is-on', drawerTab === name);
      $(id).setAttribute('aria-selected', String(drawerTab === name));
    }
    {
      const chats = drawerAll.filter((c) => (drawerTab === 'code') === Boolean(code[c.id])).slice(0, 8);
      list.replaceChildren(...chats.map((c) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'drawer-chat' + (c.id === conversationId ? ' is-current' : '');
        b.textContent = c.title || 'Untitled chat';
        b.addEventListener('click', () => { closeDrawer(false); openChat(c.id); });
        li.appendChild(b);
        return li;
      }));
      status.textContent = chats.length ? '' : drawerTab === 'code' ? 'No coding chats yet.' : 'No chats yet.';
      $('drawerSeeAll').hidden = !chats.length || drawerTab === 'code';
    }
  }
  $('drawerTabChats').addEventListener('click', () => { drawerTab = 'chats'; renderDrawerChats(); });
  $('drawerTabCode').addEventListener('click', () => { drawerTab = 'code'; renderDrawerChats(); });
  menuBtn.addEventListener('click', () => (drawer.hidden ? openDrawer() : closeDrawer()));
  drawerScrim.addEventListener('click', () => closeDrawer());
  drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeDrawer(); } });
  for (const b of drawer.querySelectorAll('[data-open]')) b.addEventListener('click', () => { closeDrawer(false); openHistory(b.dataset.open); });
  $('drawerSearch').addEventListener('click', () => { closeDrawer(false); openHistory('chats'); });
  $('drawerSeeAll').addEventListener('click', () => { closeDrawer(false); openHistory('chats'); });
  $('drawerNewChat').addEventListener('click', () => { closeDrawer(false); $('newChat').click(); });
  $('drawerSettings').addEventListener('click', () => { closeDrawer(false); openSettings(); });

  // ---------- Evidence-led research workspace ----------
  const researchOverlay = $('researchOverlay');
  let activeResearchId = null;
  let activeResearch = null;
  function researchNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }
  function renderResearchReport(data) {
    activeResearch = data;
    activeResearchId = data.id;
    $('researchResult').hidden = false;
    $('researchReportTitle').textContent = data.query || 'Research report';
    const report = data.report || {};
    const summary = $('researchSummary');
    summary.replaceChildren();
    const quality = data.quality || {};
    const metrics = [
      ['Findings', Array.isArray(report.findings) ? report.findings.length : 0],
      ['Sources read', Array.isArray(data.sources) ? data.sources.filter((s) => s.status === 'read').length : 0],
      ['Citation integrity', report.citation_integrity?.all_findings_have_read_source === true ? 'All findings cited' : 'Review citations']
    ];
    for (const [label, value] of metrics) {
      const card = researchNode('div', 'research-metric');
      card.append(researchNode('span', 'research-metric-label', label), researchNode('strong', '', value));
      summary.append(card);
    }
    const findings = $('researchFindings');
    findings.replaceChildren();
    for (const item of (Array.isArray(report.findings) ? report.findings : [])) {
      const card = researchNode('article', 'research-finding');
      const head = researchNode('div', 'research-finding-head');
      head.append(researchNode('span', 'research-finding-number', 'Finding ' + item.id));
      head.append(researchNode('span', 'research-confidence', ({corroborated:'Corroborated',single_source:'Single source',uncited:'Uncited'})[item.confidence] || 'Review'));
      card.append(head, researchNode('p', 'research-finding-text', item.finding));
      if (Array.isArray(item.citations) && item.citations.length) {
        const citations = researchNode('div', 'research-citations');
        for (const citation of item.citations) {
          let url;
          try { url = new URL(citation.url); } catch { continue; }
          if (!['http:', 'https:'].includes(url.protocol)) continue;
          const a = researchNode('a', '', citation.title || url.hostname);
          a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer';
          citations.append(a);
        }
        card.append(citations);
      }
      findings.append(card);
    }
    if (!findings.childElementCount) findings.append(researchNode('p', 'research-empty', 'No evidence-backed findings were returned. Check the sources and try a narrower question.'));
    const sourcesBox = $('researchSources');
    sourcesBox.replaceChildren();
    for (const source of (Array.isArray(data.sources) ? data.sources : [])) {
      const row = researchNode('div', 'research-source');
      let url;
      try { url = new URL(source.url); } catch { url = null; }
      if (url && ['http:', 'https:'].includes(url.protocol)) {
        const a = researchNode('a', '', source.title || url.hostname);
        a.href = url.href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.referrerPolicy = 'no-referrer';
        row.append(a);
      } else row.append(researchNode('span', '', source.title || 'Untitled source'));
      row.append(researchNode('span', 'research-source-status', source.status || 'unknown'));
      if (source.reason) row.append(researchNode('p', 'research-source-reason', source.reason));
      sourcesBox.append(row);
    }
    $('researchQuality').textContent = JSON.stringify(quality, null, 2);
    $('researchSave').disabled = !activeResearchId || !account;
    $('researchSave').title = account ? 'Save after confirmation' : 'Sign in to save reports to your Library';
  }
  async function refreshResearchHistory() {
    const box = $('researchHistory');
    box.replaceChildren(researchNode('p', 'research-muted', 'Loading recent research…'));
    try {
      const data = await api('/v1/research');
      const scans = Array.isArray(data.scans) ? data.scans : [];
      box.replaceChildren();
      if (!scans.length) { box.append(researchNode('p', 'research-muted', 'Your completed research will appear here.')); return; }
      for (const scan of scans) {
        const row = researchNode('div', 'research-history-row');
        const button = researchNode('button', 'research-history-open', scan.query || 'Research report');
        button.type = 'button';
        button.addEventListener('click', async () => {
          $('researchStatus').textContent = 'Opening report…';
          try { renderResearchReport(await api('/v1/research/' + encodeURIComponent(scan.id))); $('researchStatus').textContent = ''; }
          catch (err) { $('researchStatus').textContent = err.message || 'Could not open that report.'; }
        });
        row.append(button, researchNode('span', 'research-muted', (scan.facts || 0) + ' findings'));
        box.append(row);
      }
    } catch (err) {
      box.replaceChildren(researchNode('p', 'research-muted', err.message || 'Recent research could not be loaded.'));
    }
  }
  async function openResearch() {
    closeSettings(); closeHistory(); closeSignIn(); closePlans(); closeDrawer(false);
    researchOverlay.hidden = false;
    document.body.classList.add('research-open');
    $('researchQuery').focus();
    await refreshResearchHistory();
  }
  function closeResearch() {
    researchOverlay.hidden = true;
    document.body.classList.remove('research-open');
  }
  $('desktopResearchBtn')?.addEventListener('click', openResearch);
  $('researchClose').addEventListener('click', closeResearch);
  researchOverlay.addEventListener('click', (event) => { if (event.target === researchOverlay) closeResearch(); });
  researchOverlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); closeResearch(); } });
  $('researchRefresh').addEventListener('click', refreshResearchHistory);
  // Public-web professional search. Render every returned listing as a safe, scrollable card.
  const professionalJobState = { query: '', location: '', date_range: 'any', seen: new Set(), count: 0, loading: false };
  const professionalText = (value, fallback = 'Not disclosed') => {
    const text = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    return text || fallback;
  };
  const professionalSafeUrl = (value) => {
    try { const url = new URL(String(value || '')); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  };
  function professionalFactsFor(url, facts) {
    return facts.filter((fact) => professionalSafeUrl(fact?.url) === url && typeof fact?.fact === 'string').map((fact) => fact.fact.trim()).filter(Boolean);
  }
  function professionalField(facts, pattern) {
    const labeled = facts.find((fact) => pattern.test(fact));
    if (!labeled) return 'Not disclosed';
    const split = labeled.match(/^(?:salary|pay|compensation|benefits?|requirements?|qualifications?|responsibilities|duties|company|employer|location|work arrangement|schedule)\s*[:—-]\s*(.+)$/i);
    return professionalText(split ? split[1] : labeled);
  }
  function renderProfessionalJob(source, facts) {
    const url = professionalSafeUrl(source?.url);
    if (!url || professionalJobState.seen.has(url)) return false;
    professionalJobState.seen.add(url);
    const details = professionalFactsFor(url, facts);
    const card = document.createElement('article');
    card.className = 'professional-job-card';
    const head = document.createElement('div'); head.className = 'professional-job-card-head';
    const title = document.createElement('h5'); title.textContent = professionalText(source?.title, 'Job opportunity');
    const company = document.createElement('p'); company.className = 'professional-job-company'; company.textContent = professionalText(source?.company || source?.employer || professionalField(details, /\b(company|employer|hiring organization|posted by)\b/i));
    head.append(title, company);
    const meta = document.createElement('div'); meta.className = 'professional-job-meta';
    const addMeta = (label, value) => { const item = document.createElement('span'); item.textContent = label + ': ' + professionalText(value); meta.append(item); };
    addMeta('Location', source?.location || professionalField(details, /\b(location|based in|remote|hybrid|onsite|on-site)\b/i));
    addMeta('Salary', source?.salary || professionalField(details, /\b(salary|pay|compensation|hourly rate|per month|per year|\$|₱|PHP)\b/i));
    const sections = [
      ['Requirements', source?.requirements || professionalField(details, /\b(requirements?|qualifications?|experience required|must have|skills required|degree)\b/i)],
      ['Benefits', source?.benefits || professionalField(details, /\b(benefits?|allowance|health insurance|paid leave|bonus|perks)\b/i)],
      ['Responsibilities', source?.responsibilities || professionalField(details, /\b(responsibilities|duties|you will|role involves|responsible for)\b/i)]
    ];
    const body = document.createElement('div'); body.className = 'professional-job-fields';
    for (const [label, value] of sections) { const section = document.createElement('section'); const h = document.createElement('h6'); h.textContent = label; const p = document.createElement('p'); p.textContent = professionalText(value); section.append(h, p); body.append(section); }
    if (details.length) { const detail = document.createElement('details'); detail.className = 'professional-job-evidence'; const summary = document.createElement('summary'); summary.textContent = 'More details from the source (' + details.length + ')'; const list = document.createElement('ul'); for (const fact of details) { const li = document.createElement('li'); li.textContent = fact; list.append(li); } detail.append(summary, list); body.append(detail); }
    const footer = document.createElement('div'); footer.className = 'professional-job-footer';
    const sourceLabel = document.createElement('span'); sourceLabel.textContent = 'Source: ' + professionalText(source?.title, new URL(url).hostname);
    const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.referrerPolicy = 'no-referrer'; link.textContent = 'View original listing ↗';
    footer.append(sourceLabel, link); card.append(head, meta, body, footer);
    $('professionalSearchCards').append(card); professionalJobState.count += 1; return true;
  }
  function updateProfessionalJobCount() {
    $('professionalSearchCount').textContent = professionalJobState.count + (professionalJobState.count === 1 ? ' opportunity found' : ' opportunities found');
    $('professionalSearchResult').hidden = false;
    $('professionalSearchMore').hidden = professionalJobState.count === 0 || professionalJobState.count >= 40;
  }
  async function runProfessionalJobSearch({ more = false } = {}) {
    if (professionalJobState.loading || professionalJobState.count >= 40) return;
    const status = $('professionalSearchStatus'); const run = $('professionalSearchRun'); const moreButton = $('professionalSearchMore');
    professionalJobState.loading = true; run.disabled = true; moreButton.disabled = true;
    status.textContent = more ? 'Searching for additional distinct listings…' : 'Searching public sources and extracting job details…';
    try {
      const query = [professionalJobState.query, 'Find up to 20 distinct publicly accessible job listings. For each listing, extract the exact job title, employer, location/work arrangement, salary or pay range, required qualifications and skills, benefits, responsibilities, and original application/source URL. Return separate source-backed facts for each listing. Explicitly say when a field is not disclosed; never infer or invent missing information. Prioritize variety and direct employer or reputable job-board pages.', more ? 'Find additional listings not already shown; exclude these URLs and titles: ' + Array.from(professionalJobState.seen).slice(0, 40).join(', ') : ''].filter(Boolean).join(' ');
      const result = await api('/v1/professional-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, category: 'jobs_hiring', source: 'public_web', location: professionalJobState.location, date_range: professionalJobState.date_range }) });
      const group = result?.professional_search?.source_groups?.find((item) => item.id === 'public_web');
      const sources = Array.isArray(group?.sources) ? group.sources : (Array.isArray(result?.sources) ? result.sources : []);
      const facts = Array.isArray(group?.facts) ? group.facts : (Array.isArray(result?.facts) ? result.facts : []);
      let added = 0;
      for (const source of sources) { if (renderProfessionalJob(source, facts)) added += 1; if (professionalJobState.count >= 40) break; }
      for (const fact of facts) {
        if (professionalJobState.count >= 40) break;
        const url = professionalSafeUrl(fact?.url); if (!url || professionalJobState.seen.has(url)) continue;
        const source = sources.find((item) => professionalSafeUrl(item?.url) === url) || { url, title: new URL(url).hostname };
        if (renderProfessionalJob(source, facts)) added += 1;
      }
      updateProfessionalJobCount();
      if (!added) status.textContent = more ? 'No additional distinct listings were found this time. Try broader keywords or another date range.' : 'No job listings were returned. Try broader keywords or a different location.';
      else status.textContent = (more ? 'Added ' : 'Found ') + added + ' new listing' + (added === 1 ? '.' : 's. Scroll the results to explore them.');
    } catch (error) { status.textContent = error.message || 'Job search failed. Please try again.'; }
    finally { professionalJobState.loading = false; run.disabled = false; moreButton.disabled = false; }
  }
  $('professionalSearchForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    professionalJobState.query = $('professionalSearchQuery').value.trim();
    professionalJobState.location = $('professionalSearchLocation').value.trim();
    professionalJobState.date_range = $('professionalSearchDate').value || 'any';
    professionalJobState.seen.clear(); professionalJobState.count = 0;
    $('professionalSearchCards').replaceChildren();
    $('professionalSearchResult').hidden = true;
    await runProfessionalJobSearch();
  });
  $('professionalSearchMore').addEventListener('click', () => runProfessionalJobSearch({ more: true }));

  $('researchForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = $('researchQuery').value.trim();
    const urls = $('researchUrls').value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).slice(0, 10);
    const button = $('researchRun');
    button.disabled = true;
    $('researchStatus').textContent = 'Planning research, reading sources, and checking evidence…';
    $('researchResult').hidden = true;
    try {
      const data = await api('/v1/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, urls }) });
      renderResearchReport(data);
      $('researchStatus').textContent = 'Research complete. Review the citations and limitations before relying on the findings.';
      await refreshResearchHistory();
    } catch (err) {
      $('researchStatus').textContent = err.message || 'Research could not be completed. Please try again.';
    } finally { button.disabled = false; }
  });
  document.querySelectorAll('[data-research-export]').forEach((button) => button.addEventListener('click', async () => {
    if (!activeResearchId) return;
    button.disabled = true;
    try {
      const token = await credential(false);
      const format = button.dataset.researchExport;
      const response = await net('/v1/research/' + encodeURIComponent(activeResearchId) + '/export?format=' + encodeURIComponent(format), { headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok) throw await errorFrom(response);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'nasrinai-research.' + ({markdown:'md',html:'html',json:'json'}[format] || 'txt');
      document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    } catch (err) { $('researchStatus').textContent = err.message || 'The report could not be exported.'; }
    finally { button.disabled = false; }
  }));
  $('researchSave').addEventListener('click', async () => {
    if (!activeResearchId) return;
    if (!account) { $('researchStatus').textContent = 'Sign in before saving research to your Library.'; return; }
    const confirmed = window.confirm('Save this research report to your Library? Nothing will be saved unless you confirm.');
    if (!confirmed) return;
    const button = $('researchSave');
    button.disabled = true;
    try {
      await api('/v1/research/' + encodeURIComponent(activeResearchId) + '/save-to-library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
      $('researchStatus').textContent = 'Saved to your Library.';
    } catch (err) { $('researchStatus').textContent = err.message || 'The report could not be saved to your Library.'; }
    finally { button.disabled = !account; }
  });

  // The drawer is for small screens; on a wide screen the side rail does this.
  window.matchMedia('(min-width: 70rem)').addEventListener?.('change', (e) => { if (e.matches) closeDrawer(false); });

  // The bottom tab bar is optional: this device only, off by default.
  const tabbarBox = $('tabbarOn');
  tabbarBox.checked = saved.get(KEYS.tabbar) === true;
  tabbarBox.addEventListener('change', () => {
    if (tabbarBox.checked) { saved.set(KEYS.tabbar, true); document.documentElement.setAttribute('data-tabbar', 'on'); }
    else { saved.del(KEYS.tabbar); document.documentElement.removeAttribute('data-tabbar'); }
  });

  // Optional bottom tab bar (docs/mobile-nav.md): Chat, Library, Projects,
  // Settings open the existing screens; the current tab follows what is open.
  // It shows only when the person turns it on (Settings > General).
  const tabbar = $('tabbar');
  function setActiveTab(name) {
    for (const b of tabbar.querySelectorAll('[data-tab]')) {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
  }
  function syncTabs() {
    if (!$('settings').hidden) return setActiveTab('settings');
    if (!historySheet.hidden) {
      const lib = $('tabLibrary'); const prj = $('tabProjects');
      if (lib && lib.getAttribute('aria-selected') === 'true') return setActiveTab('library');
      if (prj && prj.getAttribute('aria-selected') === 'true') return setActiveTab('projects');
    }
    setActiveTab('chat');
  }
  tabbar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    const tab = b.dataset.tab;
    if (tab === 'chat') { closeSettings(); closeHistory(); closeSignIn(); closePlans(); closePro(); return; }
    if (tab === 'settings') { openSettings(); return; }
    openHistory(tab);
  });
  new MutationObserver(syncTabs).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-selected'] });
  // While typing on a phone, the keyboard needs the room: the tab bar steps aside.
  // The bar comes back a moment after the box loses focus, so a tap on Send
  // lands before the message box moves up.
  let typingTimer = 0;
  input.addEventListener('focus', () => { clearTimeout(typingTimer); document.body.classList.add('is-typing'); });
  input.addEventListener('blur', () => {
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { if (document.activeElement !== input) document.body.classList.remove('is-typing'); }, 300);
  });
  // End tab bar

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
    // The Library is for saved files and media; conversations belong in Chats.
    const inKind = (f) => {
      if (f.kind === 'chat') return false;
      if (kind === 'all') return true;
      if (kind === 'docs') return ['file', 'file_sent', 'note', 'reply'].includes(f.kind);
      if (kind === 'photos') return ['photo_sent', 'photo_generated'].includes(f.kind);
      if (kind === 'videos') return f.kind === 'video_generated' || f.kind === 'video_sent';
      if (kind === 'generated') return f.kind === 'photo_generated' || f.kind === 'video_generated';
      return (LIB_GROUP[kind] || [kind]).includes(f.kind);
    };
    const stamp = (f) => String(f.updated_at || f.created_at);
    const list = libFiles.filter((f) => inKind(f) && (!q || String(f.title).toLowerCase().includes(q))).sort((a, b) => (
      sort === 'name' ? String(a.title).localeCompare(String(b.title))
        : sort === 'old' ? stamp(a).localeCompare(stamp(b))
          : stamp(b).localeCompare(stamp(a))));
    const c = (libInfo && libInfo.counts) || {};
    const n = (k) => Number(c[k]) || 0;
    $('libSummary').textContent = libInfo
      ? `${n('file') + n('file_sent') + n('note') + n('reply')} docs · ${n('photo_sent') + n('photo_generated')} images`
        + (libInfo.used && libInfo.used.bytes ? ` · ${bytesText(libInfo.used.bytes)} / ${bytesText(libInfo.used.max_bytes)}` : '')
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
      if (['file', 'note', 'reply'].includes(f.kind)) {
        const preview = mk('p', 'lib-list-preview', String(f.preview || 'Tap to preview this document.').slice(0, 240));
        preview.setAttribute('aria-label', 'Document preview');
        li.appendChild(preview);
        const actions = mk('div', 'lib-list-actions');
        const download = mk('button', 'btn small outline', 'Download');
        download.type = 'button';
        download.addEventListener('click', async () => {
          download.disabled = true;
          try {
            const doc = await api('/v1/library/' + encodeURIComponent(f.id));
            const blob = new Blob([String(doc.text || '')], { type: doc.format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = String(doc.title || f.title).replace(/[\\\\/\\u0000-\\u001f]/g, '_');
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (err) { $('libStatus').textContent = err.message || 'That document could not be downloaded.'; }
          finally { download.disabled = false; }
        });
        const remove = mk('button', 'btn small outline danger', 'Delete');
        remove.type = 'button';
        remove.addEventListener('click', async () => {
          if (!window.confirm(`Delete “${f.title}” from your Library? This cannot be undone.`)) return;
          remove.disabled = true;
          try {
            await api('/v1/storage/' + encodeURIComponent(f.kind) + '/' + encodeURIComponent(f.id), { method: 'DELETE' });
            await loadLibrary();
            $('libStatus').textContent = 'Deleted.';
          } catch (err) { $('libStatus').textContent = err.message || 'That document could not be deleted.'; }
          finally { remove.disabled = false; }
        });
        actions.append(download, remove);
        li.appendChild(actions);
      }
      return li;
    }));
    $('libStatus').textContent = list.length ? '' : q ? 'Nothing found.' : kind !== 'all' ? 'Nothing here yet.'
      : 'Your Library is empty. Files, notes and photos you send or make will be kept here.';
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
  $('projectLeave').addEventListener('click', () => startNewChat());

  // ---------- the coding chat ----------
  // Code (menu, desktop rail, "Start coding", a project's Code) asks for a
  // project first, then opens a coding chat in it: coding experts, coding
  // rules on the server, and the project + leave buttons at the top.
  const inputHint = input.placeholder;
  function setCoding(p) {
    codingProject = p && typeof p.id === 'string' ? { id: p.id, name: String(p.name || 'Project') } : null;
    document.body.classList.toggle('coding-mode', Boolean(codingProject));
    $('codingBar').hidden = !codingProject;
    $('codingProjectName').textContent = codingProject ? codingProject.name : '';
    $('codingProjectName').hidden = !codingProject;
    const switcher = $('codingProject');
    switcher.title = codingProject ? 'Switch project (now: ' + codingProject.name + ')' : 'Switch project';
    switcher.setAttribute('aria-label', switcher.title);
    input.placeholder = codingProject ? 'Describe what to build, or paste code' : inputHint;
    if (codingProject) saved.set(KEYS.coding, codingProject); else saved.del(KEYS.coding);
    if (codingProject && account) loadGithub();
    renderProButton();
  }
  function enterCoding(p) {
    startNewChat({ keepCoding: true, focus: false });
    setCoding(p);
    setChatProject(p);
    notice.textContent = 'Coding chat in ' + codingProject.name + '.';
    input.focus();
  }
  const codePicker = $('codePicker');
  async function openCodePicker() {
    if (!account) { openSignIn('Sign in to use the coding chat with your projects.'); return; }
    if (!projectsOn) { notice.textContent = 'Projects are turned off, so the coding chat is not available.'; return; }
    closeSettings(); closeHistory(); closeSignIn(); closePlans(); closePro();
    lastFocus = document.activeElement;
    scrim.hidden = false;
    codePicker.hidden = false;
    $('codePickerName').value = '';
    loadGithub();
    const list = $('codePickerList');
    const status = $('codePickerStatus');
    list.replaceChildren();
    status.textContent = 'Loading your projects…';
    try {
      const data = await api('/v1/projects');
      const projects = (data.projects || []).filter((p) => p && typeof p.id === 'string' && p.status !== 'done');
      list.replaceChildren(...projects.map((p) => {
        const li = mk('li', 'history-item');
        const b = mk('button', 'history-open code-picker-item' + (codingProject && codingProject.id === p.id ? ' is-current' : ''));
        b.type = 'button';
        b.append(mk('span', 'history-title', p.name), mk('span', 'history-time', codingProject && codingProject.id === p.id ? 'Current · new coding chat' : when(p.updated_at)));
        b.addEventListener('click', () => { closeCodePicker(); enterCoding(p); });
        li.appendChild(b);
        return li;
      }));
      status.textContent = projects.length ? '' : 'No projects yet. Name one below to start.';
      if (!projects.length) $('codePickerName').focus();
    } catch (err) {
      status.textContent = err.message || 'Your projects could not be loaded.';
    }
  }
  function closeCodePicker() {
    if (codePicker.hidden) return;
    codePicker.hidden = true;
    scrim.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('codePickerClose').addEventListener('click', closeCodePicker);
  $('codePickerNew').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('codePickerName').value.trim();
    if (!name) return;
    const btn = $('codePickerCreate');
    btn.disabled = true;
    $('codePickerStatus').textContent = 'Creating…';
    try {
      const p = await api('/v1/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description: '', instructions: '' }) });
      closeCodePicker();
      enterCoding(p);
    } catch (err) {
      $('codePickerStatus').textContent = err.message || 'The project could not be created.';
    } finally { btn.disabled = false; }
  });
  $('codingProject').addEventListener('click', openCodePicker);
  $('codingExit').addEventListener('click', () => { setCoding(null); startNewChat(); });
  $('drawerCode').addEventListener('click', () => { closeDrawer(false); openCodePicker(); });
  $('desktopCodeBtn')?.addEventListener('click', openCodePicker);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !codePicker.hidden) closeCodePicker(); });

  // ---------- GitHub (docs/github.md) ----------
  // Connect your GitHub account in the project picker; under a coding reply
  // with files, "Open pull request" adds them on a new branch after Confirm.
  async function loadGithub() {
    try {
      const st = await api('/v1/github/status');
      github = { available: st.available === true, connected: st.connected === true, login: st.login || null, install: st.install_url || null, autoPr: false,
        accounts: Array.isArray(st.accounts) ? st.accounts.filter((a) => a && typeof a.login === 'string') : [], max: Number(st.max_accounts) || 10 };
      if (github.connected) github.autoPr = (await api('/v1/settings').catch(() => null))?.prefs?.autoPr === true;
    } catch { github = { available: false, connected: false, login: null, install: null, autoPr: false, accounts: [], max: 10 }; }
    renderGithub();
  }
  function renderGithub() {
    document.body.classList.toggle('github-on', github.available && Boolean(account));
    const on = github.connected;
    // Connected plugins are listed first, under Connected.
    $(on ? 'pluginsConnected' : 'pluginsDev').appendChild($('ghCard'));
    $('pluginsConnectedLabel').hidden = !$('pluginsConnected').children.length;
    $('pluginsDevLabel').hidden = !$('pluginsDev').children.length;
    $('ghSub').textContent = !github.available ? 'Not switched on for this site yet' : on ? 'Connected · @' + github.login + (github.accounts.length > 1 ? ' · ' + github.accounts.length + ' accounts' : '') + (github.autoPr ? ' · automatic pull requests' : '') : 'Not connected';
    $('codeGithubBtn').hidden = !github.available;
    $('codeGithubBtn').firstElementChild.textContent = on ? 'Disconnect' : 'Connect GitHub';
    $('codeGithubBtn').classList.toggle('danger', on);
    $('ghReconnect').hidden = !on;
    const inst = $('codeGithubInstall');
    inst.hidden = !(on && github.install);
    if (github.install) inst.href = github.install;
    // Settings page
    $('autoPrRow').hidden = !on;
    $('autoPrOn').checked = github.autoPr;
    $('codeGithubText').textContent = !github.available
      ? 'GitHub is not switched on for this site yet.'
      : 'Read your repositories and open pull requests on a new branch from the coding chat, ' + (on && github.autoPr ? 'automatically after Nasrin writes files.' : 'after you confirm each one.');
    // Connected accounts: each with Main / Make main and Remove.
    $('ghAccounts').replaceChildren(...github.accounts.map((acc) => {
      const row = mk('div', 'menu-row plugin-account');
      const avatar = mk('span', 'plugin-avatar', acc.login.slice(0, 1).toUpperCase());
      avatar.setAttribute('aria-hidden', 'true');
      row.append(avatar, mk('span', 'plugin-login', '@' + acc.login));
      if (acc.main) row.appendChild(mk('em', 'plugin-main-tag', 'Main'));
      else {
        const b = mk('button', 'plugin-link', 'Make main');
        b.type = 'button';
        b.setAttribute('aria-label', 'Make @' + acc.login + ' the main account');
        b.addEventListener('click', () => ghMakeMain(acc.login, b));
        row.appendChild(b);
      }
      const rm = mk('button', 'plugin-link danger', 'Remove');
      rm.type = 'button';
      rm.setAttribute('aria-label', 'Remove @' + acc.login);
      rm.addEventListener('click', () => ghDisconnect(rm, acc.login));
      row.appendChild(rm);
      return row;
    }));
    $('ghAddAccount').hidden = !on || github.accounts.length >= github.max;
    $('ghAccountsHint').hidden = !on;
    $('ghDetailConnect').hidden = !github.available;
    $('ghDetailConnect').firstElementChild.textContent = on ? 'Reconnect main account' : 'Connect GitHub';
    $('ghDetailDisconnect').hidden = !on;
    // Keep the Developer tools catalog card in sync with live GitHub state.
    // The catalog is built once at load time (before loadGithub resolves), so
    // without this the GitHub card would always read "Not configured".
    const ghDevStatus = document.querySelector('.developer-tool-item[data-plugin-name="GitHub"] .plugins-soon');
    if (ghDevStatus) ghDevStatus.textContent = on ? 'Connected' : github.available ? 'Available' : 'Not configured';
  }
  async function ghConnect(btn, add = false) {
    if (btn) btn.disabled = true;
    try {
      const r = await api('/v1/github/connect' + (add ? '?add=1' : ''), { method: 'POST' });
      if (r && typeof r.url === 'string' && r.url.startsWith('https://github.com/')) location.assign(r.url);
    } catch (err) {
      $('githubStatus').textContent = err.message || 'GitHub could not be reached.';
    } finally { if (btn) btn.disabled = false; }
  }
  async function ghDisconnect(btn, login = null) {
    if (!confirm(login ? 'Remove @' + login + '? Nasrin will forget this GitHub sign-in.' : 'Disconnect GitHub? Nasrin will forget all your GitHub sign-ins.')) return;
    if (btn) btn.disabled = true;
    try {
      await api('/v1/github' + (login ? '?login=' + encodeURIComponent(login) : ''), { method: 'DELETE' });
      await loadGithub();
      $('githubStatus').textContent = login ? '@' + login + ' is removed.' : 'GitHub is disconnected.';
    } catch (err) {
      $('githubStatus').textContent = err.message || 'GitHub could not be reached.';
    } finally { if (btn) btn.disabled = false; }
  }
  $('codeGithubBtn').addEventListener('click', (e) => (github.connected ? ghDisconnect(e.currentTarget) : ghConnect(e.currentTarget)));
  $('ghReconnect').addEventListener('click', (e) => ghConnect(e.currentTarget));
  $('ghDetailConnect').addEventListener('click', (e) => ghConnect(e.currentTarget));
  $('ghDetailDisconnect').addEventListener('click', (e) => ghDisconnect(e.currentTarget));
  $('ghAddAccount').addEventListener('click', (e) => ghConnect(e.currentTarget, true));
  async function ghMakeMain(login, btn) {
    btn.disabled = true;
    try {
      await api('/v1/github/main', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login }) });
      await loadGithub();
      $('githubStatus').textContent = '@' + login + ' is now your main GitHub account.';
    } catch (err) {
      $('githubStatus').textContent = err.message || 'This could not be saved.';
      btn.disabled = false;
    }
  }
  // The GitHub row opens its actions; Settings opens the GitHub page.
  $('ghToggle').addEventListener('click', () => {
    const open = $('ghActions').hidden;
    $('ghActions').hidden = !open;
    $('ghToggle').setAttribute('aria-expanded', String(open));
  });
  function showPluginDetail(on) {
    $('pluginsList').hidden = on;
    $('pluginDetail').hidden = !on;
    $('githubTitle').lastChild.textContent = on ? 'GitHub' : 'Plugins';
    (on ? $('ghBack') : $('ghToggle')).focus();
  }
  $('ghSettingsBtn').addEventListener('click', () => showPluginDetail(true));
  $('ghBack').addEventListener('click', () => showPluginDetail(false));
  $('ghReport').addEventListener('click', () => { closeGithub(); openSettings(); showPage('helpSupport'); });
  {
    const back = new URLSearchParams(location.search).get('github');
    if (back) {
      history.replaceState(null, '', location.pathname);
      notice.textContent = { connected: 'GitHub is connected.', installed: 'GitHub repositories updated.', limit: 'You already have 10 GitHub accounts connected. Remove one to add another.', failed: 'GitHub was not connected. Please try again.' }[back] || '';
    }
  }

  // More plugins, not connected yet (docs/plugins.md): shown as Coming soon,
  // never as connected. Simple shared glyphs, not the companies' logos.
  const PLUGIN_GLYPHS = {
    mail: [['path', { d: 'M4 6.5h16v11H4z' }], ['path', { d: 'm4.5 7 7.5 6 7.5-6' }]],
    cloud: [['path', { d: 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.6 4.2 4.2 0 0 0 7 18z' }]],
    team: [['circle', { cx: '9', cy: '9', r: '3' }], ['circle', { cx: '17', cy: '10', r: '2.3' }], ['path', { d: 'M3.5 18.5a5.5 5.5 0 0 1 11 0M14.5 18.5a4 4 0 0 1 6-3.4' }]],
    sheet: [['path', { d: 'M5 4.5h14v15H5z' }], ['path', { d: 'M5 9.5h14M5 14.5h14M10 4.5v15' }]],
    slides: [['path', { d: 'M4 5h16v11H4z' }], ['path', { d: 'M12 16v3.5M8.5 19.5h7M8 9h5M8 12h8' }]],
    design: [['circle', { cx: '12', cy: '12', r: '8' }], ['circle', { cx: '9', cy: '10', r: '1.2' }], ['circle', { cx: '14.5', cy: '9', r: '1.2' }], ['circle', { cx: '15.5', cy: '13.5', r: '1.2' }]],
    video: [['path', { d: 'M4 7h11v10H4z' }], ['path', { d: 'm15 10.5 5-3v9l-5-3' }]],
    note: [['path', { d: 'M6 3.5h9l3 3V20H6z' }], ['path', { d: 'M15 3.5V7h3M9 11h6M9 14.5h6M9 18h4' }]],
    map: [['path', { d: 'm3.5 6 5-2.5 7 2.5 5-2.5v14l-5 2.5-7-2.5-5 2.5z' }], ['path', { d: 'M8.5 3.5v14M15.5 6v14' }]],
    search: [['circle', { cx: '10.8', cy: '10.8', r: '6.3' }], ['path', { d: 'm15.5 15.5 4.2 4.2' }]],

    calendar: [['path', { d: 'M4.5 6h15v13.5h-15z' }], ['path', { d: 'M4.5 10h15M8.5 4v4M15.5 4v4' }]],
    social: [['circle', { cx: '12', cy: '12', r: '8' }], ['path', { d: 'M12 7.5v9M8.5 11h7' }]],
    photo: [['rect', { x: '4.5', y: '4.5', width: '15', height: '15', rx: '4.5' }], ['circle', { cx: '12', cy: '12', r: '3.5' }], ['circle', { cx: '16.3', cy: '7.7', r: '.6' }]],
    thread: [['path', { d: 'M16.5 11c0-3-1.8-5-4.5-5S7.5 8.3 7.5 12s2 6 4.8 6c2 0 3.8-1.2 3.8-3.2 0-2.3-2.4-3-4.6-2.6-1.5.3-2 1.3-1.6 2.2' }]],
    post: [['path', { d: 'M5 5l14 14M19 5 5 19' }]],
    chat: [['path', { d: 'M5 17.5V7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6a2.5 2.5 0 0 1-2.5 2.5H9z' }]],
    phone: [['path', { d: 'M5 19l1.2-3.6A7.5 7.5 0 1 1 9 18z' }], ['path', { d: 'M9.5 9.5c.3 2 2 3.8 4 4.2l1-1.2' }]]
  };
  const MORE_PLUGINS = [
    // Google integrations have dedicated connection cards; avoid duplicate entries.
    ['Microsoft 365', [['Outlook', 'mail'], ['OneDrive', 'cloud'], ['Teams', 'team'], ['Excel', 'sheet'], ['PowerPoint', 'slides']]],
    ['Design & creativity', [['Canva', 'design']]],
    ['Social & messaging', [['Facebook', 'social'], ['Instagram', 'photo'], ['Threads', 'thread'], ['X', 'post'], ['Messenger', 'chat'], ['WhatsApp', 'phone']]]
  ];
  const DEVELOPER_PLUGINS = [
    ['GitHub', 'cloud', 'https://github.com'],
    ['Vercel', 'cloud', 'https://vercel.com'],
    ['Render', 'cloud', 'https://render.com'],
    ['Supabase', 'cloud', 'https://supabase.com'],
    ['Cloudflare', 'cloud', 'https://cloudflare.com'],
    ['ElevenLabs', 'cloud', 'https://elevenlabs.io']
  ];
  // Each catalog entry has a Settings action. Pins are a local, account-scoped
  // display preference only; they never imply a connection or grant permissions.
  const pluginCatalogPinKey = () => identityKey('nasrin.plugin-catalog-pins.v1');
  function readPluginCatalogPins() {
    try {
      const value = JSON.parse(localStorage.getItem(pluginCatalogPinKey()) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }
  function writePluginCatalogPins(pins) {
    try { localStorage.setItem(pluginCatalogPinKey(), JSON.stringify(pins)); return true; }
    catch { $('pluginCatalogStatus').textContent = 'Could not save this preference in this browser.'; return false; }
  }
  const pluginAccessProfiles = {
    Gmail: { service: 'gmail', readService: 'gmail', writeService: 'gmail-readwrite', supported: true, readScope: 'https://www.googleapis.com/auth/gmail.readonly', writeScope: 'https://www.googleapis.com/auth/gmail.modify', account: 'Google' },
    'Google Calendar': { service: 'calendar', readService: 'calendar', writeService: 'calendar-write', supported: true, readScope: 'https://www.googleapis.com/auth/calendar.readonly', writeScope: 'https://www.googleapis.com/auth/calendar.events', account: 'Google' },
    'Google Drive': { service: 'drive', readService: 'drive', supported: true, readScope: 'https://www.googleapis.com/auth/drive.readonly', account: 'Google' },
    'Google Meet': { service: 'meet', readService: 'meet', supported: true, readScope: 'https://www.googleapis.com/auth/meetings.space.created', account: 'Google' },
    'Google Keep': { service: 'keep', readService: 'keep', supported: true, readScope: 'https://www.googleapis.com/auth/keep.readonly', account: 'Google' },
    'Google Maps': { service: 'maps', supported: true, siteConfigured: true, account: 'Google' },
    Outlook: { supported: false }, 'Microsoft Outlook': { supported: false }, OneDrive: { supported: false },
    Teams: { supported: false }, Excel: { supported: false }, PowerPoint: { supported: false },
    Canva: { supported: false }, Facebook: { supported: false }, Instagram: { supported: false },
    Threads: { supported: false }, X: { supported: false }, Messenger: { supported: false },
    WhatsApp: { supported: false }
  };
  function openPluginCatalogSettings(name, li, status = 'Coming soon', description = 'Manage this app’s catalog preference and review its availability.') {
    $('pluginsList').hidden = true;
    $('pluginCatalogSettings').hidden = false;
    $('pluginCatalogTitle').textContent = name + ' settings';
    $('pluginCatalogDescription').textContent = description;
    $('pluginCatalogStatus').textContent = status;
    // Classify by the app's actual provider/function, not by whichever
    // catalog section happened to render it. Keep this mapping explicit.
    const pluginFamilyByName = {
      Gmail: 'Google', 'Google Calendar': 'Google', 'Google Drive': 'Google',
      'Google Meet': 'Google', 'Google Keep': 'Google',
      'Google Maps': 'Google',
      Outlook: 'Microsoft 365', 'Microsoft Outlook': 'Microsoft 365', OneDrive: 'Microsoft 365',
      Teams: 'Microsoft 365', Excel: 'Microsoft 365', PowerPoint: 'Microsoft 365',
      Canva: 'Design & creativity', Facebook: 'Social & messaging', Instagram: 'Social & messaging',
      Threads: 'Social & messaging', X: 'Social & messaging',
      Messenger: 'Social & messaging', WhatsApp: 'Social & messaging',
      GitHub: 'Developer tools'
    };
    const catalogGroup = pluginFamilyByName[name] || 'Other integrations';
    const catalogDeveloper = ['Google', 'Microsoft'].includes(catalogGroup) ? catalogGroup
      : catalogGroup === 'Design' ? 'Canva'
        : catalogGroup === 'Developer tools' ? 'NasrinAI' : 'Third-party provider';
    const catalogWebsite = {
      Gmail: 'https://mail.google.com', 'Google Calendar': 'https://calendar.google.com',
      'Google Drive': 'https://drive.google.com', 'Google Meet': 'https://meet.google.com',
      'Google Keep': 'https://keep.google.com',
      'Google Maps': 'https://maps.google.com', Outlook: 'https://outlook.live.com',
      OneDrive: 'https://onedrive.live.com', Teams: 'https://teams.microsoft.com',
      Excel: 'https://www.microsoft.com/microsoft-365/excel', PowerPoint: 'https://www.microsoft.com/microsoft-365/powerpoint',
      Canva: 'https://www.canva.com', Facebook: 'https://www.facebook.com',
      Instagram: 'https://www.instagram.com', Threads: 'https://www.threads.net',
      X: 'https://x.com', Messenger: 'https://www.messenger.com', WhatsApp: 'https://www.whatsapp.com'
    };
    $('pluginCatalogCategory').textContent = catalogGroup === 'Developer tools' ? catalogGroup : catalogGroup + ' apps';
    $('pluginCatalogDeveloper').textContent = catalogDeveloper;
    $('pluginCatalogWebsite').href = catalogWebsite[name] || 'https://nasrinai.com';
    const profile = pluginAccessProfiles[name] || { supported: false };
    const serviceStatus = googleStatus[profile.service] || { available: false, connected: false, scopes: [], email: null };
    const connectedGoogle = profile.account === 'Google' && serviceStatus.connected && Boolean(profile.service);
    const configuredService = Boolean(profile.siteConfigured && serviceStatus.available);
    const hasWrite = Boolean(profile.writeScope && serviceStatus.scopes.includes(profile.writeScope));
    const hasRead = Boolean((profile.readScope && serviceStatus.scopes.includes(profile.readScope)) || hasWrite);
    const isConnected = profile.siteConfigured ? configuredService : Boolean(connectedGoogle && (hasRead || hasWrite));
    $('pluginCatalogAccountLabel').textContent = catalogGroup === 'Google' ? 'Google account'
      : catalogGroup === 'Microsoft' ? 'Microsoft account'
        : catalogGroup === 'Design' ? 'Canva account'
          : catalogGroup === 'Social & messaging' ? 'App account' : 'Connected account';
    const accountEmail = serviceStatus.email || '';
    $('pluginCatalogAccountAvatar').textContent = (accountEmail || name).trim().charAt(0).toUpperCase() || 'A';
    $('pluginCatalogAccountStatus').textContent = isConnected
      ? (accountEmail || 'Connected')
      : profile.supported && !serviceStatus.available ? 'Not configured on this site'
        : 'Not connected';
    $('pluginCatalogAccountMain').hidden = !isConnected;
    $('pluginCatalogAccountRow').hidden = !profile.supported && !isConnected;
    $('pluginCatalogAccountHint').textContent = profile.siteConfigured
      ? 'This app uses a server-side Google API configuration. API keys remain on the server and are never exposed to the browser.'
      : profile.supported
        ? (isConnected
          ? 'This Google app has its own independent connection. Multiple accounts per app are not enabled yet, so your existing connection is protected from accidental replacement.'
          : 'Connect an account, then choose the permissions this app may use. Each Google app has its own independent connection.')
        : 'This app cannot connect yet. Account and permission controls stay disabled until its secure integration is implemented.';
    $('pluginCatalogConnect').hidden = !profile.supported || profile.siteConfigured;
    $('pluginCatalogConnect').disabled = !profile.supported || !serviceStatus.available;
    $('pluginCatalogConnect').textContent = isConnected ? 'Reconnect account' : 'Connect account';
    $('pluginCatalogConnect').classList.remove('danger');
    $('pluginCatalogConnect').onclick = () => {
      if (profile.supported && serviceStatus.available) connectGoogle(profile.service);
    };
    $('pluginCatalogDisconnect').hidden = !isConnected || profile.siteConfigured;
    $('pluginCatalogDisconnect').onclick = () => {
      if (profile.service) disconnectGoogle(profile.service);
    };
    $('pluginCatalogAddAccount').hidden = !isConnected || !profile.supported || profile.siteConfigured;
    $('pluginCatalogAddAccount').disabled = true;
    $('pluginCatalogAddAccount').title = 'Multiple accounts are not enabled for this Google app yet.';
    $('pluginCatalogAddAccount').onclick = () => {
      $('pluginCatalogPermissionHint').textContent = 'Adding multiple accounts is not enabled for this Google app yet. Your current connection has not been changed.';
    };
    $('pluginCatalogReadOnly').checked = hasRead;
    $('pluginCatalogReadWrite').checked = hasWrite;
    $('pluginCatalogReadOnly').disabled = !profile.supported || !profile.readScope || !serviceStatus.available;
    $('pluginCatalogReadWrite').disabled = !profile.supported || !profile.writeScope || !serviceStatus.available;
    $('pluginCatalogConfigure').hidden = profile.siteConfigured;
    $('pluginCatalogConfigure').disabled = !profile.supported || !serviceStatus.available;
    $('pluginCatalogConfigure').textContent = isConnected ? 'Reconnect to update access' : 'Configure access';
    $('pluginCatalogConfigure').onclick = () => {
      if (!profile.supported) return;
      const readSelected = $('pluginCatalogReadOnly').checked;
      const writeSelected = $('pluginCatalogReadWrite').checked;
      if (!readSelected && !writeSelected) {
        $('pluginCatalogPermissionHint').textContent = 'Select Read-only access or Read and write access before continuing.';
        return;
      }
      const service = writeSelected ? profile.writeService : profile.readService;
      if (!service) {
        $('pluginCatalogPermissionHint').textContent = 'This access level is not available for this integration yet.';
        return;
      }
      $('pluginCatalogPermissionHint').textContent = 'Continue to Google to authorize the selected access level. Google may require additional verification for sensitive or restricted scopes.';
      connectGoogle(service);
    };
    $('pluginCatalogPermissionHint').textContent = profile.supported
      ? (isConnected ? 'Checked permissions reflect scopes currently granted by Google. Changes require reconnecting and approving the provider request.' : 'Choose a supported permission, then configure access through Google authorization.')
      : 'No permissions are active for this app. Options become available after a secure integration is implemented.';
    $('pluginCatalogUnavailable').hidden = profile.supported;
    $('pluginCatalogActions').replaceChildren();
    const pins = readPluginCatalogPins();
    $('pluginCatalogPinned').checked = pins[name] === true;
    $('pluginCatalogPinned').onchange = () => {
      const next = readPluginCatalogPins();
      if ($('pluginCatalogPinned').checked) next[name] = true;
      else delete next[name];
      if (!writePluginCatalogPins(next)) {
        $('pluginCatalogPinned').checked = !next[name];
        return;
      }
      if (li) {
        li.dataset.pinned = next[name] ? '1' : '0';
        const list = li.parentElement;
        [...list.children].sort((a, b) => Number(b.dataset.pinned === '1') - Number(a.dataset.pinned === '1'))
          .forEach((item) => list.appendChild(item));
      }
      $('pluginCatalogStatus').textContent = next[name] ? 'Pinned in the catalog.' : 'Pin removed.';
    };
    $('githubTitle').lastChild.textContent = name;
    $('pluginCatalogBack').focus();
  }
  $('pluginCatalogBack').addEventListener('click', () => {
    $('pluginCatalogSettings').hidden = true;
    $('pluginsList').hidden = false;
    $('githubTitle').lastChild.textContent = 'Plugins';
    $('githubClose').focus();
  });
  const DEVELOPER_TOOL_DETAILS = {
    Vercel: ['Connected accounts', 'Projects', 'Deployments', 'Build status', 'Permissions', 'Integration information'],
    Render: ['Connected accounts', 'Services', 'Projects', 'Deployments', 'Build status', 'Permissions', 'Integration information'],
    Supabase: ['Connected accounts', 'Projects', 'Database health', 'Migrations', 'Permissions', 'Integration information'],
    Cloudflare: ['Connected accounts', 'Domains', 'Add domain', 'Security status', 'DNS', 'Permissions', 'Integration information'],
    ElevenLabs: ['Video Studio voiceover', 'Sound-effect generation', 'Voice selection', 'MP3 preview and download']
  };
  function openDeveloperToolSettings(name, website) {
    $('pluginsList').hidden = true;
    $('pluginCatalogSettings').hidden = false;
    $('pluginCatalogTitle').textContent = name + ' settings';
    $('pluginCatalogCategory').textContent = 'Developer tools';
    $('pluginCatalogDeveloper').textContent = 'NasrinAI';
    $('pluginCatalogWebsite').href = website;
    $('pluginCatalogWebsite').textContent = 'Open ' + name + ' dashboard';
    $('pluginCatalogDescription').textContent = (DEVELOPER_TOOL_DETAILS[name] || ['Connected accounts', 'Permissions', 'Integration information']).join(' · ');
    $('pluginCatalogStatus').textContent = name === 'GitHub'
      ? (github.connected ? 'Connected through NasrinAI GitHub' : 'GitHub connection status is managed in the coding settings.')
      : name === 'ElevenLabs' ? 'Checking Video Studio configuration…'
        : 'API connection not configured yet. No account is connected through NasrinAI.';
    if (name === 'ElevenLabs') {
      fetch('/v1/video-studio/elevenlabs/status', { credentials: 'same-origin' }).then(async response => {
        if (!response.ok) throw new Error('status unavailable');
        return response.json();
      }).then(status => {
        if ($('pluginCatalogTitle').textContent === 'ElevenLabs settings') $('pluginCatalogStatus').textContent = status.configured
          ? 'Configured for Video Studio voiceover and sound effects'
          : 'Not configured on this deployment';
      }).catch(() => {
        if ($('pluginCatalogTitle').textContent === 'ElevenLabs settings') $('pluginCatalogStatus').textContent = 'Could not verify Video Studio configuration.';
      });
    }
    $('githubTitle').lastChild.textContent = name;
    $('pluginCatalogBack').focus();
  }
  function developerToolCard(name, glyph, website) {
    const li = mk('li', 'plugins-item developer-tool-item');
    li.dataset.pluginName = name;
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'plugins-glyph');
    for (const [tag, attrs] of PLUGIN_GLYPHS[glyph]) {
      const el = document.createElementNS(svgNs, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.appendChild(el);
    }
    li.appendChild(svg);
    li.appendChild(mk('span', 'plugins-name', name));
    const state = name === 'GitHub'
      ? (github.connected ? 'Connected' : github.available ? 'Available' : 'Not configured')
      : name === 'ElevenLabs' ? 'Checking…'
        : 'Not connected';
    const stateLabel = mk('span', 'plugins-soon', state);
    li.appendChild(stateLabel);
    if (name === 'ElevenLabs') {
      fetch('/v1/video-studio/elevenlabs/status', { credentials: 'same-origin' }).then(async response => {
        if (!response.ok) throw new Error('status unavailable');
        return response.json();
      }).then(status => {
        stateLabel.textContent = status.configured ? 'Configured' : 'Not configured';
      }).catch(() => { stateLabel.textContent = 'Status unavailable'; });
    }
    const actions = mk('details', 'developer-tool-actions');
    const summary = mk('summary', 'plugins-settings-btn', 'Actions');
    summary.setAttribute('aria-label', name + ' integration actions');
    actions.appendChild(summary);
    const menu = mk('div', 'developer-tool-menu');
    const settings = mk('button', 'btn outline small', 'Settings');
    settings.type = 'button';
    settings.addEventListener('click', () => {
      actions.open = false;
      openDeveloperToolSettings(name, website);
    });
    const connect = mk('button', 'btn small', name === 'ElevenLabs' ? 'Open Video Studio' : name === 'GitHub' && github.connected ? 'Disconnect' : 'Connect');
    connect.type = 'button';
    if (name === 'ElevenLabs') {
      connect.addEventListener('click', () => { actions.open = false; window.location.href = '/video-studio.html'; });
    } else if (name === 'GitHub') {
      connect.addEventListener('click', async () => {
        actions.open = false;
        if (github.connected) {
          const disconnectButton = $('ghDetailDisconnect');
          if (disconnectButton && !disconnectButton.hidden) disconnectButton.click();
          else openDeveloperToolSettings(name, website);
        } else {
          const connectButton = $('ghDetailConnect');
          if (connectButton && !connectButton.hidden) connectButton.click();
          else openDeveloperToolSettings(name, website);
        }
      });
    } else {
      connect.addEventListener('click', () => {
        actions.open = false;
        openDeveloperToolSettings(name, website);
        $('pluginCatalogStatus').textContent = 'Connection is not enabled yet. Provider OAuth, encrypted token storage, and server-side API routes must be configured before connecting an account.';
      });
    }
    menu.append(settings, connect);
    actions.appendChild(menu);
    li.appendChild(actions);
    return li;
  }
  {
    const box = $('pluginsMore');
    const svgNs = 'http://www.w3.org/2000/svg';
    const pins = readPluginCatalogPins();
    box.appendChild(mk('p', 'plugins-group developer-tools-heading', 'Developer tools'));
    const devList = mk('ul', 'plugins-list developer-tools-list');
    for (const [name, glyph, website] of DEVELOPER_PLUGINS) devList.appendChild(developerToolCard(name, glyph, website));
    box.appendChild(devList);
    for (const [group, items] of MORE_PLUGINS) {
      box.appendChild(mk('p', 'plugins-group', group));
      const ul = mk('ul', 'plugins-list');
      for (const [name, glyph] of items) {
        const li = mk('li', 'plugins-item');
        li.dataset.pluginName = name;
        li.dataset.pinned = pins[name] === true ? '1' : '0';
        const svg = document.createElementNS(svgNs, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('class', 'plugins-glyph');
        for (const [tag, attrs] of PLUGIN_GLYPHS[glyph]) {
          const el = document.createElementNS(svgNs, tag);
          for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
          svg.appendChild(el);
        }
        const catalogBrandAssets = {
          'Google Meet': '/assets/brand/google-meet.svg',
          'Google Keep': '/assets/brand/google-keep.svg',
          'Google Maps': '/assets/brand/google-maps.svg',
          Outlook: '/assets/brand/outlook.svg',
          GitHub: '/assets/brand/github.svg'
        };
        const catalogBrandAsset = catalogBrandAssets[name];
        if (catalogBrandAsset) {
          const logo = document.createElement('img');
          logo.src = catalogBrandAsset;
          logo.alt = '';
          logo.width = 24;
          logo.height = 24;
          logo.loading = 'lazy';
          logo.decoding = 'async';
          logo.setAttribute('aria-hidden', 'true');
          logo.setAttribute('class', 'plugins-glyph plugins-product-logo');
          logo.addEventListener('error', () => {
            logo.replaceWith(svg);
          }, { once: true });
          li.appendChild(logo);
        } else li.appendChild(svg);
        li.appendChild(mk('span', 'plugins-name', name));
        const availabilityTag = mk('span', 'plugins-soon', ['Google Meet', 'Google Keep', 'Google Maps'].includes(name) ? 'Available' : 'Coming soon');
        if (['Google Meet', 'Google Keep', 'Google Maps'].includes(name)) availabilityTag.classList.add('plugins-available');
        li.appendChild(availabilityTag);
        const settings = mk('button', 'plugins-settings-btn', 'Settings');
        settings.type = 'button';
        settings.setAttribute('aria-label', name + ' settings');
        settings.addEventListener('click', () => {
          const descriptions = {
            'Google Meet': 'Connect Google Meet to let NasrinAI create meeting spaces and return shareable meeting links. Google API access and OAuth approval may be required.',
            'Google Keep': 'Connect Google Keep to let NasrinAI read your recent notes and lists. Keep API access may require an eligible Google Workspace account and Google approval.',
            'Google Maps': 'Use the server-configured Google Maps Places integration to search places and businesses. The API key stays on the server and is never exposed to the browser.'
          };
          const profile = pluginAccessProfiles[name] || {};
          const status = profile.siteConfigured
            ? (googleStatus.maps?.available ? 'Available · configured by NasrinAI' : 'Needs server configuration')
            : (googleStatus[profile.service]?.connected ? 'Connected' : googleStatus[profile.service]?.available ? 'Ready to connect' : 'Needs OAuth configuration');
          openPluginCatalogSettings(name, li, status, descriptions[name] || 'Manage this integration.');
        });
        li.appendChild(settings);
        ul.appendChild(li);
      }
      [...ul.children].sort((a, b) => Number(b.dataset.pinned === '1') - Number(a.dataset.pinned === '1'))
        .forEach((item) => ul.appendChild(item));
      box.appendChild(ul);
    }
  }

  // Gmail and Google Calendar use the server-side OAuth integration. These rows
  // only show Connected when the authenticated status endpoint confirms scopes.
  const googlePlugins = {};
  function makeGooglePlugin(service, title, glyph) {
    const card = mk('div', 'plugin-card');
    card.id = service === 'gmail' ? 'googleGmailCard' : 'googleCalendarCard';
    const head = mk('button', 'plugin-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');
    const icon = mk('span', 'plugin-icon');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'gh-mark');
    for (const [tag, attrs] of PLUGIN_GLYPHS[glyph]) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      svg.appendChild(el);
    }
    const brand = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    brand.setAttribute('viewBox', '0 0 48 48');
    brand.setAttribute('aria-hidden', 'true');
    brand.setAttribute('class', 'gh-mark plugin-brand-logo');
    const brandAssets = {
      Gmail: '/assets/brand/gmail.svg',
      'Google Calendar': '/assets/brand/google-calendar.svg',
      'Google Drive': '/assets/brand/google-drive.svg',
      'Google Meet': '/assets/brand/google-meet.svg',
      'Google Keep': '/assets/brand/google-keep.svg',
      'Google Maps': '/assets/brand/google-maps.svg',
      GitHub: '/assets/brand/github.svg'
    };
    const brandAsset = brandAssets[title];
    if (brandAsset) {
      const logo = document.createElement('img');
      logo.src = brandAsset;
      logo.alt = '';
      logo.width = 48;
      logo.height = 48;
      logo.decoding = 'async';
      logo.setAttribute('aria-hidden', 'true');
      logo.setAttribute('class', 'plugin-brand-logo');
      logo.addEventListener('error', () => {
        logo.replaceWith(svg);
      }, { once: true });
      icon.appendChild(logo);
    } else icon.appendChild(svg);
    const main = mk('span', 'plugin-main');
    main.append(mk('span', 'plugin-title', title));
    const sub = mk('span', 'plugin-sub', 'Checking connection…');
    main.appendChild(sub);
    const chev = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chev.setAttribute('viewBox', '0 0 24 24');
    chev.setAttribute('aria-hidden', 'true');
    chev.setAttribute('class', 'plugin-chev');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm6 9 6 6 6-6');
    chev.appendChild(path);
    head.append(icon, main, chev);
    const actions = mk('div', 'menu plugin-actions');
    actions.hidden = true;
    const settings = mk('button', 'menu-row', 'Settings');
    settings.type = 'button';
    settings.addEventListener('click', () => openPluginCatalogSettings(title, null,
      sub.textContent || 'Checking connection…',
      'Manage the catalog display preference. Connection controls remain available below this card.'));
    const connect = mk('button', 'menu-row', 'Connect ' + title);
    connect.type = 'button';
    const disconnect = mk('button', 'menu-row danger', 'Disconnect Google account');
    disconnect.type = 'button';
    disconnect.hidden = true;
    actions.append(settings, connect);
    head.addEventListener('click', () => {
      const open = actions.hidden;
      for (const other of Object.values(googlePlugins)) {
        if (other.card === card) continue;
        const otherActions = other.card.querySelector('.plugin-actions');
        const otherHead = other.card.querySelector('.plugin-head');
        if (otherActions) otherActions.hidden = true;
        if (otherHead) otherHead.setAttribute('aria-expanded', 'false');
      }
      actions.hidden = !open;
      head.setAttribute('aria-expanded', String(open));
    });
    card.append(head, actions);
    googlePlugins[service] = { card, sub, connect, disconnect, title };
    $('pluginsGoogle').appendChild(card);
  }
  makeGooglePlugin('gmail', 'Gmail', 'mail');
  makeGooglePlugin('calendar', 'Google Calendar', 'calendar');
  makeGooglePlugin('drive', 'Google Drive', 'team');
  makeGooglePlugin('meet', 'Google Meet', 'video');
  makeGooglePlugin('keep', 'Google Keep', 'note');
  makeGooglePlugin('maps', 'Google Maps', 'map');
  const googleStatus = { gmail: { available:false, connected:false, scopes:[], email:null }, calendar: { available:false, connected:false, scopes:[], email:null }, drive: { available:false, connected:false, scopes:[], email:null }, meet: { available:false, connected:false, scopes:[], email:null }, keep: { available:false, connected:false, scopes:[], email:null }, maps: { available:false, connected:false, scopes:[], email:null } };
  Object.defineProperty(googleStatus, 'available', { get() { return ['gmail','calendar','drive','meet','keep','maps'].some((service) => googleStatus[service].available); } });
  async function loadGoogle() {
    await Promise.all(['gmail','calendar','drive','meet','keep','maps'].map(async (service) => {
      try {
        const status = await api('/v1/google/status?service=' + service);
        googleStatus[service] = { available:status?.available===true, connected:status?.connected===true, scopes:Array.isArray(status?.scopes)?status.scopes:[], email:typeof status?.email==='string'?status.email:null };
      } catch { googleStatus[service] = { available:false, connected:false, scopes:[], email:null, error:true }; }
    }));
    renderGoogle();
  }
  function renderGoogle() {
    for (const [service, item] of Object.entries(googlePlugins)) {
      // Maps is an internal NasrinAI capability, not a customer-managed connection.
      // Remove only its status card; the server-side Maps tools remain available.
      if (service === 'maps') { item.card.remove(); continue; }
      const scopes = service === 'gmail'
        ? ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send']
        : service === 'calendar'
          ? ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar.events']
          : service === 'drive' ? ['https://www.googleapis.com/auth/drive.readonly']
            : service === 'meet' ? ['https://www.googleapis.com/auth/meetings.space.created']
              : service === 'keep' ? ['https://www.googleapis.com/auth/keep.readonly'] : [];
      const status = googleStatus[service] || { available:false, connected:false, scopes:[], email:null, error:false };
      const connected = service === 'maps'
        ? status.available
        : status.connected && scopes.some((scope) => status.scopes.includes(scope));
      item.sub.textContent = status.error
        ? 'Connection status unavailable'
        : !status.available
          ? 'Not configured on this site yet'
          : service === 'maps'
            ? 'Ready · fleet routing (no API key)'
            : connected
              ? 'Connected' + (status.email ? ' · ' + status.email : '')
              : 'Not connected';
      if (service === 'maps') {
        item.connect.textContent = status.available ? 'Open fleet route planner' : 'Maps unavailable';
        item.connect.disabled = !status.available;
        item.connect.classList.remove('danger');
        item.connect.onclick = () => { if (status.available) window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving', '_blank', 'noopener,noreferrer'); };
      } else {
        item.connect.textContent = connected ? 'Disconnect Google account' : 'Connect ' + item.title;
        item.connect.disabled = !status.available;
        item.connect.classList.toggle('danger', connected);
        item.connect.onclick = connected ? () => disconnectGoogle(service) : () => connectGoogle(service);
      }
      item.disconnect.hidden = true;
      (connected ? $('pluginsConnected') : $('pluginsGoogle')).appendChild(item.card);
    }
    $('pluginsConnectedLabel').hidden = !$('pluginsConnected').children.length;
    $('pluginsGoogleLabel').hidden = !$('pluginsGoogle').children.length;
    $('pluginsDevLabel').hidden = !$('pluginsDev').children.length;
  }
  async function connectGoogle(service) {
    if (!account) { openSignIn('Sign in to connect Google.'); return; }
    const status = $('githubStatus');
    status.textContent = 'Starting secure Google authorization…';
    try {
      const result = await api('/v1/google/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service })
      });
      if (!result || typeof result.url !== 'string' || !result.url.startsWith('https://accounts.google.com/')) {
        throw new Error('Google did not return a valid authorization URL.');
      }
      location.assign(result.url);
    } catch (err) {
      status.textContent = err.message || 'Google could not be connected. Please try again.';
    }
  }
  async function disconnectGoogle(service) {
    const status = $('githubStatus');
    const buttons = [googlePlugins[service]?.connect].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; });
    status.textContent = 'Disconnecting Google…';
    try {
      await api('/v1/google?service=' + encodeURIComponent(service), { method: 'DELETE' });
      googleStatus[service] = { ...googleStatus[service], connected: false, scopes: [], email: null };
      renderGoogle();
      status.textContent = 'Google account disconnected.';
    } catch (err) {
      status.textContent = err.message || 'Google could not be disconnected.';
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
      renderGoogle();
    }
  }
  {
    const back = new URLSearchParams(location.search).get('google');
    if (back) {
      history.replaceState(null, '', location.pathname);
      notice.textContent = back === 'connected'
        ? 'Google account connected. Open Plugins to confirm the selected Google app access.'
        : 'Google was not connected. Check the OAuth setup and try again.';
    }
  }

  // The Plugins sheet (Plugins in the menu); GitHub is the first plugin.
  const githubSheet = $('githubSheet');
  function openGithub() {
    if (!account) { openSignIn('Sign in to use plugins.'); return; }
    closeSettings(); closeHistory(); closeSignIn(); closePlans(); closePro(); closeCodePicker();
    lastFocus = document.activeElement;
    $('githubStatus').textContent = '';
    // Always reset the sheet to its catalog view when opening/reopening.
    // A previous visit may have left the catalog-settings panel visible.
    $('pluginsList').hidden = false;
    $('pluginCatalogSettings').hidden = true;
    $('pluginDetail').hidden = true;
    $('githubTitle').lastChild.textContent = 'Plugins';
    scrim.hidden = false;
    githubSheet.hidden = false;
    loadGithub();
    loadGoogle();
  }
  function closeGithub() {
    if (githubSheet.hidden) return;
    githubSheet.hidden = true;
    scrim.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('drawerGithub').addEventListener('click', () => { closeDrawer(false); openGithub(); });
  $('desktopGithubBtn').addEventListener('click', openGithub);
  $('githubClose').addEventListener('click', closeGithub);
  scrim.addEventListener('click', closeGithub);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !githubSheet.hidden) closeGithub(); });

  $('autoPrOn').addEventListener('change', async () => {
    const box = $('autoPrOn');
    box.disabled = true;
    try {
      const r = await api('/v1/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ autoPr: box.checked }) });
      github.autoPr = r?.prefs?.autoPr === true;
      if (myPrefs) myPrefs = r.prefs;
      renderGithub();
      $('githubStatus').textContent = github.autoPr ? 'Automatic pull requests are on.' : 'Automatic pull requests are off.';
    } catch (err) {
      box.checked = github.autoPr;
      $('githubStatus').textContent = err.message || 'This could not be saved.';
    } finally { box.disabled = false; }
  });

  // A pull request's title and description, written from Nasrin's reply:
  // summary, files, what was done, the steps still needed, what to check.
  function prTitleOf(text) {
    return String(text || '').replace(/\[\[checks[\s\S]*?\[\[\/checks\]\]/gi, '').split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').trim()).find(Boolean)?.slice(0, 120) || 'Changes from Nasrin';
  }
  function prDescription(text, sources, auto) {
    const rows = [];
    const summary = String(text || '')
      .replace(/\[\[checks[^\]]*\]\]([\s\S]*?)\[\[\/checks\]\]/gi, (_, body) => {
        for (const line of body.split('\n')) {
          const p = line.split('|').map((s) => s.trim());
          if (p.length >= 2 && p[1]) rows.push({ status: p[0].toLowerCase(), item: p[1].slice(0, 200) });
        }
        return '';
      })
      .replace(/```[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000);
    const list = (kinds) => rows.filter((r) => kinds.includes(r.status)).map((r) => '- ' + r.item);
    const out = ['## Summary', summary || 'Changes prepared by NasrinAI.', '', '## Files',
      ...sources.map((f) => '- `' + f.path + '` — ' + (f.edits ? f.edits.length + ' change' + (f.edits.length === 1 ? '' : 's') + ' to the existing file' : 'whole file')), ''];
    const done = list(['ok', 'secure', 'info']);
    if (done.length) out.push('## What was done', ...done, '');
    const steps = list(['todo']);
    out.push('## Steps needed', ...(steps.length ? steps : ['- Review the changes and this repository\'s checks, then merge.']), '');
    const watch = list(['warn', 'fail']);
    if (watch.length) out.push('## Check before merging', ...watch, '');
    out.push('---', auto ? '_Opened automatically by NasrinAI (automatic pull requests are on). Nothing is merged until you merge it._' : '_Opened by NasrinAI after you confirmed. Nothing is merged until you merge it._');
    return out.join('\n').slice(0, 10000);
  }
  // What GitHub reported back, in one line (and a link).
  function prResult(el, pr) {
    const files = Array.isArray(pr.files) ? pr.files : [];
    const savedOk = files.filter((f) => f.saved === true).length;
    const written = files.filter((f) => f.status !== 'unchanged').length;
    const same = files.filter((f) => f.status === 'unchanged').length;
    el.textContent = (pr.existing ? 'This pull request was already open: #' + pr.number + ' on ' : 'Pull request #' + pr.number + ' is open on branch ')
      + pr.branch + '. '
      + (pr.existing ? '' : pr.verified ? 'Checked on GitHub: ' + savedOk + ' of ' + written + ' files saved exactly as written. ' : 'Check the files on GitHub: ' + savedOk + ' of ' + written + ' could be confirmed. ')
      + (same ? same + ' already matched and were left as they are. ' : '');
    if (typeof pr.url === 'string' && pr.url.startsWith('https://github.com/')) {
      const a = mk('a', '', 'View on GitHub');
      a.href = pr.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      el.appendChild(a);
    }
  }
  // More than five files: the chat shows one card instead of the files.
  const MANY_FILES = 5;
  function changesCard(sources, text, fresh) {
    const card = mk('div', 'pr-card');
    card.appendChild(mk('p', 'pr-card-title', 'Nasrin prepared changes to ' + sources.length + ' files.'));
    const ul = mk('ul', 'pr-card-files');
    for (const f of sources) ul.appendChild(mk('li', '', f.path + (f.edits ? ' · changes' : '')));
    card.appendChild(ul);
    const status = mk('p', 'pr-card-status');
    status.setAttribute('role', 'status');
    card.appendChild(status);
    const b = prButton(sources, text);
    card.appendChild(b);
    if (fresh) autoOpen(sources, text, status, b);
    else status.textContent = 'Open a pull request to see and keep these changes.';
    return card;
  }
  // Automatic pull requests (when on): opened right after the reply, into the
  // repository this project used last. Without one yet, the person picks it once.
  async function autoOpen(sources, text, status, button) {
    if (!(codingProject && github.connected && github.autoPr)) {
      if (status) status.textContent = 'Open a pull request to see and keep these changes.';
      return;
    }
    const repo = saved.get(KEYS.coding + ':repo:' + codingProject.id);
    if (!repo) { if (status) status.textContent = 'Choose the repository once with Open pull request; after that they open automatically.'; return; }
    const el = status || mk('p', 'pr-card-status');
    el.textContent = 'Opening a pull request in ' + repo + '…';
    if (button) button.disabled = true;
    try {
      const pr = await api('/v1/github/pull-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, auto: true, repo, title: prTitleOf(text), body: prDescription(text, sources, true), files: sources })
      });
      prResult(el, pr);
      if (button) button.hidden = true;
    } catch (err) {
      el.textContent = (err.message || 'The pull request could not be opened.') + ' ';
      if (button) button.disabled = false;
    }
    return el;
  }

  const prSheet = $('prSheet');
  let prFiles = [];
  let prText = '';
  function prButton(sources, text) {
    const b = mk('button', 'btn small outline pr-open', github.connected ? 'Confirm change' : 'Connect GitHub to confirm');
    b.type = 'button';
    b.addEventListener('click', () => openPr(sources, text));
    return b;
  }
  async function openPr(sources, text) {
    if (!github.connected) { openGithub(); $('githubStatus').textContent = 'Connect GitHub first.'; return; }
    closeCodePicker();
    lastFocus = document.activeElement;
    prFiles = sources;
    const key = codingProject ? KEYS.coding + ':repo:' + codingProject.id : null;
    $('prRepo').value = (key && saved.get(key)) || '';
    $('prBase').value = '';
    prText = text;
    $('prTitle').value = prTitleOf(text);
    $('prStatus').textContent = '';
    $('prStatus').className = 'signin-status';
    $('prConfirm').disabled = false;
    $('prFiles').replaceChildren(...sources.map((f, i) => {
      const li = mk('li');
      const inp = mk('input', 'memory-edit lib-input');
      inp.value = f.path;
      inp.maxLength = 300;
      inp.spellcheck = false;
      inp.setAttribute('aria-label', 'File ' + (i + 1) + ' path' + (f.edits ? ' (changes to the existing file)' : ''));
      if (f.edits) inp.title = f.edits.length + ' change' + (f.edits.length === 1 ? '' : 's') + ' to the existing file';
      inp.addEventListener('input', () => { prFiles[i] = { ...prFiles[i], path: inp.value.trim() }; });
      li.appendChild(inp);
      return li;
    }));
    scrim.hidden = false;
    prSheet.hidden = false;
    $('prRepo').focus();
    try {
      const r = await api('/v1/github/repos');
      $('prRepoList').replaceChildren(...(r.repos || []).filter((x) => x.can_push).map((x) => { const o = mk('option'); o.value = x.repo; return o; }));
    } catch { /* typing the name still works */ }
  }
  function closePr() {
    if (prSheet.hidden) return;
    prSheet.hidden = true;
    scrim.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $('prClose').addEventListener('click', closePr);
  scrim.addEventListener('click', closePr);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !prSheet.hidden) closePr(); });
  $('prForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const repo = $('prRepo').value.trim();
    const status = $('prStatus');
    const btn = $('prConfirm');
    btn.disabled = true;
    status.className = 'signin-status';
    status.textContent = 'Opening the pull request…';
    try {
      const pr = await api('/v1/github/pull-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, repo, base: $('prBase').value.trim(), title: $('prTitle').value.trim(), body: prDescription(prText, prFiles, false), files: prFiles })
      });
      if (codingProject) saved.set(KEYS.coding + ':repo:' + codingProject.id, repo);
      status.className = 'signin-status pr-done';
      prResult(status, pr);
    } catch (err) {
      status.textContent = err.message || 'The pull request could not be opened.';
      btn.disabled = false;
    }
  });

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
        const li = mk('li', 'history-item prj-list-item');
        const row = mk('div', 'prj-list-row');
        const open = mk('button', 'history-open lib-open');
        open.type = 'button';
        open.append(mk('span', 'history-title', p.name), mk('span', 'history-time', `${PRJ_STATUS[p.status] || ''} · ${when(p.updated_at)}`));
        open.addEventListener('click', () => openProject(p.id));

        const toggle = mk('button', 'icon-btn prj-expand');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Show actions for ' + p.name);
        const toggleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        toggleSvg.setAttribute('viewBox', '0 0 24 24');
        toggleSvg.setAttribute('aria-hidden', 'true');
        const togglePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        togglePath.setAttribute('d', 'm6 9 6 6 6-6');
        toggleSvg.appendChild(togglePath);
        toggle.appendChild(toggleSvg);

        const actions = mk('div', 'prj-actions');
        actions.hidden = true;
        const actionButton = (label, kind, path, description, onClick) => {
          const button = mk('button', 'prj-action prj-action-' + kind);
          button.type = 'button';
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 24 24');
          svg.setAttribute('aria-hidden', 'true');
          const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          iconPath.setAttribute('d', path);
          svg.appendChild(iconPath);
          const title = document.createElement('strong');
          title.textContent = label;
          const detail = document.createElement('span');
          detail.className = 'prj-action-description';
          detail.textContent = description;
          button.append(svg, title, detail);
          button.addEventListener('click', onClick);
          return button;
        };
        actions.append(
          actionButton('Open', 'open', 'M3.5 8A2 2 0 0 1 5.5 6h4l2 2H18a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2z M5 12h14', 'View project details', () => openProject(p.id)),
          actionButton('Chat', 'chat', 'M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z', 'Start a project chat', () => startProjectChat(p, 'chat')),
          actionButton('Code', 'code', 'm8 8-4 4 4 4m8-8 4 4-4 4m-3-12-2 16', 'Start a coding conversation', () => startProjectChat(p, 'code'))
        );
        toggle.addEventListener('click', () => {
          const expanded = toggle.getAttribute('aria-expanded') !== 'true';
          toggle.setAttribute('aria-expanded', String(expanded));
          toggle.setAttribute('aria-label', (expanded ? 'Hide' : 'Show') + ' actions for ' + p.name);
          actions.hidden = !expanded;
          li.classList.toggle('is-expanded', expanded);
        });
        row.append(open, toggle);
        li.append(row, actions);
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
  function startProjectChat(project, mode) {
    if (project && mode === 'code') { closeHistory(); enterCoding(project); return; }
    if (!project) return;   // New chat below lets a running reply finish in the background
    const p = { id: project.id, name: project.name };
    closeHistory();
    startNewChat();
    setChatProject(p);
    if (mode === 'code') {
      input.value = 'Help me work on code for the ' + p.name + ' project.';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      notice.textContent = 'Code session for ' + p.name + '. Review or edit the prompt before sending.';
    } else {
      notice.textContent = 'New chat in ' + p.name + '.';
    }
    input.focus();
  }

  $('prjChat').addEventListener('click', () => {
    if (!prjOpen) return;
    startProjectChat(prjOpen, 'chat');
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
  async function buyPlan(p, btn, term = 'period') {
    btn.disabled = true;
    plansStatus.textContent = term === 'annual' ? 'Opening annual checkout…' : 'Opening checkout…';
    try {
      const data = await api('/v1/plans/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: p.id, term }) });
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
      saved.set(KEYS.libraryOn, libraryOn);
      projectsOn = s.projects === true;
      renderSpaceMenu();
      directUploads = s.uploads && s.uploads.direct === true && Number(s.uploads.max_mb) > 0 ? { maxBytes: Number(s.uploads.max_mb) * 1048576 } : null;
      imagesOn = Boolean(s.images && s.images.available);
      $('pickImage').hidden = !imagesOn;
      imageLimits = imagesOn ? { perGuest: Number(s.images.per_guest) || 0, perUserDay: Number(s.images.per_user_day) || 0 } : null;
      renderImageHint();
      // Cache the public site key here, but render the widget only when the
      // sign-in sheet is opened and its container is visible.
      turnstileSiteKey = typeof s.turnstile?.site_key === 'string' ? s.turnstile.site_key : '';
      if (s.sign_in && typeof s.sign_in === 'object') {
        signInMethods = { email: s.sign_in.email === true, google: s.sign_in.google === true };
        authMethodsLoaded = true;
        renderAccount();
      }
      if (s.speech && Number.isFinite(s.speech.rate)) speechRate = Math.min(2, Math.max(0.5, s.speech.rate));
      if (s.speech && Array.isArray(s.speech.voices)) {
        // Keep the server's full provider catalog visible even when one or both
        // providers are unavailable. Unavailable voices are shown disabled.
        speech = {
          available: s.speech.available === true,
          voices: s.speech.voices.filter((v) => v && typeof v.id === 'string' && typeof v.name === 'string'),
          default: s.speech.default || null
        };
        renderVoices();
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
      const messages = Array.isArray(data.messages) ? data.messages : [];
      // Historical messages may not include provider usage. Estimate from the
      // saved user/assistant text so the panel remains useful after a refresh.
      // This is explicitly marked estimated and never presented as provider usage.
      const estimateHistoricalTokens = (value) => Math.max(1, Math.ceil(String(value || '').length / 4));
      const historicalResponseMetadata = (message, index) => {
        const supplied = message.response_metadata || message.responseMetadata;
        if (supplied || message.role !== 'assistant') return supplied || null;
        let precedingUser = '';
        let precedingUserMessage = null;
        for (let j = index - 1; j >= 0; j -= 1) {
          if (messages[j]?.role === 'user') {
            precedingUserMessage = messages[j];
            precedingUser = messages[j].content || '';
            break;
          }
        }
        const assistantCreatedAt = Date.parse(message.created_at || message.createdAt || '');
        const userCreatedAt = Date.parse(precedingUserMessage?.created_at || precedingUserMessage?.createdAt || '');
        const elapsedMs = Number.isFinite(assistantCreatedAt) && Number.isFinite(userCreatedAt) && assistantCreatedAt >= userCreatedAt
          ? assistantCreatedAt - userCreatedAt : null;
        return {
          timestamp: message.created_at || message.createdAt || null,
          duration_ms: elapsedMs,
          duration_estimated: elapsedMs !== null,
          usage: {
            input_tokens: estimateHistoricalTokens(precedingUser),
            output_tokens: estimateHistoricalTokens(message.content),
            estimated: true
          }
        };
      };
      data.messages.forEach((m, i) => show(m.role === 'user' ? 'user' : 'assistant', m.content, { animate: false, id: m.id, asks: i === data.messages.length - 1, responseMetadata: historicalResponseMetadata(m, i) }));
      if (messages.length) {
        startChat();
        refreshTurnControls();
      }
    } catch (err) {
      // A transient network/server error must never erase the locally saved
      // conversation pointer or clear the visible chat. Only discard a pointer
      // when the server explicitly confirms that this conversation no longer
      // exists or is no longer accessible.
      if (err && (err.status === 404 || err.status === 410)) {
        conversationId = null;
        saved.del(identityKey(KEYS.conversation));
        clearScreen();
        notice.textContent = 'This conversation is no longer available. You can find other saved chats in Your chats.';
      } else {
        notice.textContent = 'Could not restore this conversation right now. Your saved chat has been kept; check your connection and refresh to try again.';
        console.warn('NasrinAI: conversation restore failed; keeping saved conversation pointer.', err);
      }
    }
  }

  // Signed in before (or just back from Google): renew the session first, so
  // the models and the conversation load for the right person.
  async function restoreAccount() {
    renderAccount();
    // Skip only when the server said sign-in is off; a failed status check
    // must not hide an existing sign-in (and its Log out).
    if (authMethodsLoaded && !(signInMethods.email || signInMethods.google)) return;
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
    } else if (signinResult === 'ok') {
      // Never silently turn a successful OAuth redirect into a guest session.
      // Safari may decline a refresh cookie during a cross-site return; explain
      // what happened and let the person retry sign-in instead.
      await openSignIn('Google returned to NasrinAI, but your session could not be restored. Please try signing in again.');
    }
    if (account) checkTerms(signinResult === 'ok' ? 'signin' : 'update_prompt');
    renderDataControls();
  }
  // Back online after opening offline: pick the sign-in up again.
  window.addEventListener('online', () => { if (!account && saved.get(KEYS.account)) location.reload(); });

  showConnectForSignedIn();
  renderSpaceMenu();
  renderProButton();
  // No sign-in on this device: show Sign in now instead of after the status check.
  if (!saved.get(KEYS.account)) renderAccount();
  autosize();
  let loadingPro = null;
  let loadingModels = null;
  loadStatus()
    .then(restoreAccount)
    // A failure restoring the sign-in must not skip the tier catalog below.
    .catch((err) => { console.error('NasrinAI start-up: restoring sign-in failed', err); })
    .then(() => {
      showFirstVisitNotice();
      // A repeated Google answer can report a failure after the sign-in worked: only show it when signed out.
      if (signinResult === 'failed' && !account) openSignIn('Google sign-in did not finish. Please try again.');
      // Load both catalogs before revealing the toolbar so its controls do not
      // pop in separately as their independent requests finish.
      loadingModels = loadModels();
      if (aiAvailable) loadingPro = loadProfessionals();
      loadPlans();
      if (new URLSearchParams(location.search).get('plan') === 'paid') {
        history.replaceState(null, '', location.pathname);
        openPlans('Thank you! Your plan is active once the payment is confirmed (usually within a minute).');
      }
      // Do not silently start a blank chat after a refresh or a long absence.
      // Restore the last conversation; server-side retention decides whether it
      // still exists, and loadConversation handles a confirmed 404/410 safely.
      saved.del(KEYS.left);
      return loadConversation();
    })
    .then(() => {
      // Back in the coding chat after a reload, while still signed in.
      const sc = saved.get(KEYS.coding);
      if (sc && typeof sc.id === 'string' && account && projectsOn) {
        setCoding(sc);
        if (!conversationId) setChatProject(sc);
      } else saved.del(KEYS.coding);
      if (!codingProject) loadGithub();   // GitHub in the menu (setCoding loads it otherwise)
    })
    .finally(() => Promise.allSettled([loadingModels, loadingPro]).then(() => {
      document.documentElement.classList.remove('composer-controls-loading');
      return startNotes('open');
    }));
})();