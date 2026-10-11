import { useEffect, useMemo, useRef, useState } from 'react';
import { type AppConfig, NBSP, fmt, hhmm } from '../lib';
import { LANG, t } from '../i18n';
import { useGermanyOutline } from '../components/germanyOutline';
import { GestureHint, useGestureHint, zoomKey } from '../components/GestureHint';
import { lonLatToRadolanPixel } from '../radolanProjection';
import { createPanZoom, type View } from '../panZoom';

interface RadarMeta { width: number; height: number; timestamp: number }

const GRID = 900; // RADOLAN RY native grid size, both axes, 1 px = 1 km
const REFRESH_MS = 5 * 60 * 1000; // matches the product's own update cadence
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
LUT.set([4, 6, 12, 150], 255 * 4);

const LEGEND_GRADIENT = `linear-gradient(90deg, ${STOPS.map(([mmh, c]) => `rgb(${c[0]} ${c[1]} ${c[2]}) ${(rampPosition(mmh) * 100).toFixed(1)}%`).join(', ')})`;
const LEGEND_TICKS = [1, 3, 10, 30, 100];

// Orientation: a hand-picked set of cities, in two tiers — the first is
// always labelled, the second only once zoomed in far enough to have room.
// [German name, English name, lon, lat, tier]
const CITIES: [string, string, number, number, 1 | 2][] = [
  ['Berlin', 'Berlin', 13.405, 52.52, 1], ['Hamburg', 'Hamburg', 9.993, 53.551, 1], ['München', 'Munich', 11.582, 48.135, 1],
  ['Köln', 'Cologne', 6.96, 50.938, 1], ['Frankfurt', 'Frankfurt', 8.682, 50.111, 1], ['Stuttgart', 'Stuttgart', 9.183, 48.776, 1],
  ['Leipzig', 'Leipzig', 12.373, 51.34, 1], ['Hannover', 'Hanover', 9.732, 52.376, 1], ['Nürnberg', 'Nuremberg', 11.077, 49.452, 1],
  ['Bremen', 'Bremen', 8.807, 53.079, 2], ['Dresden', 'Dresden', 13.737, 51.05, 2], ['Dortmund', 'Dortmund', 7.466, 51.514, 2],
  ['Düsseldorf', 'Düsseldorf', 6.773, 51.228, 2], ['Kiel', 'Kiel', 10.123, 54.323, 2], ['Rostock', 'Rostock', 12.099, 54.092, 2],
  ['Erfurt', 'Erfurt', 11.029, 50.985, 2], ['Kassel', 'Kassel', 9.48, 51.313, 2], ['Saarbrücken', 'Saarbrücken', 6.997, 49.24, 2],
  ['Freiburg', 'Freiburg', 7.842, 47.999, 2], ['Münster', 'Münster', 7.626, 51.96, 2], ['Magdeburg', 'Magdeburg', 11.628, 52.121, 2],
  ['Würzburg', 'Würzburg', 9.953, 49.791, 2], ['Regensburg', 'Regensburg', 12.102, 49.013, 2], ['Karlsruhe', 'Karlsruhe', 8.404, 49.007, 2],
];
const CITY_PX = CITIES.map(([de, en, lon, lat, tier]) => ({ de, en, tier, px: lonLatToRadolanPixel(lon, lat) }));
const RINGS_KM = [25, 50, 100]; // distance rings around the home marker; 1 grid px = 1 km
const pct = (gridPx: number) => `${(gridPx / GRID) * 100}%`;

