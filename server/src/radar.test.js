import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarSource, latestStamps, stampToMs, latestRun, runToMs, nowcastSteps } from './radar.js';
import { makeTar } from './radolan.test.js';

test('stampToMs reads the YYMMDDHHMM frame stamp as UTC', () => {
  assert.equal(stampToMs('2610111925'), Date.UTC(2026, 9, 11, 19, 25));
  assert.equal(stampToMs('2701010000'), Date.UTC(2027, 0, 1, 0, 0));
});

test('latestStamps picks the newest frames from a directory listing, oldest first, ignoring "latest" and duplicates', () => {
  const link = s => `<a href="raa01-ry_10000-${s}-dwd---bin.hdf5">raa01-ry_10000-${s}-dwd---bin.hdf5</a>`;
  const html = [link('2610111925'), link('2610111915'), link('latest'), link('2610111920'), link('2610111910')].join(' ');
  assert.deepEqual(latestStamps(html, 3), ['2610111915', '2610111920', '2610111925']);
  assert.deepEqual(latestStamps(html, 10), ['2610111910', '2610111915', '2610111920', '2610111925']);
  assert.deepEqual(latestStamps('<html></html>', 3), []);
});

test('RadarSource exposes the newest frame as latest and finds frames by timestamp', () => {
  const radar = new RadarSource();
  assert.equal(radar.latest, null);
  radar.frames = [{ timestamp: 100, grid: new Uint8Array(1) }, { timestamp: 200, grid: new Uint8Array(1) }];
  assert.equal(radar.latest.timestamp, 200);
  assert.equal(radar.frame(100).timestamp, 100);
  assert.equal(radar.frame(150), null);
});

test('latestRun picks the newest nowcast run from the RV listing', () => {
  const link = r => `<a href="composite_rv_${r}.tar">composite_rv_${r}.tar</a>`;
  assert.equal(latestRun([link('20261120_0755'), link('20261120_0800'), link('20261119_2355')].join('\n')), '20261120_0800');
  assert.equal(latestRun('<html></html>'), null);
  assert.equal(runToMs('20261120_0800'), Date.UTC(2026, 10, 20, 8, 0));
});

test('nowcastSteps keeps the forecast steps in order and drops the +0 analysis', () => {
  const tar = makeTar([['composite_rv_20261120_0800_010-hd5', Buffer.from('b')], ['composite_rv_20261120_0800_000-hd5', Buffer.from('n')], ['composite_rv_20261120_0800_005-hd5', Buffer.from('a')]]);
  assert.deepEqual(nowcastSteps(tar).map(s => [s.lead, s.data.toString()]), [[5, 'a'], [10, 'b']]);
});

test('RadarSource offers only forecast steps after the newest frame, of a recent run', () => {
  const radar = new RadarSource();
  const g = new Uint8Array(1), min = 60 * 1000;
  radar.frames = [{ timestamp: 10 * min, grid: g }];
  radar.run = 5 * min;
  radar.forecast = [10, 15, 20].map(m => ({ timestamp: m * min, grid: g }));
  assert.deepEqual(radar.upcoming(12 * min).map(f => f.timestamp / min), [15, 20]);
  assert.equal(radar.forecastFrame(15 * min, 5 * min, 12 * min).timestamp, 15 * min);
  assert.equal(radar.forecastFrame(15 * min, 0, 12 * min), null, 'a replaced run is gone');
  assert.equal(radar.forecastFrame(10 * min, 5 * min, 12 * min), null, 'observed by now');
  assert.deepEqual(radar.upcoming(60 * min), [], 'a run older than 45 minutes is not shown');
});
