// Routing between the views, the sliding mark under the active nav item, and the page colours
// while the "Now" view (which normally sets them) is not on screen.

import { $, store, skyAt, applyTheme, syncBarColour } from './lib.js';
import { LANG } from './i18n.js';
import * as history from './history.js';
import * as forecast from './forecast.js';
import * as alerts from './alerts.js';
import * as radar from './radar.js';
import * as settings from './settings.js';
import * as admin from './admin.js';
import * as legal from './legal.js';

const VIEWS = { '': 'now', history: 'history', forecast: 'forecast', radar: 'radar', alerts: 'alerts', settings: 'settings', admin: 'admin', imprint: 'legal', privacy: 'legal' };
// The legal pages answer to their German addresses too, the ones German visitors are used to.
const LEGAL = { imprint: 'imprint', impressum: 'imprint', privacy: 'privacy', datenschutz: 'privacy' };
// Addresses from before v2.0.0 (German ones, and the second design's) still lead to their view.
const OLD_ADDRESSES = {
  verlauf: 'history', details: 'history', vorhersage: 'forecast', regenradar: 'radar', warnungen: 'alerts', einstellungen: 'settings', verwaltung: 'admin',
  impressum: 'legal', datenschutz: 'legal',
};
const modules = { history, forecast, alerts, radar, settings, admin, legal };

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
  const view = kiosk ? 'now' : VIEWS[first] ?? OLD_ADDRESSES[first] ?? 'notfound';
  const params = new URLSearchParams(query);
  if (first === 'details' && second && !params.has('m')) params.set('m', second);   // #/details/<metric>
  if (view === 'legal') params.set('page', LEGAL[first]);
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

// The skip link moves keyboard focus past the header to the open view's content. A plain
// in-page anchor would change the hash, and the hash is the router's.
$('skipLink').addEventListener('click', (e) => {
  e.preventDefault();
  const view = document.querySelector('body > [data-view]:not([hidden])');
  const target = view?.matches('main') ? view : view?.querySelector('main');
  if (!target) return;
  target.tabIndex = -1;
  target.dataset.skipTarget = '';
  target.focus();
});

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
// app.js may have loaded the config before this module (which imports every view) ran.
window.addEventListener('config', () => showLegalLinks());
showLegalLinks();

// The footer links to the imprint and privacy policy, for the pages the station has.
function showLegalLinks() {
  for (const [page, de] of [['imprint', 'impressum'], ['privacy', 'datenschutz']]) {
    const link = $(`foot-${page}`);
    link.hidden = !store.cfg?.legal?.[page];
    link.href = `#/${LANG === 'de' ? de : page}`;
  }
}
document.fonts?.ready.then(() => placeMark(false));
route();
