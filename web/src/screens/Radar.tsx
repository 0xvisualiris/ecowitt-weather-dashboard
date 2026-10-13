import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { type AppConfig, NBSP, compass, fmt, hhmm } from '../lib';
import { t } from '../i18n';
import { zoomKey } from '../components/GestureHint';
import { GRID, GridMap, pct, type GridMapApi } from '../components/GridMap';
import { lonLatToRadolanPixel } from '../radolanProjection';
import type { View } from '../panZoom';
import { prefersReducedMotion } from '../spring';

interface RadarMeta { width: number; height: number; timestamp: number; frames: number[] }
const POLL_MS = 60 * 1000; // how often to ask for new frames (DWD adds one every 5 minutes)
const FRAME_MS = 420; // playback: time per frame …
const HOLD_MS = 1600; // … and how long the newest one is held before the loop restarts
// The rain layer is drawn at twice the grid resolution, smoothed, so cells
// read as soft-edged rain areas rather than 1 km blocks when zoomed in.
const UPSCALE = 2;

// An intensity class from the server (1-254, see radolan.js: 0.05 mm per
// 5 minutes each) is 0.6 mm/h.
const MM_PER_HOUR_PER_CLASS = 0.6;

// Rain rate (mm/h) -> colour, the conventional radar ramp: translucent light
// blue drizzle through blue, green and yellow to red and magenta downpours.
// Interpolated on a log scale, because rain rates span three orders of
// magnitude and most of any frame is light rain — a linear ramp paints all of
// it the same blue.
const STOPS: [number, [number, number, number, number]][] = [
  [0.6, [140, 190, 255, 150]],
  [1.5, [92, 152, 255, 195]],
  [3, [56, 108, 240, 220]],
  [6, [38, 186, 172, 232]],
  [10, [96, 214, 92, 238]],
  [18, [240, 224, 72, 242]],
  [30, [246, 152, 46, 246]],
  [60, [228, 58, 62, 250]],
  [150, [204, 64, 204, 255]],
];
const LOG_MIN = Math.log(STOPS[0][0]), LOG_MAX = Math.log(STOPS[STOPS.length - 1][0]);
const rampPosition = (mmh: number) => Math.max(0, Math.min(1, (Math.log(mmh) - LOG_MIN) / (LOG_MAX - LOG_MIN)));

