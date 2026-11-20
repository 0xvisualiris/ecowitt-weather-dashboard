// Live rain radar: DWD's RADOLAN "RY" national composite (5-minute cadence,
// radar-derived rain rate at 1 km resolution) — the fast-
// updating product, not the hourly-accumulation "RW" one, since this is
// meant to read as "right now", like a visitor glancing at a weather app's
// radar screen. Plus DWD's two-hour nowcast (RADVOR "RV") for the frames
// after "now".
//
// The files are HDF5 since November 2026 (see radolan.js).

import { decodeComposite, decodeNowcast, readTar } from './radolan.js';

const RY_DIR = 'https://opendata.dwd.de/weather/radar/radolan/ry/';
const fileUrl = stamp => `${RY_DIR}raa01-ry_10000-${stamp}-dwd---bin.hdf5`;

// The nowcast: every 5 minutes DWD publishes one tar of 25 HDF5 files, the
// analysis (+0) and forecasts +5 … +120 minutes, as rain amount per 5
// minutes on the same DE1200 grid as RY.
const RV_DIR = 'https://opendata.dwd.de/weather/radar/composite/rv/';

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
  for (const m of listingHtml.matchAll(/raa01-ry_10000-(\d{10})-dwd---bin\.hdf5/g)) stamps.add(m[1]);
  return [...stamps].sort().slice(-count);
}

// A nowcast run's name, "YYYYMMDD_HHMM" (UTC), → ms.
export function runToMs(run) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})$/.exec(run);
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
}

// The newest run in the RV directory listing ("YYYYMMDD_HHMM"), or null.
export function latestRun(listingHtml) {
  const runs = [...listingHtml.matchAll(/composite_rv_(\d{8}_\d{4})\.tar/g)].map(m => m[1]);
  return runs.length ? runs.sort().at(-1) : null;
}

// The forecast steps in one run's tar: [{ lead (minutes), data }], ascending,
// without the +0 analysis (the RY composite is the observed "now").
export function nowcastSteps(tarBuf) {
  return readTar(tarBuf)
    .map(({ name, data }) => ({ lead: Number(/_(\d{3})-hd5$/.exec(name)?.[1]), data }))
    .filter(s => s.lead > 0)
    .sort((a, b) => a.lead - b.lead);
}

async function fetchFrame(stamp) {
  const res = await fetch(fileUrl(stamp));
  if (!res.ok) throw new Error(`RADOLAN request failed: HTTP ${res.status}`);
  const { width, height, grid } = decodeComposite(Buffer.from(await res.arrayBuffer()));
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
//
// Next to them it holds the newest nowcast run's 24 forecast steps
// (`forecast`; `run` = the run's time). One run is an ~8.5 MB tar, so a new
// one is fetched at most every `nowcastEveryMs` (default 10 minutes, about
// 1.2 GB a day); a run older than `nowcastMaxAgeMs` is no longer shown.
export class RadarSource {
  constructor({ refreshMs = 5 * 60 * 1000, keep = 25, nowcastEveryMs = 10 * 60 * 1000, nowcastMaxAgeMs = 45 * 60 * 1000 } = {}) {
    this.refreshMs = refreshMs;
    this.keep = keep;
    this.nowcastEveryMs = nowcastEveryMs;
    this.nowcastMaxAgeMs = nowcastMaxAgeMs;
    this.frames = [];   // [{ width, height, timestamp, grid }], oldest first
    this.forecast = []; // the same for the nowcast run's steps, oldest first
    this.run = null;    // that run's time (ms)
    this._busy = false;
  }

  get latest() { return this.frames[this.frames.length - 1] ?? null; }
  frame(timestamp) { return this.frames.find(f => f.timestamp === timestamp) ?? null; }

  // The forecast steps after the newest observed frame, while the run is
  // recent enough to show.
  upcoming(now = Date.now()) {
    if (this.run == null || now - this.run > this.nowcastMaxAgeMs) return [];
    const after = this.latest?.timestamp ?? -Infinity;
    return this.forecast.filter(f => f.timestamp > after);
  }

  // A forecast step of a given run; null once that run has been replaced.
  forecastFrame(timestamp, run, now = Date.now()) {
    if (run !== this.run) return null;
    return this.upcoming(now).find(f => f.timestamp === timestamp) ?? null;
  }

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
    }
    try {
      await this.refreshNowcast();
    } catch (e) {
      console.warn(`[radar] nowcast fetch failed: ${e.message}`); // the radar works without it
    } finally {
      this._busy = false;
    }
  }

  async refreshNowcast() {
    const res = await fetch(RV_DIR);
    if (!res.ok) throw new Error(`listing failed: HTTP ${res.status}`);
    const run = latestRun(await res.text());
    if (!run) throw new Error('listing contains no runs');
    const runMs = runToMs(run);
    if (this.run != null && runMs - this.run < this.nowcastEveryMs) return;
    const tar = await fetch(`${RV_DIR}composite_rv_${run}.tar`);
    if (!tar.ok) throw new Error(`request failed: HTTP ${tar.status}`);
    const steps = nowcastSteps(Buffer.from(await tar.arrayBuffer()));
    if (!steps.length) throw new Error('archive holds no forecast steps');
    const frames = [];
    for (const { lead, data } of steps) {
      frames.push({ ...decodeNowcast(data), timestamp: runMs + lead * 60 * 1000 });
      await new Promise(resolve => setImmediate(resolve)); // let requests through between decodes
    }
    this.forecast = frames;
    this.run = runMs;
  }

  start() {
    this.refresh();
    setInterval(() => this.refresh(), this.refreshMs);
  }
}
