import test from 'node:test';
import assert from 'node:assert/strict';
import { level, parseStamp, parsePollen, PollenSource } from './pollen.js';

// The shape of DWD's s31fg.json, cut down to two regions (one split into parts, one not).
const SAMPLE = {
  last_update: '2026-11-25 11:00 Uhr', next_update: '2026-11-26 11:00 Uhr',
  legend: { id1: '0', id1_desc: 'keine Belastung' },
  content: [
    { region_id: 90, region_name: 'Hessen', partregion_id: 92, partregion_name: 'Rhein-Main',
      Pollen: { Hasel: { today: '1-2', tomorrow: '1', dayafter_to: '0-1' }, Erle: { today: '0', tomorrow: '0', dayafter_to: '-1' } } },
    { region_id: 50, region_name: 'Brandenburg und Berlin', partregion_id: -1, partregion_name: '',
      Pollen: { Birke: { today: '3', tomorrow: '2-3', dayafter_to: '2' } } },
  ],
};

test('level reads every value of the index', () => {
  assert.deepEqual(['0', '0-1', '1', '1-2', '2', '2-3', '3'].map(level), [0, 0.5, 1, 1.5, 2, 2.5, 3]);
  for (const bad of ['-1', '', null, '4', 'x']) assert.equal(level(bad), null, String(bad));
});

test('parseStamp reads the German local time stamps', () => {
  assert.equal(parseStamp('2026-11-25 11:00 Uhr'), new Date(2026, 10, 25, 11, 0).getTime());
  assert.equal(parseStamp('soon'), null);
});

test('parsePollen keys regions by part id, or region id where there is no part', () => {
  const p = parsePollen(SAMPLE);
  assert.deepEqual(p.regions, [{ id: 92, name: 'Hessen: Rhein-Main' }, { id: 50, name: 'Brandenburg und Berlin' }]);
  assert.deepEqual(p.byId[92].types, [
    { type: 'hazel', today: 1.5, tomorrow: 1, dayAfter: 0.5 },
    { type: 'alder', today: 0, tomorrow: 0, dayAfter: null },
  ]);
  assert.equal(p.byId[50].types[0].type, 'birch');
  assert.equal(p.next, new Date(2026, 10, 26, 11, 0).getTime());
  assert.throws(() => parsePollen({}), /unexpected/);
});

test('PollenSource serves its region and keeps the last good file on failure', async () => {
  let fail = false;
  const fetchImpl = async () => (fail ? { ok: false, status: 503 } : { ok: true, json: async () => SAMPLE });
  const src = new PollenSource(92, { fetchImpl });
  assert.equal(src.forecast(), null);
  await src.refresh();
  assert.equal(src.forecast().region, 'Hessen: Rhein-Main');
  fail = true;
  const warn = console.warn; console.warn = () => {};
  await src.refresh();
  console.warn = warn;
  assert.equal(src.forecast().types[0].today, 1.5);
  assert.equal(new PollenSource(1, { fetchImpl }).forecast(), null);
  fail = false;
  assert.equal((await new PollenSource(null, { fetchImpl }).regions()).length, 2);
});
