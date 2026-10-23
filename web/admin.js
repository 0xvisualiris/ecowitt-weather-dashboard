// Station management: sign in, then set up the station (data source, forecast, sensors, station
// details, devices, alert rules, password and two-factor sign-in). Talks to the dashboard's own admin API.

import { $, el, getJson, postJson, METRICS } from './lib.js';
import { disclosure, stationPicker, locationPicker } from './pickers.js';
import { DECIMAL, LOCALE, tr, loc, serverError } from './i18n.js';

const SENSOR_KEYS = ['temperature', 'feels_like', 'dew_point', 'humidity', 'wind_speed', 'wind_gust', 'wind_direction', 'rain_rate', 'rain_event', 'rain_daily',
  'pressure', 'solar_radiation', 'uv_index', 'lightning_distance', 'lightning_time', 'lightning_count'];
const SENSORS = Object.fromEntries(SENSOR_KEYS.map((k) => [k, tr(`sensor.${k}`)]));
const OPS = Object.fromEntries(['above', 'below', 'at_least', 'at_most', 'equals'].map((op) => [op, tr(`op.${op}`)]));
const LIMITS = { stationName: 60, stationSubtitle: 80, alertLabel: 60, alertDescription: 120, alertBanner: 120, alertMessage: 200, deviceName: 60, deviceShort: 12, deviceRole: 40 };
const LOCKED = tr('admin.locked');

let root, settings, draft, dirty;

// ---------- Small form helpers ----------

const field = (label, control, note) => el('label.field', {}, el('span.field-label', {}, label), control, note ? el('span.field-note', {}, note) : null);

function input(obj, key, opts = {}) {
  return el('input', {
    type: opts.type ?? 'text', value: obj[key] ?? '', placeholder: opts.placeholder, disabled: opts.disabled, maxLength: opts.max, list: opts.list,
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

const say = (e) => serverError(e.message);

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
    el('h1', {}, tr('admin.title')),
    el('p.sub', {}, tr(needsTotp ? 'login.code' : 'login.intro')),
    needsTotp ? null : field(tr('login.username'), input(form, 'username', { autocomplete: 'username' })),
    needsTotp ? null : field(tr('login.password'), input(form, 'password', { type: 'password', autocomplete: 'current-password' }), tr('login.firstRun')),
    needsTotp ? field(tr('login.codeLabel'), input(form, 'code', { inputMode: 'numeric', autocomplete: 'one-time-code', max: 6 })) : null,
    el('p.actions', {}, el('button.btn.primary', { type: 'submit' }, tr('login.submit'))),
    note));
  root.querySelector('input')?.focus();
}

function renderPassword(forced) {
  const form = { currentPassword: '', newPassword: '', repeat: '' };
  const note = el('p.form-msg', { role: 'status' });
  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword.length < 8) return message(note, tr('password.tooShort'), true);
    if (form.newPassword !== form.repeat) return message(note, tr('password.mismatch'), true);
    try {
      await postJson('/api/admin/password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      await refresh();
    } catch (err) { message(note, say(err), true); }
  };
  root.replaceChildren(el('form.auth', { onsubmit: submit },
    el('h1', {}, tr('password.title')),
    el('p.sub', {}, tr(forced ? 'password.forced' : 'password.intro')),
    field(tr('password.current'), input(form, 'currentPassword', { type: 'password', autocomplete: 'current-password' })),
    field(tr('password.new'), input(form, 'newPassword', { type: 'password', autocomplete: 'new-password' }), tr('password.newNote')),
    field(tr('password.repeat'), input(form, 'repeat', { type: 'password', autocomplete: 'new-password' })),
    el('p.actions', {},
      el('button.btn.primary', { type: 'submit' }, tr('password.title')),
      forced ? null : el('button.btn', { type: 'button', onclick: refresh }, tr('admin.cancel'))),
    note));
  root.querySelector('input')?.focus();
}

// ---------- Settings ----------

// The default rules carry their texts in every language; in the form a rule shows them in the
// admin's, and a rule saved from here keeps what was written, as plain text.
const TEXTS = ['label', 'description', 'banner', 'message'];
const editable = (rule) => ({ ...structuredClone(rule), ...Object.fromEntries(TEXTS.map((k) => [k, loc(rule[k])])) });

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
    alerts: (s.alerts ?? []).map(editable),
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
  if (dirty.devices) put('station', 'devices', d.devices.map((dev, i) => ({ ...dev, id: dev.id || slug(dev.name) || `device-${i + 1}` })));

  if (dirty.restoreAlerts) patch.alerts = null;
  else if (dirty.alerts) patch.alerts = d.alerts.map((a, i) => ({ ...a, id: a.id || slug(a.label ?? '') || `rule-${i + 1}` }));
  return patch;
}

