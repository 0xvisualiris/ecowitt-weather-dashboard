// Hand-rolled spring stepper — no animation library, same dependency-light
// convention as the rest of this app (hand-drawn charts, hand-rolled TOTP,
// RADOLAN decoding, …). Parameterized the way Apple's "Designing Fluid
// Interfaces" (WWDC 2018) talk does — damping ratio + response, not a raw
// mass/stiffness/damping triplet:
//   damping  — 1 = critically damped (no overshoot), <1 = bouncier
//   response — seconds to reach the target; lower = snappier
// A spring keeps running (and keeps its state) across retargets, so
// redirecting it mid-flight blends the existing velocity into the new target
// instead of cutting it off — the "no brick wall on reversal" rule.
export type SpringValues = Record<string, number>;

export function createSpring(apply: (v: SpringValues) => void, opts: { damping?: number; response?: number } = {}) {
  const damping = opts.damping ?? 1;
  const response = opts.response ?? 0.3;
  const omega = (2 * Math.PI) / response;
  const k = omega * omega;
  const c = 2 * damping * omega;

  let pos: SpringValues = {};
  let vel: SpringValues = {};
  let target: SpringValues = {};
  let raf = 0;
  let last = 0;

  const settlePos = 0.1;
  const settleVel = 0.1;

  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    let moving = false;
    for (const key of Object.keys(target)) {
      const t = target[key];
      let p = pos[key] ?? t;
      let v = vel[key] ?? 0;
      if (Math.abs(p - t) > settlePos || Math.abs(v) > settleVel) {
        const accel = -k * (p - t) - c * v;
        v += accel * dt;
        p += v * dt;
        moving = true;
      } else {
        p = t; v = 0;
      }
      pos[key] = p; vel[key] = v;
    }
    apply(pos);
    if (moving) raf = requestAnimationFrame(tick);
    else raf = 0;
  };

  return {
    // Snap instantly to a value (no animation) — used for the initial
    // position and for prefers-reduced-motion.
    jumpTo(v: SpringValues) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      pos = { ...v }; vel = {}; target = { ...v };
      apply(pos);
    },
    // Retarget — reads the live (current) position/velocity as the start,
    // never the old target, so an in-flight spring redirects smoothly.
    setTarget(v: SpringValues) {
      target = { ...v };
      for (const key of Object.keys(v)) {
        if (!(key in pos)) { pos[key] = v[key]; vel[key] = 0; }
      }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    },
    cancel() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
    },
  };
}

export function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
