import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { LANG, t } from '../i18n';
import { lonLatToRadolanPixel } from '../radolanProjection';
import { createPanZoom, type View } from '../panZoom';
import { GestureHint, useGestureHint } from './GestureHint';

// The one map of Germany this app draws: the rain radar, and the two admin
// pickers (public location, DWD forecast station). Everything is laid out in
// DWD's RADOLAN grid — 900 x 900 units, one unit = one kilometre — so a
// position picked on the admin map lands on exactly the same spot of the
// radar screen.
export const GRID = 900;
export const pct = (gridPx: number) => `${(gridPx / GRID) * 100}%`;

// public/radar-map.json — SVG path data already in grid coordinates, built
// by scripts/build-radar-map.mjs from Natural Earth.
interface BaseMap { land: string; germany: string; states: string; rivers: string; streams: string; lakes: string }

function useBaseMap() {
  const [map, setMap] = useState<BaseMap | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/radar-map.json').then(r => (r.ok ? r.json() : null)).then(j => { if (alive && j) setMap(j); }).catch(() => { /* the map still works without its base layer */ });
    return () => { alive = false; };
  }, []);
  return map;
}

// Orientation: a hand-picked set of places in three tiers — the first is
// always labelled, the others appear as the map is zoomed in and there is
// room for them. [German name, English name, lon, lat, tier]
const CITIES: [string, string, number, number, 1 | 2 | 3][] = [
  ['Berlin', 'Berlin', 13.405, 52.52, 1], ['Hamburg', 'Hamburg', 9.993, 53.551, 1], ['München', 'Munich', 11.582, 48.135, 1],
  ['Köln', 'Cologne', 6.96, 50.938, 1], ['Frankfurt', 'Frankfurt', 8.682, 50.111, 1], ['Stuttgart', 'Stuttgart', 9.183, 48.776, 1],
  ['Leipzig', 'Leipzig', 12.373, 51.34, 1], ['Hannover', 'Hanover', 9.732, 52.376, 1], ['Nürnberg', 'Nuremberg', 11.077, 49.452, 1],
  ['Bremen', 'Bremen', 8.807, 53.079, 2], ['Dresden', 'Dresden', 13.737, 51.05, 2], ['Dortmund', 'Dortmund', 7.466, 51.514, 2],
  ['Kiel', 'Kiel', 10.123, 54.323, 2], ['Rostock', 'Rostock', 12.099, 54.092, 2], ['Erfurt', 'Erfurt', 11.029, 50.985, 2],
  ['Kassel', 'Kassel', 9.48, 51.313, 2], ['Saarbrücken', 'Saarbrücken', 6.997, 49.24, 2], ['Freiburg', 'Freiburg', 7.842, 47.999, 2],
  ['Münster', 'Münster', 7.626, 51.96, 2], ['Magdeburg', 'Magdeburg', 11.628, 52.121, 2], ['Würzburg', 'Würzburg', 9.953, 49.791, 2],
  ['Regensburg', 'Regensburg', 12.102, 49.013, 2], ['Karlsruhe', 'Karlsruhe', 8.404, 49.007, 2],
  ['Amsterdam', 'Amsterdam', 4.9, 52.372, 2], ['Brüssel', 'Brussels', 4.352, 50.847, 2], ['Zürich', 'Zurich', 8.541, 47.377, 2],
  ['Prag', 'Prague', 14.438, 50.076, 2], ['Straßburg', 'Strasbourg', 7.752, 48.573, 2], ['Stettin', 'Szczecin', 14.553, 53.428, 2],
  ['Düsseldorf', 'Düsseldorf', 6.773, 51.228, 3], ['Essen', 'Essen', 7.012, 51.455, 3], ['Bielefeld', 'Bielefeld', 8.532, 52.021, 3],
  ['Osnabrück', 'Osnabrück', 8.047, 52.28, 3], ['Oldenburg', 'Oldenburg', 8.214, 53.144, 3], ['Lübeck', 'Lübeck', 10.687, 53.866, 3],
  ['Flensburg', 'Flensburg', 9.437, 54.794, 3], ['Schwerin', 'Schwerin', 11.415, 53.629, 3], ['Potsdam', 'Potsdam', 13.064, 52.39, 3],
  ['Cottbus', 'Cottbus', 14.334, 51.757, 3], ['Chemnitz', 'Chemnitz', 12.921, 50.833, 3], ['Halle', 'Halle', 11.97, 51.483, 3],
  ['Göttingen', 'Göttingen', 9.935, 51.533, 3], ['Braunschweig', 'Brunswick', 10.522, 52.269, 3], ['Bonn', 'Bonn', 7.099, 50.735, 3],
  ['Aachen', 'Aachen', 6.084, 50.776, 3], ['Koblenz', 'Koblenz', 7.594, 50.357, 3], ['Trier', 'Trier', 6.641, 49.757, 3],
  ['Mainz', 'Mainz', 8.247, 50.0, 3], ['Mannheim', 'Mannheim', 8.466, 49.488, 3], ['Heilbronn', 'Heilbronn', 9.218, 49.142, 3],
  ['Ulm', 'Ulm', 9.993, 48.401, 3], ['Augsburg', 'Augsburg', 10.898, 48.371, 3], ['Ingolstadt', 'Ingolstadt', 11.426, 48.766, 3],
  ['Passau', 'Passau', 13.432, 48.567, 3], ['Bayreuth', 'Bayreuth', 11.578, 49.946, 3], ['Konstanz', 'Constance', 9.175, 47.678, 3],
  ['Kempten', 'Kempten', 10.317, 47.726, 3], ['Rosenheim', 'Rosenheim', 12.128, 47.856, 3], ['Fulda', 'Fulda', 9.675, 50.555, 3],
  ['Siegen', 'Siegen', 8.024, 50.875, 3], ['Paderborn', 'Paderborn', 8.754, 51.719, 3], ['Bremerhaven', 'Bremerhaven', 8.577, 53.55, 3],
  ['Stralsund', 'Stralsund', 13.09, 54.309, 3], ['Luxemburg', 'Luxembourg', 6.13, 49.611, 3], ['Basel', 'Basel', 7.588, 47.56, 3],
  ['Salzburg', 'Salzburg', 13.045, 47.811, 3], ['Innsbruck', 'Innsbruck', 11.394, 47.269, 3], ['Lüttich', 'Liège', 5.571, 50.633, 3],
];
export const PLACES = CITIES.map(([de, en, lon, lat, tier]) => ({ de, en, tier, px: lonLatToRadolanPixel(lon, lat) }))
  .filter(c => c.px[0] > 8 && c.px[0] < GRID - 8 && c.px[1] > 8 && c.px[1] < GRID - 8);