// ---------- Entity picker ----------

// Home Assistant's sensors, loaded once the form is shown: { available, entities, suggestions (best
// fit first, per reading), byId }. The list arrives after the form is drawn, so every field that
// uses it registers in `pickers` how to fill itself in.
let catalog, pickers;
const ALL_ENTITIES = 'entities-all';

const reading = (ent) => {
  const state = String(ent.state ?? '');
  const value = state !== '' && Number.isFinite(Number(state)) ? state.replace('.', DECIMAL)
    : /^\d{4}-\d\d-\d\dT/.test(state) && !Number.isNaN(Date.parse(state)) ? new Date(state).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' })
      : state;
  return ent.unit ? `${value} ${ent.unit}` : value;
};
const options = (ids) => ids.map((id) => catalog.byId.get(id)).filter(Boolean)
  .map((ent) => el('option', { value: ent.id, label: `${ent.name} · ${reading(ent)}` }));

async function loadCatalog(status, allList) {
  const mine = pickers;
  let c;
  try { c = await getJson('/api/admin/entities'); } catch { c = { available: false } }
  if (mine !== pickers) return; // the form was drawn again meanwhile
  catalog = { ...c, byId: new Map((c.entities ?? []).map((ent) => [ent.id, ent])) };
  status.textContent = tr(catalog.available ? 'pick.ready' : 'pick.unavailable');
  allList.replaceChildren(...options([...catalog.byId.values()].sort((a, b) => a.name.localeCompare(b.name)).map((ent) => ent.id)));
  for (const fill of pickers) fill();
}

// A sensor field: its suggestions, and a note that says what the reading expects, or which sensor
// is chosen, with its current value, and whether it fits.
function sensorField(key, label, locked) {
  const list = el('datalist', { id: `entities-${key}` });
  const note = el('span.field-note');
  const redraw = () => {
    if (locked) return message(note, LOCKED);
    const id = draft.sensors[key].trim();
    if (!catalog?.available) return message(note, tr(`expect.${key}`));
    const fits = catalog.suggestions[key] ?? [];
    if (!id) return message(note, `${tr(`expect.${key}`)} ${tr('pick.matches', { n: fits.length })}`);
    const ent = catalog.byId.get(id);
    if (!ent) return message(note, tr('pick.unknown'), true);
    const chosen = `${ent.name} · ${reading(ent)}`;
    if (!fits.includes(id)) return message(note, `${chosen}. ${tr('pick.misfit', { unit: ent.unit || tr('pick.noUnit') })}`, true);
    message(note, chosen);
  };
  pickers.push(() => { list.replaceChildren(...options(catalog.suggestions[key] ?? [])); redraw(); });
  redraw();
  return el('label.field', {}, el('span.field-label', {}, label),
    input(draft.sensors, key, { placeholder: 'sensor.…', disabled: locked, list: list.id, changed: redraw }), note, list);
}

function devicesEditor() {
  const box = el('div.list');
  const locked = settings.locked.stationDevices;
  const touch = () => { dirty.devices = true; };
  const render = () => box.replaceChildren(
    ...draft.devices.map((dev, i) => el('fieldset.card', { disabled: locked },
      el('legend', {}, dev.name || tr('dev.numbered', { n: i + 1 })),
      el('div.grid', {},
        field(tr('dev.name'), input(dev, 'name', { max: LIMITS.deviceName, changed: touch })),
        field(tr('dev.short'), input(dev, 'short', { max: LIMITS.deviceShort, changed: touch })),
        field(tr('dev.role'), input(dev, 'role', { max: LIMITS.deviceRole, placeholder: tr('dev.rolePlaceholder'), changed: touch })),
        field(tr('dev.battery'), input(dev, 'battery', { placeholder: 'sensor.…', list: ALL_ENTITIES, changed: touch })),
        field(tr('dev.signal'), input(dev, 'signal', { placeholder: 'sensor.…', list: ALL_ENTITIES, changed: touch }))),
      el('div.checks', {}, el('span.field-label', {}, tr('dev.measures')),
        ...Object.entries(METRICS).map(([k, m]) => el('label.check', {},
          el('input', { type: 'checkbox', checked: (dev.metrics ?? []).includes(k), onchange: (e) => { dev.metrics = e.target.checked ? [...(dev.metrics ?? []), k] : (dev.metrics ?? []).filter((x) => x !== k); touch(); } }), m.label))),
      el('button.btn.quiet', { type: 'button', onclick: () => { draft.devices.splice(i, 1); touch(); render(); } }, tr('dev.remove')))),
    locked ? el('p.field-note', {}, LOCKED)
      : el('button.btn', { type: 'button', onclick: () => { draft.devices.push({ id: '', name: '', short: '', role: '', battery: '', signal: '', metrics: [] }); touch(); render(); } }, tr('dev.add')));
  render();
  return box;
}

