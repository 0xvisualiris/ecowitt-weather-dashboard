import { useEffect, useMemo, useState } from 'react';
import { t } from '../i18n';

interface StationData {
  outline: [number, number][]; // [lon, lat] simplified Germany border (Natural-Earth-derived, baked in at build time)
  stations: { id: string; name: string; lat: number; lon: number }[];
}

const W = 640, H = 760, PAD = 16;

// Equirectangular projection with a cos(lat) correction so the shape isn't
// horizontally stretched — fine at this scale/extent (~600 km across),
// same approach a hand-rolled SVG chart elsewhere in this app would use.
function makeProjection(data: StationData) {
  const lons = [...data.outline.map(p => p[0]), ...data.stations.map(s => s.lon)];
  const lats = [...data.outline.map(p => p[1]), ...data.stations.map(s => s.lat)];
  const lonMin = Math.min(...lons), latMax = Math.max(...lats);
  const cos0 = Math.cos((Math.min(...lats) + latMax) / 2 * Math.PI / 180);
  const rawX = (lon: number) => (lon - lonMin) * cos0;
  const rawY = (lat: number) => latMax - lat;
  const xMax = Math.max(...lons.map(rawX));
  const yMax = Math.max(...lats.map(rawY));
  const scale = Math.min((W - 2 * PAD) / xMax, (H - 2 * PAD) / yMax);
  return (lon: number, lat: number): [number, number] => [rawX(lon) * scale + PAD, rawY(lat) * scale + PAD];
}

/// A hand-rolled SVG map (no mapping library, no external tiles — same
/// "dependency-light, hand-drawn SVG" convention as Chart.tsx/ConditionIcon)
/// for picking a DWD MOSMIX station visually instead of typing its ID.
/// Station list + simplified border baked into public/dwd-stations.json at
/// build time from DWD's own station catalogue (numeric-ID stations only —
/// those are the real synoptic network MOSMIX_L actually covers — within a
/// Central European bounding box), fetched lazily only when the picker opens.
export function DwdStationMap({ value, onSelect }: { value: string; onSelect: (id: string, name: string) => void }) {
  const [data, setData] = useState<StationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<{ id: string; name: string; x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/dwd-stations.json').then(r => {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    }).then(j => { if (alive) setData(j); }).catch(e => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, []);

  const project = useMemo(() => (data ? makeProjection(data) : null), [data]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!data || !q) return null;
    return data.stations.filter(s => s.name.toLowerCase().includes(q) || s.id.includes(q)).slice(0, 40);
  }, [data, q]);
  const matchIds = useMemo(() => (matches ? new Set(matches.map(s => s.id)) : null), [matches]);

  if (error) return <div className="note">{t('admin.dwdMapError', { error })}</div>;
  if (!data || !project) return <div className="note">{t('admin.dwdMapLoading')}</div>;

  const selected = data.stations.find(s => s.id === value) || null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <input
        className="input" value={query} onChange={e => setQuery(e.target.value)}
        placeholder={t('admin.dwdMapSearch')}
      />
      <div className="note">{t('admin.dwdMapHint')}</div>

      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: 'oklch(0 0 0 / 0.18)' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: 480, display: 'block' }}>
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
                  onClick={() => onSelect(s.id, s.name)}
                  onMouseEnter={() => setHover({ id: s.id, name: s.name, x, y })}
                  onMouseLeave={() => setHover(h => (h?.id === s.id ? null : h))} />
                <circle cx={x} cy={y} r={isSelected ? 6 : 3} fill={isSelected ? 'var(--amber)' : 'var(--blue)'}
                  stroke={isSelected ? 'oklch(1 0 0 / 0.6)' : 'none'} strokeWidth={2} pointerEvents="none" />
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="tip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%`, transform: 'translate(-50%, -130%)' }}>
            <span className="tv">{hover.name}</span>
            <span className="tt">{hover.id}</span>
          </div>
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
