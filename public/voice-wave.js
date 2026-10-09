// Voice wave: the fluid black-and-white sound wave on the voice screen.
// Plain script, no libraries, no inline code or inline styles (the page CSP
// forbids them). Colour comes from CSS (--ink), so it is black on Light and
// white on Dark and follows Settings > Appearance by itself.
//
// It listens to two things that already exist:
//   - #voice[data-state]  listening | speaking | thinking | paused | ...
//   - Nasrin.talk(0..1)   the real loudness of the voice being played
// Less motion (device setting or Settings > General > Reduce motion) draws a
// calm still wave instead of animating.
(() => {
  'use strict';

  const host = document.getElementById('voiceWave');
  const voice = document.getElementById('voice');
  if (!host || !voice) return;

  const NS = 'http://www.w3.org/2000/svg';
  const W = 800, CY = 150, N = 120;
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => motionQuery.matches || document.documentElement.getAttribute('data-motion') === 'reduce';

  // One entry per ribbon: height, waves across, speed, start phase, line width, opacity.
  const LAYERS = [
    { a: 1.00, f: 1.5, s: 1.2,  o: 0, w: 2.2, op: 1.00 },
    { a: 0.88, f: 2.0, s: -1.6, o: 2, w: 2.0, op: 0.80 },
    { a: 0.76, f: 2.6, s: 2.0,  o: 4, w: 1.8, op: 0.62 },
    { a: 0.62, f: 3.2, s: -2.4, o: 1, w: 1.6, op: 0.48 },
    { a: 0.46, f: 4.0, s: 2.9,  o: 5, w: 1.2, op: 0.34 },
    { a: 0.30, f: 1.1, s: 0.9,  o: 3, w: 1.6, op: 1.00, core: true }
  ];

  // How each voice state moves: resting height, extra swing, speed.
  const STATES = {
    listening: { base: 0.20, swing: 0.16, speed: 1.0 },
    speaking:  { base: 0.26, swing: 0.28, speed: 1.3 },
    thinking:  { base: 0.14, swing: 0.05, speed: 2.2 },
    paused:    { base: 0.03, swing: 0,    speed: 0.4 }
  };
  const IDLE = { base: 0.07, swing: 0.02, speed: 0.6 };

  // ---------- drawing ----------
  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  const svg = el('svg', { viewBox: '0 0 800 300', 'aria-hidden': 'true', focusable: 'false' }, host);
  const defs = el('defs', {}, svg);
  const blur = el('filter', { id: 'vwBlur', x: '-10%', y: '-60%', width: '120%', height: '220%' }, defs);
  el('feGaussianBlur', { stdDeviation: '8' }, blur);
  const soft = el('filter', { id: 'vwSoft', x: '-10%', y: '-60%', width: '120%', height: '220%' }, defs);
  el('feGaussianBlur', { stdDeviation: '0.9' }, soft);
  const grad = el('linearGradient', { id: 'vwEdge', x1: '0', x2: '1' }, defs);
  el('stop', { offset: '0', 'stop-color': '#000' }, grad);
  el('stop', { offset: '0.16', 'stop-color': '#fff' }, grad);
  el('stop', { offset: '0.84', 'stop-color': '#fff' }, grad);
  el('stop', { offset: '1', 'stop-color': '#000' }, grad);
  const mask = el('mask', { id: 'vwFade', maskUnits: 'userSpaceOnUse', x: '0', y: '0', width: '800', height: '300' }, defs);
  el('rect', { width: '800', height: '300', fill: 'url(#vwEdge)' }, mask);

  const stage = el('g', { mask: 'url(#vwFade)' }, svg);
  const fills = el('g', { class: 'vw-fills' }, stage);
  const glows = el('g', { class: 'vw-glows', filter: 'url(#vwBlur)' }, stage);
  const lines = el('g', { class: 'vw-lines', filter: 'url(#vwSoft)' }, stage);

  for (const L of LAYERS) {
    L.fill = el('path', { class: 'vw-fill', 'fill-opacity': L.core ? 0 : 0.1 * L.op }, fills);
    L.glow = el('path', { class: 'vw-glow', 'stroke-width': L.core ? 3.5 : 7, opacity: L.op }, glows);
    L.top = el('path', { class: 'vw-line', 'stroke-width': L.w, opacity: L.op }, lines);
    L.bot = el('path', { class: 'vw-line', 'stroke-width': L.core ? 0 : L.w * 0.6, opacity: L.op * 0.5 }, lines);
    L.y = new Float32Array(N + 1);
  }

  const xs = [];
  for (let i = 0; i <= N; i++) xs.push((i / N * W).toFixed(1));
  const env = [];
  for (let i = 0; i <= N; i++) env.push(Math.pow(Math.sin(Math.PI * i / N), 3));

  function render(phase, level) {
    for (const L of LAYERS) {
      const ph = phase * L.s + L.o;
      const amp = 112 * L.a * level;
      let top = '', bot = '', back = '';
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const w = Math.sin(L.f * 6.2832 * u + ph) * 0.62
                + Math.sin(L.f * 1.7 * 6.2832 * u - ph * 0.8 + 1.3) * 0.26
                + Math.sin(L.f * 2.9 * 6.2832 * u + ph * 1.4) * 0.12;
        const y = CY - w * env[i] * amp;
        const m = 2 * CY - y;   // the lower line mirrors the upper one
        const t = xs[i] + ' ' + y.toFixed(1);
        const b = xs[i] + ' ' + m.toFixed(1);
        top += (i ? 'L' : 'M') + t;
        bot += (i ? 'L' : 'M') + b;
        back = 'L' + b + back;
      }
      L.top.setAttribute('d', top);
      L.glow.setAttribute('d', top);
      L.bot.setAttribute('d', bot);
      L.fill.setAttribute('d', top + back + 'Z');
    }
  }

  // ---------- motion ----------
  let ext = 0;            // loudness of the voice being played, 0..1
  let level = 0.07;       // the wave's current height, eased
  let phase = 0;
  let last = 0;
  let raf = 0;
  let state = IDLE;
  let paused = false;

  const read = () => {
    const name = voice.dataset.state || '';
    state = STATES[name] || IDLE;
    paused = name === 'paused';
  };

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const t = now / 1000;
    ext *= Math.pow(0.04, dt);   // the voice level fades if no new reading arrives
    const wander = 0.5 + 0.5 * Math.sin(t * 2.3) * Math.sin(t * 0.9 + 1.7);
    const target = state.base + state.swing * wander + ext * 0.85;
    level += (target - level) * Math.min(1, dt * 6);
    phase += dt * state.speed;
    render(phase, Math.min(1.1, level));
    schedule();
  }

  const active = () => !voice.hidden && !document.hidden && !reduced();
  function schedule() {
    if (!raf && active()) raf = requestAnimationFrame(frame);
  }
  function stillFrame() {
    // Less motion: one calm wave, redrawn only when the state changes.
    render(1.2, paused ? 0.03 : 0.16);
  }
  function refresh() {
    read();
    if (reduced()) { if (raf) { cancelAnimationFrame(raf); raf = 0; } stillFrame(); return; }
    last = performance.now();
    schedule();
  }

  new MutationObserver(refresh).observe(voice, { attributes: true, attributeFilter: ['hidden', 'data-state'] });
  new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  document.addEventListener('visibilitychange', refresh);
  if (motionQuery.addEventListener) motionQuery.addEventListener('change', refresh);

  // Follow the real loudness of the spoken reply.
  const N_ = window.Nasrin;
  if (N_ && typeof N_.talk === 'function') {
    const original = N_.talk;
    N_.talk = function (value) {
      ext = Math.max(0, Math.min(1, Number(value) || 0));
      return original.apply(this, arguments);
    };
  }

  render(0, 0.07);
  refresh();
})();
