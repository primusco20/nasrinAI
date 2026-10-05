// NasrinAI chat page. Plain script, no libraries, no inline code (strict CSP).
// Every message is rendered with textContent, never as HTML.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const log = $('log');
  const welcome = $('welcome');
  const hero = $('hero');
  const form = $('composer');
  const input = $('input');
  const sendBtn = $('send');
  const micBtn = $('mic');
  const notice = $('notice');
  const fineprint = $('fineprint');
  const settingsBtn = $('settingsBtn');
  const sheet = $('settings');
  const scrim = $('scrim');
  const readAloud = $('readAloud');
  const voicesBox = $('voices');
  const modelRow = $('modelRow');
  const modelSelect = $('model');
  const tray = $('tray');
  const attachBtn = $('attach');
  const fileInput = $('fileInput');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const Nasrin = window.Nasrin;

  // localStorage holds only the guest session, the current conversation id,
  // the signed-in email (for display; the sign-in itself is an HttpOnly cookie
  // scripts cannot read) and preferences. The conversation lives on the server.
  const KEYS = {
    session: 'nasrin.session', conversation: 'nasrin.conversation', speak: 'nasrin.speak',
    model: 'nasrin.model', theme: 'nasrin.theme', voice: 'nasrin.voice', account: 'nasrin.account'
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

  // ---------- the character ----------

  const heroChar = Nasrin.attach(hero, { tracks: true });
  if (!reduceMotion) {
    hero.classList.add('is-entering');
    setTimeout(() => hero.classList.remove('is-entering'), 1300);
  }
  const markChar = Nasrin.attach($('mark'));

  // What the character returns to after a reaction.
  Nasrin.setBase(() => {
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

  async function guestToken(fresh) {
    const s = saved.get(KEYS.session);
    if (!fresh && s && typeof s.token === 'string' && Date.parse(s.expires_at) - Date.now() > 60_000) return s.token;
    const resp = await fetch('/v1/guest/sessions', { method: 'POST' });
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
        const resp = await fetch('/v1/auth/refresh', { method: 'POST' });
        if (resp.status === 401) { signedOut(); return null; }
        if (!resp.ok) throw await errorFrom(resp);
        return signedIn(await resp.json());
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
    const resp = await fetch(path, { ...options, headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token } });
    if (resp.status === 401 && !retried) return api(path, options, true);   // session ended: start a new one once
    if (!resp.ok) throw await errorFrom(resp);
    return resp.status === 204 ? null : resp.json();
  }

  // ---------- the conversation on screen ----------

  function scrollToEnd(el) {
    el.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' });
  }

  // Leaving the empty state: the big character glides up into the header.
  function startChat() {
    if (document.body.classList.contains('has-chat')) return;
    const from = heroChar.svg.getBoundingClientRect();
    document.body.classList.add('has-chat');
    welcome.hidden = true;
    const to = markChar.svg.getBoundingClientRect();
    if (reduceMotion || !from.width || !to.width || !markChar.svg.animate) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const s = from.width / to.width;
    markChar.svg.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: 'none' }],
      { duration: 620, easing: 'cubic-bezier(.3, 1.2, .4, 1)' }
    );
  }

  function show(role, text, { animate = true, files = [], id = null } = {}) {
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
    if (role === 'assistant') {
      const body = document.createElement('div');
      body.className = 'msg-body';
      if (animate && !reduceMotion) revealWords(body, text);
      else body.textContent = text;
      el.appendChild(body);
      if (canSpeakAnything()) el.appendChild(listenButton(text, id));
    } else if (text) {
      el.appendChild(document.createTextNode(text));
    }
    log.appendChild(el);
    scrollToEnd(el);
    return el;
  }

  // The reply appears word by word, quickly: the whole text in under a second.
  // Words are text nodes inside spans (never HTML); a screen reader gets it all at once.
  function revealWords(el, text) {
    const parts = text.split(/(\s+)/);
    const words = parts.filter((p) => p && !/^\s+$/.test(p)).length;
    const step = Math.max(6, Math.min(26, 900 / Math.max(1, words)));
    const MAX_ANIMATED = 260;
    let i = 0;
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part) || i >= MAX_ANIMATED) {
        el.appendChild(document.createTextNode(part));
        continue;
      }
      const span = document.createElement('span');
      span.className = 'w';
      span.style.setProperty('--d', Math.round(i * step) + 'ms');
      span.textContent = part;
      el.appendChild(span);
      i += 1;
    }
  }

  function showThinking() {
    const row = document.createElement('div');
    row.className = 'thinking';
    row.setAttribute('role', 'status');
    const mini = document.createElement('span');
    mini.className = 'mini';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Thinking';
    row.append(mini, label);
    log.appendChild(row);
    const ch = Nasrin.attach(mini);
    scrollToEnd(row);
    return { remove() { ch.remove(); row.remove(); } };
  }

  function clearScreen() {
    for (const el of [...log.children]) if (el !== welcome) el.remove();
    welcome.hidden = false;
    document.body.classList.remove('has-chat');
  }

  function refreshSendButton() {
    sendBtn.disabled = busy || !aiAvailable || preparing > 0 || (!input.value.trim() && !pending.length);
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
        if (/^image\//.test(file.type)) {
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

  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const files = [...fileInput.files];
    fileInput.value = '';                 // so the same file can be picked again
    addFiles(files);
  });

  // ---------- sending ----------

  async function send(raw) {
    const text = String(raw || '').trim();
    if ((!text && !pending.length) || busy || preparing || !aiAvailable) return;
    busy = true;
    notice.textContent = '';
    stopSpeaking();
    const tone = Nasrin.tone(text);
    const files = pending;
    pending = [];
    renderTray();
    show('user', text, { files });
    input.value = '';
    autosize();
    // A worried look first if the message sounds upset, then thinking.
    Nasrin.mood(tone === 'negative' ? 'concerned' : 'thinking');
    if (tone === 'negative') setTimeout(() => { if (busy) Nasrin.mood('thinking'); }, 900);
    const thinking = showThinking();

    try {
      const ask = (id) => api('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          ...(id ? { conversation_id: id } : {}),
          ...(modelSelect.value ? { model: modelSelect.value } : {}),
          ...(files.length ? { attachments: files.map((f) => ({ name: f.name, type: f.type, data: f.data })) } : {})
        })
      });
      let data;
      try {
        data = await ask(conversationId);
      } catch (err) {
        if (err.status !== 404 || !conversationId) throw err;
        // The earlier chat is gone (guest chats expire); carry on in a new one.
        conversationId = null;
        saved.del(KEYS.conversation);
        notice.textContent = 'Your earlier chat has expired, so this message starts a new one.';
        data = await ask(null);
      }
      conversationId = data.conversation_id;
      saved.set(KEYS.conversation, conversationId);
      thinking.remove();
      busy = false;
      const shown = show('assistant', data.message.content, { id: data.message.id });
      if (speakOn) shown.querySelector('.listen')?.click();
      // React to how the conversation feels.
      if (tone === 'negative') Nasrin.flash('concerned', 2600);
      else if (tone === 'positive' || Nasrin.tone(data.message.content) === 'positive') Nasrin.flash('happy', 1700);
      else { Nasrin.mood('idle'); Nasrin.blink(true); }
    } catch (err) {
      thinking.remove();
      busy = false;
      show('problem', err.message || 'Something went wrong. Please try again.');
      Nasrin.flash('sad', 2600);
      if (err.code === 'model_not_allowed' || err.code === 'model_unavailable') loadModels();
      if (!account && (err.code === 'guest_limit' || err.code === 'model_not_allowed') && (signInMethods.email || signInMethods.google)) openSignIn(err.message);
    } finally {
      busy = false;
      refreshSendButton();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
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
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  for (const b of document.querySelectorAll('.starter')) b.addEventListener('click', () => send(b.textContent));

  $('newChat').addEventListener('click', () => {
    conversationId = null;
    saved.del(KEYS.conversation);
    stopSpeaking();
    notice.textContent = '';
    clearScreen();
    Nasrin.flash('happy', 1200);
    input.focus();
  });

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
    try {
      audioCtx = audioCtx || new AudioCtx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { audioCtx = null; }
  }
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlockAudio, { passive: true });

  function stopSpeaking() {
    if (playing) { const p = playing; playing = null; p.stop(); }
    if (canDevice) window.speechSynthesis.cancel();
  }

  const ICON_PLAY = 'M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z';
  const ICON_STOP = 'M8.5 7h7A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 15.5v-7A1.5 1.5 0 0 1 8.5 7Z';

  function setPlaying(button, on) {
    if (!button) return;
    button.classList.toggle('is-playing', on);
    const label = button.querySelector('.label');
    if (label) label.textContent = on ? 'Stop' : 'Listen';
    const shape = button.querySelector('path');
    if (shape) shape.setAttribute('d', on ? ICON_STOP : ICON_PLAY);
    button.setAttribute('aria-pressed', String(on));
  }

  // Plays MP3 audio from the server. Resolves when it ends or is stopped.
  async function playServerAudio(body, button) {
    unlockAudio();
    if (!audioCtx) throw new Error('no audio');
    // The browser may keep sound blocked; don't spend a voice request or leave
    // Nasrin "speaking" silently when it does.
    if (audioCtx.state !== 'running') {
      await Promise.race([audioCtx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 800))]);
      if (audioCtx.state !== 'running') throw new Error('Sound is blocked by the browser. Tap Listen again.');
    }
    const token = await credential(false);
    const resp = await fetch('/v1/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body)
    });
    if (!resp.ok) throw await errorFrom(resp);
    const audio = await audioCtx.decodeAudioData(await resp.arrayBuffer());
    return new Promise((resolve) => {
      const src = audioCtx.createBufferSource();
      src.buffer = audio;
      src.connect(audioCtx.destination);
      let done = false;
      const finish = () => { if (done) return; done = true; setPlaying(button, false); if (Nasrin.current === 'speaking') Nasrin.mood('idle'); resolve(); };
      src.onended = finish;
      playing = { stop() { try { src.stop(); } catch { /* already stopped */ } finish(); }, button };
      setPlaying(button, true);
      Nasrin.mood('speaking');
      src.start();
    });
  }

  function playDevice(text, voiceId, button) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text.slice(0, 3000));
      const uri = voiceId.slice('device:'.length);
      if (uri !== 'default') {
        const v = window.speechSynthesis.getVoices().find((x) => x.voiceURI === uri);
        if (v) { u.voice = v; u.lang = v.lang; }
      }
      let done = false;
      const finish = () => { if (done) return; done = true; setPlaying(button, false); if (Nasrin.current === 'speaking') Nasrin.mood('idle'); resolve(); };
      u.onend = finish;
      u.onerror = finish;
      playing = { stop() { window.speechSynthesis.cancel(); finish(); }, button };
      setPlaying(button, true);
      Nasrin.mood('speaking');
      window.speechSynthesis.speak(u);
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

  function listenButton(text, id) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'listen';
    b.setAttribute('aria-pressed', 'false');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICON_PLAY);
    icon.appendChild(path);
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Listen';
    b.append(icon, label);
    b.addEventListener('click', () => {
      const mine = playing && playing.button === b;
      stopSpeaking();
      if (!mine) readReply(text, id, b);
    });
    return b;
  }

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
    radio.addEventListener('change', () => { voiceChoice = value; saved.set(KEYS.voice, value); });
    const text = document.createElement('span');
    text.textContent = name;
    label.append(radio, text);
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
    row.append(label, play);
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
  function openSettings() {
    lastFocus = document.activeElement;
    renderVoices();
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
  settingsBtn.addEventListener('click', () => (sheet.hidden ? openSettings() : closeSettings()));
  $('settingsClose').addEventListener('click', closeSettings);
  scrim.addEventListener('click', () => { closeSettings(); closeSignIn(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSettings(); closeSignIn(); } });

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
    accountBtn.textContent = account ? 'Sign out' : 'Sign in';
  }

  // A new identity starts a new chat: a guest's conversation is not the account's.
  function switchIdentity() {
    conversationId = null;
    saved.del(KEYS.conversation);
    stopSpeaking();
    clearScreen();
    renderAccount();
    if (aiAvailable) loadModels();
  }

  function signedIn(data) {
    if (!data || typeof data.access_token !== 'string') { signedOut(); return null; }
    const email = data.user && typeof data.user.email === 'string' ? data.user.email : '';
    account = { email, token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    saved.set(KEYS.account, { email });
    renderAccount();
    return account;
  }

  function signedOut() {
    account = null;
    saved.del(KEYS.account);
    renderAccount();
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
    micBtn.title = on ? 'Stop listening' : 'Talk instead of typing';
    if (on) Nasrin.mood('listening');
    else if (Nasrin.current === 'listening') Nasrin.mood('idle');
  }

  if (!Recognition) {
    micBtn.hidden = true;
  } else {
    micBtn.addEventListener('click', () => {
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
      recognizer.onend = () => {
        recognizer = null;
        setListening(false);
        if (heard.trim()) send(input.value);
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

  // ---------- choosing NasrinAI, Pro, Max or Ultra ----------

  async function loadModels() {
    try {
      const data = await api('/v1/models');
      const models = (Array.isArray(data.models) ? data.models : [])
        .filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string');
      if (models.length < 2) { modelRow.hidden = true; modelSelect.value = ''; return; }
      const ids = models.map((m) => m.id);
      const wanted = saved.get(KEYS.model);
      const open = models.filter((m) => m.locked !== true).map((m) => m.id);
      modelSelect.replaceChildren(...models.map((m) => {
        const option = document.createElement('option');
        option.value = m.id;
        option.textContent = m.locked === true ? m.name + ' · Sign in' : m.name;
        if (m.locked === true) option.dataset.locked = 'true';
        return option;
      }));
      modelSelect.value = open.includes(wanted) ? wanted : (open.includes(data.default) ? data.default : open[0] || ids[0]);
      modelSelect.dataset.last = modelSelect.value;
      modelRow.hidden = false;
      fitModel();
    } catch {
      modelRow.hidden = true;   // the server then uses its default
    }
  }

  // A <select> is as wide as its longest option; size it to the chosen one so
  // the chip hugs its label ("Pro" stays small, "NasrinAI" gets room).
  const measure = document.createElement('canvas').getContext('2d');
  function fitModel() {
    const option = modelSelect.selectedOptions[0];
    if (!option || !measure) return;
    const cs = getComputedStyle(modelSelect);
    measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = measure.measureText(option.textContent).width;
    modelSelect.style.width = Math.ceil(text + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2) + 'px';
  }

  modelSelect.addEventListener('change', () => {
    // A tier that needs sign-in: keep the current one and offer sign-in.
    if (modelSelect.selectedOptions[0] && modelSelect.selectedOptions[0].dataset.locked === 'true') {
      const name = modelSelect.selectedOptions[0].textContent.replace(' · Sign in', '');
      modelSelect.value = modelSelect.dataset.last || '';
      openSignIn(`Sign in to use ${name}.`);
      return;
    }
    modelSelect.dataset.last = modelSelect.value;
    saved.set(KEYS.model, modelSelect.value);
    fitModel();
    Nasrin.flash('surprised', 520);
  });

  // ---------- start-up ----------

  async function loadStatus() {
    try {
      const resp = await fetch('/v1/status');
      if (!resp.ok) return;
      const s = await resp.json();
      aiAvailable = s.ai_available === true;
      if (s.sign_in && typeof s.sign_in === 'object') signInMethods = { email: s.sign_in.email === true, google: s.sign_in.google === true };
      if (s.speech && s.speech.available && Array.isArray(s.speech.voices) && s.speech.voices.length) {
        speech = { available: true, voices: s.speech.voices.filter((v) => v && typeof v.id === 'string' && typeof v.name === 'string'), default: s.speech.default };
      }
      const parts = ['Replies come from an AI and can be wrong. Check anything important.'];
      if (s.own_model) parts.push('Answers come from NasrinAI’s own model; messages are not sent to an outside AI company.');
      // Offer only the files this model can read. Text files always work.
      if (s.files && typeof s.files === 'object') {
        const kinds = [];
        if (s.files.photos) kinds.push('image/*');
        if (s.files.pdfs) kinds.push('application/pdf,.pdf');
        kinds.push('text/plain,.txt,text/csv,.csv,text/markdown,.md,application/json,.json');
        fileInput.accept = kinds.join(',');
        attachBtn.title = s.files.photos ? 'Add photos and files' : 'Add files';
        attachBtn.setAttribute('aria-label', attachBtn.title);
      }
      if (s.external_model) {
        parts.push(s.redacts_contact_details
          ? 'Messages are sent to an outside AI service to be answered, with emails, phone and card numbers removed first.'
          : 'Messages are sent to an outside AI service to be answered.');
      }
      parts.push(`Guest chats are deleted after ${s.guest_session_hours} hours.`);
      if (Recognition) parts.push('Voice typing uses your browser\'s speech service.');
      fineprint.textContent = parts.join(' ');
      if (!aiAvailable) { notice.textContent = 'Nasrin is not switched on yet. Please check back soon.'; Nasrin.mood('sleepy'); }
    } catch { /* offline: keep the default text */ }
    refreshSendButton();
  }

  async function loadConversation() {
    if (!conversationId) return;
    try {
      const data = await api(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`);
      for (const m of data.messages) show(m.role === 'user' ? 'user' : 'assistant', m.content, { animate: false, id: m.id });
    } catch {
      conversationId = null;
      saved.del(KEYS.conversation);
      clearScreen();
    }
  }

  // Signed in before (or just back from Google): renew the session first, so
  // the models and the conversation load for the right person.
  async function restoreAccount() {
    renderAccount();
    if (!(signInMethods.email || signInMethods.google)) return;
    if (!saved.get(KEYS.account) && signinResult !== 'ok') return;
    try { await refreshAccount(); } catch { /* sign-in unavailable: continue as guest */ }
    if (signinResult === 'ok' && account) {
      conversationId = null;
      saved.del(KEYS.conversation);
      Nasrin.flash('happy', 1600);
    }
  }

  autosize();
  loadStatus()
    .then(restoreAccount)
    .then(() => {
      if (signinResult === 'failed') openSignIn('Google sign-in did not finish. Please try again.');
      if (aiAvailable) loadModels();
      return loadConversation();
    });
})();
