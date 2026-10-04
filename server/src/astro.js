import SunCalc from 'suncalc';

// Stable English slugs – a shared, cached response can't bake in a
// visitor's language, so translation happens client-side via i18n.ts's
// moon.* keys.
function moonName(phase) {
  if (phase < 0.03 || phase > 0.97) return 'new-moon';
  if (Math.abs(phase - 0.5) < 0.03) return 'full-moon';
  if (Math.abs(phase - 0.25) < 0.03) return 'first-quarter';
  if (Math.abs(phase - 0.75) < 0.03) return 'last-quarter';
  return phase < 0.5 ? 'waxing' : 'waning';
}

// Coordinates stay on the server – only derived times and fractions are returned.
export function astro(lat, lon, now = Date.now()) {
  if (lat == null || lon == null) return null;
  const d = new Date(now);
  const noon = new Date(d); noon.setHours(12, 0, 0, 0);
  const t = SunCalc.getTimes(noon, lat, lon);
  const rise = t.sunrise?.getTime(), set = t.sunset?.getTime();
  const valid = Number.isFinite(rise) && Number.isFinite(set);
  const moon = SunCalc.getMoonIllumination(d);
  return {
    sunrise: valid ? rise : null,
    sunset: valid ? set : null,
    dayLengthMin: valid ? Math.round((set - rise) / 60000) : null,
    sunFraction: valid && now >= rise && now <= set ? (now - rise) / (set - rise) : null,
    moon: { phase: moon.phase, illumination: Math.round(moon.fraction * 100), name: moonName(moon.phase) },
  };
}
