/* NasrinAI Connect SmartChat V1
 * Public install: <script defer src="https://nasrinai.com/connect/smartchat.js" data-nasrin-key="nsp_..."></script>
 * No secrets are embedded. The publishable key is origin-locked by the server.
 *
 * Built with the DOM and styled through the CSS object model (not inline style="" markup),
 * so a website's strict Content-Security-Policy does not strip the widget's styling.
 * The site's policy must still allow this script and its API: script-src and connect-src
 * need the NasrinAI address.
 */
(() => {
  'use strict';
  const script = document.currentScript;
  const key = script && script.dataset.nasrinKey;
  if (!key || !/^nsp_[A-Za-z0-9._-]+$/.test(key)) return;

  const api = (script.dataset.nasrinApi || 'https://nasrinai.com').replace(/\/$/, '');
  const el = (tag, css, text) => {
    const node = document.createElement(tag);
    if (css) node.style.cssText = css;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const mount = () => {
    if (document.getElementById('nasrinai-connect')) return;
    const root = el('div');
    root.id = 'nasrinai-connect';
    const button = el('button', 'position:fixed;right:20px;bottom:20px;z-index:2147483000;border:0;border-radius:999px;padding:14px 18px;background:#111;color:#fff;font:600 14px system-ui;box-shadow:0 8px 30px #0002;cursor:pointer', 'Chat with us');
    button.type = 'button';
    button.setAttribute('aria-label', 'Chat with us');
    root.appendChild(button);
    document.body.appendChild(root);

    let token = null, conversationId = null, busy = false, panel = null;

    const request = async (path, options = {}) => {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
      if (token) headers.Authorization = 'Bearer ' + token;
      if (!token) headers['X-NasrinAI-Key'] = key;
      const response = await fetch(api + path, Object.assign({}, options, { headers }));
      let data = {};
      try { data = await response.json(); } catch {}
      if (!response.ok) throw new Error(data?.error?.message || 'NasrinAI is temporarily unavailable.');
      return data;
    };

    const open = async () => {
      if (panel) { panel.hidden = false; return; }
      panel = el('section', 'position:fixed;right:20px;bottom:78px;z-index:2147483000;width:min(380px,calc(100vw - 32px));height:min(620px,calc(100vh - 110px));background:#fff;color:#111;border:1px solid #ddd;border-radius:18px;box-shadow:0 18px 60px #0003;display:flex;flex-direction:column;overflow:hidden;font:14px system-ui');
      panel.setAttribute('aria-label', 'NasrinAI chat');
      const header = el('header', 'padding:14px 16px;border-bottom:1px solid #eee;font-weight:700;display:flex;justify-content:space-between;align-items:center');
      header.appendChild(el('span', '', 'NasrinAI'));
      const close = el('button', 'border:0;background:none;font-size:18px;cursor:pointer', '×');
      close.type = 'button';
      close.setAttribute('aria-label', 'Close');
      close.onclick = () => { panel.hidden = true; };
      header.appendChild(close);
      const main = el('main', 'flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px');
      const form = el('form', 'display:flex;gap:8px;padding:10px;border-top:1px solid #eee');
      const input = el('input', 'min-width:0;flex:1;padding:11px;border:1px solid #ddd;border-radius:10px');
      input.setAttribute('autocomplete', 'off');
      input.placeholder = 'Ask us anything…';
      const send = el('button', 'padding:11px 14px;border:0;border-radius:10px;background:#111;color:#fff', 'Send');
      form.append(input, send);
      panel.append(header, main, form);
      document.body.appendChild(panel);

      const add = (text, who) => {
        const item = el('div', 'align-self:' + (who === 'user' ? 'flex-end' : 'flex-start') + ';max-width:85%;padding:9px 11px;border-radius:12px;background:' + (who === 'user' ? '#111;color:#fff' : '#f3f3f3;color:#111'), text);
        main.appendChild(item); main.scrollTop = main.scrollHeight;
      };
      add('Hi! How can I help?', 'assistant');

      try {
        const session = await request('/v1/guest/sessions', { method: 'POST', body: '{}' });
        token = session.token;
      } catch (e) { add(e.message, 'assistant'); }

      form.onsubmit = async (event) => {
        event.preventDefault();
        const message = input.value.trim();
        if (!message || busy || !token) return;
        busy = true; input.value = ''; add(message, 'user');
        const pending = el('div', 'color:#777;padding:9px 11px', 'Thinking…');
        main.appendChild(pending);
        try {
          const data = await request('/v1/chat', { method: 'POST', body: JSON.stringify({ message, ...(conversationId ? { conversation_id: conversationId } : {}) }) });
          conversationId = data?.conversation_id || conversationId;
          pending.remove();
          add(data?.message?.content || 'I could not produce a reply.', 'assistant');
        } catch (e) { pending.textContent = e.message; }
        finally { busy = false; }
      };
    };

    button.onclick = open;
  };

  // Works whether the tag sits in <head> (deferred or not) or at the end of <body>.
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
