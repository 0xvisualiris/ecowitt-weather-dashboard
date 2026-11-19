import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseTilePath, tileOf, TileCache, MIN_ZOOM, MAX_ZOOM } from './tiles.js';

test('tileOf gives the standard Web Mercator tile numbers', () => {
  assert.deepEqual(tileOf(0, 0, 1), [1, 1]);
  assert.deepEqual(tileOf(8.682, 50.111, 10), [536, 346]);   // Frankfurt
});

test('parseTilePath accepts tiles over the radar area only', () => {
  const [x, y] = tileOf(8.682, 50.111, 12);
  assert.deepEqual(parseTilePath(`/api/tiles/12/${x}/${y}.png`), [12, x, y]);
  assert.equal(parseTilePath(`/api/tiles/${MAX_ZOOM + 1}/0/0.png`), null, 'too deep');
  assert.equal(parseTilePath(`/api/tiles/${MIN_ZOOM - 1}/8/5.png`), null, 'too shallow');
  const [nx, ny] = tileOf(-74, 40.7, 12);   // New York
  assert.equal(parseTilePath(`/api/tiles/12/${nx}/${ny}.png`), null, 'not an open proxy');
  assert.equal(parseTilePath('/api/tiles/12/../1.png'), null);
  assert.equal(parseTilePath('/api/tiles/12/1/2.jpg'), null);
});

function fakeFetch(calls, { ok = true } = {}) {
  return async (url) => {
    calls.push(url);
    return { ok, status: ok ? 200 : 503, arrayBuffer: async () => new TextEncoder().encode(`png:${url}`).buffer };
  };
}

test('TileCache downloads once, then serves from disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiles-'));
  const calls = [];
  const cache = new TileCache(dir, { fetchImpl: fakeFetch(calls) });
  const [a, b] = await Promise.all([cache.get(10, 536, 347), cache.get(10, 536, 347)]);
  assert.equal(calls.length, 1, 'concurrent requests for one tile share one download');
  assert.equal(String(a), 'png:https://tile.openstreetmap.org/10/536/347.png');
  assert.deepEqual(a, b);
  await cache.get(10, 536, 347);
  assert.equal(calls.length, 1, 'a fresh cached tile is not fetched again');
  assert.ok(fs.existsSync(path.join(dir, '10', '536', '347.png')));
});

test('TileCache refreshes an old tile and falls back to it if OSM is down', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tiles-'));
  const calls = [];
  let now = Date.now();
  await new TileCache(dir, { fetchImpl: fakeFetch(calls) }).get(10, 1, 2);
  now += 30 * 24 * 3600 * 1000;
  const down = new TileCache(dir, { fetchImpl: fakeFetch(calls, { ok: false }), now: () => now });
  assert.equal(String(await down.get(10, 1, 2)), 'png:https://tile.openstreetmap.org/10/1/2.png');
  assert.equal(calls.length, 2, 'the stale tile was re-requested');
  await assert.rejects(down.get(10, 9, 9), /HTTP 503/, 'nothing cached and OSM down: an error');
});
