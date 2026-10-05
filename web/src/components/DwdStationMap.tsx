import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { useGermanyOutline, makeOutlineProjection } from './germanyOutline';

/// A hand-rolled SVG map (no mapping library, no external tiles — same
/// "dependency-light, hand-drawn SVG" convention as Chart.tsx/ConditionIcon)
/// for picking a DWD MOSMIX station visually instead of typing its ID.
/// Station list + simplified border baked into public/dwd-stations.json at
/// build time from DWD's own station catalogue (numeric-ID stations only —
/// those are the real synoptic network MOSMIX_L actually covers — within a
/// Central European bounding box), fetched lazily only when the picker opens.
export function DwdStationMap({ value, onSelect }: { value: string; onSelect: (id: string, name: string) => void }) {
  const { data, error } = useGermanyOutline();
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const dragRef = useRef<{ startX: number; startY: number; viewX: number; viewY: number; moved: boolean } | null>(null);

  const proj = useMemo(() => (data ? makeOutlineProjection(data) : null), [data]);

  // view = visible viewBox rectangle, in the projection's own coordinate
  // space (so panning/zooming is just moving/scaling this rectangle — the
  // map is plain SVG, so it stays crisp at any zoom level, no raster involved).
  const [view, setView] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    if (proj) setView({ x: 0, y: 0, w: proj.width, h: proj.height });
  }, [proj]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!data || !q) return null;
    return data.stations.filter(s => s.name.toLowerCase().includes(q) || s.id.includes(q)).slice(0, 40);
  }, [data, q]);
  const matchIds = useMemo(() => (matches ? new Set(matches.map(s => s.id)) : null), [matches]);

  if (error) return <div className="note">{t('admin.dwdMapError', { error })}</div>;
  if (!data || !proj || !view) return <div className="note">{t('admin.dwdMapLoading')}</div>;
  const { project, width, height } = proj;

  const selected = data.stations.find(s => s.id === value) || null;

  const clampView = (v: { x: number; y: number; w: number; h: number }) => {
    const w = Math.max(width / 10, Math.min(width, v.w));
    const h = w * (height / width);
    const x = Math.max(0, Math.min(width - w, v.x));
    const y = Math.max(0, Math.min(height - h, v.y));
    return { x, y, w, h };
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height;
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const cx = view.x + fx * view.w, cy = view.y + fy * view.h;
    const w = view.w * factor, h = view.h * factor;
    setView(clampView({ x: cx - fx * w, y: cy - fy * h, w, h }));
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const sdx = e.clientX - dragRef.current.startX, sdy = e.clientY - dragRef.current.startY;
    if (Math.abs(sdx) > 3 || Math.abs(sdy) > 3) dragRef.current.moved = true;
    const dx = (sdx / rect.width) * view.w, dy = (sdy / rect.height) * view.h;
    setView(clampView({ x: dragRef.current.viewX - dx, y: dragRef.current.viewY - dy, w: view.w, h: view.h }));
  };
  const onPointerUp = () => { dragRef.current = null; };
  const resetView = () => setView({ x: 0, y: 0, w: width, h: height });

  const selectStation = (s: { id: string; name: string }) => {
    if (dragRef.current?.moved) return; // ignore the click that ends a drag
    onSelect(s.id, s.name);
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <input
        className="input" value={query} onChange={e => setQuery(e.target.value)}
        placeholder={t('admin.dwdMapSearch')}
      />
      <div className="note">{t('admin.dwdMapHint')}</div>

      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: 'oklch(0 0 0 / 0.18)' }}>
        <svg
          ref={svgRef}
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          style={{ width: '100%', maxHeight: 480, display: 'block', touchAction: 'none', cursor: 'grab' }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <path
            d={'M' + data.outline.map(([lon, lat]) => project(lon, lat).join(',')).join('L') + 'Z'}
            fill="oklch(1 0 0 / 0.05)" stroke="oklch(1 0 0 / 0.22)" strokeWidth={1.5}
          />
          {data.stations.map(s => {
            const [x, y] = project(s.lon, s.lat);
            const isSelected = s.id === value;
            const dimmed = matchIds ? !matchIds.has(s.id) : false;
            return (
              <g key={s.id} opacity={dimmed ? 0.18 : 1}>
                {/* invisible larger hit target, visible dot stays small */}
                <circle cx={x} cy={y} r={8} fill="transparent" style={{ cursor: 'pointer' }}
                  onClick={() => selectStation(s)}
                  onMouseEnter={() => setHover({ id: s.id, name: s.name, x, y })}
                  onMouseLeave={() => setHover(h => (h?.id === s.id ? null : h))} />
                <circle cx={x} cy={y} r={isSelected ? 6 : 3} fill={isSelected ? 'var(--amber)' : 'var(--blue)'}
                  stroke={isSelected ? 'oklch(1 0 0 / 0.6)' : 'none'} strokeWidth={2} pointerEvents="none" />
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="tip" style={{ left: `${((hover.x - view.x) / view.w) * 100}%`, top: `${((hover.y - view.y) / view.h) * 100}%`, transform: 'translate(-50%, -130%)' }}>
            <span className="tv">{hover.name}</span>
            <span className="tt">{hover.id}</span>
          </div>
        )}
        {(view.w < width) && (
          <button type="button" className="btn-ghost" style={{ position: 'absolute', right: 10, bottom: 10 }} onClick={resetView}>
            {t('admin.dwdMapResetView')}
          </button>
        )}
      </div>

      {selected && <div className="note">{t('admin.dwdMapSelected', { name: selected.name, id: selected.id })}</div>}

      {matches && (
        <div className="stack" style={{ gap: 0, maxHeight: 220, overflowY: 'auto' }}>
          {matches.length === 0 && <div className="note">{t('admin.dwdMapNoMatch')}</div>}
          {matches.map(s => (
            <button key={s.id} type="button" className="row" style={{ cursor: 'pointer', background: 'transparent', border: 0, textAlign: 'left', width: '100%', font: 'inherit', color: 'inherit' }}
              onClick={() => onSelect(s.id, s.name)}>
              <span className="k">{s.name}</span>
              <span className="v">{s.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
