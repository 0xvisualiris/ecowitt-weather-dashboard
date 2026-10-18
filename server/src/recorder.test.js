import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aggregateHour, rollup, Recorder } from './recorder.js';
import { HOUR, startOfHour, startOfDay } from './util.js';

test('aggregateHour gives mean/min/max/last, and counter increments across a reset', () => {
  const prev = { t: 0, v: { rain_daily: 5 } };
  const rows = [
    { t: 1, v: { temperature: 10, rain_daily: 5.5 } },
    { t: 2, v: { temperature: 14, rain_daily: 6 } },
    { t: 3, v: { temperature: 12, rain_daily: 0.2 } }, // midnight reset
  ];
  const a = aggregateHour(rows, prev);
  assert.deepEqual(a.temperature, [12, 10, 14, 12, null, 3]);
  assert.equal(Math.round(a.rain_daily[4] * 10) / 10, 1.2); // 0.5 + 0.5 + 0.2
});

test('aggregateHour without an earlier reading counts from the first one of the hour', () => {
  const a = aggregateHour([{ t: 1, v: { lightning_count: 4 } }, { t: 2, v: { lightning_count: 6 } }], null);
  assert.equal(a.lightning_count[4], 2);
});

test('rollup merges hours into days, weighting the mean by sample count', () => {
  const d = startOfDay(Date.UTC(2026, 5, 1, 12));
  const hours = [
    { t: d + HOUR, s: { temperature: [10, 8, 12, 11, null, 1], rain_daily: [1, 0, 2, 2, 2, 1] } },
    { t: d + 2 * HOUR, s: { temperature: [20, 18, 22, 21, null, 3], rain_daily: [2, 2, 3, 3, 1, 3] } },
  ];
  const [t] = rollup(hours, 'temperature', 'day');
  assert.equal(t.start, d);
  assert.equal(t.mean, 17.5);
  assert.equal(t.min, 8);
  assert.equal(t.max, 22);
  assert.equal(t.state, 21);
  assert.equal(t.change, null);
  assert.equal(rollup(hours, 'rain_daily', 'day')[0].change, 3);
  assert.equal(rollup(hours, 'temperature', 'hour').length, 2);
});

test('Recorder persists samples, builds hourly rows and reloads them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recorder-'));
  try {
    const now = Date.now(), h = startOfHour(now) - 2 * HOUR;
    const r = new Recorder(dir);
    r.load();
    r.add(h + 60000, { temperature: 10, rain_daily: 1 });
    r.add(h + 120000, { temperature: 12, rain_daily: 1.5 });
    r.add(h + HOUR + 60000, { temperature: 14, rain_daily: 2 });
    r.add(now, { temperature: 16, rain_daily: 2 });
    assert.equal(r.hours.size, 2);

    const again = new Recorder(dir);
    again.load();
    assert.equal(again.samples.length, 4);
    assert.equal(again.hours.size, 2);
    const stats = again.statistics(['temperature', 'rain_daily'], h, now + 1, 'hour');
    assert.deepEqual(stats.temperature.map(x => x.mean), [11, 14, 16]); // running hour included
    assert.deepEqual(stats.rain_daily.map(x => x.change), [0.5, 0.5, 0]);
    const hist = again.history(['temperature'], h + 90000, now);
    assert.deepEqual(hist.temperature.map(p => p.s), [10, 12, 14, 16]); // starts with the reading in force at `start`
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
