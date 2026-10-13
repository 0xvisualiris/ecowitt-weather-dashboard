import { useState } from 'react';
import { fmt } from '../lib';
import { LANG, t } from '../i18n';
import { lonLatToRadolanPixel, radolanPixelToLonLat } from '../radolanProjection';
import type { View } from '../panZoom';
import { GRID, GridMap, nearestPlace, pct, placeName } from './GridMap';
import { zoomKey } from './GestureHint';

type GeoPoint = { lat: number; lon: number };

const ROUND = 10; // 1 decimal degree — deliberately coarse, see README "Public radar location"
const round = (n: number) => Math.round(n * ROUND) / ROUND;
const snap = (gx: number, gy: number): GeoPoint => {
  const [lon, lat] = radolanPixelToLonLat(gx, gy);
  return { lat: round(lat), lon: round(lon) };
};

// The patch of ground that rounds to one stored position: 0.1° of longitude
// by 0.1° of latitude around it, as an SVG path in grid coordinates.
const cellPath = (p: GeoPoint) => 'M' + ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const)
  .map(([dx, dy]) => lonLatToRadolanPixel(p.lon + dx * 0.05, p.lat + dy * 0.05).map(n => n.toFixed(2)).join(','))
  .join('L') + 'Z';

// "49,5° N, 11,1° O · 6 km von Nürnberg"
export function describeLocation(p: GeoPoint) {
  const coords = `${fmt(p.lat, 1)}°${' '}N, ${fmt(p.lon, 1)}°${' '}${LANG === 'de' ? 'O' : 'E'}`;
  const { place, km } = nearestPlace(...lonLatToRadolanPixel(p.lon, p.lat));
  if (km > 80) return coords;
  return `${coords} · ${km < 4 ? t('admin.publicLocationAt', { place: placeName(place) }) : t('admin.publicLocationNear', { km: fmt(km, 0), place: placeName(place) })}`;
}

/// Picker for the rain radar's public, approximate home location —
/// deliberately coarse (snapped to a 0.1° lattice, roughly 7 x 11 km), kept
/// separate from any precise station coordinates (which the public API never
/// exposes). It is the same map as the radar screen, in the same projection,
/// so the marker set here is exactly where the radar will centre and draw
/// its distance rings. The highlighted cell shows everything that rounds to
/// the same stored position.
export function PublicLocationPicker({ value, onChange }: { value: GeoPoint | null; onChange: (loc: GeoPoint | null) => void }) {
  const [hover, setHover] = useState<GeoPoint | null>(null);
  // Opens on the current location, or on all of Germany; a new pick doesn't move the map.
  const [home] = useState<View>(() => {
    if (!value) return { x: 0, y: 0, w: GRID };
    const [x, y] = lonLatToRadolanPixel(value.lon, value.lat);
    return { x: x - 150, y: y - 150, w: 300 };
  });

  const marker = value ? lonLatToRadolanPixel(value.lon, value.lat) : null;
  const inGrid = (gx: number, gy: number) => gx >= 0 && gy >= 0 && gx <= GRID && gy <= GRID;
  const showHover = hover && !(value && hover.lat === value.lat && hover.lon === value.lon);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="note">{t('admin.publicLocationHint', { key: zoomKey() })}</div>
      <div className="map-pick">
        <GridMap
          home={home}
          onPick={(gx, gy) => { if (inGrid(gx, gy)) onChange(snap(gx, gy)); }}
          onHover={g => {
            const next = g && inGrid(...g) ? snap(...g) : null;
            setHover(prev => (prev?.lat === next?.lat && prev?.lon === next?.lon ? prev : next));
          }}
          lines={<>
            {showHover && <path className="map-cell preview" d={cellPath(hover)} />}
            {value && <path className="map-cell" d={cellPath(value)} />}
          </>}
        >
          {marker && <div className="radar-home" style={{ left: pct(marker[0]), top: pct(marker[1]) }} aria-hidden="true"><i /></div>}
        </GridMap>
      </div>
      <div className="row" style={{ border: 0, padding: 0, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="note" style={{ color: value ? 'var(--text-2)' : undefined }}>
          {value ? t('admin.publicLocationSet', { where: describeLocation(value) }) : t('admin.publicLocationNone')}
        </span>
        {value && <button type="button" className="btn-ghost" onClick={() => onChange(null)}>{t('admin.publicLocationClear')}</button>}
      </div>
    </div>
  );
}
