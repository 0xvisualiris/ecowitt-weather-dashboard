import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadConfig, SENSOR_KEYS } from './config.js';
import { HomeAssistantSource } from './ha.js';
import { EcowittSource } from './ecowitt.js';
import { DemoSource, DEMO_SENSORS, DEMO_DEVICES } from './demo.js';
import { DwdForecast } from './dwd.js';
import { RadarSource } from './radar.js';
import { WeatherService, METRICS } from './service.js';
import { AlertEngine } from './alerts.js';
import { AdminStore } from './admin.js';

let cfg;
try { cfg = loadConfig(); } catch (e) { console.error(e.message); process.exit(1); }

if (cfg.station.timezone) process.env.TZ = cfg.station.timezone;

// ---------------- Admin-configured settings ----------------
// config.yaml always wins, per field; anything it leaves blank can be set
// via the admin page instead, persisted in DATA_DIR/admin.json. `locked`
// records which fields config.yaml already fixed, so the admin UI can't
// touch them either (checked again in handleAdmin, not just hidden client-side).
const admin = new AdminStore(cfg.server.data_dir);
const locked = {
  source: cfg._locked.source,
  ecowittHost: !!cfg.ecowitt.host,
  ecowittHostEnv: cfg._locked.ecowittHostEnv,
  haUrl: !!cfg.homeassistant.url,
  haUrlEnv: cfg._locked.haUrlEnv,
  haToken: !!cfg.homeassistant.token,
  haTokenEnv: cfg._locked.haTokenEnv,
  sensors: Object.fromEntries(Object.keys(cfg.sensors).map(k => [k, true])),
  forecastEntity: !!cfg.forecast.entity,
  dwdStationId: !!cfg.forecast.dwdStationId,
  alerts: cfg._locked.alerts,
  stationName: cfg._locked.stationName,
  stationSubtitle: cfg._locked.stationSubtitle,
  stationAltitude: cfg._locked.stationAltitude,
  stationSince: cfg._locked.stationSince,
  stationPublicLocation: cfg._locked.stationPublicLocation,
  stationDevices: !!cfg.station.devices.length,
};
{
  const s = admin.getSettings();
  if (!cfg.homeassistant.url) cfg.homeassistant.url = s.homeassistant.url;
  if (!cfg.homeassistant.token) cfg.homeassistant.token = s.homeassistant.token;
  if (!locked.source && s.source) cfg.source = s.source;
  if (!cfg.ecowitt.host) cfg.ecowitt.host = s.ecowitt.host;
  for (const [k, v] of Object.entries(s.sensors)) if (!cfg.sensors[k] && v) cfg.sensors[k] = v;
  if (!cfg.forecast.entity) cfg.forecast.entity = s.forecast.entity || null;
  if (!cfg.forecast.dwdStationId) cfg.forecast.dwdStationId = s.forecast.dwdStationId || null;
  if (!locked.alerts && s.alerts) cfg.alerts = s.alerts;
  if (!locked.stationName && s.station.name) cfg.station.name = s.station.name;
  if (!locked.stationSubtitle && s.station.subtitle) cfg.station.subtitle = s.station.subtitle;
  if (!locked.stationAltitude && s.station.altitude_m != null) cfg.station.altitude_m = s.station.altitude_m;
  if (!locked.stationSince && s.station.since) cfg.station.since = s.station.since;
  if (!locked.stationPublicLocation && s.station.publicLocation) cfg.station.publicLocation = s.station.publicLocation;
  if (!locked.stationDevices && s.station.devices.length) cfg.station.devices = s.station.devices;
}

