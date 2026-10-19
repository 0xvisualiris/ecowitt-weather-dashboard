// Forecast: the coming hours as a line chart, and each day in detail.

import {
  $, el, getJson, store, stationReady, CONDITION, num, weekday, dayMonth, show, conv, metricConv, temp as tempText,
  clamp, lerp, fitCanvas, canvasFont, drawCondition, scrub, HOUR, hourLabel,
} from './lib.js';
import { tr, words } from './i18n.js';

const state = { hours: [], source: '', synthetic: false, cursor: 0, built: false, loadedAt: 0 };
const canvas = $('fcChart');
let view = null;

const shown = () => state.hours.slice(0, canvas.getBoundingClientRect().width < 700 ? 36 : 72);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const dayWord = (t) => (sameDay(t, Date.now()) ? tr('time.today') : sameDay(t, Date.now() + 24 * HOUR) ? tr('time.tomorrow') : weekday.format(t));

async function load() {
  try {
    const data = await getJson('/api/forecast/hourly');
    Object.assign(state, { hours: data.hours ?? [], source: data.source, synthetic: data.synthetic, loadedAt: Date.now() });
    state.cursor = clamp(state.cursor, 0, Math.max(state.hours.length - 1, 0));
    $('fcSource').textContent = tr(data.synthetic ? 'forecast.sourceDerived' : 'forecast.source', { source: data.source });
  } catch (e) {
    state.hours = [];
    $('fcSource').textContent = tr('forecast.loadError', { error: e.message });
  }
  draw(); renderReadout(); renderDays();
}

function renderReadout() {
  const h = shown()[state.cursor];
  if (!h) { $('fcVal').textContent = '–'; $('fcWhen').textContent = tr('forecast.none'); $('fcSentence').textContent = ''; return; }
  $('fcWhen').textContent = tr('time.dayAt', { day: dayWord(h.t), time: hourLabel(new Date(h.t).getHours()) });
  $('fcVal').textContent = tempText(h.temp);
  const parts = [CONDITION[h.conditionCode] ?? tr('cond.unknown')];
  if (h.pop != null) parts.push(tr('forecast.chanceOfRain', { pop: num(h.pop, 0) }));
  if (h.rain > 0) parts.push(tr('now.rainAmount', { v: show('rain', h.rain), unit: conv('rain').unit }));
  const second = [];
  if (h.wind != null) second.push(tr(h.gust != null ? 'forecast.windGusts' : 'forecast.wind', { v: show('wind', h.wind, 0), unit: conv('wind').unit, g: show('wind', h.gust, 0) }));
  if (h.sunMin > 0) second.push(tr('forecast.sunMinutes', { n: num(h.sunMin, 0) }));
  else if (h.cloud != null) second.push(tr('forecast.cloud', { n: num(h.cloud, 0) }));
  $('fcSentence').textContent = `${parts.join(', ')}. ${second.join('. ')}${second.length ? '.' : ''}`;
  canvas.setAttribute('aria-valuemax', String(Math.max(shown().length - 1, 0)));
  canvas.setAttribute('aria-valuenow', String(state.cursor));
  canvas.setAttribute('aria-valuetext', tr('forecast.aria', { when: $('fcWhen').textContent, t: num(h.temp, 1), parts: parts.join(', ') }));
}

