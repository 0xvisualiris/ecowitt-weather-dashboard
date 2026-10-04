import { useEffect, useState } from 'react';
import { type AdminSession, type AdminSettings, type AlertCondition, type AlertRule, type Device, type MetricKey, METRIC_META, postJson, useApi } from '../lib';
import { go } from '../App';

const SENSOR_FIELDS: [string, string][] = [
  ['temperature', 'Temperatur'], ['feels_like', 'Gefühlte Temperatur'], ['dew_point', 'Taupunkt'], ['humidity', 'Luftfeuchte'],
  ['wind_speed', 'Windgeschwindigkeit'], ['wind_gust', 'Windböe'], ['wind_direction', 'Windrichtung'],
  ['rain_rate', 'Regenrate'], ['rain_event', 'Regen (Ereignis)'], ['rain_daily', 'Regen (Tag)'],
  ['rain_weekly', 'Regen (Woche)'], ['rain_monthly', 'Regen (Monat)'], ['rain_yearly', 'Regen (Jahr)'],
  ['pressure', 'Luftdruck'], ['solar_radiation', 'Solarstrahlung'], ['uv_index', 'UV-Index'],
  ['lightning_distance', 'Blitz-Entfernung'], ['lightning_time', 'Letzter Blitz (Zeitstempel)'], ['lightning_count', 'Blitze (Tageszähler)'],
];

const METRIC_FIELDS = (Object.keys(METRIC_META) as MetricKey[]).map(k => [k, METRIC_META[k].label] as const);

const COMPARISONS: [keyof AlertCondition, string][] = [
  ['above', 'Über'], ['below', 'Unter'], ['at_least', 'Mindestens'], ['at_most', 'Höchstens'], ['equals', 'Gleich'],
];

const newCondition = (): AlertCondition => ({ sensor: SENSOR_FIELDS[0][0], above: 0 });
const newRule = (): AlertRule => ({ id: '', label: '', description: '', level: 'warning', message: '', all: [newCondition()] });
const newDevice = (): Device => ({ id: '', name: '', short: '', role: '', battery: null, signal: null, metrics: [] });

