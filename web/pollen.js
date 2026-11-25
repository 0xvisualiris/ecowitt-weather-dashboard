// Pollen: DWD's Pollenflug-Gefahrenindex for the station's region (/api/pollen), as a block on the
// Forecast page and a line under the next days on the Now page. Only shown when a region is set.

import { $, el, getJson, store, dayMonth, atClock } from './lib.js';
import { tr } from './i18n.js';

let cache = null, loadedAt = 0;

async function load() {
  if (!store.cfg?.hasPollen) return null;
  if (cache && Date.now() - loadedAt < 30 * 60 * 1000) return cache;
  try { cache = await getJson('/api/pollen'); loadedAt = Date.now(); } catch { /* keep the last one, if any */ }
  return cache;
}

// 0 … 3 in half steps → its word ("none", "none to low", …, "high").
const word = (v) => tr(`pollen.l${Math.round(v * 2)}`);

// Three segments, filled to the level, so the eye can compare rows without reading.
function meter(v) {
  if (v == null) return el('span.pollen-none', {}, '–');
  const segs = [0, 1, 2].map((i) => el('i', { style: `--fill:${Math.max(0, Math.min(1, v - i)) * 100}%` }));
  return el('span.pollen-level', { title: word(v) }, el('span.pollen-meter', { 'aria-hidden': 'true' }, ...segs), el('span', {}, word(v)));
}

const peak = (t) => Math.max(t.today ?? 0, t.tomorrow ?? 0, t.dayAfter ?? 0);

export async function renderPollenBlock() {
  const box = $('pollenBlock');
  const p = await load();
  box.hidden = !p;
  if (!p) return;
  const active = p.types.filter((t) => peak(t) > 0).sort((a, b) => peak(b) - peak(a));
  $('pollenNote').textContent = tr('pollen.source', { region: p.region, day: dayMonth.format(p.updated ?? Date.now()), time: atClock(p.updated ?? Date.now()) });
  if (!active.length) {
    $('pollenTable').replaceChildren(el('p.sub', {}, tr('pollen.none')));
    return;
  }
  $('pollenTable').replaceChildren(el('table.pollen', {},
    el('thead', {}, el('tr', {}, el('th', {}, tr('pollen.type')), el('th', {}, tr('time.today')), el('th', {}, tr('time.tomorrow')), el('th', {}, tr('pollen.dayAfter')))),
    el('tbody', {}, ...active.map((t) => el('tr', {},
      el('th', { scope: 'row' }, tr(`pollen.t.${t.type}`)),
      el('td', {}, meter(t.today)), el('td', {}, meter(t.tomorrow)), el('td', {}, meter(t.dayAfter)))))));
}

// "Pollen today: hazel moderate, alder low" under the next days, only on days with any.
export async function renderPollenToday() {
  const line = $('pollenToday');
  const p = await load();
  const today = (p?.types ?? []).filter((t) => (t.today ?? 0) > 0).sort((a, b) => b.today - a.today);
  line.hidden = !today.length;
  if (!today.length) return;
  line.replaceChildren(
    el('a', { href: '#/forecast' }, tr('pollen.todayLabel')), ' ',
    today.map((t) => `${tr(`pollen.t.${t.type}`)} ${word(t.today)}`).join(' · '));
}