// Pick the data source: whatever config.yaml / the admin page chose,
// otherwise whichever one is configured (Home Assistant first, so existing
// setups never change behaviour). Nothing configured anywhere – force demo
// mode instead of crashing, so the admin login page is still reachable to set
// it up. This also covers config.yaml being entirely absent: config.js then
// leaves demo mode off, so this is the only fallback. `needsSetup` (exposed via
// /api/config) is true exactly when demo mode is active *because* nothing is
// configured – not when `server.demo: true` was deliberately set in
// config.yaml alongside a real source – so the frontend can land first-time
// visitors on the admin page without ever bothering a deployment that's fully
// configured via config.yaml and simply doesn't use the admin page at all.
const haConfigured = !!(cfg.homeassistant.url && cfg.homeassistant.token);
const ecowittConfigured = !!cfg.ecowitt.host;
cfg.source ??= haConfigured ? 'homeassistant' : ecowittConfigured ? 'ecowitt' : 'homeassistant';
const sourceConfigured = cfg.source === 'ecowitt' ? ecowittConfigured : haConfigured;
if (!sourceConfigured) cfg.server.demo = true;
const needsSetup = cfg.server.demo && !sourceConfigured;
if (needsSetup) {
  const what = cfg.source === 'ecowitt' ? 'the Ecowitt gateway address' : 'Home Assistant';
  console.warn(`[server] ${what} is not configured yet (config.yaml or the admin page) – starting in DEMO MODE until set up at /#/admin/login`);
}

let source;
if (cfg.server.demo) {
  console.log('[server] DEMO MODE – synthetic data, no weather station is contacted');
  if (!Object.keys(cfg.sensors).length) cfg.sensors = { ...DEMO_SENSORS };
  if (!cfg.station.devices.length) cfg.station.devices = DEMO_DEVICES;
  if (!cfg.station.since) cfg.station.since = '2024-04-01';
  if (!cfg.station.subtitle) cfg.station.subtitle = 'Demo data';
  if (cfg.station.name === 'Weather Station') cfg.station.name = 'Weather Station Demo';
  cfg.forecast.label ??= 'Demo';
  source = new DemoSource(cfg.sensors);
} else if (cfg.source === 'ecowitt') {
  source = new EcowittSource({ ...cfg.ecowitt, dataDir: cfg.server.data_dir });
  // The gateway itself says which sensors exist; ask it once so the dashboard
  // shows exactly the cards it can fill. The answer is cached in DATA_DIR, so
  // a restart while the gateway is unreachable still knows them.
  const cacheFile = path.join(cfg.server.data_dir, 'ecowitt', 'detected.json');
  let detected = null;
  try {
    detected = await source.probe();
    try { fs.writeFileSync(cacheFile, JSON.stringify(detected)); } catch { /* not fatal */ }
  } catch (e) {
    try { detected = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { /* first start */ }
    console.warn(`[ecowitt] gateway ${cfg.ecowitt.host} not reachable at startup (${e.cause?.message || e.message})` +
      (detected ? ' – using the sensors found last time' : ' – showing every sensor until it answers'));
    if (detected) { source.model = detected.model; source.sensors = detected.sensors; }
  }
  // Entity ids of this source are the sensor keys themselves; config.yaml
  // `sensors:` entries (whatever their value) narrow the selection instead.
  // The admin page keeps showing (and saving) the Home Assistant mapping.
  cfg.configuredSensors = cfg.sensors;
  const keys = Object.keys(cfg.sensors).length ? Object.keys(cfg.sensors) : (detected?.keys ?? SENSOR_KEYS);
  cfg.sensors = Object.fromEntries(keys.filter(k => SENSOR_KEYS.includes(k)).map(k => [k, k]));
  if (!cfg.station.devices.length) cfg.station.devices = source.autoDevices();
  console.log(`[ecowitt] gateway ${cfg.ecowitt.host}${source.model ? ` (${source.model})` : ''}: ${Object.keys(cfg.sensors).join(', ')}`);
} else {
  const extra = cfg.station.devices.flatMap(d => [d.battery, d.signal]).filter(Boolean);
  const alertEntities = cfg.alerts.flatMap(a => [...(a.all || []), ...(a.any || [])])
    .flatMap(c => [c.entity, c.recent?.entity]).filter(Boolean);
  const ids = [...new Set([...Object.values(cfg.sensors), ...extra, ...alertEntities,
    cfg.forecast.entity].filter(Boolean))];
  source = new HomeAssistantSource({ url: cfg.homeassistant.url, token: cfg.homeassistant.token, entityIds: ids, forecastEntity: cfg.forecast.entity });
}

source.on('config', c => {
  if (!cfg.station.timezone && c.time_zone) {
    process.env.TZ = c.time_zone;
    console.log(`[server] using Home Assistant time zone ${c.time_zone}`);
  }
});

let dwd = null;
if (cfg.forecast.dwdStationId) {
  dwd = new DwdForecast(cfg.forecast.dwdStationId, { label: cfg.forecast.label });
  dwd.start();
}

// Nationwide, not tied to any per-deployment config — always on, same as
// the rest of the public API being free/read-only with no setup required.
const radar = new RadarSource();
radar.start();

const svc = new WeatherService(cfg, source, dwd);
const alerts = new AlertEngine(cfg, svc);
let evalTimer = null;
source.on('update', () => {
  if (evalTimer) return;
  evalTimer = setTimeout(() => { evalTimer = null; alerts.evaluate(); }, 2000);
});
setInterval(() => alerts.evaluate(), 30000);
source.start();

// ---------------- HTTP ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'",
};

