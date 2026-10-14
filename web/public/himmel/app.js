// Himmel über der Station: the last 24 hours as one landscape.
// The ridge is the temperature curve, the sky follows the sun's position at the chosen time,
// and dragging across the scene moves through the day.

import {
  DAY, $, reducedMotion, n0, n1, clock, weekday, weekdayShort, clamp, lerp, getJson, store,
  sunHeight as sunHeightFor, skyAt as skyFor, hex, mix, rgb, applyTheme, CONDITION, fromWord,
  units, conv, show, degree, temp as tempText, scrub,
} from './lib.js';

// ---------- Data ----------

const state = {
  cfg: null,
  cur: null,
  hist: {},          // metric -> [{t, v, hi}]
  now: Date.now(),
};

async function loadCurrent() {
  try {
    state.cur = await getJson('/api/current');
    state.now = Date.now();
    store.cur = state.cur;
    window.dispatchEvent(new Event('station'));
    $('status').classList.remove('stale');
    $('statusText').textContent = `Live, ${clock.format(state.cur.updated)} Uhr`;
  } catch {
    $('status').classList.add('stale');
    $('statusText').textContent = 'Keine Verbindung zur Station';
  }
  renderStatic();
  renderReadout();
}

async function loadHistory() {
  const metrics = ['temp', 'hum', 'wind', 'rain', 'press', 'solar', 'light'];
  const results = await Promise.allSettled(metrics.map((m) => getJson(`/api/history?metric=${m}&range=day`)));
  results.forEach((r, i) => { if (r.status === 'fulfilled') state.hist[metrics[i]] = r.value.points; });
  terrainDirty = true;
  renderReadout();
}

// Value of a metric at time t, linearly interpolated between history points.
function at(metric, t) {
  const p = state.hist[metric];
  if (!p || !p.length) return null;
  if (t <= p[0].t) return p[0].v;
  if (t >= p[p.length - 1].t) return p[p.length - 1].v;
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].t <= t) lo = mid; else hi = mid; }
  const f = (t - p[lo].t) / (p[hi].t - p[lo].t);
  return lerp(p[lo].v, p[hi].v, f);
}

// The history bucket that contains time t (for counters such as rain and lightning).
function bucket(metric, t) {
  const p = state.hist[metric];
  if (!p || !p.length) return null;
  let best = p[0];
  for (const pt of p) { if (pt.t <= t) best = pt; else break; }
  return best;
}

// ---------- Sun and sky ----------

const sunHeight = (t) => sunHeightFor(t, state.cur?.astro);
const skyAt = (t) => skyFor(t, state.cur?.astro, state.cur?.forecast?.days?.[0]?.conditionCode);

// ---------- Scene geometry ----------

const canvas = $('scene');
const ctx = canvas.getContext('2d');
let W = 0, H = 0, dpr = 1;
let terrain = null;       // Float32Array of ridge heights per CSS pixel
let terrainDirty = true;
let extremes = null;

const geo = {
  get x0() { return 0; },
  get xNow() { return W * (W < 640 ? 0.86 : 0.9); },
  get horizon() { return H * 0.66; },
  get amp() { return H * 0.4; },
  get ridgeTop() { return H * 0.615; },
  get ridgeBottom() { return H * 0.86; },
};

const timeAtX = (x) => state.now - DAY + (x - geo.x0) / (geo.xNow - geo.x0) * DAY;
const xAtTime = (t) => geo.x0 + (t - (state.now - DAY)) / DAY * (geo.xNow - geo.x0);

