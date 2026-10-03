// DWD MOSMIX_L forecast: fetches a station's MOSMIX_L KMZ (a zip archive with
// one compressed XML entry inside), extracts the hourly series we need, and
// turns it into the same daily-forecast shape service.js already produces
// from a Home Assistant weather entity, so the frontend needs no changes.
//
// No zip or XML library is used, matching the project's dependency-light
// style (ha.js relies on Node's built-in WebSocket the same way): a KMZ's
// single entry is read via its zip central-directory record (reliable even
// when the local header omits sizes, which DWD's files do), decompressed
// with Node's built-in zlib, and the resulting XML has a stable,
// DWD-documented structure that a couple of targeted regexes can pull the
// element arrays out of without a general-purpose parser.

import zlib from 'node:zlib';
import { astro } from './astro.js';
import { normalize } from './units.js';
import { startOfDay, HOUR, round } from './util.js';

const KMZ_URL = id =>
  `https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/${id}/kml/MOSMIX_L_LATEST_${id}.kmz`;

// DWD's "ww" significant-weather code (WMO-derived, reduced set) -> the same
// condition vocabulary Home Assistant's weather integrations use, so
// FORECAST_DE in service.js applies unchanged. Ranges are an approximation
// of DWD's documented ww groups; exact boundary codes fall into the nearest
// sensible bucket.
function wwCondition(ww, isNight) {
  if (ww == null) return null;
  const c = Math.round(ww);
  if (c >= 95) return 'lightning-rainy';
  if (c >= 87 && c <= 94) return 'hail';
  if ((c >= 70 && c <= 79) || (c >= 85 && c <= 86)) return 'snowy';
  if (c >= 66 && c <= 69) return 'snowy-rainy';
  if (c === 65 || (c >= 83 && c <= 84)) return 'pouring';
  if ((c >= 60 && c <= 64) || (c >= 80 && c <= 82) || (c >= 50 && c <= 59)) return 'rainy';
  if ((c >= 40 && c <= 49) || (c >= 10 && c <= 16)) return 'fog';
  if (c >= 30 && c <= 39) return 'exceptional';
  if (c >= 17 && c <= 29) return 'lightning';
  if (c >= 3 && c <= 9) return 'cloudy';
  return isNight ? 'clear-night' : 'sunny'; // 0-2: no significant weather
}

// Higher wins when picking a day's representative condition out of its hourly rows.
const SEVERITY = {
  'lightning-rainy': 9, hail: 9, lightning: 8, exceptional: 8, snowy: 7, 'snowy-rainy': 6,
  pouring: 6, rainy: 5, fog: 3, cloudy: 2, sunny: 1, 'clear-night': 1,
};

function isNightAt(loc, t) {
  if (!loc) return false;
  const info = astro(loc.latitude, loc.longitude, t);
  return info?.sunrise != null && info?.sunset != null && (t < info.sunrise || t > info.sunset);
}

// A KMZ's one entry, located via the zip central directory (not the local
// file header, whose size fields DWD leaves at 0 and defers to a trailing
// data descriptor) and inflated with raw DEFLATE.
function unzipSingleEntry(buf) {
  const EOCD_SIG = 0x06054b50, CD_SIG = 0x02014b50, LFH_SIG = 0x04034b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: end-of-central-directory record not found');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== CD_SIG) throw new Error('zip: central directory record not found');
  const method = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const localOffset = buf.readUInt32LE(cdOffset + 42);
  if (buf.readUInt32LE(localOffset) !== LFH_SIG) throw new Error('zip: local file header not found');
  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + compSize);
  if (method === 0) return data;
  if (method === 8) return zlib.inflateRawSync(data);
  throw new Error(`zip: unsupported compression method ${method}`);
}

function extractElement(xml, name) {
  const m = xml.match(new RegExp(`<dwd:Forecast dwd:elementName="${name}">\\s*<dwd:value>([^<]*)</dwd:value>`));
  if (!m) return null;
  return m[1].trim().split(/\s+/).map(v => (v === '-' ? null : Number(v)));
}