function send(req, res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const headers = { 'Content-Type': type, ...SECURITY_HEADERS, ...extra };
  // octet-stream here is specifically the radar grid: a sparse byte array
  // (mostly 0/255) that gzips very well, unlike a typical opaque binary blob.
  const compressible = /json|text|javascript|svg|octet-stream/.test(type) && buf.length > 1024;
  if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(status, headers);
    res.end(zlib.gzipSync(buf));
  } else {
    res.writeHead(status, headers);
    res.end(buf);
  }
}

// ---------------- Admin API ----------------
// The only write path and the only authenticated surface in the server.
// Carved out of the global GET/HEAD-only rule below, nothing else changes:
// the rest of /api/* stays exactly as read-only as before.
const SESSION_COOKIE = 'admin_session';

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req) { return req.socket.remoteAddress || 'unknown'; }

async function readJsonBody(req, maxBytes = 20000) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBytes) throw Object.assign(new Error('request body too large'), { status: 413 });
  }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw Object.assign(new Error('invalid JSON body'), { status: 400 }); }
}

function requireSession(req, requirePasswordChanged) {
  const session = admin.verifySession(parseCookies(req)[SESSION_COOKIE]);
  if (!session) throw Object.assign(new Error('not logged in'), { status: 401 });
  if (requirePasswordChanged && session.mustChangePassword) {
    throw Object.assign(new Error('password change required'), { status: 403 });
  }
  return session;
}

