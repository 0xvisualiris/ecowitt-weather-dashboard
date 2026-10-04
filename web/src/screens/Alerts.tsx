import { type AlertsView, relTime, useApi } from '../lib';
import { t } from '../i18n';

export function AlertsScreen() {
  const { data, error } = useApi<AlertsView>('/api/alerts', 30000);
  if (!data) return <div className="center-msg">{error ? t('alerts.notAvailable', { error }) : t('app.loading')}</div>;
  const dot = (level: string) => (level === 'warning' ? 'var(--amber)' : level === 'info' ? 'var(--blue)' : 'var(--faint)');
  return (
    <div className="grid-2">
      <section className="card md">
        <div className="eyebrow pad"><span>{t('alerts.current')}</span></div>
        {data.rules.map(r => (
          <div className="rule" key={r.id}>
            <div className="stack" style={{ gap: 3, minWidth: 0 }}>
              <span className="l">{r.label}</span>
              <span className="c">{r.active && r.message ? r.message : r.description}</span>
            </div>
            <span className={'pill' + (r.active ? ' on' : '') + (r.level === 'info' ? ' info' : '')}>{r.active ? t('alerts.active') : t('alerts.none')}</span>
          </div>
        ))}
        {!data.rules.length && <div className="note">{t('alerts.noRules')}</div>}
      </section>
      <section className="card md">
        <div className="eyebrow pad"><span>{t('nav.hist')}</span></div>
        {data.log.map(l => (
          <div className="log" key={l.id}>
            <span className="ld" style={{ background: dot(l.level) }} />
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <span className="lt">{l.title}{l.end == null ? t('alerts.activeSuffix') : ''}</span>
              <span className="lx">{l.text}</span>
            </div>
            <span className="ltime">{relTime(l.start)}</span>
          </div>
        ))}
        {!data.log.length && <div className="note" style={{ paddingTop: 4 }}>{t('alerts.noneRecorded')}</div>}
      </section>
    </div>
  );
}
