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
