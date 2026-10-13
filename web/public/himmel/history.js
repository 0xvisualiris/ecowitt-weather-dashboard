// Verlauf: one measurement over a day, week, month or year as a line chart, with today's
// figures, the sensor behind it and the station's records below.

import {
  $, el, getJson, store, METRICS, metricConv, conv, show, units, num, clock, weekday, weekdayShort, dateShort, dateLong, dayMonth, monthName,
  clamp, lerp, fitCanvas, canvasFont, DAY, HOUR,
} from './lib.js';

const RANGES = { day: 'Tag', week: 'Woche', month: 'Monat', year: 'Jahr' };
const COLOUR = { temp: '#ffcf5c', hum: '#7fc4ff', wind: '#9be8d8', rain: '#7fc4ff', press: '#e6ebe7', solar: '#ffcf5c', uv: '#ffa46b', light: '#ffd84d' };
const STAT_LABEL = {
  min: 'Tiefstwert', max: 'Höchstwert', mean: 'Mittel', minShort: 'Tiefstwert', maxShort: 'Höchstwert', meanShort: 'Mittel',
  sum: 'Summe', sumToday: 'Heute', maxDay: 'Nassester Tag', rainDays: 'Regentage', rainHours: 'Stunden mit Regen', strongest30min: 'Stärkste halbe Stunde',
  rainRate: 'Regenrate jetzt', yesterday: 'Gestern', yesterdayMean: 'Mittel gestern',
  strikes: 'Einschläge', strikesToday: 'Einschläge heute', nearest: 'Nächster', nearestToday: 'Nächster heute', lastStrike: 'Letzter Einschlag',
  lightningHours: 'Stunden mit Blitzen', thunderDays: 'Gewittertage', strongestGust: 'Stärkste Böe',
};

const state = { metric: 'temp', range: 'day', data: null, cursor: null, built: false, unitsKey: '' };
const canvas = $('histChart');
let view = null;   // geometry of the last drawing, for hit testing

function tabs(container, items, active, onPick) {
  container.replaceChildren(...Object.entries(items).map(([key, label]) =>
    el('button.tab', { type: 'button', 'aria-pressed': String(key === active), onclick: () => onPick(key) }, label)));
}

const withUnit = (text, unit) => (unit === '°' || unit === '°F' ? `${text}${unit}` : unit ? `${text} ${unit}` : text);

function statValue(s, metric) {
  const c = metricConv(metric), rain = conv('rain');
  switch (s.kind) {
    case 'rain': return `${show('rain', s.v)} ${rain.unit}`;
    case 'rate': return `${show('rain', s.v)} ${rain.unit}/h`;
    case 'count': case 'strikes': return num(s.v, 0);
    case 'km': return s.v == null ? '–' : `${num(s.v, 0)} km`;
    case 'time': return s.v == null && !s.t ? '–' : `${clock.format(s.t ?? s.v)} Uhr`;
    default: return s.v == null ? '–' : withUnit(num(c.f(s.v), c.digits), c.unit);
  }
}

function pointLabel(t) {
  if (state.range === 'day') return `${weekday.format(t)}, ${clock.format(t)} Uhr`;
  if (state.range === 'week') return `${weekday.format(t)}, ${dayMonth.format(t)}, ${clock.format(t)} Uhr`;
  return dateLong.format(t);
}

async function load() {
  const { metric, range } = state;
  $('histNote').textContent = '';
  try {
    const data = await getJson(`/api/history?metric=${metric}&range=${range}`);
    if (metric !== state.metric || range !== state.range) return;   // a newer choice was made meanwhile
    data.points = data.points.filter((p) => p.v != null);
    state.data = data;
    state.cursor = null;
  } catch (e) {
    state.data = { points: [], stats: [] };
    $('histNote').textContent = `Der Verlauf konnte nicht geladen werden (${e.message}).`;
  }
  renderStats();
  draw();
  renderReadout();
}

function renderStats() {
  const stats = state.data?.stats ?? [];
  $('histStats').replaceChildren(...stats.map((s) => el('div', {},
    el('dt', {}, STAT_LABEL[s.k] ?? s.k),
    el('dd', {}, statValue(s, state.metric), s.t ? el('small', {}, ` ${state.range === 'day' ? clock.format(s.t) : dayMonth.format(s.t)}`) : null))));
}

