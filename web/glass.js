// Liquid Glass: the lens and the springs behind the glass surfaces in styles.css.
//
// Lens: every glass surface gets an SVG filter whose displacement map pushes the backdrop
// outwards near the rim, the way a thick, rounded piece of glass bends what lies behind it.
// The map is drawn on a canvas for the surface's size and corner radius (cached per size) and
// handed to the filter as a data: image, which the CSP allows. Only Chromium renders SVG filters
// in backdrop-filter; elsewhere the glass stays clear and blurred, without the lens.
//
// Springs: a pressed control swells, leans towards the finger and bounces back on release;
// the nav mark slides between items on a spring and stretches with its speed.
//
// All of it only for the Liquid Glass design. The original Himmel design keeps its plain CSS.
// Changing the design reloads the page (like changing the language), so GLASS never changes.

const DESIGN_KEY = 'wetterstation.design';
export const DESIGNS = ['glass', 'himmel'];
export const DESIGN = document.documentElement.dataset.design === 'himmel' ? 'himmel' : 'glass';
const GLASS = DESIGN === 'glass';

export function setDesign(design) {
  try { localStorage.setItem(DESIGN_KEY, design); } catch { /* storage off: nothing to remember */ }
  location.reload();
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const reduceTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
const chromium = !!navigator.userAgentData?.brands?.some((b) => b.brand === 'Chromium');

// ---------- Springs ----------

const active = new Set();
let frame = 0, last = 0;

function tick(now) {
  const dt = Math.min((now - (last || now)) / 1000, 1 / 30);
  last = now;
  for (const s of active) {
    // Semi-implicit Euler in a few small steps keeps stiff springs stable.
    for (let i = 0; i < 4; i++) {
      const h = dt / 4;
      s.v += (-s.k * (s.x - s.target) - s.c * s.v) * h;
      s.x += s.v * h;
    }
    if (Math.abs(s.x - s.target) < s.rest && Math.abs(s.v) < s.rest * 10) { s.x = s.target; s.v = 0; active.delete(s); }
    s.apply();
  }
  frame = active.size ? requestAnimationFrame(tick) : 0;
  if (!frame) last = 0;
}

class Spring {
  constructor(x, apply, rest = 0.001) { this.x = x; this.v = 0; this.target = x; this.k = 300; this.c = 20; this.rest = rest; this.apply = apply; }
  to(target, k = this.k, c = this.c) {
    this.target = target; this.k = k; this.c = c;
    if (reduceMotion.matches) { this.x = target; this.v = 0; this.apply(); return; }
    active.add(this);
    if (!frame) frame = requestAnimationFrame(tick);
  }
  set(x) { this.x = x; this.target = x; this.v = 0; active.delete(this); this.apply(); }
}

// Scale and lean of one element, written to the individual `scale` and `translate` properties
// so they never fight a transform set elsewhere.
const motion = new WeakMap();
function motionOf(el) {
  let m = motion.get(el);
  if (!m) {
    const apply = () => {
      el.style.scale = `${(m.s.x * m.sx.x).toFixed(4)} ${(m.s.x / Math.sqrt(m.sx.x)).toFixed(4)}`;
      el.style.translate = `${m.dx.x.toFixed(2)}px ${m.dy.x.toFixed(2)}px`;
    };
    m = { s: new Spring(1, apply), sx: new Spring(1, apply), dx: new Spring(0, apply, 0.01), dy: new Spring(0, apply, 0.01) };
    motion.set(el, m);
  }
  return m;
}

// ---------- Pressing ----------

// What can be pressed, and which glass moves when it is: a nav item moves the whole pill,
// a zoom button the zoom control; everything else moves itself.
const PRESSABLE = '.btn:not(.quiet), .back, .tab, .nav a, .map-zoom button';
const mover = (el) => el.closest('.nav, .map-zoom') ?? el;
const swell = (el) => (el.matches('.nav, .map-zoom') ? 1.04 : el.offsetWidth > 160 ? 1.05 : 1.1);

let pressed = null;   // { el, glass, x0, y0 }

function glowAt(el, e) {
  const r = el.getBoundingClientRect();
  el.style.setProperty('--gx', `${e.clientX - r.left}px`);
  el.style.setProperty('--gy', `${e.clientY - r.top}px`);
}

function press(e) {
  const el = e.target.closest?.(PRESSABLE);
  if (!el || el.disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
  release();
  const glass = mover(el);
  pressed = { el, glass, x0: e.clientX, y0: e.clientY };
  el.setAttribute('data-pressed', '');
  glowAt(el, e);
  motionOf(glass).s.to(swell(glass), 520, 26);
}

// While held, the glass leans after the finger and stretches a little the way it is pulled,
// with resistance that grows the further it goes.
function drag(e) {
  if (!pressed) return;
  glowAt(pressed.el, e);
  const m = motionOf(pressed.glass);
  const dx = e.clientX - pressed.x0, dy = e.clientY - pressed.y0;
  const give = (d, max) => max * Math.tanh(d / (max * 6));
  m.dx.to(give(dx, 7), 600, 34);
  m.dy.to(give(dy, 5), 600, 34);
  m.sx.to(1 + Math.min(Math.abs(dx) / Math.max(pressed.glass.offsetWidth, 1), 1) * 0.12 - Math.min(Math.abs(dy) / 120, 1) * 0.04, 600, 34);
}

// Let go: back to rest on a loose spring, so it overshoots and settles.
function release() {
  if (!pressed) return;
  pressed.el.removeAttribute('data-pressed');
  const m = motionOf(pressed.glass);
  m.s.to(1, 380, 13);
  m.sx.to(1, 380, 13);
  m.dx.to(0, 300, 14);
  m.dy.to(0, 300, 14);
  pressed = null;
}

if (GLASS) {
  document.addEventListener('pointerdown', press);
  document.addEventListener('pointermove', drag, { passive: true });
  for (const type of ['pointerup', 'pointercancel', 'dragstart']) document.addEventListener(type, release);
  window.addEventListener('blur', release);
}

// ---------- The nav mark ----------

const markState = new WeakMap();

// Slides the mark to (x, width). Moving, it stretches along its path with its speed and lifts
// off as a brighter lens; it lands with a small overshoot.
export function slideMark(mark, x, width, animate) {
  if (!GLASS) {   // Himmel: the mark glides on its CSS transition
    mark.style.transition = animate ? '' : 'none';
    mark.style.width = `${width}px`;
    mark.style.transform = `translateX(${x}px)`;
    return;
  }
  let st = markState.get(mark);
  if (!st) {
    const apply = () => {
      const speed = Math.abs(st.x.v);
      const stretch = Math.min(speed / 2600, 0.3);
      mark.style.width = `${st.w.x}px`;
      mark.style.transform = `translateX(${st.x.x}px) scale(${1 + stretch}, ${1 - stretch * 0.35 + (st.lift ? 0.06 : 0)})`;
      const lifted = speed > 40 || Math.abs(st.w.v) > 60;
      if (lifted !== st.lift) { st.lift = lifted; mark.toggleAttribute('data-lifted', lifted); }
    };
    st = { x: new Spring(x, apply, 0.05), w: new Spring(width, apply, 0.05), lift: false };
    markState.set(mark, st);
  }
  if (animate) { st.x.to(x, 260, 20); st.w.to(width, 260, 22); }
  else { st.x.set(x); st.w.set(width); }
}

// ---------- The lens ----------

const SURFACES = '.station, .status, .nav, .tabs, .btn:not(.quiet):not(.primary), .back, .map-zoom, .save-bar, .card';
const maps = new Map();     // "w×h×r" → filter id
let svg = null, serial = 0;

// Displacement map for a rounded rectangle: within `bezel` px of the rim each pixel points
// inwards along the rim's normal, strongest right at the edge (a convex lip), neutral inside.
// Red carries x, green y; 128 means no shift.
function drawMap(w, h, r, bezel) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h), d = img.data;
  const hw = w / 2, hh = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw, py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const dist = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;   // < 0 inside
      let nx = 0, ny = 0, mag = 0;
      const t = -dist;
      if (t >= 0 && t < bezel) {
        if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l; }
        else if (qx > qy) nx = 1; else ny = 1;
        nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
        const s = 1 - t / bezel;
        mag = s * s * (3 - 2 * s);   // smooth lip, steepest at the rim
      }
      const i = (y * w + x) * 4;
      d[i] = 128 - nx * mag * 127;
      d[i + 1] = 128 - ny * mag * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function filterFor(w, h, r, big) {
  const key = `${w}x${h}x${r}`;
  let id = maps.get(key);
  if (id) return id;
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    document.body.append(svg);
  }
  id = `lg-lens-${++serial}`;
  const bezel = Math.min(big ? 24 : 16, h / 2, w / 2);
  const ns = 'http://www.w3.org/2000/svg';
  const f = document.createElementNS(ns, 'filter');
  for (const [k, v] of Object.entries({ id, x: 0, y: 0, width: w, height: h, filterUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v);
  const fi = document.createElementNS(ns, 'feImage');
  for (const [k, v] of Object.entries({ href: drawMap(w, h, r, bezel), x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' })) fi.setAttribute(k, v);
  const fd = document.createElementNS(ns, 'feDisplacementMap');
  for (const [k, v] of Object.entries({ in: 'SourceGraphic', in2: 'map', scale: big ? 34 : 24, xChannelSelector: 'R', yChannelSelector: 'G' })) fd.setAttribute(k, v);
  f.append(fi, fd);
  svg.append(f);
  maps.set(key, id);
  return id;
}

function fit(el) {
  const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
  if (!w || !h || w * h > 1_500_000) { el.style.removeProperty('--lg-filter'); return; }
  const r = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);
  el.style.setProperty('--lg-filter', `url(#${filterFor(w, h, Math.round(r), el.matches('.card, .save-bar'))})`);
}

function startLens() {
  const resized = new ResizeObserver((entries) => { for (const e of entries) fit(e.target); });
  const seen = new WeakSet();
  const scan = () => {
    for (const el of document.querySelectorAll(SURFACES)) {
      if (seen.has(el)) continue;
      seen.add(el);
      resized.observe(el);
    }
  };
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  }).observe(document.body, { childList: true, subtree: true });
  scan();
}

if (GLASS && chromium && !reduceTransparency.matches) startLens();
