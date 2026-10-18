// Verwaltung: sign in, then set up the station (data source, forecast, sensors, station details,
// devices, alert rules, password and two-factor sign-in). Talks to the dashboard's own admin API.

import { $, el, getJson, postJson, METRICS } from './lib.js';
import { disclosure, stationPicker, locationPicker } from './pickers.js';

const SENSORS = {
  temperature: 'Temperatur', feels_like: 'Gefühlte Temperatur', dew_point: 'Taupunkt', humidity: 'Luftfeuchte',
  wind_speed: 'Windgeschwindigkeit', wind_gust: 'Böe', wind_direction: 'Windrichtung',
  rain_rate: 'Regenrate', rain_event: 'Regen, dieses Ereignis', rain_daily: 'Regen heute',
  pressure: 'Luftdruck', solar_radiation: 'Sonnenstrahlung', uv_index: 'UV-Index',
  lightning_distance: 'Blitz, Entfernung', lightning_time: 'Blitz, Zeitpunkt', lightning_count: 'Blitze heute',
};
const OPS = { above: 'über', below: 'unter', at_least: 'mindestens', at_most: 'höchstens', equals: 'genau' };
const LIMITS = { stationName: 60, stationSubtitle: 80, alertLabel: 60, alertDescription: 120, alertBanner: 120, alertMessage: 200, deviceName: 60, deviceShort: 12, deviceRole: 40 };
const LOCKED = 'In der config.yaml festgelegt, hier nicht änderbar.';

let root, settings, draft, dirty;

// ---------- Small form helpers ----------

const field = (label, control, note) => el('label.field', {}, el('span.field-label', {}, label), control, note ? el('span.field-note', {}, note) : null);

function input(obj, key, opts = {}) {
  return el('input', {
    type: opts.type ?? 'text', value: obj[key] ?? '', placeholder: opts.placeholder, disabled: opts.disabled, maxLength: opts.max,
    inputMode: opts.inputMode, autocomplete: opts.autocomplete ?? 'off', spellcheck: false, step: opts.step,
    oninput: (e) => { obj[key] = e.target.value; opts.changed?.(); },
  });
}

function select(obj, key, options, changed) {
  return el('select', { onchange: (e) => { obj[key] = e.target.value; changed?.(); } },
    ...Object.entries(options).map(([value, label]) => el('option', { value, selected: obj[key] === value }, label)));
}

const section = (title, intro, ...children) => el('section.form-section', {}, el('h2', {}, title), intro ? el('p.sub', {}, intro) : null, ...children);
const message = (node, text, bad = false) => { node.textContent = text; node.classList.toggle('bad', bad); };
const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// The server answers in English; say the common ones in German.
const ERRORS = {
  'invalid credentials': 'Benutzername oder Passwort stimmen nicht.',
  'invalid 2FA code': 'Der Code stimmt nicht.',
  'too many attempts – try again shortly': 'Zu viele Versuche. Bitte kurz warten.',
  'not logged in': 'Die Anmeldung ist abgelaufen. Bitte neu anmelden.',
};
const say = (e) => ERRORS[e.message] ?? e.message;

// ---------- Sign in ----------

function renderLogin(needsTotp = false, carry = { username: 'admin', password: '' }) {
  const form = { ...carry, code: '' };
  const note = el('p.form-msg', { role: 'status' });
  const submit = async (e) => {
    e.preventDefault();
    message(note, '');
    try {
      const r = await postJson('/api/admin/login', { username: form.username, password: form.password, code: form.code || undefined });
      if (r.needsTotp) return renderLogin(true, form);
      await refresh();
    } catch (err) {
      if (err.body?.needsTotp && !needsTotp) return renderLogin(true, form);
      message(note, say(err), true);
    }
  };
  root.replaceChildren(el('form.auth', { onsubmit: submit },
    el('h1', {}, 'Station verwalten'),
    el('p.sub', {}, needsTotp ? 'Gib den sechsstelligen Code aus deiner Authenticator-App ein.' : 'Melde dich an, um die Station einzurichten.'),
    needsTotp ? null : field('Benutzername', input(form, 'username', { autocomplete: 'username' })),
    needsTotp ? null : field('Passwort', input(form, 'password', { type: 'password', autocomplete: 'current-password' }), 'Bei einer neuen Installation: admin / admin. Das Passwort muss danach geändert werden.'),
    needsTotp ? field('Code', input(form, 'code', { inputMode: 'numeric', autocomplete: 'one-time-code', max: 6 })) : null,
    el('p.actions', {}, el('button.btn.primary', { type: 'submit' }, 'Anmelden')),
    note));
  root.querySelector('input')?.focus();
}

