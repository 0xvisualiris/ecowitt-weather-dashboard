// Settings: each visitor chooses their own language and units. Nothing leaves the browser.

import { $, el, UNIT_OPTIONS, units, setUnit } from './lib.js';
import { LANG, LANGUAGES, setLang, tr } from './i18n.js';
import { DESIGN, DESIGNS, setDesign } from './glass.js';

function render() {
  const language = el('div.setting', {},
    el('span.setting-label', { id: 'setting-lang' }, tr('settings.language')),
    el('div.tabs', { role: 'group', 'aria-labelledby': 'setting-lang' }, ...Object.entries(LANGUAGES).map(([code, name]) =>
      el('button.tab', { type: 'button', lang: code, 'aria-pressed': String(LANG === code), onclick: () => { if (code !== LANG) setLang(code); } }, name))));
  const design = el('div.setting', {},
    el('span.setting-label', { id: 'setting-design' }, tr('settings.design')),
    el('div.tabs', { role: 'group', 'aria-labelledby': 'setting-design' }, ...DESIGNS.map((d) =>
      el('button.tab', { type: 'button', 'aria-pressed': String(DESIGN === d), onclick: () => { if (d !== DESIGN) setDesign(d); } }, tr(`design.${d}`)))));
  $('unitRows').replaceChildren(language, design, ...Object.entries(UNIT_OPTIONS).map(([kind, { label, options }]) =>
    el('div.setting', {},
      el('span.setting-label', { id: `unit-${kind}` }, label),
      el('div.tabs', { role: 'group', 'aria-labelledby': `unit-${kind}` }, ...options.map((o) =>
        el('button.tab', { type: 'button', 'aria-pressed': String(units[kind] === o), onclick: () => { setUnit(kind, o); render(); } }, o))))));
}

export function enter() { render(); }