function parseKml(xml) {
  const timesteps = [...xml.matchAll(/<dwd:TimeStep>([^<]+)<\/dwd:TimeStep>/g)].map(m => Date.parse(m[1]));
  const ttt = extractElement(xml, 'TTT');
  const ww = extractElement(xml, 'ww');
  const pop = extractElement(xml, 'R101');
  if (!timesteps.length || !ttt) throw new Error('DWD KML: expected elements (TimeStep/TTT) not found');
  return timesteps
    .map((t, i) => ({
      t,
      tempC: ttt[i] != null ? normalize('temperature', ttt[i], 'K') : null,
      wwCode: ww ? ww[i] : null,
      popPct: pop ? pop[i] : null,
    }))
    .filter(h => h.tempC != null);
}

async function fetchHourly(stationId) {
  const res = await fetch(KMZ_URL(stationId));
  if (!res.ok) throw new Error(`DWD request failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const xml = unzipSingleEntry(buf).toString('latin1');
  return parseKml(xml);
}

// Forecast for one DWD MOSMIX station, bias-corrected near-term with a live
// reading. Mirrors ha.js's pattern of a background-refreshed field read
// synchronously by service.js, rather than service.js awaiting a fetch.
export class DwdForecast {
  constructor(stationId, { label, refreshMs = 60 * 60 * 1000 } = {}) {
    this.stationId = stationId;
    this.label = label || null;
    this.refreshMs = refreshMs;
    this.hourly = null; // last good hourly series; kept on fetch/parse failure (serve-stale)
  }

  start() {
    const tick = () => fetchHourly(this.stationId)
      .then(hourly => { this.hourly = hourly; })
      .catch(e => console.warn(`[dwd] forecast fetch for station ${this.stationId} failed: ${e.message}`));
    tick();
    setInterval(tick, this.refreshMs);
  }

  days(liveTempC, maxDays = 5, biasHours = 6, loc = null) {
    if (!this.hourly?.length) return null;
    const now = Date.now();

    // Bias-correct the near-term hours toward what the station is actually
    // reading right now, fading to 0 by `biasHours` out; day 2+ stays pure DWD.
    let offset = 0;
    if (liveTempC != null) {
      const nearest = this.hourly.reduce((a, h) => (Math.abs(h.t - now) < Math.abs(a.t - now) ? h : a));
      if (nearest.tempC != null && Math.abs(nearest.t - now) < 3 * HOUR) offset = liveTempC - nearest.tempC;
    }
    const biasEnd = now + biasHours * HOUR;
    const corrected = offset
      ? this.hourly.map(h => (h.t > now && h.t < biasEnd ? { ...h, tempC: h.tempC + offset * (1 - (h.t - now) / (biasEnd - now)) } : h))
      : this.hourly;

    const byDay = new Map();
    for (const h of corrected) {
      const key = startOfDay(h.t);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(h);
    }

    const today = startOfDay(now);
    const days = [...byDay.entries()].slice(0, maxDays).map(([date, hs]) => {
      const temps = hs.map(h => h.tempC).filter(v => v != null);
      if (date === today && liveTempC != null) temps.push(liveTempC);
      const pops = hs.map(h => h.popPct).filter(v => v != null);

      // Representative condition = the day's most severe ww code. Ties (e.g.
      // calm clear weather all day) prefer a daytime hour, so a clear sunny
      // day reads "Sonnig" rather than "Klar" just because an early-morning
      // hour happened to be matched first.
      let bestSeverity = -1;
      let tied = [];
      for (const h of hs) {
        const night = isNightAt(loc, h.t);
        const c = wwCondition(h.wwCode, night);
        if (c == null) continue;
        const sev = SEVERITY[c] ?? 0;
        if (sev > bestSeverity) { bestSeverity = sev; tied = []; }
        if (sev === bestSeverity) tied.push({ c, night });
      }
      const condition = tied.length ? (tied.find(m => !m.night) || tied[0]).c : null;
      return {
        date,
        conditionCode: condition,
        pop: pops.length ? Math.max(...pops) : null,
        lo: temps.length ? round(Math.min(...temps), 1) : null,
        hi: temps.length ? round(Math.max(...temps), 1) : null,
      };
    });

    return { source: this.label || 'DWD MOSMIX', days };
  }
}
