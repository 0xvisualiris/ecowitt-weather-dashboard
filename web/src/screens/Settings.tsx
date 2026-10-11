import { useContext } from 'react';
import { type AppConfig, type Units, UNIT_OPTIONS, UnitsContext } from '../lib';
import { LangContext, t, type Lang } from '../i18n';
import { Segmented } from '../components/Segmented';

export function SettingsScreen({ cfg: _cfg }: { cfg: AppConfig }) {
  const { u, setU } = useContext(UnitsContext);
  const { lang, setLang } = useContext(LangContext);

  return (
    <section className="card md">
      <div className="eyebrow pad"><span>{t('settings.units')}</span></div>
      {UNIT_OPTIONS().map(o => (
        <div key={o.key} className="row" style={{ flexWrap: 'wrap', alignItems: 'center', padding: '12px 0' }}>
          <span>{o.label}</span>
          <Segmented
            kind="radio" size="xs" inset ariaLabel={o.label}
            items={o.opts.map(opt => ({ key: opt, label: opt }))}
            value={u[o.key]}
            onChange={opt => setU({ ...u, [o.key]: opt } as Units)}
          />
        </div>
      ))}
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center', padding: '12px 0' }}>
        <span>{t('settings.language')}</span>
        <Segmented
          kind="radio" size="xs" inset ariaLabel={t('settings.language')}
          items={(['de', 'en'] as Lang[]).map(l => ({ key: l, label: l === 'de' ? 'Deutsch' : 'English' }))}
          value={lang}
          onChange={l => setLang(l as Lang)}
        />
      </div>
      <div className="note" style={{ paddingTop: 12 }}>{t('settings.browserOnly')}</div>
    </section>
  );
}
