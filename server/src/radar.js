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

const RY_URL = 'https://opendata.dwd.de/weather/radar/radolan/ry/raa01-ry_10000-latest-dwd---bin.bz2';

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

async function fetchLatest() {
  const res = await fetch(RY_URL);
  if (!res.ok) throw new Error(`RADOLAN request failed: HTTP ${res.status}`);
  const compressed = Buffer.from(await res.arrayBuffer());
  const raw = await bunzip2(compressed);
  return decodeRadolan(raw);
}

// Background-refreshed field read synchronously by request handlers, same
// "populate a field, read synchronously" pattern as ha.js's forecast/states
// and dwd.js's DwdForecast.
export class RadarSource {
  constructor({ refreshMs = 5 * 60 * 1000 } = {}) {
    this.refreshMs = refreshMs;
    this.latest = null; // { width, height, precision, timestamp, grid } | null
  }

  start() {
    const tick = () => fetchLatest()
      .then(result => { this.latest = result; })
      .catch(e => console.warn(`[radar] RADOLAN fetch failed: ${e.message}`));
    tick();
    setInterval(tick, this.refreshMs);
  }
}
