import { useMemo, useRef, useState } from 'react';
import { t } from '../i18n';
import { lonLatToRadolanPixel } from '../radolanProjection';
import { useGermanyOutline } from './germanyOutline';
import { GRID, GridMap, pct, type GridMapApi } from './GridMap';
import { zoomKey } from './GestureHint';

type Station = { id: string; name: string; search: string; px: [number, number] };

// A dot per station as one SVG path: a zero-length segment with a round line
// cap draws a circle whose diameter is the stroke width, which CSS keeps at a
// constant on-screen size (styles.css, --u). A handful of paths for ~2,800
// stations instead of one element each to restyle on every zoom frame.
// DWD spells umlauts out ("Gruendau"); people type them ("Gründau"). Both
// sides of a search are folded to the spelled-out form.
const fold = (text: string) => text.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

const dots = (stations: Station[]) => stations.map(s => `M${s.px[0].toFixed(1)},${s.px[1].toFixed(1)}h0`).join('');

/// Picker for the DWD MOSMIX station the forecast comes from: the same map as
/// the rain radar (GridMap), with every station from public/dwd-stations.json
/// as a dot — all ~2,800 stations DWD publishes a MOSMIX_L forecast for on
/// this map, built by scripts/build-dwd-stations.mjs. Tapping near a dot picks the closest station; the search box
/// filters by name or ID. No mapping library, no tiles.
export function DwdStationMap({ value, onSelect }: { value: string; onSelect: (id: string, name: string) => void }) {
  const { data, error } = useGermanyOutline();
  const [query, setQuery] = useState('');
  const [hover, setHover] = useState<Station | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const map = useRef<GridMapApi | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  const stations = useMemo<Station[]>(() => (data?.stations ?? [])
    .map(s => ({ id: s.id, name: s.name, search: fold(`${s.name} ${s.id}`), px: lonLatToRadolanPixel(s.lon, s.lat) }))
    .filter(s => s.px[0] >= 0 && s.px[0] <= GRID && s.px[1] >= 0 && s.px[1] <= GRID), [data]);

  const q = fold(query.trim());
  const matches = useMemo(() => (q ? stations.filter(s => s.search.includes(q)).slice(0, 40) : null), [stations, q]);
  const matchIds = useMemo(() => (matches ? new Set(matches.map(s => s.id)) : null), [matches]);
  const selected = stations.find(s => s.id === value) || null;

  if (error) return <div className="note">{t('admin.dwdMapError', { error })}</div>;
  if (!data) return <div className="note">{t('admin.dwdMapLoading')}</div>;

  // The station closest to a grid position, if it is within `px` screen
  // pixels of it. While a search is active, only its matches can be picked.
  const candidates = matchIds ? stations.filter(s => matchIds.has(s.id)) : stations;
  const stationNear = (gx: number, gy: number, px: number) => {
    const api = map.current, el = frame.current;
    if (!api || !el) return null;
    let best: Station | null = null, dist = px * (api.pz.get().w / el.clientWidth);
    for (const s of candidates) {
      const d = Math.hypot(s.px[0] - gx, s.px[1] - gy);
      if (d < dist) { dist = d; best = s; }
    }
    return best;
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <input
        className="input" value={query} onChange={e => setQuery(e.target.value)}
        placeholder={t('admin.dwdMapSearch')}
      />
      <div className="note">{t('admin.dwdMapHint', { key: zoomKey() })}</div>

      <div className="map-pick" ref={frame}>
        <GridMap
          home={{ x: 0, y: 0, w: GRID }}
          apiRef={map}
          onZoomedChange={setZoomed}
          onPick={(gx, gy) => { const s = stationNear(gx, gy, 20); if (s) onSelect(s.id, s.name); }}
          onHover={g => { const s = g ? stationNear(g[0], g[1], 12) : null; setHover(prev => (prev?.id === s?.id ? prev : s)); }}
          lines={<>
            {matchIds && <path className="map-stations dim" d={dots(stations.filter(s => !matchIds.has(s.id)))} />}
            <path className="map-stations" d={dots(candidates)} />
            {hover && <path className="map-stations hover" d={dots([hover])} />}
            {selected && <path className="map-stations selected" d={dots([selected])} />}
          </>}
          overlay={zoomed && (
            <button type="button" className="btn-ghost map-reset" onClick={() => map.current?.pz.set({ x: 0, y: 0, w: GRID }, true)}>
              {t('admin.dwdMapResetView')}
            </button>
          )}
        >
          {hover && (
            <div className="map-tip" style={{ left: pct(hover.px[0]), top: pct(hover.px[1]) }}>
              <div className="tip"><span className="tv">{hover.name}</span><span className="tt">{hover.id}</span></div>
            </div>
          )}
        </GridMap>
      </div>

      {selected && <div className="note">{t('admin.dwdMapSelected', { name: selected.name, id: selected.id })}</div>}

      {matches && (
        <div className="stack" style={{ gap: 0, maxHeight: 220, overflowY: 'auto' }}>
          {matches.length === 0 && <div className="note">{t('admin.dwdMapNoMatch')}</div>}
          {matches.map(s => (
            <button key={s.id} type="button" className="row" style={{ cursor: 'pointer', background: 'transparent', border: 0, textAlign: 'left', width: '100%', font: 'inherit', color: 'inherit' }}
              onClick={() => onSelect(s.id, s.name)}
              onMouseEnter={() => setHover(s)}
              onMouseLeave={() => setHover(null)}>
              <span className="k">{s.name}</span>
              <span className="v">{s.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
