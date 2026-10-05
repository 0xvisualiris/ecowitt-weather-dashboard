// Projects WGS84 lon/lat onto DWD's RADOLAN national-composite pixel grid
// (900x900, 1km resolution) — a polar stereographic projection, standard
// parallel 60°N, reference meridian 10°E, Earth radius 6370.040 km (DWD's
// own RADOLAN grid definition, not a generic one). The four corner
// coordinates below are DWD's documented corners for this exact grid;
// projecting them with the formula below reproduces a near-perfect 900x900
// km axis-aligned square, which is how this was validated against a real
// decoded RADOLAN file and this app's own (independently verified) Germany
// outline before being wired into the radar screen.
const R = 6370.040;
const PHI0 = (60 * Math.PI) / 180;
const LAM0 = (10 * Math.PI) / 180;
// West and north edges of the grid, in the same projected km space (derived
// from the documented SW/NW corners: 3.5884°E/46.9526°N and 2.0715°E/54.5877°N).
const X0 = -523.4621;
const Y0 = -3758.645;

function stereographic(lon: number, lat: number): [number, number] {
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const m = (1 + Math.sin(PHI0)) / (1 + Math.sin(phi));
  const x = R * m * Math.cos(phi) * Math.sin(lam - LAM0);
  const y = -R * m * Math.cos(phi) * Math.cos(lam - LAM0);
  return [x, y];
}

/** lon/lat -> [col, row] in the 900x900 RADOLAN RY/RW grid (1 unit = 1 km = 1 pixel). */
export function lonLatToRadolanPixel(lon: number, lat: number): [number, number] {
  const [x, y] = stereographic(lon, lat);
  return [x - X0, Y0 - y];
}
