import { normalize, toNumber, SENSOR_DIMENSION } from './units.js';
import { astro } from './astro.js';
import {
  HOUR, DAY, startOfDay, startOfWeek, startOfMonth, startOfYear, startOfHour,
  makeCache, counterIncrements, round,
} from './util.js';

// Fixed metric set the UI knows about. Which ones are shown depends on the configured sensors.
export const METRICS = {
  temp: { sensor: 'temperature', agg: 'mean' },
  hum: { sensor: 'humidity', agg: 'mean' },
  wind: { sensor: 'wind_speed', agg: 'mean', recordSensor: 'wind_gust' },
  rain: { sensor: 'rain_daily', agg: 'counter' },
  press: { sensor: 'pressure', agg: 'mean' },
  solar: { sensor: 'solar_radiation', agg: 'mean', noMinRecord: true },
  uv: { sensor: 'uv_index', agg: 'mean', noMinRecord: true },
  light: { sensor: 'lightning_count', agg: 'counter', currentSensor: 'lightning_distance' },
};

const FORECAST_DE = {
  'clear-night': 'Klar', cloudy: 'Bewölkt', exceptional: 'Unwetter', fog: 'Nebel', hail: 'Hagel',
  lightning: 'Gewitter', 'lightning-rainy': 'Gewitter', partlycloudy: 'Heiter', pouring: 'Starkregen',
  rainy: 'Regen', snowy: 'Schnee', 'snowy-rainy': 'Schneeregen', sunny: 'Sonnig', windy: 'Windig',
  'windy-variant': 'Windig, bewölkt',
};

export class WeatherService {
  constructor(cfg, source) {
    this.cfg = cfg;
    this.src = source;
    this.cache = makeCache();
    this.entityToKey = Object.fromEntries(Object.entries(cfg.sensors).map(([k, id]) => [id, k]));
  }

  // ---------- current state ----------
  entity(key) { return this.cfg.sensors[key] ? this.src.states[this.cfg.sensors[key]] : undefined; }
  value(key) {
    const e = this.entity(key);
    if (!e) return null;
    return normalize(key, e.state, e.attributes?.unit_of_measurement);
  }
  rawEntity(id) { return this.src.states[id]; }
  has(key) { return !!this.cfg.sensors[key]; }
  metricAvailable(m) { return this.has(METRICS[m].sensor) || (METRICS[m].currentSensor && this.has(METRICS[m].currentSensor)); }

  lastUpdate() {
    let t = 0;
    for (const id of Object.values(this.cfg.sensors)) t = Math.max(t, this.src.states[id]?.lu || 0);
    return t || null;
  }

  location() {
    const s = this.cfg.station;
    if (s.latitude != null && s.longitude != null) return { latitude: s.latitude, longitude: s.longitude };
    return this.src.location();
  }

  // ---------- raw history of the last ~25 h for every configured sensor ----------
  dayRaw() {
    return this.cache('dayRaw', Math.min(60000, this.cfg.server.cache.history), async () => {
      const end = Date.now(), start = end - 25 * HOUR;
      const ids = Object.entries(this.cfg.sensors).filter(([k]) => k !== 'lightning_time').map(([, id]) => id);
      const res = await this.src.history(ids, start, end);
      const out = {};
      for (const [id, rows] of Object.entries(res)) {
        const key = this.entityToKey[id];
        if (!key) continue;
        const unit = this.src.states[id]?.attributes?.unit_of_measurement;
        out[key] = rows.map(r => ({ t: r.t, v: normalize(key, r.s, unit) })).filter(p => p.v != null).sort((a, b) => a.t - b.t);
      }
      return out;
    });
  }

  // Daily long-term statistics since commissioning (records, yesterday, month/year totals)
  dailyStats() {
    return this.cache('dailyStats', this.cfg.server.cache.records, async () => {
      const since = this.cfg.station.since ? Date.parse(this.cfg.station.since) : Date.now() - 10 * 365 * DAY;
      const start = startOfDay(Number.isFinite(since) ? since : Date.now() - 365 * DAY);
      return this._stats(start, Date.now(), 'day');
    });
  }

