import { useMemo } from 'react';
import { t } from '../i18n';
import { useGermanyOutline, makeOutlineProjection } from './germanyOutline';

const ROUND = 10; // 1 decimal degree, ~10 km — deliberately coarse, see README "Public radar location"

/// Click-on-map picker for the radar screen's public, approximate home
/// location — deliberately coarse (rounded to ~10 km), kept separate from
/// any precise station coordinates (which the public API never exposes).
export function PublicLocationPicker({ value, onChange }: { value: { lat: number; lon: number } | null; onChange: (loc: { lat: number; lon: number }) => void }) {
  const { data, error } = useGermanyOutline();
  const proj = useMemo(() => (data ? makeOutlineProjection(data) : null), [data]);

  if (error) return <div className="note">{t('admin.dwdMapError', { error })}</div>;
  if (!data || !proj) return <div className="note">{t('admin.dwdMapLoading')}</div>;
  const { project, invert, viewBox, width, height } = proj;

  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    const y = ((e.clientY - rect.top) / rect.height) * height;
    const [lon, lat] = invert(x, y);
    onChange({ lat: Math.round(lat * ROUND) / ROUND, lon: Math.round(lon * ROUND) / ROUND });
  };

  const marker = value ? project(value.lon, value.lat) : null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="note">{t('admin.publicLocationHint')}</div>
      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: 'oklch(0 0 0 / 0.18)' }}>
        <svg viewBox={viewBox} style={{ width: '100%', maxHeight: 420, display: 'block', cursor: 'crosshair' }} onClick={pick}>
          <path
            d={'M' + data.outline.map(([lon, lat]) => project(lon, lat).join(',')).join('L') + 'Z'}
            fill="oklch(1 0 0 / 0.05)" stroke="oklch(1 0 0 / 0.22)" strokeWidth={1.5}
          />
          {marker && (
            <g pointerEvents="none">
              <circle cx={marker[0]} cy={marker[1]} r={10} fill="none" stroke="var(--amber)" strokeWidth={2} opacity={0.5} />
              <circle cx={marker[0]} cy={marker[1]} r={5} fill="var(--amber)" stroke="oklch(1 0 0 / 0.6)" strokeWidth={2} />
            </g>
          )}
        </svg>
      </div>
      {value && <div className="note">{t('admin.publicLocationSet', { lat: value.lat.toFixed(1), lon: value.lon.toFixed(1) })}</div>}
    </div>
  );
}
