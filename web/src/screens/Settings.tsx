import { useContext } from 'react';
import { type AppConfig, type Units, UNIT_OPTIONS, UnitsContext, dateFmt, fmt } from '../lib';

export function SettingsScreen({ cfg }: { cfg: AppConfig }) {
  const { u, setU } = useContext(UnitsContext);
  const s = cfg.station;
  const station: [string, string][] = [['Name', s.name]];
  if (s.altitude_m != null) station.push(['Höhe ü. NN', `${fmt(s.altitude_m, 0)} m`]);
  for (const d of s.devices) station.push([d.role || 'Gerät', d.name]);
  if (s.since) station.push(['In Betrieb seit', dateFmt(Date.parse(s.since), { month: 'long', year: 'numeric' })]);
  station.push(['Zeitzone', cfg.timezone]);
  if (cfg.demo) station.push(['Datenquelle', 'Demo-Modus (synthetische Werte)']);

  return (
    <div className="grid-2">
      <section className="card md">
        <div className="eyebrow pad"><span>Einheiten</span></div>
        {UNIT_OPTIONS.map(o => (
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
        <div className="note" style={{ paddingTop: 12 }}>Wird nur in diesem Browser gespeichert.</div>
      </section>
      <section className="card md">
        <div className="eyebrow pad"><span>Station</span></div>
        {station.map(([k, v], i) => (
          <div className="row" key={i} style={{ padding: '12px 0' }}><span className="k">{k}</span><span className="v" style={{ fontWeight: 500 }}>{v}</span></div>
        ))}
      </section>
    </div>
  );
}