function renderReadout() {
  const pts = state.data?.points ?? [], c = metricConv(state.metric);
  const i = state.cursor ?? pts.length - 1;
  const p = pts[i];
  const glued = c.unit === '°' || c.unit === '°F';
  $('histUnit').textContent = glued ? '' : c.unit;
  if (!p) { $('histVal').textContent = '–'; $('histWhen').textContent = 'Noch keine Daten für diesen Zeitraum.'; return; }
  $('histVal').textContent = num(c.f(p.v), c.digits) + (glued ? c.unit : '');
  const span = p.lo != null && p.hi != null && state.range !== 'day' ? `, zwischen ${num(c.f(p.lo), c.digits)} und ${num(c.f(p.hi), c.digits)}` : '';
  $('histWhen').textContent = pointLabel(p.t) + span;
  canvas.setAttribute('aria-valuemax', String(Math.max(pts.length - 1, 0)));
  canvas.setAttribute('aria-valuenow', String(i));
  canvas.setAttribute('aria-valuetext', `${pointLabel(p.t)}: ${withUnit(num(c.f(p.v), c.digits), c.unit)}`);
}

// Round axis steps: 1, 2 or 5 times a power of ten.
function niceStep(span, target) {
  const raw = span / target, pow = 10 ** Math.floor(Math.log10(raw)), n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

function draw() {
  if (canvas.offsetParent === null) return;
  const { ctx, W, H } = fitCanvas(canvas);
  ctx.clearRect(0, 0, W, H);
  const M = METRICS[state.metric], c = metricConv(state.metric), colour = COLOUR[state.metric];
  const pts = (state.data?.points ?? []).map((p) => ({ t: p.t, v: c.f(p.v), lo: p.lo == null ? null : c.f(p.lo), hi: p.hi == null ? null : c.f(p.hi) }));
  view = null;
  if (pts.length < 2) return;

  const padL = 52, padR = 14, top = 14, base = H - 34;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const band = !M.bars && state.range !== 'day' && pts.every((p) => p.lo != null && p.hi != null);
  let lo = Math.min(...pts.map((p) => (band ? p.lo : p.v))), hi = Math.max(...pts.map((p) => (band ? p.hi : p.v)));
  if (M.bars || state.metric === 'solar' || state.metric === 'uv') lo = Math.min(lo, 0);
  if (hi - lo < 1e-6) hi = lo + 1;
  const step = niceStep(hi - lo, H < 300 ? 3 : 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const X = (t) => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
  const Y = (v) => lerp(base, top, (v - lo) / (hi - lo));
  const digits = step < 1 ? (step < 0.1 ? 2 : 1) : 0;

  // Horizontal rules with their values
  ctx.font = canvasFont(12, 400); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = lo; v <= hi + step / 2; v += step) {
    const y = Math.round(Y(v)) + 0.5;
    ctx.strokeStyle = 'rgba(243,246,242,0.13)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle = 'rgba(243,246,242,0.62)';
    ctx.fillText(num(v, digits), padL - 10, y);
  }
  ctx.textBaseline = 'alphabetic';

  if (M.bars) {
    const w = clamp((W - padL - padR) / pts.length * 0.7, 2, 26);
    ctx.fillStyle = colour;
    for (const p of pts) {
      if (!(p.v > 0)) continue;
      const y = Y(p.v), r = Math.min(w / 2, 4);
      ctx.beginPath(); ctx.roundRect(X(p.t) - w / 2, y, w, base - y, [r, r, 0, 0]); ctx.fill();
    }
  } else {
    const path = (key) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p[key])) : ctx.moveTo(X(p.t), Y(p[key])))); };
    if (band) {   // the span between each period's lowest and highest value
      ctx.globalAlpha = 0.2; ctx.fillStyle = colour;
      path('hi');
      for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(X(pts[i].t), Y(pts[i].lo));
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    } else {      // a soft fill under the line, fading towards the axis
      const fill = ctx.createLinearGradient(0, top, 0, base);
      fill.addColorStop(0, colour); fill.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.28; ctx.fillStyle = fill;
      path('v'); ctx.lineTo(X(t1), base); ctx.lineTo(X(t0), base); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    path('v'); ctx.stroke();
  }

  // Time along the bottom
  ctx.fillStyle = 'rgba(243,246,242,0.62)'; ctx.font = canvasFont(12, 400); ctx.textAlign = 'center';
  const ticks = [];
  const d = new Date(t0), narrow = W < 640;
  if (state.range === 'day') { d.setMinutes(0, 0, 0); for (let t = d.getTime(); t <= t1; t += HOUR) if (new Date(t).getHours() % (narrow ? 6 : 3) === 0) ticks.push([t, `${new Date(t).getHours()} Uhr`]); }
  else if (state.range === 'week') { d.setHours(0, 0, 0, 0); for (let t = d.getTime(); t <= t1; t += DAY) ticks.push([t + DAY / 2, weekdayShort.format(t).replace('.', '')]); }
  else if (state.range === 'month') { d.setHours(0, 0, 0, 0); for (let t = d.getTime(); t <= t1; t += DAY) if (new Date(t).getDate() % (narrow ? 7 : 4) === 1) ticks.push([t, dayMonth.format(t)]); }
  else { d.setDate(1); d.setHours(0, 0, 0, 0); for (let i = 0; i < 14; i++) { const t = new Date(d.getFullYear(), d.getMonth() + i, 1).getTime(); if (t > t1) break; if (!narrow || i % 2 === 0) ticks.push([t + 15 * DAY, monthName.format(t).replace('.', '')]); } }
  for (const [t, label] of ticks) { const x = X(t); if (x > padL + 16 && x < W - padR - 16) ctx.fillText(label, x, H - 10); }

  // Cursor
  const i = state.cursor;
  if (i != null && pts[i]) {
    const p = pts[i], x = X(p.t), y = Y(p.v);
    ctx.strokeStyle = 'rgba(243,246,242,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, base); ctx.stroke();
    if (band) { ctx.strokeStyle = colour; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, Y(p.hi)); ctx.lineTo(x, Y(p.lo)); ctx.stroke(); }
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ground') || '#12261f';
    ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.283); ctx.fill();
  }
  view = { X, pts };
}

