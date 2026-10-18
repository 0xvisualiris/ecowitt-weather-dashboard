// Reads an Ecowitt gateway (GW1100, GW2000, GW3000, WS3900, … with current
// firmware) directly over its local HTTP API, without Home Assistant.
// Same interface as HomeAssistantSource; because the gateway keeps no history,
// every reading is also written to a Recorder in DATA_DIR/ecowitt.
//
//   GET http://<gateway>/get_livedata_info   current readings
//   GET http://<gateway>/get_sensors_info    paired sensors with battery + signal
//   GET http://<gateway>/get_version         model + firmware
//
// Polling is stateless, so there is nothing to reconnect: if the gateway is
// unreachable (restart, Wi-Fi drop), the next poll simply succeeds again.
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { normalize, toNumber } from './units.js';
import { Recorder } from './recorder.js';

// Entity ids of this source are the sensor keys themselves.
export const ECOWITT_UNITS = {
  temperature: '°C', feels_like: '°C', dew_point: '°C', humidity: '%',
  wind_speed: 'km/h', wind_gust: 'km/h', wind_direction: '°',
  rain_rate: 'mm/h', rain_event: 'mm', rain_daily: 'mm', rain_weekly: 'mm', rain_monthly: 'mm', rain_yearly: 'mm',
  pressure: 'hPa', solar_radiation: 'W/m²', uv_index: '',
  lightning_distance: 'km', lightning_time: '', lightning_count: '',
};

// Ids in common_list (temperature etc.) and in the rain blocks.
const COMMON = {
  '0x02': 'temperature', '3': 'feels_like', '0x03': 'dew_point', '0x07': 'humidity',
  '0x0A': 'wind_direction', '0x0B': 'wind_speed', '0x0C': 'wind_gust',
  '0x15': 'solar_radiation', '0x17': 'uv_index',
};
const RAIN = { '0x0E': 'rain_rate', '0x0D': 'rain_event', '0x10': 'rain_daily', '0x11': 'rain_weekly', '0x12': 'rain_monthly', '0x13': 'rain_yearly' };

// The gateway's unit spellings → the ones units.js understands.
const UNIT_ALIASES = {
  c: '°C', f: '°F', 'km/h': 'km/h', 'm/s': 'm/s', mph: 'mph', knots: 'kn', knot: 'kn', kn: 'kn', 'ft/s': 'ft/s',
  mm: 'mm', in: 'in', 'mm/hr': 'mm/h', 'mm/h': 'mm/h', 'in/hr': 'in/h', 'in/h': 'in/h',
  hpa: 'hPa', inhg: 'inHg', mmhg: 'mmHg', km: 'km', mi: 'mi', '%': null,
};
// Ecowitt converts W/m² to lux with a fixed factor of 126.7.
const SOLAR = { 'w/m2': 1, 'w/m²': 1, lux: 1 / 126.7, klux: 1000 / 126.7, fc: 10.764 / 126.7, kfc: 10764 / 126.7 };

const warned = new Set();
function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

// "12.24 km/h", "67%", "18.8" + unit "C", "--.-" → canonical number or null.
export function reading(key, val, unitField) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*(.*?)\s*$/.exec(String(val ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || unitField || '').trim().toLowerCase();
  if (key === 'solar_radiation') {
    const f = SOLAR[unit || 'w/m2'];
    if (f == null) { warnOnce(`solar:${unit}`, `[ecowitt] unknown light unit "${unit}"; using value as-is`); return n; }
    return n * f;
  }
  if (!unit) return n;
  const alias = UNIT_ALIASES[unit];
  if (alias === undefined) { warnOnce(`${key}:${unit}`, `[ecowitt] unknown unit "${unit}" for ${key}; using value as-is`); return n; }
  return alias == null ? n : normalize(key, n, alias);
}

