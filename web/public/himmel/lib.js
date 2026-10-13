// Shared helpers: formatting, API access, the sky colours and small drawing routines.

export const DAY = 24 * 3600 * 1000;
export const HOUR = 3600 * 1000;
export const $ = (id) => document.getElementById(id);
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const nf = (digits) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false });
export const n0 = nf(0), n1 = nf(1);
export const num = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '–' : nf(digits).format(Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v).replace('-', '−'));
export const clock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
export const weekday = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });
export const weekdayShort = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
export const dateLong = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
export const dateShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
export const dayMonth = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
export const monthName = new Intl.DateTimeFormat('de-DE', { month: 'short' });

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// ---------- API ----------

export async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `${r.status}`), { status: r.status });
  return j;
}

export async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `${r.status}`), { status: r.status, body: j });
  return j;
}

// What the "Jetzt" view has loaded, shared with the other views.
export const store = { cfg: null, cur: null };
export const stationReady = () => new Promise((resolve) => {
  if (store.cur) return resolve(store.cur);
  window.addEventListener('station', () => resolve(store.cur), { once: true });
});

// ---------- Metrics ----------

export const METRICS = {
  temp: { label: 'Temperatur', unit: '°C', digits: 1 },
  hum: { label: 'Luftfeuchte', unit: '%', digits: 0 },
  wind: { label: 'Wind', unit: 'km/h', digits: 1 },
  rain: { label: 'Regen', unit: 'mm', digits: 1, bars: true },
  press: { label: 'Luftdruck', unit: 'hPa', digits: 1 },
  solar: { label: 'Sonne', unit: 'W/m²', digits: 0 },
  uv: { label: 'UV-Index', unit: '', digits: 0 },
  light: { label: 'Blitze', unit: 'Einschläge', digits: 0, bars: true },
};

// ---------- Units: chosen by each visitor, kept in their browser ----------

export const UNIT_OPTIONS = {
  temp: { label: 'Temperatur', options: ['°C', '°F'] },
  wind: { label: 'Wind', options: ['km/h', 'm/s', 'mph', 'Bft'] },
  press: { label: 'Luftdruck', options: ['hPa', 'mmHg', 'inHg'] },
  rain: { label: 'Regen', options: ['mm', 'l/m²', 'in'] },
};
const UNITS_KEY = 'himmel-units';
export const units = { temp: '°C', wind: 'km/h', press: 'hPa', rain: 'mm' };
try { Object.assign(units, JSON.parse(localStorage.getItem(UNITS_KEY) || '{}')); } catch { /* private mode */ }
export function setUnit(kind, value) {
  units[kind] = value;
  try { localStorage.setItem(UNITS_KEY, JSON.stringify(units)); } catch { /* private mode */ }
  window.dispatchEvent(new Event('units'));
}

const BFT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
const beaufort = (kmh) => { const i = BFT.findIndex((x) => kmh < x); return i === -1 ? 12 : i; };

// How a stored value (always °C, km/h, hPa, mm) is shown: { f: convert, unit, digits }.
export function conv(kind) {
  switch (kind) {
    case 'temp': return units.temp === '°F' ? { f: (v) => v * 9 / 5 + 32, unit: '°F', digits: 1 } : { f: (v) => v, unit: '°C', digits: 1 };
    case 'wind':
      if (units.wind === 'm/s') return { f: (v) => v / 3.6, unit: 'm/s', digits: 1 };
      if (units.wind === 'mph') return { f: (v) => v / 1.609344, unit: 'mph', digits: 1 };
      if (units.wind === 'Bft') return { f: beaufort, unit: 'Bft', digits: 0 };
      return { f: (v) => v, unit: 'km/h', digits: 1 };
    case 'press':
      if (units.press === 'mmHg') return { f: (v) => v * 0.750062, unit: 'mmHg', digits: 1 };
      if (units.press === 'inHg') return { f: (v) => v * 0.0295300, unit: 'inHg', digits: 2 };
      return { f: (v) => v, unit: 'hPa', digits: 1 };
    case 'rain':
      if (units.rain === 'in') return { f: (v) => v / 25.4, unit: 'in', digits: 2 };
      return { f: (v) => v, unit: units.rain === 'l/m²' ? 'l/m²' : 'mm', digits: 1 };
    default: return { f: (v) => v, unit: '', digits: 1 };
  }
}

