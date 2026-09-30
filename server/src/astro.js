import SunCalc from 'suncalc';

function moonName(phase) {
  if (phase < 0.03 || phase > 0.97) return 'Neumond';
  if (Math.abs(phase - 0.5) < 0.03) return 'Vollmond';
  if (Math.abs(phase - 0.25) < 0.03) return 'Erstes Viertel';
  if (Math.abs(phase - 0.75) < 0.03) return 'Letztes Viertel';
  return phase < 0.5 ? 'zunehmend' : 'abnehmend';
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