  async _stats(start, end, period) {
    const keys = Object.keys(this.cfg.sensors).filter(k => k !== 'lightning_time' && k !== 'wind_direction');
    const ids = keys.map(k => this.cfg.sensors[k]);
    const res = await this.src.statistics(ids, start, end, period);
    const out = {};
    for (const [id, rows] of Object.entries(res)) {
      const key = this.entityToKey[id];
      if (!key) continue;
      const unit = this.src.states[id]?.attributes?.unit_of_measurement;
      const n = v => (v == null ? null : normalize(key, v, unit));
      let series = rows.map(r => ({ t: r.start, mean: n(r.mean), min: n(r.min), max: n(r.max), change: n(r.change), state: n(r.state) }));
      if (key === 'rain_daily' || key === 'lightning_count') series = this._counterFromStats(series);
      out[key] = series;
    }
    return out;
  }

  // Prefer HA's "change"; otherwise derive increments from max/state readings.
  _counterFromStats(rows) {
    if (rows.some(r => r.change != null)) return rows.map(r => ({ ...r, amount: Math.max(0, r.change ?? 0) }));
    const pts = rows.map(r => ({ t: r.t, v: r.state ?? r.max }));
    const inc = counterIncrements([{ t: 0, v: 0 }, ...pts]);
    return rows.map((r, i) => ({ ...r, amount: inc[i]?.v ?? 0 }));
  }

