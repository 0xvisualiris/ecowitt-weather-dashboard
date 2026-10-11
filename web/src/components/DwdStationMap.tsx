import { useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { useGermanyOutline, makeOutlineProjection } from './germanyOutline';
import { createPanZoom, type View } from '../panZoom';

/// A hand-rolled SVG map (no mapping library, no external tiles — same
/// "dependency-light, hand-drawn SVG" convention as Chart.tsx/ConditionIcon)
/// for picking a DWD MOSMIX station visually instead of typing its ID.
/// Station list + simplified border baked into public/dwd-stations.json at
/// build time from DWD's own station catalogue (numeric-ID stations only —
/// those are the real synoptic network MOSMIX_L actually covers — within a
/// Central European bounding box), fetched lazily only when the picker opens.
const viewTransform = (v: View, width: number) => `translate(${(-v.x / v.w) * 100}%, ${(-v.y / v.w) * 100}%) scale(${width / v.w})`;

export function DwdStationMap({ value, onSelect }: { value: string; onSelect: (id: string, name: string) => void }) {
  const { data, error } = useGermanyOutline();
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoomed, setZoomed] = useState(false);

  const proj = useMemo(() => (data ? makeOutlineProjection(data) : null), [data]);

  // Pan/zoom is a CSS transform on the SVG (see panZoom.ts), written straight
  // to the element: panning is then a pure compositor move instead of a new
  // viewBox that re-lays-out ~370 station dots every frame, and the browser
  // re-rasterises the vector at the new scale when zooming, so it stays crisp.
  const pz = useMemo(() => {
    if (!proj) return null;
    const { width, height } = proj;
    return createPanZoom({
      contentW: width, contentH: height, minW: width / 10,
      apply: (v: View) => {
        const svg = svgRef.current;
        if (svg) svg.style.transform = viewTransform(v, width);
        setZoomed(v.w < width - 0.5);
      },
    });
  }, [proj]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!data || !q) return null;
    return data.stations.filter(s => s.name.toLowerCase().includes(q) || s.id.includes(q)).slice(0, 40);
  }, [data, q]);
  const matchIds = useMemo(() => (matches ? new Set(matches.map(s => s.id)) : null), [matches]);

  if (error) return <div className="note">{t('admin.dwdMapError', { error })}</div>;
  if (!data || !proj || !pz) return <div className="note">{t('admin.dwdMapLoading')}</div>;
  const { project, width, height } = proj;
  const view = { ...pz.get(), h: pz.get().w * (height / width) };

  const selected = data.stations.find(s => s.id === value) || null;

  const selectStation = (s: { id: string; name: string }) => {
    if (pz.wasDrag()) return; // ignore the click that ends a drag
    onSelect(s.id, s.name);
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <input
        className="input" value={query} onChange={e => setQuery(e.target.value)}
        placeholder={t('admin.dwdMapSearch')}
      />
      <div className="note">{t('admin.dwdMapHint')}</div>

      {/* The frame has the map's own aspect ratio, so the SVG fills it exactly
          and a drag tracks the pointer 1:1 (no letterboxing to account for). */}
      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: 'oklch(0 0 0 / 0.18)', aspectRatio: `${width} / ${height}`, maxHeight: 480, maxWidth: `calc(480px * ${width / height})`, margin: '0 auto', width: '100%', touchAction: 'none', cursor: 'grab' }}
        // Gestures are measured on this untransformed frame, not on the SVG that moves inside it.
        ref={pz.attach}
        onPointerDown={e => { setHover(null); pz.onPointerDown(e); }}
        onPointerMove={pz.onPointerMove}
        onPointerUp={pz.onPointerUp}
        onPointerCancel={pz.onPointerUp}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', transformOrigin: '0 0', transform: viewTransform(view, width) }}
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
        {zoomed && (
          <button type="button" className="btn-ghost" style={{ position: 'absolute', right: 10, bottom: 10 }} onClick={() => pz.set({ x: 0, y: 0, w: width }, true)}>
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