function alertsEditor() {
  const box = el('div.list');
  const locked = settings.locked.alerts;
  const touch = () => { dirty.alerts = true; dirty.restoreAlerts = false; };
  const simple = (c) => c.sensor && !c.recent && Object.keys(OPS).some((op) => c[op] != null);

  const conditionRow = (rule, key, c, i, render) => {
    if (!simple(c)) return el('p.field-note', {}, tr('rule.custom'));
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
      el('button.btn.quiet', { type: 'button', 'aria-label': tr('rule.removeCondition'), onclick: () => { rule[key].splice(i, 1); touch(); render(); } }, tr('rule.remove')));
  };

  const render = () => box.replaceChildren(
    ...draft.alerts.map((rule, i) => {
      const key = Array.isArray(rule.any) ? 'any' : 'all';
      rule[key] ??= [];
      const mode = { value: key };
      return el('fieldset.card', { disabled: locked },
        el('legend', {}, rule.label || tr('rule.numbered', { n: i + 1 })),
        el('div.grid', {},
          field(tr('rule.name'), input(rule, 'label', { max: LIMITS.alertLabel, changed: touch })),
          field(tr('rule.level'), select(rule, 'level', { warning: tr('rule.warning'), info: tr('rule.info') }, touch)),
          field(tr('rule.description'), input(rule, 'description', { max: LIMITS.alertDescription, changed: touch })),
          field(tr('rule.banner'), input(rule, 'banner', { max: LIMITS.alertBanner, changed: touch })),
          field(tr('rule.message'), input(rule, 'message', { max: LIMITS.alertMessage, changed: touch }), tr('rule.messageNote'))),
        el('div.conds', {},
          field(tr('rule.when'), select(mode, 'value', { all: tr('rule.all'), any: tr('rule.any') }, () => {
            const list = rule[key]; delete rule[key]; rule[mode.value] = list; touch(); render();
          })),
          ...rule[key].map((c, n) => conditionRow(rule, key, c, n, render)),
          el('button.btn.quiet', { type: 'button', onclick: () => { rule[key].push({ sensor: 'temperature', below: 0 }); touch(); render(); } }, tr('rule.addCondition'))),
        el('button.btn.quiet', { type: 'button', onclick: () => { draft.alerts.splice(i, 1); touch(); render(); } }, tr('rule.removeRule')));
    }),
    locked ? el('p.field-note', {}, LOCKED) : el('p.actions', {},
      el('button.btn', { type: 'button', onclick: () => { draft.alerts.push({ id: '', label: '', description: '', level: 'warning', banner: '', message: '', all: [{ sensor: 'temperature', below: 0 }] }); touch(); render(); } }, tr('rule.add')),
      el('button.btn.quiet', { type: 'button', onclick: () => { draft.alerts = (settings.defaultAlerts ?? []).map(editable); dirty.alerts = false; dirty.restoreAlerts = true; render(); } }, tr('rule.restore'))));
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
        el('p.sub', {}, tr('tfa.on')),
        el('div.grid', {}, field(tr('tfa.confirmPassword'), input(form, 'password', { type: 'password', autocomplete: 'current-password' }))),
        el('p.actions', {}, el('button.btn', { type: 'button', onclick: async () => {
          try { await postJson('/api/admin/totp/disable', { password: form.password }); settings.totpEnabled = false; message(note, tr('tfa.turnedOff')); render(); } catch (e) { message(note, say(e), true); }
        } }, tr('tfa.turnOff'))), note);
    } else if (setup) {
      box.replaceChildren(
        el('p.sub', {}, tr('tfa.setup')),
        el('p.secret', {}, setup.secret),
        el('p.sub', {}, el('a', { href: setup.otpauthUrl }, tr('tfa.openApp'))),
        el('div.grid', {}, field(tr('tfa.code'), input(form, 'code', { inputMode: 'numeric', max: 6, autocomplete: 'one-time-code' }))),
        el('p.actions', {}, el('button.btn', { type: 'button', onclick: async () => {
          try { await postJson('/api/admin/totp/enable', { code: form.code }); settings.totpEnabled = true; message(note, tr('tfa.turnedOn')); render(); } catch (e) { message(note, say(e), true); }
        } }, tr('tfa.turnOn'))), note);
    } else {
      box.replaceChildren(
        el('p.sub', {}, tr('tfa.off')),
        el('p.actions', {}, el('button.btn', { type: 'button', onclick: async () => {
          try { render(await postJson('/api/admin/totp/setup', {})); } catch (e) { message(note, say(e), true); }
        } }, tr('tfa.start'))), note);
    }
  };
  render();
  return box;
}