export const placeName = (p: { de: string; en: string }) => (LANG === 'de' ? p.de : p.en);

// The closest labelled place to a grid position, and how far away it is in km.
export function nearestPlace(gx: number, gy: number) {
  let best = PLACES[0], dist = Infinity;
  for (const p of PLACES) {
    const d = Math.hypot(p.px[0] - gx, p.px[1] - gy);
    if (d < dist) { dist = d; best = p; }
  }
  return { place: best, km: dist };
}

export interface GridMapApi {
  pz: ReturnType<typeof createPanZoom>;
  // client (viewport) coordinates -> grid coordinates under that point
  toGrid: (clientX: number, clientY: number) => [number, number];
}

// The map frame: base map, place labels, pan/zoom (see panZoom.ts) and the
// zoom buttons. Callers add their own content in grid coordinates:
//   under    — canvases drawn above the base map but below the border (rain)
//   lines    — SVG elements in the 900x900 viewBox, above `under`
//   children — HTML positioned with left/top percentages (pct()), topmost
//   overlay  — HTML fixed to the frame rather than to the map
// Pan/zoom never goes through React state: the view is written straight to
// the one transformed layer everything sits in. Labels counter-scale through
// --inv (1 / zoom) and line widths through --u (grid units per screen
// pixel), so both keep their on-screen size at any zoom and frame size.
export function GridMap({ home, apiRef, under, lines, children, overlay, onPick, onHover, onZoomedChange }: {
  home: View;
  apiRef?: MutableRefObject<GridMapApi | null>;
  under?: ReactNode;
  lines?: ReactNode;
  children?: ReactNode;
  overlay?: ReactNode;
  // a click or tap on the map that wasn't a drag, in grid coordinates
  onPick?: (gx: number, gy: number) => void;
  // mouse position over the map in grid coordinates, null when it leaves
  onHover?: (grid: [number, number] | null) => void;
  onZoomedChange?: (zoomed: boolean) => void;
}) {
  const base = useBaseMap();
  const [hint, showHint] = useGestureHint();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const frameWidth = useRef(0);
  const zoomedRef = useRef(false);
  const callbacks = useRef({ onZoomedChange });
  callbacks.current = { onZoomedChange };

  const pz = useMemo(() => createPanZoom({
    contentW: GRID, contentH: GRID, minW: 40,
    onHint: showHint,
    apply: (v: View) => {
      const layer = layerRef.current;
      if (!layer) return;
      const scale = GRID / v.w;
      layer.style.transform = `translate(${(-v.x / v.w) * 100}%, ${(-v.y / v.w) * 100}%) scale(${scale})`;
      layer.style.setProperty('--inv', String(1 / scale));
      layer.style.setProperty('--u', String(GRID / (frameWidth.current || GRID) / scale));
      const zoom = scale >= 3.2 ? 'close' : scale >= 1.7 ? 'near' : 'far';
      if (layer.dataset.zoom !== zoom) layer.dataset.zoom = zoom;
      const zoomed = scale > 1.01;
      if (zoomed !== zoomedRef.current) { zoomedRef.current = zoomed; callbacks.current.onZoomedChange?.(zoomed); }
    },
  }), [showHint]);

  const toGrid = (clientX: number, clientY: number): [number, number] => {
    const r = frameRef.current!.getBoundingClientRect(), v = pz.get();
    return [v.x + ((clientX - r.left) / r.width) * v.w, v.y + ((clientY - r.top) / r.height) * v.w];
  };
  if (apiRef) apiRef.current = { pz, toGrid };

  const attachFrame = useMemo(() => {
    let observer: ResizeObserver | null = null;
    return (node: HTMLDivElement | null) => {
      observer?.disconnect();
      frameRef.current = node;
      pz.attach(node);
      if (!node) return;
      observer = new ResizeObserver(() => { frameWidth.current = node.clientWidth; pz.set(pz.get()); });
      observer.observe(node);
      frameWidth.current = node.clientWidth;
    };
  }, [pz]);

  useEffect(() => {
    pz.set(home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pz, home.x, home.y, home.w]);

  return (
    <div
      ref={attachFrame}
      className={'radar-frame' + (onPick ? ' pick' : '')}
      onPointerDown={pz.onPointerDown}
      onPointerMove={e => {
        pz.onPointerMove(e);
        if (onHover && e.pointerType === 'mouse' && e.buttons === 0) onHover(toGrid(e.clientX, e.clientY));
      }}
      onPointerUp={pz.onPointerUp}
      onPointerCancel={pz.onPointerUp}
      onPointerLeave={() => onHover?.(null)}
      onClick={e => {
        if (!onPick || pz.wasDrag() || (e.target as Element).closest('button')) return;
        onPick(...toGrid(e.clientX, e.clientY));
      }}
    >
      <div ref={layerRef} className="radar-layer" data-zoom="far">
        {base && (
          <svg className="radar-svg radar-base" viewBox={`0 0 ${GRID} ${GRID}`} aria-hidden="true">
            <path className="map-land" d={base.land} />
            <path className="map-germany" d={base.germany} />
            <path className="map-stream" d={base.streams} />
            <path className="map-river" d={base.rivers} />
            <path className="map-lake" d={base.lakes} />
            <path className="map-state" d={base.states} />
          </svg>
        )}
        {under}
        <svg className="radar-svg" viewBox={`0 0 ${GRID} ${GRID}`} aria-hidden="true">
          {/* the national border again, above whatever is drawn in `under`, so it stays readable under a shower */}
          {base && <path className="map-outline" d={base.germany} />}
          {lines}
        </svg>
        {PLACES.map(c => (
          <div key={c.de} className={'radar-city tier' + c.tier} style={{ left: pct(c.px[0]), top: pct(c.px[1]) }} aria-hidden="true">
            <i /><span>{placeName(c)}</span>
          </div>
        ))}
        {children}
      </div>

      {overlay}
      <GestureHint hint={hint} />
      <div className="radar-zoom">
        <button type="button" aria-label={t('radar.zoomIn')} onClick={() => pz.zoomBy(1 / 1.6)}>+</button>
        <button type="button" aria-label={t('radar.zoomOut')} onClick={() => pz.zoomBy(1.6)}>−</button>
      </div>
    </div>
  );
}
