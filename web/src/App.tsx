import { useEffect, useMemo, useState } from 'react';
import { type AdminSession, type AppConfig, type Current, type MetricKey, type Range, type Units, UnitsContext, setTimeZone, useApi, longDate, clock, hhmm, fmtDeviceReading, fmtSignal } from './lib';
import { LangContext, setLang as setLibLang, t, type Lang } from './i18n';
import { Dashboard } from './screens/Dashboard';
import { HistoryScreen } from './screens/History';
import { DetailScreen } from './screens/Detail';
import { AlertsScreen } from './screens/Alerts';
import { SettingsScreen } from './screens/Settings';
import { AdminLoginScreen } from './screens/AdminLogin';
import { AdminPasswordScreen } from './screens/AdminPassword';
import { AdminScreen } from './screens/Admin';
import { RadarScreen } from './screens/Radar';

export type Route =
  | { screen: 'dash' }
  | { screen: 'hist'; metric: MetricKey; range: Range }
  | { screen: 'detail'; metric: MetricKey }
  | { screen: 'radar' }
  | { screen: 'alerts' }
  | { screen: 'settings' }
  | { screen: 'adminLogin' }
  | { screen: 'adminPassword' }
  | { screen: 'admin' };

const SLUG = { dash: '', hist: 'verlauf', detail: 'details', radar: 'radar', alerts: 'warnungen', settings: 'einstellungen', admin: 'admin' } as const;

function parseHash(metrics: MetricKey[]): Route {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [a, b] = path.split('/');
  const q = new URLSearchParams(query);
  const m = (x: string | null | undefined) => (metrics.includes(x as MetricKey) ? (x as MetricKey) : metrics[0] ?? 'temp');
  if (a === SLUG.hist) {
    const r = q.get('r') as Range;
    return { screen: 'hist', metric: m(q.get('m')), range: ['day', 'week', 'month', 'year'].includes(r) ? r : 'day' };
  }
  if (a === SLUG.detail) return { screen: 'detail', metric: m(b) };
  if (a === SLUG.radar) return { screen: 'radar' };
  if (a === SLUG.alerts) return { screen: 'alerts' };
  if (a === SLUG.settings) return { screen: 'settings' };
  if (a === SLUG.admin) {
    if (b === 'login') return { screen: 'adminLogin' };
    if (b === 'password') return { screen: 'adminPassword' };
    return { screen: 'admin' };
  }
  return { screen: 'dash' };
}

export function toHash(r: Route) {
  if (r.screen === 'hist') return `#/${SLUG.hist}?m=${r.metric}&r=${r.range}`;
  if (r.screen === 'detail') return `#/${SLUG.detail}/${r.metric}`;
  if (r.screen === 'adminLogin') return `#/${SLUG.admin}/login`;
  if (r.screen === 'adminPassword') return `#/${SLUG.admin}/password`;
  return `#/${SLUG[r.screen]}`;
}
export const go = (r: Route) => { location.hash = toHash(r); };

const UNITS_KEY = 'wetterstation.units';
const LANG_KEY = 'wetterstation.lang';
const kiosk = new URLSearchParams(location.search).has('kiosk');

export function App() {
  const { data: cfg, error: cfgError } = useApi<AppConfig>('/api/config');
  if (!cfg) {
    return <div className="page"><div className="center-msg">{cfgError ? t('app.serverUnreachable', { error: cfgError }) : t('app.loading')}</div></div>;
  }
  return <Loaded cfg={cfg} />;
}