function pick(clientX) {
  if (!view) return;
  const x = clientX - canvas.getBoundingClientRect().left;
  let best = 0, dist = Infinity;
  view.pts.forEach((p, i) => { const d = Math.abs(view.X(p.t) - x); if (d < dist) { dist = d; best = i; } });
  if (best !== state.cursor) { state.cursor = best; draw(); renderReadout(); }
}

function exportCsv() {
  const pts = state.data?.points ?? [], M = METRICS[state.metric], c = metricConv(state.metric);
  if (!pts.length) return;
  const cell = (v) => (v == null ? '' : String(Math.round(c.f(v) * 1000) / 1000).replace('.', ','));
  const stamp = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const unit = c.unit === '°' ? '°C' : c.unit;
  const rows = [['Zeit', `${M.label}${unit ? ` (${unit})` : ''}`, 'Minimum', 'Maximum'].join(';'), ...pts.map((p) => [stamp(p.t), cell(p.v), cell(p.lo), cell(p.hi)].join(';'))];
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `wetter-${state.metric}-${state.range}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('histNote').textContent = `${pts.length} Zeilen gespeichert, mit Semikolon getrennt.`;
}

// Today in figures and the sensor that measures it.
async function loadDetail() {
  const metric = state.metric;
  try {
    const d = await getJson(`/api/detail?metric=${metric}`);
    if (metric !== state.metric) return;
    $('detToday').replaceChildren(...d.today.map((s) => el('div', {},
      el('dt', {}, STAT_LABEL[s.k] ?? s.k),
      el('dd', {}, statValue(s, metric), s.t && s.kind !== 'time' ? el('small', {}, ` ${clock.format(s.t)}`) : null))));
    const dev = d.device;
    const reading = (r) => (r ? `${typeof r.value === 'number' ? num(r.value, Number.isInteger(r.value) ? 0 : 2) : r.value}${r.unit ? ` ${r.unit}` : ''}` : '–');
    $('detSensor').replaceChildren(...(dev ? [
      el('div', {}, el('dt', {}, 'Gerät'), el('dd', {}, dev.name)),
      el('div', {}, el('dt', {}, 'Aufgabe'), el('dd', {}, dev.role || '–')),
      el('div', {}, el('dt', {}, 'Batterie'), el('dd', {}, reading(dev.battery))),
      el('div', {}, el('dt', {}, 'Signal'), el('dd', {}, dev.signal ? `${reading(dev.signal)} von 4` : '–')),
    ] : [el('div', {}, el('dt', {}, 'Gerät'), el('dd', {}, 'Keinem Gerät zugeordnet'))]));
  } catch {
    $('detToday').replaceChildren(); $('detSensor').replaceChildren();
  }
}

async function loadRecords() {
  try {
    const { since, records } = await getJson('/api/records');
    $('recSince').textContent = since ? `Seit Inbetriebnahme am ${dateLong.format(new Date(since))}.` : '';
    const value = (v, kind, metric) => (v == null ? '–' : statValue({ v, kind }, metric));
    const when = (t) => (t ? dateShort.format(t) : '');
    const rows = Object.values(records).filter((r) => METRICS[r.metric]).map((r) => {
      const c = metricConv(r.metric);
      return el('tr', {},
        el('th', { scope: 'row' }, el('a', { href: `#/verlauf?m=${r.metric}&r=year` }, METRICS[r.metric].label + (r.maxLabel === 'gust' ? ' (Böe)' : ''))),
        el('td', {}, value(r.max, r.maxKind, r.metric), el('small', {}, when(r.maxT))),
        el('td', {}, value(r.min, r.minKind, r.metric), el('small', {}, when(r.minT))),
        el('td', {}, r.month?.sum != null ? value(r.month.sum, r.metric === 'rain' ? 'rain' : 'count', r.metric)
          : r.month?.min != null && r.month?.max != null ? `${num(c.f(r.month.min), c.digits)} bis ${value(r.month.max, 'metric', r.metric)}`
            : r.month?.max != null ? `bis ${value(r.month.max, r.maxKind, r.metric)}` : '–'));
    });
    $('recTable').replaceChildren(
      el('thead', {}, el('tr', {}, ...['Messwert', 'Höchstwert', 'Tiefstwert', 'Diesen Monat'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ...rows));
  } catch (e) {
    $('recSince').textContent = `Die Rekorde konnten nicht geladen werden (${e.message}).`;
  }
}

