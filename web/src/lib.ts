import { createContext, useContext, useEffect, useState } from 'react';

// ---------------- types ----------------
export type MetricKey = 'temp' | 'hum' | 'wind' | 'rain' | 'press' | 'solar' | 'uv' | 'light';
export type Range = 'day' | 'week' | 'month' | 'year';

export interface Device { id: string; name: string; short: string; role: string; metrics: string[]; battery?: string | null; signal?: string | null }
export interface AppConfig {
  station: { name: string; subtitle: string; altitude_m: number | null; since: string | null; devices: Device[] };
  timezone: string; demo: boolean; needsSetup: boolean; metrics: MetricKey[]; sensors: string[]; hasForecast: boolean;
  alertRules: { id: string; label: string; description: string; level: string }[];
  ui: { stale_after_seconds: number; refresh_seconds: number; default_units: Units };
}
export interface ActiveAlert { id: string; label: string; banner: string; message: string; level: string; since: number }
export interface Current {
  updated: number | null; connected: boolean;
  values: Record<string, number | null>;
  today: { temp: { min: number; max: number } | null; hum: { min: number; max: number } | null; gustMax: number | null; uvMax: number | null };
  rain: { rate: number | null; day: number | null; event: number | null; week: number | null; month: number | null; year: number | null };
  pressureTrend: number | null;
  spark: Partial<Record<'temp' | 'hum' | 'press' | 'rain' | 'light', (number | null)[]>>;
  forecast: { source: string; days: { date: number; condition: string; conditionCode: string | null; pop: number | null; lo: number | null; hi: number | null }[] } | null;
  astro: { sunrise: number | null; sunset: number | null; dayLengthMin: number | null; sunFraction: number | null; moon: { phase: number; illumination: number; name: string } } | null;
  devices: Device[];
  alerts: ActiveAlert[];
}
export interface Point { t: number; v: number | null; lo?: number; hi?: number }
export type StatKind = 'metric' | 'rain' | 'count' | 'km' | 'rate' | 'time' | 'rainDay' | 'strikes';
export interface Stat { k: string; v: number | null; kind: StatKind; t?: number | null }
export interface History { metric: MetricKey; range: Range; agg: 'mean' | 'counter'; points: Point[]; stats: Stat[] }
export interface RecordRow { metric: MetricKey; max: number | null; maxT: number | null; min: number | null; minT: number | null; maxKind: StatKind; minKind: StatKind; month: { min?: number | null; max?: number | null; sum?: number | null } | null }
export interface Records { since: string | null; records: Partial<Record<MetricKey, RecordRow>> }
export interface Detail { metric: MetricKey; today: Stat[]; record: RecordRow | null; device: Device | null }
export interface AlertsView {
  rules: { id: string; label: string; description: string; level: string; active: boolean; since: number | null; banner: string; message: string }[];
  log: { id: string; rule: string; title: string; level: string; text: string; start: number; end: number | null }[];
}

// ---------------- data fetching ----------------
export function useApi<T>(url: string | null, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || r.statusText);
        if (alive) { setData(j); setError(null); setLoadedAt(Date.now()); }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    setData(null);
    load();
    const id = intervalMs ? setInterval(load, intervalMs) : undefined;
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [url, intervalMs]);
  return { data, error, loadedAt };
}

export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j as T;
}

// ---------------- admin ----------------
export interface AdminSession { loggedIn: boolean; mustChangePassword: boolean }
export interface AlertCondition {
  sensor?: string; entity?: string;
  above?: number; below?: number; at_least?: number; at_most?: number; equals?: number;
  recent?: { sensor?: string; entity?: string; minutes?: number };
}
export interface AlertRule {
  id: string; label: string; description: string; level: 'warning' | 'info'; banner?: string; message: string;
  all?: AlertCondition[]; any?: AlertCondition[];
}
export interface AdminSettings {
  locked: {
    haUrl: boolean; haUrlEnv: boolean; haToken: boolean; haTokenEnv: boolean; sensors: Record<string, boolean>; forecastEntity: boolean; dwdStationId: boolean;
    alerts: boolean; stationName: boolean; stationSubtitle: boolean; stationAltitude: boolean; stationSince: boolean; stationDevices: boolean;
  };
  homeassistant: { url: string; tokenSet: boolean };
  sensors: Record<string, string>;
  forecast: { entity: string; dwdStationId: string; biasHours: number; label: string };
  alerts: AlertRule[];
  defaultAlerts: AlertRule[];
  station: { name: string; subtitle: string; altitude_m: number | null; since: string; devices: Device[] };
  timezone: string;
  demo: boolean;
}