function rainColor(mmh: number): [number, number, number, number] {
  if (mmh <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
    if (mmh <= b) {
      const f = (Math.log(mmh) - Math.log(a)) / (Math.log(b) - Math.log(a));
      return [0, 1, 2, 3].map(k => ca[k] + (cb[k] - ca[k]) * f) as [number, number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}
// One RGBA entry per intensity class, built once.
const LUT = new Uint8ClampedArray(256 * 4);
for (let v = 1; v < 255; v++) LUT.set(rainColor(v * MM_PER_HOUR_PER_CLASS), v * 4);
// 255 = outside radar range: dimmed, so the edge of the coverage is visible.
LUT.set([4, 6, 12, 140], 255 * 4);
const LUT32 = new Uint32Array(LUT.buffer);

const LEGEND_GRADIENT = `linear-gradient(90deg, ${STOPS.map(([mmh, c]) => `rgb(${c[0]} ${c[1]} ${c[2]}) ${(rampPosition(mmh) * 100).toFixed(1)}%`).join(', ')})`;
const LEGEND_TICKS = [1, 3, 10, 30, 100];

const RINGS_KM = [25, 50, 100]; // distance rings around the home marker; 1 grid px = 1 km

// What the frame on screen says about the home location: the rain rate right
// there, and where the nearest rain is (searched out to 150 km).
function localRain(grid: Uint8Array, home: [number, number]) {
  const hx = Math.round(home[0]), hy = Math.round(home[1]);
  if (hx < 0 || hy < 0 || hx >= GRID || hy >= GRID) return null;
  const here = grid[hy * GRID + hx];
  if (here === 255) return { kind: 'outside' as const };
  if (here > 0) return { kind: 'rain' as const, mmh: here * MM_PER_HOUR_PER_CLASS };
  const REACH = 150;
  let best = Infinity, bx = 0, by = 0;
  for (let y = Math.max(0, hy - REACH); y <= Math.min(GRID - 1, hy + REACH); y++) {
    for (let x = Math.max(0, hx - REACH); x <= Math.min(GRID - 1, hx + REACH); x++) {
      const v = grid[y * GRID + x];
      if (v === 0 || v === 255) continue;
      const d = (x - hx) * (x - hx) + (y - hy) * (y - hy);
      if (d < best) { best = d; bx = x; by = y; }
    }
  }
  if (best > REACH * REACH) return { kind: 'dry' as const };
  return { kind: 'near' as const, km: Math.sqrt(best), bearing: (Math.atan2(bx - hx, hy - by) * 180) / Math.PI };
}

export function RadarScreen({ cfg }: { cfg: AppConfig }) {
  const [frames, setFrames] = useState<number[]>([]);
  const [index, setIndex] = useState(-1); // which frame is on screen
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(0); // how many of `frames` have their grid
  const [error, setError] = useState<string | null>(null);
  const [shownGrid, setShownGrid] = useState<Uint8Array | null>(null);

  const grids = useRef(new Map<number, Uint8Array>());
  const map = useRef<GridMapApi | null>(null);
  const canvasA = useRef<HTMLCanvasElement>(null);
  const canvasB = useRef<HTMLCanvasElement>(null);
  const front = useRef<'a' | 'b'>('a');
  const native = useRef<HTMLCanvasElement | null>(null);
  const state = useRef({ frames, index, playing });
  state.current = { frames, index, playing };

  const publicLocation = cfg.station.publicLocation;
  const markerPx = useMemo(
    () => (publicLocation ? lonLatToRadolanPixel(publicLocation.lon, publicLocation.lat) : null),
    [publicLocation]
  );

  // Home view: centered on the public location if set (~260 km window), else the whole grid.
  const home = useMemo<View>(() => (markerPx ? { x: markerPx[0] - 130, y: markerPx[1] - 130, w: 260 } : { x: 0, y: 0, w: GRID }), [markerPx]);

  // ---- drawing ----
  // Colours one grid into a canvas: at native 900x900 through the lookup
  // table, then scaled up once with smoothing.
  function paint(canvas: HTMLCanvasElement, grid: Uint8Array) {
    if (!native.current) { native.current = document.createElement('canvas'); native.current.width = GRID; native.current.height = GRID; }
    const nctx = native.current.getContext('2d'), ctx = canvas.getContext('2d');
    if (!nctx || !ctx) return;
    const img = nctx.createImageData(GRID, GRID);
    const px = new Uint32Array(img.data.buffer);
    for (let i = 0; i < grid.length; i++) px[i] = LUT32[grid[i]]; // class 0 (no rain) stays transparent
    nctx.putImageData(img, 0, 0);
    if (canvas.width !== GRID * UPSCALE) { canvas.width = GRID * UPSCALE; canvas.height = GRID * UPSCALE; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(native.current, 0, 0, canvas.width, canvas.height);
  }

  // Puts a frame on screen. With `fade`, the new frame is drawn on the hidden
  // canvas and faded in over the old one (which stays fully visible beneath,
  // so the rain never dims mid-change); without, it replaces it at once.
  function show(grid: Uint8Array, fade: boolean) {
    const a = canvasA.current, b = canvasB.current;
    if (!a || !b) return;
    const [top, under] = front.current === 'a' ? [b, a] : [a, b];
    if (!fade || prefersReducedMotion()) {
      paint(under, grid);
      under.style.transition = 'none'; under.style.opacity = '1';
      top.style.transition = 'none'; top.style.opacity = '0';
    } else {
      top.style.transition = 'none'; top.style.opacity = '0'; top.style.zIndex = '2'; under.style.zIndex = '1';
      paint(top, grid);
      void top.offsetWidth; // commit opacity 0 before the fade starts
      top.style.transition = ''; top.style.opacity = '1';
      front.current = front.current === 'a' ? 'b' : 'a';
    }
    setShownGrid(grid);
  }

  // ---- data ----
  async function fetchGrid(ts: number) {
    if (grids.current.has(ts)) return grids.current.get(ts)!;
    const res = await fetch(`/api/radar/grid?t=${ts}`);
    if (!res.ok) throw new Error(res.statusText);
    const grid = new Uint8Array(await res.arrayBuffer());
    grids.current.set(ts, grid);
    return grid;
  }

  async function refresh() {
    try {
      const res = await fetch('/api/radar', { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      const meta: RadarMeta = await res.json();
      const list = meta.frames?.length ? meta.frames : [meta.timestamp];
      const prev = state.current;
      const wasLatest = prev.index < 0 || prev.index >= prev.frames.length - 1;
      const shownTs = prev.frames[prev.index];
      // The newest frame first: that is what the screen opens on.
      const newest = await fetchGrid(list[list.length - 1]);
      for (const ts of [...grids.current.keys()]) if (!list.includes(ts)) grids.current.delete(ts);
      setFrames(list);
      setError(null);
      if (wasLatest && !prev.playing) {
        setIndex(list.length - 1);
        if (shownTs !== list[list.length - 1]) show(newest, shownTs != null);
      } else {
        setIndex(Math.max(0, list.indexOf(shownTs))); // keep showing the same moment
      }
      // Then the rest of the loop, newest to oldest, a few at a time.
      const missing = list.filter(ts => !grids.current.has(ts)).reverse();
      setLoaded(list.length - missing.length);
      await Promise.all([0, 1, 2].map(async () => {
        for (let ts = missing.shift(); ts != null; ts = missing.shift()) {
          await fetchGrid(ts).catch(() => { /* a frame that fails to load is skipped during playback */ });
          setLoaded(n => n + 1);
        }
      }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- playback ----
  const goTo = (i: number, fade: boolean) => {
    const grid = grids.current.get(frames[i]);
    if (!grid) return false;
    setIndex(i);
    show(grid, fade);
    return true;
  };

  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const last = frames.length - 1;
    const id = setTimeout(() => {
      // step to the next frame that has loaded, wrapping from newest to oldest
      for (let step = 1; step <= frames.length; step++) {
        if (goTo((index + step) % frames.length, true)) return;
      }
    }, index === last ? HOLD_MS : FRAME_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index, frames, loaded]);

  const last = frames.length - 1;
  const shownTs = frames[index];
  const minutesAgo = shownTs != null && last >= 0 ? Math.round((frames[last] - shownTs) / 60000) : 0;
  const local = useMemo(() => (shownGrid && markerPx ? localRain(shownGrid, markerPx) : null), [shownGrid, markerPx]);
  const ready = shownGrid != null;

  return (
    <div className="stack">
      <section className="card lg stack">
        <div className="eyebrow">
          <span>{t('radar.title')}</span>
          <span>{shownTs != null ? (index === last ? t('radar.asOf', { time: hhmm(shownTs) }) : t('radar.past', { time: hhmm(shownTs), min: minutesAgo })) : ''}</span>
        </div>

        {error && <div className="note">{t('radar.error', { error })}</div>}

        <div className="radar">
          <GridMap
            home={home}
            apiRef={map}
            under={<>
              <canvas ref={canvasA} className="radar-rain" style={{ opacity: ready ? 1 : 0 }} />
              <canvas ref={canvasB} className="radar-rain" style={{ opacity: 0 }} />
            </>}
            lines={markerPx && RINGS_KM.map(km => <circle key={km} className="radar-ring" cx={markerPx[0]} cy={markerPx[1]} r={km} />)}
            overlay={!ready && !error && <div className="radar-loading">{t('radar.loading')}</div>}
          >
            {markerPx && RINGS_KM.map(km => (
              <div key={km} className="radar-ring-label" style={{ left: pct(markerPx[0]), top: pct(markerPx[1] - km) }} aria-hidden="true">
                <span>{km}{NBSP}km</span>
              </div>
            ))}
            {markerPx && <div className="radar-home" style={{ left: pct(markerPx[0]), top: pct(markerPx[1]) }} aria-hidden="true"><i /></div>}
          </GridMap>

          {/* time: play the last two hours as a loop, or drag to any frame */}
          <div className="radar-time">
            <button
              type="button" className="radar-play" disabled={frames.length < 2}
              aria-label={playing ? t('radar.pause') : t('radar.play')}
              onClick={() => { if (!playing && index === last) goTo(0, false); setPlaying(p => !p); }}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                {playing ? <path d="M4 3h3v10H4zM9 3h3v10H9z" /> : <path d="M4.5 2.5v11l9-5.5z" />}
              </svg>
            </button>
            <input
              type="range" className="radar-scrub" min={0} max={Math.max(0, last)} step={1} value={Math.max(0, index)}
              disabled={frames.length < 2}
              style={{ '--loaded': `${frames.length ? (loaded / frames.length) * 100 : 0}%` } as CSSProperties}
              aria-label={t('radar.timeAria')}
              aria-valuetext={shownTs != null ? hhmm(shownTs) : undefined}
              onChange={e => { setPlaying(false); goTo(Number(e.target.value), false); }}
            />
            <span className="radar-clock">{shownTs != null ? hhmm(shownTs) : '—'}</span>
          </div>

          {local && (
            <div className="radar-local">
              <span className="k">{t('radar.atLocation')}</span>
              <span className="v">
                {local.kind === 'rain' && t('radar.localRain', { rate: fmt(local.mmh, 1) })}
                {local.kind === 'near' && t('radar.localNear', { km: fmt(local.km, 0), dir: compass(local.bearing) })}
                {local.kind === 'dry' && t('radar.localDry')}
                {local.kind === 'outside' && t('radar.localOutside')}
              </span>
            </div>
          )}

          <div className="radar-foot">
            <div className="radar-legend">
              <div className="radar-legend-bar" style={{ background: LEGEND_GRADIENT }} />
              <div className="radar-legend-ticks">
                {LEGEND_TICKS.map(mmh => <span key={mmh} style={{ left: `${rampPosition(mmh) * 100}%` }}>{fmt(mmh, 0)}</span>)}
              </div>
              <div className="radar-legend-unit">{t('radar.legendUnit')}</div>
            </div>
            <button type="button" className="btn-ghost" onClick={() => map.current?.pz.set(home, true)}>{t('radar.resetView')}</button>
          </div>
          <div className="note">{t('radar.sourceNote', { key: zoomKey() })}</div>
        </div>
      </section>
    </div>
  );
}
