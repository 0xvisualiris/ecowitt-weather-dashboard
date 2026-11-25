// Web Push for alerts: visitors who opt in on the Alerts page get a notification when a rule
// becomes active, even with the page closed. Built on node:crypto only, no dependency:
//   - VAPID (RFC 8292): the server signs a short JWT (ES256) per push service, with its own key pair,
//     generated once and kept in DATA_DIR/push.json.
//   - Message encryption (RFC 8291, "aes128gcm" from RFC 8188): ECDH with the browser's key,
//     HKDF, AES-128-GCM. The push service only ever sees ciphertext.
// Subscriptions (the push service's address for one browser plus its two keys, the visitor's
// language and which rules they want) are kept in the same file. Nothing else about the visitor is.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LANGS, textIn, PUSH_WELCOME } from './i18n.js';

const MAX_SUBSCRIPTIONS = 1000;
const TTL_SECONDS = 6 * 3600;          // an alert older than this isn't worth delivering any more
const COOLDOWN_MS = 30 * 60 * 1000;    // the same rule again within half an hour doesn't push again
const DEFAULT_CONTACT = 'https://github.com/0xvisualiris/ecowitt-weather-dashboard';

// The server sends requests to whatever address a browser hands it, so only the big browser
// push services are accepted. Anything else (an internal address, someone's own server) is refused.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                 // Chrome, Edge on Android, most Chromium browsers
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^[a-z0-9-]+\.push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,                // Safari, iOS home-screen apps
  /^[a-z0-9-]+\.notify\.windows\.com$/,     // Edge on Windows
];

export const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const fromB64url = (s) => Buffer.from(String(s), 'base64url');

export function allowedEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  return u.protocol === 'https:' && !u.port && !u.username && PUSH_HOSTS.some((re) => re.test(u.hostname));
}

// Checks a subscription as the browser sends it ({ endpoint, keys: { p256dh, auth } }) plus the
// visitor's choices. Returns the record to store, or throws a 400 with the reason.
export function parseSubscription(body, ruleIds) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  const endpoint = String(body?.endpoint || '');
  if (endpoint.length > 1000 || !allowedEndpoint(endpoint)) throw bad('unsupported push service');
  const p256dh = fromB64url(body?.keys?.p256dh || ''), auth = fromB64url(body?.keys?.auth || '');
  if (p256dh.length !== 65 || p256dh[0] !== 4) throw bad('invalid subscription key');
  if (auth.length !== 16) throw bad('invalid subscription secret');
  const lang = LANGS.includes(body?.lang) ? body.lang : 'en';
  let rules = null;   // null: every rule, including ones added later
  if (Array.isArray(body?.rules)) rules = [...new Set(body.rules.map(String))].filter((id) => ruleIds.includes(id));
  return { endpoint, p256dh: b64url(p256dh), auth: b64url(auth), lang, rules };
}

// RFC 8291: encrypts `payload` for one browser. `uaPublic` is its 65-byte P-256 key, `authSecret`
// its 16-byte secret. `salt` and `serverKeys` are only passed in by the tests.
export function encrypt(payload, uaPublic, authSecret, { salt = crypto.randomBytes(16), serverKeys } = {}) {
  const ecdh = serverKeys ?? crypto.createECDH('prime256v1');
  if (!serverKeys) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // One record: the message, then 0x02 ("last record", no padding).
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

// RFC 8292: "vapid t=<JWT>, k=<public key>" for one push service.
export function vapidAuth(endpoint, keys, contact, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const part = (o) => b64url(JSON.stringify(o));
  const data = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: contact })}`;
  const sig = crypto.sign('sha256', Buffer.from(data), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64url(sig)}, k=${keys.publicRaw}`;
}

export function rawPublicKey(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  return b64url(Buffer.concat([Buffer.from([4]), fromB64url(jwk.x), fromB64url(jwk.y)]));
}

