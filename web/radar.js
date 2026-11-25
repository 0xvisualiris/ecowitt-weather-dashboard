// Rain radar: DWD's RADOLAN rain radar for Germany on the map, with the last two hours and DWD's
// two-hour nowcast as one loop.

import { $, getJson, store, stationReady, num, fromWord, show, conv, atClock } from './lib.js';
import { tr } from './i18n.js';
import { GRID, createMap, toGridPos, nearestPlace } from './map.js';
import { motionField } from './motion.js';

const POLL_MS = 60 * 1000;   // DWD adds a frame every five minutes
const FRAME_MS = 420, HOLD_MS = 1600, HOLD_NOW_MS = 1000;   // the loop pauses at "now" and at its end
const MM_PER_HOUR_PER_CLASS = 0.6;   // each intensity class from the server is 0.05 mm per 5 minutes
const RINGS_KM = [25, 50, 100];

// Rain rate (mm/h) → colour, on a log scale: most rain is light, and a linear ramp would paint it all the same blue.
const STOPS = [
  [0.6, [140, 190, 255, 150]], [1.5, [92, 152, 255, 195]], [3, [56, 108, 240, 220]], [6, [38, 186, 172, 232]], [10, [96, 214, 92, 238]],
  [18, [240, 224, 72, 242]], [30, [246, 152, 46, 246]], [60, [228, 58, 62, 250]], [150, [204, 64, 204, 255]],
];
const LOG_MIN = Math.log(STOPS[0][0]), LOG_MAX = Math.log(STOPS[STOPS.length - 1][0]);
const rampPosition = (mmh) => Math.max(0, Math.min(1, (Math.log(mmh) - LOG_MIN) / (LOG_MAX - LOG_MIN)));
function rainColour(mmh) {
  if (mmh <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
    if (mmh <= b) { const f = (Math.log(mmh) - Math.log(a)) / (Math.log(b) - Math.log(a)); return ca.map((v, k) => v + (cb[k] - v) * f); }
  }
  return STOPS[STOPS.length - 1][1];
}
const LUT = new Uint8ClampedArray(256 * 4);
for (let v = 1; v < 255; v++) LUT.set(rainColour(v * MM_PER_HOUR_PER_CLASS), v * 4);
LUT.set([8, 14, 22, 105], 255 * 4);   // 255 = outside radar range: dimmed, so the edge of the coverage shows
const LUT32 = new Uint32Array(LUT.buffer);

// frames: [{ t, run }], oldest first; run is null for an observed frame, the nowcast run for a forecast one.
// now: the index of the newest observed frame.
const state = { frames: [], now: -1, index: -1, playing: false, built: false, timer: 0, poll: 0, marker: null, badge: null, motion: [], motionKey: '' };
const MOTION_MINUTES = 15;                 // how far apart the two frames are that the direction is read from
const STRIKE_WINDOW_MS = 15 * 60 * 1000;   // a strike shows as a ring on the frames up to 15 minutes after it
const grids = new Map();              // frameKey → Uint8Array(900 × 900)
const frameKey = (f) => (f.run == null ? String(f.t) : `${f.t}@${f.run}`);
const layer = document.createElement('canvas');

// Newer frames that arrived while you were playing the loop or looking at another moment: the view
// stays where it is, and a button in the header offers to jump to the new "now".
function setPending(time) {
  const button = $('radarNew');
  button.hidden = time == null;
  if (time == null) return;
  const at = Object.assign(document.createElement('span'), { className: 'update-time', textContent: `, ${time}` });
  button.replaceChildren(tr('radar.newData'), at);
}

// The frame in `frames` that shows what `frame` showed: the same one, or the closest in time.
function sameFrame(frames, frame) {
  if (!frame) return -1;
  const key = frameKey(frame), exact = frames.findIndex((f) => frameKey(f) === key);
  if (exact >= 0) return exact;
  let best = -1;
  frames.forEach((f, i) => { if (best < 0 || Math.abs(f.t - frame.t) < Math.abs(frames[best].t - frame.t)) best = i; });
  return best;
}
let map = null, painted = null, layerKey = '';

