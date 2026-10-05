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
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const Nasrin = window.Nasrin;

  // localStorage holds only the guest session, the current conversation id,
  // the signed-in email (for display; the sign-in itself is an HttpOnly cookie
  // scripts cannot read) and preferences. The conversation lives on the server.
  const KEYS = {
    session: 'nasrin.session', conversation: 'nasrin.conversation', speak: 'nasrin.speak',
    model: 'nasrin.model', theme: 'nasrin.theme', voice: 'nasrin.voice', account: 'nasrin.account',
    notice: 'nasrin.notice'
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
    const resp = await net(path, { ...options, headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token } });
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

  function show(role, text, { animate = true, files = [], id = null, regenerate = null } = {}) {
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
      if (animate && !reduceMotion) blocks.forEach((b, i) => { b.classList.add('reveal'); b.style.setProperty('--d', Math.min(i, 12) * 70 + 'ms'); });
      el.appendChild(body);
      el.appendChild(replyActions(text, id));
    } else if (text) {
      el.appendChild(document.createTextNode(text));
    }
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

  // ---------- the + menu: files, or creating a picture ----------

  const plusMenu = $('plusMenu');
  const modeChip = $('modeChip');
  let imagesOn = false;
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

  // Nasrin's questions, each with quick answers and "Other".
  function showQuestions(job, questions) {
    const card = document.createElement('div');
    card.className = 'msg assistant image-card';
    const lede = document.createElement('p');
    lede.className = 'card-lede';
    lede.textContent = questions.length === 1 ? 'One question before I start:' : `A few questions before I start (${questions.length}):`;
    card.appendChild(lede);
    const picked = questions.map(() => '');
    questions.forEach((q, i) => {
      const box = document.createElement('fieldset');
      box.className = 'question';
      const legend = document.createElement('legend');
      legend.textContent = q.question;
      const chips = document.createElement('div');
      chips.className = 'answer-chips';
      const other = document.createElement('input');
      other.type = 'text';
      other.maxLength = 300;
      other.placeholder = 'Your answer';
      other.setAttribute('aria-label', q.question);
      other.hidden = q.choices.length > 0;
      const select = (btn, value) => {
        for (const b of chips.children) b.setAttribute('aria-pressed', String(b === btn));
        picked[i] = value;
      };
      for (const choice of q.choices) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'answer-chip';
        b.textContent = choice;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => { other.hidden = true; select(b, choice); });
        chips.appendChild(b);
      }
      if (q.choices.length) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'answer-chip';
        b.textContent = 'Other';
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => { select(b, other.value.trim()); other.hidden = false; other.focus(); });
        chips.appendChild(b);
      }
      other.addEventListener('input', () => { picked[i] = other.value.trim(); });
      box.append(legend, chips, other);
      card.appendChild(box);
    });
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

  async function send(raw) {
    const text = String(raw || '').trim();
    if ((!text && !pending.length) || busy || preparing || !aiAvailable) return;
    if (imageMode) {
      if (!text) { notice.textContent = 'Describe the picture you want.'; return; }
      const files = pending;
      pending = [];
      renderTray();
      return sendImage(text, files);
    }
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
          ...(currentModel ? { model: currentModel } : {}),
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
      if (data.pending_action) actionCard(data.pending_action);
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
      if (err.code === 'plan_required') openPlans(err.message);
      if (err.code === 'terms_required') checkTerms('update_prompt');
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
  for (const b of document.querySelectorAll('.starter:not(#starterImage)')) b.addEventListener('click', () => send(b.textContent));
  // "Create a picture" switches to picture mode; the person then describes it.
  $('starterImage').addEventListener('click', () => { setImageMode(true); input.focus(); });

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
    // iPhone: let read-aloud play like media, even with the ring/silent switch on.
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
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

  function setPlaying(button, on, loading = false) {
    if (!button) return;
    button.classList.toggle('is-playing', on);
    button.classList.toggle('is-loading', on && loading);
    const label = button.querySelector('.label');
    if (label) label.textContent = on ? 'Stop' : 'Listen';
    const shape = button.querySelector('path');
    if (shape) shape.setAttribute('d', on ? ICON_STOP : ICON_PLAY);
    button.setAttribute('aria-pressed', String(on));
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
      for (const src of sources) { try { src.stop(); } catch { /* not started */ } }
      setPlaying(button, false);
      if (Nasrin.current === 'speaking') Nasrin.mood('idle');
      finished();
    };
    playing = { stop: finish, button };
    setPlaying(button, true, true);   // feedback right away, while the first part loads

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
        src.connect(audioCtx.destination);
        src.start(at);
        at += buf.duration;
        sources.push(src);
        return src;
      };
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
      const finish = () => { if (done) return; done = true; setPlaying(button, false); if (Nasrin.current === 'speaking') Nasrin.mood('idle'); resolve(); };
      playing = { stop() { synth.cancel(); finish(); }, button };
      setPlaying(button, true);
      Nasrin.mood('speaking');
      chunks.forEach((c, i) => {
        const u = new SpeechSynthesisUtterance(c);
        if (voiceObj) { u.voice = voiceObj; u.lang = voiceObj.lang; }
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
    setTimeout(() => { btn.replaceChildren(svgIcon(btn.dataset.kind === 'share' ? ICON_SHARE : ICON_COPY)); btn.classList.remove('is-done'); btn.setAttribute('aria-label', before); }, 1400);
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
        const mine = playing && playing.button === b;
        stopSpeaking();
        if (!mine) readReply(text, id, b);
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
      if (on && !reduceMotion) Nasrin.flash('happy', 700);
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
  scrim.addEventListener('click', () => { closeSettings(); closeSignIn(); closePlans(); closeHistory(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSettings(); closeSignIn(); closePlans(); closeHistory(); closeMenu(true); } });

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
    conversationId = null;
    saved.del(KEYS.conversation);
    stopSpeaking();
    clearScreen();
    renderAccount();
    if (aiAvailable) loadModels();
    loadPlans();
    renderDataControls();
  }

  // ---------- your data: download, delete chats, delete account ----------

  function renderDataControls() {
    $('memoryBtn').hidden = !account;
    if (!account) { $('memoryBox').hidden = true; $('memoryBtn').setAttribute('aria-expanded', 'false'); }
    $('exportData').hidden = !account;
    $('deleteAccount').hidden = !account;
  }
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
        li.append(t, del);
        list.appendChild(li);
      }
      $('memoryStatus').textContent = list.children.length ? '' : 'Nothing yet. Ask Nasrin to remember something, then confirm it.';
      $('memoryClear').hidden = !list.children.length;
    } catch (err) {
      $('memoryStatus').textContent = err.message || 'Your notes could not be loaded. Please try again.';
    }
  }
  $('memoryBtn').addEventListener('click', () => {
    const open = $('memoryBox').hidden;
    $('memoryBox').hidden = !open;
    $('memoryBtn').setAttribute('aria-expanded', String(open));
    if (open) loadMemories();
  });
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
      saved.del(KEYS.conversation);
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
    account = { email, token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    saved.set(KEYS.account, { email });
    renderAccount();
    return account;
  }

  function signedOut() {
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
    if (bump && !reduceMotion) {
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
      : 'Max and Ultra come with a plan.';
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
      { id: 'free', name: 'Free', tiers: ['NasrinAI', 'Pro'], price: null },
      { id: 'max', name: 'Max', tiers: ['NasrinAI', 'Pro', 'Max'], price: null },
      { id: 'ultra', name: 'Ultra', tiers: ['NasrinAI', 'Pro', 'Max', 'Ultra'], price: null }
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
        if (c.id === conversationId) { conversationId = null; saved.del(KEYS.conversation); clearScreen(); }
        if (!historyList.children.length) $('historyStatus').textContent = 'No chats yet.';
      } catch (err) {
        $('historyStatus').textContent = err.message || 'That chat could not be deleted.';
        del.disabled = false;
      }
    });
    li.append(open, del);
    return li;
  }

  async function openHistory() {
    closeSettings(); closeSignIn(); closePlans();
    lastFocus = document.activeElement;
    scrim.hidden = false;
    historySheet.hidden = false;
    $('historyClose').focus();
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
  $('historyClose').addEventListener('click', closeHistory);
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
      imagesOn = Boolean(s.images && s.images.available);
      $('pickImage').hidden = !imagesOn;
      $('starterImage').hidden = !imagesOn;
      imageLimits = imagesOn ? { perGuest: Number(s.images.per_guest) || 0, perUserDay: Number(s.images.per_user_day) || 0 } : null;
      renderImageHint();
      if (s.sign_in && typeof s.sign_in === 'object') signInMethods = { email: s.sign_in.email === true, google: s.sign_in.google === true };
      if (s.speech && s.speech.available && Array.isArray(s.speech.voices) && s.speech.voices.length) {
        speech = { available: true, voices: s.speech.voices.filter((v) => v && typeof v.id === 'string' && typeof v.name === 'string'), default: s.speech.default };
      }
      const parts = ['Replies come from an AI and can be wrong. Check anything important.'];
      if (s.own_model && s.external_model) parts.push('Answers come from NasrinAI’s own model when it can; otherwise messages go to an outside AI service.');
      else if (s.own_model) parts.push('Answers come from NasrinAI’s own model; messages are not sent to an outside AI company.');
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
    if (account) checkTerms(signinResult === 'ok' ? 'signin' : 'update_prompt');
    renderDataControls();
  }

  autosize();
  loadStatus()
    .then(restoreAccount)
    .then(() => {
      showFirstVisitNotice();
      if (signinResult === 'failed') openSignIn('Google sign-in did not finish. Please try again.');
      if (aiAvailable) loadModels();
      loadPlans();
      if (new URLSearchParams(location.search).get('plan') === 'paid') {
        history.replaceState(null, '', location.pathname);
        openPlans('Thank you! Your plan is active once the payment is confirmed (usually within a minute).');
      }
      return loadConversation();
    });
})();
