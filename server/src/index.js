import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadConfig } from './config.js';
import { HomeAssistantSource } from './ha.js';
import { DemoSource, DEMO_SENSORS, DEMO_DEVICES } from './demo.js';
import { WeatherService, METRICS } from './service.js';
import { AlertEngine } from './alerts.js';

let cfg;
try { cfg = loadConfig(); } catch (e) { console.error(e.message); process.exit(1); }

if (cfg.station.timezone) process.env.TZ = cfg.station.timezone;

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

const svc = new WeatherService(cfg, source);
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

function publicConfig() {
  const metrics = Object.keys(METRICS).filter(m => svc.metricAvailable(m));
  return {
    station: {
      name: cfg.station.name, subtitle: cfg.station.subtitle, altitude_m: cfg.station.altitude_m, since: cfg.station.since,
      devices: cfg.station.devices.map(d => ({ id: d.id, name: d.name, short: d.short, role: d.role, metrics: d.metrics })),
    },
    timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone,
    demo: cfg.server.demo,
    metrics,
    sensors: Object.keys(cfg.sensors),
    hasForecast: !!(cfg.forecast.entity || cfg.server.demo),
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
