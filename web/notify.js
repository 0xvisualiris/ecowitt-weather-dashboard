// The "Notifications" block on the Alerts page: turns alert notifications on and off for this
// device and picks which rules notify. The browser's push subscription goes to the server
// (/api/push/subscribe), which sends a notification when a chosen rule becomes active.

import { $, el, postJson, store, stationReady } from './lib.js';
import { tr, loc, LANG } from './i18n.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
// iPhone and iPad only offer push to a site added to the home screen and opened from there.
const iosBrowser = () => /iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone;

const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

let busy = false;

export async function renderNotify() {
  if (!store.cfg) await stationReady();
  const box = $('pushBlock'), push = store.cfg?.push;
  if (!push?.enabled) { box.hidden = true; return; }
  box.hidden = false;
  const text = $('pushText'), rulesBox = $('pushRules'), button = $('pushToggle'), note = $('pushNote');
  note.textContent = '';

  if (!supported()) {
    text.textContent = tr(iosBrowser() ? 'push.ios' : 'push.unsupported');
    rulesBox.replaceChildren(); button.hidden = true;
    return;
  }
  if (Notification.permission === 'denied') {
    text.textContent = tr('push.blocked');
    rulesBox.replaceChildren(); button.hidden = true;
    return;
  }

  const sub = await currentSubscription().catch(() => null);
  const saved = JSON.parse(localStorage.getItem('wetterstation.pushRules') || 'null');
  const rules = store.cfg.alertRules ?? [];
  const chosen = new Set(saved ?? rules.map((r) => r.id));

  text.textContent = tr(sub ? 'push.on' : 'push.off');
  rulesBox.replaceChildren(
    el('span.field-label', {}, tr('push.which')),
    ...rules.map((r) => el('label.check', {},
      el('input', {
        type: 'checkbox', checked: chosen.has(r.id),
        onchange: async (e) => {
          if (e.target.checked) chosen.add(r.id); else chosen.delete(r.id);
          localStorage.setItem('wetterstation.pushRules', JSON.stringify([...chosen]));
          // Already on: tell the server straight away, without another welcome message.
          if (sub) await save(sub, chosen, false).catch((err) => { note.textContent = tr('push.failed', { error: err.message }); });
        },
      }),
      loc(r.label))));
  button.hidden = false;
  button.textContent = tr(sub ? 'push.turnOff' : 'push.turnOn');
  button.classList.toggle('primary', !sub);
  button.onclick = () => (sub ? turnOff(sub) : turnOn(chosen));
}

const save = (sub, chosen, welcome) => postJson('/api/push/subscribe', { ...sub.toJSON(), lang: LANG, rules: [...chosen], welcome });

async function turnOn(chosen) {
  if (busy) return;
  busy = true;
  const note = $('pushNote');
  try {
    // The permission prompt must come straight from the tap.
    if (await Notification.requestPermission() !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(store.cfg.push.publicKey) });
    // If the server refuses it, drop it here too, or the page would claim notifications are on.
    await save(sub, chosen, true).catch(async (e) => { await sub.unsubscribe().catch(() => {}); throw e; });
  } catch (e) {
    note.textContent = tr('push.failed', { error: e.message });
  } finally {
    busy = false;
    await renderNotify();
  }
}

async function turnOff(sub) {
  if (busy) return;
  busy = true;
  try {
    await postJson('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  } finally {
    busy = false;
    await renderNotify();
  }
}
