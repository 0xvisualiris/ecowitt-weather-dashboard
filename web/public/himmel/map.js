// A map of Germany on DWD's radar grid (900 × 900 km, one unit = 1 km), used by the rain radar
// and by the two pickers on the admin page. Draws the base map on a canvas and handles moving
// around in it: drag with the mouse, pinch with two fingers, Ctrl + wheel, the buttons, the keyboard.

import { el, getJson, clamp, canvasFont, reducedMotion, store, skyAt, mix, rgb } from './lib.js';

export const GRID = 900;

// ---------- Projection: longitude/latitude ↔ grid position (polar stereographic, as DWD defines it) ----------

const R = 6370.040, PHI0 = 60 * Math.PI / 180, LAM0 = 10 * Math.PI / 180, X0 = -523.4621, Y0 = -3758.645;

export function toGridPos(lon, lat) {
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  const m = (1 + Math.sin(PHI0)) / (1 + Math.sin(phi));
  return [R * m * Math.cos(phi) * Math.sin(lam - LAM0) - X0, Y0 + R * m * Math.cos(phi) * Math.cos(lam - LAM0)];
}

export function toLonLat(col, row) {
  const x = col + X0, y = Y0 - row, rho = Math.hypot(x, y);
  const phi = Math.PI / 2 - 2 * Math.atan(rho / (R * (1 + Math.sin(PHI0))));
  return [(LAM0 + Math.atan2(x, -y)) * 180 / Math.PI, phi * 180 / Math.PI];
}

// Places for orientation, in three tiers: the first shows always, the others as you zoom in.
const CITIES = [
  ['Berlin', 13.405, 52.52, 1], ['Hamburg', 9.993, 53.551, 1], ['München', 11.582, 48.135, 1], ['Köln', 6.96, 50.938, 1], ['Frankfurt', 8.682, 50.111, 1],
  ['Stuttgart', 9.183, 48.776, 1], ['Leipzig', 12.373, 51.34, 1], ['Hannover', 9.732, 52.376, 1], ['Nürnberg', 11.077, 49.452, 1],
  ['Bremen', 8.807, 53.079, 2], ['Dresden', 13.737, 51.05, 2], ['Dortmund', 7.466, 51.514, 2], ['Kiel', 10.123, 54.323, 2], ['Rostock', 12.099, 54.092, 2],
  ['Erfurt', 11.029, 50.985, 2], ['Kassel', 9.48, 51.313, 2], ['Saarbrücken', 6.997, 49.24, 2], ['Freiburg', 7.842, 47.999, 2], ['Münster', 7.626, 51.96, 2],
  ['Magdeburg', 11.628, 52.121, 2], ['Würzburg', 9.953, 49.791, 2], ['Regensburg', 12.102, 49.013, 2], ['Karlsruhe', 8.404, 49.007, 2],
  ['Amsterdam', 4.9, 52.372, 2], ['Brüssel', 4.352, 50.847, 2], ['Zürich', 8.541, 47.377, 2], ['Prag', 14.438, 50.076, 2], ['Straßburg', 7.752, 48.573, 2], ['Stettin', 14.553, 53.428, 2],
  ['Düsseldorf', 6.773, 51.228, 3], ['Essen', 7.012, 51.455, 3], ['Bielefeld', 8.532, 52.021, 3], ['Osnabrück', 8.047, 52.28, 3], ['Oldenburg', 8.214, 53.144, 3],
  ['Lübeck', 10.687, 53.866, 3], ['Flensburg', 9.437, 54.794, 3], ['Schwerin', 11.415, 53.629, 3], ['Potsdam', 13.064, 52.39, 3], ['Cottbus', 14.334, 51.757, 3],
  ['Chemnitz', 12.921, 50.833, 3], ['Halle', 11.97, 51.483, 3], ['Göttingen', 9.935, 51.533, 3], ['Braunschweig', 10.522, 52.269, 3], ['Bonn', 7.099, 50.735, 3],
  ['Aachen', 6.084, 50.776, 3], ['Koblenz', 7.594, 50.357, 3], ['Trier', 6.641, 49.757, 3], ['Mainz', 8.247, 50.0, 3], ['Mannheim', 8.466, 49.488, 3],
  ['Heilbronn', 9.218, 49.142, 3], ['Ulm', 9.993, 48.401, 3], ['Augsburg', 10.898, 48.371, 3], ['Ingolstadt', 11.426, 48.766, 3], ['Passau', 13.432, 48.567, 3],
  ['Bayreuth', 11.578, 49.946, 3], ['Konstanz', 9.175, 47.678, 3], ['Kempten', 10.317, 47.726, 3], ['Rosenheim', 12.128, 47.856, 3], ['Fulda', 9.675, 50.555, 3],
  ['Siegen', 8.024, 50.875, 3], ['Paderborn', 8.754, 51.719, 3], ['Bremerhaven', 8.577, 53.55, 3], ['Stralsund', 13.09, 54.309, 3], ['Luxemburg', 6.13, 49.611, 3],
  ['Basel', 7.588, 47.56, 3], ['Salzburg', 13.045, 47.811, 3], ['Innsbruck', 11.394, 47.269, 3], ['Lüttich', 5.571, 50.633, 3],
];
export const PLACES = CITIES.map(([name, lon, lat, tier]) => ({ name, tier, px: toGridPos(lon, lat) }))
  .filter((p) => p.px[0] > 8 && p.px[0] < GRID - 8 && p.px[1] > 8 && p.px[1] < GRID - 8);

