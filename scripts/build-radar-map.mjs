// Builds web/radar-map.json: the base map drawn under the rain radar
// (land, country and federal-state borders, rivers, lakes), as SVG path data
// already projected onto DWD's 900x900 km RADOLAN grid (1 unit = 1 km).
//
// The dashboard makes no external requests at runtime (see the CSP in
// server/src/index.js), so the map can't come from a tile server — it is
// baked into this one static file instead. Source: Natural Earth 1:10m
// (public domain, naturalearthdata.com), fetched from its GitHub mirror.
// Nothing runs this automatically; borders and rivers don't change. To
// regenerate (zero dependencies, Node 22):
//
//   node scripts/build-radar-map.mjs [cache-dir]
//
// The cache dir (default: the OS temp dir) keeps the ~50 MB of downloaded
// GeoJSON between runs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const cacheDir = process.argv[2] || path.join(os.tmpdir(), 'natural-earth');
const outFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'radar-map.json');

// ---- projection: must match toGridPos() in web/map.js ----
const R = 6370.040, PHI0 = (60 * Math.PI) / 180, LAM0 = (10 * Math.PI) / 180, X0 = -523.4621, Y0 = -3758.645;
function project([lon, lat]) {
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180;
  const m = (1 + Math.sin(PHI0)) / (1 + Math.sin(phi));
  return [R * m * Math.cos(phi) * Math.sin(lam - LAM0) - X0, Y0 + R * m * Math.cos(phi) * Math.cos(lam - LAM0)];
}

const GRID = 900;
const PAD = 40; // km kept beyond the grid edge, for the rubber-band overscroll
const MIN = -PAD, MAX = GRID + PAD;
// Only features near central Europe are projected at all.
const nearby = coords => coords.some(([lon, lat]) => lon > -2 && lon < 22 && lat > 43.5 && lat < 58.5);

// ---- geometry helpers ----
// Douglas-Peucker; `tol` in km.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let worst = -1, dist = tol;
    for (let i = a + 1; i < b; i++) {
      // a closed ring starts and ends on the same point: measure from that point instead of a zero-length baseline
      const d = len < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay) : Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > dist) { dist = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Sutherland-Hodgman: clips a closed ring to the padded grid rectangle.
function clipRing(ring) {
  const edges = [
    [p => p[0] >= MIN, (a, b) => [MIN, a[1] + ((b[1] - a[1]) * (MIN - a[0])) / (b[0] - a[0])]],
    [p => p[0] <= MAX, (a, b) => [MAX, a[1] + ((b[1] - a[1]) * (MAX - a[0])) / (b[0] - a[0])]],
    [p => p[1] >= MIN, (a, b) => [a[0] + ((b[0] - a[0]) * (MIN - a[1])) / (b[1] - a[1]), MIN]],
    [p => p[1] <= MAX, (a, b) => [a[0] + ((b[0] - a[0]) * (MAX - a[1])) / (b[1] - a[1]), MAX]],
  ];
  let out = ring;
  for (const [inside, cut] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      if (inside(cur)) { if (!inside(prev)) out.push(cut(prev, cur)); out.push(cur); }
      else if (inside(prev)) out.push(cut(prev, cur));
    }
    if (out.length < 3) return [];
  }
  return out;
}

// Splits an open line into the runs that lie inside the padded rectangle.
function clipLine(line) {
  const inside = p => p[0] >= MIN && p[0] <= MAX && p[1] >= MIN && p[1] <= MAX;
  const runs = [];
  let run = [];
  line.forEach((p, i) => {
    if (inside(p)) { if (!run.length && i > 0) run.push(line[i - 1]); run.push(p); }
    else if (run.length) { run.push(p); runs.push(run); run = []; }
  });
  if (run.length) runs.push(run);
  return runs;
}

const area = ring => Math.abs(ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const num = n => String(Math.round(n * 10) / 10);
const pathOf = (pts, close) => 'M' + pts.map(p => `${num(p[0])},${num(p[1])}`).join('L') + (close ? 'Z' : '');

const polygonsOf = g => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const linesOf = g => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);

function polygonPaths(features, tol, minArea) {
  const paths = [];
  for (const f of features) for (const poly of polygonsOf(f.geometry)) {
    if (!nearby(poly[0])) continue;
    for (const ring of poly) {
      const clipped = simplify(clipRing(ring.map(project)), tol);
      if (clipped.length >= 3 && area(clipped) >= minArea) paths.push(pathOf(clipped, true));
    }
  }
  return paths.join('');
}

function linePaths(features, tol, minLength) {
  const paths = [];
  for (const f of features) for (const line of linesOf(f.geometry)) {
    if (!nearby(line)) continue;
    for (const run of clipLine(line.map(project))) {
      const s = simplify(run, tol);
      const length = s.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - s[i - 1][0], p[1] - s[i - 1][1]) : 0), 0);
      if (s.length >= 2 && length >= minLength) paths.push(pathOf(s, false));
    }
  }
  return paths.join('');
}

async function load(name) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, `${name}.geojson`);
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
    process.stdout.write(`downloading ${name} … `);
    const res = await fetch(`${SOURCE}/${name}.geojson`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    console.log('done');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')).features;
}

const countries = await load('ne_10m_admin_0_countries');
const stateLines = await load('ne_10m_admin_1_states_provinces_lines');
const rivers = [...await load('ne_10m_rivers_lake_centerlines'), ...await load('ne_10m_rivers_europe')];
const lakes = [...await load('ne_10m_lakes'), ...await load('ne_10m_lakes_europe')];

const TOL = 0.3; // km — finer than a screen pixel until the map is zoomed in ~3x
const map = {
  source: 'Natural Earth 1:10m (public domain)',
  // every country as a filled shape: fill = land, its outline = borders and coast
  land: polygonPaths(countries.filter(f => f.properties.ADM0_A3 !== 'DEU'), TOL, 3),
  germany: polygonPaths(countries.filter(f => f.properties.ADM0_A3 === 'DEU'), TOL, 1),
  states: linePaths(stateLines.filter(f => f.properties.ADM0_A3 === 'DEU'), TOL, 2),
  // the big rivers people navigate by, and the smaller ones for when zoomed in
  rivers: linePaths(rivers.filter(f => f.properties.scalerank <= 6), TOL, 8),
  streams: linePaths(rivers.filter(f => f.properties.scalerank > 6 && f.properties.scalerank <= 9), TOL, 8),
  lakes: polygonPaths(lakes, 0.2, 6),
};

fs.writeFileSync(outFile, JSON.stringify(map));
for (const [k, v] of Object.entries(map)) console.log(k.padEnd(8), `${(v.length / 1024).toFixed(1)} KB`);
console.log(`wrote ${path.relative(process.cwd(), outFile)} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KB)`);