// A stored value in the visitor's unit, as text. `digits` overrides the unit's own precision.
export function show(kind, v, digits) {
  const c = conv(kind);
  return v == null ? '–' : num(c.f(v), digits ?? c.digits);
}
// Temperatures are written "14,3°"; only Fahrenheit names its scale.
export const degree = () => (units.temp === '°F' ? '°F' : '°');
export const temp = (v, digits = 1) => `${show('temp', v, digits)}${degree()}`;

const METRIC_KIND = { temp: 'temp', wind: 'wind', rain: 'rain', press: 'press' };
export function metricConv(metric) {
  const M = METRICS[metric], kind = METRIC_KIND[metric];
  if (!kind) return { f: (v) => v, unit: M.unit, digits: M.digits };
  const c = conv(kind);
  return { ...c, unit: kind === 'temp' ? degree() : c.unit };
}

export const CONDITION = {
  sunny: 'Sonnig', 'clear-night': 'Klar', partlycloudy: 'Heiter', cloudy: 'Bewölkt', fog: 'Nebel', rainy: 'Regen', pouring: 'Starkregen',
  'lightning-rainy': 'Gewitter', lightning: 'Gewitter', snowy: 'Schnee', 'snowy-rainy': 'Schneeregen', hail: 'Hagel', windy: 'Windig', exceptional: 'Unwetter',
};

const COMPASS = ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'];
export const fromWord = (deg) => COMPASS[Math.round(deg / 45) % 8];

// ---------- Sun and sky ----------

// Sun height from -1 (deepest night) through 0 (horizon) to 1 (solar noon), from one day's sunrise and sunset.
export function sunHeight(t, astro) {
  if (!astro?.sunrise || !astro?.sunset) return 0.6;
  const sr = astro.sunrise, ss = astro.sunset;
  const tt = sr + ((((t - sr) % DAY) + DAY) % DAY);
  if (tt < ss) return Math.sin(Math.PI * (tt - sr) / (ss - sr));
  return -Math.sin(Math.PI * (tt - ss) / (sr + DAY - ss));
}

export const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const rgb = (c, alpha = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;

// Sky colours by sun height: [height, zenith, horizon, ground]
const SKY = [
  [-0.30, '#060a1b', '#141d3c', '#070c10'],
  [-0.10, '#11183a', '#4b3a68', '#0a1114'],
  [0.00, '#2c3f7a', '#f0a179', '#0e1a18'],
  [0.14, '#3a6aa6', '#f3d3a8', '#11231d'],
  [0.40, '#2a66ae', '#bfe0f2', '#12261f'],
].map(([h, z, o, g]) => [h, hex(z), hex(o), hex(g)]);

const CLOUD_COVER = { sunny: 0, 'clear-night': 0, partlycloudy: 0.25, cloudy: 0.6, fog: 0.7, rainy: 0.7, pouring: 0.8, 'lightning-rainy': 0.75, lightning: 0.7, snowy: 0.7, 'snowy-rainy': 0.7, hail: 0.8 };

export function skyAt(t, astro, conditionCode) {
  const h = sunHeight(t, astro);
  let i = 0;
  while (i < SKY.length - 2 && h > SKY[i + 1][0]) i++;
  const [h0, z0, o0, g0] = SKY[i], [h1, z1, o1, g1] = SKY[i + 1];
  const f = clamp((h - h0) / (h1 - h0), 0, 1);
  let zenith = mix(z0, z1, f), horizon = mix(o0, o1, f);
  const ground = mix(g0, g1, f);
  // Overcast days lose colour: pull both towards a grey of the same brightness.
  const cover = (CLOUD_COVER[conditionCode] ?? 0.2) * 0.55;
  const grey = (c) => { const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]; return [l * 0.92, l * 0.97, l * 1.04]; };
  zenith = mix(zenith, grey(zenith), cover);
  horizon = mix(horizon, grey(horizon), cover);
  return { h, zenith, horizon, ground, night: clamp((-h - 0.02) / 0.2, 0, 1) };
}