// get_livedata_info response → { sensor_key: number | ISO string }, canonical units.
export function parseLiveData(data, { rainGauge = 'auto', pressure = 'relative' } = {}) {
  const out = {};
  const common = data?.common_list || [];
  for (const row of common) {
    const key = COMMON[row.id];
    if (key) out[key] = reading(key, row.val, row.unit);
  }

  const piezo = data?.piezoRain, tipping = data?.rain;
  const rain = rainGauge === 'piezo' ? piezo : rainGauge === 'tipping' ? tipping : (piezo?.length ? piezo : tipping);
  for (const row of rain || []) {
    const key = RAIN[row.id];
    if (key) out[key] = reading(key, row.val, row.unit);
  }

  // Pressure comes from the gateway's own sensor (the "wh25" block); older
  // firmware lists it in common_list as 0x08 (absolute) / 0x09 (relative).
  const wh25 = data?.wh25?.[0];
  const pRaw = wh25 ? (pressure === 'absolute' ? wh25.abs : wh25.rel)
    : common.find(r => r.id === (pressure === 'absolute' ? '0x08' : '0x09'))?.val;
  if (pRaw != null) out.pressure = reading('pressure', pRaw);

  const l = data?.lightning?.[0];
  if (l) {
    out.lightning_distance = reading('lightning_distance', l.distance);
    out.lightning_count = toNumber(l.count);
    // "2026-08-31T19:54:47" is the gateway's local time; the server runs in
    // station time (process.env.TZ), so Date.parse reads it the same way.
    const t = l.date ? Date.parse(l.date) : NaN;
    out.lightning_time = Number.isFinite(t) ? new Date(t).toISOString() : null;
  }

  for (const k of Object.keys(out)) if (out[k] == null || (typeof out[k] === 'number' && !Number.isFinite(out[k]))) out[k] = null;
  return out;
}

// get_sensors_info pages → [{ img, battery, signal }] for paired sensors only.
export function parseSensors(pages) {
  const out = [];
  for (const s of pages.flat()) {
    if (!s?.img || s.idst !== '1' || /^F{7}[EF]$/i.test(s.id || '')) continue;
    const batt = toNumber(s.batt);
    const signal = toNumber(s.signal);
    out.push({
      img: s.img.toLowerCase(),
      // 0–5 is Ecowitt's battery level scale for most sensors; 9 means unknown.
      battery: batt == null || batt === 9 ? null : batt <= 5 && Number.isInteger(batt) ? { value: batt * 20, unit: '%' } : { value: batt, unit: '' },
      signal: signal == null ? null : { value: signal, unit: '' },
    });
  }
  return out;
}

// Which dashboard metrics a sensor model delivers, for the automatic device list.
const DEVICE_METRICS = {
  wh90: ['temp', 'hum', 'wind', 'rain', 'solar', 'uv'], ws90: ['temp', 'hum', 'wind', 'rain', 'solar', 'uv'],
  wh69: ['temp', 'hum', 'wind', 'rain', 'solar', 'uv'], wh80: ['temp', 'hum', 'wind', 'solar', 'uv'], ws80: ['temp', 'hum', 'wind', 'solar', 'uv'],
  wh85: ['wind', 'rain'], wh68: ['wind', 'solar', 'uv'], wh40: ['rain'], wn20: ['rain'],
  wh32: ['temp', 'hum'], wh26: ['temp', 'hum'], wh57: ['light'], wh25: ['press'],
};

export class EcowittSource extends EventEmitter {
  constructor({ host, pollSeconds = 30, rainGauge = 'auto', pressure = 'relative', keepRawDays = 10, dataDir }) {
    super();
    this.base = /^https?:\/\//.test(host) ? host.replace(/\/+$/, '') : `http://${host}`;
    this.pollMs = Math.max(10, pollSeconds) * 1000;
    this.opts = { rainGauge, pressure };
    this.states = {};
    this.forecast = null;
    this.connected = false;
    this.lastMessage = 0;
    this.model = null;
    this.sensors = [];
    this.recorder = new Recorder(path.join(dataDir, 'ecowitt'), { keepDays: keepRawDays });
    this.recorder.load();
  }

