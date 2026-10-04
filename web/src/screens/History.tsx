import { go } from '../App';
import { Chart } from '../components/Chart';
import {
  type AppConfig, type Current, type History, type MetricKey, type Range, type Records, type Units,
  METRIC_META, dateFmt, extent, parts, fmt, fmtStat, metricConv, useApi, useUnits, hhmm, dateShort,
} from '../lib';

// CSV for the metric/range currently on screen – semicolon-delimited, German
// comma-decimal numbers (reusing fmt()), so it opens correctly in a
// German-locale Excel/LibreOffice, matching the rest of the UI's formatting.
// Values are exported in the visitor's currently selected unit, so the file
// always matches what's on screen. A UTF-8 BOM keeps umlauts intact.
function buildCsv(data: History, metric: MetricKey, u: Units): string {
  const c = metricConv(metric, u);
  const fmtVal = (v: number | null | undefined) => (v == null ? '' : metric === 'light' ? fmt(v, 0) : fmt(c.f(v), c.d));
  const hasRange = data.points.some(p => p.lo != null && p.hi != null);
  const valueHeader = metric === 'light' ? 'Einschläge' : `${METRIC_META[metric].label}${c.unit ? ` (${c.unit})` : ''}`;
  const header = ['Zeit', valueHeader, ...(hasRange ? ['Min', 'Max'] : [])];
  const rows = data.points.map(p => {
    const t = parts(p.t);
    const cells = [`${t.d}.${t.m}.${t.y} ${t.H}:${t.M}`, fmtVal(p.v)];
    if (hasRange) cells.push(fmtVal(p.lo), fmtVal(p.hi));
    return cells;
  });
  const csvLine = (cells: string[]) => cells.map(v => `"${v.replace(/"/g, '""')}"`).join(';');
  return '﻿' + [csvLine(header), ...rows.map(csvLine)].join('\r\n');
}

