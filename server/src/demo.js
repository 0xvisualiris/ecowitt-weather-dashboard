// Synthetic data source with the same interface as HomeAssistantSource.
// Used when server.demo is true (or no config file exists) so the UI can be
// tried out without Home Assistant.
import { EventEmitter } from 'node:events';
import SunCalc from 'suncalc';

const LAT = 50.1, LON = 8.7;
const SLOT = 5 * 60 * 1000;

export const DEMO_SENSORS = {
  temperature: 'sensor.demo_outdoor_temperature',
  feels_like: 'sensor.demo_feels_like_temperature',
  dew_point: 'sensor.demo_dewpoint',
  humidity: 'sensor.demo_outdoor_humidity',
  wind_speed: 'sensor.demo_wind_speed',
  wind_gust: 'sensor.demo_wind_gust',
  wind_direction: 'sensor.demo_wind_direction',
  rain_rate: 'sensor.demo_rain_rate_piezo',
  rain_event: 'sensor.demo_event_rain_piezo',
  rain_daily: 'sensor.demo_daily_rain_piezo',
  pressure: 'sensor.demo_relative_pressure',
  solar_radiation: 'sensor.demo_solar_radiation',
  uv_index: 'sensor.demo_uv_index',
  lightning_distance: 'sensor.demo_lightning_distance',
  lightning_time: 'sensor.demo_lightning_time',
  lightning_count: 'sensor.demo_lightning_strikes',
};
export const DEMO_DEVICES = [
  { id: 'ws90', name: 'Ecowitt WS90', short: 'WS90', role: 'Außensensor', battery: 'sensor.demo_ws90_battery', signal: 'sensor.demo_ws90_signal', metrics: ['temp', 'hum', 'wind', 'rain', 'solar', 'uv'] },
  { id: 'wh57', name: 'Ecowitt WH57', short: 'WH57', role: 'Blitzsensor', battery: 'sensor.demo_wh57_battery', signal: 'sensor.demo_wh57_signal', metrics: ['light'] },
  { id: 'gw', name: 'Ecowitt GW2000', short: 'Gateway', role: 'Gateway', metrics: ['press'] },
];
const UNITS = {
  temperature: '°C', feels_like: '°C', dew_point: '°C', humidity: '%', wind_speed: 'km/h', wind_gust: 'km/h',
  wind_direction: '°', rain_rate: 'mm/h', rain_event: 'mm', rain_daily: 'mm', pressure: 'hPa',
  solar_radiation: 'W/m²', uv_index: 'UV index', lightning_distance: 'km', lightning_count: 'strikes',
};
const COUNTERS = new Set(['rain_daily', 'lightning_count']);

