// Admin login + runtime settings store. The one place in the server that
// persists a secret (a password hash) and the one write path into otherwise
// read-only configuration, so it's held to a stricter failure standard than
// alerts.js's "warn and keep going in memory" pattern: a failed disk write
// must block the action that depended on it (see changePassword/saveSettings)
// rather than silently reporting success for something that won't survive a
// restart — especially the restart a settings save itself triggers.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SENSOR_KEYS, DEFAULT_ALERTS, normalizeAlerts } from './config.js';
import { generateSecret, verifyTotp, otpauthUrl } from './totp.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'hex'), bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// enabled/secret are only ever set by confirmTotpSetup() once a code has
// actually been verified; pendingSecret is deliberately never persisted –
// see beginTotpSetup()'s comment.
const emptyTotp = () => ({ enabled: false, secret: null });

const emptySettings = () => ({
  homeassistant: { url: '', token: '' },
  sensors: {},
  forecast: { entity: '', dwdStationId: '', biasHours: 6, label: '' },
  alerts: null, // null = not customized, defer to config.yaml-or-DEFAULT_ALERTS; otherwise a normalizeAlerts()-validated array
  station: { name: '', subtitle: '', altitude_m: null, since: '', publicLocation: null, devices: [] },
});

// Defensive shape-narrowing for a rule/condition/device submitted through the
// admin API before it's handed to normalizeAlerts() (structural validation)
// or persisted — untrusted JSON body, so every field is type-checked here
// rather than trusted to already look like a real AlertCondition/Device.
function sanitizeCondition(c) {
  if (!c || typeof c !== 'object') return null;
  const out = {};
  if (typeof c.sensor === 'string' && c.sensor) out.sensor = c.sensor;
  else if (typeof c.entity === 'string' && c.entity) out.entity = c.entity;
  for (const k of ['above', 'below', 'at_least', 'at_most', 'equals']) {
    if (typeof c[k] === 'number' && Number.isFinite(c[k])) out[k] = c[k];
  }
  if (c.recent && typeof c.recent === 'object') {
    const r = {};
    if (typeof c.recent.sensor === 'string' && c.recent.sensor) r.sensor = c.recent.sensor;
    else if (typeof c.recent.entity === 'string' && c.recent.entity) r.entity = c.recent.entity;
    if (typeof c.recent.minutes === 'number' && Number.isFinite(c.recent.minutes)) r.minutes = c.recent.minutes;
    if (r.sensor || r.entity) out.recent = r;
  }
  return out;
}

function sanitizeAlertRule(a) {
  if (!a || typeof a !== 'object') return {};
  const conds = list => (Array.isArray(list) ? list.map(sanitizeCondition).filter(Boolean) : undefined);
  const out = {
    level: a.level === 'info' ? 'info' : 'warning',
    message: typeof a.message === 'string' ? a.message : '',
  };
  if (typeof a.id === 'string' && a.id.trim()) out.id = a.id.trim();
  if (typeof a.label === 'string' && a.label.trim()) out.label = a.label.trim();
  if (typeof a.description === 'string') out.description = a.description.trim();
  if (typeof a.banner === 'string' && a.banner.trim()) out.banner = a.banner.trim();
  if (Array.isArray(a.all)) out.all = conds(a.all);
  else if (Array.isArray(a.any)) out.any = conds(a.any);
  return out;
}

// Mirrors config.js's own station.devices mapping, so an admin-entered
// device ends up identical in shape to one that came from config.yaml.
function sanitizeDevices(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((d, i) => ({
    id: String(d?.id || `device${i}`).trim(),
    name: String(d?.name || d?.id || `Gerät ${i + 1}`).trim(),
    role: String(d?.role || '').trim(),
    short: String(d?.short || d?.name || d?.id || '').trim(),
    battery: d?.battery ? String(d.battery).trim() : null,
    signal: d?.signal ? String(d.signal).trim() : null,
    metrics: Array.isArray(d?.metrics) ? d.metrics.filter(m => typeof m === 'string') : [],
  }));
}