function renderPassword(forced) {
  const form = { currentPassword: '', newPassword: '', repeat: '' };
  const note = el('p.form-msg', { role: 'status' });
  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword.length < 8) return message(note, 'Das neue Passwort braucht mindestens 8 Zeichen.', true);
    if (form.newPassword !== form.repeat) return message(note, 'Die beiden neuen Passwörter stimmen nicht überein.', true);
    try {
      await postJson('/api/admin/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      await refresh();
    } catch (err) { message(note, say(err), true); }
  };
  root.replaceChildren(el('form.auth', { onsubmit: submit },
    el('h1', {}, 'Passwort ändern'),
    el('p.sub', {}, forced ? 'Das Standardpasswort muss ersetzt werden, bevor du etwas einstellen kannst.' : 'Danach bleiben nur Geräte angemeldet, die das neue Passwort kennen.'),
    field('Aktuelles Passwort', input(form, 'currentPassword', { type: 'password', autocomplete: 'current-password' })),
    field('Neues Passwort', input(form, 'newPassword', { type: 'password', autocomplete: 'new-password' }), 'Mindestens 8 Zeichen.'),
    field('Neues Passwort wiederholen', input(form, 'repeat', { type: 'password', autocomplete: 'new-password' })),
    el('p.actions', {},
      el('button.btn.primary', { type: 'submit' }, 'Passwort ändern'),
      forced ? null : el('button.btn', { type: 'button', onclick: refresh }, 'Abbrechen')),
    note));
  root.querySelector('input')?.focus();
}

// ---------- Settings ----------

function makeDraft() {
  const s = settings, loc = s.station.publicLocation;
  dirty = { devices: false, alerts: false, restoreAlerts: false };
  draft = {
    source: s.source ?? 'homeassistant',
    ecowitt: { host: s.ecowitt?.host ?? '' },
    ha: { url: s.homeassistant.url ?? '', token: '' },
    forecast: { dwdStationId: s.forecast.dwdStationId ?? '', biasHours: String(s.forecast.biasHours ?? 6), entity: s.forecast.entity ?? '', label: s.forecast.label ?? '' },
    sensors: Object.fromEntries(Object.keys(SENSORS).map((k) => [k, s.sensors?.[k] ?? ''])),
    station: { name: s.station.name ?? '', subtitle: s.station.subtitle ?? '', altitude: s.station.altitude_m == null ? '' : String(s.station.altitude_m), since: s.station.since ?? '', lat: loc ? String(loc.lat) : '', lon: loc ? String(loc.lon) : '' },
    devices: structuredClone(s.station.devices ?? []),
    alerts: structuredClone(s.alerts ?? []),
    design: s.design ?? 'himmel',
  };
}