function buildTerrain() {
  const p = state.hist.temp;
  terrain = new Float32Array(Math.ceil(W) + 2);
  if (!p || !p.length) { terrain.fill(geo.ridgeBottom); extremes = null; return; }
  let min = Infinity, max = -Infinity, minPt = p[0], maxPt = p[0];
  for (const pt of p) { if (pt.v < min) { min = pt.v; minPt = pt; } if (pt.v > max) { max = pt.v; maxPt = pt; } }
  const span = Math.max(max - min, 2);
  const yOf = (v) => lerp(geo.ridgeBottom, geo.ridgeTop, (v - min) / span);
  const xNow = geo.xNow;
  for (let x = 0; x < terrain.length; x++) {
    terrain[x] = x <= xNow ? yOf(at('temp', timeAtX(x))) : yOf(p[p.length - 1].v);
  }
  extremes = { min: minPt, max: maxPt };
  terrainDirty = false;
}

const ridgeY = (x) => {
  if (!terrain) return geo.ridgeBottom;
  const i = clamp(x, 0, terrain.length - 2);
  const a = Math.floor(i);
  return lerp(terrain[a], terrain[a + 1], i - a);
};

function resize() {
  const r = canvas.getBoundingClientRect();
  const wasLive = cursor.live, frac = W ? cursor.x / geo.xNow : 1;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = r.width; H = r.height;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  cursor.x = cursor.target = wasLive ? geo.xNow : frac * geo.xNow;
  cursor.v = 0;
  terrainDirty = true;
  seedParticles();
}

// ---------- The time cursor: drag 1:1, throw with momentum, spring to rest ----------

const cursor = { x: 0, target: 0, v: 0, live: true, dragging: false, springing: false, damping: 1, response: 0.4 };
let grabOffset = 0, catching = false;
const trail = [];   // recent pointer positions for release velocity

// Progressive resistance past either end instead of a hard stop.
function rubber(x) {
  const min = geo.x0 + 2, max = geo.xNow;
  const band = (over) => (over * 120 * 0.55) / (120 + 0.55 * Math.abs(over));
  if (x < min) return min + band(x - min);
  if (x > max) return max + band(x - max);
  return x;
}

// Where a flick would come to rest (exponential decay, as scroll deceleration does).
const project = (v, rate = 0.99) => (v / 1000) * rate / (1 - rate);

function springTo(target, { velocity = cursor.v, damping = 1, response = 0.4 } = {}) {
  cursor.target = target;
  if (reducedMotion.matches) { cursor.x = target; cursor.v = 0; cursor.springing = false; settle(); return; }
  cursor.v = velocity; cursor.damping = damping; cursor.response = response; cursor.springing = true;
}

function settle() {
  cursor.live = Math.abs(cursor.x - geo.xNow) < 0.75;
  if (cursor.live) cursor.x = cursor.target = geo.xNow;
  renderReadout();
}

function stepSpring(dt) {
  const k = (2 * Math.PI / cursor.response) ** 2;
  const c = 4 * Math.PI * cursor.damping / cursor.response;
  // Small fixed sub-steps keep the integration stable on long frames.
  for (let left = dt; left > 0; left -= 1 / 240) {
    const h = Math.min(left, 1 / 240);
    cursor.v += (-k * (cursor.x - cursor.target) - c * cursor.v) * h;
    cursor.x += cursor.v * h;
  }
  if (Math.abs(cursor.x - cursor.target) < 0.3 && Math.abs(cursor.v) < 4) {
    cursor.x = cursor.target; cursor.v = 0; cursor.springing = false;
    if (!cursor.dragging) settle();
  }
}

function grab(e) {
  const x = e.clientX - canvas.getBoundingClientRect().left;
  cursor.dragging = true; cursor.live = false;
  trail.length = 0; trail.push({ x, t: e.timeStamp });
  if (Math.abs(x - cursor.x) < 28) {
    // Grabbed the cursor itself: keep the distance between finger and cursor.
    grabOffset = cursor.x - x; catching = false; cursor.springing = false; cursor.v = 0;
  } else {
    // Pressed somewhere else: the cursor comes to the finger, then stays glued to it.
    grabOffset = 0; catching = true;
    springTo(clamp(x, geo.x0 + 2, geo.xNow), { velocity: cursor.v, damping: 1, response: 0.22 });
  }
  $('hint').classList.add('gone');
  renderReadout();
}

