import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestSensors } from './entities.js';
import { SENSOR_KEYS } from './config.js';

// Shaped like a real Ecowitt setup in Home Assistant, with German entity names and the
// sensors that share a unit with the right one (soil temperatures, rain totals, VPD).
const e = (id, name, unit, deviceClass) => ({ id, name, unit, deviceClass });
const ENTITIES = [
  e('sensor.station_aussentemperatur', 'Außentemperatur', '°C', 'temperature'),
  e('sensor.station_gefuhlte_temperatur', 'Gefühlte Temperatur', '°C', 'temperature'),
  e('sensor.station_taupunkt', 'Taupunkt', '°C', 'temperature'),
  e('sensor.station_temperature_indoor', 'Temperatur (Innen)', '°C', 'temperature'),
  e('sensor.pot_soil_temperature', 'Blumentopf Bodentemperatur', '°C', 'temperature'),
  e('sensor.station_luftfeuchtigkeit', 'Luftfeuchtigkeit', '%', 'humidity'),
  e('sensor.station_humidity_indoor', 'Luftfeuchtigkeit (Innen)', '%', 'humidity'),
  e('sensor.pot_soil_moisture', 'Blumentopf Bodenfeuchtigkeit', '%', 'moisture'),
  e('sensor.station_windgeschwindigkeit', 'Windgeschwindigkeit', 'km/h', 'wind_speed'),
  e('sensor.station_windboe', 'Windböe', 'km/h', 'wind_speed'),
  e('sensor.station_maximale_tagesboe', 'Maximale Tagesböe', 'km/h', 'wind_speed'),
  e('sensor.station_wind_direction', 'Wind Direction', '°', null),
  e('sensor.station_wind_direction_avg', 'Wind Direction Avg', '°', null),
  e('sensor.station_niederschlagsintensitat', 'Niederschlagsintensität', 'mm/h', 'precipitation_intensity'),
  e('sensor.station_regenereignis', 'Regenereignis', 'mm', 'precipitation'),
  e('sensor.station_hourly_rain', 'Hourly Rain', 'mm', 'precipitation'),
  e('sensor.station_24_stunden_niederschlag', '24-Stunden-Niederschlag', 'mm', 'precipitation'),
  e('sensor.station_taglicher_niederschlag', 'Täglicher Niederschlag', 'mm', 'precipitation'),
  e('sensor.station_wochentlicher_niederschlag', 'Wöchentlicher Niederschlag', 'mm', 'precipitation'),
  e('sensor.station_monatlicher_niederschlag', 'Monatlicher Niederschlag', 'mm', 'precipitation'),
  e('sensor.station_pressure_absolute', 'Absoluter Luftdruck', 'hPa', 'atmospheric_pressure'),
  e('sensor.station_pressure_relative', 'Relativer Luftdruck', 'hPa', 'atmospheric_pressure'),
  e('sensor.station_vpd', 'Vapor Pressure Deficit', 'kPa', 'pressure'),
  e('sensor.station_solar_radiation', 'Solar Radiation', 'W/m²', 'irradiance'),
  e('sensor.station_illuminance', 'Beleuchtungsstärke (Lux)', 'lx', 'illuminance'),
  e('sensor.station_uv_index', 'UV Index', 'UV Index', null),
  e('sensor.lightning_distance', 'Lightning Sensor Lightning Distance', 'km', 'distance'),
  e('sensor.lightning_last', 'Lightning Sensor Last Lightning', null, 'timestamp'),
  e('sensor.lightning_strikes', 'Lightning Sensor Lightning Strikes', 'strikes', null),
  e('sensor.lightning_battery', 'Lightning Sensor Battery', '%', 'battery'),
  e('sensor.station_battery', 'WH90 Batterie', 'V', 'voltage'),
];

const best = suggestSensors(ENTITIES);

test('suggestSensors answers for every sensor key', () => {
  assert.deepEqual(Object.keys(best).sort(), [...SENSOR_KEYS].sort());
});

test('the right entity comes first for every reading', () => {
  const expected = {
    temperature: 'sensor.station_aussentemperatur',
    feels_like: 'sensor.station_gefuhlte_temperatur',
    dew_point: 'sensor.station_taupunkt',
    humidity: 'sensor.station_luftfeuchtigkeit',
    wind_speed: 'sensor.station_windgeschwindigkeit',
    wind_gust: 'sensor.station_windboe',
    wind_direction: 'sensor.station_wind_direction',
    rain_rate: 'sensor.station_niederschlagsintensitat',
    rain_event: 'sensor.station_regenereignis',
    rain_daily: 'sensor.station_taglicher_niederschlag',
    pressure: 'sensor.station_pressure_relative',
    solar_radiation: 'sensor.station_solar_radiation',
    uv_index: 'sensor.station_uv_index',
    lightning_distance: 'sensor.lightning_distance',
    lightning_time: 'sensor.lightning_last',
    lightning_count: 'sensor.lightning_strikes',
  };
  for (const [key, id] of Object.entries(expected)) assert.equal(best[key][0], id, key);
});

test('entities with the wrong unit or kind are not suggested', () => {
  assert.ok(!best.wind_gust.includes('sensor.station_taupunkt'));
  assert.ok(!best.rain_rate.includes('sensor.station_regenereignis'));
  assert.ok(!best.rain_daily.includes('sensor.station_niederschlagsintensitat'));
  assert.ok(!best.humidity.includes('sensor.lightning_battery'));
  assert.ok(!best.pressure.includes('sensor.station_vpd') || best.pressure.indexOf('sensor.station_vpd') > best.pressure.indexOf('sensor.station_pressure_absolute'));
  assert.ok(!best.dew_point.includes('sensor.station_aussentemperatur'));
  assert.ok(!best.lightning_count.includes('sensor.lightning_battery'));
  assert.ok(!best.uv_index.includes('sensor.station_solar_radiation'));
});

test('a fitting but less likely entity is still offered, further down', () => {
  assert.ok(best.temperature.indexOf('sensor.pot_soil_temperature') > 0);
  assert.ok(best.wind_gust.indexOf('sensor.station_maximale_tagesboe') > 0);
  assert.ok(best.rain_daily.indexOf('sensor.station_wochentlicher_niederschlag') > 0);
});

test('units are compared without regard to case and missing fields do not throw', () => {
  const r = suggestSensors([e('sensor.uv', 'UV', 'uv index', null), { id: 'sensor.bare' }]);
  assert.deepEqual(r.uv_index, ['sensor.uv']);
  assert.deepEqual(r.temperature, []);
});

test('sensors from the family of the configured ones come before a weather service with the same unit', () => {
  const list = [
    e('sensor.weather_service_dew_point', 'Weather Service Dew Point', '°C', 'temperature'),
    e('sensor.backyard_dew_point', 'Dew Point', '°C', 'temperature'),
  ];
  assert.equal(suggestSensors(list, ['sensor.backyard_outdoor_temperature'])['dew_point'][0], 'sensor.backyard_dew_point');
  assert.equal(suggestSensors(list, ['sensor.weather_service_temperature'])['dew_point'][0], 'sensor.weather_service_dew_point');
});

test('a device class alone does not make a timestamp a lightning time', () => {
  const r = suggestSensors([e('sensor.backup_last_run', 'Backup Last Run', null, 'timestamp'), e('sensor.lightning_last', 'Last Lightning', null, 'timestamp')]);
  assert.deepEqual(r.lightning_time, ['sensor.lightning_last']);
});
