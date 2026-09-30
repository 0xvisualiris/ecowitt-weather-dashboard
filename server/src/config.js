// Loads and validates the YAML configuration.
// Values like ${HA_TOKEN} or ${HA_URL:-http://homeassistant:8123} are replaced
// with environment variables so secrets never have to live in the YAML file.
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const SENSOR_KEYS = [
  'temperature', 'feels_like', 'dew_point', 'humidity',
  'wind_speed', 'wind_gust', 'wind_direction',
  'rain_rate', 'rain_event', 'rain_daily', 'rain_weekly', 'rain_monthly', 'rain_yearly',
  'pressure', 'solar_radiation', 'uv_index',
  'lightning_distance', 'lightning_time', 'lightning_count',
];

const DEFAULT_ALERTS = [
  {
    id: 'lightning', label: 'Blitz in der Nähe', description: 'Einschlag näher als 15 km',
    level: 'warning', banner: 'Gewitter in der Nähe',
    all: [{ sensor: 'lightning_distance', below: 15, recent: { sensor: 'lightning_time', minutes: 30 } }],
    message: 'Letzter Blitz {lightning_distance} km entfernt um {lightning_time|time} Uhr · {lightning_count} Einschläge heute',
  },
  {
    id: 'frost', label: 'Frost', description: 'Temperatur unter 0 °C oder Taupunkt unter 1 °C',
    level: 'info', banner: 'Frostgefahr',
    any: [{ sensor: 'temperature', below: 0 }, { sensor: 'dew_point', below: 1 }],
    message: 'Temperatur {temperature} °C · Taupunkt {dew_point} °C',
  },
  {
    id: 'gust', label: 'Sturmböen', description: 'Böe über 60 km/h',
    level: 'warning', banner: 'Sturmböen',
    all: [{ sensor: 'wind_gust', above: 60 }],
    message: 'Böe {wind_gust} km/h aus {wind_direction|compass}',
  },
  {
    id: 'rain', label: 'Starkregen', description: 'Regenrate über 10 mm/h',
    level: 'warning', banner: 'Starkregen',
    all: [{ sensor: 'rain_rate', above: 10 }],
    message: 'Regenrate {rain_rate} mm/h · {rain_daily} mm heute',
  },
  {
    id: 'uv', label: 'Hoher UV-Index', description: 'UV-Index ab 6',
    level: 'warning', banner: 'Hoher UV-Index',
    all: [{ sensor: 'uv_index', at_least: 6 }],
    message: 'UV-Index {uv_index} · Sonnenschutz empfohlen',
  },
];

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
  const server = raw.server || {};
  const ui = raw.ui || {};
  const cache = server.cache || {};

  const cfg = {
    station: {
      name: station.name || 'Wetterstation',
      subtitle: station.subtitle || '',
      altitude_m: station.altitude_m ?? null,
      since: station.since ? String(station.since) : null,
      timezone: station.timezone || null,
      latitude: station.latitude ?? null,     // server-side only, never sent to the browser
      longitude: station.longitude ?? null,
      devices: (station.devices || []).map((d, i) => ({
        id: d.id || `device${i}`,
        name: d.name || d.id || `Gerät ${i + 1}`,
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
    server: {
      port: Number(process.env.PORT || server.port || 47813),
      demo: bool(process.env.DEMO) || bool(server.demo),
      data_dir: process.env.DATA_DIR || server.data_dir || '/data',
      public_dir: process.env.PUBLIC_DIR || server.public_dir || path.resolve('public'),
      cache: {
        live: Number(cache.live_seconds ?? 15) * 1000,
        history: Number(cache.history_seconds ?? 300) * 1000,
        records: Number(cache.records_seconds ?? 3600) * 1000,
      },
    },
    sensors: {},
    forecast: {
      entity: raw.forecast?.entity || null,
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
      },
    },
  };

  for (const key of SENSOR_KEYS) {
    const v = raw.sensors?.[key];
    if (v) cfg.sensors[key] = String(v).trim();
  }
  for (const key of Object.keys(raw.sensors || {})) {
    if (!SENSOR_KEYS.includes(key)) console.warn(`[config] unknown sensor key "${key}" ignored (allowed: ${SENSOR_KEYS.join(', ')})`);
  }

  // Validate alerts
  cfg.alerts = cfg.alerts.map((a, i) => {
    if (!a.id) a.id = `alert${i}`;
    if (!a.all && !a.any) throw new Error(`[config] alert "${a.id}" needs "all:" or "any:" conditions`);
    for (const c of [...(a.all || []), ...(a.any || [])]) {
      if (!c.sensor && !c.entity) throw new Error(`[config] alert "${a.id}": each condition needs "sensor:" (key) or "entity:" (HA entity id)`);
    }
    return { level: 'warning', label: a.id, description: '', ...a };
  });

  if (!cfg.server.demo) {
    if (!cfg.homeassistant.url) throw new Error('[config] homeassistant.url (or HA_URL env) is required unless server.demo is true');
    if (!cfg.homeassistant.token) throw new Error('[config] homeassistant.token (or HA_TOKEN env) is required unless server.demo is true');
  }
  return cfg;
}
