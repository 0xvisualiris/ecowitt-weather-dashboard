// Vorhersage: the coming hours as a landscape that has not happened yet, and each day in detail.

import {
  $, el, getJson, store, stationReady, CONDITION, num, clock, weekday, dayMonth, show, conv, temp as tempText,
  clamp, lerp, skyAt, mix, rgb, fitCanvas, canvasFont, drawCondition, HOUR,
} from './lib.js';

const state = { hours: [], source: '', synthetic: false, cursor: 0, built: false, loadedAt: 0 };
const canvas = $('fcChart');
let view = null;

const shown = () => state.hours.slice(0, canvas.getBoundingClientRect().width < 700 ? 36 : 72);
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const dayWord = (t) => (sameDay(t, Date.now()) ? 'Heute' : sameDay(t, Date.now() + 24 * HOUR) ? 'Morgen' : weekday.format(t));

async function load() {
  try {
    const data = await getJson('/api/forecast/hourly');
    Object.assign(state, { hours: data.hours ?? [], source: data.source, synthetic: data.synthetic, loadedAt: Date.now() });
    state.cursor = clamp(state.cursor, 0, Math.max(state.hours.length - 1, 0));
    $('fcSource').textContent = data.synthetic
      ? `Quelle: ${data.source}. Die Stundenwerte sind aus der Tagesvorhersage abgeleitet, weil keine DWD-Station eingestellt ist.`
      : `Quelle: ${data.source}.`;
  } catch (e) {
    state.hours = [];
    $('fcSource').textContent = `Die Vorhersage konnte nicht geladen werden (${e.message}).`;
  }
  draw(); renderReadout(); renderDays();
}

function renderReadout() {
  const h = shown()[state.cursor];
  if (!h) { $('fcVal').textContent = '–'; $('fcWhen').textContent = 'Keine Vorhersage verfügbar.'; $('fcSentence').textContent = ''; return; }
  $('fcWhen').textContent = `${dayWord(h.t)}, ${new Date(h.t).getHours()} Uhr`;
  $('fcVal').textContent = tempText(h.temp);
  const parts = [CONDITION[h.conditionCode] ?? 'Wechselhaft'];
  if (h.pop != null) parts.push(`${num(h.pop, 0)} % Regenrisiko`);
  if (h.rain > 0) parts.push(`${show('rain', h.rain)} ${conv('rain').unit} Regen`);
  const second = [];
  if (h.wind != null) second.push(`Wind ${show('wind', h.wind, 0)} ${conv('wind').unit}${h.gust != null ? `, Böen bis ${show('wind', h.gust, 0)}` : ''}`);
  if (h.sunMin > 0) second.push(`${num(h.sunMin, 0)} Min. Sonne`);
  else if (h.cloud != null) second.push(`${num(h.cloud, 0)} % bewölkt`);
  $('fcSentence').textContent = `${parts.join(', ')}. ${second.join('. ')}${second.length ? '.' : ''}`;
  canvas.setAttribute('aria-valuemax', String(Math.max(shown().length - 1, 0)));
  canvas.setAttribute('aria-valuenow', String(state.cursor));
  canvas.setAttribute('aria-valuetext', `${$('fcWhen').textContent}: ${num(h.temp, 1)} Grad, ${parts.join(', ')}`);
}

