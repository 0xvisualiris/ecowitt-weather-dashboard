import { useContext, useEffect, useState } from 'react';
import { type AdminSession, type AdminSettings, type AlertCondition, type AlertRule, type Device, type MetricKey, METRIC_META, metricLabel, postJson, useApi } from '../lib';
import { go } from '../App';
import { LangContext, t, translateApiError, type Lang } from '../i18n';

const SENSOR_FIELDS = (): [string, string][] => [
  ['temperature', t('admin.sensor.temperature')], ['feels_like', t('admin.sensor.feels_like')], ['dew_point', t('admin.sensor.dew_point')], ['humidity', t('admin.sensor.humidity')],
  ['wind_speed', t('admin.sensor.wind_speed')], ['wind_gust', t('admin.sensor.wind_gust')], ['wind_direction', t('admin.sensor.wind_direction')],
  ['rain_rate', t('admin.sensor.rain_rate')], ['rain_event', t('admin.sensor.rain_event')], ['rain_daily', t('admin.sensor.rain_daily')],
  ['rain_weekly', t('admin.sensor.rain_weekly')], ['rain_monthly', t('admin.sensor.rain_monthly')], ['rain_yearly', t('admin.sensor.rain_yearly')],
  ['pressure', t('admin.sensor.pressure')], ['solar_radiation', t('admin.sensor.solar_radiation')], ['uv_index', t('admin.sensor.uv_index')],
  ['lightning_distance', t('admin.sensor.lightning_distance')], ['lightning_time', t('admin.sensor.lightning_time')], ['lightning_count', t('admin.sensor.lightning_count')],
];

const METRIC_FIELDS = (): [MetricKey, string][] => (Object.keys(METRIC_META) as MetricKey[]).map(k => [k, metricLabel(k)]);

const COMPARISONS = (): [keyof AlertCondition, string][] => [
  ['above', t('admin.cmpAbove')], ['below', t('admin.cmpBelow')], ['at_least', t('admin.cmpAtLeast')], ['at_most', t('admin.cmpAtMost')], ['equals', t('admin.cmpEquals')],
];

const newCondition = (): AlertCondition => ({ sensor: SENSOR_FIELDS()[0][0], above: 0 });
const newRule = (): AlertRule => ({ id: '', label: '', description: '', level: 'warning', message: '', all: [newCondition()] });
const newDevice = (): Device => ({ id: '', name: '', short: '', role: '', battery: null, signal: null, metrics: [] });