function drag(e) {
  if (!cursor.dragging) return;
  const x = e.clientX - canvas.getBoundingClientRect().left;
  trail.push({ x, t: e.timeStamp });
  while (trail.length > 2 && e.timeStamp - trail[0].t > 90) trail.shift();
  const want = rubber(x + grabOffset);
  if (catching && !reducedMotion.matches) {
    cursor.target = want;
    if (Math.abs(cursor.x - want) < 3) { catching = false; cursor.springing = false; }
  } else {
    cursor.x = cursor.target = want;
  }
  renderReadout();
}

function release(e) {
  if (!cursor.dragging) return;
  // Still on its way to the finger (a tap, a short press): it goes where the finger was.
  const from = catching ? cursor.target : cursor.x;
  cursor.dragging = false; catching = false;
  let v = 0;
  if (e.type === 'pointerup' && trail.length > 1) {
    const a = trail[0], b = trail[trail.length - 1];
    if (b.t > a.t && e.timeStamp - b.t < 60) v = (b.x - a.x) / (b.t - a.t) * 1000;
  }
  let target = clamp(from + project(v), geo.x0 + 2, geo.xNow);
  // The present is a magnet: a throw that lands near it goes all the way.
  if (geo.xNow - target < 36) target = geo.xNow;
  springTo(target, { velocity: v, damping: Math.abs(v) > 250 ? 0.82 : 1, response: 0.36 });
}
scrub(canvas, { begin: grab, move: drag, end: release });

canvas.addEventListener('keydown', (e) => {
  const step = (geo.xNow - geo.x0) / 144;   // ten minutes
  const moves = { ArrowLeft: -step, ArrowRight: step, PageDown: -step * 6, PageUp: step * 6 };
  let target;
  if (e.key in moves) target = cursor.target + moves[e.key];
  else if (e.key === 'Home') target = geo.x0 + 2;
  else if (e.key === 'End' || e.key === 'Escape') target = geo.xNow;
  else return;
  e.preventDefault();
  cursor.live = false;
  $('hint').classList.add('gone');
  springTo(clamp(target, geo.x0 + 2, geo.xNow), { damping: 1, response: 0.25 });
});

$('backToNow').addEventListener('click', () => {
  springTo(geo.xNow, { damping: 1, response: 0.45 });
  canvas.focus({ preventScroll: true });
});

// ---------- Readout (DOM) ----------

const BEAUFORT = [[2, 'Windstill'], [12, 'Leichte Brise'], [29, 'Mäßiger Wind'], [50, 'Frischer Wind'], [75, 'Stürmischer Wind'], [Infinity, 'Sturm']];
const windWord = (kmh) => BEAUFORT.find(([max]) => kmh < max)[1];
const UV_WORD = (uv) => (uv < 3 ? 'niedrig' : uv < 6 ? 'mittel' : uv < 8 ? 'hoch' : uv < 11 ? 'sehr hoch' : 'extrem');

function setInst(id, value, sub, unit) {
  const el = $(id);
  el.querySelector('[data-v]').textContent = value;
  el.querySelector('[data-s]').textContent = sub;
  if (unit !== undefined) el.querySelector('[data-u]').textContent = unit;
}

function ago(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `vor ${h} Std. ${m} Min.` : `vor ${h} Std.`;
}

let lastReadoutKey = '';