function draw() {
  if (canvas.offsetParent === null) return;
  const { ctx, W, H } = fitCanvas(canvas);
  const hours = shown(), cur = store.cur, astro = cur?.astro;
  view = null;
  if (hours.length < 2) { ctx.fillStyle = rgb(skyAt(Date.now(), astro).zenith); ctx.fillRect(0, 0, W, H); return; }

  const padL = 22, padR = 22, t0 = hours[0].t, t1 = hours[hours.length - 1].t;
  const X = (t) => padL + (t - t0) / (t1 - t0) * (W - padL - padR);
  const cover = (t) => hours[clamp(Math.round((t - t0) / HOUR), 0, hours.length - 1)].conditionCode;

  // The sky passes through day and night from left to right.
  for (let x = 0; x < W; x += 4) {
    const t = t0 + (x - padL) / (W - padL - padR) * (t1 - t0);
    // Averaged over a few hours, so dawn and dusk are a slow change of light instead of a hard stripe.
    const around = [-2, -1, 0, 1, 2].map((k) => skyAt(t + k * 0.75 * HOUR, astro, cover(t)));
    const avg = (key) => around.reduce((sum, s) => sum.map((v, i) => v + s[key][i] / around.length), [0, 0, 0]);
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.8);
    g.addColorStop(0, rgb(avg('zenith'))); g.addColorStop(1, rgb(avg('horizon')));
    ctx.fillStyle = g; ctx.fillRect(x, 0, 5, H);
  }

  const top = H * 0.36, base = H - 104;
  let lo = Math.min(...hours.map((h) => h.temp)), hi = Math.max(...hours.map((h) => h.temp));
  if (hi - lo < 2) { hi += 1; lo -= 1; }
  const Y = (v) => lerp(base, top, (v - lo) / (hi - lo));

  // Days: a faint line at each midnight and the name of the day
  ctx.font = canvasFont(14, 600); ctx.textAlign = 'left';
  const starts = [t0];
  for (const h of hours) if (new Date(h.t).getHours() === 0 && h.t !== t0) starts.push(h.t);
  starts.forEach((t, i) => {
    const x = X(t), next = i + 1 < starts.length ? X(starts[i + 1]) : W;
    if (i) { ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x, H - 30); ctx.stroke(); }
    if (next - x > 74) { ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillText(dayWord(t), x + (i ? 10 : 0), 28); }
  });

  // What the sky does, every three hours
  const step = W < 700 ? 3 : hours.length > 48 ? 3 : 2;
  hours.forEach((h, i) => { if (i % step === 1) drawCondition(ctx, h.conditionCode, X(h.t), 62, W < 700 ? 8 : 9); });

  // The land ahead: the forecast temperature. Dashed, because it is only expected.
  const ground = skyAt(Date.now(), astro).ground;
  ctx.fillStyle = rgb(ground, 0.94);
  ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, Y(hours[0].temp));
  for (const h of hours) ctx.lineTo(X(h.t), Y(h.temp));
  ctx.lineTo(W, Y(hours[hours.length - 1].temp)); ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.6; ctx.setLineDash([5, 5]);
  ctx.beginPath(); hours.forEach((h, i) => (i ? ctx.lineTo(X(h.t), Y(h.temp)) : ctx.moveTo(X(h.t), Y(h.temp)))); ctx.stroke();
  ctx.setLineDash([]);

  // Temperatures written on the ridge
  ctx.font = canvasFont(13, 600); ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(255,255,255,0.95)';
  const every = W < 700 ? 6 : hours.length > 48 ? 6 : 4;
  hours.forEach((h, i) => { if (i % every === 2 && Math.abs(i - state.cursor) > 1) ctx.fillText(tempText(h.temp, 0), X(h.t), Y(h.temp) - 10); });

  // Chance of rain as columns rising from the bottom of the land
  const colW = Math.max(2, (W - padL - padR) / hours.length * 0.6), rainBase = H - 40;
  for (const h of hours) {
    if (!(h.pop > 0)) continue;
    const height = h.pop / 100 * 46;
    ctx.fillStyle = `rgba(150,205,255,${0.3 + 0.6 * h.pop / 100})`;
    ctx.fillRect(X(h.t) - colW / 2, rainBase - height, colW, height);
  }
  ctx.font = canvasFont(12, 400); ctx.fillStyle = 'rgba(243,246,242,0.6)'; ctx.textAlign = 'left';
  ctx.fillText('Regenrisiko', padL, rainBase - 52);

  // Hours along the bottom
  ctx.textAlign = 'center';
  hours.forEach((h) => {
    const hour = new Date(h.t).getHours(), x = X(h.t);
    if (hour % (W < 700 ? 6 : hours.length > 48 ? 6 : 3) === 0 && x > 30 && x < W - 30) ctx.fillText(`${hour} Uhr`, x, H - 14);
  });

  // Cursor
  const c = hours[state.cursor];
  if (c) {
    const x = X(c.t), y = Y(c.temp);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, 78); ctx.lineTo(x, rainBase); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.beginPath(); ctx.arc(x, y, 11, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.283); ctx.fill();
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
  if (!days.length) { $('fcDays').replaceChildren(el('li.empty', {}, 'Für diese Station ist keine Vorhersage eingerichtet. Unter „Station verwalten“ lässt sich eine DWD-Station wählen.')); return; }
  const lo = Math.min(...days.map((d) => d.lo)), hi = Math.max(...days.map((d) => d.hi)), span = Math.max(hi - lo, 1);
  const cell = (label, value) => el('span.fc-cell', {}, el('small', {}, label), value);

  $('fcDays').replaceChildren(...days.map((d, i) => {
    const hrs = state.hours.filter((h) => sameDay(h.t, d.date));
    const complete = hrs.length >= 12;
    const rain = hrs.reduce((s, h) => s + (h.rain ?? 0), 0);
    const gust = Math.max(...hrs.map((h) => h.gust ?? 0));
    const sun = hrs.reduce((s, h) => s + (h.sunMin ?? 0), 0) / 60;
    const summary = el('summary', {},
      el('span.fc-name', {}, i === 0 ? 'Heute' : weekday.format(d.date), el('small', {}, dayMonth.format(d.date))),
      el('span.fc-cond', {}, CONDITION[d.conditionCode] ?? '–'),
      el('span.fc-range', {},
        el('span.fc-lo', {}, tempText(d.lo, 0)),
        el('span.fc-track', {}, el('i', { style: `left:${(d.lo - lo) / span * 100}%;right:${(hi - d.hi) / span * 100}%` })),
        el('span.fc-hi', {}, tempText(d.hi, 0))),
      cell('Regenrisiko', d.pop == null ? '–' : `${num(d.pop, 0)} %`),
      cell('Regen', hrs.length ? `${show('rain', rain)} ${conv('rain').unit}` : '–'),
      cell('Böen bis', hrs.length ? `${show('wind', gust, 0)} ${conv('wind').unit}` : '–'),
      cell('Sonne', complete ? `${num(sun, 1)} Std.` : '–'));

    const slots = hrs.filter((h) => new Date(h.t).getHours() % 3 === 0);
    const body = slots.length
      ? el('div.table-scroll', {}, el('table.fc-hours', {},
        el('thead', {}, el('tr', {}, ...['Uhrzeit', 'Temperatur', 'Wetter', 'Regenrisiko', 'Regen', 'Wind', 'Böen'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, ...slots.map((h) => el('tr', {},
          el('th', { scope: 'row' }, `${new Date(h.t).getHours()} Uhr`),
          el('td', {}, tempText(h.temp)),
          el('td', {}, CONDITION[h.conditionCode] ?? '–'),
          el('td', {}, h.pop == null ? '–' : `${num(h.pop, 0)} %`),
          el('td', {}, h.rain > 0 ? `${show('rain', h.rain)} ${conv('rain').unit}` : '–'),
          el('td', {}, h.wind == null ? '–' : `${show('wind', h.wind, 0)} ${conv('wind').unit}`),
          el('td', {}, h.gust == null ? '–' : `${show('wind', h.gust, 0)} ${conv('wind').unit}`))))))
      : el('p.sub', {}, 'Für diesen Tag gibt es noch keine Stundenwerte.');
    return el('li', {}, el('details', { open: i === 0 }, summary, body));
  }));
}

function build() {
  state.built = true;
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) pick(e.clientX); });
  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pick(e.clientX); });
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
