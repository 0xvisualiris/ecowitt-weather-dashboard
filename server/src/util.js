// Local-time helpers. process.env.TZ is set to the station time zone at startup,
// so plain Date methods operate in station time.
export const HOUR = 3600000;
export const DAY = 24 * HOUR;

export function startOfDay(t = Date.now()) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function startOfWeek(t = Date.now()) {
  const d = new Date(startOfDay(t));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}
export function startOfMonth(t = Date.now()) { const d = new Date(startOfDay(t)); d.setDate(1); return d.getTime(); }
export function startOfYear(t = Date.now()) { const d = new Date(startOfDay(t)); d.setMonth(0, 1); return d.getTime(); }
export function startOfHour(t = Date.now()) { const d = new Date(t); d.setMinutes(0, 0, 0); return d.getTime(); }

// Tiny TTL cache with in-flight de-duplication.
export function makeCache() {
  const store = new Map();
  return async function cached(key, ttl, fn) {
    const hit = store.get(key);
    const now = Date.now();
    if (hit && (hit.pending || now - hit.at < ttl)) return hit.pending || hit.value;
    const pending = (async () => fn())();
    store.set(key, { ...hit, pending });
    try {
      const value = await pending;
      store.set(key, { value, at: Date.now() });
      return value;
    } catch (e) {
      if (hit && 'value' in hit) { store.set(key, hit); return hit.value; } // serve stale on error
      store.delete(key);
      throw e;
    }
  };
}

// Turn a series of counter readings (daily rain, strike counters, …) into
// increments, treating any drop as a reset.
export function counterIncrements(points) {
  const out = [];
  let prev = null;
  for (const p of points) {
    if (p.v == null) continue;
    if (prev == null) { prev = p.v; continue; }
    const inc = p.v >= prev ? p.v - prev : p.v;
    out.push({ t: p.t, v: inc });
    prev = p.v;
  }
  return out;
}

export const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

// Buckets a mean-aggregated series (temp, humidity, pressure, …) into fixed-size
// windows, holding the last known value across gaps so a bucket with no fresh
// points still carries forward the prior reading instead of going null.
export function bucketLine(points, start, end, size) {
  const n = Math.ceil((end - start) / size);
  const out = [];
  let i = 0, held = null;
  while (i < points.length && points[i].t < start) { held = points[i].v; i++; }
  for (let b = 0; b < n; b++) {
    const bs = start + b * size, be = bs + size;
    const vals = held != null ? [held] : [];
    while (i < points.length && points[i].t < be) { vals.push(points[i].v); held = points[i].v; i++; }
    if (!vals.length) { out.push({ t: bs, v: null }); continue; }
    out.push({ t: bs, v: vals.reduce((a, c) => a + c, 0) / vals.length, lo: Math.min(...vals), hi: Math.max(...vals) });
  }
  return out;
}

// Buckets a counter series (rain, lightning strikes, …) by summing increments
// (see counterIncrements) that fall into each fixed-size window.
export function bucketCounter(points, start, end, size) {
  const inc = counterIncrements(points);
  const n = Math.ceil((end - start) / size);
  const out = Array.from({ length: n }, (_, b) => ({ t: start + b * size, v: 0 }));
  for (const p of inc) {
    if (p.t < start || p.t >= end) continue;
    out[Math.floor((p.t - start) / size)].v += p.v;
  }
  return out;
}
