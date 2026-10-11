import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { type AppConfig, NBSP, compass, fmt, hhmm } from '../lib';
import { LANG, t } from '../i18n';
import { GestureHint, useGestureHint, zoomKey } from '../components/GestureHint';
import { lonLatToRadolanPixel } from '../radolanProjection';
import { createPanZoom, type View } from '../panZoom';
import { prefersReducedMotion } from '../spring';

interface RadarMeta { width: number; height: number; timestamp: number; frames: number[] }
// public/radar-map.json — SVG path data already in RADOLAN grid coordinates,
// built by scripts/build-radar-map.mjs from Natural Earth.
interface BaseMap { land: string; germany: string; states: string; rivers: string; streams: string; lakes: string }

const GRID = 900; // RADOLAN RY native grid size, both axes, 1 px = 1 km
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

// Orientation: a hand-picked set of places in three tiers — the first is
// always labelled, the others appear as the map is zoomed in and there is
// room for them. [German name, English name, lon, lat, tier]
const CITIES: [string, string, number, number, 1 | 2 | 3][] = [
  ['Berlin', 'Berlin', 13.405, 52.52, 1], ['Hamburg', 'Hamburg', 9.993, 53.551, 1], ['München', 'Munich', 11.582, 48.135, 1],
  ['Köln', 'Cologne', 6.96, 50.938, 1], ['Frankfurt', 'Frankfurt', 8.682, 50.111, 1], ['Stuttgart', 'Stuttgart', 9.183, 48.776, 1],
  ['Leipzig', 'Leipzig', 12.373, 51.34, 1], ['Hannover', 'Hanover', 9.732, 52.376, 1], ['Nürnberg', 'Nuremberg', 11.077, 49.452, 1],
  ['Bremen', 'Bremen', 8.807, 53.079, 2], ['Dresden', 'Dresden', 13.737, 51.05, 2], ['Dortmund', 'Dortmund', 7.466, 51.514, 2],
  ['Kiel', 'Kiel', 10.123, 54.323, 2], ['Rostock', 'Rostock', 12.099, 54.092, 2], ['Erfurt', 'Erfurt', 11.029, 50.985, 2],
  ['Kassel', 'Kassel', 9.48, 51.313, 2], ['Saarbrücken', 'Saarbrücken', 6.997, 49.24, 2], ['Freiburg', 'Freiburg', 7.842, 47.999, 2],
  ['Münster', 'Münster', 7.626, 51.96, 2], ['Magdeburg', 'Magdeburg', 11.628, 52.121, 2], ['Würzburg', 'Würzburg', 9.953, 49.791, 2],
  ['Regensburg', 'Regensburg', 12.102, 49.013, 2], ['Karlsruhe', 'Karlsruhe', 8.404, 49.007, 2],
  ['Amsterdam', 'Amsterdam', 4.9, 52.372, 2], ['Brüssel', 'Brussels', 4.352, 50.847, 2], ['Zürich', 'Zurich', 8.541, 47.377, 2],
  ['Prag', 'Prague', 14.438, 50.076, 2], ['Straßburg', 'Strasbourg', 7.752, 48.573, 2], ['Stettin', 'Szczecin', 14.553, 53.428, 2],
  ['Düsseldorf', 'Düsseldorf', 6.773, 51.228, 3], ['Essen', 'Essen', 7.012, 51.455, 3], ['Bielefeld', 'Bielefeld', 8.532, 52.021, 3],
  ['Osnabrück', 'Osnabrück', 8.047, 52.28, 3], ['Oldenburg', 'Oldenburg', 8.214, 53.144, 3], ['Lübeck', 'Lübeck', 10.687, 53.866, 3],
  ['Flensburg', 'Flensburg', 9.437, 54.794, 3], ['Schwerin', 'Schwerin', 11.415, 53.629, 3], ['Potsdam', 'Potsdam', 13.064, 52.39, 3],
  ['Cottbus', 'Cottbus', 14.334, 51.757, 3], ['Chemnitz', 'Chemnitz', 12.921, 50.833, 3], ['Halle', 'Halle', 11.97, 51.483, 3],
  ['Göttingen', 'Göttingen', 9.935, 51.533, 3], ['Braunschweig', 'Brunswick', 10.522, 52.269, 3], ['Bonn', 'Bonn', 7.099, 50.735, 3],
  ['Aachen', 'Aachen', 6.084, 50.776, 3], ['Koblenz', 'Koblenz', 7.594, 50.357, 3], ['Trier', 'Trier', 6.641, 49.757, 3],
  ['Mainz', 'Mainz', 8.247, 50.0, 3], ['Mannheim', 'Mannheim', 8.466, 49.488, 3], ['Heilbronn', 'Heilbronn', 9.218, 49.142, 3],
  ['Ulm', 'Ulm', 9.993, 48.401, 3], ['Augsburg', 'Augsburg', 10.898, 48.371, 3], ['Ingolstadt', 'Ingolstadt', 11.426, 48.766, 3],
  ['Passau', 'Passau', 13.432, 48.567, 3], ['Bayreuth', 'Bayreuth', 11.578, 49.946, 3], ['Konstanz', 'Constance', 9.175, 47.678, 3],
  ['Kempten', 'Kempten', 10.317, 47.726, 3], ['Rosenheim', 'Rosenheim', 12.128, 47.856, 3], ['Fulda', 'Fulda', 9.675, 50.555, 3],
  ['Siegen', 'Siegen', 8.024, 50.875, 3], ['Paderborn', 'Paderborn', 8.754, 51.719, 3], ['Bremerhaven', 'Bremerhaven', 8.577, 53.55, 3],
  ['Stralsund', 'Stralsund', 13.09, 54.309, 3], ['Luxemburg', 'Luxembourg', 6.13, 49.611, 3], ['Basel', 'Basel', 7.588, 47.56, 3],
  ['Salzburg', 'Salzburg', 13.045, 47.811, 3], ['Innsbruck', 'Innsbruck', 11.394, 47.269, 3], ['Lüttich', 'Liège', 5.571, 50.633, 3],
];
const CITY_PX = CITIES.map(([de, en, lon, lat, tier]) => ({ de, en, tier, px: lonLatToRadolanPixel(lon, lat) }))
  .filter(c => c.px[0] > 8 && c.px[0] < GRID - 8 && c.px[1] > 8 && c.px[1] < GRID - 8);