export function applyTheme(sky) {
  document.documentElement.style.setProperty('--zenith', rgb(sky.zenith));
  document.documentElement.style.setProperty('--ground', rgb(sky.ground));
}

// ---------- Canvas ----------

export const canvasFont = (px, weight = 500) => `${weight} ${px}px "Bricolage Grotesque", system-ui, sans-serif`;

// Sizes a canvas to its CSS box and returns a context scaled to CSS pixels.
export function fitCanvas(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W: r.width, H: r.height };
}

// A small weather glyph, about 2·s wide, centred on (x, y).
export function drawCondition(ctx, code, x, y, s = 9) {
  const cloud = (cx, cy, k, fill) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(cx - k * 0.55, cy + k * 0.15, k * 0.5, 0, 6.283);
    ctx.arc(cx, cy - k * 0.2, k * 0.62, 0, 6.283);
    ctx.arc(cx + k * 0.6, cy + k * 0.15, k * 0.45, 0, 6.283);
    ctx.rect(cx - k * 0.55, cy + k * 0.1, k * 1.15, k * 0.55);
    ctx.fill();
  };
  const sun = (cx, cy, r) => { ctx.fillStyle = '#ffcf5c'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.283); ctx.fill(); };
  const drops = (colour) => {
    ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    for (const dx of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.moveTo(x + dx * s + 1.5, y + s * 0.85); ctx.lineTo(x + dx * s - 1, y + s * 1.45); ctx.stroke(); }
  };
  const white = 'rgba(243,246,242,0.92)';
  switch (code) {
    case 'sunny': sun(x, y, s * 0.72); break;
    case 'clear-night':
      ctx.fillStyle = '#e8ecff'; ctx.beginPath(); ctx.arc(x, y, s * 0.68, 0.6, 5.2); ctx.arc(x + s * 0.32, y - s * 0.12, s * 0.5, 4.6, 1.2, true); ctx.fill(); break;
    case 'partlycloudy': sun(x + s * 0.4, y - s * 0.4, s * 0.5); cloud(x - s * 0.1, y + s * 0.15, s * 0.85, white); break;
    case 'cloudy': cloud(x, y, s, white); break;
    case 'fog':
      ctx.strokeStyle = white; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (const dy of [-0.5, 0, 0.5]) { ctx.beginPath(); ctx.moveTo(x - s * 0.8, y + dy * s); ctx.lineTo(x + s * 0.8, y + dy * s); ctx.stroke(); } break;
    case 'rainy': case 'pouring': case 'snowy-rainy': cloud(x, y - s * 0.2, s * 0.9, white); drops('#9fd0ff'); break;
    case 'snowy': case 'hail': cloud(x, y - s * 0.2, s * 0.9, white); drops('#ffffff'); break;
    case 'lightning': case 'lightning-rainy': case 'exceptional':
      cloud(x, y - s * 0.25, s * 0.9, white);
      ctx.fillStyle = '#ffd84d'; ctx.beginPath();
      ctx.moveTo(x + s * 0.2, y + s * 0.35); ctx.lineTo(x - s * 0.4, y + s * 1.05); ctx.lineTo(x, y + s * 1.05); ctx.lineTo(x - s * 0.2, y + s * 1.7); ctx.lineTo(x + s * 0.5, y + s * 0.85); ctx.lineTo(x + s * 0.1, y + s * 0.85);
      ctx.closePath(); ctx.fill(); break;
    default: cloud(x, y, s, white);
  }
}

// ---------- DOM ----------

// el('p.sub', { hidden: true }, 'text', childNode) → element
export function el(spec, props = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node && k !== 'list') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}
