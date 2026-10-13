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

// Spreads a daily forecast (lo/hi/pop/conditionCode per day) over single
// hours, for /api/forecast/hourly when there is no hourly source: a Home
// Assistant weather entity and demo mode only know whole days. The result is
// a plausible shape, not a forecast in its own right, and the API marks it
// `synthetic` so the frontend can say so. Deterministic: the same day and
// hour always give the same values, so a reload doesn't reshuffle the chart.
export function hourlyFromDays(days, from, count) {
  const noise = n => { const x = Math.sin(n * 91.7) * 43758.5453; return x - Math.floor(x); };
  const COVER = { sunny: 5, 'clear-night': 5, partlycloudy: 35, cloudy: 80, rainy: 90, pouring: 100, 'lightning-rainy': 90, fog: 100, snowy: 95 };
  const out = [];
  if (!days?.length) return out;
  for (let i = 0; i < count; i++) {
    const t = from + i * HOUR, hour = new Date(t).getHours(), n = t / HOUR;
    const day = days.find(d => startOfDay(d.date) === startOfDay(t)) ?? days[days.length - 1];
    const lo = day.lo ?? 8, hi = day.hi ?? 16;
    const warmth = 0.5 - 0.5 * Math.cos(((hour - 4) / 24) * 2 * Math.PI); // coldest around 4, warmest around 16
    const wet = (day.pop ?? 0) / 100;
    const afternoon = Math.exp(-(((hour - 16) / 5) ** 2));
    const pop = Math.round(Math.min(100, (day.pop ?? 0) * (0.35 + 0.65 * afternoon) + noise(n) * 8));
    const raining = pop > 45 && noise(n + 7) < wet;
    const cloud = Math.max(0, Math.min(100, (COVER[day.conditionCode] ?? 50) + (noise(n + 3) - 0.5) * 30));
    const light = hour >= 7 && hour <= 18;
    const stormy = /lightning/.test(day.conditionCode ?? '') && raining && hour >= 12;
    const wind = 6 + 9 * warmth + noise(n + 11) * 6 + wet * 6;
    out.push({
      t,
      temp: round(lo + (hi - lo) * warmth + (noise(n + 5) - 0.5) * 0.6, 1),
      conditionCode: stormy ? 'lightning-rainy' : raining ? (pop > 85 ? 'pouring' : 'rainy') : cloud > 70 ? 'cloudy' : cloud > 25 ? (light ? 'partlycloudy' : 'cloudy') : light ? 'sunny' : 'clear-night',
      pop,
      rain: raining ? round(0.2 + noise(n + 13) * 1.6 * (0.5 + wet), 1) : 0,
      wind: round(wind, 1),
      gust: round(wind * (1.5 + noise(n + 17) * 0.5), 1),
      sunMin: light ? Math.round(60 * Math.max(0, 1 - cloud / 100) * (hour === 7 || hour === 18 ? 0.5 : 1)) : 0,
      cloud: Math.round(cloud),
    });
  }
  return out;
}