function buildPatch() {
  const s = settings, d = draft, patch = {};
  const put = (group, key, value) => { (patch[group] ??= {})[key] = value; };
  const number = (text) => { const n = Number(String(text).replace(',', '.')); return text === '' || !Number.isFinite(n) ? null : n; };

  if (d.source !== s.source) patch.source = d.source;
  if (d.ecowitt.host.trim() !== (s.ecowitt?.host ?? '')) put('ecowitt', 'host', d.ecowitt.host);
  if (d.ha.url.trim() !== (s.homeassistant.url ?? '')) put('homeassistant', 'url', d.ha.url);
  if (d.ha.token.trim()) put('homeassistant', 'token', d.ha.token);

  if (d.forecast.dwdStationId.trim() !== (s.forecast.dwdStationId ?? '')) put('forecast', 'dwdStationId', d.forecast.dwdStationId);
  if (d.forecast.entity.trim() !== (s.forecast.entity ?? '')) put('forecast', 'entity', d.forecast.entity);
  if (d.forecast.label.trim() !== (s.forecast.label ?? '')) put('forecast', 'label', d.forecast.label);
  if (number(d.forecast.biasHours) != null && number(d.forecast.biasHours) !== s.forecast.biasHours) put('forecast', 'biasHours', number(d.forecast.biasHours));

  for (const k of Object.keys(SENSORS)) if (d.sensors[k].trim() !== (s.sensors?.[k] ?? '')) put('sensors', k, d.sensors[k]);

  if (d.station.name.trim() !== (s.station.name ?? '')) put('station', 'name', d.station.name);
  if (d.station.subtitle.trim() !== (s.station.subtitle ?? '')) put('station', 'subtitle', d.station.subtitle);
  if (d.station.since.trim() !== (s.station.since ?? '')) put('station', 'since', d.station.since);
  if (number(d.station.altitude) !== (s.station.altitude_m ?? null)) put('station', 'altitude_m', number(d.station.altitude));
  const lat = number(d.station.lat), lon = number(d.station.lon), old = s.station.publicLocation;
  if (lat !== (old?.lat ?? null) || lon !== (old?.lon ?? null)) put('station', 'publicLocation', lat != null && lon != null ? { lat, lon } : null);
  if (dirty.devices) put('station', 'devices', d.devices.map((dev, i) => ({ ...dev, id: dev.id || slug(dev.name) || `geraet-${i + 1}` })));

  if (d.design !== (s.design ?? 'himmel')) patch.design = d.design;

  if (dirty.restoreAlerts) patch.alerts = null;
  else if (dirty.alerts) patch.alerts = d.alerts.map((a, i) => ({ ...a, id: a.id || slug(a.label ?? '') || `regel-${i + 1}` }));
  return patch;
}

function devicesEditor() {
  const box = el('div.list');
  const locked = settings.locked.stationDevices;
  const touch = () => { dirty.devices = true; };
  const render = () => box.replaceChildren(
    ...draft.devices.map((dev, i) => el('fieldset.card', { disabled: locked },
      el('legend', {}, dev.name || `Gerät ${i + 1}`),
      el('div.grid', {},
        field('Name', input(dev, 'name', { max: LIMITS.deviceName, changed: touch })),
        field('Kurzname', input(dev, 'short', { max: LIMITS.deviceShort, changed: touch })),
        field('Aufgabe', input(dev, 'role', { max: LIMITS.deviceRole, placeholder: 'z. B. Außensensor', changed: touch })),
        field('Batterie (Entität)', input(dev, 'battery', { placeholder: 'sensor.…', changed: touch })),
        field('Signal (Entität)', input(dev, 'signal', { placeholder: 'sensor.…', changed: touch }))),
      el('div.checks', {}, el('span.field-label', {}, 'Misst'),
        ...Object.entries(METRICS).map(([k, m]) => el('label.check', {},
          el('input', { type: 'checkbox', checked: (dev.metrics ?? []).includes(k), onchange: (e) => { dev.metrics = e.target.checked ? [...(dev.metrics ?? []), k] : (dev.metrics ?? []).filter((x) => x !== k); touch(); } }), m.label))),
      el('button.btn.quiet', { type: 'button', onclick: () => { draft.devices.splice(i, 1); touch(); render(); } }, 'Gerät entfernen'))),
    locked ? el('p.field-note', {}, LOCKED)
      : el('button.btn', { type: 'button', onclick: () => { draft.devices.push({ id: '', name: '', short: '', role: '', battery: '', signal: '', metrics: [] }); touch(); render(); } }, 'Gerät hinzufügen'));
  render();
  return box;
}

