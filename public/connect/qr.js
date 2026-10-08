/* NasrinAI Connect: tiny QR code generator (no dependencies, no network).
 * Byte mode, error correction level M, versions 1-6 (links up to 106 characters).
 * Exposes window.NasrinQR.matrix(text) and window.NasrinQR.svg(text).
 * Pages here forbid inline script and outside hosts, so the QR is made locally. */
(() => {
  'use strict';

  // version -> [EC codewords per block, number of blocks, total data codewords]
  const EC_M = { 1: [10, 1, 16], 2: [16, 1, 28], 3: [26, 1, 44], 4: [18, 2, 64], 5: [24, 2, 86], 6: [16, 4, 108] };
  const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

  const gfMul = (x, y) => {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z;
  };
  const rsDivisor = (degree) => {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < result.length) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  };
  const rsRemainder = (data, divisor) => {
    const result = divisor.map(() => 0);
    for (const b of data) {
      const factor = b ^ result.shift();
      result.push(0);
      divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
    }
    return result;
  };

  const utf8 = (text) => Array.from(new TextEncoder().encode(text));

  function codewords(bytes, version) {
    const [ecLen, blocks, dataTotal] = EC_M[version];
    const bits = [];
    const push = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    push(0b0100, 4);
    push(bytes.length, 8);
    bytes.forEach((b) => push(b, 8));
    push(0, Math.min(4, dataTotal * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let pad = 0xEC; data.length < dataTotal; pad ^= 0xEC ^ 0x11) data.push(pad);

    const per = dataTotal / blocks;
    const divisor = rsDivisor(ecLen);
    const dataBlocks = [];
    const ecBlocks = [];
    for (let b = 0; b < blocks; b++) {
      const block = data.slice(b * per, (b + 1) * per);
      dataBlocks.push(block);
      ecBlocks.push(rsRemainder(block, divisor));
    }
    const out = [];
    for (let i = 0; i < per; i++) dataBlocks.forEach((block) => out.push(block[i]));
    for (let i = 0; i < ecLen; i++) ecBlocks.forEach((block) => out.push(block[i]));
    return out;
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => ((((x * y) % 2) + ((x * y) % 3)) % 2) === 0,
    (x, y) => ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0
  ];

  function penalty(m, size) {
    let score = 0;
    const lines = [];
    for (let i = 0; i < size; i++) {
      lines.push(m[i].map((v) => (v ? '1' : '0')).join(''));
      lines.push(m.map((row) => (row[i] ? '1' : '0')).join(''));
    }
    for (const line of lines) {
      for (const run of line.match(/0+|1+/g)) if (run.length >= 5) score += 3 + run.length - 5;
      score += 40 * ((line.match(/(?=10111010000)/g) || []).length + (line.match(/(?=00001011101)/g) || []).length);
    }
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
    let dark = 0;
    m.forEach((row) => row.forEach((v) => { if (v) dark++; }));
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  function matrix(text) {
    const bytes = utf8(String(text));
    let version = 0;
    for (let v = 1; v <= 6; v++) if (4 + 8 + 8 * bytes.length <= EC_M[v][2] * 8) { version = v; break; }
    if (!version) throw new Error('Link is too long for the QR code.');
    const size = 17 + 4 * version;
    const modules = Array.from({ length: size }, () => new Array(size).fill(false));
    const isFn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { modules[y][x] = dark; isFn[y][x] = true; };

    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)); const x = cx + dx; const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const pos = ALIGN[version];
    pos.forEach((cy, i) => pos.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));

    const drawFormat = (mask) => {
      const data = mask; // error correction level M is 00
      let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      const bit = (i) => ((bits >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
      setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);

    const data = codewords(bytes, version);
    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
          if (!isFn[y][x] && bitIndex < data.length * 8) {
            modules[y][x] = ((data[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
            bitIndex++;
          }
        }
      }
    }

    const applyMask = (mask) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!isFn[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
    };
    let best = 0; let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      applyMask(mask); drawFormat(mask);
      const score = penalty(modules, size);
      if (score < bestScore) { bestScore = score; best = mask; }
      applyMask(mask);
    }
    applyMask(best); drawFormat(best);
    return { size, version, modules };
  }

  function svg(text, margin = 4) {
    const { size, modules } = matrix(text);
    const total = size + margin * 2;
    let path = '';
    for (let y = 0; y < size; y++) {
      let x = 0;
      while (x < size) {
        if (!modules[y][x]) { x++; continue; }
        let end = x;
        while (end < size && modules[y][end]) end++;
        path += 'M' + (x + margin) + ',' + (y + margin) + 'h' + (end - x) + 'v1h-' + (end - x) + 'z';
        x = end;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" shape-rendering="crispEdges">' +
      '<rect width="' + total + '" height="' + total + '" fill="#fff"/><path d="' + path + '" fill="#000"/></svg>';
  }

  globalThis.NasrinQR = { matrix, svg };
})();
