import { useContext } from 'react';
import { type AppConfig, type Units, UNIT_OPTIONS, UnitsContext } from '../lib';
import { LangContext, t, type Lang } from '../i18n';

export function SettingsScreen({ cfg: _cfg }: { cfg: AppConfig }) {
  const { u, setU } = useContext(UnitsContext);
  const { lang, setLang } = useContext(LangContext);

  return (
    <section className="card md">
      <div className="eyebrow pad"><span>{t('settings.units')}</span></div>
      {UNIT_OPTIONS().map(o => (
        <div key={o.key} className="row" style={{ flexWrap: 'wrap', alignItems: 'center', padding: '12px 0' }}>
          <span>{o.label}</span>
          <div className="segs inset" role="radiogroup" aria-label={o.label}>
            {o.opts.map(opt => (
              <button key={opt} role="radio" aria-checked={u[o.key] === opt} className={'seg xs' + (u[o.key] === opt ? ' on' : '')}
                onClick={() => setU({ ...u, [o.key]: opt } as Units)}>{opt}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'center', padding: '12px 0' }}>
        <span>{t('settings.language')}</span>
        <div className="segs inset" role="radiogroup" aria-label={t('settings.language')}>
          {(['de', 'en'] as Lang[]).map(l => (
            <button key={l} role="radio" aria-checked={lang === l} className={'seg xs' + (lang === l ? ' on' : '')}
              onClick={() => setLang(l)}>{l === 'de' ? 'Deutsch' : 'English'}</button>
          ))}
        </div>
      </div>
      <div className="note" style={{ paddingTop: 12 }}>{t('settings.browserOnly')}</div>
    </section>
  );
}
