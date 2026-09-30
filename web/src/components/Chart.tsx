import { useState, type PointerEvent } from 'react';
import { areaPath, barsPath, extent, linePath } from '../lib';

interface ChartProps {
  values: (number | null)[];
  times: number[];
  bars?: boolean;
  color: string;
  height: string;
  formatValue: (v: number) => string;
  formatTime: (t: number) => string;
  yAxis?: { max: string; mid: string; min: string };
  axis: string[];
  plain?: boolean;
}

const W = 800, H = 300, PAD = 6;

export function fillFor(color: string, bars?: boolean) {
  if (bars) return color;
  return `color-mix(in oklch, ${color} 12%, transparent)`;
}

export function Chart({ values, times, bars, color, height, formatValue, formatTime, yAxis, axis, plain }: ChartProps) {
  const [hf, setHf] = useState<number | null>(null);
  const n = values.length;
  const has = values.some(v => v != null);
  const [mn, mx] = extent(values);
  const bmax = Math.max(0, ...values.filter((v): v is number => v != null)) || 1;

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHf(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };

  let hov: null | { x: number; y: number; val: string; time: string } = null;
  if (hf != null && has && n) {
    let i = bars ? Math.min(n - 1, Math.floor(hf * n)) : Math.round(hf * (n - 1));
    if (values[i] == null) {
      // nearest measured point
      for (let d = 1; d < n; d++) {
        if (values[i - d] != null) { i = i - d; break; }
        if (values[i + d] != null) { i = i + d; break; }
      }
    }
    const v = values[i];
    if (v != null) {
      const x = bars ? (i + 0.5) / n : i / Math.max(1, n - 1);
      const y = bars ? 1 - v / bmax : (PAD + (H - 2 * PAD) * (1 - (v - mn) / ((mx - mn) || 1))) / H;
      hov = { x, y, val: formatValue(v), time: formatTime(times[i]) };
    }
  }

  const plot = (
    <div className="stack" style={{ gap: 8 }}>
      <div
        className={'plot' + (plain ? ' plain' : '')}
        style={{ height }}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setHf(null)}
        role="img"
        aria-label="Diagramm"
      >
        {!plain && <div className="mid" />}
        {has ? (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            {bars ? (
              <path d={barsPath(values, W, H)} fill={color} />
            ) : (
              <>
                <path d={areaPath(values, W, H, PAD)} fill={fillFor(color)} />
                <path d={linePath(values, W, H, PAD)} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              </>
            )}
          </svg>
        ) : (
          <div className="empty">Keine Daten für diesen Zeitraum</div>
        )}
        {hov && (
          <>
            <div className="hair" style={{ left: `${hov.x * 100}%` }} />
            <div className="hdot" style={{ left: `${hov.x * 100}%`, top: `${hov.y * 100}%`, background: color }} />
            <div className="tip" style={{ left: `${hov.x * 100}%`, transform: hov.x > 0.75 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}>
              <span className="tv">{hov.val}</span>
              <span className="tt">{hov.time}</span>
            </div>
          </>
        )}
      </div>
      <div className="axis">{axis.map((a, i) => <span key={i}>{a}</span>)}</div>
    </div>
  );

  if (!yAxis) return plot;
  return (
    <div className="chart-wrap">
      <div className="y-axis" style={{ height }}><span>{yAxis.max}</span><span>{yAxis.mid}</span><span>{yAxis.min}</span></div>
      {plot}
    </div>
  );
}

export function Spark({ values, height, color, kind, strokeWidth = 1.5, area = true }: { values: (number | null)[]; height: number; color: string; kind: 'line' | 'bars'; strokeWidth?: number; area?: boolean }) {
  const w = 300;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      {kind === 'bars' ? (
        <>
          <line x1="0" y1={height - 0.5} x2={w} y2={height - 0.5} stroke="var(--line)" vectorEffect="non-scaling-stroke" />
          <path d={barsPath(values, w, height)} fill={color} />
        </>
      ) : (
        <>
          {area && <path d={areaPath(values, w, height)} fill={fillFor(color)} />}
          <path d={linePath(values, w, height)} fill="none" stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
        </>
      )}
    </svg>
  );
}
