import type { ReactNode } from 'react';
import { go } from '../App';
import { Spark } from '../components/Chart';
import {
  type AppConfig, type Current, type MetricKey, beaufort, compass, convFor, fmt, fmtC, hhmm, trendText, useUnits, uvLabel, dateFmt, dayKey, weekday,
} from '../lib';

const TICKS = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * 2 * Math.PI, r1 = i % 4 ? 47 : 44;
  return `M${(60 + r1 * Math.sin(a)).toFixed(1)},${(60 - r1 * Math.cos(a)).toFixed(1)}L${(60 + 52 * Math.sin(a)).toFixed(1)},${(60 - 52 * Math.cos(a)).toFixed(1)}`;
}).join('');

function Card({ metric, title, right, children, lg }: { metric?: MetricKey; title: string; right?: ReactNode; children: ReactNode; lg?: boolean }) {
  const cls = 'card' + (lg ? ' lg' : '') + (metric ? ' link' : '');
  const head = <div className="eyebrow"><span>{title}</span><span>{right}</span></div>;
  if (!metric) return <section className={cls}>{head}{children}</section>;
  return (
    <section
      className={cls}
      role="link"
      tabIndex={0}
      aria-label={`${title} – Details öffnen`}
      onClick={() => go({ screen: 'detail', metric })}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go({ screen: 'detail', metric }); } }}
    >
      {head}{children}
    </section>
  );
}

const Mini = ({ items }: { items: [string, string][] }) => (
  <div className="mini" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
    {items.map(([k, v]) => <div key={k}><span className="k">{k}</span><span className="v">{v}</span></div>)}
  </div>
);

