// Which Home Assistant sensors fit each reading the dashboard shows, judged by
// unit, device class and name. It only ranks suggestions for the admin page's
// entity picker; what the dashboard reads is still the entity the admin saves.

const TEMP = ['°c', '°f', 'k'];
const SPEED = ['km/h', 'm/s', 'mph', 'kn', 'ft/s', 'bft'];
const DEPTH = ['mm', 'cm', 'in'];
const RATE = ['mm/h', 'in/h', 'mm/d', 'in/d'];
const PRESSURE = ['hpa', 'mbar', 'pa', 'kpa', 'inhg', 'mmhg', 'psi', 'bar', 'cbar'];

// units: the entity's unit must be one of these ('' = no unit) – the hard filter.
// classes: a matching device class ranks the entity higher.
// need: at least one of these words must be in the entity's id or name.
// prefer / avoid: words that move an entity up or down the list.
// Words are written without accents or ß, like the names they are compared with.
const RULES = {
  temperature: { units: TEMP, prefer: ['outdoor', 'outside', 'aussen'], avoid: ['feel', 'gefuhl', 'apparent', 'dew', 'tau', 'indoor', 'innen', 'soil', 'boden', 'chill', 'heat', 'water', 'wasser', 'pool'] },
  feels_like: { units: TEMP, need: ['feel', 'gefuhl', 'apparent'] },
  dew_point: { units: TEMP, need: ['dew', 'tau'] },
  humidity: { units: ['%'], classes: ['humidity'], need: ['humid', 'feucht'], prefer: ['outdoor', 'outside', 'aussen'], avoid: ['indoor', 'innen', 'soil', 'boden', 'moisture'] },
  wind_speed: { units: SPEED, classes: ['wind_speed'], prefer: ['speed', 'geschwindigkeit'], avoid: ['gust', 'boe', 'max', 'pace'] },
  wind_gust: { units: SPEED, classes: ['wind_speed'], prefer: ['gust', 'boe'], avoid: ['max', 'daily', 'tages', 'speed', 'geschwindigkeit', 'pace'] },
  wind_direction: { units: ['°'], classes: ['wind_direction'], need: ['direction', 'richtung', 'bearing'], avoid: ['avg', 'average', 'mittel'] },
  rain_rate: { units: RATE, classes: ['precipitation_intensity'], prefer: ['rate', 'intensit'] },
  rain_event: { units: DEPTH, classes: ['precipitation'], prefer: ['event', 'ereignis'], avoid: RAIN_PERIODS(['event', 'ereignis']) },
  rain_daily: { units: DEPTH, classes: ['precipitation'], prefer: ['daily', 'today', 'taglich', 'tages', 'heute'], avoid: RAIN_PERIODS(['daily', 'today', 'taglich', 'tages', 'heute']) },
  rain_weekly: { units: DEPTH, classes: ['precipitation'], prefer: ['week', 'woch'], avoid: RAIN_PERIODS(['week', 'woch']) },
  rain_monthly: { units: DEPTH, classes: ['precipitation'], prefer: ['month', 'monat'], avoid: RAIN_PERIODS(['month', 'monat']) },
  rain_yearly: { units: DEPTH, classes: ['precipitation'], prefer: ['year', 'jahr'], avoid: RAIN_PERIODS(['year', 'jahr']) },
  pressure: { units: PRESSURE, classes: ['atmospheric_pressure', 'pressure'], prefer: ['relative', 'rel', 'sea'], avoid: ['absolute', 'abs', 'vapor', 'vpd', 'deficit', 'tire', 'reifen'] },
  solar_radiation: { units: ['w/m²', 'w/m2'], classes: ['irradiance'] },
  uv_index: { units: ['uv index', 'uvi', ''], need: ['uv'] },
  lightning_distance: { units: ['km', 'mi'], classes: ['distance'], need: ['lightning', 'blitz'] },
  lightning_time: { units: [''], classes: ['timestamp'], need: ['lightning', 'blitz'] },
  lightning_count: { units: ['strikes', ''], need: ['lightning', 'blitz'], prefer: ['strike', 'count', 'anzahl', 'einschlag'], avoid: ['distance', 'entfernung', 'battery', 'batterie', 'signal', 'last', 'letzt', 'time', 'zeit'] },
};

// Every rain total other than the wanted one, so "weekly rain" ranks below "daily rain".
function RAIN_PERIODS(except) {
  return ['hour', 'stund', '24', 'week', 'woch', 'month', 'monat', 'year', 'jahr', 'total', 'gesamt',
    'event', 'ereignis', 'daily', 'today', 'taglich', 'tages', 'heute'].filter(w => !except.includes(w));
}

const plain = (s) => String(s ?? '').toLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '');
const count = (text, words = []) => words.filter(w => text.includes(w)).length;

// The first word of an entity id ("garten" in sensor.garten_wettersensor_taupunkt) mostly names
// the device or integration it comes from.
const family = (id) => String(id ?? '').replace(/^[a-z_]+\./, '').split('_')[0];

// entities: [{ id, name, unit, deviceClass }] → { sensorKey: [entity ids, best first] }
// configured: entity ids already chosen. Entities from the same family rank higher, so the
// station's own sensors come before, say, a weather service's sensors with the same unit.
export function suggestSensors(entities, configured = []) {
  const out = {};
  const families = new Set(configured.filter(Boolean).map(family));
  for (const [key, rule] of Object.entries(RULES)) {
    const ranked = [];
    for (const ent of entities) {
      const text = plain(`${ent.id} ${ent.name}`);
      const unit = plain(ent.unit).trim();
      const byClass = !!rule.classes?.includes(ent.deviceClass);
      if (!rule.units.includes(unit)) continue;
      if (rule.need && !count(text, rule.need)) continue;
      const score = (byClass ? 1 : 0) + (families.has(family(ent.id)) ? 2 : 0) + 2 * count(text, rule.prefer) - 3 * count(text, rule.avoid);
      ranked.push({ id: ent.id, name: String(ent.name ?? ''), score });
    }
    ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    out[key] = ranked.map(r => r.id);
  }
  return out;
}