function renderReadout() {
  const cur = state.cur;
  if (!cur) return;
  const live = cursor.live && !cursor.dragging;
  const t = live ? state.now : clamp(timeAtX(cursor.x), state.now - DAY, state.now);
  const key = `${live}|${Math.round(t / 60000)}|${cur.updated}|${Object.keys(state.hist).length}|${JSON.stringify(units)}`;
  if (key === lastReadoutKey) return;
  lastReadoutKey = key;

  const v = cur.values;
  const temp = live ? v.temperature : at('temp', t);
  const wind = live ? v.wind_speed : at('wind', t);
  const hum = live ? v.humidity : at('hum', t);
  const press = live ? v.pressure : at('press', t);
  const solar = live ? v.solar_radiation : at('solar', t);

  // When
  if (live) {
    $('whenMain').textContent = 'Jetzt';
    $('whenSub').textContent = `${clock.format(state.now)} Uhr`;
  } else {
    const sameDay = new Date(t).getDate() === new Date(state.now).getDate();
    $('whenMain').textContent = `${sameDay ? 'Heute' : 'Gestern'}, ${clock.format(t)} Uhr`;
    $('whenSub').textContent = ago(state.now - t);
  }
  $('backToNow').hidden = live;
  $('alert').classList.toggle('past', !live);   // the alert is about now, not about the moment being looked at

  // Temperature
  if (temp == null) { $('tempInt').textContent = '–'; $('tempFrac').textContent = ''; }
  else {
    const [int, frac] = show('temp', temp).split(',');
    document.querySelector('.temp-unit').textContent = degree();
    $('tempInt').textContent = int;
    $('tempFrac').textContent = `,${frac}`;
  }

  // One sentence for the moment
  const dry = live ? v.rain_rate <= 0 : (bucket('rain', t)?.v ?? 0) <= 0;
  const parts = [];
  if (wind != null) parts.push(live && v.wind_direction != null ? `${windWord(wind)} aus ${fromWord(v.wind_direction)}` : windWord(wind));
  parts.push(dry ? 'trocken' : 'Regen');
  $('sentence').textContent = live
    ? `Fühlt sich an wie ${tempText(v.feels_like)}. ${parts.join(', ')}.`
    : `${parts.join(', ')}, ${n0.format(hum ?? 0)} % Luftfeuchte.`;

  // Instruments
  const gust = live ? v.wind_gust : bucket('wind', t)?.hi;
  const windUnit = conv('wind').unit, rainUnit = conv('rain').unit, pressUnit = conv('press').unit;
  setInst('inst-wind', show('wind', wind),
    live ? `Böen bis ${show('wind', gust, 0)} ${windUnit}, aus ${fromWord(v.wind_direction)}` : `Böen bis ${show('wind', gust ?? wind, 0)} ${windUnit}`);
  $('inst-wind').querySelector('.unit').textContent = windUnit;
  $('inst-rain').querySelector('.unit').textContent = rainUnit;
  $('inst-press').querySelector('.unit').textContent = pressUnit;
  if (v.wind_direction != null) $('needle').style.transform = `rotate(${(v.wind_direction + 180) % 360}deg)`;

  if (live) setInst('inst-rain', show('rain', cur.rain.day), `heute. Diese Woche ${show('rain', cur.rain.week)} ${rainUnit}, im Monat ${show('rain', cur.rain.month)} ${rainUnit}`);
  else setInst('inst-rain', show('rain', bucket('rain', t)?.v ?? 0), 'in dieser halben Stunde');

  const before = at('press', t - 3 * 3600 * 1000);
  const trend = live ? cur.pressureTrend : (press != null && before != null ? press - before : 0);
  const trendWord = Math.abs(trend) < 0.3 ? 'gleichbleibend' : trend > 0 ? `steigt, +${show('press', trend)} ${pressUnit} in 3 Std.` : `fällt, ${show('press', trend)} ${pressUnit} in 3 Std.`;
  setInst('inst-press', show('press', press), trendWord);

  setInst('inst-hum', hum == null ? '–' : n0.format(hum),
    live ? `Taupunkt ${tempText(v.dew_point)}` : `heute zwischen ${n0.format(cur.today.hum.min)} und ${n0.format(cur.today.hum.max)} %`);

  setInst('inst-sun', solar == null ? '–' : n0.format(solar),
    live ? `UV ${n0.format(v.uv_index)}, ${UV_WORD(v.uv_index)}. Untergang ${clock.format(cur.astro.sunset)} Uhr`
      : `Aufgang ${clock.format(cur.astro.sunrise)}, Untergang ${clock.format(cur.astro.sunset)} Uhr`);

  if (live) {
    const recent = v.lightning_time && state.now - v.lightning_time < 3600 * 1000 * 3;
    setInst('inst-light', recent ? n0.format(v.lightning_distance) : n0.format(v.lightning_count),
      recent ? `entfernt, zuletzt ${clock.format(v.lightning_time)} Uhr. ${n0.format(v.lightning_count)} Einschläge heute` : 'Einschläge heute',
      recent ? 'km' : '');
  } else {
    setInst('inst-light', n0.format(bucket('light', t)?.v ?? 0), 'Einschläge in dieser Stunde', '');
  }

  canvas.setAttribute('aria-valuenow', String(Math.round((cursor.x - geo.x0) / (geo.xNow - geo.x0) * 144)));
  canvas.setAttribute('aria-valuetext', live ? `Jetzt, ${n1.format(temp ?? 0)} Grad` : `${clock.format(t)} Uhr, ${n1.format(temp ?? 0)} Grad`);
}

