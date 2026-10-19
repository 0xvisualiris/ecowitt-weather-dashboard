// Stores the readings of the direct Ecowitt source, which – unlike Home
// Assistant – has no recorder behind it. Two kinds of file in DATA_DIR/ecowitt:
//
//   samples-YYYY-MM-DD.jsonl  every poll, {"t":ms,"v":{key:value}}; the last
//                             `keepDays` days only (raw history, like HA's
//                             recorder purge)
//   hours.jsonl               one line per completed hour, kept forever:
//                             {"t":hourStart,"s":{key:[mean,min,max,last,change,n]}}
//
// The hourly rows are derived from the samples, so a restart rebuilds any hour
// that was not written yet. `statistics()` answers in the same shape as HA's
// recorder/statistics_during_period, `history()` like history_during_period.
import fs from 'node:fs';
import path from 'node:path';
import { DAY, startOfHour, startOfDay, startOfMonth, counterIncrements } from './util.js';

export const COUNTER_KEYS = new Set(['rain_daily', 'lightning_count']);

const pad = n => String(n).padStart(2, '0');
const dayName = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

// Aggregates the samples of one hour (plus the last sample before it, which
// counters need to tell how much was added in this hour).
export function aggregateHour(samples, prev) {
  const acc = {};
  for (const { v } of samples) {
    for (const [k, x] of Object.entries(v)) {
      if (typeof x !== 'number' || !Number.isFinite(x)) continue;
      const a = acc[k] ??= { sum: 0, n: 0, min: Infinity, max: -Infinity, last: null };
      a.sum += x; a.n++; a.min = Math.min(a.min, x); a.max = Math.max(a.max, x); a.last = x;
    }
  }
  const out = {};
  for (const [k, a] of Object.entries(acc)) {
    let change = null;
    if (COUNTER_KEYS.has(k)) {
      const pts = [prev?.v?.[k], ...samples.map(s => s.v[k])]
        .filter(x => typeof x === 'number').map(v => ({ v }));
      // No earlier reading: count from the first one of this hour.
      if (typeof prev?.v?.[k] !== 'number') pts.unshift({ v: pts[0]?.v ?? 0 });
      change = counterIncrements(pts).reduce((s, p) => s + p.v, 0);
    }
    out[k] = [a.sum / a.n, a.min, a.max, a.last, change, a.n];
  }
  return out;
}

// Merges hourly rows into one row per `period` (hour | day | month, in station time).
export function rollup(hours, key, period) {
  const bucketOf = period === 'hour' ? t => t : period === 'day' ? startOfDay : startOfMonth;
  const groups = new Map();
  for (const h of hours) {
    const r = h.s[key];
    if (!r) continue;
    const b = bucketOf(h.t);
    const g = groups.get(b) ?? { start: b, sum: 0, n: 0, min: Infinity, max: -Infinity, state: null, change: null };
    const [mean, min, max, last, change, n] = r;
    g.sum += mean * n; g.n += n;
    g.min = Math.min(g.min, min); g.max = Math.max(g.max, max); g.state = last;
    if (change != null) g.change = (g.change ?? 0) + change;
    groups.set(b, g);
  }
  return [...groups.values()].sort((a, b) => a.start - b.start)
    .map(g => ({ start: g.start, mean: g.sum / g.n, min: g.min, max: g.max, state: g.state, change: g.change }));
}

export class Recorder {
  constructor(dir, { keepDays = 10 } = {}) {
    this.dir = dir;
    this.keepDays = keepDays;
    this.samples = [];        // [{ t, v }], oldest first
    this.hours = new Map();   // hourStart -> { key: [mean, min, max, last, change, n] }
    this.writable = true;
  }

