// Everything is normalized to one canonical unit per dimension on the server.
// The browser converts to the visitor's preferred units.
//   temperature °C · speed km/h · pressure hPa · rain mm · rain rate mm/h · distance km

export const SENSOR_DIMENSION = {
  temperature: 'temperature', feels_like: 'temperature', dew_point: 'temperature',
  humidity: 'none',
  wind_speed: 'speed', wind_gust: 'speed', wind_direction: 'none',
  rain_rate: 'rate', rain_event: 'rain', rain_daily: 'rain', rain_weekly: 'rain', rain_monthly: 'rain', rain_yearly: 'rain',
  pressure: 'pressure', solar_radiation: 'none', uv_index: 'none',
  lightning_distance: 'distance', lightning_time: 'timestamp', lightning_count: 'none',
};

const CONV = {
  temperature: {
    '°C': v => v, 'C': v => v, '°F': v => (v - 32) * 5 / 9, 'F': v => (v - 32) * 5 / 9, 'K': v => v - 273.15,
  },
  speed: {
    'km/h': v => v, 'm/s': v => v * 3.6, 'mph': v => v * 1.609344, 'kn': v => v * 1.852, 'ft/s': v => v * 1.09728,
  },
  pressure: {
    'hPa': v => v, 'mbar': v => v, 'Pa': v => v / 100, 'kPa': v => v * 10, 'inHg': v => v * 33.8639,
    'mmHg': v => v * 1.33322, 'psi': v => v * 68.9476, 'bar': v => v * 1000, 'cbar': v => v * 10,
  },
  rain: { 'mm': v => v, 'cm': v => v * 10, 'in': v => v * 25.4, 'L/m²': v => v },
  rate: { 'mm/h': v => v, 'in/h': v => v * 25.4, 'mm/d': v => v / 24, 'in/d': v => v * 25.4 / 24, 'cm/h': v => v * 10 },
  distance: { 'km': v => v, 'm': v => v / 1000, 'mi': v => v * 1.609344, 'ft': v => v * 0.0003048 },
};

export function toNumber(state) {
  if (state === null || state === undefined) return null;
  if (typeof state === 'number') return Number.isFinite(state) ? state : null;
  if (state === 'unknown' || state === 'unavailable' || state === '') return null;
  const n = Number(String(state).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const warned = new Set();
export function normalize(key, value, unit) {
  const n = toNumber(value);
  if (n === null) return null;
  const dim = SENSOR_DIMENSION[key];
  const table = CONV[dim];
  if (!table || !unit) return n;
  const f = table[unit];
  if (!f) {
    if (!warned.has(key + unit)) {
      warned.add(key + unit);
      console.warn(`[units] unknown unit "${unit}" for ${key}; using value as-is`);
    }
    return n;
  }
  return f(n);
}

export const COMPASS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OSO', 'SO', 'SSO', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = deg => (deg == null ? '—' : COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]);

export function fmtDe(v, d = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
}