function Loaded({ cfg }: { cfg: AppConfig }) {
  setTimeZone(cfg.timezone);
  const [route, setRoute] = useState<Route>(() => parseHash(cfg.metrics));
  useEffect(() => {
    const on = () => { setRoute(parseHash(cfg.metrics)); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [cfg.metrics]);

  // Language, read once from localStorage and applied to the module-level
  // LANG variable (lib.ts/i18n.ts) synchronously, before anything below
  // renders – same "set it, then render" pattern as setTimeZone() above.
  // LangContext exists so deep components (the switcher in Settings/Admin)
  // can call setLang without prop-drilling; everything else just calls t()
  // directly and picks up the new value because this component re-renders
  // its whole subtree on a language change (nothing downstream is memoized).
  const [lang, setLangState] = useState<Lang>(() => {
    try { return (localStorage.getItem(LANG_KEY) as Lang) || 'de'; } catch { return 'de'; }
  });
  setLibLang(lang);
  const setLang = (l: Lang) => { setLibLang(l); setLangState(l); try { localStorage.setItem(LANG_KEY, l); } catch { /* private mode */ } };
  const langCtx = useMemo(() => ({ lang, setLang }), [lang]);

  // First-ever boot (nothing configured in config.yaml or the admin page):
  // land directly on the admin login instead of an empty demo dashboard.
  // Checked once against the route the page was loaded with, not on every
  // change, so navigating back to the dashboard from the admin page later
  // doesn't bounce right back here.
  useEffect(() => {
    if (cfg.needsSetup && !kiosk && route.screen === 'dash') go({ screen: 'adminLogin' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Admin routes get their own chrome-less pages, but the early return happens
  // below (after every hook has run) to keep hook order stable across
  // navigations between admin and visitor screens – only the /api/current
  // fetch is actually skipped meanwhile (useApi accepts a null url for that).
  const isAdmin = route.screen === 'adminLogin' || route.screen === 'adminPassword' || route.screen === 'admin';

  const [u, setUState] = useState<Units>(() => {
    try { return { ...cfg.ui.default_units, ...JSON.parse(localStorage.getItem(UNITS_KEY) || '{}') }; } catch { return cfg.ui.default_units; }
  });
  const setU = (n: Units) => { setUState(n); try { localStorage.setItem(UNITS_KEY, JSON.stringify(n)); } catch { /* private mode */ } };
  const unitsCtx = useMemo(() => ({ u, setU }), [u]);

  const { data: cur, error: curError, loadedAt } = useApi<Current>(isAdmin ? null : '/api/current', cfg.ui.refresh_seconds * 1000);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  useEffect(() => { document.title = cfg.station.name; }, [cfg.station.name]);

  if (isAdmin) {
    return (
      <LangContext.Provider value={langCtx}>
        <AdminGate screen={route.screen as 'adminLogin' | 'adminPassword' | 'admin'} />
      </LangContext.Provider>
    );
  }

  const staleMs = cfg.ui.stale_after_seconds * 1000;
  const stale = !cur || !!curError || !cur.updated || now - cur.updated > staleMs || now - loadedAt > staleMs;
  const screen = kiosk ? 'dash' : route.screen;

  const nav: [Route['screen'], string][] = [['dash', t('nav.dash')], ['hist', t('nav.hist')], ['detail', t('nav.detail')], ['radar', t('nav.radar')], ['alerts', t('nav.alerts')], ['settings', t('nav.settings')]];
  const navTo = (s: Route['screen']) => {
    const metric = 'metric' in route ? route.metric : cfg.metrics[0];
    if (s === 'hist') go({ screen: 'hist', metric, range: 'day' });
    else if (s === 'detail') go({ screen: 'detail', metric });
    else go({ screen: s } as Route);
  };

  const toggleFullscreen = () => {
    if (!kiosk) return;
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.();
  };

  const devices = cur?.devices ?? cfg.station.devices;

  return (
    <LangContext.Provider value={langCtx}>
      <UnitsContext.Provider value={unitsCtx}>
        <div className="page">
          <header className="header">
            <button className="kiosk-btn stack" style={{ gap: 4, cursor: kiosk ? 'pointer' : 'default' }} onClick={toggleFullscreen} tabIndex={kiosk ? 0 : -1}>
              <div className="title">{cfg.station.name}</div>
              <div className="status">
                <span className={'dot' + (stale ? ' stale' : '')} />
                <span>
                  {stale ? `${t('app.stale')}${cur?.updated ? t('app.lastUpdate', { time: hhmm(cur.updated) }) : ''}` : t('app.live')}
                  {' · '}{longDate(now)}{' · '}{clock(now)}
                </span>
                {cfg.station.subtitle && <span className="faint">{cfg.station.subtitle}</span>}
              </div>
            </button>
            {!kiosk && (
              <nav className="nav" aria-label={t('nav.mainAria')}>
                {nav.map(([k, label]) => (
                  <button key={k} className={'seg' + (screen === k ? ' on' : '')} aria-current={screen === k ? 'page' : undefined} onClick={() => navTo(k)}>{label}</button>
                ))}
                <a href="#/admin/login" className="seg">Admin</a>
              </nav>
            )}
          </header>

          {screen === 'dash' && <Dashboard cfg={cfg} cur={cur} error={curError} />}
          {screen === 'hist' && route.screen === 'hist' && <HistoryScreen cfg={cfg} cur={cur} metric={route.metric} range={route.range} />}
          {screen === 'detail' && route.screen === 'detail' && <DetailScreen cfg={cfg} cur={cur} metric={route.metric} />}
          {screen === 'radar' && <RadarScreen cfg={cfg} />}
          {screen === 'alerts' && <AlertsScreen />}
          {screen === 'settings' && <SettingsScreen cfg={cfg} />}

          {!kiosk && (
            <footer className="footer">
              {devices.map(d => {
                const parts = [d.name];
                if (d.battery) parts.push(t('app.footerBattery', { v: fmtDeviceReading(d.battery) }));
                if (d.signal) parts.push(t('app.footerSignal', { v: fmtSignal(d.signal) }));
                return <span key={d.id}>{parts.join(' · ')}</span>;
              })}
            </footer>
          )}
        </div>
      </UnitsContext.Provider>
    </LangContext.Provider>
  );
}

// Redirects between the three admin screens based on session state. This is
// a UX convenience only – every /api/admin/* endpoint enforces the same
// rules server-side regardless of what the UI shows.
//
// Session state is fetched from the server exactly once, when this page is
// first reached cold (e.g. a bookmark or a fresh #/admin visit). After that,
// login/password-change/logout update `session` directly from their own
// response instead of asking the server again — a POST that just told us
// "the password is changed" already IS the answer; re-fetching it a moment
// later used to race against its own effects (a stale read landing after a
// fresh write could show the old state), bouncing back to a screen that had
// just been completed. Reusing the response we already hold has no such race.
function AdminGate({ screen }: { screen: 'adminLogin' | 'adminPassword' | 'admin' }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/session', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (alive) setSession(j); })
      .catch(e => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, []); // intentionally once – see comment above

  useEffect(() => {
    if (!session) return;
    if (!session.loggedIn && screen !== 'adminLogin') go({ screen: 'adminLogin' });
    else if (session.loggedIn && session.mustChangePassword && screen !== 'adminPassword') go({ screen: 'adminPassword' });
    else if (session.loggedIn && !session.mustChangePassword && screen === 'adminLogin') go({ screen: 'admin' });
  }, [session, screen]);

  if (error) return <div className="auth-page"><div className="center-msg">{t('app.serverUnreachable', { error })}</div></div>;
  if (!session) return <div className="auth-page"><div className="center-msg">{t('app.loading')}</div></div>;
  if (!session.loggedIn) return screen === 'adminLogin' ? <AdminLoginScreen onSession={setSession} /> : null;
  if (session.mustChangePassword) return screen === 'adminPassword' ? <AdminPasswordScreen forced onSession={setSession} /> : null;
  if (screen === 'adminPassword') return <AdminPasswordScreen forced={false} onSession={setSession} />;
  if (screen === 'adminLogin') return null;
  return <AdminScreen onSession={setSession} />;
}
