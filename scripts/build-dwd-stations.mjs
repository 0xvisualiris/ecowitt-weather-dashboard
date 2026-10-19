// Builds web/dwd-stations.json: every DWD MOSMIX station the admin
// page's forecast-station picker can offer.
//
// A station is included if
//   1. it is in DWD's MOSMIX station catalogue (name and position),
//   2. DWD actually publishes a MOSMIX_L forecast for it — it has a folder
//      under opendata.dwd.de/…/MOSMIX_L/single_stations/ — and
//   3. it lies on the map the picker draws (the 900x900 km RADOLAN grid).
// That is all of them, numeric and alphanumeric IDs alike (e.g. L771
// Gründau-Breitenborn): the folder listing, not the shape of the ID, is what
// says whether a forecast exists.
//
// The catalogue gives positions as degrees.minutes, not decimal degrees:
// "50.16" is 50°16', i.e. 50.267°. Reading it as a decimal puts a station up
// to ~45 km from where it really is.
//
// Nothing runs this automatically. To regenerate (zero dependencies, Node 22):
//
//   node scripts/build-dwd-stations.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CATALOGUE = 'https://www.dwd.de/DE/leistungen/met_verfahren_mosmix/mosmix_stationskatalog.cfg?view=nasPublication&nn=16102';
const FORECASTS = 'https://opendata.dwd.de/weather/local_forecasts/mos/MOSMIX_L/single_stations/';
const outFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dwd-stations.json');

// ---- projection: must match toGridPos() in web/map.js ----
const R = 6370.040, PHI0 = (60 * Math.PI) / 180, LAM0 = (10 * Math.PI) / 180, X0 = -523.4621, Y0 = -3758.645, GRID = 900;
function onMap(lon, lat) {
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180;
  const m = (1 + Math.sin(PHI0)) / (1 + Math.sin(phi));
  const x = R * m * Math.cos(phi) * Math.sin(lam - LAM0) - X0, y = Y0 + R * m * Math.cos(phi) * Math.cos(lam - LAM0);
  return x >= 0 && x <= GRID && y >= 0 && y <= GRID;
}

// "50.16" (degrees.minutes) -> 50.267 (decimal degrees)
function degMin(text) {
  const v = Number(text), sign = v < 0 ? -1 : 1, abs = Math.abs(v);
  const deg = Math.trunc(abs + 1e-9), min = (abs - deg) * 100;
  return Math.round(sign * (deg + min / 60) * 1000) / 1000;
}

// The catalogue's names are upper-case ASCII, at most 20 characters:
// "GRUENDAU-BREITENBORN" -> "Gruendau-Breitenborn". Umlauts stay spelled out
// (ue/ae/oe) — turning them back is guesswork ("Neuenkirchen"); the picker's
// search treats both spellings as the same instead.
const titleCase = name => name.toLowerCase().replace(/(^|[\s\-/.(])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());

const get = async url => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
};

const withForecast = new Set([...(await get(FORECASTS)).matchAll(/href="([A-Z0-9]{2,5})\/"/g)].map(m => m[1]));
const stations = [];
let listed = 0;
for (const line of (await get(CATALOGUE)).split(/\r?\n/)) {
  // Fixed-width columns: ID (5, right-aligned — " L771"), ICAO (4), name (20), then lat, lon, elevation.
  const id = line.slice(0, 5).trim(), name = line.slice(11, 31);
  const [lat, lon, elev] = line.slice(31).trim().split(/\s+/);
  if (!/^[A-Z0-9]{2,5}$/.test(id) || !/^-?\d+\.\d+$/.test(lat ?? '') || !/^-?\d+\.\d+$/.test(lon ?? '') || elev == null) continue; // header, separator and blank lines
  listed++;
  const s = { id, name: titleCase(name.trim()), lat: degMin(lat), lon: degMin(lon) };
  if (withForecast.has(id) && onMap(s.lon, s.lat)) stations.push(s);
}
if (stations.length < 500) throw new Error(`only ${stations.length} stations matched — has the catalogue or listing format changed?`);
stations.sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));

fs.writeFileSync(outFile, JSON.stringify({ source: 'DWD MOSMIX station catalogue (dwd.de) and MOSMIX_L forecast listing (opendata.dwd.de)', stations }));
console.log(`catalogue: ${listed} stations, with a MOSMIX_L forecast: ${withForecast.size}, on the map: ${stations.length}`);
console.log(`wrote ${path.relative(process.cwd(), outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