// Parts of the page that only change when new data arrives.
function renderStatic() {
  const cur = state.cur, cfg = state.cfg;
  if (cfg) $('stationName').textContent = cfg.station.name;
  if (!cur) return;

  const alert = cur.alerts?.[0];
  $('alert').hidden = !alert;
  if (alert) {
    $('alertTitle').textContent = alert.banner || alert.label;
    $('alertText').textContent = alert.message || '';
  }

  const days = cur.forecast?.days ?? [];
  if (days.length) {
    const lo = Math.min(...days.map((d) => d.lo)), hi = Math.max(...days.map((d) => d.hi));
    const pct = (v) => (v - lo) / Math.max(hi - lo, 1) * 100;
    $('dayList').replaceChildren(...days.map((d, i) => {
      const li = document.createElement('li');
      li.className = 'day';
      const rain = d.pop >= 30 ? `, ${n0.format(d.pop)} % Regenrisiko` : '';
      li.innerHTML = `
        <span class="day-bar" aria-hidden="true"><i style="bottom:${pct(d.lo)}%;top:${100 - pct(d.hi)}%"></i></span>
        <span class="day-name">${i === 0 ? 'Heute' : weekday.format(d.date)}</span>
        <span class="day-cond">${CONDITION[d.conditionCode] ?? ''}${rain}</span>
        <span class="day-range">${tempText(d.hi, 0)} <small>${tempText(d.lo, 0)}</small></span>`;
      return li;
    }));
  }

}

// ---------- Drawing ----------

// Deterministic pseudo-random numbers so stars stay put between frames.
const rand = (seed) => { const x = Math.sin(seed * 127.1) * 43758.5453; return x - Math.floor(x); };

let particles = [];
function seedParticles() {
  const count = Math.round(clamp(W / 16, 28, 90));
  particles = Array.from({ length: count }, (_, i) => ({ x: rand(i + 1) * W, y: rand(i + 77) * H * 0.6, z: 0.4 + rand(i + 191) * 0.6 }));
}

let intro = reducedMotion.matches ? 1 : 0;   // the ridge draws in once on load
let lastFrame = 0;
let lastTheme = '';

function frame(ts) {
  const dt = Math.min((ts - lastFrame) / 1000 || 0, 0.05);
  lastFrame = ts;
  // Only the visible view draws.
  if (!W || document.body.dataset.view !== 'now') { requestAnimationFrame(frame); return; }
  if (terrainDirty) buildTerrain();
  if (cursor.springing) stepSpring(dt);
  if (cursor.live && !cursor.dragging && !cursor.springing) cursor.x = cursor.target = geo.xNow;
  if (intro < 1 && state.hist.temp) intro = Math.min(1, intro + dt / 1.1);

  const t = clamp(timeAtX(cursor.x), state.now - DAY, state.now);
  const sky = skyAt(t);
  draw(sky, t, dt);

  // Page chrome follows the sky.
  const theme = `${rgb(sky.zenith)}|${rgb(sky.ground)}`;
  if (theme !== lastTheme) {
    lastTheme = theme;
    applyTheme(sky);
  }
  if (cursor.dragging || cursor.springing) renderReadout();
  requestAnimationFrame(frame);
}

