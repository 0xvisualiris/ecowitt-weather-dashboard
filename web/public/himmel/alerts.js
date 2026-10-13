// Warnungen: what the station watches for, what is active, and what has triggered before.

import { $, el, getJson, clock, weekday, dayMonth } from './lib.js';

const when = (t) => {
  const today = new Date(t).toDateString() === new Date().toDateString();
  return `${today ? 'heute' : `${weekday.format(t)}, ${dayMonth.format(t)}`}, ${clock.format(t)} Uhr`;
};

function duration(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} Std. ${m} Min.` : `${h} Std.`;
}

export async function enter() {
  try {
    const { rules, log } = await getJson('/api/alerts');
    const active = rules.filter((r) => r.active);
    $('alertSummary').textContent = active.length === 0 ? 'Im Moment ist nichts auffällig.'
      : active.length === 1 ? 'Eine Warnung ist gerade aktiv.' : `${active.length} Warnungen sind gerade aktiv.`;

    $('alertRules').replaceChildren(...rules.map((r) => el(`li.rule${r.active ? '.active' : ''}`, {},
      el('div', {},
        el('h2', {}, r.active ? r.banner || r.label : r.label),
        el('p.sub', {}, r.active && r.message ? r.message : r.description),
        r.active && r.since ? el('p.sub', {}, `Aktiv seit ${when(r.since)}. Regel: ${r.description}`) : null),
      el('span.state', {}, r.active ? 'Aktiv' : 'Ruhig'))));

    $('alertLog').replaceChildren(...(log.length ? log.map((e) => el('li', {},
      el('p.log-title', {}, e.title, el('small', {}, e.end ? `${when(e.start)}, Dauer ${duration(e.end - e.start)}` : `seit ${when(e.start)}`)),
      el('p.sub', {}, e.text))) : [el('li.empty', {}, 'Bisher hat keine Warnung ausgelöst.')]));
  } catch (e) {
    $('alertSummary').textContent = `Die Warnungen konnten nicht geladen werden (${e.message}).`;
  }
}
