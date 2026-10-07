// Files and questions inside Nasrin's replies. Exposes window.NasrinFiles.
// Plain script, no libraries, no inline code (the page CSP forbids it).
//
//   parse(text)  -> { text, asks, files }
//        text   the reply without its [[ask]] and [[file]] blocks
//        asks   [{ question, choices }]   questions to answer by tapping or typing
//        files  [{ name, content }]       files Nasrin wrote for the person
//   strip(text)  the reply as it should look while it is still being written
//   make(file)   -> Promise<{ blob, name, size }>   the real file, built here in
//                   the browser: Word (.docx), Excel (.xlsx), PDF, or plain text
//                   of any kind (.md .txt .csv .json .html and code files)
//
// Nothing here runs what a reply contains. File content is only ever written
// into a file the person downloads themselves.
(() => {
  'use strict';

  // ---------- reading the blocks ----------

  const FILE_BLOCK = /\[\[file\s+name\s*=\s*"([^"\n]{1,120})"\s*\]\][ \t]*\n?([\s\S]*?)(?:\n?[ \t]*\[\[\/file\]\]|$)/gi;
  const ASK_BLOCK = /\[\[ask\]\][ \t]*\n?([\s\S]*?)(?:\n?[ \t]*\[\[\/ask\]\]|$)/i;

  // Formats built here. Anything else with a known text extension is saved as plain text.
  const TEXT_TYPES = {
    txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
    html: 'text/html', htm: 'text/html', xml: 'application/xml', css: 'text/css', svg: 'image/svg+xml', yaml: 'text/yaml', yml: 'text/yaml',
    js: 'text/javascript', mjs: 'text/javascript', ts: 'text/plain', jsx: 'text/plain', tsx: 'text/plain', vue: 'text/plain',
    py: 'text/x-python', java: 'text/plain', c: 'text/plain', h: 'text/plain', cpp: 'text/plain', cs: 'text/plain', go: 'text/plain',
    rs: 'text/plain', php: 'text/plain', rb: 'text/plain', sql: 'text/plain', sh: 'text/plain', kt: 'text/plain', swift: 'text/plain',
    ini: 'text/plain', toml: 'text/plain', log: 'text/plain', tex: 'text/plain', rtf: 'application/rtf', ics: 'text/calendar'
  };
  // Files that a computer would run when opened: kept as plain text instead (name.bat.txt).
  const RUNNABLE = new Set(['bat', 'cmd', 'com', 'exe', 'msi', 'scr', 'vbs', 'vbe', 'ps1', 'psm1', 'hta', 'lnk', 'reg', 'jse', 'wsf', 'jar', 'app', 'apk', 'dmg']);

  function cleanFileName(raw) {
    let name = String(raw || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '').slice(0, 80);
    if (!name) name = 'nasrin-file';
    const dot = name.lastIndexOf('.');
    let ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    if (!ext || !/^[a-z0-9]{1,6}$/.test(ext)) { name = (dot > 0 ? name.slice(0, dot) : name) + '.txt'; ext = 'txt'; }
    else if (RUNNABLE.has(ext)) { name += '.txt'; ext = 'txt'; }
    else if (!['docx', 'xlsx', 'pdf'].includes(ext) && !TEXT_TYPES[ext]) { name += '.txt'; ext = 'txt'; }
    return { name, ext };
  }

  // A whole file wrapped in one code fence loses the fence.
  const unfence = (s) => {
    const m = /^```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(s.trim());
    return m ? m[1] : s;
  };

  function parse(input) {
    let text = String(input || '');
    const files = [];
    text = text.replace(FILE_BLOCK, (all, name, body) => {
      if (files.length < 3) {
        const f = cleanFileName(name);
        files.push({ name: f.name, ext: f.ext, content: unfence(body).replace(/\s+$/, '') });
      }
      return '\n';
    });
    const asks = [];
    const ask = ASK_BLOCK.exec(text);
    if (ask) {
      for (const line of ask[1].split('\n')) {
        const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
        if (!parts.length || parts[0].length > 300) continue;
        const question = parts[0].replace(/^\s*(?:\d{1,2}[.)]|[-*•])\s+/, '');
        const choices = [...new Set(parts.slice(1).map((c) => c.slice(0, 80)))].slice(0, 5);
        if (question && asks.length < 4) asks.push({ question, choices });
      }
      text = text.replace(ASK_BLOCK, '\n');
    }
    return { text: text.replace(/\n{3,}/g, '\n\n').trim(), asks, files };
  }

  // While a reply is still arriving: blocks hidden, and a note where a file is being written.
  function strip(input) {
    const raw = String(input || '');
    const writing = /\[\[file\b/i.test(raw);
    const visible = raw
      .replace(/\[\[file\b[\s\S]*?(?:\[\[\/file\]\]|$)/gi, ' ')
      .replace(/\[\[ask\]\][\s\S]*?(?:\[\[\/ask\]\]|$)/gi, ' ')
      .replace(/\[\[?[a-z/]{0,5}$/i, '');                       // a block's first letters, still arriving
    return visible.replace(/\n{3,}/g, '\n\n').trim() + (writing ? '\n\nWriting your file…' : '');
  }

  // ---------- bytes ----------

  const enc = new TextEncoder();
  const bytes = (s) => enc.encode(s);
  const latin1 = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
  const join = (parts) => {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  };
  const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  // ---------- ZIP (stored, no compression: Word and Excel open it fine) ----------

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  function zip(entries) {
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = (((d.getFullYear() - 1980) & 127) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = []; const central = []; let offset = 0;
    for (const [name, content] of entries) {
      const data = typeof content === 'string' ? bytes(content) : content;
      const nm = bytes(name);
      const crc = crc32(data);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); head.setUint16(8, 0, true);
      head.setUint16(10, time, true); head.setUint16(12, date, true); head.setUint32(14, crc, true);
      head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, nm.length, true);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true);
      cd.setUint16(12, time, true); cd.setUint16(14, date, true); cd.setUint32(16, crc, true);
      cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nm.length, true); cd.setUint32(42, offset, true);
      parts.push(new Uint8Array(head.buffer), nm, data);
      central.push(new Uint8Array(cd.buffer), nm);
      offset += 30 + nm.length + data.length;
    }
    const cdBytes = join(central);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdBytes.length, true); end.setUint32(16, offset, true);
    return join([...parts, cdBytes, new Uint8Array(end.buffer)]);
  }

  // ---------- Word (.docx) ----------

  const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

  // **bold** and `code` inside a line.
  function runs(text, base = '') {
    const out = [];
    const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;
    let last = 0; let m;
    const run = (t, props) => { if (t) out.push(`<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xml(t)}</w:t></w:r>`); };
    while ((m = re.exec(text))) {
      run(text.slice(last, m.index), base);
      const t = m[0];
      if (t.startsWith('**')) run(t.slice(2, -2), base + '<w:b/>');
      else run(t.slice(1, -1), base + '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/>');
      last = m.index + t.length;
    }
    run(text.slice(last), base);
    return out.join('');
  }

  const para = (inner, style = '', ppr = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${ppr}</w:pPr>${inner}</w:p>`;

  function docxBody(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let buf = [];
    const flush = () => { if (buf.length) { out.push(para(runs(buf.join(' ')))); buf = []; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('```')) {
        flush();
        i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          out.push(para(`<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${xml(lines[i])}</w:t></w:r>`, '', '<w:spacing w:after="0"/>'));
          i++;
        }
        continue;
      }
      if (!line) { flush(); continue; }
      let m = /^(#{1,4})\s+(.+)$/.exec(line);
      if (m) { flush(); out.push(para(runs(m[2].replace(/\s*#+\s*$/, '')), 'Heading' + Math.min(3, m[1].length))); continue; }
      m = /^(\d{1,3})[.)]\s+(.+)$/.exec(line);
      if (m) { flush(); out.push(para(runs(m[1] + '. ' + m[2]), '', '<w:ind w:left="540" w:hanging="360"/><w:spacing w:after="60"/>')); continue; }
      m = /^[-*•]\s+(.+)$/.exec(line);
      if (m) { flush(); out.push(para(runs('•\u00a0\u00a0' + m[1]), '', '<w:ind w:left="540" w:hanging="300"/><w:spacing w:after="60"/>')); continue; }
      m = /^>\s?(.*)$/.exec(line);
      if (m) { flush(); out.push(para(runs(m[1], '<w:i/>'), '', '<w:ind w:left="540"/>')); continue; }
      // A table: consecutive "| a | b |" lines.
      if (line.startsWith('|') && line.endsWith('|')) {
        flush();
        const rows = [];
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
          const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
          if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
          i++;
        }
        i--;
        const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('');
        out.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${rows.map((r, ri) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(runs(c, ri === 0 ? '<w:b/>' : ''), '', '<w:spacing w:after="40"/>')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`, para(''));
        continue;
      }
      buf.push(line);
    }
    flush();
    return out.join('') || para('');
  }

  function makeDocx(text) {
    const heading = (id, size, before) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="heading ${id.slice(-1)}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading('Heading1', 36, 320)}${heading('Heading2', 30, 260)}${heading('Heading3', 26, 200)}</w:styles>`;
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${docxBody(text)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1304" w:right="1304" w:bottom="1304" w:left="1304" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
      ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['word/styles.xml', styles],
      ['word/document.xml', document]
    ]);
  }

  // ---------- Excel (.xlsx) ----------

  function parseCsv(text) {
    const rows = []; let row = []; let cell = ''; let quoted = false;
    const s = String(text).replace(/\r\n?/g, '\n');
    // Semicolons or tabs, when that is what the first line uses.
    const first = s.split('\n', 1)[0];
    const sep = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
      } else if (ch === '"' && !cell) quoted = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ''));
  }

  const colName = (n) => { let s = ''; for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
  // Formulas are kept only when every function in them is an ordinary calculation.
  const SAFE_FUNCTIONS = new Set(['SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'IF', 'ABS', 'PRODUCT', 'SUMIF', 'COUNTIF', 'AVERAGEIF', 'MEDIAN', 'AND', 'OR', 'NOT', 'MOD', 'POWER', 'SQRT', 'TODAY', 'LEN', 'UPPER', 'LOWER', 'CONCATENATE', 'TEXT']);
  const safeFormula = (f) => /^=[A-Za-z0-9:+\-*/(),.$ <>=&%"!']*$/.test(f) && [...f.matchAll(/([A-Za-z][A-Za-z0-9.]*)\(/g)].every((m) => SAFE_FUNCTIONS.has(m[1].toUpperCase()));

  function makeXlsx(csv) {
    const rows = parseCsv(csv).slice(0, 5000);
    const widths = [];
    const sheet = rows.map((r, ri) => {
      const cells = r.slice(0, 100).map((raw, ci) => {
        const v = raw.trim();
        widths[ci] = Math.min(60, Math.max(widths[ci] || 8, v.length + 2));
        const ref = colName(ci) + (ri + 1);
        const style = ri === 0 && rows.length > 1 ? ' s="1"' : '';
        if (v === '') return '';
        if (/^-?\d{1,15}(\.\d+)?$/.test(v) && !/^-?0\d/.test(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
        if (v.startsWith('=') && safeFormula(v)) return `<c r="${ref}"${style}><f>${xml(v.slice(1))}</f></c>`;
        return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(raw)}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    return zip([
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
      ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0">${rows.length > 1 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews>${cols}<sheetData>${sheet}</sheetData></worksheet>`]
    ]);
  }

  // ---------- PDF ----------

  const PAGE = { w: 595, h: 842, margin: 56 };
  const WIN1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };
  // The letters PDF's built-in fonts can draw. Null when something else is in the text.
  function toWinAnsi(str) {
    const out = [];
    for (const ch of str) {
      const c = ch.codePointAt(0);
      if (c >= 0x20 && c <= 0x7e) out.push(c);
      else if (c >= 0xa0 && c <= 0xff) out.push(c);
      else if (WIN1252[ch]) out.push(WIN1252[ch]);
      else if (ch === '\t') out.push(0x20, 0x20, 0x20, 0x20);
      else if (c === 0xa0 || c === 0x200b || c === 0xfe0f) continue;
      else return null;
    }
    return out;
  }

  // Lays the text out in pages: [{ ops: [{ x, y, s, font, size }] }]. `measure` gives a width in points.
  function layout(text, measure) {
    const pages = [{ ops: [] }];
    let y = PAGE.margin;
    const maxW = PAGE.w - PAGE.margin * 2;
    const bottom = PAGE.h - PAGE.margin;
    const room = (h) => { if (y + h > bottom && pages.at(-1).ops.length) { pages.push({ ops: [] }); y = PAGE.margin; } };
    const wrap = (s, font, size, width) => {
      const lines = []; let line = '';
      for (const word of s.split(/(\s+)/)) {
        if (!word) continue;
        if (measure(line + word, font, size) <= width || !line.trim()) {
          line += word;
          // A single very long word is cut where it no longer fits.
          while (measure(line, font, size) > width && line.length > 1) {
            let n = line.length - 1;
            while (n > 1 && measure(line.slice(0, n), font, size) > width) n--;
            lines.push(line.slice(0, n)); line = line.slice(n);
          }
        } else { lines.push(line.trimEnd()); line = word.trimStart(); }
      }
      if (line.trim() || !lines.length) lines.push(line.trimEnd());
      return lines;
    };
    const put = (s, { font = 'F1', size = 11, x = PAGE.margin, width = maxW, before = 0, after = 5, lead = 1.38, bullet = '' } = {}) => {
      y += before;
      const lines = wrap(s, font, size, width);
      lines.forEach((ln, i) => {
        room(size * lead);
        y += size * lead;
        if (i === 0 && bullet) pages.at(-1).ops.push({ x: x - 14, y: y - size * 0.28, s: bullet, font, size });
        if (ln) pages.at(-1).ops.push({ x, y: y - size * 0.28, s: ln, font, size });
      });
      y += after;
    };
    const plainInline = (s) => s.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/`([^`\n]+)`/g, '$1');
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    let buf = [];
    const flush = () => { if (buf.length) { put(plainInline(buf.join(' '))); buf = []; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('```')) {
        flush(); i++;
        while (i < lines.length && !lines[i].trim().startsWith('```')) { put(lines[i].replace(/\t/g, '    '), { font: 'F3', size: 9.5, after: 0, lead: 1.3 }); i++; }
        y += 6; continue;
      }
      if (!line) { flush(); continue; }
      let m = /^(#{1,4})\s+(.+)$/.exec(line);
      if (m) { flush(); const lvl = Math.min(3, m[1].length); put(plainInline(m[2]), { font: 'F2', size: [0, 20, 15, 12.5][lvl], before: lvl === 1 ? 6 : 10, after: 6, lead: 1.25 }); continue; }
      m = /^(\d{1,3})[.)]\s+(.+)$/.exec(line);
      if (m) { flush(); put(plainInline(m[2]), { x: PAGE.margin + 24, width: maxW - 24, after: 3, bullet: m[1] + '.' }); continue; }
      m = /^[-*•]\s+(.+)$/.exec(line);
      if (m) { flush(); put(plainInline(m[1]), { x: PAGE.margin + 20, width: maxW - 20, after: 3, bullet: '•' }); continue; }
      m = /^>\s?(.*)$/.exec(line);
      if (m) { flush(); put(plainInline(m[1]), { font: 'F4', x: PAGE.margin + 18, width: maxW - 18 }); continue; }
      if (/^\|.*\|$/.test(line)) {
        flush();
        const cells = line.slice(1, -1).split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) put(plainInline(cells.join('   |   ')), { after: 2 });
        continue;
      }
      buf.push(line);
    }
    flush();
    return pages;
  }

  const pdfFonts = { F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Courier', F4: 'Helvetica-Oblique' };
  const cssFont = (font, size, scale = 1) => {
    const px = (size * scale).toFixed(2) + 'px';
    return font === 'F2' ? `bold ${px} Helvetica, Arial, "Liberation Sans", sans-serif`
      : font === 'F3' ? `${px} Courier, "Courier New", "Liberation Mono", monospace`
        : font === 'F4' ? `italic ${px} Helvetica, Arial, "Liberation Sans", sans-serif`
          : `${px} Helvetica, Arial, "Liberation Sans", sans-serif`;
  };

  async function makePdf(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const measure = (s, font, size) => {
      if (font === 'F3') return s.length * size * 0.6;
      ctx.font = cssFont(font, size);
      return ctx.measureText(s).width * 1.02;   // a little room, since viewers draw Helvetica themselves
    };
    const pages = layout(text, measure);
    const allText = pages.flatMap((p) => p.ops.map((o) => o.s)).join('');
    const plainOk = toWinAnsi(allText) !== null;

    const objs = [];   // Uint8Array bodies; object n is objs[n - 1]
    const add = (body) => { objs.push(typeof body === 'string' ? latin1(body) : body); return objs.length; };
    const catalog = add('');            // 1 (filled below)
    const tree = add('');               // 2

    const pageIds = [];
    let fontRefs = '';
    if (plainOk) {
      const ids = {};
      for (const [key, base] of Object.entries(pdfFonts)) ids[key] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`);
      fontRefs = Object.entries(ids).map(([k, id]) => `/${k} ${id} 0 R`).join(' ');
      for (const page of pages) {
        const stream = page.ops.map((o) => {
          const codes = toWinAnsi(o.s) || [];
          const lit = codes.map((c) => (c === 0x28 || c === 0x29 || c === 0x5c ? '\\' + String.fromCharCode(c) : c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : '\\' + c.toString(8).padStart(3, '0'))).join('');
          return `BT /${o.font} ${o.size} Tf 1 0 0 1 ${o.x.toFixed(2)} ${(PAGE.h - o.y).toFixed(2)} Tm (${lit}) Tj ET`;
        }).join('\n');
        const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
        pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << ${fontRefs} >> >> /Contents ${content} 0 R >>`));
      }
    } else {
      // Letters the built-in fonts cannot draw (₱, Arabic, Chinese, emoji ...): each page is drawn as a picture.
      const S = 2;
      canvas.width = PAGE.w * S; canvas.height = PAGE.h * S;
      for (const page of pages) {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#111111'; ctx.textBaseline = 'alphabetic';
        for (const o of page.ops) { ctx.font = cssFont(o.font, o.size, S); ctx.fillText(o.s, o.x * S, o.y * S); }
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
        const jpeg = new Uint8Array(await blob.arrayBuffer());
        const img = add(join([latin1(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, latin1('\nendstream')]));
        const draw = `q ${PAGE.w} 0 0 ${PAGE.h} 0 0 cm /Im0 Do Q`;
        const content = add(`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`);
        pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`));
      }
    }
    objs[catalog - 1] = latin1('<< /Type /Catalog /Pages 2 0 R >>');
    objs[tree - 1] = latin1(`<< /Type /Pages /Kids [${pageIds.map((id) => id + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`);

    const parts = [latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
    const offsets = [];
    let at = parts[0].length;
    objs.forEach((body, i) => {
      offsets.push(at);
      const chunk = join([latin1(`${i + 1} 0 obj\n`), body, latin1('\nendobj\n')]);
      parts.push(chunk); at += chunk.length;
    });
    const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`;
    parts.push(latin1(xref));
    return join(parts);
  }

  // ---------- one file ----------

  const MIME = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pdf: 'application/pdf'
  };

  // file: { name, ext?, content }. Resolves { blob, name, size }.
  async function make(file) {
    const f = file.ext ? file : { ...file, ...cleanFileName(file.name) };
    let data; let type;
    if (f.ext === 'docx') { data = makeDocx(f.content); type = MIME.docx; }
    else if (f.ext === 'xlsx') { data = makeXlsx(f.content); type = MIME.xlsx; }
    else if (f.ext === 'pdf') { data = await makePdf(f.content); type = MIME.pdf; }
    else { data = bytes(f.content); type = (TEXT_TYPES[f.ext] || 'text/plain') + ';charset=utf-8'; }
    const blob = new Blob([data], { type });
    return { blob, name: f.name, size: blob.size };
  }

  const sizeLabel = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

  window.NasrinFiles = { parse, strip, make, sizeLabel, cleanFileName };
})();