export function AdminScreen({ onSession }: { onSession: (s: AdminSession) => void }) {
  const { data, error: loadError } = useApi<AdminSettings>('/api/admin/settings');
  const [haUrl, setHaUrl] = useState('');
  const [haToken, setHaToken] = useState('');
  const [sensors, setSensors] = useState<Record<string, string>>({});
  const [entity, setEntity] = useState('');
  const [dwdStationId, setDwdStationId] = useState('');
  const [biasHours, setBiasHours] = useState(6);
  const [label, setLabel] = useState('');
  const [stationName, setStationName] = useState('');
  const [stationSubtitle, setStationSubtitle] = useState('');
  const [stationAltitude, setStationAltitude] = useState<number | ''>('');
  const [stationSince, setStationSince] = useState('');
  const [devices, setDevices] = useState<Device[]>([]);
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    if (!data) return;
    setHaUrl(data.homeassistant.url);
    setSensors(data.sensors);
    setEntity(data.forecast.entity);
    setDwdStationId(data.forecast.dwdStationId);
    setBiasHours(data.forecast.biasHours);
    setLabel(data.forecast.label);
    setStationName(data.station.name);
    setStationSubtitle(data.station.subtitle);
    setStationAltitude(data.station.altitude_m ?? '');
    setStationSince(data.station.since);
    setDevices(data.station.devices);
    setAlerts(data.alerts);
  }, [data]);

  if (loadError) return <div className="admin-page"><div className="center-msg">Fehler: {loadError}</div></div>;
  if (!data) return <div className="admin-page"><div className="center-msg">Lade …</div></div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await postJson('/api/admin/settings', {
        homeassistant: { url: haUrl, token: haToken },
        sensors,
        forecast: { entity, dwdStationId, biasHours, label },
        station: { name: stationName, subtitle: stationSubtitle, altitude_m: stationAltitude === '' ? null : stationAltitude, since: stationSince, devices },
        alerts,
      });
      setRestarting(true);
      const poll = setInterval(async () => {
        try {
          const r = await fetch('/healthz', { cache: 'no-store' });
          if (r.ok) { clearInterval(poll); location.href = '#/'; location.reload(); }
        } catch { /* still restarting */ }
      }, 1500);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const logout = async () => {
    await postJson('/api/admin/logout', {});
    onSession({ loggedIn: false, mustChangePassword: false });
    go({ screen: 'dash' });
  };

  if (restarting) {
    return <div className="auth-page"><div className="card lg auth-card center-msg">Gespeichert – der Server startet neu …</div></div>;
  }

  return (
    <div className="admin-page">
      <div className="header">
        <div className="title">Admin-Einstellungen</div>
        <div className="row" style={{ border: 0, padding: 0, gap: 8 }}>
          <button type="button" className="btn-ghost" onClick={() => go({ screen: 'adminPassword' })}>Passwort ändern</button>
          <button type="button" className="btn-ghost" onClick={logout}>Abmelden</button>
          <button type="button" className="btn-ghost" onClick={() => go({ screen: 'dash' })}>Zum Dashboard</button>
        </div>
      </div>

      <form onSubmit={submit} className="stack">
        <section className="card lg stack">
          <div className="eyebrow"><span>Home Assistant</span></div>
          <Field label="URL" locked={data.locked.haUrl} lockedReason={data.locked.haUrlEnv ? 'durch Umgebungsvariable HA_URL festgelegt' : undefined}>
            <input className="input" value={haUrl} onChange={e => setHaUrl(e.target.value)} disabled={data.locked.haUrl}
              placeholder="http://homeassistant.local:8123" />
          </Field>
          <Field label={`Long-Lived Access Token${data.homeassistant.tokenSet ? ' (bereits gesetzt)' : ''}`} locked={data.locked.haToken}
            lockedReason={data.locked.haTokenEnv ? 'durch Umgebungsvariable HA_TOKEN festgelegt' : undefined}>
            <input className="input" type="password" value={haToken} onChange={e => setHaToken(e.target.value)} disabled={data.locked.haToken}
              placeholder={data.homeassistant.tokenSet ? 'Leer lassen = unverändert' : 'Token einfügen'} autoComplete="off" />
          </Field>
        </section>

        <section className="card lg stack">
          <div className="eyebrow"><span>Vorhersage</span></div>
          <Field label="DWD-Stations-ID" locked={data.locked.dwdStationId}>
            <input className="input" value={dwdStationId} onChange={e => setDwdStationId(e.target.value)} disabled={data.locked.dwdStationId} placeholder="z. B. 10384" />
          </Field>
          <Field label="Ausgleichsstunden (Live-Messwert)" locked={data.locked.dwdStationId}>
            <input className="input" type="number" min={0} max={24} value={biasHours} disabled={data.locked.dwdStationId}
              onChange={e => setBiasHours(Number(e.target.value))} />
          </Field>
          <Field label="Home-Assistant-Wetter-Entität (Rückfallebene)" locked={data.locked.forecastEntity}>
            <input className="input" value={entity} onChange={e => setEntity(e.target.value)} disabled={data.locked.forecastEntity} placeholder="weather.forecast_home" />
          </Field>
          <Field label="Quellenangabe (optional)" locked={false}>
            <input className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder="z. B. DWD MOSMIX" />
          </Field>
        </section>

        <section className="card lg stack">
          <div className="eyebrow"><span>Sensoren</span></div>
          {SENSOR_FIELDS.map(([key, labelText]) => (
            <Field key={key} label={labelText} locked={!!data.locked.sensors[key]}>
              <input className="input" value={sensors[key] || ''} disabled={!!data.locked.sensors[key]}
                onChange={e => setSensors({ ...sensors, [key]: e.target.value })} placeholder={`sensor.${key}`} />
            </Field>
          ))}
        </section>

        <section className="card lg stack">
          <div className="eyebrow"><span>Station</span></div>
          <Field label="Name" locked={data.locked.stationName}>
            <input className="input" value={stationName} onChange={e => setStationName(e.target.value)} disabled={data.locked.stationName} />
          </Field>
          <Field label="Unterzeile (optional)" locked={data.locked.stationSubtitle}>
            <input className="input" value={stationSubtitle} onChange={e => setStationSubtitle(e.target.value)} disabled={data.locked.stationSubtitle} />
          </Field>
          <Field label="Höhe ü. NN in m (optional)" locked={data.locked.stationAltitude}>
            <input className="input" type="number" value={stationAltitude} disabled={data.locked.stationAltitude}
              onChange={e => setStationAltitude(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          <Field label="In Betrieb seit (JJJJ-MM-TT, optional)" locked={data.locked.stationSince}>
            <input className="input" value={stationSince} onChange={e => setStationSince(e.target.value)} disabled={data.locked.stationSince} placeholder="2024-04-01" />
          </Field>
          <div className="row" style={{ padding: '12px 0' }}><span className="k">Zeitzone</span><span className="v" style={{ fontWeight: 500 }}>{data.timezone}</span></div>
          {data.demo && <div className="row" style={{ padding: '12px 0' }}><span className="k">Datenquelle</span><span className="v" style={{ fontWeight: 500 }}>Demo-Modus (synthetische Werte)</span></div>}

          <div className="field">
            <label className="label">Geräte{data.locked.stationDevices && <span className="faint"> · in config.yaml festgelegt</span>}</label>
            <div className="stack">
              {devices.map((d, i) => (
                <DeviceEditor key={i} device={d} locked={data.locked.stationDevices}
                  onChange={nd => setDevices(devices.map((x, j) => (j === i ? nd : x)))}
                  onRemove={() => setDevices(devices.filter((_, j) => j !== i))} />
              ))}
            </div>
            {!data.locked.stationDevices && (
              <button type="button" className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setDevices([...devices, newDevice()])}>Gerät hinzufügen</button>
            )}
          </div>
        </section>

        <section className="card lg stack">
          <div className="eyebrow">
            <span>Warnungen</span>
            {!data.locked.alerts && <button type="button" className="btn-ghost" onClick={() => setAlerts(data.defaultAlerts)}>Standardregeln wiederherstellen</button>}
          </div>
          {data.locked.alerts && <div className="note">In config.yaml festgelegt.</div>}
          <div className="stack">
            {alerts.map((r, i) => (
              <RuleEditor key={i} rule={r} locked={data.locked.alerts}
                onChange={nr => setAlerts(alerts.map((x, j) => (j === i ? nr : x)))}
                onRemove={() => setAlerts(alerts.filter((_, j) => j !== i))} />
            ))}
          </div>
          {!data.locked.alerts && (
            <button type="button" className="btn-ghost" onClick={() => setAlerts([...alerts, newRule()])}>Regel hinzufügen</button>
          )}
        </section>

        {error && <div className="form-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={saving}>Speichern &amp; neu starten</button>
      </form>
    </div>
  );
}

function Field({ label, locked, lockedReason, children }: { label: string; locked: boolean; lockedReason?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="label">{label}{locked && <span className="faint"> · {lockedReason || 'in config.yaml festgelegt'}</span>}</label>
      {children}
    </div>
  );
}

function DeviceEditor({ device, locked, onChange, onRemove }: { device: Device; locked: boolean; onChange: (d: Device) => void; onRemove: () => void }) {
  return (
    <div className="card stack">
      <div className="row" style={{ border: 0, padding: 0 }}>
        <span className="label" style={{ fontWeight: 500 }}>{device.name || 'Neues Gerät'}</span>
        {!locked && <button type="button" className="btn-ghost" onClick={onRemove}>Entfernen</button>}
      </div>
      <Field label="ID" locked={locked}><input className="input" value={device.id} disabled={locked} onChange={e => onChange({ ...device, id: e.target.value })} /></Field>
      <Field label="Name" locked={locked}><input className="input" value={device.name} disabled={locked} onChange={e => onChange({ ...device, name: e.target.value })} /></Field>
      <Field label="Rolle" locked={locked}><input className="input" value={device.role} disabled={locked} onChange={e => onChange({ ...device, role: e.target.value })} placeholder="z. B. Außensensor" /></Field>
      <Field label="Kurzname" locked={locked}><input className="input" value={device.short} disabled={locked} onChange={e => onChange({ ...device, short: e.target.value })} /></Field>
      <Field label="Batterie-Entität (optional)" locked={locked}>
        <input className="input" value={device.battery || ''} disabled={locked} onChange={e => onChange({ ...device, battery: e.target.value || null })} placeholder="sensor.xxx_battery" />
      </Field>
      <Field label="Signal-Entität (optional)" locked={locked}>
        <input className="input" value={device.signal || ''} disabled={locked} onChange={e => onChange({ ...device, signal: e.target.value || null })} placeholder="sensor.xxx_signal" />
      </Field>
      <div className="field">
        <label className="label">Messwerte</label>
        <div className="chips">
          {METRIC_FIELDS.map(([k, l]) => (
            <button key={k} type="button" disabled={locked} className={'chip' + (device.metrics.includes(k) ? ' on' : '')}
              onClick={() => onChange({ ...device, metrics: device.metrics.includes(k) ? device.metrics.filter(m => m !== k) : [...device.metrics, k] })}>
              {l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function conditionComparison(c: AlertCondition): keyof AlertCondition {
  return COMPARISONS.find(([k]) => c[k] != null)?.[0] || 'above';
}

function ConditionEditor({ cond, locked, onChange, onRemove }: { cond: AlertCondition; locked: boolean; onChange: (c: AlertCondition) => void; onRemove: () => void }) {
  const isEntity = cond.entity != null;
  const cmp = conditionComparison(cond);
  const val = (cond[cmp] as number) ?? 0;
  const setCmp = (k: keyof AlertCondition) => {
    const next: AlertCondition = { sensor: cond.sensor, entity: cond.entity, recent: cond.recent };
    (next as Record<string, unknown>)[k] = val;
    onChange(next);
  };
  const hasRecent = !!cond.recent;

  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '8px 0' }}>
      <select className="input" style={{ width: 'auto' }} disabled={locked} value={isEntity ? '__entity__' : cond.sensor || ''}
        onChange={e => (e.target.value === '__entity__' ? onChange({ ...cond, sensor: undefined, entity: '' }) : onChange({ ...cond, entity: undefined, sensor: e.target.value }))}>
        {SENSOR_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        <option value="__entity__">Eigene HA-Entität…</option>
      </select>
      {isEntity && (
        <input className="input" style={{ width: 'auto' }} disabled={locked} value={cond.entity || ''} onChange={e => onChange({ ...cond, entity: e.target.value })} placeholder="sensor.xxx" />
      )}
      <select className="input" style={{ width: 'auto' }} disabled={locked} value={cmp} onChange={e => setCmp(e.target.value as keyof AlertCondition)}>
        {COMPARISONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input className="input" style={{ width: 80 }} disabled={locked} type="number" value={val} onChange={e => onChange({ ...cond, [cmp]: Number(e.target.value) })} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
        <input type="checkbox" disabled={locked} checked={hasRecent}
          onChange={e => {
            if (e.target.checked) onChange({ ...cond, recent: { sensor: SENSOR_FIELDS[0][0], minutes: 30 } });
            else { const { recent: _recent, ...rest } = cond; onChange(rest); }
          }} />
        Nur wenn aktuell
      </label>
      {hasRecent && cond.recent && (
        <>
          <select className="input" style={{ width: 'auto' }} disabled={locked} value={cond.recent.sensor || ''}
            onChange={e => onChange({ ...cond, recent: { sensor: e.target.value, minutes: cond.recent?.minutes } })}>
            {SENSOR_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input className="input" style={{ width: 70 }} disabled={locked} type="number" value={cond.recent.minutes ?? 30}
            onChange={e => onChange({ ...cond, recent: { ...cond.recent, minutes: Number(e.target.value) } })} />
          <span className="faint" style={{ fontSize: 13 }}>Min.</span>
        </>
      )}
      {!locked && <button type="button" className="btn-ghost" onClick={onRemove}>Entfernen</button>}
    </div>
  );
}

function RuleEditor({ rule, locked, onChange, onRemove }: { rule: AlertRule; locked: boolean; onChange: (r: AlertRule) => void; onRemove: () => void }) {
  const mode: 'all' | 'any' = rule.any ? 'any' : 'all';
  const conds = rule.all || rule.any || [];
  const setConds = (next: AlertCondition[]) => onChange(mode === 'any' ? { ...rule, any: next, all: undefined } : { ...rule, all: next, any: undefined });

  return (
    <div className="card stack">
      <div className="row" style={{ border: 0, padding: 0 }}>
        <span className="label" style={{ fontWeight: 500 }}>{rule.label || 'Neue Regel'}</span>
        {!locked && <button type="button" className="btn-ghost" onClick={onRemove}>Entfernen</button>}
      </div>
      <Field label="Bezeichnung" locked={locked}><input className="input" value={rule.label} disabled={locked} onChange={e => onChange({ ...rule, label: e.target.value })} /></Field>
      <Field label="Beschreibung" locked={locked}><input className="input" value={rule.description} disabled={locked} onChange={e => onChange({ ...rule, description: e.target.value })} /></Field>
      <div className="row" style={{ flexWrap: 'wrap', gap: 16, border: 0, padding: 0 }}>
        <Field label="Stufe" locked={locked}>
          <div className="segs inset">
            <button type="button" disabled={locked} className={'seg xs' + (rule.level === 'warning' ? ' on' : '')} onClick={() => onChange({ ...rule, level: 'warning' })}>Warnung</button>
            <button type="button" disabled={locked} className={'seg xs' + (rule.level === 'info' ? ' on' : '')} onClick={() => onChange({ ...rule, level: 'info' })}>Info</button>
          </div>
        </Field>
        <Field label="Verknüpfung" locked={locked}>
          <div className="segs inset">
            <button type="button" disabled={locked} className={'seg xs' + (mode === 'all' ? ' on' : '')} onClick={() => onChange({ ...rule, all: conds, any: undefined })}>Alle (UND)</button>
            <button type="button" disabled={locked} className={'seg xs' + (mode === 'any' ? ' on' : '')} onClick={() => onChange({ ...rule, any: conds, all: undefined })}>Eine (ODER)</button>
          </div>
        </Field>
      </div>
      <Field label="Banner (optional)" locked={locked}>
        <input className="input" value={rule.banner || ''} disabled={locked} onChange={e => onChange({ ...rule, banner: e.target.value })} placeholder={rule.label} />
      </Field>
      <Field label="Meldungstext" locked={locked}>
        <input className="input" value={rule.message} disabled={locked} onChange={e => onChange({ ...rule, message: e.target.value })} placeholder="z. B. Temperatur {temperature} °C" />
      </Field>
      <div className="field">
        <label className="label">Bedingungen</label>
        <div className="stack" style={{ gap: 0 }}>
          {conds.map((c, i) => (
            <ConditionEditor key={i} cond={c} locked={locked}
              onChange={nc => setConds(conds.map((x, j) => (j === i ? nc : x)))}
              onRemove={() => setConds(conds.filter((_, j) => j !== i))} />
          ))}
        </div>
        {!locked && (
          <button type="button" className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setConds([...conds, newCondition()])}>Bedingung hinzufügen</button>
        )}
      </div>
    </div>
  );
}
