// Minimal Home Assistant WebSocket client (uses the WebSocket built into Node 22).
// Keeps one authenticated connection, subscribes to the configured entities and
// the daily forecast, and offers request/response helpers for history + statistics.
import { EventEmitter } from 'node:events';

export class HomeAssistantSource extends EventEmitter {
  constructor({ url, token, entityIds, forecastEntity }) {
    super();
    this.wsUrl = url.replace(/^http/, 'ws') + '/api/websocket';
    this.token = token;
    this.entityIds = entityIds;
    this.forecastEntity = forecastEntity;
    this.states = {};          // entity_id -> { state, attributes, lu, lc }
    this.forecast = null;
    this.haConfig = null;
    this.connected = false;
    this.lastMessage = 0;
    this._id = 1;
    this._pending = new Map();
    this._backoff = 1000;
  }

  start() { this._connect(); }

  _connect() {
    console.log(`[ha] connecting to ${this.wsUrl}`);
    let ws;
    try { ws = new WebSocket(this.wsUrl); } catch (e) {
      console.error('[ha] cannot open websocket:', e.message);
      return this._scheduleReconnect();
    }
    this.ws = ws;
    ws.addEventListener('message', ev => this._onMessage(JSON.parse(ev.data)));
    ws.addEventListener('close', () => {
      if (this.connected) console.warn('[ha] connection closed');
      this.connected = false;
      for (const { reject } of this._pending.values()) reject(new Error('connection closed'));
      this._pending.clear();
      this.emit('status', false);
      this._scheduleReconnect();
    });
    ws.addEventListener('error', e => console.error('[ha] websocket error', e.message || ''));
  }

  _scheduleReconnect() {
    clearTimeout(this._rt);
    this._rt = setTimeout(() => this._connect(), this._backoff);
    this._backoff = Math.min(this._backoff * 2, 60000);
  }

  async _onMessage(msg) {
    this.lastMessage = Date.now();
    if (msg.type === 'auth_required') {
      this.ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
      return;
    }
    if (msg.type === 'auth_invalid') {
      console.error('[ha] authentication failed – check the long-lived access token');
      return;
    }
    if (msg.type === 'auth_ok') {
      console.log(`[ha] authenticated (Home Assistant ${msg.ha_version})`);
      this.connected = true;
      this._backoff = 1000;
      this.emit('status', true);
      this._afterAuth().catch(e => console.error('[ha] setup failed:', e.message));
      return;
    }
    if (msg.type === 'result') {
      const p = this._pending.get(msg.id);
      if (!p) return;
      if (!p.subscription) this._pending.delete(msg.id);
      if (msg.success) p.resolve(msg.result); else p.reject(new Error(msg.error?.message || 'request failed'));
      return;
    }
    if (msg.type === 'event') {
      const p = this._pending.get(msg.id);
      if (p?.onEvent) p.onEvent(msg.event);
    }
  }

  _send(payload, { onEvent, timeout = 60000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject(new Error('not connected to Home Assistant'));
      const id = this._id++;
      const t = onEvent ? null : setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`timeout: ${payload.type}`));
      }, timeout);
      this._pending.set(id, {
        subscription: !!onEvent, onEvent,
        resolve: v => { clearTimeout(t); resolve(v); },
        reject: e => { clearTimeout(t); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, ...payload }));
    });
  }

  async _afterAuth() {
    this.haConfig = await this._send({ type: 'get_config' });
    this.emit('config', this.haConfig);

    await this._send({ type: 'subscribe_entities', entity_ids: this.entityIds }, {
      onEvent: ev => this._onEntities(ev),
    });

    if (this.forecastEntity) {
      this._send({ type: 'weather/subscribe_forecast', forecast_type: 'daily', entity_id: this.forecastEntity }, {
        onEvent: ev => { this.forecast = ev.forecast || []; this.emit('forecast'); },
      }).catch(e => console.warn(`[ha] forecast subscription for ${this.forecastEntity} failed: ${e.message}`));
    }
  }

  _onEntities(ev) {
    if (ev.a) {
      for (const [id, s] of Object.entries(ev.a)) {
        this.states[id] = { state: s.s, attributes: s.a || {}, lc: (s.lc ?? 0) * 1000, lu: (s.lu ?? s.lc ?? 0) * 1000 };
      }
      const missing = this.entityIds.filter(id => !ev.a[id] && !this.states[id]);
      if (missing.length) console.warn('[ha] entities not found in Home Assistant:', missing.join(', '));
    }
    if (ev.c) {
      for (const [id, diff] of Object.entries(ev.c)) {
        const cur = this.states[id] || { state: null, attributes: {}, lc: 0, lu: 0 };
        const plus = diff['+'] || {};
        if ('s' in plus) cur.state = plus.s;
        if (plus.a) cur.attributes = { ...cur.attributes, ...plus.a };
        if (diff['-']?.a) for (const k of diff['-'].a) delete cur.attributes[k];
        if (plus.lc) { cur.lc = plus.lc * 1000; cur.lu = plus.lc * 1000; }
        if (plus.lu) cur.lu = plus.lu * 1000;
        this.states[id] = cur;
      }
    }
    if (ev.r) for (const id of ev.r) delete this.states[id];
    this.emit('update');
  }

  // Raw history: { entity_id: [{ t: ms, s: state }] }
  async history(entityIds, start, end) {
    const res = await this._send({
      type: 'history/history_during_period',
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      entity_ids: entityIds,
      include_start_time_state: true,
      significant_changes_only: false,
      minimal_response: true,
      no_attributes: true,
    });
    const out = {};
    for (const [id, rows] of Object.entries(res || {})) {
      out[id] = rows.map(r => ({ t: (r.lu ?? r.lc) * 1000, s: r.s }));
    }
    return out;
  }

  // Long-term statistics: { entity_id: [{ start: ms, mean, min, max, change }] }
  async statistics(ids, start, end, period) {
    const res = await this._send({
      type: 'recorder/statistics_during_period',
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      statistic_ids: ids,
      period,
      types: ['mean', 'min', 'max', 'change', 'state'],
    }, { timeout: 120000 });
    const out = {};
    for (const [id, rows] of Object.entries(res || {})) {
      out[id] = rows.map(r => ({ ...r, start: typeof r.start === 'number' ? r.start : Date.parse(r.start) }));
    }
    return out;
  }

  location() {
    return this.haConfig ? { latitude: this.haConfig.latitude, longitude: this.haConfig.longitude, time_zone: this.haConfig.time_zone } : null;
  }
}