// The rain, drawn for the visible part of the map at screen resolution rather than as 1 km squares:
// each screen pixel interpolates the rain rate between the four nearest grid cells (bilinear), and the
// edge of the rain fades out over the last half class, so showers get smooth outlines at any zoom.
// Redrawn only when the frame, the view or the size changes.
const MAX_PIXELS = 900_000;
function renderRain(m) {
  const { W, H, dpr } = m.size, v = m.view;
  const step = Math.max(1, Math.sqrt((W * dpr * H * dpr) / MAX_PIXELS));
  const ow = Math.ceil(W * dpr / step), oh = Math.ceil(H * dpr / step);
  const key = `${state.index}|${v.x}|${v.y}|${v.w}|${ow}x${oh}`;
  if (key === layerKey) return;
  layerKey = key;
  if (layer.width !== ow || layer.height !== oh) { layer.width = ow; layer.height = oh; }
  const ctx = layer.getContext('2d'), img = ctx.createImageData(ow, oh), px = new Uint32Array(img.data.buffer), grid = painted;
  const k = v.w / ow;   // kilometres per layer pixel
  const cell = (x, y) => (x < 0 || y < 0 || x >= GRID || y >= GRID ? 255 : grid[y * GRID + x]);
  const nodata = LUT32[255];
  for (let j = 0; j < oh; j++) {
    const gy = v.y + (j + 0.5) * k - 0.5, y0 = Math.floor(gy), fy = gy - y0;
    if (y0 < -1 || y0 >= GRID) continue;
    for (let i = 0; i < ow; i++) {
      const gx = v.x + (i + 0.5) * k - 0.5, x0 = Math.floor(gx), fx = gx - x0;
      if (x0 < -1 || x0 >= GRID) continue;
      const a = cell(x0, y0), b = cell(x0 + 1, y0), c = cell(x0, y0 + 1), d = cell(x0 + 1, y0 + 1);
      if ((a | b | c | d) === 0) continue;   // dry: the common case, nothing to draw
      const wa = (1 - fx) * (1 - fy), wb = fx * (1 - fy), wc = (1 - fx) * fy, wd = fx * fy;
      // Cells outside radar range count as "no data" and as dry for the rain around them.
      const none = (a === 255) * wa + (b === 255) * wb + (c === 255) * wc + (d === 255) * wd;
      if (none > 0.5) { px[j * ow + i] = nodata; continue; }
      const rain = (a === 255 ? 0 : a) * wa + (b === 255 ? 0 : b) * wb + (c === 255 ? 0 : c) * wc + (d === 255 ? 0 : d) * wd;
      if (rain < 0.25) continue;
      const colour = LUT32[Math.min(254, Math.max(1, Math.round(rain)))];
      const edge = Math.min(1, (rain - 0.25) / 0.5);
      px[j * ow + i] = edge >= 1 ? colour : (colour & 0x00ffffff) | (Math.round((colour >>> 24) * edge) << 24);
    }
  }
  ctx.putImageData(img, 0, 0);
}

async function loadGrid(f) {
  const key = frameKey(f);
  if (grids.has(key)) return grids.get(key);
  const r = await fetch(`/api/radar/grid?t=${f.t}${f.run == null ? '' : `&run=${f.run}`}`);
  if (!r.ok) throw new Error(`${r.status}`);
  const grid = new Uint8Array(await r.arrayBuffer());
  grids.set(key, grid);
  return grid;
}

// The rain class at the home location in a grid: 0 dry, 255 no data, else rain.
const homeCell = (grid, home) => {
  const hx = Math.round(home[0]), hy = Math.round(home[1]);
  return hx < 0 || hy < 0 || hx >= GRID || hy >= GRID ? 255 : grid[hy * GRID + hx];
};

// What the nowcast says about the home location: when the rain starts or stops there.
function outlook() {
  const node = $('radarOutlook');
  const now = state.frames[state.now], ahead = state.frames.slice(state.now + 1);
  const nowGrid = now && grids.get(frameKey(now));
  if (!state.marker || !nowGrid || !ahead.length || ahead.some((f) => !grids.has(frameKey(f)))) { node.textContent = ''; return; }
  const here = homeCell(nowGrid, state.marker);
  if (here === 255) { node.textContent = ''; return; }
  const place = placeName();
  const raining = (v) => v > 0 && v < 255;
  const values = ahead.map((f) => homeCell(grids.get(frameKey(f)), state.marker));
  const change = values.findIndex((v) => v === 255 || raining(v) !== raining(here));
  if (change >= 0 && values[change] === 255) { node.textContent = ''; return; }   // the nowcast's coverage ends first
  const until = atClock(ahead[ahead.length - 1].t);
  const at = (i) => ({ place, time: atClock(ahead[i].t), min: num(Math.round((ahead[i].t - now.t) / 60000), 0) });
  node.textContent = raining(here)
    ? (change < 0 ? tr('radar.outlook.keepsRaining', { place, until }) : tr('radar.outlook.stops', at(change)))
    : (change < 0 ? tr('radar.outlook.staysDry', { place, until }) : tr('radar.outlook.starts', at(change)));
}

