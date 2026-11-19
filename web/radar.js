// Rain radar: DWD's RADOLAN rain radar for Germany on the map, with the last two hours as a loop.

import { $, getJson, store, stationReady, num, fromWord, show, conv, atClock } from './lib.js';
import { tr } from './i18n.js';
import { GRID, createMap, toGridPos, nearestPlace } from './map.js';

const POLL_MS = 60 * 1000;   // DWD adds a frame every five minutes
const FRAME_MS = 420, HOLD_MS = 1600;
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

const state = { frames: [], index: -1, playing: false, built: false, timer: 0, poll: 0, marker: null };
const grids = new Map();              // timestamp → Uint8Array(900 × 900)
const layer = document.createElement('canvas');
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

async function loadGrid(t) {
  if (grids.has(t)) return grids.get(t);
  const r = await fetch(`/api/radar/grid?t=${t}`);
  if (!r.ok) throw new Error(`${r.status}`);
  const grid = new Uint8Array(await r.arrayBuffer());
  grids.set(t, grid);
  return grid;
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

function describe(grid) {
  const node = $('radarLocal');
  if (!state.marker || !grid) {
    node.textContent = state.marker ? '' : tr('radar.noLocation');
    return;
  }
  const r = localRain(grid, state.marker), place = nearestPlace(...state.marker).place.name;
  const unit = conv('rain').unit;
  node.textContent = !r ? ''
    : r.kind === 'outside' ? tr('radar.outside', { place })
      : r.kind === 'rain' ? tr('radar.raining', { place, rate: show('rain', r.mmh), unit })
        : r.kind === 'near' ? tr('radar.nearest', { place, km: num(r.km, 0), dir: fromWord(r.bearing) })
          : tr('radar.dry', { place });
}

async function showFrame(i) {
  const t = state.frames[i];
  if (t == null) return;
  state.index = i;
  $('radarTime').textContent = atClock(t);
  $('radarSlider').value = String(i);
  $('radarSlider').setAttribute('aria-valuetext', atClock(t));
  try {
    const grid = await loadGrid(t);
    if (state.index !== i) return;   // the loop has moved on meanwhile
    painted = grid; layerKey = '';
    map.draw(); describe(grid);
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
    state.timer = setTimeout(step, next === last ? HOLD_MS : FRAME_MS);
  };
  if (state.index >= state.frames.length - 1) showFrame(0);
  state.timer = setTimeout(step, FRAME_MS);
}

async function refresh() {
  try {
    const meta = await getJson('/api/radar');
    const wasLatest = state.index < 0 || state.index === state.frames.length - 1;
    state.frames = meta.frames?.length ? meta.frames : [meta.timestamp];
    for (const t of grids.keys()) if (!state.frames.includes(t)) grids.delete(t);
    $('radarSlider').max = String(state.frames.length - 1);
    $('radarSlider').disabled = state.frames.length < 2;
    $('radarPlay').disabled = state.frames.length < 2;
    $('radarStatus').textContent = tr('radar.status', { time: atClock(state.frames[state.frames.length - 1]), n: state.frames.length });
    if (!state.playing && wasLatest) await showFrame(state.frames.length - 1);
    // The rest of the loop is fetched quietly, newest first, so pressing play does not stall.
    for (const t of [...state.frames].reverse()) await loadGrid(t).catch(() => {});
  } catch (e) {
    $('radarStatus').textContent = e.status === 503 ? tr('radar.fetching') : tr('radar.unreachable', { error: e.message });
  }
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
    },
    over: (ctx, m) => {
      if (!state.marker) return;
      const [x, y] = m.toScreen(...state.marker);
      ctx.fillStyle = 'rgba(255,207,92,0.3)'; ctx.beginPath(); ctx.arc(x, y, 11, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#ffcf5c'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.283); ctx.fill();
      ctx.font = '500 11px "Bricolage Grotesque", system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,220,140,0.95)'; ctx.textBaseline = 'middle';
      for (const km of RINGS_KM) { const r = km * m.scale; if (r > 26) ctx.fillText(`${km} km`, x + r * 0.71 + 4, y - r * 0.71); }
    },
    onMove: (m) => { $('radarReset').hidden = !m.zoomed; },
  });

  $('radarLegend').style.background = `linear-gradient(90deg, ${STOPS.map(([mmh, c]) => `rgb(${c[0]} ${c[1]} ${c[2]}) ${(rampPosition(mmh) * 100).toFixed(1)}%`).join(', ')})`;
  $('radarTicks').replaceChildren(...[1, 3, 10, 30, 100].map((v) => {
    const s = document.createElement('span'); s.textContent = String(v); s.style.left = `${rampPosition(v) * 100}%`; return s;
  }));
  $('radarPlay').addEventListener('click', () => setPlaying(!state.playing));
  $('radarSlider').addEventListener('input', (e) => { setPlaying(false); showFrame(Number(e.target.value)); });
  $('radarReset').addEventListener('click', () => { map.reset(); $('radarReset').hidden = true; });
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
  describe(painted);
  refresh();
  clearInterval(state.poll);
  state.poll = setInterval(refresh, POLL_MS);
}

export function leave() {
  setPlaying(false);
  clearInterval(state.poll);
}
