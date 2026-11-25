// DWD pollen forecast: the Pollenflug-Gefahrenindex, published once a day (around 11:00) for 27
// regions of Germany as one small JSON file on opendata.dwd.de, free to use without registration.
// Format: DWD's own description, Beschreibung_pollen_s31fg.pdf next to the file.
//   content[]: { region_id, region_name, partregion_id (-1 if the region isn't split), partregion_name,
//                Pollen: { Hasel: { today, tomorrow, dayafter_to }, … } }
//   Each value is "0", "0-1", "1", "1-2", "2", "2-3" or "3": none … high load; "-1" means no forecast.
// A deployment picks one region by its id: the partregion_id, or the region_id where there is no part.

export const POLLEN_URL = 'https://opendata.dwd.de/climate_environment/health/alerts/s31fg.json';
// DWD's German names, as keys, mapped to the stable keys the API and the frontend use.
export const POLLEN_TYPES = {
  Hasel: 'hazel', Erle: 'alder', Esche: 'ash', Birke: 'birch', Graeser: 'grass', Roggen: 'rye', Beifuss: 'mugwort', Ambrosia: 'ragweed',
};
const DAYS = { today: 'today', tomorrow: 'tomorrow', dayafter_to: 'dayAfter' };

// "1-2" → 1.5; anything that isn't a level (including "-1") → null.
export function level(text) {
  const m = /^\s*([0-3])(?:\s*-\s*([0-3]))?\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  return m[2] == null ? Number(m[1]) : (Number(m[1]) + Number(m[2])) / 2;
}

// "2026-11-25 11:00 Uhr" (German local time) → ms.
export function parseStamp(text) {
  const m = /(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/.exec(String(text ?? ''));
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  return Number.isFinite(t) ? t : null;
}

export const regionId = (c) => (c.partregion_id > 0 ? c.partregion_id : c.region_id);
const regionName = (c) => (c.partregion_id > 0 && c.partregion_name ? `${c.region_name}: ${c.partregion_name}` : c.region_name);

// The whole file → { updated, next, regions: [{ id, name }], byId: { id: { name, types: [{ type, today, tomorrow, dayAfter }] } } }
export function parsePollen(json) {
  if (!json || !Array.isArray(json.content)) throw new Error('unexpected pollen file');
  const byId = {}, regions = [];
  for (const c of json.content) {
    const id = regionId(c);
    if (!Number.isInteger(id)) continue;
    const types = [];
    for (const [de, type] of Object.entries(POLLEN_TYPES)) {
      const p = c.Pollen?.[de];
      if (!p) continue;
      const row = { type };
      for (const [src, key] of Object.entries(DAYS)) row[key] = level(p[src]);
      types.push(row);
    }
    byId[id] = { name: regionName(c), types };
    regions.push({ id, name: regionName(c) });
  }
  return { updated: parseStamp(json.last_update), next: parseStamp(json.next_update), regions, byId };
}

export class PollenSource {
  constructor(regionId, { fetchImpl = globalThis.fetch, refreshMs = 3 * 3600 * 1000 } = {}) {
    this.region = regionId;
    this.fetch = fetchImpl;
    this.refreshMs = refreshMs;
    this.data = null;
    this._inflight = null;
  }

  start() {
    if (this.region == null) return;
    this.refresh();
    setInterval(() => this.refresh(), this.refreshMs).unref?.();
  }

  // On failure the last good file keeps being served, like the forecast and the radar.
  refresh() {
    this._inflight ??= this.fetch(POLLEN_URL, { signal: AbortSignal.timeout(20000) })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((json) => { this.data = parsePollen(json); })
      .catch((e) => console.warn(`[pollen] fetch failed: ${e.message}`))
      .finally(() => { this._inflight = null; });
    return this._inflight;
  }

  // All regions, for the admin page's picker; fetches the file once if nothing is loaded yet.
  async regions() {
    if (!this.data) await this.refresh();
    return this.data?.regions ?? [];
  }

  // The configured region's forecast for /api/pollen, or null.
  forecast() {
    const r = this.data?.byId?.[this.region];
    if (!r) return null;
    return { region: r.name, updated: this.data.updated, next: this.data.next, types: r.types };
  }
}