function build() {
  state.built = true;
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) pick(e.clientX); });
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pick(e.clientX); });
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { state.cursor = null; draw(); renderReadout(); } });
  canvas.addEventListener('keydown', (e) => {
    const n = state.data?.points.length ?? 0;
    if (!n) return;
    const i = state.cursor ?? n - 1;
    const next = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: n - 1 }[e.key];
    if (next == null) return;
    e.preventDefault();
    state.cursor = clamp(next, 0, n - 1); draw(); renderReadout();
  });
  new ResizeObserver(() => draw()).observe(canvas);
  $('histCsv').addEventListener('click', exportCsv);
  document.fonts?.ready.then(draw);
}

const go = (metric, range) => { location.hash = `#/verlauf?m=${metric}&r=${range}`; };

export function enter(params) {
  if (!state.built) build();
  const metric = METRICS[params.get('m')] ? params.get('m') : state.metric;
  const range = RANGES[params.get('r')] ? params.get('r') : state.range;
  const unitsKey = JSON.stringify(units);
  const metricChanged = metric !== state.metric || !state.data, unitsChanged = unitsKey !== state.unitsKey;
  const changed = metricChanged || range !== state.range;
  state.metric = metric; state.range = range; state.unitsKey = unitsKey;
  const available = store.cfg?.metrics ?? Object.keys(METRICS);
  tabs($('histMetric'), Object.fromEntries(Object.entries(METRICS).filter(([k]) => available.includes(k)).map(([k, m]) => [k, m.label])), metric, (m) => go(m, state.range));
  tabs($('histRange'), RANGES, range, (r) => go(state.metric, r));
  $('detTitle').textContent = `${METRICS[metric].label} heute`;
  if (changed) load(); else { renderStats(); draw(); renderReadout(); }
  if (metricChanged || unitsChanged) loadDetail();
  if (!$('recTable').children.length || unitsChanged) loadRecords();
}
