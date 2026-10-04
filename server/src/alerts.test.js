import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalize } from './units.js';
import { AlertEngine } from './alerts.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-test-'));
}

// Mirrors the three WeatherService methods AlertEngine actually uses, keyed
// by sensor key (for .entity()/.value()) or raw HA entity id (for .rawEntity()).
function makeSvc(entities) {
  return {
    entity: key => entities[key] ?? null,
    rawEntity: id => entities[id] ?? null,
    value: key => {
      const e = entities[key];
      return e ? normalize(key, e.state, e.attributes?.unit_of_measurement) : null;
    },
  };
}

test('_check: above/below/at_least/at_most/equals', () => {
  const engine = new AlertEngine({ server: { data_dir: tmpDir() }, alerts: [] }, makeSvc({ temperature: { state: '5' } }));
  assert.equal(engine._check({ sensor: 'temperature', above: 0 }), true);
  assert.equal(engine._check({ sensor: 'temperature', above: 10 }), false);
  assert.equal(engine._check({ sensor: 'temperature', below: 10 }), true);
  assert.equal(engine._check({ sensor: 'temperature', below: 0 }), false);
  assert.equal(engine._check({ sensor: 'temperature', at_least: 5 }), true);
  assert.equal(engine._check({ sensor: 'temperature', at_most: 5 }), true);
  assert.equal(engine._check({ sensor: 'temperature', equals: 5 }), true);
  assert.equal(engine._check({ sensor: 'temperature', equals: 6 }), false);
});

test('_check: a missing/null reading never matches', () => {
  const engine = new AlertEngine({ server: { data_dir: tmpDir() }, alerts: [] }, makeSvc({}));
  assert.equal(engine._check({ sensor: 'temperature', above: -100 }), false);
});

test('_check: entity-based condition reads via rawEntity + toNumber', () => {
  const engine = new AlertEngine({ server: { data_dir: tmpDir() }, alerts: [] }, makeSvc({ 'sensor.x': { state: '42' } }));
  assert.equal(engine._check({ entity: 'sensor.x', above: 40 }), true);
  assert.equal(engine._check({ entity: 'sensor.x', above: 50 }), false);
});

test('_check: recent requires a timestamp within the given window', () => {
  const now = Date.now();
  const svc = makeSvc({
    lightning_distance: { state: '5' },
    lightning_time: { state: new Date(now - 10 * 60000).toISOString() },
  });
  const engine = new AlertEngine({ server: { data_dir: tmpDir() }, alerts: [] }, svc);
  assert.equal(engine._check({ sensor: 'lightning_distance', below: 15, recent: { sensor: 'lightning_time', minutes: 30 } }), true);
  assert.equal(engine._check({ sensor: 'lightning_distance', below: 15, recent: { sensor: 'lightning_time', minutes: 5 } }), false);
});

test('_message interpolates sensor placeholders plus |time and |compass filters', () => {
  const svc = makeSvc({
    lightning_distance: { state: '3.456' },
    wind_direction: { state: '90' },
    lightning_time: { state: '2026-10-04T14:05:00.000Z' },
  });
  const engine = new AlertEngine({ server: { data_dir: tmpDir() }, alerts: [] }, svc);
  const text = engine._message('Entfernung {lightning_distance} km aus {wind_direction|compass}, um {lightning_time|time} Uhr');
  // lightning_distance formats with 0 decimals (DECIMALS.distance), wind_direction 90° -> compass 'O'
  assert.match(text, /^Entfernung 3 km aus O, um \d{2}:\d{2} Uhr$/);
});

test('evaluate activates a rule, logs it once, and keeps it active while still true', () => {
  const cfg = {
    server: { data_dir: tmpDir() },
    alert_clear_minutes: 10,
    alerts: [{ id: 'frost', label: 'Frost', level: 'info', all: [{ sensor: 'temperature', below: 0 }], message: 'Temperatur {temperature} °C' }],
  };
  const engine = new AlertEngine(cfg, makeSvc({ temperature: { state: '-2' } }));
  engine.evaluate();
  let v = engine.view();
  assert.equal(v.rules[0].active, true);
  assert.equal(v.log.length, 1);
  assert.match(v.log[0].text, /^Temperatur -2,0 °C$/);

  engine.evaluate(); // still true -> no duplicate log entry
  v = engine.view();
  assert.equal(v.rules[0].active, true);
  assert.equal(v.log.length, 1);
});

test('evaluate clears a rule only after it has been false for alert_clear_minutes', async () => {
  const cfg = {
    server: { data_dir: tmpDir() },
    alert_clear_minutes: 1 / 1200, // 50ms, so the test doesn't need to wait long
    alerts: [{ id: 'frost', label: 'Frost', level: 'info', all: [{ sensor: 'temperature', below: 0 }], message: 'kalt' }],
  };
  let temp = -2;
  const svc = {
    entity: key => (key === 'temperature' ? { state: String(temp) } : null),
    rawEntity: () => null,
    value: key => (key === 'temperature' ? temp : null),
  };
  const engine = new AlertEngine(cfg, svc);
  engine.evaluate();
  assert.equal(engine.view().rules[0].active, true);

  temp = 10; // condition now false
  engine.evaluate();
  assert.equal(engine.view().rules[0].active, true, 'should not clear immediately');

  await new Promise(r => setTimeout(r, 80));
  engine.evaluate();
  assert.equal(engine.view().rules[0].active, false);
  assert.ok(engine.view().log[0].end, 'log entry should be marked ended');
});
