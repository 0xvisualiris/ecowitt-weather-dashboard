import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TEXT_LIMITS, tooLongError, AdminStore } from './admin.js';

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

test('tooLongError checks each language of a legal text', () => {
  assert.equal(tooLongError({ legal: { imprint: 'i'.repeat(TEXT_LIMITS.legalImprint), privacy: { en: 'p', de: 'p'.repeat(TEXT_LIMITS.legalPrivacy) } } }), null);
  assert.equal(tooLongError({ legal: { imprint: { de: 'i'.repeat(TEXT_LIMITS.legalImprint + 1) } } }), `imprint is too long (max ${TEXT_LIMITS.legalImprint} characters)`);
  assert.equal(tooLongError({ legal: { privacy: 'p'.repeat(TEXT_LIMITS.legalPrivacy + 1) } }), `privacy policy is too long (max ${TEXT_LIMITS.legalPrivacy} characters)`);
});

test('saveSettings stores legal texts, skips locked ones, and an empty text removes the page', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-test-'));
  try {
    const store = new AdminStore(dir);
    assert.deepEqual(store.getSettings().legal, { imprint: '', privacy: '' });
    const unlocked = { sensors: {} };
    assert.equal(store.saveSettings(unlocked, { legal: { imprint: { en: ' Imprint ', de: 'Impressum', fr: 'ignored' }, privacy: 'Same in every language' } }).ok, true);
    assert.deepEqual(store.getSettings().legal, { imprint: { en: 'Imprint', de: 'Impressum' }, privacy: 'Same in every language' });
    assert.equal(store.saveSettings({ ...unlocked, legalPrivacy: true }, { legal: { imprint: { en: '', de: '  ' }, privacy: 'changed' } }).ok, true);
    assert.deepEqual(store.getSettings().legal, { imprint: '', privacy: 'Same in every language' });
    // Survives a restart, and an admin.json from before legal pages gets the empty default.
    assert.deepEqual(new AdminStore(dir).getSettings().legal, { imprint: '', privacy: 'Same in every language' });
    const file = path.join(dir, 'admin.json'), old = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete old.settings.legal;
    fs.writeFileSync(file, JSON.stringify(old));
    assert.deepEqual(new AdminStore(dir).getSettings().legal, { imprint: '', privacy: '' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
