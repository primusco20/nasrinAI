/* NasrinAI hosted chat page: opened from a business's chat link or QR code.
 * Nothing is installed on the business's website. The page asks the server for a chat-only
 * guest session for the business behind this link, then talks to the normal chat endpoint. */
(() => {
  'use strict';
  const code = (location.pathname.match(/^\/chat\/([A-Za-z0-9_-]{22})$/) || [])[1];
  const $ = (id) => document.getElementById(id);
  const log = $('log'); const form = $('form'); const input = $('input'); const send = $('send');
  const title = $('title'); const note = $('note');
  let token = null; let conversationId = null; let busy = false;

  const add = (text, kind) => {
    const bubble = document.createElement('div');
    bubble.className = 'msg ' + kind;
    bubble.textContent = text;
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;
    return bubble;
  };

  const api = async (path, options = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    const response = await fetch(path, Object.assign({}, options, { headers }));
    let data = {};
    try { data = await response.json(); } catch { /* empty body */ }
    if (!response.ok) {
      const error = new Error((data && data.error && data.error.message) || 'Chat is temporarily unavailable.');
      error.status = response.status;
      throw error;
    }
    return data;
  };

  const unavailable = () => {
    title.textContent = 'Chat not available';
    note.textContent = 'This chat link is not available right now. Please contact the business directly.';
    form.hidden = true;
  };

  const startSession = async () => {
    const session = await api('/v1/connect/hosted/' + code + '/session', { method: 'POST', body: '{}' });
    token = session.token;
    return session;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if (!message || busy || !token) return;
    busy = true; send.disabled = true; input.value = '';
    add(message, 'me');
    const waiting = add('Thinking…', 'wait');
    try {
      let data;
      const body = () => JSON.stringify(Object.assign({ message }, conversationId ? { conversation_id: conversationId } : {}));
      try { data = await api('/v1/chat', { method: 'POST', body: body() }); } catch (error) {
        if (error.status !== 401) throw error;
        await startSession(); // the session expired: start a fresh one and retry once
        data = await api('/v1/chat', { method: 'POST', body: body() });
      }
      conversationId = (data && data.conversation_id) || conversationId;
      waiting.remove();
      add((data && data.message && data.message.content) || 'Sorry, I could not produce a reply.', 'bot');
    } catch (error) {
      waiting.textContent = error.message;
    } finally {
      busy = false; send.disabled = false; input.focus();
    }
  });

  (async () => {
    if (!code) { unavailable(); return; }
    try {
      const session = await startSession();
      title.textContent = session.name;
      document.title = 'Chat with ' + session.name;
      note.textContent = 'Ask a question and our AI assistant will reply.';
      add(session.welcome, 'bot');
      form.hidden = false;
      input.focus();
    } catch { unavailable(); }
  })();
})();