function downloadCsv(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const RANGES: [Range, string][] = [['day', 'Tag'], ['week', 'Woche'], ['month', 'Monat'], ['year', 'Jahr']];

export function axisLabels(range: Range, times: number[]) {
  if (!times.length) return [];
  const a = times[0], b = Date.now();
  return [0, 1, 2, 3, 4].map(i => {
    const t = a + ((b - a) * i) / 4;
    if (i === 4 && range !== 'month') return 'jetzt';
    const p = parts(t);
    if (range === 'day') return `${p.H}:00`;
    if (range === 'week') return p.wd;
    if (range === 'month') return i === 0 || i === 4 ? `${p.d}. ${p.mon}` : `${p.d}.`;
    return i === 0 ? `${p.mon} ${String(p.y).slice(2)}` : p.mon;
  });
}

export function timeLabel(range: Range, t: number, bucketMs = 0) {
  if (range === 'day') return bucketMs ? `${hhmm(t)} – ${hhmm(t + bucketMs)} Uhr` : `${hhmm(t)} Uhr`;
  const p = parts(t);
  if (range === 'week') return `${p.wd}, ${p.d}.${p.m}., ${p.H}:${p.M}`;
  return `${p.wd}, ${p.d}. ${p.mon}${range === 'year' ? ' ' + p.y : ''}`;
}

// Unit-aware value formatter for chart points
export function pointFormatter(metric: MetricKey, u: Units) {
  if (metric === 'light') return (v: number) => `${fmt(v, 0)} Einschläge`;
  const c = metricConv(metric, u);
  return (v: number) => fmt(v, c.d) + (c.unit ? ' ' + c.unit : '');
}

export function currentValue(metric: MetricKey, cur: Current | null) {
  if (!cur) return null;
  const v = cur.values;
  return {
    temp: v.temperature, hum: v.humidity, wind: v.wind_speed, rain: cur.rain.day, press: v.pressure,
    solar: v.solar_radiation, uv: v.uv_index, light: v.lightning_distance,
  }[metric] ?? null;
}

export function HistoryScreen({ cfg, cur, metric, range }: { cfg: AppConfig; cur: Current | null; metric: MetricKey; range: Range }) {
  const u = useUnits();
  const { data, error } = useApi<History>(`/api/history?metric=${metric}&range=${range}`, range === 'day' ? 60000 : 300000);
  const { data: rec } = useApi<Records>('/api/records', 600000);
  const M = METRIC_META[metric];
  const c = metricConv(metric, u);
  const chartMetrics = cfg.metrics.filter(m => m !== 'light' || cfg.sensors.includes('lightning_count'));

  const bucket = data && data.points.length > 1 && M.bars ? data.points[1].t - data.points[0].t : 0;

  const values = (data?.points ?? []).map(p => (p.v == null ? null : metric === 'light' ? p.v : c.f(p.v)));
  const times = (data?.points ?? []).map(p => p.t);
  const [mn, mx] = extent(values);
  const d = metric === 'light' ? 0 : c.d;
  const yAxis = M.bars
    ? { max: fmt(mx, d), mid: fmt(mx / 2, d), min: '0' }
    : { max: fmt(mx, d), mid: fmt((mn + mx) / 2, d), min: fmt(mn, d) };

  const curV = currentValue(metric, cur);
  const curDisplay = metric === 'light'
    ? { v: curV != null ? fmt(curV, 0) : '—', u: 'km' }
    : { v: curV != null ? fmt(c.f(curV), c.d) : '—', u: metric === 'rain' ? `${c.unit} heute` : c.unit };
  const rangeLabel = RANGES.find(r => r[0] === range)![1];

  const since = rec?.since ? dateFmt(Date.parse(rec.since), { month: '2-digit', year: 'numeric' }) : null;
  const rows = cfg.metrics.map(m => ({ m, r: rec?.records[m] })).filter(x => x.r && (x.r.max != null || x.r.min != null));

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(`wetterstation-${metric}-${range}-${dateShort(Date.now()).replace(/\./g, '-')}.csv`, buildCsv(data, metric, u));
  };

  return (
    <div className="stack">
      <div className="hist-top">
        <div className="chips" role="tablist" aria-label="Messwert">
          {chartMetrics.map(m => (
            <button key={m} role="tab" aria-selected={m === metric} className={'chip' + (m === metric ? ' on' : '')} onClick={() => go({ screen: 'hist', metric: m, range })}>{METRIC_META[m].label}</button>
          ))}
        </div>
        <div className="row" style={{ border: 0, padding: 0, gap: 8 }}>
          <div className="segs" role="tablist" aria-label="Zeitraum">
            {RANGES.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={k === range} className={'seg sm' + (k === range ? ' on' : '')} onClick={() => go({ screen: 'hist', metric, range: k })}>{l}</button>
            ))}
          </div>
          <button type="button" className="btn-ghost" disabled={!data} onClick={exportCsv}>CSV exportieren</button>
        </div>
      </div>

      <section className="card lg">
        <div className="hist-head">
          <div className="stack" style={{ gap: 4 }}>
            <div className="eyebrow"><span>{M.label} · {rangeLabel}</span></div>
            <div className="hist-num">{curDisplay.v} <span className="u">{curDisplay.u}</span></div>
          </div>
          <div className="stats">
            {(data?.stats ?? []).map(s => (
              <div key={s.k}><span className="k">{s.k}</span><span className="v">{fmtStat(s, metric, u)}</span></div>
            ))}
          </div>
        </div>
        {error && !data ? <div className="center-msg">Verlauf nicht verfügbar: {error}</div> : (
          <Chart
            values={values}
            times={times}
            bars={M.bars}
            color={M.color}
            height="clamp(200px, 34vw, 340px)"
            formatValue={pointFormatter(metric, u)}
            formatTime={t => timeLabel(range, t, bucket)}
            yAxis={yAxis}
            axis={axisLabels(range, times)}
          />
        )}
      </section>

      {rows.length > 0 && (
        <section className="card lg" style={{ gap: 6 }}>
          <div className="eyebrow" style={{ paddingBottom: 8 }}><span>Rekorde{since ? ` · seit Inbetriebnahme ${since}` : ''}</span></div>
          <div className="scroll-x">
            <div className="rec-table">
              <div className="rec-row head"><span>Messwert</span><span>Höchstwert</span><span>am</span><span>Tiefstwert</span><span>am</span></div>
              {rows.map(({ m, r }) => (
                <div className="rec-row" key={m}>
                  <span style={{ fontWeight: 500 }}>{METRIC_META[m].label}{m === 'wind' ? ' (Böe)' : ''}</span>
                  <span>{fmtStat({ v: r!.max, kind: r!.maxKind }, m, u)}</span>
                  <span className="d">{r!.maxT ? dateShort(r!.maxT) : ''}</span>
                  <span>{r!.min != null ? (m === 'light' ? `nächster ${fmtStat({ v: r!.min, kind: r!.minKind }, m, u)}` : fmtStat({ v: r!.min, kind: r!.minKind }, m, u)) : '—'}</span>
                  <span className="d">{r!.minT ? dateShort(r!.minT) : ''}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
