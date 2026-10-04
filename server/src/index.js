import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadConfig } from './config.js';
import { HomeAssistantSource } from './ha.js';
import { DemoSource, DEMO_SENSORS, DEMO_DEVICES } from './demo.js';
import { DwdForecast } from './dwd.js';
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
  stationDevices: !!cfg.station.devices.length,
};
{
  const s = admin.getSettings();
  if (!cfg.homeassistant.url) cfg.homeassistant.url = s.homeassistant.url;
  if (!cfg.homeassistant.token) cfg.homeassistant.token = s.homeassistant.token;
  for (const [k, v] of Object.entries(s.sensors)) if (!cfg.sensors[k] && v) cfg.sensors[k] = v;
  if (!cfg.forecast.entity) cfg.forecast.entity = s.forecast.entity || null;
  if (!cfg.forecast.dwdStationId) cfg.forecast.dwdStationId = s.forecast.dwdStationId || null;
  if (!locked.alerts && s.alerts) cfg.alerts = s.alerts;
  if (!locked.stationName && s.station.name) cfg.station.name = s.station.name;
  if (!locked.stationSubtitle && s.station.subtitle) cfg.station.subtitle = s.station.subtitle;
  if (!locked.stationAltitude && s.station.altitude_m != null) cfg.station.altitude_m = s.station.altitude_m;
  if (!locked.stationSince && s.station.since) cfg.station.since = s.station.since;
  if (!locked.stationDevices && s.station.devices.length) cfg.station.devices = s.station.devices;
}

// No HA credentials anywhere (neither config.yaml nor the admin page) –
// force demo mode instead of crashing, so the admin login page is still
// reachable to set it up. This also covers config.yaml being entirely
// absent, which config.js already defaults to demo mode for on its own.
// `needsSetup` (exposed via /api/config) is true exactly when demo mode is
// active *because* nothing is configured – not when `server.demo: true` was
// deliberately set in config.yaml alongside real HA credentials being beside
// the point – so the frontend can land first-time visitors on the admin page
// without ever bothering a deployment that's fully configured via
// config.yaml and simply doesn't use the admin page at all.
const haConfigured = !!(cfg.homeassistant.url && cfg.homeassistant.token);
if (!haConfigured) cfg.server.demo = true;
const needsSetup = cfg.server.demo && !haConfigured;
if (needsSetup) {
  console.warn('[server] Home Assistant is not configured yet (config.yaml or the admin page) – starting in DEMO MODE until set up at /#/admin/login');
}

let source;
if (cfg.server.demo) {
  console.log('[server] DEMO MODE – synthetic data, Home Assistant is not contacted');
  if (!Object.keys(cfg.sensors).length) cfg.sensors = { ...DEMO_SENSORS };
  if (!cfg.station.devices.length) cfg.station.devices = DEMO_DEVICES;
  if (!cfg.station.since) cfg.station.since = '2024-04-01';
  if (!cfg.station.subtitle) cfg.station.subtitle = 'Demo-Daten';
  if (cfg.station.name === 'Wetterstation') cfg.station.name = 'Wetterstation Demo';
  cfg.forecast.label ??= 'Demo';
  source = new DemoSource(cfg.sensors);
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
  const compressible = /json|text|javascript|svg/.test(type) && buf.length > 1024;
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
      const { username, password } = await readJsonBody(req);
      const result = admin.verifyLogin(clientIp(req), String(username || ''), String(password || ''));
      if (!result.ok) return send(req, res, 401, { error: result.error });
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
  '/healthz': async () => ({ ok: true, connected: source.connected, lastMessage: source.lastMessage }),
};

const publicDir = cfg.server.public_dir;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/admin/')) return handleAdmin(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, { error: 'read-only' });

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
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(publicDir, 'index.html');
  if (!fs.existsSync(file)) return send(req, res, 404, 'Frontend not built', 'text/plain');
  const ext = path.extname(file);
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  send(req, res, 200, fs.readFileSync(file), MIME[ext] || 'application/octet-stream', { 'Cache-Control': cache });
});

server.listen(cfg.server.port, () => console.log(`[server] listening on :${cfg.server.port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); process.exit(0); });
