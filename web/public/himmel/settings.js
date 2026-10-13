// Einstellungen: each visitor chooses their own units. Nothing leaves the browser.

import { $, el, UNIT_OPTIONS, units, setUnit } from './lib.js';

function render() {
  $('unitRows').replaceChildren(...Object.entries(UNIT_OPTIONS).map(([kind, { label, options }]) =>
    el('div.setting', {},
      el('span.setting-label', { id: `unit-${kind}` }, label),
      el('div.tabs', { role: 'group', 'aria-labelledby': `unit-${kind}` }, ...options.map((o) =>
        el('button.tab', { type: 'button', 'aria-pressed': String(units[kind] === o), onclick: () => { setUnit(kind, o); render(); } }, o))))));
}

export function enter() { render(); }
