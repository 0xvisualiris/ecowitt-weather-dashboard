// Street map tiles for the radar map: OpenStreetMap's standard tiles, fetched
// by the server, cached on disk and served from the dashboard's own origin.
// Visitors' browsers never contact OpenStreetMap (the CSP stays 'self'); only
// the server does, and only once per tile and fortnight.
//
// It is not an open proxy: only zoom levels MIN_ZOOM–MAX_ZOOM and only tiles
// over the radar's area (roughly Germany and its neighbours) are served.
// Upstream requests follow the OSM tile usage policy: an identifying
// User-Agent, at most two at a time, cached tiles reused, a stale tile served
// rather than none if OSM can't be reached.

import fs from 'node:fs';
import path from 'node:path';

export const MIN_ZOOM = 5, MAX_ZOOM = 16;
const BOUNDS = { west: 1, east: 20, south: 45, north: 56.5 };   // the radar grid plus a margin
const UPSTREAM = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const USER_AGENT = 'ecowitt-weather-dashboard (+https://github.com/0xvisualiris/ecowitt-weather-dashboard)';
const FRESH_MS = 14 * 24 * 3600 * 1000;
const PARALLEL = 2;

// Web Mercator tile numbers for a longitude/latitude at zoom z.
export function tileOf(lon, lat, z) {
  const n = 2 ** z, phi = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2 * n)];
}

// "/api/tiles/12/2154/1386.png" → [12, 2154, 1386] if it is a tile this server serves, else null.
export function parseTilePath(pathname) {
  const m = /^\/api\/tiles\/(\d{1,2})\/(\d{1,6})\/(\d{1,6})\.png$/.exec(pathname);
  if (!m) return null;
  const [z, x, y] = m.slice(1).map(Number);
  if (z < MIN_ZOOM || z > MAX_ZOOM) return null;
  const [x0, y0] = tileOf(BOUNDS.west, BOUNDS.north, z), [x1, y1] = tileOf(BOUNDS.east, BOUNDS.south, z);
  if (x < x0 || x > x1 || y < y0 || y > y1) return null;
  return [z, x, y];
}

export class TileCache {
  constructor(dir, { fetchImpl = fetch, now = Date.now } = {}) {
    this.dir = dir;
    this.fetch = fetchImpl;
    this.now = now;
    this.inflight = new Map();   // "z/x/y" → Promise<Buffer>
    this.queue = [];
    this.running = 0;
  }

  file(z, x, y) { return path.join(this.dir, String(z), String(x), `${y}.png`); }

  // The tile's PNG bytes: from disk while fresh, else from OSM (falling back to a stale copy).
  async get(z, x, y) {
    const key = `${z}/${x}/${y}`, file = this.file(z, x, y);
    let stale = null;
    try {
      const st = await fs.promises.stat(file);
      const buf = await fs.promises.readFile(file);
      if (this.now() - st.mtimeMs < FRESH_MS) return buf;
      stale = buf;
    } catch { /* not cached yet */ }
    if (!this.inflight.has(key)) {
      const p = this.limited(() => this.download(z, x, y, file)).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    try {
      return await this.inflight.get(key);
    } catch (e) {
      if (stale) return stale;
      throw e;
    }
  }

  async download(z, x, y, file) {
    const res = await this.fetch(UPSTREAM(z, x, y), { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw Object.assign(new Error(`tile ${z}/${x}/${y}: HTTP ${res.status}`), { status: 502 });
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, buf);
    } catch (e) {
      console.warn(`[tiles] cannot cache ${file}: ${e.message}`);   // still serve it
    }
    return buf;
  }

  // At most PARALLEL upstream requests at a time; the rest wait their turn.
  limited(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.next();
    });
  }

  next() {
    if (this.running >= PARALLEL || !this.queue.length) return;
    const { task, resolve, reject } = this.queue.shift();
    this.running++;
    task().then(resolve, reject).finally(() => { this.running--; this.next(); });
  }
}
