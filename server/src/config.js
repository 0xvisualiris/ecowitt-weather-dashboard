// Loads and validates the YAML configuration.
// Values like ${HA_TOKEN} or ${HA_URL:-http://homeassistant:8123} are replaced
// with environment variables so secrets never have to live in the YAML file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { DEFAULT_ALERTS_DE } from './i18n.js';

export const SENSOR_KEYS = [
  'temperature', 'feels_like', 'dew_point', 'humidity',
  'wind_speed', 'wind_gust', 'wind_direction',
  'rain_rate', 'rain_event', 'rain_daily', 'rain_weekly', 'rain_monthly', 'rain_yearly',
  'pressure', 'solar_radiation', 'uv_index',
  'lightning_distance', 'lightning_time', 'lightning_count',
];

// The frontend's files: in the image they are copied to /app/public (PUBLIC_DIR); in a checkout
// they are web/, next to server/, and served from there as they are.
const CHECKOUT_WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web');

// Where readings come from: Home Assistant, or an Ecowitt gateway read directly.
export const SOURCES = ['homeassistant', 'ecowitt'];

// The rules used when config.yaml and the admin page set none. Their texts come
// in every language the dashboard speaks (German in i18n.js), so each visitor
// reads them in their own; rules written by an admin are shown as written.
const DEFAULT_ALERTS_EN = [
  {
    id: 'lightning', label: 'Lightning nearby', description: 'Strike closer than 15 km',
    level: 'warning', banner: 'Thunderstorm nearby',
    all: [{ sensor: 'lightning_distance', below: 15, recent: { sensor: 'lightning_time', minutes: 30 } }],
    message: 'Last strike {lightning_distance} km away at {lightning_time|time} · {lightning_count} strikes today',
  },
  {
    id: 'frost', label: 'Frost', description: 'Temperature below 0 °C or dew point below 1 °C',
    level: 'info', banner: 'Risk of frost',
    any: [{ sensor: 'temperature', below: 0 }, { sensor: 'dew_point', below: 1 }],
    message: 'Temperature {temperature} °C · dew point {dew_point} °C',
  },
  {
    id: 'gust', label: 'Gale-force gusts', description: 'Gust above 60 km/h',
    level: 'warning', banner: 'Gale-force gusts',
    all: [{ sensor: 'wind_gust', above: 60 }],
    message: 'Gust {wind_gust} km/h from {wind_direction|compass}',
  },
  {
    id: 'rain', label: 'Heavy rain', description: 'Rain rate above 10 mm/h',
    level: 'warning', banner: 'Heavy rain',
    all: [{ sensor: 'rain_rate', above: 10 }],
    message: 'Rain rate {rain_rate} mm/h · {rain_daily} mm today',
  },
  {
    id: 'uv', label: 'High UV index', description: 'UV index 6 or higher',
    level: 'warning', banner: 'High UV index',
    all: [{ sensor: 'uv_index', at_least: 6 }],
    message: 'UV index {uv_index} · sun protection advised',
  },
];
const TEXT_FIELDS = ['label', 'description', 'banner', 'message'];
export const DEFAULT_ALERTS = DEFAULT_ALERTS_EN.map(rule => ({
  ...rule,
  ...Object.fromEntries(TEXT_FIELDS.map(k => [k, { en: rule[k], de: DEFAULT_ALERTS_DE[rule.id][k] }])),
}));

// Shared validation/defaulting for an alert-rule array, used both for the
// config.yaml path (loadConfig, below) and the admin-UI path (admin.js's
// saveSettings) so a rule entered through either route is held to the same
// standard before it can ever reach disk or a running AlertEngine.
export function normalizeAlerts(raw) {
  return raw.map((a, i) => {
    if (!a.id) a.id = `alert${i}`;
    if (!a.all && !a.any) throw new Error(`alert "${a.id}" needs "all:" or "any:" conditions`);
    for (const c of [...(a.all || []), ...(a.any || [])]) {
      if (!c.sensor && !c.entity) throw new Error(`alert "${a.id}": each condition needs "sensor:" (key) or "entity:" (HA entity id)`);
    }
    return { level: 'warning', label: a.id, description: '', ...a };
  });
}

function substituteEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/gi, (_, name, def) => process.env[name] ?? def ?? '');
  }
  if (Array.isArray(value)) return value.map(substituteEnv);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteEnv(v)]));
  }
  return value;
}

function bool(v) {
  return v === true || v === 'true' || v === '1' || v === 'yes';
}

