import { useMemo, useState } from 'react';
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

  const proj = useMemo(() => (data ? makeOutlineProjection(data) : null), [data]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!data || !q) return null;
    return data.stations.filter(s => s.name.toLowerCase().includes(q) || s.id.includes(q)).slice(0, 40);
  }, [data, q]);
  const matchIds = useMemo(() => (matches ? new Set(matches.map(s => s.id)) : null), [matches]);

  if (error) return <div className="note">{t('admin.dwdMapError', { error })}</div>;
  if (!data || !proj) return <div className="note">{t('admin.dwdMapLoading')}</div>;
  const { project, viewBox, width, height } = proj;

  const selected = data.stations.find(s => s.id === value) || null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <input
        className="input" value={query} onChange={e => setQuery(e.target.value)}
        placeholder={t('admin.dwdMapSearch')}
      />
      <div className="note">{t('admin.dwdMapHint')}</div>

      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: 'oklch(0 0 0 / 0.18)' }}>
        <svg viewBox={viewBox} style={{ width: '100%', maxHeight: 480, display: 'block' }}>
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
          <div className="tip" style={{ left: `${(hover.x / width) * 100}%`, top: `${(hover.y / height) * 100}%`, transform: 'translate(-50%, -130%)' }}>
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