// The name the local readout uses: the nearest map label, unless that town is farther off than
// the station's own surroundings, in which case the station's name fits better ("near Frankfurt"
// for a village 30 km away would point visitors to the wrong place).
const PLACE_KM = 8;
function placeName() {
  const near = nearestPlace(...state.marker), own = store.cfg?.station?.name;
  return near.km > PLACE_KM && own && own !== 'Weather Station' ? own : near.place.name;
}

// What the frame says about the home location: the rain there, or where the nearest rain is (out to 150 km).
function localRain(grid, home) {
  const hx = Math.round(home[0]), hy = Math.round(home[1]);
  if (hx < 0 || hy < 0 || hx >= GRID || hy >= GRID) return null;
  const here = grid[hy * GRID + hx];
  if (here === 255) return { kind: 'outside' };
  if (here > 0) return { kind: 'rain', mmh: here * MM_PER_HOUR_PER_CLASS };
  const REACH = 150;
  let best = Infinity, bx = 0, by = 0;
  for (let y = Math.max(0, hy - REACH); y <= Math.min(GRID - 1, hy + REACH); y++) {
    for (let x = Math.max(0, hx - REACH); x <= Math.min(GRID - 1, hx + REACH); x++) {
      const v = grid[y * GRID + x];
      if (v === 0 || v === 255) continue;
      const d = (x - hx) ** 2 + (y - hy) ** 2;
      if (d < best) { best = d; bx = x; by = y; }
    }
  }
  if (best > REACH * REACH) return { kind: 'dry' };
  return { kind: 'near', km: Math.sqrt(best), bearing: (Math.atan2(bx - hx, hy - by) * 180 / Math.PI + 360) % 360 };
}

// The frame at the home location; a forecast frame in the future tense.
function describe(grid, frame) {
  describeMotion();
  describeLightning(frame);
  const node = $('radarLocal');
  if (!state.marker || !grid) {
    node.textContent = state.marker ? '' : tr('radar.noLocation');
    return;
  }
  const r = localRain(grid, state.marker), place = placeName();
  const unit = conv('rain').unit, k = frame?.run != null ? 'radar.f.' : 'radar.', time = frame ? atClock(frame.t) : '';
  node.textContent = !r ? ''
    : r.kind === 'outside' ? tr('radar.outside', { place })
      : r.kind === 'rain' ? tr(`${k}raining`, { place, time, rate: show('rain', r.mmh), unit })
        : r.kind === 'near' ? tr(`${k}nearest`, { place, time, km: num(r.km, 0), dir: fromWord(r.bearing) })
          : tr(`${k}dry`, { place, time });
}

// ---------- Where the showers are heading ----------
// Read from "now" and DWD's nowcast 15 minutes on, which moves the rain with DWD's own motion
// analysis; without a nowcast, from the observed frame 15 minutes before "now". Recomputed when
// "now" or the nowcast run moves on.
async function updateMotion() {
  const now = state.frames[state.now];
  if (!now) return;
  const near = (from, to, t) => { for (let i = from; i !== to; i += Math.sign(to - from)) if (Math.abs(state.frames[i].t - t) < 3 * 60000) return state.frames[i]; return null; };
  const ahead = near(state.now + 1, state.frames.length, now.t + MOTION_MINUTES * 60000);
  const [older, newer] = ahead ? [now, ahead] : [near(state.now - 1, -1, now.t - MOTION_MINUTES * 60000), now];
  if (!older) return;
  const key = `${frameKey(older)}>${frameKey(newer)}`;
  if (key === state.motionKey) return;
  try {
    const [a, b] = await Promise.all([loadGrid(older), loadGrid(newer)]);
    state.motion = motionField(a, b, (newer.t - older.t) / 60000).filter((v) => v.speed >= 5);
    state.motionKey = key;
    map.draw(); describeMotion();
  } catch { /* a frame is gone; the next poll tries again */ }
}

