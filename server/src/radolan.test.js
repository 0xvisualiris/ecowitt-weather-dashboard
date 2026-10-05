import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeRadolan } from './radolan.js';

// Builds a minimal synthetic RADOLAN buffer: a real-shaped ASCII header
// (GP/PR fields, ETX terminator) over a small hand-picked grid, rather than
// committing a real ~1.6MB DWD fixture file.
function makeBuffer({ width, height, precisionExp, dayHHMM, values }) {
  const header = `RY${dayHHMM}10000102BY${0}VS 3SW   2.29.1PR E${precisionExp >= 0 ? '+' : ''}${String(precisionExp).padStart(2, '0')}INT   5GP ${width}x ${height}MS 1<xyz>`;
  const headerBuf = Buffer.from(header + ' ', 'ascii');
  const etx = Buffer.from([0x03]);
  const dataBuf = Buffer.alloc(width * height * 2);
  values.forEach((v, i) => dataBuf.writeUInt16LE(v, i * 2));
  return Buffer.concat([headerBuf, etx, dataBuf]);
}

test('decodeRadolan reads grid dimensions and precision from the header', () => {
  const buf = makeBuffer({ width: 3, height: 2, precisionExp: -2, dayHHMM: '052040', values: [0, 0, 0, 0, 0, 0] });
  const { width, height, precision } = decodeRadolan(buf);
  assert.equal(width, 3);
  assert.equal(height, 2);
  assert.equal(precision, 0.01);
});

test('decodeRadolan maps the 2500 sentinel to 255 (no data) and 0 to 0', () => {
  const buf = makeBuffer({ width: 2, height: 1, precisionExp: -2, dayHHMM: '052040', values: [2500, 0] });
  const { grid } = decodeRadolan(buf);
  assert.equal(grid[0], 255);
  assert.equal(grid[1], 0);
});

test('decodeRadolan clamps a measured value into a 1-254 display class', () => {
  const buf = makeBuffer({ width: 3, height: 1, precisionExp: -2, dayHHMM: '052040', values: [1, 50, 4000] });
  const { grid } = decodeRadolan(buf);
  assert.ok(grid[0] >= 1 && grid[0] <= 254);
  assert.ok(grid[1] > grid[0], 'a larger raw value should map to a larger display class');
  assert.equal(grid[2], 254, 'an extreme value is clamped to the top of the display range, not overflowed');
});

test('decodeRadolan parses the header timestamp (day/hour/minute, UTC)', () => {
  const buf = makeBuffer({ width: 1, height: 1, precisionExp: -2, dayHHMM: '152340', values: [0] });
  const { timestamp } = decodeRadolan(buf);
  const d = new Date(timestamp);
  assert.equal(d.getUTCDate(), 15);
  assert.equal(d.getUTCHours(), 23);
  assert.equal(d.getUTCMinutes(), 40);
});

test('decodeRadolan rejects a buffer with no ETX header terminator', () => {
  assert.throws(() => decodeRadolan(Buffer.from('not a radolan file, no etx byte here')), /ETX/);
});

test('decodeRadolan rejects a payload shorter than width*height*2', () => {
  const buf = makeBuffer({ width: 10, height: 10, precisionExp: -2, dayHHMM: '052040', values: [0, 0] });
  const truncated = buf.subarray(0, buf.length - 4);
  assert.throws(() => decodeRadolan(truncated), /too short/);
});
