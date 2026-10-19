import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT_LIMITS, tooLongError } from './admin.js';

test('tooLongError accepts a patch whose text fields are at their limits', () => {
  const patch = {
    station: { name: 'n'.repeat(TEXT_LIMITS.stationName), subtitle: 's'.repeat(TEXT_LIMITS.stationSubtitle), devices: [{ name: 'd'.repeat(TEXT_LIMITS.deviceName), short: 'WH90', role: 'Outdoor sensor' }] },
    alerts: [{ label: 'l'.repeat(TEXT_LIMITS.alertLabel), description: '', banner: 'b'.repeat(TEXT_LIMITS.alertBanner), message: 'm'.repeat(TEXT_LIMITS.alertMessage) }],
  };
  assert.equal(tooLongError(patch), null);
});

test('tooLongError names the over-long field and its limit', () => {
  assert.equal(tooLongError({ station: { name: 'n'.repeat(TEXT_LIMITS.stationName + 1) } }), `station name is too long (max ${TEXT_LIMITS.stationName} characters)`);
  assert.equal(tooLongError({ station: { subtitle: 's'.repeat(200) } }), `station subtitle is too long (max ${TEXT_LIMITS.stationSubtitle} characters)`);
  assert.equal(tooLongError({ alerts: [{ label: 'ok' }, { label: 'x', message: 'm'.repeat(TEXT_LIMITS.alertMessage + 1) }] }), `alert message is too long (max ${TEXT_LIMITS.alertMessage} characters)`);
  assert.equal(tooLongError({ station: { devices: [{ short: 'far-too-long-short-name' }] } }), `device short name is too long (max ${TEXT_LIMITS.deviceShort} characters)`);
});

test('tooLongError measures the trimmed value and ignores non-strings and restore-defaults', () => {
  assert.equal(tooLongError({ station: { name: ' '.repeat(100) + 'Weather Station' } }), null);
  assert.equal(tooLongError({ station: { name: 12345, devices: 'nope' }, alerts: null }), null);
  assert.equal(tooLongError({}), null);
  assert.equal(tooLongError(null), null);
});