export function AdminScreen({ onSession }: { onSession: (s: AdminSession) => void }) {
  const { data, error: loadError } = useApi<AdminSettings>('/api/admin/settings');
  const { lang, setLang } = useContext(LangContext);
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

  if (loadError) return <div className="admin-page"><div className="center-msg">{t('admin.loadError', { error: loadError })}</div></div>;
  if (!data) return <div className="admin-page"><div className="center-msg">{t('app.loading')}</div></div>;

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
      setError(translateApiError((e as Error).message));
      setSaving(false);
    }
  };

  const logout = async () => {
    await postJson('/api/admin/logout', {});
    onSession({ loggedIn: false, mustChangePassword: false });
    go({ screen: 'dash' });
  };

  if (restarting) {
    return <div className="auth-page"><div className="card lg auth-card center-msg">{t('admin.restarting')}</div></div>;
  }

  return (
    <div className="admin-page">
      <div className="header">
        <div className="title">{t('admin.title')}</div>
        <div className="row" style={{ border: 0, padding: 0, gap: 8 }}>
          <div className="segs inset" role="radiogroup" aria-label={t('settings.language')}>
            {(['de', 'en'] as Lang[]).map(l => (
              <button key={l} type="button" role="radio" aria-checked={lang === l} className={'seg xs' + (lang === l ? ' on' : '')}
                onClick={() => setLang(l)}>{l === 'de' ? 'Deutsch' : 'English'}</button>
            ))}
          </div>
          <button type="button" className="btn-ghost" onClick={() => go({ screen: 'adminPassword' })}>{t('adminPassword.title')}</button>
          <button type="button" className="btn-ghost" onClick={logout}>{t('admin.logout')}</button>
          <button type="button" className="btn-ghost" onClick={() => go({ screen: 'dash' })}>{t('admin.toDashboard')}</button>
        </div>
      </div>

      <form onSubmit={submit} className="stack">
        <section className="card lg stack">
          <div className="eyebrow"><span>{t('admin.ha')}</span></div>
          <Field label={t('admin.haUrl')} locked={data.locked.haUrl} lockedReason={data.locked.haUrlEnv ? t('admin.lockedEnvUrl') : undefined}>
            <input className="input" value={haUrl} onChange={e => setHaUrl(e.target.value)} disabled={data.locked.haUrl}
              placeholder="http://homeassistant.local:8123" />
          </Field>
          <Field label={`${t('admin.token')}${data.homeassistant.tokenSet ? t('admin.tokenSetSuffix') : ''}`} locked={data.locked.haToken}
            lockedReason={data.locked.haTokenEnv ? t('admin.lockedEnvToken') : undefined}>
            <input className="input" type="password" value={haToken} onChange={e => setHaToken(e.target.value)} disabled={data.locked.haToken}
              placeholder={data.homeassistant.tokenSet ? t('admin.tokenPlaceholderUnchanged') : t('admin.tokenPlaceholderEnter')} autoComplete="off" />
          </Field>
        </section>

        <section className="card lg stack">
          <div className="eyebrow"><span>{t('admin.forecast')}</span></div>
          <Field label={t('admin.dwdStationId')} locked={data.locked.dwdStationId}>
            <input className="input" value={dwdStationId} onChange={e => setDwdStationId(e.target.value)} disabled={data.locked.dwdStationId} placeholder={t('admin.egStationId')} />
          </Field>
          <Field label={t('admin.biasHours')} locked={data.locked.dwdStationId}>
            <input className="input" type="number" min={0} max={24} value={biasHours} disabled={data.locked.dwdStationId}
              onChange={e => setBiasHours(Number(e.target.value))} />
          </Field>
          <Field label={t('admin.forecastEntity')} locked={data.locked.forecastEntity}>
            <input className="input" value={entity} onChange={e => setEntity(e.target.value)} disabled={data.locked.forecastEntity} placeholder="weather.forecast_home" />
          </Field>
          <Field label={t('admin.sourceLabel')} locked={false}>
            <input className="input" value={label} onChange={e => setLabel(e.target.value)} placeholder={t('admin.egDwd')} />
          </Field>
        </section>

        <section className="card lg stack">
          <div className="eyebrow"><span>{t('admin.sensors')}</span></div>
          {SENSOR_FIELDS().map(([key, labelText]) => (
            <Field key={key} label={labelText} locked={!!data.locked.sensors[key]}>
              <input className="input" value={sensors[key] || ''} disabled={!!data.locked.sensors[key]}
                onChange={e => setSensors({ ...sensors, [key]: e.target.value })} placeholder={`sensor.${key}`} />
            </Field>
          ))}
        </section>

        <section className="card lg stack">
          <div className="eyebrow"><span>{t('admin.station')}</span></div>
          <Field label={t('admin.name')} locked={data.locked.stationName}>
            <input className="input" value={stationName} onChange={e => setStationName(e.target.value)} disabled={data.locked.stationName} />
          </Field>
          <Field label={t('admin.subtitle')} locked={data.locked.stationSubtitle}>
            <input className="input" value={stationSubtitle} onChange={e => setStationSubtitle(e.target.value)} disabled={data.locked.stationSubtitle} />
          </Field>
          <Field label={t('admin.altitude')} locked={data.locked.stationAltitude}>
            <input className="input" type="number" value={stationAltitude} disabled={data.locked.stationAltitude}
              onChange={e => setStationAltitude(e.target.value === '' ? '' : Number(e.target.value))} />
          </Field>
          <Field label={t('admin.since')} locked={data.locked.stationSince}>
            <input className="input" value={stationSince} onChange={e => setStationSince(e.target.value)} disabled={data.locked.stationSince} placeholder="2024-04-01" />
          </Field>
          <div className="row" style={{ padding: '12px 0' }}><span className="k">{t('admin.timezone')}</span><span className="v" style={{ fontWeight: 500 }}>{data.timezone}</span></div>
          {data.demo && <div className="row" style={{ padding: '12px 0' }}><span className="k">{t('admin.dataSource')}</span><span className="v" style={{ fontWeight: 500 }}>{t('admin.demoMode')}</span></div>}

          <div className="field">
            <label className="label">{t('admin.devices')}{data.locked.stationDevices && <span className="faint"> · {t('admin.lockedConfig')}</span>}</label>
            <div className="stack">
              {devices.map((d, i) => (
                <DeviceEditor key={i} device={d} locked={data.locked.stationDevices}
                  onChange={nd => setDevices(devices.map((x, j) => (j === i ? nd : x)))}
                  onRemove={() => setDevices(devices.filter((_, j) => j !== i))} />
              ))}
            </div>
            {!data.locked.stationDevices && (
              <button type="button" className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setDevices([...devices, newDevice()])}>{t('admin.addDevice')}</button>
            )}
          </div>
        </section>

        <section className="card lg stack">
          <div className="eyebrow">
            <span>{t('admin.alertsHeader')}</span>
            {!data.locked.alerts && <button type="button" className="btn-ghost" onClick={() => setAlerts(data.defaultAlerts)}>{t('admin.restoreDefaults')}</button>}
          </div>
          {data.locked.alerts && <div className="note">{t('admin.alertsLocked')}</div>}
          <div className="stack">
            {alerts.map((r, i) => (
              <RuleEditor key={i} rule={r} locked={data.locked.alerts}
                onChange={nr => setAlerts(alerts.map((x, j) => (j === i ? nr : x)))}
                onRemove={() => setAlerts(alerts.filter((_, j) => j !== i))} />
            ))}
          </div>
          {!data.locked.alerts && (
            <button type="button" className="btn-ghost" onClick={() => setAlerts([...alerts, newRule()])}>{t('admin.addRule')}</button>
          )}
        </section>

        {error && <div className="form-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={saving}>{t('admin.save')}</button>
      </form>
    </div>
  );
}