  async _get(p) {
    const res = await fetch(this.base + p, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
    return res.json();
  }

  // One-off read at startup: which sensor keys this gateway delivers and which
  // sensors are paired, so the dashboard shows exactly the matching cards.
  async probe() {
    const live = parseLiveData(await this._get('/get_livedata_info'), this.opts);
    try { this.model = String((await this._get('/get_version')).version || '').replace(/^Version:\s*/, '').split('_')[0] || null; } catch { /* optional */ }
    await this._pollSensors();
    return { keys: Object.keys(live), model: this.model, sensors: this.sensors };
  }

  // Devices for the device card when config.yaml/admin page define none.
  autoDevices() {
    const devices = this.sensors.filter(s => DEVICE_METRICS[s.img]).map(s => ({
      id: s.img, name: `Ecowitt ${s.img.toUpperCase()}`, short: s.img.toUpperCase(), role: '',
      battery: `${s.img}_battery`, signal: `${s.img}_signal`, metrics: DEVICE_METRICS[s.img],
    }));
    if (!devices.some(d => d.metrics.includes('press'))) {
      devices.push({ id: 'gateway', name: this.model ? `Ecowitt ${this.model}` : 'Ecowitt Gateway', short: 'Gateway', role: '', battery: null, signal: null, metrics: ['press'] });
    }
    return devices;
  }

  start() {
    this._poll();
    setInterval(() => this._poll(), this.pollMs);
    setInterval(() => this._pollSensors().then(() => this.emit('update'), () => {}), 10 * 60000);
  }

  async _pollSensors() {
    const pages = [];
    for (let page = 1; page <= 4; page++) {
      try {
        const rows = await this._get(`/get_sensors_info?page=${page}`);
        if (!Array.isArray(rows) || !rows.length) break;
        pages.push(rows);
      } catch (e) {
        if (page === 1) throw e;
        break;
      }
    }
    this.sensors = parseSensors(pages);
    const now = Date.now();
    for (const s of this.sensors) {
      for (const [field, r] of [['battery', s.battery], ['signal', s.signal]]) {
        this._set(`${s.img}_${field}`, r ? r.value : 'unknown', r?.unit || '', now);
      }
    }
  }

  async _poll() {
    let values;
    try {
      values = parseLiveData(await this._get('/get_livedata_info'), this.opts);
    } catch (e) {
      if (this.connected || !this._failLogged) console.warn(`[ecowitt] cannot read ${this.base} (${e.cause?.message || e.message}) – retrying every ${this.pollMs / 1000} s`);
      this._failLogged = true;
      if (this.connected) { this.connected = false; this.emit('status', false); }
      return;
    }
    const now = Date.now();
    if (!this.connected) {
      console.log(`[ecowitt] reading ${this.base}${this.model ? ` (${this.model})` : ''}`);
      this.connected = true;
      this._failLogged = false;
      this.emit('status', true);
    }
    this.lastMessage = now;
    for (const [k, v] of Object.entries(values)) this._set(k, v ?? 'unknown', ECOWITT_UNITS[k] ?? '', now);
    this.recorder.add(now, Object.fromEntries(Object.entries(values).filter(([, v]) => v != null)));
    this.emit('update');
  }

  // `lu` moves on every successful poll, so the dashboard's live/stale dot
  // means "the gateway answered recently", not "a value happened to change".
  _set(id, value, unit, now) {
    const prev = this.states[id];
    const state = typeof value === 'number' ? String(Math.round(value * 1000) / 1000) : String(value);
    this.states[id] = {
      state, attributes: { unit_of_measurement: unit },
      lu: now, lc: prev && prev.state === state ? prev.lc : now,
    };
  }

  location() { return null; }

  async history(ids, start, end) { return this.recorder.history(ids, start, end); }

  async statistics(ids, start, end, period) { return this.recorder.statistics(ids, start, end, period); }
}
