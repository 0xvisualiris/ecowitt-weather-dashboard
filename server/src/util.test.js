import test from 'node:test';
import assert from 'node:assert/strict';
import { startOfDay, startOfWeek, startOfMonth, startOfYear, startOfHour, counterIncrements, bucketLine, bucketCounter, round, makeCache } from './util.js';

test('startOfDay zeroes the time of day', () => {
  const t = new Date(2026, 9, 15, 14, 32, 10).getTime();
  assert.equal(startOfDay(t), new Date(2026, 9, 15, 0, 0, 0, 0).getTime());
});

test('startOfWeek rolls back to Monday', () => {
  const thu = new Date(2026, 9, 15, 10).getTime(); // Thursday
  assert.equal(startOfWeek(thu), new Date(2026, 9, 12, 0, 0, 0, 0).getTime());
  const mon = new Date(2026, 9, 12, 23, 59).getTime(); // Monday maps to itself
  assert.equal(startOfWeek(mon), new Date(2026, 9, 12, 0, 0, 0, 0).getTime());
});

test('startOfMonth / startOfYear', () => {
  const t = new Date(2026, 9, 15, 10).getTime();
  assert.equal(startOfMonth(t), new Date(2026, 9, 1, 0, 0, 0, 0).getTime());
  assert.equal(startOfYear(t), new Date(2026, 0, 1, 0, 0, 0, 0).getTime());
});

test('startOfHour', () => {
  const t = new Date(2026, 9, 15, 14, 32, 10, 500).getTime();
  assert.equal(startOfHour(t), new Date(2026, 9, 15, 14, 0, 0, 0).getTime());
});

test('counterIncrements treats a drop as a reset, not a negative increment', () => {
  const pts = [{ t: 0, v: 5 }, { t: 1, v: 8 }, { t: 2, v: 2 }, { t: 3, v: 6 }];
  assert.deepEqual(counterIncrements(pts), [
    { t: 1, v: 3 }, // 8 - 5
    { t: 2, v: 2 }, // dropped 8 -> 2: treated as a fresh reading, not -6
    { t: 3, v: 4 }, // 6 - 2
  ]);
});

test('counterIncrements skips null values and needs a first value to diff against', () => {
  const pts = [{ t: 0, v: null }, { t: 1, v: 10 }, { t: 2, v: null }, { t: 3, v: 14 }];
  assert.deepEqual(counterIncrements(pts), [{ t: 3, v: 4 }]);
});

test('round', () => {
  assert.equal(round(1.2345, 2), 1.23);
  assert.equal(round(3, 0), 3);
  assert.equal(round(null), null);
  assert.equal(round(undefined), null);
  assert.equal(round(NaN), null);
  assert.equal(round(Infinity), null);
});

test('bucketLine averages points that fall within a single bucket', () => {
  const out = bucketLine([{ t: 1, v: 10 }, { t: 5, v: 20 }], 0, 10, 10);
  assert.deepEqual(out, [{ t: 0, v: 15, lo: 10, hi: 20 }]);
});

test('bucketLine holds the last known value across an empty bucket', () => {
  const out = bucketLine([{ t: 1, v: 10 }], 0, 20, 10);
  assert.deepEqual(out[0], { t: 0, v: 10, lo: 10, hi: 10 });
  assert.deepEqual(out[1], { t: 10, v: 10, lo: 10, hi: 10 });
});

test('bucketLine returns null for a bucket before any data has arrived', () => {
  const out = bucketLine([{ t: 15, v: 5 }], 0, 20, 10);
  assert.equal(out[0].v, null);
  assert.equal(out[1].v, 5);
});

test('bucketCounter sums increments per window, including a reset as a fresh amount', () => {
  const points = [{ t: 0, v: 0 }, { t: 5, v: 2 }, { t: 15, v: 5 }, { t: 25, v: 1 }, { t: 35, v: 3 }];
  const out = bucketCounter(points, 0, 40, 10);
  assert.deepEqual(out.map(o => o.v), [2, 3, 1, 2]);
});

test('makeCache serves the cached value within the TTL and refetches once it expires', async () => {
  const cached = makeCache();
  let calls = 0;
  const fn = async () => { calls++; return calls; };
  const a = await cached('k', 30, fn);
  const b = await cached('k', 30, fn);
  assert.equal(calls, 1);
  assert.equal(a, 1);
  assert.equal(b, 1);
  await new Promise(r => setTimeout(r, 40));
  const c = await cached('k', 30, fn);
  assert.equal(calls, 2);
  assert.equal(c, 2);
});

test('makeCache dedupes concurrent in-flight calls for the same key', async () => {
  const cached = makeCache();
  let calls = 0;
  const fn = () => new Promise(resolve => { calls++; setTimeout(() => resolve(calls), 20); });
  const [a, b] = await Promise.all([cached('k', 1000, fn), cached('k', 1000, fn)]);
  assert.equal(calls, 1);
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test('makeCache serves the last good value if a refetch fails', async () => {
  const cached = makeCache();
  let fail = false;
  const fn = async () => { if (fail) throw new Error('boom'); return 'ok'; };
  assert.equal(await cached('k', 10, fn), 'ok');
  await new Promise(r => setTimeout(r, 20));
  fail = true;
  assert.equal(await cached('k', 10, fn), 'ok');
});

test('makeCache throws if the very first fetch fails (nothing stale to serve)', async () => {
  const cached = makeCache();
  await assert.rejects(() => cached('k', 1000, async () => { throw new Error('boom'); }), /boom/);
});