export function Dashboard({ cfg, cur, error }: { cfg: AppConfig; cur: Current | null; error: string | null }) {
  const u = useUnits();
  if (!cur) return <div className="center-msg">{error ? `Keine Daten: ${error}` : 'Lade aktuelle Werte …'}</div>;

  const v = cur.values;
  const has = (k: string) => cfg.sensors.includes(k);
  const T = convFor('temp', u), Wd = convFor('wind', u), P = convFor('press', u), R = convFor('rain', u), RR = convFor('rate', u);
  const deg = (x: number | null | undefined, d = 1) => (x == null ? '—' : fmt(T.f(x), d) + '°');
  const deviceFor = (m: string) => cfg.station.devices.find(d => d.metrics.includes(m))?.short ?? '';

  const alert = cur.alerts.find(a => a.level === 'warning') ?? cur.alerts[0];

  // forecast bars
  const fc = cur.forecast?.days ?? [];
  const los = fc.map(f => f.lo).filter((x): x is number => x != null), his = fc.map(f => f.hi).filter((x): x is number => x != null);
  const fLo = Math.min(...los, ...his), fHi = Math.max(...los, ...his), fRg = fHi - fLo || 1;

  const wind = v.wind_speed, gust = v.wind_gust, dir = v.wind_direction;
  const trend = trendText(cur.pressureTrend, P);
  const uv = v.uv_index;
  const astro = cur.astro;
  const sunAng = astro?.sunFraction != null ? Math.PI * (1 - astro.sunFraction) : null;
  const dayLen = astro?.dayLengthMin != null ? `${Math.floor(astro.dayLengthMin / 60)} h ${astro.dayLengthMin % 60} min` : '';

  const rainTotals: [string, string][] = ([['Ereignis', cur.rain.event], ['Woche', cur.rain.week], ['Monat', cur.rain.month], ['Jahr', cur.rain.year]] as [string, number | null][])
    .filter(([, x]) => x != null).map(([k, x]) => [k, fmt(R.f(x!), R.d)]);

  return (
    <div className="stack">
      {alert && (
        <div className={'banner' + (alert.level === 'info' ? ' info' : '')} role="alert">
          <div className="stack" style={{ gap: 2 }}>
            <div className="t">{alert.banner}</div>
            {alert.message && <div className="m">{alert.message}</div>}
          </div>
          <button onClick={() => go({ screen: 'alerts' })}>Warnungen</button>
        </div>
      )}

      <div className="grid-hero">
        {has('temperature') && (
          <Card metric="temp" title="Außentemperatur" right={deviceFor('temp')} lg>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '8px 28px' }}>
              <div className="hero-num">{fmt(v.temperature != null ? T.f(v.temperature) : null, 1)}<span className="u">{T.unit}</span></div>
              <div className="stack" style={{ gap: 6, fontSize: 15, color: 'var(--text-2)', paddingBottom: 6 }}>
                {has('feels_like') && <div>Gefühlt <b className="v">{deg(v.feels_like)}</b></div>}
                {has('dew_point') && <div>Taupunkt <b className="v">{deg(v.dew_point)}</b></div>}
                {cur.today.temp && (
                  <div>Heute <b style={{ color: 'var(--blue)', fontWeight: 500 }}>{deg(cur.today.temp.min)}</b> / <b style={{ color: 'var(--amber)', fontWeight: 500 }}>{deg(cur.today.temp.max)}</b></div>
                )}
              </div>
            </div>
            {cur.spark.temp && (
              <div className="stack" style={{ gap: 6 }}>
                <Spark values={cur.spark.temp} height={64} color="var(--amber)" kind="line" strokeWidth={2} />
                <div className="axis"><span>vor 24 h</span><span>jetzt</span></div>
              </div>
            )}
          </Card>
        )}

        {fc.length > 0 && (
          <Card title="Vorhersage" right={cur.forecast!.source} lg>
            <div className="stack" style={{ gap: 0, marginTop: -4 }}>
              {fc.map((f, i) => (
                <div className="fc-row" key={f.date}>
                  <span style={{ fontWeight: 500 }}>{dayKey(f.date) === dayKey(Date.now()) || (i === 0 && f.date < Date.now()) ? 'Heute' : weekday(f.date)}</span>
                  <span className="cond">{f.condition}</span>
                  <span className="pop">{f.pop != null ? `${f.pop} %` : ''}</span>
                  <span className="lo">{deg(f.lo, 0)}</span>
                  <div className="fc-bar">
                    {f.lo != null && f.hi != null && <div style={{ left: `${((f.lo - fLo) / fRg) * 100}%`, width: `${Math.max(2, ((f.hi - f.lo) / fRg) * 100)}%` }} />}
                  </div>
                  <span style={{ fontWeight: 500 }}>{deg(f.hi, 0)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <div className="grid-cards">
        {has('wind_speed') && (
          <Card metric="wind" title="Wind" right={wind != null ? `Bft ${beaufort(wind)}` : ''}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <svg viewBox="0 0 120 120" style={{ width: 112, height: 112, flexShrink: 0 }} aria-hidden="true">
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
                <path d={TICKS} stroke="oklch(0.45 0.01 250)" strokeWidth="1" />
                {([['N', 60, 20, 'var(--muted)'], ['O', 103, 64, 'var(--faint)'], ['S', 60, 107, 'var(--faint)'], ['W', 17, 64, 'var(--faint)']] as const).map(([t, x, y, c]) => (
                  <text key={t} x={x} y={y} textAnchor="middle" fontSize="10" fill={c} fontFamily="var(--mono)">{t}</text>
                ))}
                {dir != null && (
                  <g transform={`rotate(${dir} 60 60)`}><polygon points="60,14 66,60 60,54 54,60" fill="var(--blue)" /></g>
                )}
                <circle cx="60" cy="60" r="3" fill="var(--text)" />
              </svg>
              <div className="stack" style={{ gap: 6 }}>
                <div className="num">{fmt(wind != null ? Wd.f(wind) : null, Wd.d)} <span className="u">{Wd.unit}</span></div>
                {has('wind_gust') && <div className="kv">Böe <b>{fmtC(gust, Wd)}</b></div>}
                {has('wind_direction') && <div className="kv">aus <b>{compass(dir)} {dir != null ? Math.round(dir) + '°' : ''}</b></div>}
                {cur.today.gustMax != null && <div className="note">Max. Böe heute {fmtC(cur.today.gustMax, Wd)}</div>}
              </div>
            </div>
          </Card>
        )}

        {has('rain_daily') && (
          <Card metric="rain" title="Niederschlag" right={has('rain_rate') ? fmtC(cur.rain.rate, RR) : ''}>
            <div className="num">{fmt(cur.rain.day != null ? R.f(cur.rain.day) : null, R.d)} <span className="u">{R.unit} heute</span></div>
            {cur.spark.rain && <Spark values={cur.spark.rain} height={40} color="var(--blue)" kind="bars" />}
            {rainTotals.length > 0 && <Mini items={rainTotals} />}
          </Card>
        )}

        {(has('lightning_distance') || has('lightning_count')) && (
          <Card metric="light" title="Blitze" right={deviceFor('light')}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
              <div className="num">{v.lightning_distance != null ? fmt(v.lightning_distance, 0) : '—'} <span className="u">km</span></div>
              <div className="kv" style={{ paddingBottom: 3 }}>
                {v.lightning_time != null && <>letzter {dayKey(v.lightning_time) === dayKey(Date.now()) ? 'um' : 'am'} <b>{dayKey(v.lightning_time) === dayKey(Date.now()) ? hhmm(v.lightning_time) : dateFmt(v.lightning_time, { day: '2-digit', month: '2-digit' })}</b></>}
                {v.lightning_time != null && v.lightning_count != null && ' · '}
                {v.lightning_count != null && <><b>{fmt(v.lightning_count, 0)}</b> heute</>}
              </div>
            </div>
            {cur.spark.light && (
              <div className="stack" style={{ gap: 6 }}>
                <Spark values={cur.spark.light} height={40} color="var(--amber)" kind="bars" />
                <div className="axis"><span>Einschläge / h · 24 h</span><span>jetzt</span></div>
              </div>
            )}
          </Card>
        )}

        {has('pressure') && (
          <Card metric="press" title="Luftdruck" right="relativ">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
              <div className="num">{fmt(v.pressure != null ? P.f(v.pressure) : null, P.d)} <span className="u">{P.unit}</span></div>
              {trend && <div style={{ fontSize: 14, paddingBottom: 3, color: trend.word === 'fallend' ? 'var(--amber)' : trend.word === 'steigend' ? 'var(--blue)' : 'var(--text-2)' }}>{trend.text}</div>}
            </div>
            {cur.spark.press && <Spark values={cur.spark.press} height={44} color="var(--text)" kind="line" area={false} />}
          </Card>
        )}

        {has('humidity') && (
          <Card metric="hum" title="Luftfeuchte" right={deviceFor('hum')}>
            <div className="num">{fmt(v.humidity, 0)} <span className="u">%</span></div>
            {cur.spark.hum && <Spark values={cur.spark.hum} height={44} color="var(--blue)" kind="line" />}
            {cur.today.hum && <div className="note">Heute {fmt(cur.today.hum.min, 0)} – {fmt(cur.today.hum.max, 0)} %</div>}
          </Card>
        )}

        {(has('solar_radiation') || has('uv_index')) && (
          <Card metric={has('solar_radiation') ? 'solar' : 'uv'} title="Sonne & UV" right={deviceFor('solar')}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
              {has('solar_radiation') && <div className="num">{fmt(v.solar_radiation, 0)} <span className="u">W/m²</span></div>}
              {uv != null && <div className="kv" style={{ paddingBottom: 3 }}>UV <b>{fmt(uv, 0)} · {uvLabel(uv)}</b></div>}
            </div>
            {uv != null && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="uv-scale" aria-label={`UV-Index ${fmt(uv, 0)}`}>
                  <div style={{ background: 'oklch(0.8 0.13 150)', borderRadius: '3px 0 0 3px' }} />
                  <div style={{ background: 'oklch(0.8 0.13 100)' }} />
                  <div style={{ background: 'oklch(0.8 0.13 70)' }} />
                  <div style={{ background: 'oklch(0.8 0.13 30)' }} />
                  <div style={{ background: 'oklch(0.75 0.13 330)', borderRadius: '0 3px 3px 0' }} />
                  <div className="mark" style={{ left: `${(Math.min(uv, 12) / 12) * 100}%` }} />
                </div>
                <div className="axis"><span>0</span><span>3</span><span>6</span><span>8</span><span>11+</span></div>
              </div>
            )}
          </Card>
        )}

        {astro && (
          <Card title="Sonne & Mond" right={dayLen}>
            <svg viewBox="0 0 160 80" style={{ width: '100%', maxHeight: 92, display: 'block' }} aria-hidden="true">
              <path d="M10,74 A70,70 0 0 1 150,74" fill="none" stroke="var(--line-strong)" strokeDasharray="3 4" />
              <line x1="0" y1="74" x2="160" y2="74" stroke="var(--line-strong)" />
              {sunAng != null && <circle cx={(80 + 70 * Math.cos(sunAng)).toFixed(1)} cy={(74 - 70 * Math.sin(sunAng)).toFixed(1)} r="6" fill="var(--amber)" />}
            </svg>
            <Mini items={[
              ['Aufgang', hhmm(astro.sunrise)],
              ['Untergang', hhmm(astro.sunset)],
              ['Mond', ['zunehmend', 'abnehmend'].includes(astro.moon.name) ? `${astro.moon.name} ${astro.moon.illumination} %` : astro.moon.name],
            ]} />
          </Card>
        )}
      </div>
    </div>
  );
}