  // ---------- bucketing helpers ----------
  _bucketLine(points, start, end, size) {
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

  _bucketCounter(points, start, end, size) {
    const inc = counterIncrements(points);
    const n = Math.ceil((end - start) / size);
    const out = Array.from({ length: n }, (_, b) => ({ t: start + b * size, v: 0 }));
    for (const p of inc) {
      if (p.t < start || p.t >= end) continue;
      out[Math.floor((p.t - start) / size)].v += p.v;
    }
    return out;
  }

  // ---------- /api/current ----------
  async current() {
    return this.cache('current', this.cfg.server.cache.live, async () => {
      const v = {};
      for (const key of Object.keys(this.cfg.sensors)) {
        if (key === 'lightning_time') {
          const e = this.entity(key);
          const t = e && Date.parse(e.state);
          v[key] = Number.isFinite(t) ? t : null;
        } else v[key] = round(this.value(key), 3);
      }

      let raw = {};
      try { raw = await this.dayRaw(); } catch (e) { console.warn('[service] history unavailable:', e.message); }
      const now = Date.now(), sod = startOfDay(now);
      const todayRange = key => {
        const pts = (raw[key] || []).filter(p => p.t >= sod).map(p => p.v);
        if (v[key] != null) pts.push(v[key]);
        return pts.length ? { min: Math.min(...pts), max: Math.max(...pts) } : null;
      };

      // 24 h sparklines
      const end = now, start = now - DAY;
      const spark = {};
      for (const [m, key, size] of [['temp', 'temperature', 15], ['hum', 'humidity', 15], ['press', 'pressure', 15]]) {
        if (raw[key]) spark[m] = this._bucketLine(raw[key], start, end, size * 60000).map(p => round(p.v, 2));
      }
      if (raw.rain_daily) spark.rain = this._bucketCounter(raw.rain_daily, start, end, 30 * 60000).map(p => round(p.v, 2));
      if (raw.lightning_count) spark.light = this._bucketCounter(raw.lightning_count, start, end, HOUR).map(p => p.v);

      // pressure trend over 3 h
      let pressureTrend = null;
      if (raw.pressure?.length && v.pressure != null) {
        const target = now - 3 * HOUR;
        let best = null;
        for (const p of raw.pressure) if (p.t <= target) best = p;
        if (best) pressureTrend = round(v.pressure - best.v, 2);
      }

      const rain = {
        rate: v.rain_rate ?? null, day: v.rain_daily ?? null, event: v.rain_event ?? null,
        week: v.rain_weekly ?? null, month: v.rain_monthly ?? null, year: v.rain_yearly ?? null,
      };
      if (this.has('rain_daily') && (rain.week == null || rain.month == null || rain.year == null)) {
        try {
          const daily = (await this.dailyStats()).rain_daily || [];
          const sumSince = s => round(daily.filter(r => r.t >= s && r.t < sod).reduce((a, r) => a + r.amount, 0) + (rain.day || 0), 1);
          rain.week ??= sumSince(startOfWeek(now));
          rain.month ??= sumSince(startOfMonth(now));
          rain.year ??= sumSince(startOfYear(now));
        } catch (e) { console.warn('[service] rain totals unavailable:', e.message); }
      }

      const loc = this.location();
      return {
        updated: this.lastUpdate(),
        connected: this.src.connected,
        values: v,
        today: {
          temp: todayRange('temperature'), hum: todayRange('humidity'),
          gustMax: todayRange('wind_gust')?.max ?? todayRange('wind_speed')?.max ?? null,
          uvMax: todayRange('uv_index')?.max ?? null,
        },
        rain,
        pressureTrend,
        spark,
        forecast: this.forecast(),
        astro: loc ? astro(loc.latitude, loc.longitude, now) : null,
        devices: this.devices(),
      };
    });
  }

  forecast() {
    const f = this.src.forecast;
    if (!f?.length) return null;
    const entity = this.cfg.forecast.entity ? this.src.states[this.cfg.forecast.entity] : null;
    return {
      source: this.cfg.forecast.label || entity?.attributes?.attribution?.replace(/^Weather forecast from /i, '') || 'Vorhersage',
      days: f.slice(0, this.cfg.forecast.days).map(d => ({
        date: Date.parse(d.datetime),
        condition: FORECAST_DE[d.condition] || d.condition || '—',
        conditionCode: d.condition,
        pop: d.precipitation_probability ?? null,
        lo: d.templow != null ? normalize('temperature', d.templow, entity?.attributes?.temperature_unit || '°C') : null,
        hi: d.temperature != null ? normalize('temperature', d.temperature, entity?.attributes?.temperature_unit || '°C') : null,
      })),
    };
  }

  devices() {
    const fmt = id => {
      if (!id) return null;
      const e = this.src.states[id];
      if (!e || e.state === 'unknown' || e.state === 'unavailable') return null;
      const n = toNumber(e.state);
      const u = e.attributes?.unit_of_measurement || '';
      if (n == null) return e.state;
      const s = n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
      return u === '%' ? `${s} %` : u ? `${s} ${u}` : s;
    };
    return this.cfg.station.devices.map(d => ({
      id: d.id, name: d.name, short: d.short, role: d.role, metrics: d.metrics,
      battery: fmt(d.battery), signal: fmt(d.signal),
    }));
  }

  // ---------- /api/history ----------
  async history(metric, range) {
    const M = METRICS[metric];
    if (!M || !this.has(M.sensor)) throw Object.assign(new Error('unknown or unconfigured metric'), { status: 404 });
    if (!['day', 'week', 'month', 'year'].includes(range)) throw Object.assign(new Error('range must be day|week|month|year'), { status: 400 });
    return this.cache(`hist:${metric}:${range}`, range === 'day' ? 60000 : this.cfg.server.cache.history, async () => {
      const now = Date.now();
      let points, nearest = null, extra = {};
      if (range === 'day') {
        const raw = await this.dayRaw();
        const start = now - DAY;
        if (M.agg === 'counter') {
          const size = metric === 'light' ? HOUR : 30 * 60000;
          points = this._bucketCounter(raw[M.sensor] || [], start, now, size);
        } else {
          points = this._bucketLine(raw[M.sensor] || [], start, now, 10 * 60000);
        }
        if (metric === 'light') {
          const d = (raw.lightning_distance || []).filter(p => p.t >= start).map(p => p.v);
          const hadStrikes = points.some(p => p.v > 0);
          nearest = hadStrikes && d.length ? Math.min(...d) : null;
        }
      } else {
        const period = range === 'week' ? 'hour' : 'day';
        const start = range === 'week' ? startOfHour(now) - 7 * DAY + HOUR
          : range === 'month' ? startOfDay(now) - 29 * DAY : startOfDay(now) - 364 * DAY;
        const stats = await this._stats(start, now, period);
        const rows = stats[M.sensor] || [];
        points = rows.map(r => M.agg === 'counter'
          ? { t: r.t, v: round(r.amount, 2) }
          : { t: r.t, v: r.mean, lo: r.min, hi: r.max });
        if (metric === 'light') {
          const d = (stats.lightning_distance || []).map(r => r.min).filter(x => x != null);
          nearest = d.length ? Math.min(...d) : null;
        }
        extra.period = period;
      }
      points = points.map(p => ({ t: p.t, v: round(p.v, 3), ...(p.lo != null ? { lo: round(p.lo, 3), hi: round(p.hi, 3) } : {}) }));
      return { metric, range, agg: M.agg, points, stats: this._rangeStats(metric, range, points, nearest), ...extra };
    });
  }

  _rangeStats(metric, range, points, nearest) {
    const vals = points.filter(p => p.v != null);
    if (!vals.length) return [];
    if (metric === 'rain' || metric === 'light') {
      const sum = vals.reduce((a, p) => a + p.v, 0);
      // group into days (or hours for the day view)
      const group = new Map();
      for (const p of vals) {
        const k = range === 'day' ? startOfHour(p.t) : startOfDay(p.t);
        group.set(k, (group.get(k) || 0) + p.v);
      }
      const groups = [...group.values()];
      if (metric === 'rain') {
        return [
          { k: 'Summe', v: round(sum, 1), kind: 'rain' },
          range === 'day' ? { k: 'Stärkste 30 min', v: round(Math.max(...vals.map(p => p.v)), 1), kind: 'rain' }
            : { k: 'Max. Tag', v: round(Math.max(...groups), 1), kind: 'rain' },
          { k: range === 'day' ? 'Stunden mit Regen' : 'Regentage', v: groups.filter(g => g >= (range === 'day' ? 0.1 : 0.2)).length, kind: 'count' },
        ];
      }
      return [
        { k: 'Einschläge', v: Math.round(sum), kind: 'count' },
        { k: 'Nächster', v: nearest, kind: 'km' },
        { k: range === 'day' ? 'Stunden mit Blitzen' : 'Gewittertage', v: groups.filter(g => g > 0).length, kind: 'count' },
      ];
    }
    const mins = vals.map(p => p.lo ?? p.v), maxs = vals.map(p => p.hi ?? p.v);
    return [
      { k: 'Min', v: round(Math.min(...mins), 2), kind: 'metric' },
      { k: 'Mittel', v: round(vals.reduce((a, p) => a + p.v, 0) / vals.length, 2), kind: 'metric' },
      { k: 'Max', v: round(Math.max(...maxs), 2), kind: 'metric' },
    ];
  }

  // ---------- /api/records ----------
  async records() {
    return this.cache('records', 60000, async () => {
      const daily = await this.dailyStats();
      let raw = {};
      try { raw = await this.dayRaw(); } catch { /* ignore */ }
      const now = Date.now(), sod = startOfDay(now), som = startOfMonth(now);
      const out = {};
      for (const [metric, M] of Object.entries(METRICS)) {
        if (!this.has(M.sensor)) continue;
        const rec = { metric, max: null, maxT: null, min: null, minT: null, maxKind: 'metric', minKind: 'metric', month: null };
        const pick = (rows, field, cmp) => {
          let best = null;
          for (const r of rows) if (r[field] != null && (best == null || cmp(r[field], best[field]))) best = r;
          return best;
        };
        if (M.agg === 'counter') {
          const rows = daily[M.sensor] || [];
          const todayAmt = this._todayCounter(raw[M.sensor]);
          const all = [...rows.filter(r => r.t < sod), { t: sod, amount: todayAmt }];
          const b = pick(all, 'amount', (a, c) => a > c);
          if (b && b.amount > 0) { rec.max = round(b.amount, 1); rec.maxT = b.t; }
          rec.maxKind = metric === 'rain' ? 'rainDay' : 'strikes';
          rec.month = { sum: round(all.filter(r => r.t >= som).reduce((a, r) => a + (r.amount || 0), 0), 1) };
          if (metric === 'light' && this.has('lightning_distance')) {
            const d = daily.lightning_distance || [];
            const bd = pick(d, 'min', (a, c) => a < c);
            if (bd) { rec.min = bd.min; rec.minT = bd.t; rec.minKind = 'km'; }
          }
        } else {
          const key = M.recordSensor && this.has(M.recordSensor) ? M.recordSensor : M.sensor;
          const rows = [...(daily[key] || [])];
          const todayPts = (raw[key] || []).filter(p => p.t >= sod).map(p => p.v);
          if (todayPts.length) rows.push({ t: sod, min: Math.min(...todayPts), max: Math.max(...todayPts), live: true });
          const bmax = pick(rows, 'max', (a, c) => a > c);
          if (bmax) { rec.max = bmax.max; rec.maxT = bmax.t; }
          if (!M.noMinRecord && !M.recordSensor) {
            const bmin = pick(rows, 'min', (a, c) => a < c);
            if (bmin) { rec.min = bmin.min; rec.minT = bmin.t; }
          }
          const mrows = rows.filter(r => r.t >= som);
          if (mrows.length) {
            rec.month = {
              min: M.noMinRecord || M.recordSensor ? null : Math.min(...mrows.map(r => r.min).filter(x => x != null)),
              max: Math.max(...mrows.map(r => r.max).filter(x => x != null)),
            };
          }
          if (M.recordSensor && this.has(M.recordSensor)) rec.maxLabel = 'Böe';
        }
        out[metric] = rec;
      }
      return { since: this.cfg.station.since, records: out };
    });
  }

  _todayCounter(points) {
    if (!points?.length) return 0;
    const sod = startOfDay();
    const inc = counterIncrements(points);
    return inc.filter(p => p.t >= sod).reduce((a, p) => a + p.v, 0);
  }

  // ---------- /api/detail ----------
  async detail(metric) {
    const M = METRICS[metric];
    if (!M || !this.metricAvailable(metric)) throw Object.assign(new Error('unknown or unconfigured metric'), { status: 404 });
    return this.cache(`detail:${metric}`, 60000, async () => {
      const raw = await this.dayRaw();
      const sod = startOfDay();
      let daily = {};
      try { daily = await this.dailyStats(); } catch (e) { console.warn('[service] daily stats unavailable:', e.message); }
      const yStart = startOfDay(sod - 12 * HOUR);
      const yRow = key => (daily[key] || []).find(r => r.t >= yStart - HOUR / 2 && r.t < sod - HOUR / 2) || null;
      const today = [];

      if (M.agg === 'counter') {
        const pts = raw[M.sensor] || [];
        const inc = counterIncrements(pts).filter(p => p.t >= sod);
        const sum = inc.reduce((a, p) => a + p.v, 0);
        const y = yRow(M.sensor);
        if (metric === 'rain') {
          const buckets = this._bucketCounter(pts, sod, Date.now(), 30 * 60000);
          const best = buckets.reduce((a, b) => (b.v > (a?.v ?? 0) ? b : a), null);
          today.push({ k: 'Summe heute', v: round(sum, 1), kind: 'rain' });
          today.push({ k: 'Stärkste 30 min', v: best ? round(best.v, 1) : 0, kind: 'rain', t: best?.t ?? null });
          if (this.has('rain_rate')) today.push({ k: 'Regenrate', v: this.value('rain_rate'), kind: 'rate' });
          today.push({ k: 'Gestern', v: y ? round(y.amount, 1) : null, kind: 'rain' });
        } else {
          const d = (raw.lightning_distance || []).filter(p => p.t >= sod);
          const near = sum > 0 && d.length ? d.reduce((a, p) => (p.v < a.v ? p : a)) : null;
          today.push({ k: 'Einschläge heute', v: Math.round(sum), kind: 'count' });
          today.push({ k: 'Nächster heute', v: near?.v ?? null, kind: 'km', t: near?.t ?? null });
          const lt = this.entity('lightning_time');
          const lts = lt && Date.parse(lt.state);
          today.push({ k: 'Letzter Einschlag', v: null, kind: 'time', t: Number.isFinite(lts) ? lts : null });
          today.push({ k: 'Gestern', v: y ? Math.round(y.amount) : null, kind: 'count' });
        }
      } else {
        const pts = (raw[M.sensor] || []).filter(p => p.t >= sod);
        if (pts.length) {
          const mn = pts.reduce((a, p) => (p.v < a.v ? p : a));
          const mx = pts.reduce((a, p) => (p.v > a.v ? p : a));
          const mean = this._bucketLine(raw[M.sensor], sod, Date.now(), 10 * 60000).filter(p => p.v != null);
          today.push({ k: 'Minimum', v: mn.v, kind: 'metric', t: mn.t });
          today.push({ k: 'Maximum', v: mx.v, kind: 'metric', t: mx.t });
          today.push({ k: 'Mittelwert', v: mean.length ? round(mean.reduce((a, p) => a + p.v, 0) / mean.length, 2) : null, kind: 'metric' });
        }
        if (metric === 'wind' && this.has('wind_gust')) {
          const g = (raw.wind_gust || []).filter(p => p.t >= sod);
          if (g.length) { const mx = g.reduce((a, p) => (p.v > a.v ? p : a)); today.push({ k: 'Stärkste Böe', v: mx.v, kind: 'metric', t: mx.t }); }
        }
        const y = yRow(M.sensor);
        today.push({ k: 'Gestern Ø', v: y?.mean ?? null, kind: 'metric' });
      }

      const recs = await this.records().catch(() => ({ records: {} }));
      const device = this.devices().find(d => d.metrics.includes(metric)) || null;
      return { metric, today, record: recs.records[metric] || null, device };
    });
  }
}

export { SENSOR_DIMENSION };
