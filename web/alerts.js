// Alerts: what the station watches for, what is active, and what has triggered before.

import { $, el, getJson, weekday, dayMonth, atClock } from './lib.js';
import { tr, loc } from './i18n.js';

const when = (t) => {
  const today = new Date(t).toDateString() === new Date().toDateString();
  return tr('time.dayAt', { day: today ? tr('time.todayLower') : `${weekday.format(t)}, ${dayMonth.format(t)}`, time: atClock(t) });
};

function duration(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return tr('time.min', { m: min });
  const h = Math.floor(min / 60), m = min % 60;
  return m ? tr('time.hourMin', { h, m }) : tr('time.hours', { h });
}

export async function enter() {
  try {
    const { rules, log } = await getJson('/api/alerts');
    const active = rules.filter((r) => r.active);
    $('alertSummary').textContent = active.length === 0 ? tr('alerts.none') : tr('alerts.active', { n: active.length });

    $('alertRules').replaceChildren(...rules.map((r) => el(`li.rule${r.active ? '.active' : ''}`, {},
      el('div', {},
        el('h2', {}, loc(r.active ? r.banner || r.label : r.label)),
        el('p.sub', {}, loc(r.active && loc(r.message) ? r.message : r.description)),
        r.active && r.since ? el('p.sub', {}, tr('alerts.activeSince', { when: when(r.since), rule: loc(r.description) })) : null),
      el('span.state', {}, tr(r.active ? 'alerts.stateActive' : 'alerts.stateQuiet')))));

    $('alertLog').replaceChildren(...(log.length ? log.map((e) => el('li', {},
      el('p.log-title', {}, loc(e.title), el('small', {}, e.end ? tr('alerts.lasted', { when: when(e.start), duration: duration(e.end - e.start) }) : tr('alerts.since', { when: when(e.start) }))),
      el('p.sub', {}, loc(e.text)))) : [el('li.empty', {}, tr('alerts.noneYet'))]));
  } catch (e) {
    $('alertSummary').textContent = tr('alerts.loadError', { error: e.message });
  }
}
