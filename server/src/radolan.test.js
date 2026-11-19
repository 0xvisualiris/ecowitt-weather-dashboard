import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodeComposite, rateClass, outToLonLat, lonLatToSrc, OUT, SRC_W, SRC_H } from './radolan.js';

// A minimal stand-in for DWD's HDF5 file: the HDF5 signature, some filler
// and the zlib-compressed 1100x1200 uint16 grid, rather than committing a
// real ~400 KB DWD fixture. `fill(i)` gives the raw value of source cell i.
function makeFile(fill) {
  const data = Buffer.alloc(SRC_W * SRC_H * 2);
  for (let i = 0; i < SRC_W * SRC_H; i++) data.writeUInt16LE(fill(i), i * 2);
  const signature = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Filler holding a small, unrelated zlib stream that must be skipped.
  return Buffer.concat([signature, Buffer.alloc(64, 0x78), deflateSync(Buffer.from('not the grid')), deflateSync(data, { level: 4 })]);
}

test('rateClass maps no data to 255, no rain to 0 and rates to 0.6 mm/h steps', () => {
  assert.equal(rateClass(65535), 255);
  assert.equal(rateClass(0), 0);
  assert.equal(rateClass(1), 1, 'any rain shows, however light');
  assert.equal(rateClass(600), 10, '6 mm/h');
  assert.equal(rateClass(60000), 254, 'an extreme rate is clamped, not overflowed');
});

test('the two projections agree on where a place is', () => {
  // Frankfurt, near the middle of both grids; DWD's corner cells from the file's attributes.
  const [lon, lat] = outToLonLat(380, 560);
  const back = lonLatToSrc(lon, lat);
  assert.ok(back[0] > 0 && back[0] < SRC_W && back[1] > 0 && back[1] < SRC_H);
  const ul = lonLatToSrc(1.46330151, 55.86208711), lr = lonLatToSrc(16.58086935, 45.68460578);
  assert.ok(Math.abs(ul[0] + 0.5) < 0.01 && Math.abs(ul[1] + 0.5) < 0.01, `north-west corner at ${ul}`);
  assert.ok(Math.abs(lr[0] - (SRC_W - 0.5)) < 0.01 && Math.abs(lr[1] - (SRC_H - 0.5)) < 0.01, `south-east corner at ${lr}`);
});

test('decodeComposite resamples the DWD grid onto the 900x900 grid', () => {
  // Rain only in the DWD cell under one browser cell; no data in the top row.
  const [col, row] = [450, 450];
  const [sc, sr] = lonLatToSrc(...outToLonLat(col + 0.5, row + 0.5)).map(Math.round);
  const target = sr * SRC_W + sc;
  const { width, height, grid } = decodeComposite(makeFile((i) => (i === target ? 600 : i < SRC_W ? 65535 : 0)));
  assert.equal(width, OUT);
  assert.equal(height, OUT);
  assert.equal(grid[row * OUT + col], 10);
  assert.equal(grid.filter((v) => v === 10).length, 1, 'one DWD cell lands in one browser cell here');
  assert.equal(grid[0], 0, 'the browser grid lies inside the bigger DWD grid');
});

test('decodeComposite rejects files that are not HDF5 or hold no grid', () => {
  assert.throws(() => decodeComposite(Buffer.from('not a radar file')), /not an HDF5 file/);
  const signature = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.throws(() => decodeComposite(Buffer.concat([signature, deflateSync(Buffer.alloc(100))])), /no 1100x1200 data grid/);
});