  load() {
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch (e) { this._notWritable(e); }
    const cutoff = Date.now() - this.keepDays * DAY;
    let files = [];
    try { files = fs.readdirSync(this.dir).filter(f => /^samples-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort(); } catch { /* fresh start */ }
    for (const f of files) {
      for (const row of this._readLines(f)) if (row.t >= cutoff) this.samples.push(row);
    }
    this.samples.sort((a, b) => a.t - b.t);
    for (const row of this._readLines('hours.jsonl')) this.hours.set(row.t, row.s);
    this._compact();
    this._purge();
    console.log(`[recorder] ${this.samples.length} samples, ${this.hours.size} hourly rows loaded from ${this.dir}`);
  }

  _readLines(file) {
    let text;
    try { text = fs.readFileSync(path.join(this.dir, file), 'utf8'); } catch { return []; }
    const out = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch { /* a line cut short by a crash */ }
    }
    return out;
  }

  _append(file, row) {
    if (!this.writable) return;
    try { fs.appendFileSync(path.join(this.dir, file), JSON.stringify(row) + '\n'); } catch (e) { this._notWritable(e); }
  }

  _notWritable(e) {
    if (!this.writable) return;
    this.writable = false;
    console.warn(`[recorder] cannot write to ${this.dir} (${e.message}) – history is kept in memory only and lost on restart`);
  }

  add(t, values) {
    const row = { t, v: values };
    this.samples.push(row);
    this._append(`samples-${dayName(t)}.jsonl`, row);
    this._compact(startOfHour(t));
    if (startOfDay(t) !== this._lastPurgeDay) this._purge();
  }

  // Writes an hourly row for every hour before `current` that has samples but
  // no row yet. While polling, an hour is complete once a sample of a later
  // hour arrives; at load time, once the clock has moved past it.
  _compact(current = startOfHour()) {
    const byHour = new Map();
    for (const s of this.samples) {
      const h = startOfHour(s.t);
      if (h >= current || this.hours.has(h)) continue;
      if (!byHour.has(h)) byHour.set(h, []);
      byHour.get(h).push(s);
    }
    for (const [h, rows] of [...byHour].sort((a, b) => a[0] - b[0])) {
      const s = aggregateHour(rows, this._before(h));
      this.hours.set(h, s);
      this._append('hours.jsonl', { t: h, s });
    }
  }

  _before(t) {
    let prev = null;
    for (const s of this.samples) { if (s.t >= t) break; prev = s; }
    return prev;
  }

  _purge() {
    this._lastPurgeDay = startOfDay();
    const cutoff = Date.now() - this.keepDays * DAY;
    this.samples = this.samples.filter(s => s.t >= cutoff);
    const keep = dayName(cutoff);
    try {
      for (const f of fs.readdirSync(this.dir)) {
        const m = /^samples-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
        if (m && m[1] < keep) fs.unlinkSync(path.join(this.dir, f));
      }
    } catch { /* not fatal */ }
  }

  // { key: [{ t: ms, s: value }] }, including the last reading before `start`.
  history(keys, start, end) {
    const out = {};
    for (const k of keys) {
      const rows = [];
      let before = null;
      for (const s of this.samples) {
        if (!(k in s.v)) continue;
        if (s.t < start) { before = s; continue; }
        if (s.t > end) break;
        rows.push({ t: s.t, s: s.v[k] });
      }
      if (before) rows.unshift({ t: start, s: before.v[k] });
      out[k] = rows;
    }
    return out;
  }

  // { key: [{ start, mean, min, max, state, change }] }, the running hour included.
  statistics(keys, start, end, period) {
    const hours = [];
    for (const [t, s] of this.hours) if (t >= start && t < end) hours.push({ t, s });
    const current = startOfHour();
    if (current >= start && current < end) {
      const rows = this.samples.filter(s => s.t >= current);
      if (rows.length) hours.push({ t: current, s: aggregateHour(rows, this._before(current)) });
    }
    hours.sort((a, b) => a.t - b.t);
    const out = {};
    for (const k of keys) out[k] = rollup(hours, k, period);
    return out;
  }
}

