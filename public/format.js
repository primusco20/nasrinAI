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

  // Inline: **bold**, `code`, and bare http(s) links.
  function inline(parent, text) {
    const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;
    let last = 0; let m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      const t = m[0];
      if (t.startsWith('**')) parent.appendChild(el('strong', '', t.slice(2, -2)));
      else if (t.startsWith('`')) parent.appendChild(el('code', '', t.slice(1, -1)));
      else {
        let ok = false;
        try { ok = ['http:', 'https:'].includes(new URL(t).protocol); } catch { ok = false; }
        if (ok) {
          const a = el('a', '', t.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60) + (t.length > 68 ? '…' : ''));
          a.href = t; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow';
          parent.appendChild(a);
        } else parent.appendChild(document.createTextNode(t));
      }
      last = m.index + t.length;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    return parent;
  }

  // Returns { node, blocks } where blocks are the top-level elements (for the
  // reveal animation) and steps are numbered items people can tick off.
  function render(text) {
    const frag = document.createDocumentFragment();
    const blocks = [];
    const add = (n) => { frag.appendChild(n); blocks.push(n); return n; };
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    let para = []; let list = null; let listKind = '';

    const flushPara = () => {
      if (!para.length) return;
      add(inline(el('p'), para.join(' ')));
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

      let m = /^(#{1,4})\s+(.+)$/.exec(line);
      if (m) { flushPara(); endList(); add(inline(el(m[1].length <= 2 ? 'h3' : 'h4'), m[2].replace(/\s*#+\s*$/, ''))); continue; }

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
        list.appendChild(inline(el('li'), m[1]));
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
      .replace(/```[\s\S]*?```/g, (b) => b.replace(/```[^\n]*\n?/g, ''))
      .replace(/^#{1,4}\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/^[-*•]\s+/gm, '• ')
      .replace(/^>\s?/gm, '')
      .trim();
  }

  window.NasrinFormat = { render, plain };
})();