export function RadarScreen({ cfg }: { cfg: AppConfig }) {
  const { data: geo } = useGermanyOutline();
  const [meta, setMeta] = useState<RadarMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, showHint] = useGestureHint();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);

  const publicLocation = cfg.station.publicLocation;
  const markerPx = useMemo(
    () => (publicLocation ? lonLatToRadolanPixel(publicLocation.lon, publicLocation.lat) : null),
    [publicLocation]
  );

  const outlinePath = useMemo(
    () => (geo ? 'M' + geo.outline.map(([lon, lat]) => lonLatToRadolanPixel(lon, lat).map(n => n.toFixed(1)).join(',')).join('L') + 'Z' : null),
    [geo]
  );

  // Pan/zoom lives outside React state (see panZoom.ts): the view is written
  // straight to the map layer as a transform, so dragging never re-renders.
  // Everything on the map — rain, border, rings, labels — sits in that one
  // layer; labels and line widths counter-scale through --inv so they keep
  // their on-screen size at every zoom level.
  const pz = useMemo(() => createPanZoom({
    contentW: GRID, contentH: GRID, minW: 40,
    onHint: showHint,
    apply: (v: View) => {
      const layer = layerRef.current;
      if (!layer) return;
      const scale = GRID / v.w;
      layer.style.transform = `translate(${(-v.x / v.w) * 100}%, ${(-v.y / v.w) * 100}%) scale(${scale})`;
      layer.style.setProperty('--inv', String(1 / scale));
      const zoom = scale >= 1.7 ? 'near' : 'far';
      if (layer.dataset.zoom !== zoom) layer.dataset.zoom = zoom;
    },
  }), [showHint]);

  // Home view: centered on the public location if set (~260 km window), else the whole grid.
  const homeView = (): View => (markerPx ? { x: markerPx[0] - 130, y: markerPx[1] - 130, w: 260 } : { x: 0, y: 0, w: GRID });
  useEffect(() => {
    pz.set(homeView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markerPx]);

  async function load() {
    try {
      const [metaRes, gridRes] = await Promise.all([
        fetch('/api/radar', { cache: 'no-store' }),
        fetch('/api/radar/grid', { cache: 'no-store' }),
      ]);
      if (!metaRes.ok) throw new Error((await metaRes.json().catch(() => ({}))).error || metaRes.statusText);
      if (!gridRes.ok) throw new Error(gridRes.statusText);
      const m: RadarMeta = await metaRes.json();
      draw(new Uint8Array(await gridRes.arrayBuffer()));
      setMeta(m);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function draw(grid: Uint8Array) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Colour the native 900x900 grid, then scale it up once with smoothing.
    const native = document.createElement('canvas');
    native.width = GRID; native.height = GRID;
    const nctx = native.getContext('2d');
    const ctx = canvas.getContext('2d');
    if (!nctx || !ctx) return;
    const img = nctx.createImageData(GRID, GRID);
    const px = new Uint32Array(img.data.buffer), lut = new Uint32Array(LUT.buffer);
    for (let i = 0; i < grid.length; i++) px[i] = lut[grid[i]]; // class 0 (no rain) stays transparent
    nctx.putImageData(img, 0, 0);
    canvas.width = GRID * UPSCALE; canvas.height = GRID * UPSCALE;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(native, 0, 0, canvas.width, canvas.height);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="stack">
      <section className="card lg stack">
        <div className="eyebrow">
          <span>{t('radar.title')}</span>
          <span>{meta ? t('radar.asOf', { time: hhmm(meta.timestamp) }) : ''}</span>
        </div>

        {error && <div className="note">{t('radar.error', { error })}</div>}

        <div className="radar">
          <div
            ref={pz.attach}
            className="radar-frame"
            onPointerDown={pz.onPointerDown}
            onPointerMove={pz.onPointerMove}
            onPointerUp={pz.onPointerUp}
            onPointerCancel={pz.onPointerUp}
          >
            <div ref={layerRef} className="radar-layer" data-zoom="far">
              <canvas ref={canvasRef} className="radar-rain" style={{ opacity: meta ? 1 : 0 }} />
              <svg className="radar-lines" viewBox={`0 0 ${GRID} ${GRID}`} aria-hidden="true">
                {outlinePath && <path className="radar-border" d={outlinePath} />}
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

            {!meta && !error && <div className="radar-loading">{t('radar.loading')}</div>}
            <GestureHint hint={hint} />
            <div className="radar-zoom">
              <button type="button" aria-label={t('radar.zoomIn')} onClick={() => pz.zoomBy(1 / 1.6)}>+</button>
              <button type="button" aria-label={t('radar.zoomOut')} onClick={() => pz.zoomBy(1.6)}>−</button>
            </div>
          </div>

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