function alertsEditor() {
  const box = el('div.list');
  const locked = settings.locked.alerts;
  const touch = () => { dirty.alerts = true; dirty.restoreAlerts = false; };
  const editable = (c) => c.sensor && !c.recent && Object.keys(OPS).some((op) => c[op] != null);

  const conditionRow = (rule, key, c, i, render) => {
    if (!editable(c)) return el('p.field-note', {}, 'Eine eigene Bedingung aus der Konfiguration. Sie bleibt beim Speichern unverändert erhalten.');
    const model = { sensor: c.sensor, op: Object.keys(OPS).find((op) => c[op] != null), value: String(c[Object.keys(OPS).find((op) => c[op] != null)]) };
    const write = () => {
      for (const op of Object.keys(OPS)) delete c[op];
      c.sensor = model.sensor;
      c[model.op] = Number(String(model.value).replace(',', '.')) || 0;
      touch();
    };
    return el('div.cond', {},
      select(model, 'sensor', SENSORS, write), select(model, 'op', OPS, write),
      input(model, 'value', { inputMode: 'decimal', changed: write }),
      el('button.btn.quiet', { type: 'button', 'aria-label': 'Bedingung entfernen', onclick: () => { rule[key].splice(i, 1); touch(); render(); } }, 'Entfernen'));
  };

  const render = () => box.replaceChildren(
    ...draft.alerts.map((rule, i) => {
      const key = Array.isArray(rule.any) ? 'any' : 'all';
      rule[key] ??= [];
      const mode = { value: key };
      return el('fieldset.card', { disabled: locked },
        el('legend', {}, rule.label || `Regel ${i + 1}`),
        el('div.grid', {},
          field('Name', input(rule, 'label', { max: LIMITS.alertLabel, changed: touch })),
          field('Stufe', select(rule, 'level', { warning: 'Warnung', info: 'Hinweis' }, touch)),
          field('Beschreibung der Regel', input(rule, 'description', { max: LIMITS.alertDescription, changed: touch })),
          field('Überschrift, wenn aktiv', input(rule, 'banner', { max: LIMITS.alertBanner, changed: touch })),
          field('Text, wenn aktiv', input(rule, 'message', { max: LIMITS.alertMessage, changed: touch }), 'Platzhalter in geschweiften Klammern werden vom Server ersetzt.')),
        el('div.conds', {},
          field('Auslösen, wenn', select(mode, 'value', { all: 'alle Bedingungen zutreffen', any: 'eine der Bedingungen zutrifft' }, () => {
            const list = rule[key]; delete rule[key]; rule[mode.value] = list; touch(); render();
          })),
          ...rule[key].map((c, n) => conditionRow(rule, key, c, n, render)),
          el('button.btn.quiet', { type: 'button', onclick: () => { rule[key].push({ sensor: 'temperature', below: 0 }); touch(); render(); } }, 'Bedingung hinzufügen')),
        el('button.btn.quiet', { type: 'button', onclick: () => { draft.alerts.splice(i, 1); touch(); render(); } }, 'Regel entfernen'));
    }),
    locked ? el('p.field-note', {}, LOCKED) : el('p.actions', {},
      el('button.btn', { type: 'button', onclick: () => { draft.alerts.push({ id: '', label: '', description: '', level: 'warning', banner: '', message: '', all: [{ sensor: 'temperature', below: 0 }] }); touch(); render(); } }, 'Regel hinzufügen'),
      el('button.btn.quiet', { type: 'button', onclick: () => { draft.alerts = structuredClone(settings.defaultAlerts ?? []); dirty.alerts = false; dirty.restoreAlerts = true; render(); } }, 'Standardregeln wiederherstellen')));
  render();
  return box;
}

