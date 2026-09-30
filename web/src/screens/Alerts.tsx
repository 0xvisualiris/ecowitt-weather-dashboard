import { type AlertsView, relTime, useApi } from '../lib';

export function AlertsScreen() {
  const { data, error } = useApi<AlertsView>('/api/alerts', 30000);
  if (!data) return <div className="center-msg">{error ? `Warnungen nicht verfügbar: ${error}` : 'Lade …'}</div>;
  const dot = (level: string) => (level === 'warning' ? 'var(--amber)' : level === 'info' ? 'var(--blue)' : 'var(--faint)');
  return (
    <div className="grid-2">
      <section className="card md">
        <div className="eyebrow pad"><span>Aktuelle Lage</span></div>
        {data.rules.map(r => (
          <div className="rule" key={r.id}>
            <div className="stack" style={{ gap: 3, minWidth: 0 }}>
              <span className="l">{r.label}</span>
              <span className="c">{r.active && r.message ? r.message : r.description}</span>
            </div>
            <span className={'pill' + (r.active ? ' on' : '') + (r.level === 'info' ? ' info' : '')}>{r.active ? 'aktiv' : 'keine'}</span>
          </div>
        ))}
        {!data.rules.length && <div className="note">Keine Warnregeln konfiguriert.</div>}
      </section>
      <section className="card md">
        <div className="eyebrow pad"><span>Verlauf</span></div>
        {data.log.map(l => (
          <div className="log" key={l.id}>
            <span className="ld" style={{ background: dot(l.level) }} />
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <span className="lt">{l.title}{l.end == null ? ' · aktiv' : ''}</span>
              <span className="lx">{l.text}</span>
            </div>
            <span className="ltime">{relTime(l.start)}</span>
          </div>
        ))}
        {!data.log.length && <div className="note" style={{ paddingTop: 4 }}>Bisher keine Warnungen aufgezeichnet.</div>}
      </section>
    </div>
  );
}