// Round axis steps: 1, 2 or 5 times a power of ten.
function niceStep(span, target) {
  const raw = span / target, pow = 10 ** Math.floor(Math.log10(raw)), n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

// A line chart like the one under History: temperature on a value scale, the sky every few hours
// above it and the chance of rain as bars in a strip of its own below.
function draw() {
  if (canvas.offsetParent === null) return;
  const { ctx, W, H } = fitCanvas(canvas);
  ctx.clearRect(0, 0, W, H);
  const hours = shown(), c = metricConv('temp'), colour = '#ffcf5c';
  view = null;
  if (hours.length < 2) return;

  const padL = 52, padR = 14, top = 76, base = H - 116, rainTop = H - 84, rainBase = H - 34;
  const t0 = hours[0].t, t1 = hours[hours.length - 1].t;
  const X = (t) => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
  let lo = Math.min(...hours.map((h) => c.f(h.temp))), hi = Math.max(...hours.map((h) => c.f(h.temp)));
  if (hi - lo < 1e-6) hi = lo + 1;
  const step = niceStep(hi - lo, H < 400 ? 3 : 4);
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  const Y = (v) => lerp(base, top, (v - lo) / (hi - lo));
  const digits = step < 1 ? 1 : 0;

  // Horizontal rules with their values
  ctx.font = canvasFont(12, 400); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = lo; v <= hi + step / 2; v += step) {
    const y = Math.round(Y(v)) + 0.5;
    ctx.strokeStyle = 'rgba(243,246,242,0.13)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle = 'rgba(243,246,242,0.62)';
    ctx.fillText(`${num(v, digits)}${c.unit}`, padL - 10, y);
  }

  // The rain strip: its own 0 and 100 % rules
  for (const y of [rainTop, rainBase]) {
    ctx.strokeStyle = 'rgba(243,246,242,0.13)'; ctx.beginPath(); ctx.moveTo(padL, Math.round(y) + 0.5); ctx.lineTo(W - padR, Math.round(y) + 0.5); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(243,246,242,0.62)';
  ctx.fillText('100 %', padL - 10, rainTop); ctx.fillText(tr('forecast.rainStrip'), padL - 10, (rainTop + rainBase) / 2);
  ctx.textBaseline = 'alphabetic';

  // Days: a faint line at each midnight and the name of the day
  ctx.font = canvasFont(13, 600); ctx.textAlign = 'left';
  const starts = [t0];
  for (const h of hours) if (new Date(h.t).getHours() === 0 && h.t !== t0) starts.push(h.t);
  starts.forEach((t, i) => {
    const x = X(t), next = i + 1 < starts.length ? X(starts[i + 1]) : W - padR;
    if (i) { ctx.strokeStyle = 'rgba(243,246,242,0.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 6); ctx.lineTo(Math.round(x) + 0.5, rainBase); ctx.stroke(); }
    if (next - x > 64) { ctx.fillStyle = 'rgba(243,246,242,0.95)'; ctx.fillText(dayWord(t), x + (i ? 8 : 0), 20); }
  });

  // What the sky does, every few hours
  const every = W < 700 ? 3 : hours.length > 48 ? 3 : 2;
  hours.forEach((h, i) => { if (i % every === 1) drawCondition(ctx, h.conditionCode, X(h.t), 48, W < 700 ? 8 : 9); });

  // Temperature: a soft fill under the line, fading towards the axis
  const path = () => { ctx.beginPath(); hours.forEach((h, i) => (i ? ctx.lineTo(X(h.t), Y(c.f(h.temp))) : ctx.moveTo(X(h.t), Y(c.f(h.temp))))); };
  const fill = ctx.createLinearGradient(0, top, 0, base);
  fill.addColorStop(0, colour); fill.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.28; ctx.fillStyle = fill;
  path(); ctx.lineTo(X(t1), base); ctx.lineTo(X(t0), base); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  path(); ctx.stroke();

  // Chance of rain as bars
  const colW = clamp((W - padL - padR) / hours.length * 0.7, 2, 14);
  ctx.fillStyle = '#7fc4ff';
  for (const h of hours) {
    if (!(h.pop > 0)) continue;
    const height = h.pop / 100 * (rainBase - rainTop), r = Math.min(colW / 2, 3);
    ctx.beginPath(); ctx.roundRect(X(h.t) - colW / 2, rainBase - height, colW, height, [r, r, 0, 0]); ctx.fill();
  }

  // Hours along the bottom
  ctx.fillStyle = 'rgba(243,246,242,0.62)'; ctx.font = canvasFont(12, 400); ctx.textAlign = 'center';
  hours.forEach((h) => {
    const hour = new Date(h.t).getHours(), x = X(h.t);
    if (hour % (W < 700 ? 6 : hours.length > 48 ? 6 : 3) === 0 && x > padL + 16 && x < W - padR - 16) ctx.fillText(hourLabel(hour), x, H - 10);
  });

  // Cursor
  const cur = hours[state.cursor];
  if (cur) {
    const x = X(cur.t), y = Y(c.f(cur.temp));
    ctx.strokeStyle = 'rgba(243,246,242,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, rainBase); ctx.stroke();
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ground') || '#12261f';
    ctx.beginPath(); ctx.arc(x, y, 6.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.283); ctx.fill();
  }
  view = { X, hours };
}

function pick(clientX) {
  if (!view) return;
  const x = clientX - canvas.getBoundingClientRect().left;
  let best = 0, dist = Infinity;
  view.hours.forEach((h, i) => { const d = Math.abs(view.X(h.t) - x); if (d < dist) { dist = d; best = i; } });
  if (best !== state.cursor) { state.cursor = best; draw(); renderReadout(); }
}

// With real hourly data the days are summed up from it, so the list always agrees with the landscape above.
const SEVERITY = ['sunny', 'clear-night', 'partlycloudy', 'cloudy', 'fog', 'rainy', 'pouring', 'snowy-rainy', 'snowy', 'lightning', 'hail', 'lightning-rainy'];
function daysToShow() {
  const api = store.cur?.forecast?.days ?? [];
  if (state.synthetic || !state.hours.length) return api;
  const groups = new Map();
  for (const h of state.hours) { const d = new Date(h.t); d.setHours(0, 0, 0, 0); (groups.get(d.getTime()) ?? groups.set(d.getTime(), []).get(d.getTime())).push(h); }
  const own = [...groups].filter(([, hs]) => hs.length >= 6).map(([date, hs]) => {
    const daytime = hs.filter((h) => h.conditionCode !== 'clear-night');
    return {
      date,
      lo: Math.min(...hs.map((h) => h.temp)), hi: Math.max(...hs.map((h) => h.temp)),
      pop: Math.max(...hs.map((h) => h.pop ?? 0)),
      conditionCode: (daytime.length ? daytime : hs).map((h) => h.conditionCode).sort((x, y) => SEVERITY.indexOf(y) - SEVERITY.indexOf(x))[0],
    };
  });
  const last = own.length ? own[own.length - 1].date : 0;
  return [...own, ...(store.cfg?.demo ? [] : api.filter((d) => d.date > last))];
}

function renderDays() {
  const days = daysToShow();
  if (!days.length) { $('fcDays').replaceChildren(el('li.empty', {}, tr('forecast.notSetUp'))); return; }
  const lo = Math.min(...days.map((d) => d.lo)), hi = Math.max(...days.map((d) => d.hi)), span = Math.max(hi - lo, 1);
  const cell = (label, value) => el('span.fc-cell', {}, el('small', {}, label), value);

  $('fcDays').replaceChildren(...days.map((d, i) => {
    const hrs = state.hours.filter((h) => sameDay(h.t, d.date));
    const complete = hrs.length >= 12;
    const rain = hrs.reduce((s, h) => s + (h.rain ?? 0), 0);
    const gust = Math.max(...hrs.map((h) => h.gust ?? 0));
    const sun = hrs.reduce((s, h) => s + (h.sunMin ?? 0), 0) / 60;
    const summary = el('summary', {},
      el('span.fc-name', {}, i === 0 ? tr('time.today') : weekday.format(d.date), el('small', {}, dayMonth.format(d.date))),
      el('span.fc-cond', {}, CONDITION[d.conditionCode] ?? '–'),
      el('span.fc-range', {},
        el('span.fc-lo', {}, tempText(d.lo, 0)),
        el('span.fc-track', {}, el('i', { style: `left:${(d.lo - lo) / span * 100}%;right:${(hi - d.hi) / span * 100}%` })),
        el('span.fc-hi', {}, tempText(d.hi, 0))),
      cell(tr('forecast.cellPop'), d.pop == null ? '–' : `${num(d.pop, 0)} %`),
      cell(tr('forecast.cellRain'), hrs.length ? `${show('rain', rain)} ${conv('rain').unit}` : '–'),
      cell(tr('forecast.cellGust'), hrs.length ? `${show('wind', gust, 0)} ${conv('wind').unit}` : '–'),
      cell(tr('forecast.cellSun'), complete ? tr('forecast.sunHours', { n: num(sun, 1) }) : '–'));

    const slots = hrs.filter((h) => new Date(h.t).getHours() % 3 === 0);
    const body = slots.length
      ? el('div.table-scroll', {}, el('table.fc-hours', {},
        el('thead', {}, el('tr', {}, ...words('forecast.tableHeads').map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, ...slots.map((h) => el('tr', {},
          el('th', { scope: 'row' }, hourLabel(new Date(h.t).getHours())),
          el('td', {}, tempText(h.temp)),
          el('td', {}, CONDITION[h.conditionCode] ?? '–'),
          el('td', {}, h.pop == null ? '–' : `${num(h.pop, 0)} %`),
          el('td', {}, h.rain > 0 ? `${show('rain', h.rain)} ${conv('rain').unit}` : '–'),
          el('td', {}, h.wind == null ? '–' : `${show('wind', h.wind, 0)} ${conv('wind').unit}`),
          el('td', {}, h.gust == null ? '–' : `${show('wind', h.gust, 0)} ${conv('wind').unit}`))))))
      : el('p.sub', {}, tr('forecast.noHours'));
    return el('li', {}, el('details', { open: i === 0 }, summary, body));
  }));
}

function build() {
  state.built = true;
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && !e.buttons) pick(e.clientX); });   // hover
  scrub(canvas, { begin: (e) => pick(e.clientX), move: (e) => pick(e.clientX), end: () => {} });
  canvas.addEventListener('keydown', (e) => {
    const n = shown().length;
    const next = { ArrowLeft: state.cursor - 1, ArrowRight: state.cursor + 1, PageUp: state.cursor + 6, PageDown: state.cursor - 6, Home: 0, End: n - 1 }[e.key];
    if (next == null || !n) return;
    e.preventDefault();
    state.cursor = clamp(next, 0, n - 1); draw(); renderReadout();
  });
  new ResizeObserver(() => { state.cursor = clamp(state.cursor, 0, Math.max(shown().length - 1, 0)); draw(); renderReadout(); }).observe(canvas);
  document.fonts?.ready.then(draw);
}

export async function enter() {
  if (!state.built) build();
  await stationReady();
  if (Date.now() - state.loadedAt > 10 * 60 * 1000) await load(); else { draw(); renderReadout(); renderDays(); }
}