async function handleAdmin(req, res, url) {
  try {
    if (url.pathname === '/api/admin/login' && req.method === 'POST') {
      const { username, password, code } = await readJsonBody(req);
      const result = admin.verifyLogin(clientIp(req), String(username || ''), String(password || ''), code ? String(code) : undefined);
      if (!result.ok) {
        // needsTotp without an error is the expected "password was right, now ask for the code" step, not a failure – 200, not 401.
        if (result.needsTotp && !result.error) return send(req, res, 200, { ok: false, needsTotp: true });
        return send(req, res, 401, { error: result.error, needsTotp: result.needsTotp || false });
      }
      return send(req, res, 200, { ok: true, mustChangePassword: result.mustChangePassword },
        'application/json; charset=utf-8', { 'Set-Cookie': `${SESSION_COOKIE}=${result.cookie}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
      admin.logout(); // rotates the session secret – with one admin account, this logs out every session, not just this one
      return send(req, res, 200, { ok: true }, 'application/json; charset=utf-8',
        { 'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`, 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/admin/session' && req.method === 'GET') {
      const session = admin.verifySession(parseCookies(req)[SESSION_COOKIE]);
      return send(req, res, 200, { loggedIn: !!session, mustChangePassword: session?.mustChangePassword ?? false },
        'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/admin/password' && req.method === 'POST') {
      requireSession(req, false);
      const { currentPassword, newPassword } = await readJsonBody(req);
      const result = admin.changePassword(clientIp(req), currentPassword, newPassword);
      if (!result.ok) return send(req, res, 400, { error: result.error });
      // Changing the password rotates the session secret (invalidates every
      // outstanding session), so the caller needs a freshly signed cookie to
      // stay logged in rather than being logged out by their own request.
      return send(req, res, 200, { ok: true }, 'application/json; charset=utf-8',
        { 'Set-Cookie': `${SESSION_COOKIE}=${result.cookie}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/admin/totp/setup' && req.method === 'POST') {
      requireSession(req, true);
      return send(req, res, 200, admin.beginTotpSetup(), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/admin/totp/enable' && req.method === 'POST') {
      requireSession(req, true);
      const { code } = await readJsonBody(req);
      const result = admin.confirmTotpSetup(clientIp(req), String(code || ''));
      if (!result.ok) return send(req, res, 400, { error: result.error });
      return send(req, res, 200, { ok: true }, 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/admin/totp/disable' && req.method === 'POST') {
      requireSession(req, true);
      const { password } = await readJsonBody(req);
      const result = admin.disableTotp(clientIp(req), password);
      if (!result.ok) return send(req, res, 400, { error: result.error });
      return send(req, res, 200, { ok: true }, 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/admin/settings' && req.method === 'GET') {
      requireSession(req, true);
      const timezone = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
      return send(req, res, 200, admin.getPublicSettings(locked, cfg, timezone), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
    }

    if (url.pathname === '/api/admin/settings' && req.method === 'POST') {
      requireSession(req, true);
      const patch = await readJsonBody(req);
      const result = admin.saveSettings(locked, patch);
      if (!result.ok) {
        const status = result.error.includes('DATA_DIR') ? 500 : 400;
        return send(req, res, status, { error: result.error });
      }
      send(req, res, 200, { ok: true, restarting: true }, 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
      // Settings only take effect at boot (cfg/source/svc are built once) –
      // restart like a config.yaml edit would, relying on the container's
      // restart policy, same model the project already uses for config.yaml.
      setTimeout(() => process.exit(0), 300);
      return;
    }

    return send(req, res, 404, { error: 'not found' });
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.warn(`[admin] ${url.pathname}: ${e.message}`);
    return send(req, res, status, { error: e.message });
  }
}

function publicConfig() {
  const metrics = Object.keys(METRICS).filter(m => svc.metricAvailable(m));
  return {
    station: {
      name: cfg.station.name, subtitle: cfg.station.subtitle, altitude_m: cfg.station.altitude_m, since: cfg.station.since,
      // Deliberately coarse (~10 km) and opt-in – see config.js's cfg.station.publicLocation comment.
      // Unlike latitude/longitude, this one is meant to reach the browser.
      publicLocation: cfg.station.publicLocation,
      devices: cfg.station.devices.map(d => ({ id: d.id, name: d.name, short: d.short, role: d.role, metrics: d.metrics })),
    },
    timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    demo: cfg.server.demo,
    needsSetup,
    metrics,
    sensors: Object.keys(cfg.sensors),
    hasForecast: !!(cfg.forecast.entity || cfg.forecast.dwdStationId || cfg.server.demo),
    alertRules: cfg.alerts.map(a => ({ id: a.id, label: a.label, description: a.description, level: a.level })),
    ui: cfg.ui,
  };
}

const routes = {
  '/api/config': async () => publicConfig(),
  '/api/current': async () => ({ ...(await svc.current()), alerts: alerts.active() }),
  '/api/history': async q => svc.history(q.get('metric'), q.get('range') || 'day'),
  '/api/detail': async q => svc.detail(q.get('metric')),
  '/api/records': async () => svc.records(),
  '/api/alerts': async () => alerts.view(),
  '/api/forecast/hourly': async () => svc.forecastHourly(),
  '/api/radar': async () => {
    if (!radar.latest) throw Object.assign(new Error('radar data not available yet'), { status: 503 });
    const { width, height, timestamp } = radar.latest;
    // `frames`: timestamps of every composite held (oldest first), each fetchable as /api/radar/grid?t=<timestamp>
    return { width, height, timestamp, frames: radar.frames.map(f => f.timestamp) };
  },
  '/healthz': async () => ({ ok: true, connected: source.connected, lastMessage: source.lastMessage }),
};

// The frontend (web/): plain HTML, CSS and JavaScript modules, served as they are.
const publicDir = cfg.server.public_dir;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/admin/')) return handleAdmin(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, { error: 'read-only' });

  // Raw binary (one byte per grid cell), not JSON — the generic `routes`
  // table below always wraps its result as JSON, so this one short-circuits
  // before it, same way /api/admin/ does above.
  if (url.pathname === '/api/radar/grid') {
    if (!radar.latest) return send(req, res, 503, { error: 'radar data not available yet' });
    // ?t=<timestamp> names one past composite, which never changes again and
    // can be cached; without it, the moving "latest" one, which can't.
    const t = url.searchParams.get('t');
    if (t != null) {
      const frame = radar.frame(Number(t));
      if (!frame) return send(req, res, 404, { error: 'no radar frame for that time' });
      return send(req, res, 200, Buffer.from(frame.grid), 'application/octet-stream', { 'Cache-Control': 'public, max-age=7200, immutable' });
    }
    return send(req, res, 200, Buffer.from(radar.latest.grid), 'application/octet-stream', { 'Cache-Control': 'no-store' });
  }

  const route = routes[url.pathname];
  if (route) {
    try {
      const data = await route(url.searchParams);
      return send(req, res, 200, data, 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
    } catch (e) {
      const status = e.status || 503;
      if (status >= 500) console.warn(`[api] ${url.pathname}: ${e.message}`);
      return send(req, res, status, { error: e.message });
    }
  }
  if (url.pathname.startsWith('/api/')) return send(req, res, 404, { error: 'not found' });

  // static files with SPA fallback
  let file = path.normalize(path.join(publicDir, decodeURIComponent(url.pathname)));
  if (!file.startsWith(path.normalize(publicDir))) return send(req, res, 403, 'forbidden', 'text/plain');
  // Before v2.0.0 this design was previewed at /himmel/; send old links and home-screen apps to the root.
  if (url.pathname === '/himmel' || url.pathname.startsWith('/himmel/')) {
    res.writeHead(301, { Location: '/' + url.search });
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(publicDir, 'index.html');
  if (!fs.existsSync(file)) return send(req, res, 404, 'Frontend not built', 'text/plain');
  const ext = path.extname(file);
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  send(req, res, 200, withStationName(file, fs.readFileSync(file)), MIME[ext] || 'application/octet-stream', { 'Cache-Control': cache });
});

// The page and manifest ship with "Weather Station" as a placeholder; put the
// configured station name in, so the browser tab, the header before its
// script runs, and the name of an app added to a home screen all show it.
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function withStationName(file, buf) {
  const name = cfg.station.name;
  const base = path.basename(file);
  if (base === 'index.html') {
    const n = escapeHtml(name);
    return Buffer.from(buf.toString('utf8')
      .replace(/<title>[^<]*<\/title>/, `<title>${n}</title>`)
      .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*/, `$1${n}`)
      .replace(/(id="stationName">)[^<]*/, `$1${n}`));
  }
  if (base === 'manifest.webmanifest') {
    try { return Buffer.from(JSON.stringify({ ...JSON.parse(buf.toString('utf8')), name, short_name: name })); } catch { return buf; }
  }
  return buf;
}

server.listen(cfg.server.port, () => console.log(`[server] listening on :${cfg.server.port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