export class PushService {
  constructor(cfg, { fetchImpl = globalThis.fetch } = {}) {
    this.enabled = !!cfg.push?.enabled;
    this.contact = cfg.push?.contact || DEFAULT_CONTACT;
    this.ruleIds = () => cfg.alerts.map((a) => a.id);
    this.station = cfg.station?.name || 'Weather Station';
    this.file = path.join(cfg.server.data_dir, 'push.json');
    this.fetch = fetchImpl;
    this.subs = [];
    this.lastPush = {};
    if (!this.enabled) return;
    let saved = null;
    try { if (fs.existsSync(this.file)) saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { console.warn('[push] could not read push.json:', e.message); }
    if (saved?.vapid?.privateJwk) {
      this.keys = this._keysFrom(saved.vapid.privateJwk);
      this.subs = Array.isArray(saved.subs) ? saved.subs : [];
    } else {
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      this.keys = this._keysFrom(privateKey.export({ format: 'jwk' }));
      this._save();
    }
  }

  _keysFrom(privateJwk) {
    const privateKey = crypto.createPrivateKey({ key: privateJwk, format: 'jwk' });
    const publicKey = crypto.createPublicKey(privateKey);
    return { privateJwk, privateKey, publicRaw: rawPublicKey(publicKey) };
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ vapid: { privateJwk: this.keys.privateJwk }, subs: this.subs }), { mode: 0o600 });
    } catch (e) {
      if (!this._warned) { console.warn(`[push] cannot write ${this.file} (${e.message}) – subscriptions are kept in memory only`); this._warned = true; }
    }
  }

  get publicKey() { return this.enabled ? this.keys.publicRaw : null; }

  subscribe(body) {
    if (!this.enabled) throw Object.assign(new Error('notifications are not enabled'), { status: 404 });
    const sub = parseSubscription(body, this.ruleIds());
    const i = this.subs.findIndex((s) => s.endpoint === sub.endpoint);
    if (i < 0 && this.subs.length >= MAX_SUBSCRIPTIONS) throw Object.assign(new Error('too many subscriptions'), { status: 503 });
    const record = { ...sub, created: i < 0 ? Date.now() : this.subs[i].created };
    if (i < 0) this.subs.push(record); else this.subs[i] = record;
    this._save();
    return record;
  }

  unsubscribe(endpoint) {
    const before = this.subs.length;
    this.subs = this.subs.filter((s) => s.endpoint !== String(endpoint || ''));
    if (this.subs.length !== before) this._save();
  }

  // Sends one message to one subscription. A push service answering 404/410 means the browser
  // dropped the subscription (notifications turned off, site data cleared): it is removed.
  async send(sub, message) {
    const body = encrypt(JSON.stringify(message), fromB64url(sub.p256dh), fromB64url(sub.auth));
    try {
      const r = await this.fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidAuth(sub.endpoint, this.keys, this.contact),
          'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
          TTL: String(TTL_SECONDS), Urgency: 'high',
        },
        body,
        signal: AbortSignal.timeout(15000),
      });
      if (r.status === 404 || r.status === 410) { this.unsubscribe(sub.endpoint); return false; }
      if (!r.ok) console.warn(`[push] ${new URL(sub.endpoint).hostname} answered ${r.status}`);
      return r.ok;
    } catch (e) {
      console.warn(`[push] ${new URL(sub.endpoint).hostname}: ${e.message}`);
      return false;
    }
  }

  // Right after subscribing: shows the visitor that notifications arrive.
  welcome(sub) {
    const t = PUSH_WELCOME[sub.lang] ?? PUSH_WELCOME.en;
    return this.send(sub, { title: t.title.replace('{station}', this.station), body: t.body, tag: 'welcome', url: '/#/alerts' });
  }

  // A rule just became active: tell everyone who wants that rule, in their language.
  async notify(entry) {
    if (!this.enabled) return;
    const now = Date.now();
    if (now - (this.lastPush[entry.rule] ?? 0) < COOLDOWN_MS) return;
    this.lastPush[entry.rule] = now;
    const targets = this.subs.filter((s) => !s.rules || s.rules.includes(entry.rule));
    await Promise.all(targets.map((s) => this.send(s, {
      title: textIn(entry.title, s.lang), body: textIn(entry.text, s.lang), tag: entry.rule, url: '/#/alerts',
    })));
  }
}