const RINGS_KM = [25, 50, 100]; // distance rings around the home marker; 1 grid px = 1 km
const pct = (gridPx: number) => `${(gridPx / GRID) * 100}%`;

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

function useBaseMap() {
  const [map, setMap] = useState<BaseMap | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/radar-map.json').then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setMap(j); }).catch(() => { /* the radar still works without a base map */ });
    return () => { alive = false; };
  }, []);
  return map;
}

export function RadarScreen({ cfg }: { cfg: AppConfig }) {
  const base = useBaseMap();
  const [frames, setFrames] = useState<number[]>([]);
  const [index, setIndex] = useState(-1); // which frame is on screen
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(0); // how many of `frames` have their grid
  const [error, setError] = useState<string | null>(null);
  const [shownGrid, setShownGrid] = useState<Uint8Array | null>(null);
  const [hint, showHint] = useGestureHint();

  const grids = useRef(new Map<number, Uint8Array>());
  const frameRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const canvasA = useRef<HTMLCanvasElement>(null);
  const canvasB = useRef<HTMLCanvasElement>(null);
  const front = useRef<'a' | 'b'>('a');
  const native = useRef<HTMLCanvasElement | null>(null);
  const frameWidth = useRef(0);
  const state = useRef({ frames, index, playing });
  state.current = { frames, index, playing };

  const publicLocation = cfg.station.publicLocation;
  const markerPx = useMemo(
    () => (publicLocation ? lonLatToRadolanPixel(publicLocation.lon, publicLocation.lat) : null),
    [publicLocation]
  );

  // Pan/zoom lives outside React state (see panZoom.ts): the view is written
  // straight to the map layer as a transform, so dragging never re-renders.
  // Everything on the map — base map, rain, rings, labels — sits in that one
  // layer. Labels counter-scale through --inv (1 / zoom) and line widths
  // through --u (grid units per screen pixel), so both keep their on-screen
  // size at every zoom level and frame size.
  const pz = useMemo(() => createPanZoom({
    contentW: GRID, contentH: GRID, minW: 40,
    onHint: showHint,
    apply: (v: View) => {
      const layer = layerRef.current;
      if (!layer) return;
      const scale = GRID / v.w;
      layer.style.transform = `translate(${(-v.x / v.w) * 100}%, ${(-v.y / v.w) * 100}%) scale(${scale})`;
      layer.style.setProperty('--inv', String(1 / scale));
      layer.style.setProperty('--u', String(GRID / (frameWidth.current || GRID) / scale));
      const zoom = scale >= 3.2 ? 'close' : scale >= 1.7 ? 'near' : 'far';
      if (layer.dataset.zoom !== zoom) layer.dataset.zoom = zoom;
    },
  }), [showHint]);

  const attachFrame = useMemo(() => {
    let observer: ResizeObserver | null = null;
    return (node: HTMLDivElement | null) => {
      observer?.disconnect();
      frameRef.current = node;
      pz.attach(node);
      if (!node) return;
      observer = new ResizeObserver(() => { frameWidth.current = node.clientWidth; pz.set(pz.get()); });
      observer.observe(node);
      frameWidth.current = node.clientWidth;
    };
  }, [pz]);

  // Home view: centered on the public location if set (~260 km window), else the whole grid.
  const homeView = (): View => (markerPx ? { x: markerPx[0] - 130, y: markerPx[1] - 130, w: 260 } : { x: 0, y: 0, w: GRID });
  useEffect(() => {
    pz.set(homeView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerPx]);

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
          <div
            ref={attachFrame}
            className="radar-frame"
            onPointerDown={pz.onPointerDown}
            onPointerMove={pz.onPointerMove}
            onPointerUp={pz.onPointerUp}
            onPointerCancel={pz.onPointerUp}
          >
            <div ref={layerRef} className="radar-layer" data-zoom="far">
              {base && (
                <svg className="radar-svg radar-base" viewBox={`0 0 ${GRID} ${GRID}`} aria-hidden="true">
                  <path className="map-land" d={base.land} />
                  <path className="map-germany" d={base.germany} />
                  <path className="map-stream" d={base.streams} />
                  <path className="map-river" d={base.rivers} />
                  <path className="map-lake" d={base.lakes} />
                  <path className="map-state" d={base.states} />
                </svg>
              )}
              <canvas ref={canvasA} className="radar-rain" style={{ opacity: ready ? 1 : 0 }} />
              <canvas ref={canvasB} className="radar-rain" style={{ opacity: 0 }} />
              <svg className="radar-svg" viewBox={`0 0 ${GRID} ${GRID}`} aria-hidden="true">
                {/* the national border again, above the rain, so it stays readable under a shower */}
                {base && <path className="map-outline" d={base.germany} />}
                {markerPx && RINGS_KM.map(km => <circle key={km} className="radar-ring" cx={markerPx[0]} cy={markerPx[1]} r={km} />)}
              </svg>
              {CITY_PX.map(c => (
                <div key={c.de} className={'radar-city tier' + c.tier} style={{ left: pct(c.px[0]), top: pct(c.px[1]) }} aria-hidden="true">
                  <i /><span>{LANG === 'de' ? c.de : c.en}</span>
                </div>
              ))}
              {markerPx && RINGS_KM.map(km => (
                <div key={km} className="radar-ring-label" style={{ left: pct(markerPx[0]), top: pct(markerPx[1] - km) }} aria-hidden="true">
                  <span>{km}{NBSP}km</span>
                </div>
              ))}
              {markerPx && <div className="radar-home" style={{ left: pct(markerPx[0]), top: pct(markerPx[1]) }} aria-hidden="true"><i /></div>}
            </div>

            {!ready && !error && <div className="radar-loading">{t('radar.loading')}</div>}
            <GestureHint hint={hint} />
            <div className="radar-zoom">
              <button type="button" aria-label={t('radar.zoomIn')} onClick={() => pz.zoomBy(1 / 1.6)}>+</button>
              <button type="button" aria-label={t('radar.zoomOut')} onClick={() => pz.zoomBy(1.6)}>−</button>
            </div>
          </div>

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
            <button type="button" className="btn-ghost" onClick={() => pz.set(homeView(), true)}>{t('radar.resetView')}</button>
          </div>
          <div className="note">{t('radar.sourceNote', { key: zoomKey() })}</div>
        </div>
      </section>
    </div>
  );
}