export class AdminStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'admin.json');
    this.state = this._load();
    this._attempts = new Map(); // ip -> { count, lockUntil }
    this._pendingTotpSecret = null; // in-memory only until confirmed, see beginTotpSetup()
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        return { ...parsed, totp: { ...emptyTotp(), ...parsed.totp }, settings: { ...emptySettings(), ...parsed.settings } };
      }
    } catch (e) {
      console.warn(`[admin] could not read ${this.file}: ${e.message}`);
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const state = {
      username: 'admin',
      salt,
      hash: hashPassword('admin', salt),
      mustChangePassword: true,
      sessionSecret: crypto.randomBytes(32).toString('hex'),
      totp: emptyTotp(),
      settings: emptySettings(),
    };
    if (!this._save(state)) {
      console.warn(`[admin] cannot write ${this.file} – admin credentials will NOT persist across restarts. Fix DATA_DIR permissions, or the admin login resets to admin/admin every restart.`);
    } else {
      console.log(`[admin] initialized ${this.file} with default credentials admin/admin (change required on first login)`);
    }
    return state;
  }

  _save(state) {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn(`[admin] cannot write ${this.file}: ${e.message}`);
      return false;
    }
  }

  // ---------- simple in-memory brute-force throttle ----------
  _rateLimited(ip) {
    const a = this._attempts.get(ip);
    return !!(a && a.lockUntil > Date.now());
  }

  _recordFailure(ip) {
    const a = this._attempts.get(ip) || { count: 0, lockUntil: 0 };
    a.count++;
    a.lockUntil = Date.now() + Math.min(30000, 500 * 2 ** Math.max(0, a.count - 3));
    this._attempts.set(ip, a);
  }

  _recordSuccess(ip) { this._attempts.delete(ip); }

  // ---------- login / session ----------
  // `code` is the 6-digit TOTP code, required only once 2FA is enabled. The
  // caller submits username+password (+code once asked for) together each
  // time rather than this method issuing some partial "password verified,
  // awaiting 2FA" session of its own – simpler, and scrypt is cheap enough
  // that re-verifying the password alongside the code costs nothing real.
  verifyLogin(ip, username, password, code) {
    if (this._rateLimited(ip)) return { ok: false, error: 'too many attempts – try again shortly' };
    const ok = username === this.state.username && timingSafeEqualHex(hashPassword(String(password || ''), this.state.salt), this.state.hash);
    if (!ok) { this._recordFailure(ip); return { ok: false, error: 'invalid credentials' }; }
    if (this.state.totp.enabled) {
      if (!code) return { ok: false, needsTotp: true }; // password was right – not a failed attempt, just ask for the second factor
      if (!verifyTotp(this.state.totp.secret, code)) {
        this._recordFailure(ip);
        return { ok: false, needsTotp: true, error: 'invalid 2FA code' };
      }
    }
    this._recordSuccess(ip);
    return { ok: true, mustChangePassword: this.state.mustChangePassword, cookie: this._issueSession() };
  }

  // ---------- two-factor authentication (TOTP) ----------
  totpEnabled() { return this.state.totp.enabled; }

  // Generates a new secret but does NOT persist it – only confirmTotpSetup()
  // (which requires a valid code, proving the admin actually saved it in an
  // authenticator app) ever writes a secret to disk. A server restart before
  // confirming just means starting setup over, which is harmless.
  beginTotpSetup() {
    this._pendingTotpSecret = generateSecret();
    return { secret: this._pendingTotpSecret, otpauthUrl: otpauthUrl(this._pendingTotpSecret, { label: this.state.username }) };
  }

  confirmTotpSetup(ip, code) {
    if (this._rateLimited(ip)) return { ok: false, error: 'too many attempts – try again shortly' };
    if (!this._pendingTotpSecret) return { ok: false, error: 'no 2FA setup in progress' };
    if (!verifyTotp(this._pendingTotpSecret, code)) {
      this._recordFailure(ip);
      return { ok: false, error: 'invalid 2FA code' };
    }
    const next = { ...this.state, totp: { enabled: true, secret: this._pendingTotpSecret } };
    if (!this._save(next)) return { ok: false, error: 'could not save (DATA_DIR is not writable) – 2FA was NOT enabled' };
    this.state = next;
    this._pendingTotpSecret = null;
    this._recordSuccess(ip);
    return { ok: true };
  }

  // Requires the current password (not a TOTP code – if you still have your
  // authenticator you don't need this, and if you don't, this is the one
  // way back in short of the full admin.json reset described in the README).
  disableTotp(ip, password) {
    if (this._rateLimited(ip)) return { ok: false, error: 'too many attempts – try again shortly' };
    if (!timingSafeEqualHex(hashPassword(String(password || ''), this.state.salt), this.state.hash)) {
      this._recordFailure(ip);
      return { ok: false, error: 'current password is incorrect' };
    }
    const next = { ...this.state, totp: emptyTotp() };
    if (!this._save(next)) return { ok: false, error: 'could not save (DATA_DIR is not writable) – 2FA was NOT disabled' };
    this.state = next;
    this._pendingTotpSecret = null;
    this._recordSuccess(ip);
    return { ok: true };
  }

  _issueSession() {
    const payload = String(Date.now() + SESSION_TTL_MS);
    const sig = crypto.createHmac('sha256', this.state.sessionSecret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  // Rotates the session secret so every outstanding session token (there's no
  // per-session store to revoke individually) stops verifying – with a single
  // admin account, "log out" and "log out everywhere" are the same thing.
  // Best-effort: still logs the caller out of this request even if DATA_DIR
  // can't be written (worst case, old sessions work again after a restart).
  logout() {
    const next = { ...this.state, sessionSecret: crypto.randomBytes(32).toString('hex') };
    if (this._save(next)) this.state = next;
  }

  verifySession(cookieValue) {
    if (!cookieValue) return null;
    const [payload, sig] = cookieValue.split('.');
    if (!payload || !sig) return null;
    const expected = crypto.createHmac('sha256', this.state.sessionSecret).update(payload).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex'), expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const expires = Number(payload);
    if (!Number.isFinite(expires) || expires < Date.now()) return null;
    return { mustChangePassword: this.state.mustChangePassword };
  }

  changePassword(ip, currentPassword, newPassword) {
    if (this._rateLimited(ip)) return { ok: false, error: 'too many attempts – try again shortly' };
    if (!timingSafeEqualHex(hashPassword(String(currentPassword || ''), this.state.salt), this.state.hash)) {
      this._recordFailure(ip);
      return { ok: false, error: 'current password is incorrect' };
    }
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, error: `new password must be at least ${MIN_PASSWORD_LENGTH} characters` };
    }
    const salt = crypto.randomBytes(16).toString('hex');
    // Rotating sessionSecret invalidates every outstanding session token
    // (there's no server-side session store to revoke individually) – a
    // password change is the one remediation this app offers for a
    // compromised session, so it needs to actually evict it, not just change
    // the password while a stolen cookie keeps working for up to 12h more.
    const next = {
      ...this.state, salt, hash: hashPassword(newPassword, salt),
      mustChangePassword: false, sessionSecret: crypto.randomBytes(32).toString('hex'),
    };
    if (!this._save(next)) return { ok: false, error: 'could not save the new password (DATA_DIR is not writable) – password was NOT changed' };
    this.state = next;
    this._recordSuccess(ip);
    // Issue a fresh cookie signed with the new secret so the client making
    // this change stays logged in; every other copy of the old cookie stops
    // verifying immediately.
    return { ok: true, cookie: this._issueSession() };
  }

  // ---------- settings ----------
  // Raw settings, including the real HA token – server-side use only (merged into cfg at boot).
  getSettings() { return this.state.settings; }

  // What the admin UI gets: always the live, effective `cfg` values (so a
  // locked field shows the config.yaml value actually in effect, not a stale
  // admin-store value from before it was locked) – the token is the one
  // exception, never echoed back, only whether one is set.
  getPublicSettings(locked, cfg, timezone) {
    return {
      locked,
      homeassistant: { url: cfg.homeassistant.url, tokenSet: !!cfg.homeassistant.token },
      sensors: cfg.sensors,
      forecast: {
        entity: cfg.forecast.entity || '',
        dwdStationId: cfg.forecast.dwdStationId || '',
        biasHours: cfg.forecast.biasHours,
        label: cfg.forecast.label || '',
      },
      alerts: cfg.alerts,
      defaultAlerts: DEFAULT_ALERTS,
      station: {
        name: cfg.station.name, subtitle: cfg.station.subtitle, altitude_m: cfg.station.altitude_m,
        since: cfg.station.since || '', publicLocation: cfg.station.publicLocation, devices: cfg.station.devices,
      },
      timezone,
      demo: cfg.server.demo,
      totpEnabled: this.state.totp.enabled,
    };
  }

  // `locked` (computed from the live cfg by index.js) marks fields config.yaml
  // already set – those are ignored here too, not just disabled in the UI.
  // Returns { ok: true } or { ok: false, error } (a validation failure on
  // alerts, or a disk-write failure) – nothing is persisted unless every
  // section is valid, so a bad save can never reach admin.json half-applied.
  saveSettings(locked, patch) {
    const next = { ...this.state, settings: { ...this.state.settings } };

    if (!locked.alerts && patch.alerts !== undefined) {
      if (patch.alerts === null) {
        next.settings.alerts = null; // explicit "restore defaults"
      } else if (Array.isArray(patch.alerts)) {
        try {
          next.settings.alerts = normalizeAlerts(patch.alerts.map(sanitizeAlertRule));
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }
    }

    if (patch.station && typeof patch.station === 'object') {
      next.settings.station = { ...next.settings.station };
      if (!locked.stationName && typeof patch.station.name === 'string') next.settings.station.name = patch.station.name.trim();
      if (!locked.stationSubtitle && typeof patch.station.subtitle === 'string') next.settings.station.subtitle = patch.station.subtitle.trim();
      if (!locked.stationAltitude && (patch.station.altitude_m === null || Number.isFinite(patch.station.altitude_m))) {
        next.settings.station.altitude_m = patch.station.altitude_m;
      }
      if (!locked.stationSince && typeof patch.station.since === 'string') next.settings.station.since = patch.station.since.trim();
      if (!locked.stationPublicLocation && patch.station.publicLocation !== undefined) {
        const p = patch.station.publicLocation;
        // Rounded here too (not just client-side) – defense in depth, since
        // the whole point of this field is to never carry more precision
        // than ~10 km into the public API.
        next.settings.station.publicLocation = p && Number.isFinite(p.lat) && Number.isFinite(p.lon)
          ? { lat: Math.round(p.lat * 10) / 10, lon: Math.round(p.lon * 10) / 10 }
          : null;
      }
      if (!locked.stationDevices && Array.isArray(patch.station.devices)) next.settings.station.devices = sanitizeDevices(patch.station.devices);
    }

    if (patch.homeassistant && typeof patch.homeassistant === 'object') {
      next.settings.homeassistant = { ...next.settings.homeassistant };
      if (!locked.haUrl && typeof patch.homeassistant.url === 'string') {
        next.settings.homeassistant.url = patch.homeassistant.url.trim().replace(/\/+$/, '');
      }
      // Blank token field means "leave unchanged" – the UI never has the real value to resubmit.
      if (!locked.haToken && typeof patch.homeassistant.token === 'string' && patch.homeassistant.token.trim()) {
        next.settings.homeassistant.token = patch.homeassistant.token.trim();
      }
    }

    if (patch.sensors && typeof patch.sensors === 'object') {
      next.settings.sensors = { ...next.settings.sensors };
      for (const [k, v] of Object.entries(patch.sensors)) {
        if (!SENSOR_KEYS.includes(k) || locked.sensors[k] || typeof v !== 'string') continue;
        if (v.trim()) next.settings.sensors[k] = v.trim(); else delete next.settings.sensors[k];
      }
    }

    if (patch.forecast && typeof patch.forecast === 'object') {
      next.settings.forecast = { ...next.settings.forecast };
      if (!locked.forecastEntity && typeof patch.forecast.entity === 'string') next.settings.forecast.entity = patch.forecast.entity.trim();
      if (!locked.dwdStationId && typeof patch.forecast.dwdStationId === 'string') next.settings.forecast.dwdStationId = patch.forecast.dwdStationId.trim();
      if (Number.isFinite(patch.forecast.biasHours)) next.settings.forecast.biasHours = patch.forecast.biasHours;
      if (typeof patch.forecast.label === 'string') next.settings.forecast.label = patch.forecast.label.trim();
    }

    if (!this._save(next)) return { ok: false, error: 'could not save settings (DATA_DIR is not writable)' };
    this.state = next;
    return { ok: true };
  }
}