export function loadConfig() {
  const file = process.env.CONFIG_PATH || '/config/config.yaml';
  let raw = {};
  if (fs.existsSync(file)) {
    raw = YAML.parse(fs.readFileSync(file, 'utf8')) || {};
    console.log(`[config] loaded ${file}`);
  } else if (!bool(process.env.DEMO)) {
    console.warn(`[config] ${file} not found – starting in demo mode. Copy config.example.yaml to ${file} to connect Home Assistant.`);
    raw = { server: { demo: true } };
  }
  raw = substituteEnv(raw);

  const station = raw.station || {};
  const ha = raw.homeassistant || {};
  const ecowitt = raw.ecowitt || {};
  const server = raw.server || {};
  const ui = raw.ui || {};
  const cache = server.cache || {};

  const cfg = {
    station: {
      name: station.name || 'Weather Station',
      subtitle: station.subtitle || '',
      altitude_m: station.altitude_m ?? null,
      since: station.since ? String(station.since) : null,
      timezone: station.timezone || null,
      latitude: station.latitude ?? null,     // server-side only, never sent to the browser
      longitude: station.longitude ?? null,
      // Deliberately separate from latitude/longitude above and deliberately
      // coarse (rounded to 1 decimal degree, ~10 km): this one IS sent to
      // the public API, to auto-center the radar screen, without exposing
      // where the station (and likely the admin) actually lives. See the
      // README's "Public radar location" section.
      publicLocation: station.public_lat != null && station.public_lon != null
        ? { lat: Math.round(Number(station.public_lat) * 10) / 10, lon: Math.round(Number(station.public_lon) * 10) / 10 }
        : null,
      devices: (station.devices || []).map((d, i) => ({
        id: d.id || `device${i}`,
        name: d.name || d.id || `Device ${i + 1}`,
        role: d.role || '',
        short: d.short || d.name || d.id,
        battery: d.battery || null,
        signal: d.signal || null,
        metrics: d.metrics || [],
      })),
    },
    homeassistant: {
      url: (process.env.HA_URL || ha.url || '').replace(/\/+$/, ''),
      token: process.env.HA_TOKEN || ha.token || '',
    },
    // Left null when config.yaml doesn't say: index.js then picks whichever
    // source is configured (Home Assistant first, for existing setups).
    source: SOURCES.includes(raw.source) ? raw.source : null,
    ecowitt: {
      host: (process.env.ECOWITT_HOST || ecowitt.host || '').trim().replace(/\/+$/, ''),
      pollSeconds: Number(ecowitt.poll_seconds ?? 30),
      rainGauge: ['auto', 'piezo', 'tipping'].includes(ecowitt.rain_gauge) ? ecowitt.rain_gauge : 'auto',
      pressure: ecowitt.pressure === 'absolute' ? 'absolute' : 'relative',
      keepRawDays: Number(ecowitt.keep_raw_days ?? 10),
    },
    server: {
      port: Number(process.env.PORT || server.port || 47813),
      demo: bool(process.env.DEMO) || bool(server.demo),
      data_dir: process.env.DATA_DIR || server.data_dir || '/data',
      public_dir: process.env.PUBLIC_DIR || server.public_dir || (fs.existsSync(CHECKOUT_WEB) ? CHECKOUT_WEB : path.resolve('public')),
      cache: {
        live: Number(cache.live_seconds ?? 15) * 1000,
        history: Number(cache.history_seconds ?? 300) * 1000,
        records: Number(cache.records_seconds ?? 3600) * 1000,
      },
    },
    sensors: {},
    forecast: {
      entity: raw.forecast?.entity || null,
      dwdStationId: raw.forecast?.dwd_station_id ? String(raw.forecast.dwd_station_id).trim() : null,
      biasHours: Number(raw.forecast?.bias_hours ?? 6),
      label: raw.forecast?.label || null,
      days: Number(raw.forecast?.days ?? 5),
    },
    alerts: raw.alerts === undefined ? DEFAULT_ALERTS : (raw.alerts || []),
    alert_clear_minutes: Number(raw.alert_settings?.clear_after_minutes ?? 10),
    ui: {
      stale_after_seconds: Number(ui.stale_after_seconds ?? 120),
      refresh_seconds: Number(ui.refresh_seconds ?? 15),
      default_units: {
        temp: ui.default_units?.temperature || '°C',
        wind: ui.default_units?.wind || 'km/h',
        press: ui.default_units?.pressure || 'hPa',
        rain: ui.default_units?.rain || 'mm',
      }
    },
  };

  // Until v2.0.0 there were two designs to choose from; Himmel is now the only one.
  if (ui.design !== undefined) console.warn('[config] ui.design is no longer used (there is only one design) and is ignored');

  if (raw.source !== undefined && !SOURCES.includes(raw.source)) {
    console.warn(`[config] unknown source "${raw.source}" ignored (allowed: ${SOURCES.join(', ')})`);
  }

  for (const key of SENSOR_KEYS) {
    const v = raw.sensors?.[key];
    if (v) cfg.sensors[key] = String(v).trim();
  }
  for (const key of Object.keys(raw.sensors || {})) {
    if (!SENSOR_KEYS.includes(key)) console.warn(`[config] unknown sensor key "${key}" ignored (allowed: ${SENSOR_KEYS.join(', ')})`);
  }

  cfg.alerts = normalizeAlerts(cfg.alerts);

  // Which fields config.yaml explicitly set, for index.js to compute its
  // `locked` map from – config.js already applies its own defaults above
  // (DEFAULT_ALERTS, 'Weather Station', …) before index.js ever sees `cfg`, so
  // a plain truthiness check on cfg.station.name/cfg.alerts can't tell
  // "config.yaml set this" apart from "config.js's own default kicked in"
  // the way it can for e.g. homeassistant.url (null until something sets it).
  cfg._locked = {
    alerts: raw.alerts !== undefined,
    stationName: !!station.name,
    stationSubtitle: !!station.subtitle,
    stationAltitude: station.altitude_m != null,
    stationSince: !!station.since,
    stationPublicLocation: station.public_lat != null && station.public_lon != null,
    // homeassistant.url/token are the only two fields that can also be
    // locked by an environment variable (not just config.yaml) – HA_URL/
    // HA_TOKEN always win the `||` in cfg.homeassistant above when set, so
    // this alone tells the admin UI the real reason a field is locked,
    // rather than always blaming "config.yaml" even when that's not it.
    haUrlEnv: !!process.env.HA_URL,
    haTokenEnv: !!process.env.HA_TOKEN,
    source: SOURCES.includes(raw.source),
    ecowittHostEnv: !!process.env.ECOWITT_HOST,
  };

  // homeassistant.url/token are no longer required here even when not in demo
  // mode: they may still arrive from the admin-settings store, merged in by
  // index.js after loadConfig() returns. index.js falls back to demo mode if
  // they're still missing once that merge happens, rather than this function
  // crashing the process before the admin login page could ever be reached.
  return cfg;
}
