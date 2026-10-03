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
import { SENSOR_KEYS } from './config.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 h
const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'hex'), bufB = Buffer.from(b, 'hex');
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

const emptySettings = () => ({
  homeassistant: { url: '', token: '' },
  sensors: {},
  forecast: { entity: '', dwdStationId: '', biasHours: 6, label: '' },
});

export class AdminStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'admin.json');
    this.state = this._load();
    this._attempts = new Map(); // ip -> { count, lockUntil }
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        return { ...parsed, settings: { ...emptySettings(), ...parsed.settings } };
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
  verifyLogin(ip, username, password) {
    if (this._rateLimited(ip)) return { ok: false, error: 'too many attempts – try again shortly' };
    const ok = username === this.state.username && timingSafeEqualHex(hashPassword(String(password || ''), this.state.salt), this.state.hash);
    if (!ok) { this._recordFailure(ip); return { ok: false, error: 'invalid credentials' }; }
    this._recordSuccess(ip);
    return { ok: true, mustChangePassword: this.state.mustChangePassword, cookie: this._issueSession() };
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
  getPublicSettings(locked, cfg) {
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
    };
  }

  // `locked` (computed from the live cfg by index.js) marks fields config.yaml
  // already set – those are ignored here too, not just disabled in the UI.
  saveSettings(locked, patch) {
    const next = { ...this.state, settings: { ...this.state.settings } };

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

    if (!this._save(next)) return false;
    this.state = next;
    return true;
  }
}