// ---------------- units ----------------
export interface Units { temp: '°C' | '°F'; wind: 'km/h' | 'm/s' | 'mph' | 'Bft'; press: 'hPa' | 'mmHg' | 'inHg'; rain: 'mm' | 'l/m²' | 'in' }
export const UNIT_OPTIONS: { key: keyof Units; label: string; opts: string[] }[] = [
  { key: 'temp', label: 'Temperatur', opts: ['°C', '°F'] },
  { key: 'wind', label: 'Windgeschwindigkeit', opts: ['km/h', 'm/s', 'mph', 'Bft'] },
  { key: 'press', label: 'Luftdruck', opts: ['hPa', 'mmHg', 'inHg'] },
  { key: 'rain', label: 'Niederschlag', opts: ['mm', 'l/m²', 'in'] },
];
export const UnitsContext = createContext<{ u: Units; setU: (u: Units) => void }>({
  u: { temp: '°C', wind: 'km/h', press: 'hPa', rain: 'mm' }, setU: () => {},
});
export const useUnits = () => useContext(UnitsContext).u;

const BFT = [1, 6, 12, 20, 29, 39, 50, 62, 75, 89, 103, 118];
export const beaufort = (kmh: number) => { const i = BFT.findIndex(x => kmh < x); return i === -1 ? 12 : i; };

export interface Conv { f: (v: number) => number; unit: string; d: number }
export function convFor(kind: 'temp' | 'wind' | 'press' | 'rain' | 'rate' | 'none', u: Units, d = 1, unit = ''): Conv {
  switch (kind) {
    case 'temp': return u.temp === '°F' ? { f: v => v * 9 / 5 + 32, unit: '°F', d: 1 } : { f: v => v, unit: '°C', d: 1 };
    case 'wind':
      if (u.wind === 'm/s') return { f: v => v / 3.6, unit: 'm/s', d: 1 };
      if (u.wind === 'mph') return { f: v => v / 1.609344, unit: 'mph', d: 1 };
      if (u.wind === 'Bft') return { f: beaufort, unit: 'Bft', d: 0 };
      return { f: v => v, unit: 'km/h', d: 1 };
    case 'press':
      if (u.press === 'mmHg') return { f: v => v / 1.33322, unit: 'mmHg', d: 1 };
      if (u.press === 'inHg') return { f: v => v / 33.8639, unit: 'inHg', d: 2 };
      return { f: v => v, unit: 'hPa', d: 1 };
    case 'rain':
      if (u.rain === 'in') return { f: v => v / 25.4, unit: 'in', d: 2 };
      return { f: v => v, unit: u.rain, d: 1 };
    case 'rate':
      if (u.rain === 'in') return { f: v => v / 25.4, unit: 'in/h', d: 2 };
      return { f: v => v, unit: u.rain === 'l/m²' ? 'l/m²·h' : 'mm/h', d: 1 };
    default: return { f: v => v, unit, d };
  }
}

// Metric meta for the UI
export const METRIC_META: Record<MetricKey, { label: string; color: string; bars?: boolean; kind: 'temp' | 'wind' | 'press' | 'rain' | 'none'; unit: string; d: number }> = {
  temp: { label: 'Temperatur', color: 'var(--amber)', kind: 'temp', unit: '°C', d: 1 },
  hum: { label: 'Luftfeuchte', color: 'var(--blue)', kind: 'none', unit: '%', d: 0 },
  wind: { label: 'Wind', color: 'var(--blue)', kind: 'wind', unit: 'km/h', d: 1 },
  rain: { label: 'Niederschlag', color: 'var(--blue)', bars: true, kind: 'rain', unit: 'mm', d: 1 },
  press: { label: 'Luftdruck', color: 'var(--text)', kind: 'press', unit: 'hPa', d: 1 },
  solar: { label: 'Solarstrahlung', color: 'var(--amber)', kind: 'none', unit: 'W/m²', d: 0 },
  uv: { label: 'UV-Index', color: 'var(--amber)', kind: 'none', unit: '', d: 0 },
  light: { label: 'Blitze', color: 'var(--amber)', bars: true, kind: 'none', unit: 'Einschläge', d: 0 },
};
export const metricConv = (m: MetricKey, u: Units): Conv => {
  const M = METRIC_META[m];
  return convFor(M.kind, u, M.d, M.unit);
};

// ---------------- formatting ----------------
let TZ: string | undefined;
export const setTimeZone = (tz: string) => { TZ = tz; };
// German number format: decimal comma, grouping only from 5 digits (1011,4 but 12.345), true minus sign
export const fmt = (v: number | null | undefined, d = 1) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const r = Math.abs(v) < 0.5 * 10 ** -d ? 0 : v; // avoid "-0,0"
  return r.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: 'min2' } as unknown as Intl.NumberFormatOptions).replace('-', '−');
};
export const fmtC = (v: number | null | undefined, c: Conv, withUnit = true) =>
  v == null ? '—' : fmt(c.f(v), c.d) + (withUnit && c.unit ? ' ' + c.unit : '');
export const hhmm = (t: number | null | undefined) =>
  t == null ? '—' : new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