// The patch with rain nearest to the home location: how fast and where it moves, and whether towards it.
function describeMotion() {
  const node = $('radarMotion');
  node.textContent = '';
  node.hidden = true;
  if (!state.marker || !state.motion.length || state.index < state.now) return;
  const [hx, hy] = state.marker;
  let best = null, bestD = Infinity;
  for (const v of state.motion) { const d = Math.hypot(v.x - hx, v.y - hy); if (d < bestD) { bestD = d; best = v; } }
  if (!best || bestD > 150) return;
  const speed = show('wind', best.speed, 0), unit = conv('wind').unit, dir = fromWord(best.bearing);
  // Towards home: the motion points within 45 degrees of the line from the rain to the home location.
  const toHome = Math.atan2(hx - best.x, -(hy - best.y)) * 180 / Math.PI;
  const off = Math.abs((((best.bearing - toHome) % 360) + 540) % 360 - 180);
  node.textContent = tr(bestD > 20 && off < 45 ? 'radar.motionToward' : 'radar.motion', { speed, unit, dir, place: placeName() });
  node.hidden = false;
}

// ---------- The station's own lightning ----------
// The sensor gives a distance but no direction, so each strike is a ring around the home location,
// on the frames up to 15 minutes after it.
function strikesFor(frame) {
  if (!frame || frame.run != null || !state.marker) return [];
  return (store.cur?.lightningRecent ?? []).filter((s) => s.t <= frame.t + 60000 && s.t > frame.t - STRIKE_WINDOW_MS);
}

function describeLightning(frame) {
  const node = $('radarLightning'), strikes = strikesFor(frame);
  node.hidden = !strikes.length;
  if (!strikes.length) return;
  const n = strikes.reduce((a, s) => a + s.n, 0), nearest = Math.min(...strikes.map((s) => s.km));
  node.textContent = tr('radar.lightning', { n, km: num(nearest, 0) });
}

// "now", "35 min ago" or "forecast, in 35 min", counted from the newest observed frame.
function whenLabel(i) {
  if (i === state.now) return tr('radar.when.now');
  const min = num(Math.abs(Math.round((state.frames[i].t - state.frames[state.now].t) / 60000)), 0);
  return tr(i < state.now ? 'radar.when.ago' : 'radar.when.ahead', { min });
}

async function showFrame(i) {
  const frame = state.frames[i];
  if (frame == null) return;
  state.index = i;
  if (i === state.now && !state.playing) setPending(null);   // you are at the newest frame now
  const forecast = frame.run != null, when = whenLabel(i);
  $('radarTime').textContent = atClock(frame.t);
  $('radarWhen').textContent = when;
  $('radarWhen').classList.toggle('ahead', forecast);
  $('radarSlider').value = String(i);
  $('radarSlider').setAttribute('aria-valuetext', `${atClock(frame.t)}, ${when}`);
  state.badge.textContent = when;
  state.badge.hidden = !forecast;
  try {
    const grid = await loadGrid(frame);
    if (state.index !== i) return;   // the loop has moved on meanwhile
    painted = grid; layerKey = '';
    map.draw(); describe(grid, frame);
  } catch { /* that frame is gone; the next poll replaces the list */ }
}

function setPlaying(on) {
  state.playing = on;
  clearTimeout(state.timer);
  $('radarPlay').setAttribute('aria-pressed', String(on));
  $('radarPlay').textContent = tr(on ? 'radar.pause' : 'radar.play');
  if (!on) return;
  const step = () => {
    if (!state.playing) return;
    const last = state.frames.length - 1, next = state.index >= last ? 0 : state.index + 1;
    showFrame(next);
    state.timer = setTimeout(step, next === last ? HOLD_MS : next === state.now ? HOLD_NOW_MS : FRAME_MS);
  };
  if (state.index >= state.frames.length - 1) showFrame(0);
  state.timer = setTimeout(step, FRAME_MS);
}