function hash(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
function smooth(t, periodMs, seed) {
  const k = t / periodMs, i = Math.floor(k), f = k - i, u = f * f * (3 - 2 * f);
  return (hash(i * 31 + seed) * (1 - u) + hash((i + 1) * 31 + seed) * u) - 0.5;
}
function midnight(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }

function rainSlot(slot) {
  const hour = Math.floor(slot / 12);
  const h = hash(hour * 7 + 3);
  if (h < 0.94) return 0;
  return (hash(slot * 13 + 1) * 6 * (h - 0.94) * 16) / 12; // mm in this 5-min slot
}
function strikesSlot(slot, nowSlot) {
  const hour = Math.floor(slot / 12);
  const storm = hash(hour * 11 + 5) > 0.99 || (slot <= nowSlot && nowSlot - slot < 18);
  if (!storm) return 0;
  return Math.floor(hash(slot * 17 + 2) * 4);
}

export class DemoSource extends EventEmitter {
  constructor(sensors) {
    super();
    this.byEntity = Object.fromEntries(Object.entries(sensors).map(([k, id]) => [id, k]));
    this.states = {};
    this.forecast = null;
    this.connected = true;
    this.lastMessage = Date.now();
  }

  start() {
    const tick = () => { this._refresh(); this.emit('update'); };
    tick();
    setInterval(tick, 16000);
    this._makeForecast();
    this.emit('status', true);
  }

  location() { return { latitude: LAT, longitude: LON, time_zone: process.env.TZ || 'Europe/Berlin' }; }

  value(key, t) {
    const hod = (t - midnight(t)) / 3600000;
    const doy = (t - new Date(new Date(t).getFullYear(), 0, 1)) / 864e5;
    const s = Math.sin(((hod - 9) / 24) * 2 * Math.PI);
    const season = 10 + 8 * Math.sin(((doy - 110) / 365) * 2 * Math.PI);
    const n = seed => smooth(t, 45 * 60000, seed);
    const temp = season + 5 * s + n(1) * 3 + smooth(t, 3 * 864e5, 9) * 8;
    const hum = Math.max(18, Math.min(100, 70 - 16 * s + n(2) * 12));
    const wind = Math.max(0, 11 + 5 * s + n(3) * 18);
    switch (key) {
      case 'temperature': return temp;
      case 'humidity': return hum;
      case 'dew_point': {
        const a = 17.62, b = 243.12, g = Math.log(hum / 100) + (a * temp) / (b + temp);
        return (b * g) / (a - g);
      }
      case 'feels_like': return temp < 10 ? temp - wind * 0.06 : temp + (hum - 60) * 0.03;
      case 'wind_speed': return wind;
      case 'wind_gust': return wind * 1.6 + Math.abs(n(4)) * 12;
      case 'wind_direction': return (((245 + n(5) * 90) % 360) + 360) % 360;
      case 'pressure': return 1013 + 9 * Math.sin((t / (5.3 * 864e5)) * 2 * Math.PI) + smooth(t, 6 * 3600000, 6) * 3;
      case 'solar_radiation': {
        const alt = SunCalc.getPosition(new Date(t), LAT, LON).altitude;
        return Math.max(0, 1050 * Math.sin(alt) * (0.65 + 0.35 * (n(7) + 0.5)));
      }
      case 'uv_index': return Math.round(this.value('solar_radiation', t) / 110);
      case 'rain_rate': return rainSlot(Math.floor(t / SLOT)) * 12;
      case 'rain_daily': case 'lightning_count': {
        const f = key === 'rain_daily' ? rainSlot : sl => strikesSlot(sl, Math.floor(Date.now() / SLOT));
        let sum = 0;
        for (let sl = Math.floor(midnight(t) / SLOT); sl <= Math.floor(t / SLOT); sl++) sum += f(sl);
        return key === 'rain_daily' ? Math.round(sum * 10) / 10 : sum;
      }
      case 'rain_event': {
        let sum = 0, dry = 0;
        for (let sl = Math.floor(t / SLOT); sl > Math.floor(t / SLOT) - 288 * 3 && dry < 144; sl--) {
          const r = rainSlot(sl); sum += r; dry = r > 0 ? 0 : dry + 1;
        }
        return Math.round(sum * 10) / 10;
      }
      case 'lightning_distance': {
        const now = Math.floor(Date.now() / SLOT);
        for (let sl = Math.floor(t / SLOT); sl > Math.floor(t / SLOT) - 288 * 30; sl--) {
          if (strikesSlot(sl, now) > 0) return Math.max(1, Math.round(2 + hash(sl * 5) * 30 - (sl === now ? 20 : 0)));
        }
        return null;
      }
      case 'lightning_time': {
        const now = Math.floor(Date.now() / SLOT);
        for (let sl = Math.floor(t / SLOT); sl > Math.floor(t / SLOT) - 288 * 30; sl--) {
          if (strikesSlot(sl, now) > 0) return new Date(sl * SLOT + 90000).toISOString();
        }
        return null;
      }
      default: return null;
    }
  }

  _refresh() {
    const now = Date.now();
    this.lastMessage = now;
    for (const [id, key] of Object.entries(this.byEntity)) {
      let v = this.value(key, now);
      if (typeof v === 'number') v = Math.round(v * 10) / 10;
      this.states[id] = { state: v == null ? 'unknown' : String(v), attributes: { unit_of_measurement: UNITS[key] }, lu: now, lc: now };
    }
    const extra = {
      'sensor.demo_ws90_battery': ['3.28', 'V'], 'sensor.demo_ws90_signal': ['4', ''],
      'sensor.demo_wh57_battery': ['5', ''], 'sensor.demo_wh57_signal': ['4', ''],
    };
    for (const [id, [s, u]] of Object.entries(extra)) this.states[id] = { state: s, attributes: { unit_of_measurement: u }, lu: now, lc: now };
  }

  _makeForecast() {
    const conds = ['lightning-rainy', 'rainy', 'cloudy', 'partlycloudy', 'sunny', 'sunny', 'partlycloudy'];
    const base = midnight(Date.now());
    this.forecast = Array.from({ length: 7 }, (_, i) => {
      const t = base + i * 864e5;
      const lo = Math.round(this.value('temperature', t + 5 * 3600000) - 1);
      const hi = Math.round(this.value('temperature', t + 15 * 3600000) + 2);
      return { datetime: new Date(t + 12 * 3600000).toISOString(), condition: conds[i], precipitation_probability: [70, 55, 20, 5, 0, 10, 30][i], templow: Math.min(lo, hi - 3), temperature: hi };
    });
    this.emit('forecast');
  }

  async history(entityIds, start, end) {
    const out = {};
    for (const id of entityIds) {
      const key = this.byEntity[id];
      if (!key) continue;
      const rows = [];
      if (COUNTERS.has(key)) {
        // Cumulative daily counter, one point per 5 minutes, reset at midnight
        let sum = 0, day = null;
        const now = Math.floor(Date.now() / SLOT);
        for (let sl = Math.floor(start / SLOT); sl * SLOT <= end; sl++) {
          const t = sl * SLOT, d = midnight(t);
          if (day === null) { sum = this.value(key, t - SLOT) ?? 0; day = d; }
          if (d !== day) { sum = 0; day = d; }
          sum += key === 'rain_daily' ? rainSlot(sl) : strikesSlot(sl, now);
          rows.push({ t, s: String(Math.round(sum * 10) / 10) });
        }
      } else {
        for (let t = Math.floor(start / SLOT) * SLOT; t <= end; t += SLOT) {
          const v = this.value(key, t);
          rows.push({ t, s: v == null ? 'unknown' : typeof v === 'number' ? String(Math.round(v * 10) / 10) : v });
        }
      }
      out[id] = rows;
    }
    return out;
  }

  async statistics(ids, start, end, period) {
    const out = {};
    const buckets = [];
    let t = start;
    while (t < end) {
      const d = new Date(t);
      if (period === 'hour') d.setHours(d.getHours() + 1, 0, 0, 0);
      else if (period === 'day') { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); }
      else { d.setMonth(d.getMonth() + 1, 1); d.setHours(0, 0, 0, 0); }
      buckets.push([t, Math.min(d.getTime(), end)]);
      t = d.getTime();
    }
    const now = Math.floor(Date.now() / SLOT);
    for (const id of ids) {
      const key = this.byEntity[id];
      if (!key || key === 'lightning_time') continue;
      const rows = [];
      for (const [a, b] of buckets) {
        if (COUNTERS.has(key)) {
          let sum = 0;
          for (let sl = Math.ceil(a / SLOT); sl * SLOT < b; sl++) sum += key === 'rain_daily' ? rainSlot(sl) : strikesSlot(sl, now);
          rows.push({ start: a, change: Math.round(sum * 10) / 10, max: sum });
        } else if (key === 'lightning_distance') {
          let mn = Infinity, mx = -Infinity;
          for (let sl = Math.ceil(a / SLOT); sl * SLOT < b; sl++) {
            if (strikesSlot(sl, now) > 0) {
              const d = Math.max(1, Math.round(2 + hash(sl * 5) * 30 - (sl === now ? 20 : 0)));
              mn = Math.min(mn, d); mx = Math.max(mx, d);
            }
          }
          if (mn < Infinity) rows.push({ start: a, mean: (mn + mx) / 2, min: mn, max: mx });
        } else {
          const step = period === 'hour' ? SLOT : period === 'day' ? 30 * 60000 : 3 * 3600000;
          let mn = Infinity, mx = -Infinity, s = 0, c = 0;
          for (let x = a; x < b; x += step) {
            const v = this.value(key, x);
            if (typeof v !== 'number') continue;
            mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; c++;
          }
          if (c) rows.push({ start: a, mean: s / c, min: mn, max: mx });
        }
      }
      out[id] = rows;
    }
    return out;
  }
}