function twoFactor() {
  const box = el('div');
  const note = el('p.form-msg', { role: 'status' });
  const render = (setup) => {
    const form = { code: '', password: '' };
    if (settings.totpEnabled) {
      box.replaceChildren(
        el('p.sub', {}, 'Eingeschaltet. Bei jeder Anmeldung wird zusätzlich ein Code aus deiner Authenticator-App verlangt.'),
        el('div.grid', {}, field('Passwort zur Bestätigung', input(form, 'password', { type: 'password', autocomplete: 'current-password' }))),
        el('p.actions', {}, el('button.btn', { type: 'button', onclick: async () => {
          try { await postJson('/api/admin/totp/disable', { password: form.password }); settings.totpEnabled = false; message(note, 'Zwei-Faktor-Anmeldung ausgeschaltet.'); render(); } catch (e) { message(note, say(e), true); }
        } }, 'Ausschalten')), note);
    } else if (setup) {
      box.replaceChildren(
        el('p.sub', {}, 'Trage diesen Schlüssel in deine Authenticator-App ein, oder öffne den Link auf dem Gerät, auf dem sie installiert ist. Bestätige dann mit dem angezeigten Code.'),
        el('p.secret', {}, setup.secret),
        el('p.sub', {}, el('a', { href: setup.otpauthUrl }, 'In der Authenticator-App öffnen')),
        el('div.grid', {}, field('Code aus der App', input(form, 'code', { inputMode: 'numeric', max: 6, autocomplete: 'one-time-code' }))),
        el('p.actions', {}, el('button.btn', { type: 'button', onclick: async () => {
          try { await postJson('/api/admin/totp/enable', { code: form.code }); settings.totpEnabled = true; message(note, 'Zwei-Faktor-Anmeldung eingeschaltet.'); render(); } catch (e) { message(note, say(e), true); }
        } }, 'Einschalten')), note);
    } else {
      box.replaceChildren(
        el('p.sub', {}, 'Ausgeschaltet. Mit einer Authenticator-App lässt sich die Anmeldung zusätzlich absichern.'),
        el('p.actions', {}, el('button.btn', { type: 'button', onclick: async () => {
          try { render(await postJson('/api/admin/totp/setup', {})); } catch (e) { message(note, say(e), true); }
        } }, 'Einrichten')), note);
    }
  };
  render();
  return box;
}