async function refresh() {
  try {
    const meta = await getJson('/api/radar');
    const wasNow = state.index < 0 || state.index === state.now;
    const shown = state.frames[state.index], newestBefore = state.frames[state.now]?.t;
    const runBefore = state.frames.find((f) => f.run != null)?.run ?? null;
    const observed = (meta.frames?.length ? meta.frames : [meta.timestamp]).map((t) => ({ t, run: null }));
    const ahead = meta.run != null ? (meta.forecast ?? []).map((t) => ({ t, run: meta.run })) : [];
    state.frames = [...observed, ...ahead];
    state.now = observed.length - 1;
    const keys = new Set(state.frames.map(frameKey));
    for (const k of grids.keys()) if (!keys.has(k)) grids.delete(k);
    const last = state.frames.length - 1;
    $('radarSlider').max = String(last);
    $('radarSlider').disabled = last < 1;
    $('radarPlay').disabled = last < 1;
    scale(observed, ahead);
    const time = atClock(observed[state.now].t);
    $('radarStatus').textContent = ahead.length
      ? tr('radar.statusAhead', { time, until: atClock(ahead[ahead.length - 1].t) })
      : tr('radar.status', { time, n: observed.length });
    const newer = newestBefore != null && (observed[state.now].t > newestBefore || (ahead[0]?.run ?? null) !== runBefore);
    if (!state.playing && wasNow) {
      setPending(null);
      await showFrame(state.now);
    } else {
      // The list has moved on under the frame on screen: keep showing that moment (the loop carries on from it).
      state.index = sameFrame(state.frames, shown);
      if (!state.playing) await showFrame(Math.max(0, state.index));
      if (newer) setPending(time);
    }
    // The rest of the loop is fetched quietly, the forecast first, so the outlook and play do not wait.
    for (const f of [...ahead, ...[...observed].reverse()]) await loadGrid(f).catch(() => {});
    outlook();
    await updateMotion();
  } catch (e) {
    $('radarStatus').textContent = e.status === 503 ? tr('radar.fetching') : tr('radar.unreachable', { error: e.message });
  }
}

// Under the slider: where the past ends and the forecast begins.
function scale(observed, ahead) {
  const last = observed.length + ahead.length - 1, nowAt = observed.length - 1;
  const mark = (text, i, cls) => {
    const s = document.createElement('span');
    s.textContent = text; s.className = cls; s.style.left = `${(last ? i / last : 1) * 100}%`;
    return s;
  };
  const minutes = (a, b) => num(Math.round((b - a) / 60000), 0);
  const marks = [mark(tr('radar.scale.ago', { min: minutes(observed[0].t, observed[nowAt].t) }), 0, 'start')];
  marks.push(mark(tr('radar.when.now'), nowAt, ahead.length ? 'now' : 'end'));
  if (ahead.length) marks.push(mark(tr('radar.scale.ahead', { min: minutes(observed[nowAt].t, ahead[ahead.length - 1].t) }), last, 'end'));
  $('radarScale').replaceChildren(...marks);
}

// An arrow per patch with rain, from "now" on. Its length grows with the speed, within limits
// that keep it readable at every zoom.
function drawMotion(ctx, m) {
  if (state.index < state.now || !state.motion.length) return;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const v of state.motion) {
    const [x, y] = m.toScreen(v.x, v.y);
    if (x < -40 || y < -40 || x > m.size.W + 40 || y > m.size.H + 40) continue;
    const len = Math.max(18, Math.min(70, (v.speed / 4) * m.scale)), ux = v.vx / v.speed, uy = v.vy / v.speed;
    const x0 = x - ux * len / 2, y0 = y - uy * len / 2, x1 = x + ux * len / 2, y1 = y + uy * len / 2;
    const arrow = () => {
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      ctx.moveTo(x1 - ux * 8 - uy * 5, y1 - uy * 8 + ux * 5); ctx.lineTo(x1, y1); ctx.lineTo(x1 - ux * 8 + uy * 5, y1 - uy * 8 - ux * 5);
      ctx.stroke();
    };
    ctx.strokeStyle = 'rgba(6,10,16,0.75)'; ctx.lineWidth = 5; arrow();
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 2; arrow();
  }
  ctx.restore();
}

