import { go } from '../App';
import { Chart } from '../components/Chart';
import {
  type AppConfig, type Current, type Detail, type History, type MetricKey,
  METRIC_META, compass, convFor, dateFmt, dateShort, fmt, fmtC, fmtStat, hhmm, metricConv, trendText, useApi, useUnits, uvLabel,
} from '../lib';
import { axisLabels, currentValue, pointFormatter, timeLabel } from './History';

function subLine(metric: MetricKey, cur: Current | null, u: ReturnType<typeof useUnits>): string {
  if (!cur) return '';
  const v = cur.values;
  const T = convFor('temp', u), W = convFor('wind', u), R = convFor('rain', u), RR = convFor('rate', u), P = convFor('press', u);
  const parts: string[] = [];
  switch (metric) {
    case 'temp':
      if (v.feels_like != null) parts.push(`Gefühlt ${fmt(T.f(v.feels_like), 1)}°`);
      if (v.dew_point != null) parts.push(`Taupunkt ${fmt(T.f(v.dew_point), 1)}°`);
      break;
    case 'hum':
      if (cur.today.hum) parts.push(`Heute ${fmt(cur.today.hum.min, 0)} – ${fmt(cur.today.hum.max, 0)} %`);
      break;
    case 'wind':
      if (v.wind_gust != null) parts.push(`Böe ${fmtC(v.wind_gust, W)}`);
      if (v.wind_direction != null) parts.push(`aus ${compass(v.wind_direction)} ${Math.round(v.wind_direction)}°`);
      break;
    case 'rain':
      if (cur.rain.rate != null) parts.push(`Rate ${fmtC(cur.rain.rate, RR)}`);
      if (cur.rain.event != null) parts.push(`Ereignis ${fmtC(cur.rain.event, R)}`);
      break;
    case 'press': {
      const t = trendText(cur.pressureTrend, P);
      if (t) parts.push(t.text.replace(' / 3 h', ' in 3 h'));
      break;
    }
    case 'solar':
      if (v.uv_index != null) parts.push(`UV-Index ${fmt(v.uv_index, 0)} · ${uvLabel(v.uv_index)}`);
      break;
    case 'uv':
      if (v.uv_index != null) parts.push(uvLabel(v.uv_index), v.uv_index >= 3 ? 'Sonnenschutz empfohlen' : 'Schutz ab 3 empfohlen');
      break;
    case 'light':
      if (v.lightning_time != null) parts.push(`Letzter ${dateFmt(v.lightning_time, { day: '2-digit', month: '2-digit' })} um ${hhmm(v.lightning_time)}`);
      if (v.lightning_count != null) parts.push(`${fmt(v.lightning_count, 0)} Einschläge heute`);
      break;
  }
  return parts.join(' · ');
}

