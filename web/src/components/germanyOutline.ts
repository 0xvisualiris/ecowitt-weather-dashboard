import { useEffect, useState } from 'react';

export interface StationData {
  stations: { id: string; name: string; lat: number; lon: number }[];
}

/// Shared fetch for public/dwd-stations.json (the DWD station list),
/// used by DwdStationMap.tsx — fetched lazily, only when the picker opens.
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