function renderSettings() {
  makeDraft();
  catalog = null;
  pickers = [];
  const L = settings.locked;
  const saveNote = el('p.form-msg', { role: 'status' });
  const lockNote = (flag, extra) => (flag ? LOCKED : extra);

  // Only the fields of the chosen data source are shown.
  const haFields = el('div.grid', {},
    field(tr('source.haUrl'), input(draft.ha, 'url', { placeholder: 'http://homeassistant.local:8123', disabled: L.haUrl }), lockNote(L.haUrl)),
    field(tr('source.haToken'), input(draft.ha, 'token', { type: 'password', placeholder: tr(settings.homeassistant.tokenSet ? 'source.tokenSet' : 'source.tokenPaste'), disabled: L.haToken, autocomplete: 'new-password' }), lockNote(L.haToken)));
  const ecowittFields = el('div.grid', {},
    field(tr('source.gateway'), input(draft.ecowitt, 'host', { placeholder: '192.168.1.50', disabled: L.ecowittHost }),
      L.ecowittHost ? (L.ecowittHostEnv ? tr('admin.lockedEnv') : LOCKED) : tr('source.gatewayNote')));
  const pickStatus = el('p.field-note.pick-status', { role: 'status' }, tr('pick.loading'));
  const allEntities = el('datalist', { id: ALL_ENTITIES });
  const sensorsSection = section(tr('sensors.title'), tr('sensors.intro'), pickStatus,
    el('div.grid', {}, ...Object.entries(SENSORS).map(([k, label]) => sensorField(k, label, L.sensors?.[k]))));
  const showSource = () => {
    const ecowitt = draft.source === 'ecowitt';
    haFields.hidden = ecowitt;
    ecowittFields.hidden = !ecowitt;
    sensorsSection.hidden = ecowitt;
  };
  const sourceSelect = Object.assign(select(draft, 'source', { homeassistant: tr('source.homeassistant'), ecowitt: tr('source.ecowitt') }, showSource), { disabled: !!L.source });
  showSource();

  // These three fields can also be filled from a map, so the inputs are kept to write the choice back into them.
  const stationInput = input(draft.forecast, 'dwdStationId', { placeholder: tr('fc.stationPlaceholder'), disabled: L.dwdStationId });
  const latInput = input(draft.station, 'lat', { inputMode: 'decimal', placeholder: tr('st.latPlaceholder'), disabled: L.stationPublicLocation });
  const lonInput = input(draft.station, 'lon', { inputMode: 'decimal', placeholder: tr('st.lonPlaceholder'), disabled: L.stationPublicLocation });
  const parse = (text) => { const n = Number(String(text).replace(',', '.')); return text === '' || !Number.isFinite(n) ? null : n; };
  const stationMap = L.dwdStationId ? null : disclosure(tr('fc.pickStation'), (body) => stationPicker(body,
    () => draft.forecast.dwdStationId,
    (id) => { draft.forecast.dwdStationId = id; stationInput.value = id; }));
  const locationMap = L.stationPublicLocation ? null : disclosure(tr('st.pickLocation'), (body) => locationPicker(body,
    () => { const lat = parse(draft.station.lat), lon = parse(draft.station.lon); return lat != null && lon != null ? { lat, lon } : null; },
    (p) => { draft.station.lat = latInput.value = p ? String(p.lat).replace('.', DECIMAL) : ''; draft.station.lon = lonInput.value = p ? String(p.lon).replace('.', DECIMAL) : ''; }));

  const save = async () => {
    const patch = buildPatch();
    if (!Object.keys(patch).length) return message(saveNote, tr('admin.nothingChanged'));
    try {
      await postJson('/api/admin/settings', patch);
      message(saveNote, tr('admin.saved'));
      // The server stops and comes back; wait for it, then load everything fresh.
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try { await getJson('/api/config'); if (i > 1) break; } catch { /* still restarting */ }
      }
      location.reload();
    } catch (e) { message(saveNote, say(e), true); }
  };

  // Unlike el(), replaceChildren() would write a null child as the text "null".
  root.replaceChildren(...[
    el('div.page-head', {},
      el('h1', {}, tr('admin.title')),
      el('p.actions', {},
        el('button.btn', { type: 'button', onclick: () => renderPassword(false) }, tr('password.title')),
        el('button.btn', { type: 'button', onclick: async () => { await postJson('/api/admin/logout', {}).catch(() => {}); location.hash = '#/'; } }, tr('admin.signOut')))),
    settings.demo ? el('p.banner', {}, tr('admin.demo')) : null,

    section(tr('source.title'), tr('source.intro'),
      el('div.grid', {}, field(tr('source.from'), sourceSelect, L.source ? LOCKED : null)),
      haFields, ecowittFields),

    section(tr('fc.title'), tr('fc.intro'),
      el('div.grid', {},
        field(tr('fc.station'), stationInput, lockNote(L.dwdStationId, tr('fc.stationNote'))),
        field(tr('fc.bias'), input(draft.forecast, 'biasHours', { inputMode: 'numeric' }), tr('fc.biasNote')),
        field(tr('fc.entity'), input(draft.forecast, 'entity', { placeholder: 'weather.forecast_home', disabled: L.forecastEntity }), lockNote(L.forecastEntity)),
        field(tr('fc.label'), input(draft.forecast, 'label', { placeholder: tr('fc.labelPlaceholder') }))),
      stationMap),

    sensorsSection,

    section(tr('st.title'), tr('st.intro'),
      el('div.grid', {},
        field(tr('st.name'), input(draft.station, 'name', { max: LIMITS.stationName, disabled: L.stationName }), lockNote(L.stationName)),
        field(tr('st.subtitle'), input(draft.station, 'subtitle', { max: LIMITS.stationSubtitle, disabled: L.stationSubtitle }), lockNote(L.stationSubtitle)),
        field(tr('st.altitude'), input(draft.station, 'altitude', { inputMode: 'decimal', disabled: L.stationAltitude }), lockNote(L.stationAltitude)),
        field(tr('st.since'), input(draft.station, 'since', { placeholder: tr('st.sincePlaceholder'), disabled: L.stationSince }), lockNote(L.stationSince)),
        field(tr('st.lat'), latInput, lockNote(L.stationPublicLocation, tr('st.latNote'))),
        field(tr('st.lon'), lonInput, lockNote(L.stationPublicLocation, tr('st.lonNote')))),
      locationMap),

    section(tr('dev.title'), tr('dev.intro'), devicesEditor()),
    section(tr('rule.title'), tr('rule.intro'), alertsEditor()),

    el('div.save-bar', {}, el('button.btn.primary', { type: 'button', onclick: save }, tr('admin.save')), saveNote),

    section(tr('tfa.title'), null, twoFactor()),
    el('p.sub', {}, tr('admin.timezone', { tz: settings.timezone })),
    allEntities,
  ].filter(Boolean));
  loadCatalog(pickStatus, allEntities);
}

async function refresh() {
  root.replaceChildren(el('p.sub', {}, tr('admin.loading')));
  try {
    const session = await getJson('/api/admin/session');
    if (!session.loggedIn) return renderLogin();
    if (session.mustChangePassword) return renderPassword(true);
    settings = await getJson('/api/admin/settings');
    renderSettings();
  } catch (e) {
    root.replaceChildren(el('h1', {}, tr('admin.title')), el('p.form-msg.bad', {}, tr('admin.unreachable', { error: say(e) })),
      el('p.actions', {}, el('button.btn', { type: 'button', onclick: refresh }, tr('admin.retry'))));
  }
}

export function enter() {
  root = $('adminRoot');
  if (!root.children.length || root.querySelector('.auth')) refresh();
}
