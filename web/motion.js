// Where the rain is heading: compares two radar grids a few minutes apart and finds, for each
// patch of the map with enough rain, the shift that makes the older grid match the newer one best
// (block matching). One grid cell is one kilometre, so the shift is the distance moved.
//
// Cheap enough for the browser: the 900 × 900 grid is averaged into 3 km cells first, a patch is
// 20 × 20 of those (60 km), and a shift of up to 10 cells (30 km, 120 km/h over 15 minutes) is tried.

const GRID = 900, CELL = 3, N = GRID / CELL, PATCH = 20, MAX_SHIFT = 10;
const MIN_RAIN_CELLS = 12;   // a patch with less rain than this has nothing to follow

// Mean rain class per 3 km cell; NaN where more than half of it is outside radar range.
function coarse(grid) {
  const out = new Float32Array(N * N);
  for (let cy = 0; cy < N; cy++) {
    for (let cx = 0; cx < N; cx++) {
      let sum = 0, n = 0, none = 0;
      for (let y = cy * CELL; y < cy * CELL + CELL; y++) {
        for (let x = cx * CELL; x < cx * CELL + CELL; x++) {
          const v = grid[y * GRID + x];
          if (v === 255) none++; else { sum += v; n++; }
        }
      }
      out[cy * N + cx] = none > (CELL * CELL) / 2 ? NaN : sum / n;
    }
  }
  return out;
}

// Mean absolute difference between the patch at (px, py) in `b` and the same patch shifted
// back by (dx, dy) in `a`, over the cells both grids cover.
function cost(a, b, px, py, dx, dy) {
  let sum = 0, n = 0;
  for (let y = py; y < py + PATCH; y++) {
    const ay = y - dy;
    if (ay < 0 || ay >= N) continue;
    for (let x = px; x < px + PATCH; x++) {
      const ax = x - dx;
      if (ax < 0 || ax >= N) continue;
      const vb = b[y * N + x], va = a[ay * N + ax];
      if (Number.isNaN(va) || Number.isNaN(vb)) continue;
      sum += Math.abs(va - vb); n++;
    }
  }
  return n > (PATCH * PATCH) / 2 ? sum / n : Infinity;
}

// `older` and `newer`: Uint8Array(900 × 900) grids `minutes` apart. Returns one vector per patch
// that has rain and a clear best match: { x, y } its centre in grid km, { vx, vy } in km/h
// (x east, y south), `speed` in km/h and `bearing`, the compass direction it moves towards.
export function motionField(older, newer, minutes) {
  if (!older || !newer || !(minutes > 0)) return [];
  const a = coarse(older), b = coarse(newer), out = [];
  for (let py = 0; py + PATCH <= N; py += PATCH) {
    for (let px = 0; px + PATCH <= N; px += PATCH) {
      let rainy = 0, none = 0;
      for (let y = py; y < py + PATCH; y++) {
        for (let x = px; x < px + PATCH; x++) {
          const v = b[y * N + x];
          if (Number.isNaN(v) || Number.isNaN(a[y * N + x])) none++; else if (v > 0.5) rainy++;
        }
      }
      // Rain cut off by the edge of the radar coverage seems to move into or out of it: not followed.
      if (rainy < MIN_RAIN_CELLS || none > PATCH * PATCH * 0.05) continue;
      let best = Infinity, bdx = 0, bdy = 0;
      for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++) {
        for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
          // A slight preference for small shifts, so a flat patch doesn't jump to a far, equal match.
          const c = cost(a, b, px, py, dx, dy) * (1 + 0.004 * Math.hypot(dx, dy));
          if (c < best) { best = c; bdx = dx; bdy = dy; }
        }
      }
      // A match at the edge of the search, or one hardly better than standing still, isn't trusted.
      const still = cost(a, b, px, py, 0, 0);
      if (!Number.isFinite(best) || Math.abs(bdx) === MAX_SHIFT || Math.abs(bdy) === MAX_SHIFT) continue;
      if ((bdx || bdy) && best > still * 0.9) continue;
      const vx = (bdx * CELL) / minutes * 60, vy = (bdy * CELL) / minutes * 60;
      out.push({ x: (px + PATCH / 2) * CELL, y: (py + PATCH / 2) * CELL, vx, vy });
    }
  }
  return steady(out);
}

const SPAN = PATCH * CELL;   // 60 km between neighbouring patches
const median = (xs) => { const s = [...xs].sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Single patches of light, ragged rain can match the wrong way. Showers move with the wind of their
// surroundings, so each vector is replaced by the median of itself and its neighbours; one without
// neighbours is kept only if it is unremarkable.
export function steady(field) {
  const out = [];
  for (const v of field) {
    const near = field.filter((w) => Math.abs(w.x - v.x) <= SPAN && Math.abs(w.y - v.y) <= SPAN);
    if (near.length < 2 && Math.hypot(v.vx, v.vy) > 60) continue;
    const vx = near.length >= 3 ? median(near.map((w) => w.vx)) : v.vx;
    const vy = near.length >= 3 ? median(near.map((w) => w.vy)) : v.vy;
    out.push({ x: v.x, y: v.y, vx, vy, speed: Math.hypot(vx, vy), bearing: (Math.atan2(vx, -vy) * 180 / Math.PI + 360) % 360 });
  }
  return out;
}
