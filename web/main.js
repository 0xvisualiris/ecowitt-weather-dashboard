// Routing between the views, the sliding mark under the active nav item, and the page colours
// while the "Now" view (which normally sets them) is not on screen.

import { $, store, skyAt, applyTheme, syncBarColour } from './lib.js';
import { LANG } from './i18n.js';

const VIEWS = { '': 'now', history: 'history', forecast: 'forecast', radar: 'radar', alerts: 'alerts', settings: 'settings', admin: 'admin', imprint: 'legal', privacy: 'legal' };
// The legal pages answer to their German addresses too, the ones German visitors are used to.
const LEGAL = { imprint: 'imprint', impressum: 'imprint', privacy: 'privacy', datenschutz: 'privacy' };
// Addresses from before v2.0.0 (German ones, and the second design's) still lead to their view.
const OLD_ADDRESSES = {
  verlauf: 'history', details: 'history', vorhersage: 'forecast', regenradar: 'radar', warnungen: 'alerts', einstellungen: 'settings', verwaltung: 'admin',
  impressum: 'legal', datenschutz: 'legal',
};
// Each view's module is loaded the first time it is opened, so the Now page doesn't wait for the
// radar, the map or the admin page. A module stays loaded once it is in.
const LOADERS = {
  history: () => import('./history.js'), forecast: () => import('./forecast.js'), alerts: () => import('./alerts.js'),
  radar: () => import('./radar.js'), settings: () => import('./settings.js'), admin: () => import('./admin.js'), legal: () => import('./legal.js'),
};
const modules = {};
const loadView = (view) => (modules[view] ??= LOADERS[view]?.());

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
    const left = current;
    modules[left]?.then((m) => m.leave?.());
    current = view;
    document.body.dataset.view = view;
    for (const node of document.querySelectorAll('body > [data-view]')) node.hidden = node.dataset.view !== view;
    window.scrollTo(0, 0);
    placeMark(true);
    window.dispatchEvent(new Event('viewchange'));
    if (view !== 'now') themeFromNow(); else syncBarColour();
  }
  loadView(view)?.then((m) => { if (current === view) m.enter?.(params); });
}
// Once the page is idle, fetch the other views in the background, so the first visit to each is instant.
(window.requestIdleCallback ?? ((f) => setTimeout(f, 2000)))(() => { if (!kiosk) for (const v of Object.keys(LOADERS)) if (v !== 'admin') loadView(v); });

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
  if (!link) { mark.style.opacity = '0'; navOverflow(); return; }
  mark.style.transition = animate ? '' : 'none';
  mark.style.opacity = '1';
  mark.style.width = `${link.offsetWidth}px`;
  mark.style.transform = `translateX(${link.offsetLeft}px)`;
  for (const a of document.querySelectorAll('#nav a')) a.toggleAttribute('aria-current', a === link);
  navOverflow();
}

// On a narrow phone the nav scrolls sideways. Its cut edge fades while there is more to the right,
// and the open view's item is scrolled into sight.
const nav = $('nav');
const navAtEnd = () => {
  nav.classList.toggle('at-start', nav.scrollLeft <= 1);
  nav.classList.toggle('at-end', nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 1);
};
function navOverflow() {
  const more = nav.scrollWidth - nav.clientWidth > 4;
  nav.classList.toggle('overflows', more);
  const link = document.querySelector('#nav a[aria-current]');
  if (more && link) {
    const l = link.offsetLeft, r = l + link.offsetWidth;
    if (l < nav.scrollLeft) nav.scrollLeft = l;
    else if (r > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = r - nav.clientWidth;
  }
  navAtEnd();
}
nav.addEventListener('scroll', navAtEnd, { passive: true });

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
// The service worker shows alert notifications and lets a home-screen app open offline (sw.js).
navigator.serviceWorker?.register('/sw.js').catch(() => {});
route();
