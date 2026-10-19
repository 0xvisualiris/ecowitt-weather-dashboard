// Routing between the views, the sliding mark under the active nav item, and the page colours
// while the "Now" view (which normally sets them) is not on screen.

import { $, store, skyAt, applyTheme, syncBarColour } from './lib.js';
import * as history from './history.js';
import * as forecast from './forecast.js';
import * as alerts from './alerts.js';
import * as radar from './radar.js';
import * as settings from './settings.js';
import * as admin from './admin.js';

const VIEWS = { '': 'now', history: 'history', forecast: 'forecast', radar: 'radar', alerts: 'alerts', settings: 'settings', admin: 'admin' };
// Addresses from before v2.0.0 (German ones, and the second design's) still lead to their view.
const OLD_ADDRESSES = {
  verlauf: 'history', details: 'history', vorhersage: 'forecast', regenradar: 'radar', warnungen: 'alerts', einstellungen: 'settings', verwaltung: 'admin',
};
const modules = { history, forecast, alerts, radar, settings, admin };

// Kiosk mode (?kiosk=1) for a wall display: only the Now view, no navigation.
// Tapping the station name switches full screen on and off.
const kiosk = new URLSearchParams(location.search).has('kiosk');
if (kiosk) {
  document.body.classList.add('kiosk');
  $('stationName').addEventListener('click', (e) => {
    e.preventDefault();
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => {});
  });
}
let current = null;

function route() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [first, second] = path.split('/');
  const view = kiosk ? 'now' : VIEWS[first] ?? OLD_ADDRESSES[first] ?? 'now';
  const params = new URLSearchParams(query);
  if (first === 'details' && second && !params.has('m')) params.set('m', second);   // #/details/<metric>
  if (view !== current) {
    modules[current]?.leave?.();
    current = view;
    document.body.dataset.view = view;
    for (const node of document.querySelectorAll('body > [data-view]')) node.hidden = node.dataset.view !== view;
    window.scrollTo(0, 0);
    placeMark(true);
    window.dispatchEvent(new Event('viewchange'));
    if (view !== 'now') themeFromNow(); else syncBarColour();
  }
  modules[view]?.enter?.(params);
}

// One mark slides between the nav items. It is measured again on every call, with the
// current view, so a resize can never put it back under an old item.
function placeMark(animate) {
  const mark = $('navMark'), link = document.querySelector(`#nav [data-nav="${current}"]`);
  if (!link) { mark.style.opacity = '0'; return; }
  mark.style.transition = animate ? '' : 'none';
  mark.style.opacity = '1';
  mark.style.width = `${link.offsetWidth}px`;
  mark.style.transform = `translateX(${link.offsetLeft}px)`;
  for (const a of document.querySelectorAll('#nav a')) a.toggleAttribute('aria-current', a === link);
}

function themeFromNow() {
  const cur = store.cur;
  applyTheme(skyAt(Date.now(), cur?.astro, cur?.forecast?.days?.[0]?.conditionCode));
}

// A freshly started station with nothing configured opens on its setup page
// instead of a demo dashboard, once.
let setupChecked = false;
window.addEventListener('station', () => {
  if (setupChecked) return;
  setupChecked = true;
  if (store.cfg?.needsSetup && !kiosk && current === 'now') location.hash = '#/admin';
});

window.addEventListener('hashchange', route);
window.addEventListener('resize', () => placeMark(false));
window.addEventListener('station', () => {
  const n = store.cur?.alerts?.length ?? 0;
  $('alertBadge').hidden = !n;
  $('alertBadge').textContent = n ? String(n) : '';
  if (current !== 'now') themeFromNow();
  placeMark(false);
});
document.fonts?.ready.then(() => placeMark(false));
route();
