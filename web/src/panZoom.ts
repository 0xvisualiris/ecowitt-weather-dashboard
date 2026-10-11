// Pan/zoom controller shared by the rain radar and the DWD station map —
// hand-rolled like spring.ts, no gesture library. Follows the same Apple
// "Designing Fluid Interfaces" rules as the segmented controls:
//   - 1:1 tracking from where the pointer grabbed, after a small hysteresis
//     so a click on something inside the surface is still a click
//   - two-finger pinch zooms around the midpoint between the fingers
//   - past an edge the content rubber-bands instead of stopping dead
//   - on release the momentum is projected forward and a spring carries the
//     view there, starting at the finger's velocity; grabbing it again
//     mid-flight just continues from wherever it is on screen
// The view never goes through React state: `apply` writes it straight to the
// DOM, so a drag doesn't re-render the component on every pointer move.
import { createSpring, prefersReducedMotion } from './spring';

// Visible window into the content, in content units. Height follows from the
// content's aspect ratio.
export type View = { x: number; y: number; w: number };

type Pt = { x: number; y: number };
type PointerLike = { pointerId: number; clientX: number; clientY: number; pointerType: string };

// The further past the bound, the less the content follows.
export function rubberband(overshoot: number, dimension: number, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

// Where a flick at `velocity` px/s comes to rest (scroll-style exponential decay).
export function project(velocity: number, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

export function createPanZoom(o: { contentW: number; contentH: number; minW: number; apply: (v: View) => void }) {
  const aspect = o.contentH / o.contentW;
  let el: Element | null = null;
  let raw: View = { x: 0, y: 0, w: o.contentW }; // where the gesture has put the view, possibly out of bounds
  let shown: View = raw; // what is on screen (raw with rubber-banding applied)
  const pointers = new Map<number, Pt>();
  let start: Pt | null = null;
  let dragging = false;
  let moved = false;
  let history: { t: number; x: number; y: number }[] = [];
  let pinch: { mx: number; my: number; d: number } | null = null;
  let anim: (v: Record<string, number>) => void = () => {};

  const spring = createSpring(v => anim(v), { damping: 1, response: 0.4 });

  const rect = () => el?.getBoundingClientRect() ?? { left: 0, top: 0, width: 1, height: 1 };
  const clampW = (w: number) => Math.max(o.minW, Math.min(o.contentW, w));
  const clamp = (v: View): View => {
    const w = clampW(v.w);
    return { x: Math.max(0, Math.min(o.contentW - w, v.x)), y: Math.max(0, Math.min(o.contentH - w * aspect, v.y)), w };
  };
  const band = (value: number, max: number, perPx: number, size: number) => {
    if (value < 0) return -rubberband(-value / perPx, size) * perPx;
    if (value > max) return max + rubberband((value - max) / perPx, size) * perPx;
    return value;
  };
  const show = (v: View) => { shown = v; o.apply(v); };
  const render = () => {
    const r = rect(), k = raw.w / r.width;
    show({ x: band(raw.x, o.contentW - raw.w, k, r.width), y: band(raw.y, o.contentH - raw.w * aspect, k, r.height), w: raw.w });
  };

  const zoomAround = (factor: number, cx: number, cy: number) => {
    const r = rect();
    const fx = (cx - r.left) / r.width, fy = (cy - r.top) / r.height;
    const w = clampW(raw.w * factor);
    raw = { x: raw.x + fx * (raw.w - w), y: raw.y + fy * (raw.w - w) * aspect, w };
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    spring.cancel();
    zoomAround(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    raw = clamp(raw);
    render();
  };

  const pinchMetrics = () => {
    const [a, b] = [...pointers.values()];
    return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };
  const capture = () => { for (const id of pointers.keys()) { try { el?.setPointerCapture(id); } catch { /* pointer already gone */ } } };

  const release = () => {
    const now = performance.now();
    const recent = history.filter(h => now - h.t < 100);
    let vx = 0, vy = 0;
    if (recent.length > 1 && now - recent[recent.length - 1].t < 60) {
      const a = recent[0], b = recent[recent.length - 1], dt = (b.t - a.t) / 1000;
      if (dt > 0.01) { vx = (b.x - a.x) / dt; vy = (b.y - a.y) / dt; }
    }
    history = [];
    const base = shown, k = base.w / rect().width;
    if (prefersReducedMotion()) { raw = clamp(base); show(raw); return; }
    const target = clamp({ x: base.x - project(vx) * k, y: base.y - project(vy) * k, w: base.w });
    // Spring in screen pixels, so its settle threshold means the same at every zoom level.
    anim = v => { raw = { x: base.x + v.x * k, y: base.y + v.y * k, w: base.w }; show(raw); };
    spring.jumpTo({ x: 0, y: 0 });
    spring.setTarget({ x: (target.x - base.x) / k, y: (target.y - base.y) / k }, { x: -vx, y: -vy });
  };

  return {
    // Ref callback for the surface element. Wheel needs a non-passive native
    // listener: React's onWheel is passive, so preventDefault() there can't
    // stop the page from scrolling while zooming.
    attach(node: Element | null) {
      el?.removeEventListener('wheel', onWheel as EventListener);
      el = node;
      el?.addEventListener('wheel', onWheel as EventListener, { passive: false });
      if (!el) { spring.cancel(); pointers.clear(); }
    },
    get: () => shown,
    // True if the pointer interaction that just ended was a drag/pinch, for
    // ignoring the click that follows it.
    wasDrag: () => moved,
    set(v: View, animate = false) {
      spring.cancel();
      const from = shown, to = clamp(v);
      if (!animate || prefersReducedMotion()) { raw = to; show(to); return; }
      anim = s => {
        const p = s.p / 1000;
        raw = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p, w: from.w + (to.w - from.w) * p };
        show(raw);
      };
      spring.jumpTo({ p: 0 });
      spring.setTarget({ p: 1000 });
    },
    onPointerDown(e: PointerLike) {
      spring.cancel(); // grab it mid-flight
      if (e.pointerType === 'mouse') pointers.clear();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        start = { x: e.clientX, y: e.clientY }; dragging = false; moved = false; history = [];
      } else if (pointers.size === 2) {
        dragging = true; moved = true; capture(); pinch = pinchMetrics();
      }
    },
    onPointerMove(e: PointerLike) {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      if (pointers.size === 1) {
        if (!dragging) {
          if (!start || Math.hypot(cur.x - start.x, cur.y - start.y) < (e.pointerType === 'mouse' ? 3 : 8)) return;
          dragging = true; moved = true; capture();
          pointers.set(e.pointerId, cur); // track from here, so committing to the drag doesn't jump
          return;
        }
        pointers.set(e.pointerId, cur);
        const k = raw.w / rect().width;
        raw = { x: raw.x - (cur.x - prev.x) * k, y: raw.y - (cur.y - prev.y) * k, w: raw.w };
        history.push({ t: performance.now(), x: cur.x, y: cur.y });
        if (history.length > 8) history.shift();
        render();
      } else if (pointers.size === 2 && pinch) {
        pointers.set(e.pointerId, cur);
        const next = pinchMetrics();
        zoomAround(pinch.d / next.d, pinch.mx, pinch.my);
        const k = raw.w / rect().width;
        raw = { x: raw.x - (next.mx - pinch.mx) * k, y: raw.y - (next.my - pinch.my) * k, w: raw.w };
        pinch = next;
        render();
      }
    },
    onPointerUp(e: PointerLike) {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size === 1) { pinch = null; history = []; }
      if (pointers.size === 0) {
        pinch = null;
        if (dragging) release();
        dragging = false;
      }
    },
  };
}
