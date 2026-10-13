// The two map pickers on the admin page: the DWD forecast station, and the approximate public location.

import { el, getJson, num, clamp } from './lib.js';
import { GRID, createMap, toGridPos, toLonLat, nearestPlace } from './map.js';

// DWD spells umlauts out ("Gruendau"), so a search for "Gründau" has to as well.
const plain = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

// A button that opens its content below it. The content is built on first opening, when it has a size.
export function disclosure(label, build) {
  let built = false;
  const body = el('div.picker');
  return el('details.picker-wrap', { ontoggle: (e) => { if (e.target.open && !built) { built = true; build(body); } } },
    el('summary.btn', {}, label), body);
}

// Every station DWD publishes a MOSMIX forecast for, as dots. Tap one, or search by name.
export function stationPicker(body, getId, setId) {
  const info = el('p.picker-info', { role: 'status' }, 'Lade die Stationen …');
  const search = el('input', { type: 'text', placeholder: 'Ort oder Station suchen, z. B. Bamberg', autocomplete: 'off', spellcheck: false, 'aria-label': 'Station suchen' });
  const results = el('div.picker-results');
  const mapBox = el('div');
  body.append(el('div.picker-head', {}, search, results), mapBox, info);

  let stations = [], hover = null;
  const selected = () => stations.find((s) => s.id === getId().trim());
  const describe = (s) => `${s.name} (${s.id})`;
  const nearest = (gx, gy, reachPx) => {
    let best = null, dist = reachPx / map.scale;
    for (const s of stations) { const d = Math.hypot(s.px[0] - gx, s.px[1] - gy); if (d < dist) { dist = d; best = s; } }
    return best;
  };
  const say = () => {
    const s = selected();
    info.textContent = hover && hover !== s ? `${describe(hover)}. Antippen, um sie zu wählen.`
      : s ? `Gewählt: ${describe(s)}.` : stations.length ? `${stations.length} Stationen. Tippe auf einen Punkt oder suche oben nach einem Ort.` : info.textContent;
  };
  const choose = (s, fly) => {
    setId(s.id); hover = null; say(); map.draw();
    if (fly) map.flyTo({ x: s.px[0] - 55, y: s.px[1] - 55, w: 110 });
  };

  const map = createMap(mapBox, {
    label: 'Karte der DWD-Stationen. Pfeiltasten verschieben, Plus und Minus zoomen.',
    lines: (ctx, m) => {
      const zoom = GRID / m.view.w, r = clamp(1.3 + zoom * 0.45, 1.6, 4.2) / m.scale;
      ctx.fillStyle = 'rgba(243,246,242,0.78)';
      ctx.beginPath();
      for (const s of stations) { ctx.moveTo(s.px[0] + r, s.px[1]); ctx.arc(s.px[0], s.px[1], r, 0, 6.283); }
      ctx.fill();
    },
    over: (ctx, m) => {
      for (const [s, colour, r] of [[hover, '#ffffff', 6], [selected(), '#ffcf5c', 7]]) {
        if (!s) continue;
        const [x, y] = m.toScreen(...s.px);
        ctx.fillStyle = 'rgba(8,14,26,0.85)'; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, 6.283); ctx.fill();
        ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
      }
    },
    onHover: (g) => { const s = g ? nearest(g[0], g[1], 14) : null; if (s !== hover) { hover = s; say(); map.draw(); } },
    onPick: (gx, gy) => { const s = nearest(gx, gy, 22); if (s) choose(s, false); },
  });

  search.addEventListener('input', () => {
    const q = plain(search.value.trim());
    const hits = q.length < 2 ? [] : stations.filter((s) => s.key.includes(q) || s.id.toLowerCase().startsWith(q)).slice(0, 8);
    results.replaceChildren(...hits.map((s) => el('button.btn', { type: 'button', onclick: () => { choose(s, true); results.replaceChildren(); search.value = s.name; } }, describe(s))),
      q.length >= 2 && !hits.length ? el('span.field-note', {}, 'Keine Station mit diesem Namen.') : null);
  });

  getJson('/dwd-stations.json').then((j) => {
    stations = j.stations.map((s) => ({ ...s, px: toGridPos(s.lon, s.lat), key: plain(s.name) }))
      .filter((s) => s.px[0] > 0 && s.px[0] < GRID && s.px[1] > 0 && s.px[1] < GRID);
    say(); map.draw();
    const s = selected();
    if (s) map.setHome({ x: s.px[0] - 120, y: s.px[1] - 120, w: 240 });
  }).catch(() => { info.textContent = 'Die Stationsliste konnte nicht geladen werden. Die Kennung lässt sich oben auch von Hand eintragen.'; });
}

// The public location is only ever kept to 0.1 degree, so the map picks a cell of that size, not a point.
export function locationPicker(body, get, set) {
  const info = el('p.picker-info', { role: 'status' });
  const remove = el('button.btn.quiet', { type: 'button', onclick: () => { set(null); say(); map.draw(); } }, 'Standort entfernen');
  const mapBox = el('div');
  body.append(mapBox, el('div.picker-foot', {}, info, remove));
  let hover = null;

  const snap = (v) => Math.round(v * 10) / 10;
  const cellPath = (ctx, lat, lon) => {
    const corners = [[lon - 0.05, lat - 0.05], [lon + 0.05, lat - 0.05], [lon + 0.05, lat + 0.05], [lon - 0.05, lat + 0.05]].map(([lo, la]) => toGridPos(lo, la));
    ctx.beginPath(); corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  };
  const say = () => {
    const p = get();
    remove.hidden = !p;
    info.textContent = p
      ? `Gewählt: bei ${nearestPlace(...toGridPos(p.lon, p.lat)).place.name}, ${num(p.lat, 1)}° Nord, ${num(p.lon, 1)}° Ost. Gespeichert wird nur dieses Feld von etwa 10 km, nie der genaue Punkt.`
      : 'Tippe auf die Karte, um das Feld zu wählen, in dem die Station ungefähr steht.';
  };

  const map = createMap(mapBox, {
    label: 'Karte zur Wahl des ungefähren Standorts. Pfeiltasten verschieben, Plus und Minus zoomen.',
    lines: (ctx, m) => {
      const px = 1 / m.scale, p = get();
      if (hover) { cellPath(ctx, hover.lat, hover.lon); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2 * px; ctx.stroke(); }
      if (p) { cellPath(ctx, p.lat, p.lon); ctx.fillStyle = 'rgba(255,207,92,0.4)'; ctx.fill(); ctx.strokeStyle = '#ffcf5c'; ctx.lineWidth = 1.6 * px; ctx.stroke(); }
    },
    over: (ctx, m) => {
      const p = get();
      if (!p) return;
      const [x, y] = m.toScreen(...toGridPos(p.lon, p.lat));
      ctx.fillStyle = '#ffcf5c'; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.283); ctx.fill();
    },
    onHover: (g) => {
      const next = g ? (([lon, lat]) => ({ lat: snap(lat), lon: snap(lon) }))(toLonLat(g[0], g[1])) : null;
      if (JSON.stringify(next) !== JSON.stringify(hover)) { hover = next; map.draw(); }
    },
    onPick: (gx, gy) => { const [lon, lat] = toLonLat(gx, gy); set({ lat: snap(lat), lon: snap(lon) }); say(); map.draw(); },
  });

  const p = get();
  if (p) { const [x, y] = toGridPos(p.lon, p.lat); map.setHome({ x: x - 150, y: y - 150, w: 300 }); }
  say();
}
