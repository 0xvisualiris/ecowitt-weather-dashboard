import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveData, parseSensors, reading } from './ecowitt.js';

// Trimmed get_livedata_info answer of a GW2000A (firmware 3.3.2) with WH90 + WH57.
const LIVE = {
  common_list: [
    { id: '0x02', val: '18.8', unit: 'C' }, { id: '0x07', val: '67%' }, { id: '3', val: '18.8', unit: 'C' },
    { id: '0x03', val: '12.6', unit: 'C' }, { id: '0x0B', val: '3.60 km/h' }, { id: '0x0C', val: '7.20 km/h' },
    { id: '0x15', val: '31.25 Klux' }, { id: '0x17', val: '2' }, { id: '0x0A', val: '13' },
  ],
  piezoRain: [{ id: '0x0E', val: '1.2 mm/Hr' }, { id: '0x0D', val: '0.4 mm' }, { id: '0x10', val: '0.1 mm' }, { id: '0x13', val: '349.2 mm' }],
  rain: [{ id: '0x10', val: '0.3 mm' }],
  wh25: [{ intemp: '19.7', unit: 'C', inhumi: '63%', abs: '1000.3 hPa', rel: '1021.6 hPa' }],
  lightning: [{ distance: '17 km', date: '2026-08-31T19:54:47', count: '3' }],
};

test('parseLiveData maps the gateway ids to sensor keys in canonical units', () => {
  const v = parseLiveData(LIVE);
  assert.equal(v.temperature, 18.8);
  assert.equal(v.humidity, 67);
  assert.equal(v.feels_like, 18.8);
  assert.equal(v.dew_point, 12.6);
  assert.equal(v.wind_speed, 3.6);
  assert.equal(v.wind_gust, 7.2);
  assert.equal(v.wind_direction, 13);
  assert.equal(v.uv_index, 2);
  assert.equal(Math.round(v.solar_radiation), 247); // 31.25 klux / 126.7
  assert.equal(v.rain_rate, 1.2);
  assert.equal(v.rain_event, 0.4);
  assert.equal(v.rain_daily, 0.1);   // piezo preferred
  assert.equal(v.rain_yearly, 349.2);
  assert.equal(v.pressure, 1021.6);  // relative by default
  assert.equal(v.lightning_distance, 17);
  assert.equal(v.lightning_count, 3);
  assert.equal(v.lightning_time, new Date(2026, 7, 31, 19, 54, 47).toISOString());
});

test('parseLiveData honours rain_gauge and pressure options', () => {
  assert.equal(parseLiveData(LIVE, { rainGauge: 'tipping' }).rain_daily, 0.3);
  assert.equal(parseLiveData(LIVE, { pressure: 'absolute' }).pressure, 1000.3);
  assert.equal(parseLiveData({ ...LIVE, piezoRain: undefined }).rain_daily, 0.3);
});

test('reading converts imperial units and treats placeholders as missing', () => {
  assert.equal(Math.round(reading('temperature', '68.0', 'F') * 10) / 10, 20);
  assert.equal(Math.round(reading('wind_speed', '10.0 mph') * 100) / 100, 16.09);
  assert.equal(reading('rain_daily', '1.00 in'), 25.4);
  assert.equal(reading('rain_rate', '0.10 in/Hr'), 2.54);
  assert.equal(Math.round(reading('pressure', '30.00 inHg')), 1016);
  assert.equal(reading('solar_radiation', '500.0 W/m2'), 500);
  assert.equal(reading('lightning_distance', '--'), null);
  assert.equal(reading('temperature', '--.-', 'C'), null);
});

test('parseSensors keeps paired sensors only and turns battery levels into percent', () => {
  const s = parseSensors([[
    { img: 'wh90', id: 'D9BD', batt: '5', signal: '4', idst: '1' },
    { img: 'wh69', id: 'FFFFFFFF', batt: '9', signal: '--', idst: '1' },
    { img: 'wh25', id: 'FFFFFFFE', batt: '9', signal: '--', idst: '0' },
    { img: 'wh57', id: 'CE91', batt: '3', signal: '2', idst: '1' },
  ]]);
  assert.deepEqual(s, [
    { img: 'wh90', battery: { value: 100, unit: '%' }, signal: { value: 4, unit: '' } },
    { img: 'wh57', battery: { value: 60, unit: '%' }, signal: { value: 2, unit: '' } },
  ]);
});
