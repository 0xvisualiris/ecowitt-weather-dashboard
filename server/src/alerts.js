// Evaluates the alert rules from config.yaml against live values and keeps a
// small persisted log (data_dir/alerts.json). Read-only for the browser.
import fs from 'node:fs';
import path from 'node:path';
import { normalize, toNumber, compass, fmtDe, SENSOR_DIMENSION } from './units.js';

const DECIMALS = { temperature: 1, speed: 1, rain: 1, rate: 1, pressure: 1, distance: 0 };
const MAX_LOG = 200;

export class AlertEngine {
  constructor(cfg, service) {
    this.cfg = cfg;
    this.svc = service;
    this.file = path.join(cfg.server.data_dir, 'alerts.json');
    this.state = { active: {}, log: [] };
    try {
      if (fs.existsSync(this.file)) this.state = { active: {}, log: [], ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (e) { console.warn('[alerts] could not read log:', e.message); }
    // drop state of rules that no longer exist
    const ids = new Set(cfg.alerts.map(a => a.id));
    for (const id of Object.keys(this.state.active)) if (!ids.has(id)) delete this.state.active[id];
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state));
    } catch (e) {
      if (!this._warned) { console.warn(`[alerts] cannot write ${this.file} (${e.message}) – log is kept in memory only`); this._warned = true; }
    }
  }

  _read(cond) {
    if (cond.sensor) return this.svc.value(cond.sensor);
    const e = this.svc.rawEntity(cond.entity);
    return e ? toNumber(e.state) : null;
  }

  _timestamp(ref) {
    const e = ref.sensor ? this.svc.entity(ref.sensor) : this.svc.rawEntity(ref.entity);
    if (!e) return null;
    const t = Date.parse(e.state);
    return Number.isFinite(t) && /\d{4}-\d{2}-\d{2}/.test(e.state) ? t : e.lc || null;
  }

  _check(cond) {
    const v = this._read(cond);
    if (v == null) return false;
    if (cond.above != null && !(v > cond.above)) return false;
    if (cond.below != null && !(v < cond.below)) return false;
    if (cond.at_least != null && !(v >= cond.at_least)) return false;
    if (cond.at_most != null && !(v <= cond.at_most)) return false;
    if (cond.equals != null && v !== cond.equals) return false;
    if (cond.recent) {
      const t = this._timestamp(cond.recent);
      if (!t || Date.now() - t > (cond.recent.minutes ?? 30) * 60000) return false;
    }
    return true;
  }

  _message(tpl) {
    if (!tpl) return '';
    return tpl.replace(/\{([a-z0-9_.]+)(?:\|([a-z]+))?\}/gi, (_, key, filter) => {
      let raw, v;
      if (key.includes('.')) {
        const e = this.svc.rawEntity(key);
        raw = e?.state; v = toNumber(raw);
      } else {
        const e = this.svc.entity(key);
        raw = e?.state;
        v = e ? normalize(key, e.state, e.attributes?.unit_of_measurement) : null;
      }
      if (filter === 'time') {
        const t = Date.parse(raw);
        return Number.isFinite(t) ? new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '—';
      }
      if (filter === 'compass') return compass(v);
      if (v == null) return raw ?? '—';
      const d = DECIMALS[SENSOR_DIMENSION[key]] ?? (Number.isInteger(v) ? 0 : 1);
      return fmtDe(v, d);
    });
  }

  evaluate() {
    const now = Date.now();
    const clearMs = this.cfg.alert_clear_minutes * 60000;
    let changed = false;
    for (const rule of this.cfg.alerts) {
      const conds = rule.all || rule.any;
      const hit = rule.all ? conds.every(c => this._check(c)) : conds.some(c => this._check(c));
      const act = this.state.active[rule.id];
      if (hit) {
        const text = this._message(rule.message);
        if (!act) {
          const entry = { id: `${rule.id}-${now}`, rule: rule.id, title: rule.label, level: rule.level, text, start: now, end: null };
          this.state.log.unshift(entry);
          this.state.log = this.state.log.slice(0, MAX_LOG);
          this.state.active[rule.id] = { since: now, lastTrue: now, logId: entry.id };
          console.log(`[alerts] ${rule.id} active: ${text}`);
          changed = true;
        } else {
          act.lastTrue = now;
          const entry = this.state.log.find(l => l.id === act.logId);
          if (entry && entry.text !== text) { entry.text = text; changed = true; }
        }
      } else if (act && now - act.lastTrue > clearMs) {
        const entry = this.state.log.find(l => l.id === act.logId);
        if (entry) entry.end = act.lastTrue;
        delete this.state.active[rule.id];
        console.log(`[alerts] ${rule.id} cleared`);
        changed = true;
      }
    }
    if (changed) this._save();
  }

  view() {
    const rules = this.cfg.alerts.map(r => {
      const a = this.state.active[r.id];
      const entry = a && this.state.log.find(l => l.id === a.logId);
      return { id: r.id, label: r.label, description: r.description, level: r.level, active: !!a, since: a?.since ?? null, banner: r.banner || r.label, message: entry?.text || '' };
    });
    return { rules, log: this.state.log.slice(0, 50) };
  }

  active() { return this.view().rules.filter(r => r.active); }
}
