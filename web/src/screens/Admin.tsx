import { useEffect, useState } from 'react';
import { type AdminSession, type AdminSettings, postJson, useApi } from '../lib';
import { go } from '../App';

const SENSOR_FIELDS: [string, string][] = [
  ['temperature', 'Temperatur'], ['feels_like', 'Gefühlte Temperatur'], ['dew_point', 'Taupunkt'], ['humidity', 'Luftfeuchte'],
  ['wind_speed', 'Windgeschwindigkeit'], ['wind_gust', 'Windböe'], ['wind_direction', 'Windrichtung'],
  ['rain_rate', 'Regenrate'], ['rain_event', 'Regen (Ereignis)'], ['rain_daily', 'Regen (Tag)'],
  ['rain_weekly', 'Regen (Woche)'], ['rain_monthly', 'Regen (Monat)'], ['rain_yearly', 'Regen (Jahr)'],
  ['pressure', 'Luftdruck'], ['solar_radiation', 'Solarstrahlung'], ['uv_index', 'UV-Index'],
  ['lightning_distance', 'Blitz-Entfernung'], ['lightning_time', 'Letzter Blitz (Zeitstempel)'], ['lightning_count', 'Blitze (Tageszähler)'],
];

export function AdminScreen({ onSession }: { onSession: (s: AdminSession) => void }) {
  const { data, error: loadError } = useApi<AdminSettings>('/api/admin/settings');
  const [haUrl, setHaUrl] = useState('');
  const [haToken, setHaToken] = useState('');
  const [sensors, setSensors] = useState<Record<string, string>>({});
  const [entity, setEntity] = useState('');
  const [dwdStationId, setDwdStationId] = useState('');
  const [biasHours, setBiasHours] = useState(6);
  const [label, setLabel] = useState('');
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
    go({ screen: 'adminLogin' });
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
          <Field label="URL" locked={data.locked.haUrl}>
            <input className="input" value={haUrl} onChange={e => setHaUrl(e.target.value)} disabled={data.locked.haUrl}
              placeholder="http://homeassistant.local:8123" />
          </Field>
          <Field label={`Long-Lived Access Token${data.homeassistant.tokenSet ? ' (bereits gesetzt)' : ''}`} locked={data.locked.haToken}>
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

        {error && <div className="form-error">{error}</div>}
        <button className="btn-primary" type="submit" disabled={saving}>Speichern &amp; neu starten</button>
      </form>
    </div>
  );
}

function Field({ label, locked, children }: { label: string; locked: boolean; children: React.ReactNode }) {
  return (
    <div className="field">
      <label className="label">{label}{locked && <span className="faint"> · in config.yaml festgelegt</span>}</label>
      {children}
    </div>
  );
}
