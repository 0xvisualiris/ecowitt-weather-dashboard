import { useEffect, useState } from 'react';

export interface StationData {
  outline: [number, number][]; // [lon, lat] simplified Germany border (baked in at build time)
  stations: { id: string; name: string; lat: number; lon: number }[];
}

/// Shared fetch for public/dwd-stations.json (outline + DWD station list),
/// used by both DwdStationMap.tsx and the admin's public-location picker —
/// one lazily-fetched asset, not duplicated per component.
export function useGermanyOutline() {
  const [data, setData] = useState<StationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/dwd-stations.json').then(r => {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    }).then(j => { if (alive) setData(j); }).catch(e => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, []);

  return { data, error };
}

const W = 640, H = 760, PAD = 16;

/// Equirectangular projection with a cos(lat) correction so the shape isn't
/// horizontally stretched — fine at this scale/extent (~600 km across).
export function makeOutlineProjection(data: StationData) {
  const lons = [...data.outline.map(p => p[0]), ...data.stations.map(s => s.lon)];
  const lats = [...data.outline.map(p => p[1]), ...data.stations.map(s => s.lat)];
  const lonMin = Math.min(...lons), latMax = Math.max(...lats);
  const cos0 = Math.cos((Math.min(...lats) + latMax) / 2 * Math.PI / 180);
  const rawX = (lon: number) => (lon - lonMin) * cos0;
  const rawY = (lat: number) => latMax - lat;
  const xMax = Math.max(...lons.map(rawX));
  const yMax = Math.max(...lats.map(rawY));
  const scale = Math.min((W - 2 * PAD) / xMax, (H - 2 * PAD) / yMax);
  const project = (lon: number, lat: number): [number, number] => [rawX(lon) * scale + PAD, rawY(lat) * scale + PAD];
  const invert = (x: number, y: number): [number, number] => {
    const rx = (x - PAD) / scale, ry = (y - PAD) / scale;
    return [rx / cos0 + lonMin, latMax - ry];
  };
  return { project, invert, viewBox: `0 0 ${W} ${H}`, width: W, height: H };
}