export const dateShort = (t: number | null | undefined) =>
  t == null ? '—' : new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
export const dateFmt = (t: number, o: Intl.DateTimeFormatOptions) => new Date(t).toLocaleString('de-DE', { ...o, timeZone: TZ });

// Short German names without trailing dots (Mi, Sep) as in the design
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MON = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export function parts(t: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
  const wdi = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, wd: WD[wdi], mon: MON[+p.month - 1], H: p.hour, M: p.minute, S: p.second };
}
export const weekday = (t: number) => parts(t).wd;
export const longDate = (t: number) => { const p = parts(t); return `${p.wd}, ${p.d}. ${p.mon} ${p.y}`; };
export const clock = (t: number) => { const p = parts(t); return `${p.H}:${p.M}:${p.S}`; };
export const dayKey = (t: number) => dateFmt(t, { year: 'numeric', month: '2-digit', day: '2-digit' });

export function relTime(t: number) {
  const now = Date.now();
  if (dayKey(t) === dayKey(now)) return `heute ${hhmm(t)}`;
  if (dayKey(t) === dayKey(now - 864e5)) return `gestern ${hhmm(t)}`;
  return `${dateFmt(t, { day: '2-digit', month: '2-digit' })} ${hhmm(t)}`;
}

export const COMPASS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number | null) => deg == null ? '—' : COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
export const uvLabel = (uv: number) => uv < 3 ? 'niedrig' : uv < 6 ? 'mittel' : uv < 8 ? 'hoch' : uv < 11 ? 'sehr hoch' : 'extrem';
export function trendText(delta: number | null, c: Conv) {
  if (delta == null) return null;
  const word = delta > 0.5 ? 'steigend' : delta < -0.5 ? 'fallend' : 'gleichbleibend';
  const arrow = delta > 0.5 ? '↑' : delta < -0.5 ? '↓' : '→';
  return { text: `${arrow} ${fmt(Math.abs(c.f(delta) - c.f(0)), c.d)} ${c.unit} / 3 h · ${word}`, word };
}

export function fmtStat(s: { v: number | null; kind: StatKind; t?: number | null }, m: MetricKey, u: Units) {
  switch (s.kind) {
    case 'metric': return fmtC(s.v, metricConv(m, u));
    case 'rain': return fmtC(s.v, convFor('rain', u));
    case 'rainDay': return s.v == null ? '—' : fmtC(s.v, convFor('rain', u)) + '/Tag';
    case 'rate': return fmtC(s.v, convFor('rate', u));
    case 'count': return s.v == null ? '—' : fmt(s.v, 0);
    case 'strikes': return s.v == null ? '—' : `${fmt(s.v, 0)} Einschläge`;
    case 'km': return s.v == null ? '—' : `${fmt(s.v, 0)} km`;
    case 'time': return hhmm(s.t);
  }
}

// ---------------- svg paths (as in the design reference) ----------------
type V = (number | null)[];
const clean = (vals: V) => vals.filter((v): v is number => v != null && Number.isFinite(v));
export function extent(vals: V): [number, number] {
  const c = clean(vals);
  if (!c.length) return [0, 1];
  return [Math.min(...c), Math.max(...c)];
}
export function linePath(vals: V, w: number, h: number, pad = 6, ext?: [number, number]) {
  const [mn, mx] = ext || extent(vals);
  const rg = mx - mn || 1;
  let d = '', pen = false;
  vals.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    const x = (i / Math.max(1, vals.length - 1)) * w, y = pad + (h - 2 * pad) * (1 - (v - mn) / rg);
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  return d;
}
export function areaPath(vals: V, w: number, h: number, pad = 6, ext?: [number, number]) {
  // one closed area per continuous segment
  const [mn, mx] = ext || extent(vals);
  const rg = mx - mn || 1;
  let d = '', seg: [number, number][] = [];
  const flush = () => {
    if (seg.length > 1) d += 'M' + seg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + `L${seg[seg.length - 1][0].toFixed(1)},${h}L${seg[0][0].toFixed(1)},${h}Z`;
    seg = [];
  };
  vals.forEach((v, i) => {
    if (v == null) return flush();
    seg.push([(i / Math.max(1, vals.length - 1)) * w, pad + (h - 2 * pad) * (1 - (v - mn) / rg)]);
  });
  flush();
  return d;
}
export function barsPath(vals: V, w: number, h: number) {
  const mx = Math.max(0, ...clean(vals)) || 1, bw = w / Math.max(1, vals.length), g = Math.min(1.5, bw * 0.2);
  return vals.map((v, i) => (v == null || v <= 0) ? '' : `M${(i * bw + g).toFixed(1)},${h}V${(h - Math.max(2, (v / mx) * h)).toFixed(1)}H${((i + 1) * bw - g).toFixed(1)}V${h}Z`).join('');
}
