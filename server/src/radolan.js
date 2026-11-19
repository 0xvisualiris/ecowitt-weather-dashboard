// Decodes a DWD RADOLAN RY composite (the national radar rain-rate grid) and
// resamples it onto the 900x900 grid the radar screen draws on.
//
// Since November 2026 DWD publishes RY only as ODIM HDF5: one uint16 dataset
// of 1100x1200 cells ("DE1200", 1 km each), rain rate in 0.01 mm/h, 65535 =
// no data (outside radar range), 0 = no rain, stored as a single
// zlib-compressed chunk. Rather than add an HDF5 library, this finds that
// chunk the way a known structure allows: the only zlib stream in the file
// that inflates to exactly 1100*1200*2 bytes. Rows run north to south, as in
// every ODIM composite.
//
// The new grid uses a WGS84 polar stereographic projection; the browser's
// base map (web/map.js, web/radar-map.json) is in the old national 900x900
// grid on a sphere. Each old cell takes the value of the new cell under its
// centre, through a lookup table built once.

import { inflateSync } from 'node:zlib';

export const OUT = 900;                          // the browser's grid (web/map.js GRID)
export const SRC_W = 1100, SRC_H = 1200;         // DWD's DE1200 grid
const NODATA = 65535;
const GAIN = 0.01;                               // mm/h per raw unit
const MMH_PER_CLASS = 0.6;                       // web/radar.js MM_PER_HOUR_PER_CLASS

const RAD = Math.PI / 180;

// The browser's grid: polar stereographic on a sphere (R 6370.04 km, true at
// 60°N, centred on 10°E), 1 km cells, row 0 at the north edge. Same as
// toLonLat in web/map.js.
export function outToLonLat(col, row) {
  const R = 6370.040, X0 = -523.4621, Y0 = -3758.645;
  const x = col + X0, y = Y0 - row, rho = Math.hypot(x, y);
  const phi = Math.PI / 2 - 2 * Math.atan(rho / (R * (1 + Math.sin(60 * RAD))));
  return [(10 * RAD + Math.atan2(x, -y)) / RAD, phi / RAD];
}

// DWD's grid: the file's projdef, +proj=stere +lat_0=90 +lat_ts=60 +lon_0=10
// on WGS84 with false easting/northing, which puts cell centres on whole
// kilometres from the north-west cell. Returns fractional [col, row].
const A = 6378137, B = 6356752.3142451802, E = Math.sqrt(1 - (B * B) / (A * A));
const tsfn = (phi) => Math.tan(Math.PI / 4 - phi / 2) / ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2);
const K = (A * Math.cos(60 * RAD)) / Math.sqrt(1 - E * E * Math.sin(60 * RAD) ** 2) / tsfn(60 * RAD);
export function lonLatToSrc(lon, lat) {
  const rho = K * tsfn(lat * RAD), lam = (lon - 10) * RAD;
  const x = rho * Math.sin(lam) + 543196.83521776402;
  const y = -rho * Math.cos(lam) + 3622588.8619310018;
  return [x / 1000, -y / 1000];
}

// For each browser cell, the index of the DWD cell under its centre (-1 off the grid).
let lookup = null;
function sourceIndex() {
  if (lookup) return lookup;
  lookup = new Int32Array(OUT * OUT);
  for (let row = 0; row < OUT; row++) {
    for (let col = 0; col < OUT; col++) {
      const [sc, sr] = lonLatToSrc(...outToLonLat(col + 0.5, row + 0.5)).map(Math.round);
      lookup[row * OUT + col] = sc >= 0 && sr >= 0 && sc < SRC_W && sr < SRC_H ? sr * SRC_W + sc : -1;
    }
  }
  return lookup;
}

// The compressed data chunk: the zlib stream that inflates to the full grid.
function findGrid(buf) {
  const size = SRC_W * SRC_H * 2;
  for (let i = buf.indexOf(0x78); i >= 0 && i < buf.length - 2; i = buf.indexOf(0x78, i + 1)) {
    if (((buf[i] << 8) | buf[i + 1]) % 31 !== 0 || buf[i + 1] & 0x20) continue;   // not a valid zlib header
    let raw;
    try { raw = inflateSync(buf.subarray(i), { maxOutputLength: size + 1 }); } catch { continue; }
    if (raw.length === size) return raw;
  }
  return null;
}

// A raw rain rate → the 0-255 byte the browser colours: 255 = no data,
// 0 = no rain, 1-254 = rain rate in steps of 0.6 mm/h (clamped).
export function rateClass(raw) {
  if (raw === NODATA) return 255;
  if (raw === 0) return 0;
  return Math.max(1, Math.min(254, Math.round((raw * GAIN) / MMH_PER_CLASS)));
}

export function decodeComposite(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89484446) throw new Error('RADOLAN: not an HDF5 file');
  const raw = findGrid(buf);
  if (!raw) throw new Error(`RADOLAN: no ${SRC_W}x${SRC_H} data grid found`);
  const index = sourceIndex();
  const grid = new Uint8Array(OUT * OUT);
  for (let i = 0; i < grid.length; i++) {
    const s = index[i];
    grid[i] = s < 0 ? 255 : rateClass(raw.readUInt16LE(s * 2));
  }
  return { width: OUT, height: OUT, grid };
}
