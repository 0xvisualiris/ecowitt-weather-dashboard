import { useEffect, useMemo, useRef, useState } from 'react';
import { type AppConfig, hhmm } from '../lib';
import { t } from '../i18n';
import { useGermanyOutline } from '../components/germanyOutline';
import { lonLatToRadolanPixel } from '../radolanProjection';

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
  const wrapRef = useRef<HTMLDivElement>(null);

  // view = visible window into the 900x900 grid, in source pixels (km)
  const [view, setView] = useState<{ x: number; y: number; w: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number } | null>(null);

  const publicLocation = cfg.station.publicLocation;
  const markerPx = useMemo(
    () => (publicLocation ? lonLatToRadolanPixel(publicLocation.lon, publicLocation.lat) : null),
    [publicLocation]
  );

  // Initial view: centered on the public location if set, else the whole grid.
  useEffect(() => {
    if (view) return;
    if (markerPx) {
      const w = 260; // ~260 km window
      setView({ x: markerPx[0] - w / 2, y: markerPx[1] - w / 2, w });
    } else {
      setView({ x: 0, y: 0, w: GRID });
    }
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

  // ---- pan & zoom ----
  const clampView = (v: { x: number; y: number; w: number }) => {
    const w = Math.max(40, Math.min(GRID, v.w));
    const x = Math.max(0, Math.min(GRID - w, v.x));
    const y = Math.max(0, Math.min(GRID - w, v.y));
    return { x, y, w };
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (!view) return;
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const rect = wrapRef.current!.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height;
    const cx = view.x + fx * view.w, cy = view.y + fy * view.w;
    const w = view.w * factor;
    setView(clampView({ x: cx - fx * w, y: cy - fy * w, w }));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!view) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !view) return;
    const rect = wrapRef.current!.getBoundingClientRect();
    const dx = ((e.clientX - dragRef.current.startX) / rect.width) * view.w;
    const dy = ((e.clientY - dragRef.current.startY) / rect.width) * view.w;
    setView(clampView({ x: dragRef.current.viewX - dx, y: dragRef.current.viewY - dy, w: view.w }));
  };
  const onPointerUp = () => { dragRef.current = null; };

  const resetView = () => {
    if (markerPx) setView(clampView({ x: markerPx[0] - 130, y: markerPx[1] - 130, w: 260 }));
    else setView({ x: 0, y: 0, w: GRID });
  };

  return (
    <div className="stack">
      <section className="card lg stack">
        <div className="eyebrow">
          <span>{t('radar.title')}</span>
          <span>{meta ? t('radar.asOf', { time: hhmm(meta.timestamp) }) : ''}</span>
        </div>

        {error && <div className="note">{t('radar.error', { error })}</div>}

        <div
          ref={wrapRef}
          style={{ position: 'relative', overflow: 'hidden', borderRadius: 16, aspectRatio: '1 / 1', background: 'oklch(0 0 0 / 0.25)', touchAction: 'none', cursor: 'grab' }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {view && (
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute', imageRendering: 'pixelated',
                width: `${(GRID / view.w) * 100}%`, height: `${(GRID / view.w) * 100}%`,
                left: `${(-view.x / view.w) * 100}%`, top: `${(-view.y / view.w) * 100}%`,
              }}
            />
          )}
          {view && markerPx && (
            <div
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: `${((markerPx[0] - view.x) / view.w) * 100}%`,
                top: `${((markerPx[1] - view.y) / view.w) * 100}%`,
                width: 14, height: 14, marginLeft: -7, marginTop: -7,
                borderRadius: '50%',
                background: 'oklch(0.8 0.13 70)',
                border: '2px solid rgba(255,255,255,0.8)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
                pointerEvents: 'none',
              }}
            />
          )}
          {!meta && !error && <div className="center-msg" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{t('radar.loading')}</div>}
        </div>

        <div className="row" style={{ border: 0, padding: 0, justifyContent: 'space-between' }}>
          <div className="axis" style={{ gap: 10 }}>
            <span>{t('radar.legendLight')}</span>
            <span style={{ background: 'linear-gradient(90deg, rgb(120,170,255), rgb(70,190,255), rgb(80,220,150), rgb(230,220,70), rgb(240,150,40), rgb(220,40,90))', width: 120, height: 8, borderRadius: 4, display: 'inline-block' }} />
            <span>{t('radar.legendHeavy')}</span>
          </div>
          <button type="button" className="btn-ghost" onClick={resetView}>{t('radar.resetView')}</button>
        </div>
        <div className="note">{t('radar.sourceNote')}</div>
      </section>
    </div>
  );
}
