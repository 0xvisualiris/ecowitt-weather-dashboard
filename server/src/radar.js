// Live rain radar: DWD's RADOLAN "RY" national composite (5-minute cadence,
// radar-derived rain rate, 900x900 km at 1km resolution) — the fast-
// updating product, not the hourly-accumulation "RW" one, since this is
// meant to read as "right now", like a visitor glancing at a weather app's
// radar screen.
//
// DWD only publishes this bz2-compressed, and Node has no built-in bzip2
// support (zlib covers gzip/deflate/brotli only). Rather than add an npm
// dependency for one decompression call, this shells out to the standard
// `bzip2` CLI (installed via the Dockerfile) the same way a shell script
// would — no new package.json dependency.

import { spawn } from 'node:child_process';
import { decodeRadolan } from './radolan.js';

const RY_DIR = 'https://opendata.dwd.de/weather/radar/radolan/ry/';
const fileUrl = stamp => `${RY_DIR}raa01-ry_10000-${stamp}-dwd---bin.bz2`;

// DWD names each 5-minute composite by its UTC time, YYMMDDHHMM. That stamp
// (not the header's day/hour/minute, which carries no month or year) is what
// identifies a frame.
export function stampToMs(stamp) {
  const n = i => Number(stamp.slice(i, i + 2));
  return Date.UTC(2000 + n(0), n(2) - 1, n(4), n(6), n(8));
}

// The newest `count` frame stamps in DWD's directory listing, oldest first.
export function latestStamps(listingHtml, count) {
  const stamps = new Set();
  for (const m of listingHtml.matchAll(/raa01-ry_10000-(\d{10})-dwd---bin\.bz2/g)) stamps.add(m[1]);
  return [...stamps].sort().slice(-count);
}

function bunzip2(compressed) {
  return new Promise((resolve, reject) => {
    const proc = spawn('bunzip2', ['-c']);
    const chunks = [];
    let stderr = '';
    proc.stdout.on('data', c => chunks.push(c));
    proc.stderr.on('data', c => { stderr += c; });
    proc.on('error', reject); // e.g. ENOENT if bzip2 isn't installed
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`bunzip2 exited ${code}: ${stderr.trim()}`));
      resolve(Buffer.concat(chunks));
    });
    proc.stdin.on('error', () => { /* bunzip2 closing stdin early on a bad stream is reported via 'close' above */ });
    proc.stdin.end(compressed);
  });
}

async function fetchFrame(stamp) {
  const res = await fetch(fileUrl(stamp));
  if (!res.ok) throw new Error(`RADOLAN request failed: HTTP ${res.status}`);
  const compressed = Buffer.from(await res.arrayBuffer());
  const raw = await bunzip2(compressed);
  const { width, height, grid } = decodeRadolan(raw);
  return { width, height, grid, timestamp: stampToMs(stamp) };
}

// Background-refreshed field read synchronously by request handlers, same
// "populate a field, read synchronously" pattern as ha.js's forecast/states
// and dwd.js's DwdForecast.
//
// Keeps the last `keep` composites (default 25 = two hours at DWD's 5-minute
// cadence), so the radar screen can play them as a loop. About 0.8 MB per
// frame in memory. On start the history is backfilled newest-first — the
// current frame is available after one download, the loop fills in behind it.
export class RadarSource {
  constructor({ refreshMs = 5 * 60 * 1000, keep = 25 } = {}) {
    this.refreshMs = refreshMs;
    this.keep = keep;
    this.frames = []; // [{ width, height, timestamp, grid }], oldest first
    this._busy = false;
  }

  get latest() { return this.frames[this.frames.length - 1] ?? null; }
  frame(timestamp) { return this.frames.find(f => f.timestamp === timestamp) ?? null; }

  async refresh() {
    if (this._busy) return;
    this._busy = true;
    try {
      const res = await fetch(RY_DIR);
      if (!res.ok) throw new Error(`RADOLAN listing failed: HTTP ${res.status}`);
      const wanted = latestStamps(await res.text(), this.keep);
      if (!wanted.length) throw new Error('RADOLAN listing contains no frames');
      const oldest = stampToMs(wanted[0]);
      for (const stamp of wanted.reverse()) {
        if (this.frame(stampToMs(stamp))) continue;
        try {
          const frame = await fetchFrame(stamp);
          this.frames = [...this.frames, frame].filter(f => f.timestamp >= oldest).sort((a, b) => a.timestamp - b.timestamp);
        } catch (e) {
          console.warn(`[radar] frame ${stamp} skipped: ${e.message}`); // one bad file doesn't stop the rest
        }
      }
      this.frames = this.frames.filter(f => f.timestamp >= oldest);
    } catch (e) {
      console.warn(`[radar] RADOLAN fetch failed: ${e.message}`); // keep serving what we have
    } finally {
      this._busy = false;
    }
  }

  start() {
    this.refresh();
    setInterval(() => this.refresh(), this.refreshMs);
  }
}