function build() {
  state.built = true;
  map = createMap($('radarMap'), {
    label: tr('radar.mapLabel'),
    tiles: true,
    under: (ctx, m) => {
      if (!painted) return;
      renderRain(m);
      const { W, H } = m.size;
      ctx.save();
      ctx.setTransform(m.size.dpr, 0, 0, m.size.dpr, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(layer, 0, 0, W, H);
      ctx.restore();
    },
    lines: (ctx, m) => {
      if (!state.marker) return;
      const [x, y] = state.marker, px = 1 / m.scale;
      ctx.strokeStyle = 'rgba(255,207,92,0.75)'; ctx.lineWidth = 1.2 * px;
      for (const km of RINGS_KM) { ctx.beginPath(); ctx.arc(x, y, km, 0, 6.283); ctx.stroke(); }
      // Lightning: white dashed rings, fading over the 15 minutes after the strike.
      const frame = state.frames[state.index];
      ctx.save();
      ctx.setLineDash([6 * px, 5 * px]); ctx.lineWidth = 2 * px;
      for (const s of strikesFor(frame)) {
        const age = Math.max(0, (frame.t - s.t) / STRIKE_WINDOW_MS);
        ctx.strokeStyle = `rgba(255,255,255,${(0.95 - 0.65 * age).toFixed(2)})`;
        ctx.beginPath(); ctx.arc(x, y, Math.max(s.km, 0.5), 0, 6.283); ctx.stroke();
      }
      ctx.restore();
    },
    over: (ctx, m) => {
      drawMotion(ctx, m);
      if (!state.marker) return;
      const [x, y] = m.toScreen(...state.marker);
      ctx.fillStyle = 'rgba(255,207,92,0.3)'; ctx.beginPath(); ctx.arc(x, y, 11, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#ffcf5c'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.283); ctx.fill();
      ctx.font = '500 11px "Bricolage Grotesque", system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,220,140,0.95)'; ctx.textBaseline = 'middle';
      for (const km of RINGS_KM) { const r = km * m.scale; if (r > 26) ctx.fillText(`${km} km`, x + r * 0.71 + 4, y - r * 0.71); }
    },
    onMove: (m) => { $('radarReset').hidden = !m.zoomed; },
  });
  state.badge = Object.assign(document.createElement('span'), { className: 'radar-badge', hidden: true });
  state.badge.setAttribute('aria-hidden', 'true');   // the same text is beside the map
  map.frame.append(state.badge);

  $('radarLegend').style.background = `linear-gradient(90deg, ${STOPS.map(([mmh, c]) => `rgb(${c[0]} ${c[1]} ${c[2]}) ${(rampPosition(mmh) * 100).toFixed(1)}%`).join(', ')})`;
  $('radarTicks').replaceChildren(...[1, 3, 10, 30, 100].map((v) => {
    const s = document.createElement('span'); s.textContent = String(v); s.style.left = `${rampPosition(v) * 100}%`; return s;
  }));
  $('radarPlay').addEventListener('click', () => setPlaying(!state.playing));
  $('radarSlider').addEventListener('input', (e) => { setPlaying(false); showFrame(Number(e.target.value)); });
  $('radarReset').addEventListener('click', () => { map.reset(); $('radarReset').hidden = true; });
  $('radarNew').addEventListener('click', () => { setPlaying(false); showFrame(state.now); });
}

export async function enter() {
  if (!state.built) build();
  await stationReady();
  const loc = store.cfg?.station?.publicLocation;
  const marker = loc ? toGridPos(loc.lon, loc.lat) : null;
  if (JSON.stringify(marker) !== JSON.stringify(state.marker) || state.index < 0) {
    state.marker = marker;
    // Opens on the surroundings of the home location if there is one, otherwise on all of Germany.
    map.setHome(marker ? { x: marker[0] - 130, y: marker[1] - 130, w: 260 } : { x: 0, y: 0, w: GRID });
  }
  describe(painted, state.frames[state.index]);
  refresh();
  clearInterval(state.poll);
  state.poll = setInterval(refresh, POLL_MS);
}

// New readings (and with them new strikes) arrive with /api/current; the rings follow.
window.addEventListener('station', () => {
  if (state.built && document.body.dataset.view === 'radar') { map.draw(); describeLightning(state.frames[state.index]); }
});

export function leave() {
  setPlaying(false);
  setPending(null);
  clearInterval(state.poll);
}
