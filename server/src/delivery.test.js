import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { negotiate, compress, Encoded, encodedGrid, etagOf, matches, StaticFiles } from './delivery.js';

test('negotiate prefers br, then gzip, and honours q=0', () => {
  assert.equal(negotiate('gzip, deflate, br, zstd'), 'br');
  assert.equal(negotiate('gzip, deflate'), 'gzip');
  assert.equal(negotiate('br;q=0, gzip;q=0.5'), 'gzip');
  assert.equal(negotiate('BR'), 'br');
  assert.equal(negotiate('gzip;q=0'), null);
  assert.equal(negotiate('identity'), null);
  assert.equal(negotiate(''), null);
  assert.equal(negotiate(undefined), null);
});

test('compress round-trips both encodings', () => {
  const buf = Buffer.from('radar '.repeat(500));
  assert.deepEqual(zlib.gunzipSync(compress(buf, 'gzip')), buf);
  assert.deepEqual(zlib.brotliDecompressSync(compress(buf, 'br')), buf);
  assert.equal(compress(buf, null), buf);
});

test('Encoded compresses each encoding once and keeps it', () => {
  const enc = new Encoded(Buffer.alloc(5000, 7));
  const br = enc.get('br');
  assert.equal(enc.get('br'), br);
  assert.equal(enc.get(null), enc.buf);
  assert.deepEqual(zlib.brotliDecompressSync(br), enc.buf);
  assert.deepEqual(zlib.gunzipSync(enc.get('gzip')), enc.buf);
});

test('encodedGrid keeps one copy per grid and does not copy the bytes', () => {
  const grid = new Uint8Array(4000).fill(255);
  const a = encodedGrid(grid);
  assert.equal(encodedGrid(grid), a);
  assert.notEqual(encodedGrid(new Uint8Array(4000)), a);
  grid[0] = 3;
  assert.equal(a.buf[0], 3);
});

test('etagOf is weak and content-based; matches compares weakly and accepts lists and *', () => {
  const tag = etagOf(Buffer.from('a'));
  assert.match(tag, /^W\/"[\w-]{22}"$/);
  assert.equal(etagOf(Buffer.from('a')), tag);
  assert.notEqual(etagOf(Buffer.from('b')), tag);
  assert.ok(matches(tag, tag));
  assert.ok(matches(tag.slice(2), tag));
  assert.ok(matches(`"x", ${tag}`, tag));
  assert.ok(matches('*', tag));
  assert.ok(!matches('"x"', tag));
  assert.ok(!matches(undefined, tag));
});

test('StaticFiles reads once, and again when the file or variant changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-'));
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'one');
  let reads = 0;
  const upper = (b) => { reads++; return Buffer.from(b.toString().toUpperCase()); };
  const files = new StaticFiles();
  const first = files.get(file, 'v1', upper);
  assert.equal(first.encoded.buf.toString(), 'ONE');
  assert.equal(files.get(file, 'v1', upper), first);
  assert.equal(reads, 1);
  assert.notEqual(files.get(file, 'v2', upper).etag, undefined);
  assert.equal(reads, 2);
  fs.writeFileSync(file, 'three');
  assert.equal(files.get(file, 'v2', upper).encoded.buf.toString(), 'THREE');
  assert.equal(files.get(path.join(dir, 'missing.txt')), null);
  assert.equal(files.get(dir), null);
  fs.rmSync(dir, { recursive: true });
});