function draw(sky, t, dt) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { horizon, amp, xNow } = geo;
  const font = (px, weight = 500) => `${weight} ${px}px "Bricolage Grotesque", system-ui, sans-serif`;

  // Sky
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.86);
  g.addColorStop(0, rgb(sky.zenith));
  g.addColorStop(0.45, rgb(mix(sky.zenith, sky.horizon, 0.28)));
  g.addColorStop(1, rgb(sky.horizon));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Stars
  if (sky.night > 0.01) {
    for (let i = 0; i < 110; i++) {
      const x = rand(i + 500) * W, y = rand(i + 900) * H * 0.58, r = 0.5 + rand(i + 1300) * 1.1;
      ctx.fillStyle = `rgba(255,255,255,${sky.night * (0.35 + rand(i + 1700) * 0.6)})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }
  }

  // The sun's path across the day, and where it is at the chosen time
  ctx.fillStyle = `rgba(255,255,255,${0.3 - sky.night * 0.2})`;
  for (let x = 4; x < xNow; x += 9) {
    const h = sunHeight(timeAtX(x));
    if (h > -0.02) { ctx.beginPath(); ctx.arc(x, horizon - h * amp, 1.1, 0, 6.283); ctx.fill(); }
  }
  const cx = clamp(cursor.x, 0, W);
  if (sky.h > -0.12) {
    const sy = horizon - sky.h * amp;
    const low = clamp(1 - sky.h / 0.35, 0, 1);
    const core = mix(hex('#fff6cf'), hex('#ffb060'), low);
    const R = W < 640 ? 13 : 17;
    const glow = ctx.createRadialGradient(cx, sy, 0, cx, sy, R * 7);
    glow.addColorStop(0, rgb(core, 0.5)); glow.addColorStop(0.25, rgb(core, 0.16)); glow.addColorStop(1, rgb(core, 0));
    ctx.fillStyle = glow; ctx.fillRect(cx - R * 7, sy - R * 7, R * 14, R * 14);
    ctx.fillStyle = rgb(core); ctx.beginPath(); ctx.arc(cx, sy, R, 0, 6.283); ctx.fill();
  }
  if (sky.h < 0.02) {
    const my = horizon - (-sky.h) * amp * 0.85, R = W < 640 ? 10 : 13;
    const lit = (state.cur?.astro?.moon?.illumination ?? 50) / 100;
    ctx.save();
    ctx.globalAlpha = clamp(-sky.h / 0.12, 0, 1);
    ctx.beginPath(); ctx.arc(cx, my, R, 0, 6.283); ctx.clip();
    ctx.fillStyle = '#eef1ff'; ctx.fillRect(cx - R, my - R, R * 2, R * 2);
    ctx.fillStyle = rgb(mix(sky.zenith, sky.horizon, 0.3));
    ctx.beginPath(); ctx.arc(cx - R * 2 * lit, my, R, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  // Wind: streaks drift at the speed and from the side the wind blows
  const windNow = (cursor.live ? state.cur?.values.wind_speed : at('wind', t)) ?? 0;
  const dir = (state.cur?.values.wind_direction ?? 270) * Math.PI / 180;
  let dx = -Math.sin(dir); if (Math.abs(dx) < 0.35) dx = dx < 0 ? -0.35 : 0.35;
  const dy = Math.cos(dir) * 0.12;
  const speed = reducedMotion.matches ? 0 : 14 + windNow * 7;
  ctx.lineCap = 'round';
  for (const p of particles) {
    p.x += dx * speed * p.z * dt; p.y += dy * speed * p.z * dt;
    if (p.x > W + 40) p.x = -40; else if (p.x < -40) p.x = W + 40;
    if (p.y > H * 0.6) p.y = 0; else if (p.y < 0) p.y = H * 0.6;
    const len = (6 + windNow * 1.5) * p.z;
    ctx.strokeStyle = `rgba(255,255,255,${0.06 + 0.16 * p.z})`;
    ctx.lineWidth = p.z * 1.4;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - dx * len, p.y - dy * len); ctx.stroke();
  }

  // Rain falls where and when it rained
  const rain = state.hist.rain ?? [];
  ctx.strokeStyle = 'rgba(214,232,255,0.6)'; ctx.lineWidth = 1.2;
  const showers = []; let shower = null;
  for (const pt of rain) {
    if (!(pt.v > 0)) continue;
    const x = xAtTime(pt.t + 15 * 60000), bottom = ridgeY(x) - 4, top = bottom - Math.min(96, H * 0.13);
    const lines = Math.round(clamp(3 + pt.v * 4, 3, 12));
    for (let i = 0; i < lines; i++) {
      const ox = (i - (lines - 1) / 2) * 5, phase = rand(pt.t / 1e6 + i) * 18;
      ctx.setLineDash([9, 9]); ctx.lineDashOffset = -phase;
      ctx.beginPath(); ctx.moveTo(x + ox + 10, top + phase); ctx.lineTo(x + ox - 6, bottom); ctx.stroke();
    }
    ctx.setLineDash([]);
    // One label per shower: neighbouring half hours add up instead of overprinting each other.
    if (shower && x - shower.x1 < 60) { shower.sum += pt.v; shower.x1 = x; if (top < shower.top) shower.top = top; }
    else { if (shower) showers.push(shower); shower = { x0: x, x1: x, sum: pt.v, top }; }
  }
  if (shower) showers.push(shower);


  // Lightning marks the hours with strikes
  for (const pt of state.hist.light ?? []) {
    if (!(pt.v > 0)) continue;
    const x = xAtTime(pt.t + 30 * 60000), y = ridgeY(x) - 72, s = clamp(0.8 + pt.v / 20, 0.8, 1.5);
    ctx.fillStyle = '#ffd84d';
    ctx.beginPath();
    ctx.moveTo(x + 2 * s, y - 13 * s); ctx.lineTo(x - 6 * s, y + 2 * s); ctx.lineTo(x - 1 * s, y + 2 * s);
    ctx.lineTo(x - 3 * s, y + 13 * s); ctx.lineTo(x + 6 * s, y - 3 * s); ctx.lineTo(x + 1 * s, y - 3 * s);
    ctx.closePath(); ctx.fill();
  }

  // The land: its ridge is the temperature of the last 24 hours
  const reveal = 1 - (1 - intro) ** 3;
  const limit = W * reveal;
  const land = ctx.createLinearGradient(0, geo.ridgeTop, 0, H);
  land.addColorStop(0, rgb(mix(sky.ground, sky.horizon, 0.22)));
  land.addColorStop(0.55, rgb(sky.ground));
  land.addColorStop(1, rgb(sky.ground));
  ctx.fillStyle = land;
  ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= limit; x += 2) ctx.lineTo(x, ridgeY(x));
  ctx.lineTo(limit, H); ctx.closePath(); ctx.fill();
  if (limit < W) { ctx.fillStyle = rgb(sky.ground); ctx.fillRect(limit, H - 44, W - limit, 44); }

  ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
  ctx.strokeStyle = rgb(mix(sky.horizon, [255, 255, 255], 0.35), 0.85);
  ctx.beginPath();
  for (let x = 0; x <= Math.min(limit, xNow); x += 2) x ? ctx.lineTo(x, ridgeY(x)) : ctx.moveTo(x, ridgeY(x));
  ctx.stroke();
  if (limit > xNow) {   // what has not happened yet is only sketched
    ctx.setLineDash([3, 7]); ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.moveTo(xNow, ridgeY(xNow)); ctx.lineTo(limit, ridgeY(xNow)); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // How much each shower brought, written on the land below it
  if (intro === 1) {
    ctx.fillStyle = 'rgba(243,246,242,0.78)'; ctx.font = font(13); ctx.textAlign = 'center';
    for (const s of showers) { const x = clamp((s.x0 + s.x1) / 2, 56, W - 56); ctx.fillText(`${show('rain', s.sum)} ${conv('rain').unit} Regen`, x, Math.max(ridgeY(x - 40), ridgeY(x), ridgeY(x + 40)) + 24); }
  }

  // Coldest and warmest point of the day, written on the land
  if (extremes && intro === 1) {
    ctx.font = font(13); ctx.fillStyle = 'rgba(243,246,242,0.78)';
    for (const [pt, above] of [[extremes.max, true], [extremes.min, false]]) {
      const x = xAtTime(pt.t);
      if (Math.abs(x - cursor.x) < 70) continue;
      ctx.textAlign = x < 70 ? 'left' : x > xNow - 70 ? 'right' : 'center';
      ctx.fillText(`${tempText(pt.v)} um ${clock.format(pt.t)}`, x, ridgeY(x) + (above ? -14 : 24));
    }
  }

  // Hours along the bottom
  ctx.font = font(12, 400); ctx.fillStyle = 'rgba(243,246,242,0.55)'; ctx.textAlign = 'center';
  const first = new Date(state.now - DAY); first.setMinutes(0, 0, 0);
  for (let h = first.getTime(); h <= state.now; h += 3600000) {
    const d = new Date(h), hour = d.getHours();
    if (hour % (W < 640 ? 6 : 3) !== 0) continue;
    const x = xAtTime(h);
    if (x < 26 || x > xNow - 34 || x > limit) continue;
    ctx.fillText(hour === 0 ? weekdayShort.format(d).replace('.', '') + ', 0 Uhr' : `${hour} Uhr`, x, H - 16);
  }

  // The cursor
  if (intro === 1) {
    const y = ridgeY(cx);
    const top = horizon - amp * 1.02;
    const line = ctx.createLinearGradient(0, top, 0, y);
    line.addColorStop(0, 'rgba(255,255,255,0)'); line.addColorStop(1, 'rgba(255,255,255,0.7)');
    ctx.strokeStyle = line; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, H - 34); ctx.stroke();
    const grab = cursor.dragging ? 1 : 0;
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.arc(cx, y, 11 + grab * 5, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, y, 5, 0, 6.283); ctx.fill();
    ctx.font = font(12, 600); ctx.fillStyle = 'rgba(243,246,242,0.95)';
    ctx.textAlign = cx > W - 40 ? 'right' : 'center';
    ctx.fillText(cursor.live && !cursor.dragging ? 'Jetzt' : clock.format(t), cx, H - 16);
  }
}

// On a phone the alert would cover the sun, so it moves below the scene.
const narrow = matchMedia('(max-width: 40rem)');
const placeAlert = () => (narrow.matches ? $('alertSlot') : document.querySelector('.when')).append($('alert'));
narrow.addEventListener('change', placeAlert);
placeAlert();

// A change of units redraws everything that shows a value.
window.addEventListener('units', () => { lastReadoutKey = ''; renderStatic(); renderReadout(); });

// Another view may have set the page colours in the meantime.
window.addEventListener('viewchange', () => { lastTheme = ''; });

// ---------- Start ----------

new ResizeObserver(() => { if (canvas.getBoundingClientRect().width) resize(); }).observe(canvas);
resize();

(async () => {
  try { state.cfg = store.cfg = await getJson('/api/config'); } catch { /* the page still works without the station name */ }
  await Promise.all([loadCurrent(), loadHistory()]);
  const every = (state.cfg?.ui?.refresh_seconds ?? 15) * 1000;
  setInterval(loadCurrent, every);
  setInterval(loadHistory, 5 * 60 * 1000);
  setInterval(() => { if (cursor.live) { lastReadoutKey = ''; state.now = Date.now(); renderReadout(); } }, 20000);
})();

document.fonts?.ready.then(() => { lastReadoutKey = ''; renderReadout(); });
requestAnimationFrame(frame);