export function DetailScreen({ cfg, cur, metric }: { cfg: AppConfig; cur: Current | null; metric: MetricKey }) {
  const u = useUnits();
  const M = METRIC_META[metric];
  const c = metricConv(metric, u);
  const hasHistory = metric !== 'light' || cfg.sensors.includes('lightning_count');
  const { data: hist } = useApi<History>(hasHistory ? `/api/history?metric=${metric}&range=day` : null, 60000);
  const { data: det } = useApi<Detail>(`/api/detail?metric=${metric}`, 60000);

  const curV = currentValue(metric, cur);
  const big = metric === 'light'
    ? { v: curV != null ? fmt(curV, 0) : '—', u: 'km' }
    : { v: curV != null ? fmt(c.f(curV), c.d) : '—', u: metric === 'rain' ? `${c.unit} heute` : c.unit };

  const values = (hist?.points ?? []).map(p => (p.v == null ? null : metric === 'light' ? p.v : c.f(p.v)));
  const times = (hist?.points ?? []).map(p => p.t);
  const bucket = hist && hist.points.length > 1 && M.bars ? hist.points[1].t - hist.points[0].t : 0;
  const rec = det?.record;
  const recLine = (v: number | null | undefined, kind: Parameters<typeof fmtStat>[0]['kind'], t: number | null | undefined) =>
    v == null ? '—' : `${fmtStat({ v, kind }, metric, u)}${t ? ' · ' + dateShort(t) : ''}`;

  let month = '—';
  if (rec?.month) {
    if (rec.month.sum != null) month = metric === 'rain' ? fmtStat({ v: rec.month.sum, kind: 'rain' }, metric, u) : `${fmt(rec.month.sum, 0)} Einschläge`;
    else if (rec.month.min != null && rec.month.max != null) month = `${fmt(c.f(rec.month.min), c.d)} – ${fmtStat({ v: rec.month.max, kind: 'metric' }, metric, u)}`;
    else if (rec.month.max != null) month = `max. ${fmtStat({ v: rec.month.max, kind: 'metric' }, metric, u)}`;
  }

  return (
    <div className="stack">
      <div className="chips" role="tablist" aria-label="Messwert">
        {cfg.metrics.map(m => (
          <button key={m} role="tab" aria-selected={m === metric} className={'chip' + (m === metric ? ' on' : '')} onClick={() => go({ screen: 'detail', metric: m })}>{METRIC_META[m].label}</button>
        ))}
      </div>
      <div className="grid-detail">
        <section className="card lg span-all" style={{ gap: 20 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16 }}>
            <div className="stack" style={{ gap: 6 }}>
              <div className="eyebrow"><span>{M.label} · jetzt</span></div>
              <div className="detail-num">{big.v}<span className="u">{big.u}</span></div>
              <div style={{ fontSize: 15, color: 'var(--text-2)' }}>{subLine(metric, cur, u)}</div>
            </div>
            {hasHistory && <button className="btn-ghost" onClick={() => go({ screen: 'hist', metric, range: 'day' })}>Gesamter Verlauf</button>}
          </div>
          {hasHistory && (
            <Chart
              values={values}
              times={times}
              bars={M.bars}
              color={M.color}
              height="clamp(140px, 22vw, 220px)"
              formatValue={pointFormatter(metric, u)}
              formatTime={t => timeLabel('day', t, bucket)}
              axis={axisLabels('day', times)}
              plain
            />
          )}
        </section>

        <section className="card" style={{ gap: 4 }}>
          <div className="eyebrow" style={{ paddingBottom: 8 }}><span>Heute</span></div>
          {(det?.today ?? []).map(s => (
            <div className="row" key={s.k}>
              <span className="k">{s.k}</span>
              <span className="v">{fmtStat(s, metric, u)}{s.t && s.kind !== 'time' ? ` · ${hhmm(s.t)}` : ''}</span>
            </div>
          ))}
          {!det && <div className="note">Lade …</div>}
        </section>

        <section className="card" style={{ gap: 4 }}>
          <div className="eyebrow" style={{ paddingBottom: 8 }}><span>Rekorde</span></div>
          <div className="row"><span className="k">{metric === 'wind' ? 'Stärkste Böe' : metric === 'light' ? 'Meiste Einschläge' : 'Höchstwert'}</span><span className="v">{recLine(rec?.max, rec?.maxKind ?? 'metric', rec?.maxT)}</span></div>
          {(rec?.min != null || !['wind', 'rain', 'solar', 'uv'].includes(metric)) && (
            <div className="row"><span className="k">{metric === 'light' ? 'Nächster Einschlag' : 'Tiefstwert'}</span><span className="v">{recLine(rec?.min, rec?.minKind ?? 'metric', rec?.minT)}</span></div>
          )}
          <div className="row"><span className="k">Dieser Monat</span><span className="v">{month}</span></div>
        </section>

        {det?.device && (
          <section className="card" style={{ gap: 4 }}>
            <div className="eyebrow" style={{ paddingBottom: 8 }}><span>Sensor</span></div>
            <div className="row"><span className="k">Gerät</span><span className="v">{det.device.name}</span></div>
            {det.device.battery && <div className="row"><span className="k">Batterie</span><span className="v">{det.device.battery}</span></div>}
            {det.device.signal && <div className="row"><span className="k">Signal</span><span className="v">{/^[0-4]$/.test(det.device.signal) ? det.device.signal + '/4' : det.device.signal}</span></div>}
          </section>
        )}
      </div>
    </div>
  );
}
