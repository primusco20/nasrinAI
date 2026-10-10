// Safe, dependency-free Markdown-to-HTML conversion for downloadable user documents.
// All source text is escaped; raw HTML from model output is never trusted or executed.
(() => {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>\"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#39;' }[c]));
  function inline(s) {
    let out = '';
    const re = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|https?:\/\/[^\s<>()\"']+)/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index)); const t = m[0];
      if (t.startsWith('**')) out += '<strong>' + esc(t.slice(2, -2)) + '</strong>';
      else if (t.startsWith('*')) out += '<em>' + esc(t.slice(1, -1)) + '</em>';
      else if (t.startsWith('`')) out += '<code>' + esc(t.slice(1, -1)) + '</code>';
      else if (t.startsWith('[')) out += '<a href="' + esc(m[3]) + '" rel="noopener noreferrer">' + esc(m[2]) + '</a>';
      else { let safe = false; try { safe = ['http:', 'https:'].includes(new URL(t).protocol); } catch {} out += safe ? '<a href="' + esc(t) + '" rel="noopener noreferrer">' + esc(t) + '</a>' : esc(t); }
      last = m.index + t.length;
    }
    return out + esc(s.slice(last));
  }
  function convert(markdown, title) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const out = []; let p = [], list = '', code = false, codeLines = [];
    const flush = () => { if (p.length) { out.push('<p>' + inline(p.join(' ')) + '</p>'); p = []; } };
    const endList = () => { if (list) { out.push('</' + list + '>'); list = ''; } };
    for (const raw of lines) { const line = raw.trim();
      if (line.startsWith('```')) { flush(); endList(); if (code) { out.push('<pre><code>' + esc(codeLines.join('\n')) + '</code></pre>'); codeLines = []; code = false; } else code = true; continue; }
      if (code) { codeLines.push(raw); continue; }
      if (!line) { flush(); endList(); continue; }
      let m = /^(#{1,6})\s+(.+)$/.exec(line);
      if (m) { flush(); endList(); const n = m[1].length; out.push('<h' + n + '>' + inline(m[2].replace(/\s*#+\s*$/, '')) + '</h' + n + '>'); continue; }
      m = /^[-*+]\s+(.+)$/.exec(line);
      if (m) { flush(); if (list !== 'ul') { endList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      m = /^\d+[.)]\s+(.+)$/.exec(line);
      if (m) { flush(); if (list !== 'ol') { endList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); continue; }
      m = /^>\s?(.*)$/.exec(line); if (m) { flush(); endList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); continue; }
      endList(); p.push(line);
    }
    if (code) out.push('<pre><code>' + esc(codeLines.join('\n')) + '</code></pre>'); flush(); endList();
    const safeTitle = esc(String(title || 'NasrinAI Document').replace(/\.html?$/i, ''));
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>' + safeTitle + '</title><style>:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.7;color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:#f4f4f1;color:#202124}main{max-width:900px;margin:clamp(16px,5vw,56px) auto;padding:clamp(24px,5vw,64px);background:#fff;border:1px solid #e7e7e3;border-radius:24px}h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.5em 0 .55em}h1:first-child,h2:first-child,h3:first-child{margin-top:0}p,ul,ol,blockquote,pre{margin:0 0 1em}a{color:#d96a1d;overflow-wrap:anywhere}li{margin:.3em 0}blockquote{border-left:3px solid #d96a1d;padding-left:1em;color:#555}pre{padding:16px;overflow:auto;border-radius:12px;background:#18181b;color:#f4f4f5}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}p code,li code{background:#eee;padding:.12em .35em;border-radius:5px}@media(prefers-color-scheme:dark){body{background:#0c0c0d;color:#f2f2f2}main{background:#151516;border-color:#303033}blockquote{color:#c5c5c5}p code,li code{background:#303033}}@media print{body{background:#fff;color:#111}main{max-width:none;margin:0;padding:0;border:0}a{color:inherit}}</style></head><body><main>' + out.join('\n') + '</main></body></html>\n';
  }
  window.NasrinMarkdownHtml = { convert };
})();
