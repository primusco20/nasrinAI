// Nasrin, the character. Builds the SVG and runs its moods.
// Plain script, no libraries, no inline code (the page CSP forbids it).
//
// Moods, set with Nasrin.mood(name) or Nasrin.flash(name, ms):
//   idle       blinks, looks around, follows the pointer
//   typing     looks down at what you are writing
//   thinking   eyes scan while a reply is on its way
//   listening  wide eyes and a soft pulse while the mic is on
//   happy      eyes curve into smiles, a small hop
//   concerned  worried eyes, a little slump
//   sad        lower and sadder, for errors
//   sleepy     eyes close after a while with no activity
//   speaking   a gentle bounce while a reply is read aloud
//   surprised  eyes pop when you tap it
//
// Voice conversations (attach(el, { mouth: true })): the character also gets a
// small mouth that opens with the voice (Nasrin.talk(0..1)), and an expression
// that shows while it speaks (Nasrin.emotion('happy' | 'concerned' | 'sad' | 'surprised' | null)).
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  // Less motion: the device asks for it, or Settings > General > Reduce motion.
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => motionQuery.matches || document.documentElement.getAttribute('data-motion') === 'reduce';
  const instances = new Set();
  let serial = 0;
  let mood = 'idle';
  let emotion = null;
  let flashTimer = null;
  let baseMood = () => 'idle';

  function el(name, attrs, parent) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  // ---------- drawing ----------

  function build(withMouth = false) {
    const id = 'n' + (++serial);
    const svg = el('svg', { viewBox: '0 0 200 212', class: 'nasrin', 'aria-hidden': 'true', focusable: 'false' });
    svg.dataset.mood = mood;
    if (emotion) svg.dataset.emotion = emotion;

    const defs = el('defs', {}, svg);
    const ball = el('radialGradient', { id: id + '-ball', cx: '0.38', cy: '0.33', r: '0.8' }, defs);
    el('stop', { offset: '0', class: 'n-stop-hi' }, ball);
    el('stop', { offset: '0.56', class: 'n-stop-mid' }, ball);
    el('stop', { offset: '1', class: 'n-stop-lo' }, ball);
    const spec = el('radialGradient', { id: id + '-spec' }, defs);
    el('stop', { offset: '0', class: 'n-spec-in' }, spec);
    el('stop', { offset: '1', class: 'n-spec-out' }, spec);
    const shade = el('radialGradient', { id: id + '-shade' }, defs);
    el('stop', { offset: '0', class: 'n-shade-in' }, shade);
    el('stop', { offset: '1', class: 'n-shade-out' }, shade);

    el('ellipse', { class: 'n-shadow', cx: 100, cy: 197, rx: 60, ry: 8, fill: `url(#${id}-shade)` }, svg);
    el('circle', { class: 'n-ring', cx: 100, cy: 100, r: 82 }, svg);

    // n-hop: hops, squashes and nods. n-body: breathing. Separate so they combine.
    const hop = el('g', { class: 'n-hop' }, svg);
    const body = el('g', { class: 'n-body' }, hop);
    el('circle', { class: 'n-ball', cx: 100, cy: 100, r: 82, fill: `url(#${id}-ball)` }, body);
    el('ellipse', { class: 'n-spec', cx: 74, cy: 66, rx: 32, ry: 22, fill: `url(#${id}-spec)` }, body);

    const face = el('g', { class: 'n-face' }, body);
    for (const [side, cx] of [['l', 75], ['r', 125]]) {
      const eye = el('g', { class: 'n-eye n-eye-' + side }, face);
      const lid = el('g', { class: 'n-lid' }, eye);
      el('rect', { class: 'n-pill', x: cx - 8.5, y: 91, width: 17, height: 41, rx: 8.5 }, lid);
      el('path', { class: 'n-arc', d: `M${cx - 10} 118 Q${cx} 100 ${cx + 10} 118`, pathLength: 1 }, lid);
    }

    // The mouth lives inside the face, so it follows where the eyes look.
    // Only drawn when asked for (the voice screen); everywhere else the logo stays as designed.
    if (withMouth) {
      svg.classList.add('has-mouth');
      const mouth = el('g', { class: 'n-mouth' }, face);
      el('path', { class: 'n-m-line n-m-smile', d: 'M84 150 Q100 162 116 150' }, mouth);
      el('path', { class: 'n-m-line n-m-flat', d: 'M88 154 L112 154' }, mouth);
      el('path', { class: 'n-m-line n-m-frown', d: 'M86 159 Q100 147 114 159' }, mouth);
      el('ellipse', { class: 'n-m-open', cx: 100, cy: 154, rx: 13, ry: 12 }, mouth);
    }

    const zs = el('g', { class: 'n-zs' }, svg);
    [[150, 46], [164, 30], [176, 14]].forEach(([x, y], i) => {
      const z = el('text', { class: 'n-z n-z' + i, x, y }, zs);
      z.textContent = 'z';
    });
    return svg;
  }

  // ---------- where the eyes look ----------

  let gaze = { x: 0, y: 0 };
  function look(x, y) {
    gaze = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
    for (const inst of instances) {
      inst.svg.style.setProperty('--gx', gaze.x.toFixed(3));
      inst.svg.style.setProperty('--gy', gaze.y.toFixed(3));
    }
  }

  let lastPointer = 0;
  function trackPointer(e) {
    if (reduced() || (mood !== 'idle' && mood !== 'typing')) return;
    const target = [...instances].find((i) => i.tracks && i.svg.isConnected && i.svg.getBoundingClientRect().width > 40);
    if (!target) return;
    const r = target.svg.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height * 0.5);
    const reach = Math.max(260, r.width * 2.2);
    lastPointer = Date.now();
    if (mood === 'idle') look(dx / reach, dy / reach);
  }

  // ---------- life: blinking, glancing, sleeping ----------

  function blink(twice) {
    if (mood === 'sleepy' || mood === 'happy') return;
    for (const inst of instances) {
      inst.svg.classList.remove('is-blink');
      void inst.svg.getBoundingClientRect();          // restart the animation
      inst.svg.classList.add('is-blink');
    }
    setTimeout(() => {
      for (const inst of instances) inst.svg.classList.remove('is-blink');
      if (twice) setTimeout(() => blink(false), 90);
    }, 170);
  }

  (function blinkLoop() {
    setTimeout(() => { blink(Math.random() < 0.18); blinkLoop(); }, 2200 + Math.random() * 4300);
  })();

  (function glanceLoop() {
    setTimeout(() => {
      if (!reduced() && mood === 'idle' && Date.now() - lastPointer > 3000) {
        const centre = Math.random() < 0.35;
        look(centre ? 0 : Math.random() * 1.3 - 0.65, centre ? 0 : Math.random() * 0.8 - 0.45);
      }
      glanceLoop();
    }, 1800 + Math.random() * 3200);
  })();

  const SLEEP_AFTER = 45_000;
  let lastActive = Date.now();
  function activity() {
    lastActive = Date.now();
    if (mood === 'sleepy') { setMood(baseMood()); look(0, 0); blink(true); }
  }
  setInterval(() => {
    if (mood === 'idle' && Date.now() - lastActive > SLEEP_AFTER) setMood('sleepy');
  }, 2000);
  for (const type of ['pointerdown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(type, activity, { passive: true });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') { activity(); trackPointer(e); }
  }, { passive: true });

  // ---------- moods ----------

  function setMood(next) {
    mood = next;
    if (next === 'typing') look(0, 0.85);
    else if (next !== 'idle') look(0, 0);
    for (const inst of instances) inst.svg.dataset.mood = next;
  }

  const Nasrin = {
    // Puts a character into `container`. `tracks`: follows the pointer.
    attach(container, { tracks = false, mouth = false } = {}) {
      const svg = build(mouth);
      const inst = { svg, tracks, mouth };
      instances.add(inst);
      svg.style.setProperty('--gx', gaze.x);
      svg.style.setProperty('--gy', gaze.y);
      container.appendChild(svg);
      return {
        svg,
        remove() { instances.delete(inst); svg.remove(); }
      };
    },

    // A lasting mood (until the next call).
    mood(next) {
      clearTimeout(flashTimer);
      lastActive = Date.now();
      setMood(next);
    },

    // A mood for `ms`, then back to whatever the page says the base mood is.
    flash(next, ms) {
      clearTimeout(flashTimer);
      lastActive = Date.now();
      setMood(next);
      flashTimer = setTimeout(() => setMood(baseMood()), ms);
    },

    // The page tells the character what to return to after a flash.
    setBase(fn) { baseMood = fn; },

    // How wide the mouth is open, 0 to 1 (follows the voice). Only characters with a mouth show it.
    talk(level) {
      const v = Math.max(0, Math.min(1, Number(level) || 0)).toFixed(3);
      for (const inst of instances) if (inst.mouth) inst.svg.style.setProperty('--mouth', v);
    },

    // The expression shown while speaking: happy, concerned, sad, surprised, or none.
    emotion(next) {
      emotion = next || null;
      for (const inst of instances) {
        if (emotion) inst.svg.dataset.emotion = emotion; else delete inst.svg.dataset.emotion;
      }
    },

    // A small nod on every keystroke.
    tick() {
      for (const inst of instances) {
        inst.svg.classList.remove('is-tick');
        void inst.svg.getBoundingClientRect();
        inst.svg.classList.add('is-tick');
      }
    },

    blink,
    get current() { return mood; }
  };

  // A rough sense of how a message feels: 'positive', 'negative' or 'neutral'.
  // English, Filipino and Bisaya. Only shapes the character's face.
  const POSITIVE = /\b(thanks?|thank you|ty|salamat|great|awesome|amazing|love|nice|perfect|happy|glad|excited|yay|cool|wow|galing|ganda|astig|lami|nindot|congrats|congratulations)\b/i;
  const NEGATIVE = /\b(sad|angry|upset|hate|sorry|problem|broken|worried|worry|stress(ed)?|anxious|tired|sick|died|dead|lost|scared|afraid|hurt|pain|cry|crying|lonely|malungkot|lungkot|galit|problema|pagod|sakit|nawala|takot|kapoy|guol|masakit)\b/i;
  Nasrin.tone = (text) => {
    const s = String(text || '');
    const neg = NEGATIVE.test(s);
    const pos = POSITIVE.test(s);
    return neg && !pos ? 'negative' : pos && !neg ? 'positive' : 'neutral';
  };

  window.Nasrin = Nasrin;
})();
