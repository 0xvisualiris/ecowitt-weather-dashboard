// Small hand-drawn forecast-condition icons, one per DWD/HA condition slug
// (service.js's FORECAST_DE / dwd.js's wwCondition). Same convention as the
// wind compass and sun/moon arc in Dashboard.tsx: plain presentation
// attributes with design-token colors, aria-hidden (the day's text label
// already carries the meaning), composed from simple primitives rather than
// hand-derived path data.

const AMBER = 'var(--amber)';
const BLUE = 'var(--blue)';
const MUTED = 'var(--muted)';
const TEXT2 = 'var(--text-2)';

function Sun({ cx = 12, cy = 12, r = 5, color = AMBER, rays = true }: { cx?: number; cy?: number; r?: number; color?: string; rays?: boolean }) {
  const lines = rays
    ? Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        const x1 = cx + (r + 2) * Math.cos(a), y1 = cy + (r + 2) * Math.sin(a);
        const x2 = cx + (r + 4.5) * Math.cos(a), y2 = cy + (r + 4.5) * Math.sin(a);
        return <line key={i} x1={x1.toFixed(1)} y1={y1.toFixed(1)} x2={x2.toFixed(1)} y2={y2.toFixed(1)} stroke={color} strokeWidth="1.5" strokeLinecap="round" />;
      })
    : null;
  return <g>{lines}<circle cx={cx} cy={cy} r={r} fill={color} /></g>;
}

// A crescent, cut from a disc with a card-colored circle – relies on this
// icon only ever being drawn on the forecast card's own background.
function Moon() {
  return <g><circle cx="12" cy="12" r="7" fill={TEXT2} /><circle cx="15" cy="10" r="6" fill="var(--card)" /></g>;
}

function Cloud({ color = MUTED }: { color?: string }) {
  return (
    <g fill={color}>
      <circle cx="9" cy="13" r="3.6" />
      <circle cx="13.5" cy="10.8" r="4.6" />
      <circle cx="17.5" cy="13.2" r="3.2" />
      <rect x="6" y="13" width="13" height="5.5" rx="2.75" />
    </g>
  );
}

function Drops({ n, color = BLUE }: { n: 2 | 3 | 5; color?: string }) {
  const xs = n === 2 ? [9, 15] : n === 3 ? [7.5, 12, 16.5] : [6, 9.5, 13, 16.5, 20];
  return <g stroke={color} strokeWidth="1.6" strokeLinecap="round">{xs.map((x, i) => <line key={i} x1={x} y1="19" x2={x - 1.3} y2="22" />)}</g>;
}

function Snow({ n, color = TEXT2 }: { n: 1 | 3; color?: string }) {
  const xs = n === 1 ? [12] : [7.5, 12, 16.5];
  const y = n === 1 ? 21.5 : 20;
  return <g fill={color}>{xs.map((x, i) => <circle key={i} cx={x} cy={y} r="1" />)}</g>;
}

function Bolt({ color = AMBER, x = 0 }: { color?: string; x?: number }) {
  return <polygon points={`${13 + x},15 ${9.5 + x},20.5 ${12 + x},20.5 ${10.5 + x},24`} fill={color} />;
}

function Fog() {
  return (
    <g stroke={MUTED} strokeWidth="1.6" strokeLinecap="round">
      <line x1="4" y1="9" x2="20" y2="9" />
      <line x1="6" y1="13" x2="22" y2="13" />
      <line x1="4" y1="17" x2="18" y2="17" />
      <line x1="8" y1="21" x2="20" y2="21" />
    </g>
  );
}

function Warning() {
  return (
    <g>
      <polygon points="12,4 22,21 2,21" fill="none" stroke={AMBER} strokeWidth="1.8" strokeLinejoin="round" />
      <line x1="12" y1="10" x2="12" y2="15.5" stroke={AMBER} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="18" r="1" fill={AMBER} />
    </g>
  );
}

function Wind() {
  return (
    <g stroke={MUTED} strokeWidth="1.8" strokeLinecap="round" fill="none">
      <path d="M3 9h12a2.5 2.5 0 1 0-2.2-3.7" />
      <path d="M3 14h15a2.5 2.5 0 1 1-2.2 3.7" />
      <path d="M3 19h9" />
    </g>
  );
}

function iconFor(code: string | null) {
  switch (code) {
    case 'sunny': return <Sun />;
    case 'clear-night': return <Moon />;
    case 'partlycloudy': return <g><Sun cx={8} cy={8} r={3.5} rays={false} /><Cloud /></g>;
    case 'cloudy': return <Cloud />;
    case 'fog': return <Fog />;
    case 'rainy': return <g><Cloud /><Drops n={3} /></g>;
    case 'pouring': return <g><Cloud /><Drops n={5} /></g>;
    case 'snowy': return <g><Cloud /><Snow n={3} /></g>;
    case 'snowy-rainy': return <g><Cloud /><Drops n={2} /><Snow n={1} /></g>;
    case 'hail': return <g><Cloud /><Snow n={3} color={BLUE} /></g>;
    case 'lightning': return <g><Cloud /><Bolt /></g>;
    case 'lightning-rainy': return <g><Cloud /><Bolt x={-1.5} /><Drops n={2} /></g>;
    case 'exceptional': return <Warning />;
    case 'windy': case 'windy-variant': return <Wind />;
    default: return <Cloud color={TEXT2} />;
  }
}

export function ConditionIcon({ code }: { code: string | null }) {
  return <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">{iconFor(code)}</svg>;
}
