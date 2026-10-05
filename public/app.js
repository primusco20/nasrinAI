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
  const speakToggle = $('speakToggle');
  const modelRow = $('modelRow');
  const modelSelect = $('model');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const Nasrin = window.Nasrin;

  // localStorage holds only the guest session, the current conversation id and
  // two preferences. The conversation itself lives on the server.
  const KEYS = { session: 'nasrin.session', conversation: 'nasrin.conversation', speak: 'nasrin.speak', model: 'nasrin.model' };
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

  async function api(path, options = {}, retried = false) {
    const token = await guestToken(retried);
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

  function show(role, text, { animate = true } = {}) {
    startChat();
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    if (role === 'assistant' && animate && !reduceMotion) revealWords(el, text);
    else el.textContent = text;
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
    sendBtn.disabled = busy || !aiAvailable || !input.value.trim();
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 144) + 'px';
    refreshSendButton();
  }

  // ---------- sending ----------

  async function send(raw) {
    const text = String(raw || '').trim();
    if (!text || busy || !aiAvailable) return;
    busy = true;
    notice.textContent = '';
    stopSpeaking();
    const tone = Nasrin.tone(text);
    show('user', text);
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
          ...(modelSelect.value ? { model: modelSelect.value } : {})
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
      show('assistant', data.message.content);
      speak(data.message.content);
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

  // ---------- reading replies aloud (the browser's own voice) ----------

  const canSpeak = 'speechSynthesis' in window;
  let speakOn = canSpeak && saved.get(KEYS.speak) === true;

  function stopSpeaking() {
    if (canSpeak) window.speechSynthesis.cancel();
  }

  function speak(text) {
    if (!speakOn) return;
    stopSpeaking();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text.slice(0, 3000)));
  }

  if (!canSpeak) speakToggle.hidden = true;
  speakToggle.setAttribute('aria-pressed', String(speakOn));
  speakToggle.addEventListener('click', () => {
    speakOn = !speakOn;
    saved.set(KEYS.speak, speakOn);
    speakToggle.setAttribute('aria-pressed', String(speakOn));
    if (!speakOn) stopSpeaking();
  });

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
      modelSelect.replaceChildren(...models.map((m) => {
        const option = document.createElement('option');
        option.value = m.id;
        option.textContent = m.name;
        return option;
      }));
      modelSelect.value = ids.includes(wanted) ? wanted : (ids.includes(data.default) ? data.default : ids[0]);
      modelRow.hidden = false;
    } catch {
      modelRow.hidden = true;   // the server then uses its default
    }
  }

  modelSelect.addEventListener('change', () => {
    saved.set(KEYS.model, modelSelect.value);
    Nasrin.flash('surprised', 520);
  });

  // ---------- start-up ----------

  async function loadStatus() {
    try {
      const resp = await fetch('/v1/status');
      if (!resp.ok) return;
      const s = await resp.json();
      aiAvailable = s.ai_available === true;
      const parts = ['Replies come from an AI and can be wrong. Check anything important.'];
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
      for (const m of data.messages) show(m.role === 'user' ? 'user' : 'assistant', m.content, { animate: false });
    } catch {
      conversationId = null;
      saved.del(KEYS.conversation);
      clearScreen();
    }
  }

  autosize();
  loadStatus().then(() => { if (aiAvailable) loadModels(); });
  loadConversation();
})();