function renderSettings() {
  makeDraft();
  const L = settings.locked;
  const saveNote = el('p.form-msg', { role: 'status' });
  const lockNote = (flag, extra) => (flag ? LOCKED : extra);

  // Only the fields of the chosen data source are shown.
  const haFields = el('div.grid', {},
    field('Adresse', input(draft.ha, 'url', { placeholder: 'http://homeassistant.local:8123', disabled: L.haUrl }), lockNote(L.haUrl)),
    field('Zugriffstoken', input(draft.ha, 'token', { type: 'password', placeholder: settings.homeassistant.tokenSet ? 'Gesetzt. Leer lassen, um ihn zu behalten.' : 'Long-Lived Access Token einfügen', disabled: L.haToken, autocomplete: 'new-password' }), lockNote(L.haToken)));
  const ecowittFields = el('div.grid', {},
    field('Gateway-Adresse', input(draft.ecowitt, 'host', { placeholder: '192.168.1.50', disabled: L.ecowittHost }),
      L.ecowittHost ? (L.ecowittHostEnv ? 'Durch die Umgebungsvariable ECOWITT_HOST festgelegt.' : LOCKED) : 'IP-Adresse oder Hostname des Gateways (GW1100, GW2000, GW3000, …) im lokalen Netz.'));
  const sensorsSection = section('Sensoren', 'Zu jedem Messwert die Entität aus Home Assistant. Leere Felder werden auf der Station ausgeblendet.',
    el('div.grid', {}, ...Object.entries(SENSORS).map(([k, label]) =>
      field(label, input(draft.sensors, k, { placeholder: 'sensor.…', disabled: L.sensors?.[k] }), lockNote(L.sensors?.[k])))));
  const showSource = () => {
    const ecowitt = draft.source === 'ecowitt';
    haFields.hidden = ecowitt;
    ecowittFields.hidden = !ecowitt;
    sensorsSection.hidden = ecowitt;
  };
  const sourceSelect = Object.assign(select(draft, 'source', { homeassistant: 'Home Assistant', ecowitt: 'Ecowitt-Gateway direkt' }, showSource), { disabled: !!L.source });
  showSource();

  // These three fields can also be filled from a map, so the inputs are kept to write the choice back into them.
  const stationInput = input(draft.forecast, 'dwdStationId', { placeholder: 'z. B. 10384 oder L771', disabled: L.dwdStationId });
  const latInput = input(draft.station, 'lat', { inputMode: 'decimal', placeholder: 'z. B. 50,1', disabled: L.stationPublicLocation });
  const lonInput = input(draft.station, 'lon', { inputMode: 'decimal', placeholder: 'z. B. 8,7', disabled: L.stationPublicLocation });
  const parse = (text) => { const n = Number(String(text).replace(',', '.')); return text === '' || !Number.isFinite(n) ? null : n; };
  const stationMap = L.dwdStationId ? null : disclosure('Station auf der Karte wählen', (body) => stationPicker(body,
    () => draft.forecast.dwdStationId,
    (id) => { draft.forecast.dwdStationId = id; stationInput.value = id; }));
  const locationMap = L.stationPublicLocation ? null : disclosure('Standort auf der Karte wählen', (body) => locationPicker(body,
    () => { const lat = parse(draft.station.lat), lon = parse(draft.station.lon); return lat != null && lon != null ? { lat, lon } : null; },
    (p) => { draft.station.lat = latInput.value = p ? String(p.lat).replace('.', ',') : ''; draft.station.lon = lonInput.value = p ? String(p.lon).replace('.', ',') : ''; }));

  const save = async () => {
    const patch = buildPatch();
    if (!Object.keys(patch).length) return message(saveNote, 'Es wurde nichts geändert.');
    try {
      await postJson('/api/admin/settings', patch);
      message(saveNote, 'Gespeichert. Die Station startet neu, damit die Änderungen gelten.');
      // The server stops and comes back; wait for it, then load everything fresh.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try { await getJson('/api/config'); if (i > 1) break; } catch { /* still restarting */ }
      }
      // The other design has its own addresses, so a change of design starts again from the front page.
      if (patch.design) location.hash = '#/';
      location.reload();
    } catch (e) { message(saveNote, say(e), true); }
  };

  root.replaceChildren(
    el('div.page-head', {},
      el('h1', {}, 'Station verwalten'),
      el('p.actions', {},
        el('button.btn', { type: 'button', onclick: () => renderPassword(false) }, 'Passwort ändern'),
        el('button.btn', { type: 'button', onclick: async () => { await postJson('/api/admin/logout', {}).catch(() => {}); location.hash = '#/'; } }, 'Abmelden'))),
    settings.demo ? el('p.banner', {}, 'Die Station zeigt gerade Demo-Daten. Trage unten Home Assistant oder ein Ecowitt-Gateway ein, um echte Messwerte zu sehen.') : null,

    section('Erscheinungsbild', 'Die Station hat zwei Oberflächen mit denselben Daten: „Klassisch“ mit Karten, auf Deutsch und Englisch, und „Himmel“, das den Tag als Landschaft zeigt, nur auf Deutsch. Besucher sehen die hier gewählte.',
      el('div.grid', {},
        field('Oberfläche', Object.assign(select(draft, 'design', { classic: 'Klassisch', himmel: 'Himmel' }), { disabled: !!L.design }),
          L.design ? LOCKED : 'Nach dem Speichern startet die Station neu und zeigt die gewählte Oberfläche.'))),

    section('Datenquelle', 'Von hier holt die Station ihre Messwerte. Direkt vom Ecowitt-Gateway braucht es kein Home Assistant: die Station erkennt die Sensoren selbst und speichert den Verlauf. Adressen und Token bleiben auf dem Server.',
      el('div.grid', {}, field('Messwerte von', sourceSelect, L.source ? LOCKED : null)),
      haFields, ecowittFields),

    section('Vorhersage', 'Mit einer DWD-Station kommt die Vorhersage stundengenau aus dem MOSMIX-Modell. Ohne sie wird die Wetter-Entität aus Home Assistant verwendet.',
      el('div.grid', {},
        field('DWD-Station', stationInput, lockNote(L.dwdStationId, 'Die Kennung der nächstgelegenen Station mit MOSMIX-Vorhersage.')),
        field('Angleichen an den Messwert', input(draft.forecast, 'biasHours', { inputMode: 'numeric' }), 'So viele Stunden lang wird die Vorhersage zur gemessenen Temperatur hin korrigiert.'),
        field('Wetter-Entität als Ersatz', input(draft.forecast, 'entity', { placeholder: 'weather.forecast_home', disabled: L.forecastEntity }), lockNote(L.forecastEntity)),
        field('Quellenangabe', input(draft.forecast, 'label', { placeholder: 'z. B. DWD MOSMIX' }))),
      stationMap),

    sensorsSection,

    section('Station', 'Was Besucher über die Station lesen.',
      el('div.grid', {},
        field('Name', input(draft.station, 'name', { max: LIMITS.stationName, disabled: L.stationName }), lockNote(L.stationName)),
        field('Untertitel', input(draft.station, 'subtitle', { max: LIMITS.stationSubtitle, disabled: L.stationSubtitle }), lockNote(L.stationSubtitle)),
        field('Höhe in Metern', input(draft.station, 'altitude', { inputMode: 'decimal', disabled: L.stationAltitude }), lockNote(L.stationAltitude)),
        field('In Betrieb seit', input(draft.station, 'since', { placeholder: 'JJJJ-MM-TT', disabled: L.stationSince }), lockNote(L.stationSince)),
        field('Ungefährer Standort, Breite', latInput, lockNote(L.stationPublicLocation, 'Wird auf 0,1 Grad gerundet, also etwa 10 km. Der genaue Standort bleibt privat.')),
        field('Ungefährer Standort, Länge', lonInput, lockNote(L.stationPublicLocation, 'Beide Felder leer lassen, um keinen Standort zu zeigen.'))),
      locationMap),

    section('Geräte', 'Die Geräte der Station mit Batterie- und Signalstand.', devicesEditor()),
    section('Warnregeln', 'Wann die Station eine Warnung zeigt.', alertsEditor()),

    el('div.save-bar', {}, el('button.btn.primary', { type: 'button', onclick: save }, 'Änderungen speichern'), saveNote),

    section('Zwei-Faktor-Anmeldung', null, twoFactor()),
    el('p.sub', {}, `Zeitzone des Servers: ${settings.timezone}.`));
}

async function refresh() {
  root.replaceChildren(el('p.sub', {}, 'Lade …'));
  try {
    const session = await getJson('/api/admin/session');
    if (!session.loggedIn) return renderLogin();
    if (session.mustChangePassword) return renderPassword(true);
    settings = await getJson('/api/admin/settings');
    renderSettings();
  } catch (e) {
    root.replaceChildren(el('h1', {}, 'Station verwalten'), el('p.form-msg.bad', {}, `Die Verwaltung ist gerade nicht erreichbar (${say(e)}).`),
      el('p.actions', {}, el('button.btn', { type: 'button', onclick: refresh }, 'Erneut versuchen')));
  }
}

export function enter() {
  root = $('adminRoot');
  if (!root.children.length || root.querySelector('.auth')) refresh();
}
