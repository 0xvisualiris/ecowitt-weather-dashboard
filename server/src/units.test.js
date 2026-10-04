import test from 'node:test';
import assert from 'node:assert/strict';
import { toNumber, normalize, compass, fmtDe } from './units.js';

test('toNumber', () => {
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(undefined), null);
  assert.equal(toNumber('unknown'), null);
  assert.equal(toNumber('unavailable'), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber(5), 5);
  assert.equal(toNumber('5'), 5);
  assert.equal(toNumber('5,5'), 5.5);
  assert.equal(toNumber('abc'), null);
});

test('normalize converts known units per dimension', () => {
  assert.equal(normalize('temperature', '32', '°F'), 0);
  assert.equal(normalize('temperature', '100', 'C'), 100);
  assert.equal(normalize('wind_speed', '10', 'm/s'), 36);
  assert.equal(normalize('pressure', '1000', 'hPa'), 1000);
  assert.equal(normalize('lightning_distance', '1', 'mi'), 1.609344);
});

test('normalize passes the raw number through when no conversion applies', () => {
  assert.equal(normalize('humidity', '55', '%'), 55); // dimension 'none' has no CONV table
  assert.equal(normalize('temperature', '20', undefined), 20); // no unit given
});

test('normalize returns null for a non-numeric state', () => {
  assert.equal(normalize('temperature', 'unavailable', '°C'), null);
});

test('compass', () => {
  assert.equal(compass(null), '—');
  assert.equal(compass(0), 'N');
  assert.equal(compass(90), 'O');
  assert.equal(compass(180), 'S');
  assert.equal(compass(359), 'N');
});

test('fmtDe formats with a German decimal comma', () => {
  assert.equal(fmtDe(1.5, 1), '1,5');
  assert.equal(fmtDe(3, 0), '3');
  assert.equal(fmtDe(null), '—');
  assert.equal(fmtDe(NaN), '—');
});
