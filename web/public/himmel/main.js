// Routing between the views, the sliding mark under the active nav item, and the page colours
// while the "Jetzt" view (which normally sets them) is not on screen.

import { $, store, skyAt, applyTheme } from './lib.js';
import * as history from './history.js';
import * as forecast from './forecast.js';
import * as alerts from './alerts.js';
import * as radar from './radar.js';
import * as settings from './settings.js';
import * as admin from './admin.js';

const VIEWS = { '': 'now', verlauf: 'history', vorhersage: 'forecast', regenradar: 'radar', warnungen: 'alerts', einstellungen: 'settings', verwaltung: 'admin' };
const modules = { history, forecast, alerts, radar, settings, admin };

// Kiosk mode (?kiosk=1) for a wall display: only the Jetzt view, no navigation.
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
  const view = kiosk ? 'now' : VIEWS[path] ?? 'now';
  const params = new URLSearchParams(query);
  if (view !== current) {
    modules[current]?.leave?.();
    current = view;
    document.body.dataset.view = view;
    for (const node of document.querySelectorAll('body > [data-view]')) node.hidden = node.dataset.view !== view;
    window.scrollTo(0, 0);
    placeMark(true);
    window.dispatchEvent(new Event('viewchange'));
    if (view !== 'now') themeFromNow();
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
// instead of a demo dashboard, once, the same as the classic design does.
let setupChecked = false;
window.addEventListener('station', () => {
  if (setupChecked) return;
  setupChecked = true;
  if (store.cfg?.needsSetup && !kiosk && current === 'now') location.hash = '#/verwaltung';
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
