// Turns Nasrin's replies into tidy, readable blocks: headings, lists, steps,
// quotes, code and links. Only a small, safe subset of Markdown is understood,
// and everything is built with DOM nodes and textContent (never innerHTML), so
// nothing in a reply can run as code. Exposes window.NasrinFormat.
(() => {
  'use strict';

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // Inline formatting and safe links. Known legal links use concise labels and first-party routes.
  const knownLegalLink = (label, rawUrl) => {
    const name = String(label || '').replace(/[*_]/g, '').trim().toLowerCase();
    const url = String(rawUrl || '').toLowerCase();
    if (/terms/.test(name) || /terms/.test(url)) return { href: '/legal.html?doc=terms', label: 'Terms of Service' };
    if (/privacy/.test(name) || /privacy/.test(url)) return { href: '/legal.html?doc=privacy', label: 'Privacy Notice' };
    return null;
  };

  function inline(parent, text) {
    const re = /(\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*\n]+\*\*|\x60[^\x60\n]+\x60|https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;
    let last = 0; let m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const t = m[0];
      if (t.startsWith('[')) {
        const md = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(t);
        if (!md) parent.appendChild(document.createTextNode(t));
        else {
          const legal = knownLegalLink(md[1], md[2]);
          const href = legal ? legal.href : md[2];
          const label = legal ? legal.label : md[1];
          let valid = false;
          try { valid = ['http:', 'https:'].includes(new URL(href, location.origin).protocol); } catch { valid = false; }
          if (valid) {
            const a = el('a', 'assistant-link', label);
            a.href = href;
            a.rel = 'noopener noreferrer nofollow';
            if (/^https?:\/\//i.test(href) && new URL(href).origin !== location.origin) a.target = '_blank';
            parent.appendChild(a);
          } else parent.appendChild(document.createTextNode(label));
        }
      } else if (t.startsWith('**')) parent.appendChild(el('strong', '', t.slice(2, -2)));
      else if (t.startsWith('\x60')) parent.appendChild(el('code', '', t.slice(1, -1)));
      else {
        let valid = false;
        try { valid = ['http:', 'https:'].includes(new URL(t).protocol); } catch { valid = false; }
        if (valid) {
          const legal = knownLegalLink('', t);
          const a = el('a', 'assistant-link', legal ? legal.label : t.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60) + (t.length > 68 ? '…' : ''));
          a.href = legal ? legal.href : t;
          a.rel = 'noopener noreferrer nofollow';
          if (!legal) a.target = '_blank';
          parent.appendChild(a);
        } else parent.appendChild(document.createTextNode(t));
      }
      last = m.index + t.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    return parent;
  }

  // Status icons: outline line icons drawn here (the page loads nothing from
  // other sites). Each row of a [[checks]] block and each status emoji at the
  // start of a line gets one: done, failed, warning, secured, info, action.
  const SVG = 'http://www.w3.org/2000/svg';
  const ICONS = {
    ok: ['M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z', 'm8.5 12.4 2.4 2.4 4.6-4.9'],
    fail: ['M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z', 'm9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6'],
    warn: ['M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z', 'M12 9.5v4M12 17v.01'],
    secure: ['M12 3 5 6v5.6c0 4.3 2.9 8.2 7 9.4 4.1-1.2 7-5.1 7-9.4V6z', 'm9.2 12.1 2 2 3.8-4'],
    info: ['M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18z', 'M12 11v5.5M12 7.6v.01'],
    key: ['M7.5 11.5a4 4 0 1 1 0 8a4 4 0 1 1 0-8z', 'm10.4 12.6 8.6-8.6M16.5 6.5l2.2 2.2M14 9l2.2 2.2']
  };
  const STATUS = { ok: 'ok', done: 'ok', pass: 'ok', passed: 'ok', success: 'ok', fail: 'fail', failed: 'fail', error: 'fail', x: 'fail',
    warn: 'warn', warning: 'warn', risk: 'warn', secure: 'secure', secured: 'secure', shield: 'secure', blocked: 'secure',
    info: 'info', note: 'info', todo: 'key', action: 'key', key: 'key' };
  const EMOJI = { '✅': 'ok', '✔️': 'ok', '✔': 'ok', '❌': 'fail', '✖️': 'fail', '⚠️': 'warn', '⚠': 'warn', '🛡️': 'secure', '🛡': 'secure', '🔒': 'secure', 'ℹ️': 'info', '🔑': 'key', '👉': 'key' };
  function icon(kind) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'st-ico st-' + kind);
    for (const d of ICONS[kind]) { const path = document.createElementNS(SVG, 'path'); path.setAttribute('d', d); svg.appendChild(path); }
    return svg;
  }
  const LABEL = { ok: 'Done', fail: 'Failed', warn: 'Warning', secure: 'Secured', info: 'Note', key: 'Action needed' };
  const EMOJI_LEAD = new RegExp('^(' + Object.keys(EMOJI).map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s*');
  // A line that starts with a status emoji: the emoji becomes the icon.
  function leadIcon(parent, text) {
    const m = EMOJI_LEAD.exec(text);
    if (!m) return inline(parent, text);
    const kind = EMOJI[m[1]];
    parent.classList.add('st-line');
    const ico = icon(kind);
    ico.setAttribute('role', 'img');
    ico.setAttribute('aria-label', LABEL[kind]);
    ico.removeAttribute('aria-hidden');
    parent.appendChild(ico);
    return inline(parent, text.slice(m[0].length));
  }
  // [[checks title="Tests"]] then rows "status | item | badge" (badge optional).
  const CHECKS_OPEN = /^\[\[checks(?:\s+title\s*=\s*"([^"\n]{0,80})")?\s*\]\]$/i;
  function checksBlock(title, rows) {
    const card = el('div', 'checks');
    if (title) card.appendChild(inline(el('p', 'checks-title'), title));
    const list = el('ul', 'checks-list');
    for (const row of rows.slice(0, 30)) {
      const parts = row.split('|').map((x) => x.trim());
      const kind = STATUS[(parts[0] || '').toLowerCase()];
      const item = kind ? parts[1] || '' : parts[0];
      const badge = kind ? parts[2] || '' : parts[1] || '';
      const k = kind || 'info';
      const li = el('li', 'check st-row-' + k);
      const ico = icon(k);
      ico.setAttribute('role', 'img');
      ico.setAttribute('aria-label', LABEL[k]);
      ico.removeAttribute('aria-hidden');
      li.append(ico, inline(el('span', 'check-text'), item));
      if (badge) li.appendChild(el('span', 'check-badge st-badge-' + k, badge.slice(0, 40)));
      list.appendChild(li);
    }
    card.appendChild(list);
    return card;
  }

  // Tables: at most 8 columns and 50 rows, cell text only (inline formatting).
  const TABLE_SEP = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;
  const MAX_COLS = 8;
  const MAX_ROWS = 50;
  const cells = (row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  // Returns { node, blocks } where blocks are the top-level elements (for the
  // reveal animation) and steps are numbered items people can tick off.
  function render(text) {
    // Fail safely if the optional Generative UI enhancer did not initialize
    // (for example, a stale mobile asset or a tier-specific render path).
    // Never expose internal [[ui]] protocol envelopes as ordinary assistant text.
    text = String(text ?? '').replace(/\[\[\s*ui\s*\]\]\s*([\s\S]{1,12000}?)\s*\[\[\s*\/ui\s*\]\]/gi, (whole, rawPayload) => {
      let payload = null;
      try { payload = JSON.parse(String(rawPayload).trim()); } catch { /* safe generic fallback below */ }
      if (payload && typeof payload === 'object' && !Array.isArray(payload) && payload.type === 'search' && typeof payload.query === 'string' && payload.query.trim()) {
        return 'Web search requested: ' + payload.query.trim().slice(0, 240) + '.';
      }
      return 'An interactive response could not be displayed. Please try again.';
    });
    // Normalize provider-escaped line breaks, even when JSON/provider layers double-escape them.
    // This runs at the final UI rendering boundary, before paragraph/list parsing.
    const normalized = String(text ?? '')
      .replace(/\\{1,}r\\{1,}n/g, '\n')
      .replace(/\\{1,}n[ \t]*\\{1,}n/g, '\n\n')
      .replace(/\\{1,}n/g, '\n')
      .replace(/\\{1,}r/g, '\n');
    text = normalized;
    const frag = document.createDocumentFragment();
    const blocks = [];
    const add = (n) => { frag.appendChild(n); blocks.push(n); return n; };
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    let para = []; let list = null; let listKind = '';

    const flushPara = () => {
      if (!para.length) return;
      add(leadIcon(el('p'), para.join(' ')));
      para = [];
    };
    const endList = () => { list = null; listKind = ''; };

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();

      // ``` code block ```
      if (line.startsWith('```')) {
        flushPara(); endList();
        const lang = line.slice(3).trim().slice(0, 20);
        const code = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++]);
        const wrap = add(el('div', 'code-block'));
        const head = el('div', 'code-head');
        head.appendChild(el('span', 'code-lang', lang || 'code'));
        const copy = el('button', 'code-copy', 'Copy');
        copy.type = 'button';
        copy.dataset.copy = code.join('\n');
        head.appendChild(copy);
        const pre = el('pre');
        pre.appendChild(el('code', '', code.join('\n')));
        wrap.append(head, pre);
        continue;
      }
      if (!line) { flushPara(); endList(); continue; }

      // [[checks title="..."]] status rows [[/checks]]
      const open = CHECKS_OPEN.exec(line);
      if (open) {
        flushPara(); endList();
        const rows = [];
        i++;
        while (i < lines.length && !/^\[\[\/checks\]\]$/i.test(lines[i].trim())) { if (lines[i].trim()) rows.push(lines[i].trim()); i++; }
        add(checksBlock(open[1] || '', rows));
        continue;
      }

      // | a | b | table: a header row, a --- separator row, then body rows.
      if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1].trim())) {
        flushPara(); endList();
        const head = cells(line).slice(0, MAX_COLS);
        const body = [];
        i += 2;
        while (i < lines.length && lines[i].trim().includes('|') && lines[i].trim()) {
          if (body.length < MAX_ROWS) body.push(cells(lines[i].trim()).slice(0, MAX_COLS));
          i++;
        }
        i--;
        const wrap = add(el('div', 'table-wrap'));
        wrap.setAttribute('role', 'region');
        wrap.setAttribute('aria-label', 'Table');
        wrap.setAttribute('tabindex', '0');
        const table = el('table');
        const thead = el('thead');
        const hr = el('tr');
        for (const c of head) hr.appendChild(inline(el('th'), c));
        thead.appendChild(hr);
        const tbody = el('tbody');
        for (const r of body) {
          const tr = el('tr');
          for (let k = 0; k < head.length; k++) tr.appendChild(inline(el('td'), r[k] || ''));
          tbody.appendChild(tr);
        }
        table.append(thead, tbody);
        wrap.appendChild(table);
        continue;
      }

      let m = /^(#{1,4})\s+(.+)$/.exec(line);
      if (m) { flushPara(); endList(); add(leadIcon(el(m[1].length <= 2 ? 'h3' : 'h4'), m[2].replace(/\s*#+\s*$/, ''))); continue; }

      m = /^(\d{1,3})[.)]\s+(.+)$/.exec(line);
      if (m) {
        flushPara();
        if (listKind !== 'ol') {
          list = add(el('ol', 'steps'));
          if (m[1] !== '1') list.start = Number(m[1]);
          listKind = 'ol';
        }
        const li = el('li', 'step');
        const tick = el('button', 'step-tick');
        tick.type = 'button';
        tick.setAttribute('aria-pressed', 'false');
        tick.setAttribute('aria-label', 'Mark step done');
        const body = inline(el('div', 'step-text'), m[2]);
        li.append(tick, body);
        list.appendChild(li);
        continue;
      }

      m = /^[-*•]\s+(.+)$/.exec(line);
      if (m) {
        flushPara();
        if (listKind !== 'ul') { list = add(el('ul')); listKind = 'ul'; }
        list.appendChild(leadIcon(el('li'), m[1]));
        continue;
      }

      m = /^>\s?(.*)$/.exec(line);
      if (m) { flushPara(); endList(); add(inline(el('blockquote'), m[1])); continue; }

      // A wrapped line that continues a list item.
      if (list && /^\s{2,}\S/.test(raw) && list.lastElementChild) {
        const target = list.lastElementChild.querySelector('.step-text') || list.lastElementChild;
        target.appendChild(document.createTextNode(' '));
        inline(target, line);
        continue;
      }
      endList();
      para.push(line);
    }
    flushPara();
    return { node: frag, blocks };
  }

  // Plain words for copying and reading aloud: no Markdown symbols.
  function plain(text) {
    return String(text)
      .replace(/^\[\[checks(?:\s+title\s*=\s*"([^"\n]*)")?\s*\]\]$/gim, (_, t) => t || '')
      .replace(/^\[\[\/checks\]\]$/gim, '')
      .replace(/^(ok|done|pass|passed|success|fail|failed|error|x|warn|warning|risk|secure|secured|shield|blocked|info|note|todo|action|key)\s*\|\s*([^|\n]*?)\s*(?:\|\s*([^|\n]*))?$/gim, (_, k, item, badge) => '• ' + item + (badge ? ' — ' + badge : ''))
      .replace(/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$\n?/gm, '')
      .replace(/^\|(.*)\|\s*$/gm, (row, inner) => inner.split('|').map((c) => c.trim()).join(' · '))
      .replace(/```[\s\S]*?```/g, (b) => b.replace(/```[^\n]*\n?/g, ''))
      .replace(/^#{1,4}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^[-*•]\s+/gm, '• ')
      .replace(/^>\s?/gm, '')
      .trim();
  }

  // External URLs are collected into the collapsed Sources & Resources control.
  // Code is masked first so examples and snippets never become accidental citations.
  const SOURCES_BLOCK = /\n*\*\*Sources\*\*\n((?:- \[[^\]\n]*\]\(<[^>\s]+>\)[ \t]*(?:\n|$))+)\s*$/;
  function sources(text) {
    const raw = String(text || '');
    const code = [];
    const mask = (value, pattern) => value.replace(pattern, (match) => {
      const token = '\uE000NASRINCODE' + code.length + '\uE001';
      code.push(match);
      return token;
    });
    let visible = mask(raw, /\x60\x60\x60[\s\S]*?\x60\x60\x60|\x60[^\x60\n]*\x60/g);
    const block = SOURCES_BLOCK.exec(visible);
    if (block) visible = visible.slice(0, block.index).trim();
    const links = [];
    const addLink = (title, rawUrl) => {
      let u;
      try { u = new URL(rawUrl, location.origin); } catch { return { ok: false, internal: false }; }
      if (!['https:', 'http:'].includes(u.protocol) || !u.hostname || u.username || u.password) {
        return { ok: false, internal: false };
      }
      const internal = u.hostname === 'nasrinai.com' || u.hostname.endsWith('.nasrinai.com')
        || u.hostname === new URL(location.origin).hostname;
      if (internal) return { ok: true, internal: true };
      const host = u.hostname.replace(/^www\./, '');
      if (!links.some((item) => item.url === u.href)) {
        links.push({ title: String(title || '').trim() || host, url: u.href, host });
      }
      return { ok: true, internal: false };
    };
    if (block) {
      for (const [, title, url] of block[1].matchAll(/- \[([^\]\n]*)\]\(<([^>\s]+)>\)/g)) {
        const result = addLink(title, url);
        if (!result.ok) return { text: raw, links: [] };
      }
    }
    // Same-site navigation stays inline; external destinations move into Resources.
    visible = visible.replace(/\[([^\]\n]+)\]\((?:<(https?:\/\/[^>\s]+)>|(https?:\/\/[^)\s]+))\)/g, (match, title, angled, plain) => {
      const result = addLink(title, angled || plain);
      return result.ok && !result.internal ? title : match;
    });
    // Bare external URLs move into Resources too. URLs inside code are masked.
    visible = visible.replace(/https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/g, (url) => {
      const cleaned = url.replace(/[)\]}]+$/, '');
      const result = addLink('', cleaned);
      return result.ok && !result.internal ? '' : url;
    });
    visible = visible.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.;:!?])/g, '$1').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    visible = visible.replace(/\uE000NASRINCODE(\d+)\uE001/g, (_, n) => code[Number(n)] || '');
    return { text: visible, links: links.slice(0, 20) };
  }
  window.NasrinFormat = { render, plain, sources };
})();