function Field({ label, locked, lockedReason, children }: { label: string; locked: boolean; lockedReason?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="label">{label}{locked && <span className="faint"> · {lockedReason || t('admin.lockedConfig')}</span>}</label>
      {children}
    </div>
  );
}

function DeviceEditor({ device, locked, onChange, onRemove }: { device: Device; locked: boolean; onChange: (d: Device) => void; onRemove: () => void }) {
  return (
    <div className="card stack">
      <div className="row" style={{ border: 0, padding: 0 }}>
        <span className="label" style={{ fontWeight: 500 }}>{device.name || t('admin.newDevice')}</span>
        {!locked && <button type="button" className="btn-ghost" onClick={onRemove}>{t('admin.remove')}</button>}
      </div>
      <Field label={t('admin.id')} locked={locked}><input className="input" value={device.id} disabled={locked} onChange={e => onChange({ ...device, id: e.target.value })} /></Field>
      <Field label={t('admin.name')} locked={locked}><input className="input" value={device.name} disabled={locked} onChange={e => onChange({ ...device, name: e.target.value })} /></Field>
      <Field label={t('admin.role')} locked={locked}><input className="input" value={device.role} disabled={locked} onChange={e => onChange({ ...device, role: e.target.value })} placeholder={t('admin.rolePlaceholder')} /></Field>
      <Field label={t('admin.shortName')} locked={locked}><input className="input" value={device.short} disabled={locked} onChange={e => onChange({ ...device, short: e.target.value })} /></Field>
      <Field label={t('admin.batteryEntity')} locked={locked}>
        <input className="input" value={device.battery || ''} disabled={locked} onChange={e => onChange({ ...device, battery: e.target.value || null })} placeholder="sensor.xxx_battery" />
      </Field>
      <Field label={t('admin.signalEntity')} locked={locked}>
        <input className="input" value={device.signal || ''} disabled={locked} onChange={e => onChange({ ...device, signal: e.target.value || null })} placeholder="sensor.xxx_signal" />
      </Field>
      <div className="field">
        <label className="label">{t('admin.metrics')}</label>
        <div className="chips">
          {METRIC_FIELDS().map(([k, l]) => (
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
  return (['above', 'below', 'at_least', 'at_most', 'equals'] as (keyof AlertCondition)[]).find(k => c[k] != null) || 'above';
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
        {SENSOR_FIELDS().map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        <option value="__entity__">{t('admin.customEntity')}</option>
      </select>
      {isEntity && (
        <input className="input" style={{ width: 'auto' }} disabled={locked} value={cond.entity || ''} onChange={e => onChange({ ...cond, entity: e.target.value })} placeholder="sensor.xxx" />
      )}
      <select className="input" style={{ width: 'auto' }} disabled={locked} value={cmp} onChange={e => setCmp(e.target.value as keyof AlertCondition)}>
        {COMPARISONS().map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <input className="input" style={{ width: 80 }} disabled={locked} type="number" value={val} onChange={e => onChange({ ...cond, [cmp]: Number(e.target.value) })} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
        <input type="checkbox" disabled={locked} checked={hasRecent}
          onChange={e => {
            if (e.target.checked) onChange({ ...cond, recent: { sensor: SENSOR_FIELDS()[0][0], minutes: 30 } });
            else { const { recent: _recent, ...rest } = cond; onChange(rest); }
          }} />
        {t('admin.onlyIfRecent')}
      </label>
      {hasRecent && cond.recent && (
        <>
          <select className="input" style={{ width: 'auto' }} disabled={locked} value={cond.recent.sensor || ''}
            onChange={e => onChange({ ...cond, recent: { sensor: e.target.value, minutes: cond.recent?.minutes } })}>
            {SENSOR_FIELDS().map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input className="input" style={{ width: 70 }} disabled={locked} type="number" value={cond.recent.minutes ?? 30}
            onChange={e => onChange({ ...cond, recent: { ...cond.recent, minutes: Number(e.target.value) } })} />
          <span className="faint" style={{ fontSize: 13 }}>{t('admin.minutesAbbrev')}</span>
        </>
      )}
      {!locked && <button type="button" className="btn-ghost" onClick={onRemove}>{t('admin.remove')}</button>}
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
        <span className="label" style={{ fontWeight: 500 }}>{rule.label || t('admin.newRule')}</span>
        {!locked && <button type="button" className="btn-ghost" onClick={onRemove}>{t('admin.remove')}</button>}
      </div>
      <Field label={t('admin.label')} locked={locked}><input className="input" value={rule.label} disabled={locked} onChange={e => onChange({ ...rule, label: e.target.value })} /></Field>
      <Field label={t('admin.description')} locked={locked}><input className="input" value={rule.description} disabled={locked} onChange={e => onChange({ ...rule, description: e.target.value })} /></Field>
      <div className="row" style={{ flexWrap: 'wrap', gap: 16, border: 0, padding: 0 }}>
        <Field label={t('admin.level')} locked={locked}>
          <div className="segs inset">
            <button type="button" disabled={locked} className={'seg xs' + (rule.level === 'warning' ? ' on' : '')} onClick={() => onChange({ ...rule, level: 'warning' })}>{t('admin.levelWarning')}</button>
            <button type="button" disabled={locked} className={'seg xs' + (rule.level === 'info' ? ' on' : '')} onClick={() => onChange({ ...rule, level: 'info' })}>{t('admin.levelInfo')}</button>
          </div>
        </Field>
        <Field label={t('admin.combination')} locked={locked}>
          <div className="segs inset">
            <button type="button" disabled={locked} className={'seg xs' + (mode === 'all' ? ' on' : '')} onClick={() => onChange({ ...rule, all: conds, any: undefined })}>{t('admin.all')}</button>
            <button type="button" disabled={locked} className={'seg xs' + (mode === 'any' ? ' on' : '')} onClick={() => onChange({ ...rule, any: conds, all: undefined })}>{t('admin.any')}</button>
          </div>
        </Field>
      </div>
      <Field label={t('admin.banner')} locked={locked}>
        <input className="input" value={rule.banner || ''} disabled={locked} onChange={e => onChange({ ...rule, banner: e.target.value })} placeholder={rule.label} />
      </Field>
      <Field label={t('admin.message')} locked={locked}>
        <input className="input" value={rule.message} disabled={locked} onChange={e => onChange({ ...rule, message: e.target.value })} placeholder={t('admin.messagePlaceholder')} />
      </Field>
      <div className="field">
        <label className="label">{t('admin.conditions')}</label>
        <div className="stack" style={{ gap: 0 }}>
          {conds.map((c, i) => (
            <ConditionEditor key={i} cond={c} locked={locked}
              onChange={nc => setConds(conds.map((x, j) => (j === i ? nc : x)))}
              onRemove={() => setConds(conds.filter((_, j) => j !== i))} />
          ))}
        </div>
        {!locked && (
          <button type="button" className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setConds([...conds, newCondition()])}>{t('admin.addCondition')}</button>
        )}
      </div>
    </div>
  );
}
