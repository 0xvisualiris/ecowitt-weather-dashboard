import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarSource, latestStamps, stampToMs } from './radar.js';

test('stampToMs reads the YYMMDDHHMM frame stamp as UTC', () => {
  assert.equal(stampToMs('2610111925'), Date.UTC(2026, 9, 11, 19, 25));
  assert.equal(stampToMs('2701010000'), Date.UTC(2027, 0, 1, 0, 0));
});

test('latestStamps picks the newest frames from a directory listing, oldest first, ignoring "latest" and duplicates', () => {
  const link = s => `<a href="raa01-ry_10000-${s}-dwd---bin.bz2">raa01-ry_10000-${s}-dwd---bin.bz2</a>`;
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
