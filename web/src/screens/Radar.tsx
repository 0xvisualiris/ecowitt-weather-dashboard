import { useEffect, useMemo, useRef, useState } from 'react';
import { type AppConfig, hhmm } from '../lib';
import { t } from '../i18n';
import { useGermanyOutline } from '../components/germanyOutline';
import { lonLatToRadolanPixel } from '../radolanProjection';
import { createPanZoom, type View } from '../panZoom';

interface RadarMeta { width: number; height: number; timestamp: number }

// Intensity class (1-254, see radolan.js) -> rain-rate color, loosely
// following the conventional radar palette (light blue through green/
// yellow/orange to red/magenta for increasing intensity) rather than this
// app's usual amber/blue accents, since a rain radar is expected to read as
// one at a glance.
const STOPS: [number, [number, number, number]][] = [
  [0, [120, 170, 255]],
  [40, [70, 190, 255]],
  [90, [80, 220, 150]],
  [140, [230, 220, 70]],
  [190, [240, 150, 40]],
  [254, [220, 40, 90]],
];
function intensityColor(v: number): [number, number, number] {
  for (let i = 1; i < STOPS.length; i++) {
    const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
    if (v <= b) {
      const f = (v - a) / (b - a || 1);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

const GRID = 900; // RADOLAN RY native grid size, both axes, 1 px = 1 km
const REFRESH_MS = 5 * 60 * 1000; // matches the product's own update cadence

export function RadarScreen({ cfg }: { cfg: AppConfig }) {
  const { data: geo } = useGermanyOutline();
  const [meta, setMeta] = useState<RadarMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const markerRef = useRef<HTMLDivElement>(null);

  const publicLocation = cfg.station.publicLocation;
  const markerPx = useMemo(
    () => (publicLocation ? lonLatToRadolanPixel(publicLocation.lon, publicLocation.lat) : null),
    [publicLocation]
  );
  const markerPxRef = useRef(markerPx);
  markerPxRef.current = markerPx;

  // Pan/zoom lives outside React state (see panZoom.ts): the view is written
  // straight to the canvas as a transform, so dragging never re-renders.
  const pz = useMemo(() => createPanZoom({
    contentW: GRID, contentH: GRID, minW: 40,
    apply: (v: View) => {
      const canvas = canvasRef.current;
      if (canvas) canvas.style.transform = `translate(${(-v.x / v.w) * 100}%, ${(-v.y / v.w) * 100}%) scale(${GRID / v.w})`;
      const marker = markerRef.current, m = markerPxRef.current;
      if (marker && m) marker.style.transform = `translate(${((m[0] - v.x) / v.w) * 100}%, ${((m[1] - v.y) / v.w) * 100}%)`;
    },
  }), []);

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
      const buf = new Uint8Array(await gridRes.arrayBuffer());
      setMeta(m);
      setError(null);
      draw(buf);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function draw(grid: Uint8Array) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = GRID; canvas.height = GRID;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(GRID, GRID);
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      const o = i * 4;
      if (v === 255 || v === 0) { img.data[o + 3] = 0; continue; } // no data / no rain: transparent
      const [r, g, b] = intensityColor(v);
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 230;
    }
    ctx.putImageData(img, 0, 0);

    if (geo) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      geo.outline.forEach(([lon, lat], i) => {
        const [x, y] = lonLatToRadolanPixel(lon, lat);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo]);

  return (
    <div className="stack">
      <section className="card lg stack">
        <div className="eyebrow">
          <span>{t('radar.title')}</span>
          <span>{meta ? t('radar.asOf', { time: hhmm(meta.timestamp) }) : ''}</span>
        </div>

        {error && <div className="note">{t('radar.error', { error })}</div>}

        <div
          ref={pz.attach}
          style={{ position: 'relative', overflow: 'hidden', borderRadius: 16, aspectRatio: '1 / 1', background: 'oklch(0 0 0 / 0.25)', touchAction: 'none', cursor: 'grab' }}
          onPointerDown={pz.onPointerDown}
          onPointerMove={pz.onPointerMove}
          onPointerUp={pz.onPointerUp}
          onPointerCancel={pz.onPointerUp}
        >
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', transformOrigin: '0 0', imageRendering: 'pixelated',
              opacity: meta ? 1 : 0, transition: 'opacity 200ms var(--ease-out)',
            }}
          />
          {/* The marker sits at the top-left corner of a container-sized layer,
              so the layer's percentage translate places it without layout. */}
          {markerPx && (
            <div ref={markerRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <div
                style={{
                  width: 14, height: 14, marginLeft: -7, marginTop: -7,
                  borderRadius: '50%',
                  background: 'oklch(0.8 0.13 70)',
                  border: '2px solid rgba(255,255,255,0.8)',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
                }}
              />
            </div>
          )}
          {!meta && !error && <div className="center-msg" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{t('radar.loading')}</div>}
        </div>

        <div className="row" style={{ border: 0, padding: 0, justifyContent: 'space-between' }}>
          <div className="axis" style={{ gap: 10 }}>
            <span>{t('radar.legendLight')}</span>
            <span style={{ background: 'linear-gradient(90deg, rgb(120,170,255), rgb(70,190,255), rgb(80,220,150), rgb(230,220,70), rgb(240,150,40), rgb(220,40,90))', width: 120, height: 8, borderRadius: 4, display: 'inline-block' }} />
            <span>{t('radar.legendHeavy')}</span>
          </div>
          <button type="button" className="btn-ghost" onClick={() => pz.set(homeView(), true)}>{t('radar.resetView')}</button>
        </div>
        <div className="note">{t('radar.sourceNote')}</div>
      </section>
    </div>
  );
}
