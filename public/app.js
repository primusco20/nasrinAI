// NasrinAI chat page. Plain script, no libraries, no inline code (strict CSP).
// Every message is rendered with textContent, never as HTML.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const log = $('log');
  const welcome = $('welcome');
  const form = $('composer');
  const input = $('input');
  const sendBtn = $('send');
  const micBtn = $('mic');
  const notice = $('notice');
  const fineprint = $('fineprint');
  const speakToggle = $('speakToggle');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // localStorage holds only the guest session and the current conversation id.
  // The conversation itself lives on the server.
  const KEYS = { session: 'nasrin.session', conversation: 'nasrin.conversation', speak: 'nasrin.speak' };
  const saved = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* private mode */ } }
  };

  let conversationId = saved.get(KEYS.conversation);
  let busy = false;
  let aiAvailable = true;

  // ---------- talking to the server ----------

  async function errorFrom(resp) {
    let message = 'Something went wrong. Please try again.';
    try {
      const body = await resp.json();
      if (body && body.error && typeof body.error.message === 'string') message = body.error.message;
    } catch { /* not JSON */ }
    const err = new Error(message);
    err.status = resp.status;
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

  function show(role, text) {
    welcome.hidden = true;
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    el.textContent = text;
    log.appendChild(el);
    scrollToEnd(el);
    return el;
  }

  function showThinking() {
    const el = document.createElement('div');
    el.className = 'thinking';
    el.setAttribute('aria-label', 'Nasrin is writing');
    el.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    log.appendChild(el);
    scrollToEnd(el);
    return el;
  }

  function clearScreen() {
    for (const el of [...log.children]) if (el !== welcome) el.remove();
    welcome.hidden = false;
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
    show('user', text);
    input.value = '';
    autosize();
    const dots = showThinking();

    try {
      const ask = (id) => api('/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { message: text, conversation_id: id } : { message: text })
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
      dots.remove();
      show('assistant', data.message.content);
      speak(data.message.content);
    } catch (err) {
      dots.remove();
      show('problem', err.message || 'Something went wrong. Please try again.');
    } finally {
      busy = false;
      refreshSendButton();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener('input', autosize);
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
    micBtn.setAttribute('aria-pressed', String(on));
    micBtn.title = on ? 'Stop listening' : 'Talk instead of typing';
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
      if (!aiAvailable) notice.textContent = 'Nasrin is not switched on yet. Please check back soon.';
    } catch { /* offline: keep the default text */ }
    refreshSendButton();
  }

  async function loadConversation() {
    if (!conversationId) return;
    try {
      const data = await api(`/v1/conversations/${encodeURIComponent(conversationId)}/messages`);
      for (const m of data.messages) show(m.role === 'user' ? 'user' : 'assistant', m.content);
    } catch {
      conversationId = null;
      saved.del(KEYS.conversation);
      clearScreen();
    }
  }

  autosize();
  loadStatus();
  loadConversation();
})();