export function nearestPlace(gx, gy) {
  let best = PLACES[0], km = Infinity;
  for (const p of PLACES) { const d = Math.hypot(p.px[0] - gx, p.px[1] - gy); if (d < km) { km = d; best = p; } }
  return { place: best, km };
}

// The base map (Natural Earth, baked by the dashboard into grid coordinates) is loaded once.
let basePromise = null;
const baseMap = () => (basePromise ??= getJson('/radar-map.json').then((j) => Object.fromEntries(
  ['land', 'germany', 'states', 'rivers', 'streams', 'lakes'].map((k) => [k, new Path2D(j[k])]))));

// ---------- The map ----------
// options: home {x, y, w} · under(ctx, map) and lines(ctx, map) draw in grid coordinates (below and above the borders) ·
// over(ctx, map) draws in screen pixels on top · onPick(gx, gy) · onHover([gx, gy] | null)

export function createMap(container, options = {}) {
  const canvas = el('canvas', { tabIndex: 0, role: 'application', 'aria-label': options.label ?? 'Karte von Deutschland. Pfeiltasten verschieben, Plus und Minus zoomen.' });
  const hint = el('p.map-hint', { 'aria-hidden': 'true' });
  const frame = el('div.map-frame', {}, canvas, hint,
    el('div.map-zoom', {},
      el('button', { type: 'button', 'aria-label': 'Hineinzoomen', onclick: () => zoomBy(0.6) }, '+'),
      el('button', { type: 'button', 'aria-label': 'Herauszoomen', onclick: () => zoomBy(1 / 0.6) }, '−')));
  container.append(frame);

  let home = options.home ?? { x: 0, y: 0, w: GRID };
  let view = { ...home }, W = 0, H = 0, dpr = 1, base = null, raf = 0, anim = 0, hintTimer = 0;
  const map = {
    canvas, frame,
    get view() { return view; },
    get scale() { return W / view.w; },                      // screen pixels per kilometre
    toGrid: (clientX, clientY) => { const r = canvas.getBoundingClientRect(); return [view.x + (clientX - r.left) / map.scale, view.y + (clientY - r.top) / map.scale]; },
    toScreen: (gx, gy) => [(gx - view.x) * map.scale, (gy - view.y) * map.scale],
    draw: () => { if (!raf) raf = requestAnimationFrame(paint); },
    setHome: (h, jump = true) => { home = h; if (jump) { view = { ...h }; limit(); map.draw(); } },
    reset: () => flyTo(home),
    flyTo: (v) => flyTo(v),
    get zoomed() { return Math.abs(view.w - home.w) > 1 || Math.abs(view.x - home.x) > 1 || Math.abs(view.y - home.y) > 1; },
  };

  function limit() {
    view.w = clamp(view.w, 40, GRID);
    const h = view.w * H / (W || 1);
    view.x = clamp(view.x, -view.w * 0.25, GRID - view.w * 0.75);
    view.y = clamp(view.y, -h * 0.25, GRID - h * 0.75);
  }

  function paint() {
    raf = 0;
    if (!W) return;
    const ctx = canvas.getContext('2d'), s = map.scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The same sky and land as the rest of the site: water is the sky of this hour, land is the dark ground
    // with a lit rim, and the neighbouring countries sit a little hazier in the distance.
    const cur = store.cur, sky = skyAt(Date.now(), cur?.astro, cur?.forecast?.days?.[0]?.conditionCode);
    const water = ctx.createLinearGradient(0, 0, 0, H);
    water.addColorStop(0, rgb(sky.zenith)); water.addColorStop(1, rgb(mix(sky.zenith, sky.horizon, 0.7)));
    const rim = mix(sky.horizon, [255, 255, 255], 0.4), inland = rgb(mix(sky.zenith, sky.horizon, 0.45));
    ctx.fillStyle = water; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.scale(s, s); ctx.translate(-view.x, -view.y);
    const px = 1 / s;   // one screen pixel, in kilometres
    if (base) {
      // Germany is a hole in the land outline, so it is filled on its own, a little lighter than its neighbours.
      ctx.fillStyle = rgb(mix(sky.ground, sky.horizon, 0.3)); ctx.fill(base.land);
      ctx.fillStyle = rgb(sky.ground); ctx.fill(base.germany);
      ctx.fillStyle = inland; ctx.fill(base.lakes);
    }
    options.under?.(ctx, map);
    if (base) {
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.55;
      if (s > 2.2) { ctx.strokeStyle = inland; ctx.lineWidth = 0.8 * px; ctx.stroke(base.streams); }
      ctx.strokeStyle = inland; ctx.lineWidth = 1.1 * px; ctx.stroke(base.rivers);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = rgb(rim, 0.22); ctx.lineWidth = 0.8 * px; ctx.setLineDash([3 * px, 4 * px]); ctx.stroke(base.states); ctx.setLineDash([]);
      ctx.strokeStyle = rgb(rim, 0.9); ctx.lineWidth = 1.6 * px; ctx.stroke(base.germany);
    }
    options.lines?.(ctx, map);
    ctx.restore();

    // Place names keep their size on screen whatever the zoom.
    const zoom = GRID / view.w, tiers = zoom >= 3.2 ? 3 : zoom >= 1.7 ? 2 : 1;
    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const p of PLACES) {
      if (p.tier > tiers) continue;
      const [x, y] = map.toScreen(p.px[0], p.px[1]);
      if (x < -40 || y < -10 || x > W + 10 || y > H + 10) continue;
      ctx.fillStyle = '#f3f6f2'; ctx.beginPath(); ctx.arc(x, y, 2.4, 0, 6.283); ctx.fill();
      ctx.font = canvasFont(p.tier === 1 ? 13 : 12, p.tier === 1 ? 600 : 500);
      ctx.strokeStyle = rgb(mix(sky.ground, [0, 0, 0], 0.35), 0.85); ctx.lineWidth = 3; ctx.strokeText(p.name, x + 7, y + 0.5);
      ctx.fillText(p.name, x + 7, y + 0.5);
    }
    options.over?.(ctx, map);
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    limit(); paint();
  }

  function zoomAt(factor, sx = W / 2, sy = H / 2) {
    const gx = view.x + sx / map.scale, gy = view.y + sy / map.scale;
    const w = clamp(view.w * factor, 40, GRID), k = w / view.w;
    view = { x: gx - (gx - view.x) * k, y: gy - (gy - view.y) * k, w };
    limit(); map.draw(); options.onMove?.(map);
  }

  function flyTo(target) {
    cancelAnimationFrame(anim);
    const from = { ...view }, start = performance.now(), ms = reducedMotion.matches ? 0 : 320;
    const tick = (now) => {
      const p = ms ? Math.min(1, (now - start) / ms) : 1, e = 1 - (1 - p) ** 3;
      view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, w: from.w + (target.w - from.w) * e };
      limit(); paint(); options.onMove?.(map);
      if (p < 1) anim = requestAnimationFrame(tick);
    };
    anim = requestAnimationFrame(tick);
  }

  function zoomBy(factor) {
    const w = clamp(view.w * factor, 40, GRID), k = w / view.w, cx = view.x + view.w / 2, cy = view.y + view.w * H / W / 2;
    flyTo({ x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, w });
  }

  function say(text) {
    hint.textContent = text; hint.classList.add('on');
    clearTimeout(hintTimer); hintTimer = setTimeout(() => hint.classList.remove('on'), 1600);
  }

  // ----- Pointer: one mouse button drags, two fingers pinch and drag, one finger is left to scroll the page -----
  const pointers = new Map();
  let drag = null, pinch = null, moved = false, velocity = [0, 0], lastMove = 0, glide = 0;

  canvas.addEventListener('pointerdown', (e) => {
    cancelAnimationFrame(glide); cancelAnimationFrame(anim);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    moved = false;
    if (e.pointerType === 'mouse') { if (e.button !== 0) return; canvas.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }; velocity = [0, 0]; }
    else if (pointers.size === 2) {
      for (const id of pointers.keys()) canvas.setPointerCapture(id);
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2 };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()], r = canvas.getBoundingClientRect();
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      view.x -= (cx - pinch.cx) / map.scale; view.y -= (cy - pinch.cy) / map.scale;
      zoomAt(pinch.d / (d || 1), cx - r.left, cy - r.top);
      pinch = { d, cx, cy }; moved = true;
      return;
    }
    if (drag) {
      if (!moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;   // still a click
      moved = true;
      const now = performance.now(), dt = Math.max(now - lastMove, 1), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      velocity = [dx / dt, dy / dt]; lastMove = now;
      view.x -= dx / map.scale; view.y -= dy / map.scale;
      drag.x = e.clientX; drag.y = e.clientY;
      limit(); map.draw(); options.onMove?.(map);
      return;
    }
    if (e.pointerType === 'mouse') options.onHover?.(map.toGrid(e.clientX, e.clientY));
  });

  const end = (e) => {
    const wasDrag = drag, hadTwo = pointers.size === 2;
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) pinch = null;
    if (e.type === 'pointerup' && !moved && !hadTwo) options.onPick?.(...map.toGrid(e.clientX, e.clientY));
    if (wasDrag && e.pointerType === 'mouse') {
      drag = null;
      // Let go while moving: the map glides on and slows down.
      if (moved && performance.now() - lastMove < 80 && !reducedMotion.matches) {
        let [vx, vy] = velocity, last = performance.now();
        const step = (now) => {
          const dt = now - last; last = now;
          view.x -= vx * dt / map.scale; view.y -= vy * dt / map.scale;
          vx *= 0.994 ** dt; vy *= 0.994 ** dt;
          limit(); paint(); options.onMove?.(map);
          if (Math.hypot(vx, vy) > 0.02) glide = requestAnimationFrame(step);
        };
        glide = requestAnimationFrame(step);
      }
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') options.onHover?.(null); });

  // A plain wheel scrolls the page, so the map never traps it; with Ctrl or ⌘ it zooms.
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) { say(`${/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Strg'} + Scrollen zoomt die Karte`); return; }
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAt(Math.exp(e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  canvas.addEventListener('touchmove', (e) => { if (e.touches.length === 1) say('Mit zwei Fingern verschieben und zoomen'); }, { passive: true });

  canvas.addEventListener('keydown', (e) => {
    const step = view.w * 0.15;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (move) { e.preventDefault(); flyTo({ x: view.x + move[0], y: view.y + move[1], w: view.w }); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(0.6); }
    else if (e.key === '-') { e.preventDefault(); zoomBy(1 / 0.6); }
    else if (e.key === '0' || e.key === 'Escape') { e.preventDefault(); flyTo(home); }
  });

  new ResizeObserver(resize).observe(canvas);
  baseMap().then((b) => { base = b; map.draw(); }).catch(() => say('Die Karte konnte nicht geladen werden'));
  document.fonts?.ready.then(() => map.draw());
  window.addEventListener('station', () => map.draw());   // the sky may have moved on
  resize();
  return map;
}
