import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encrypt, vapidAuth, allowedEndpoint, parseSubscription, rawPublicKey, b64url, fromB64url, PushService } from './push.js';

// What a browser does with an aes128gcm message (RFC 8291 §3.4, RFC 8188 §2), written out
// independently of encrypt(), so the two have to agree.
function decrypt(body, uaEcdh, authSecret) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const shared = uaEcdh.computeSecret(asPublic);
  const hmac = (key, msg) => crypto.createHmac('sha256', key).update(msg).digest();
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last record delimiter');
  return plain.subarray(0, -1).toString();
}

function browserKeys() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  return { ecdh, auth: crypto.randomBytes(16) };
}

test('encrypt produces a message a browser can decrypt', () => {
  const { ecdh, auth } = browserKeys();
  const msg = JSON.stringify({ title: 'Frost', body: 'Temperatur −1,2 °C' });
  assert.equal(decrypt(encrypt(msg, ecdh.getPublicKey(), auth), ecdh, auth), msg);
});

test('encrypt uses a fresh salt and server key each time', () => {
  const { ecdh, auth } = browserKeys();
  const a = encrypt('x', ecdh.getPublicKey(), auth), b = encrypt('x', ecdh.getPublicKey(), auth);
  assert.notDeepEqual(a.subarray(0, 86), b.subarray(0, 86));
});

test('vapidAuth signs a JWT for the push service origin that verifies with the public key', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const keys = { privateKey, publicRaw: rawPublicKey(publicKey) };
  const header = vapidAuth('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:a@example.org', 1_800_000_000_000);
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, keys.publicRaw);
  assert.equal(fromB64url(k).length, 65);
  const [h, c, s] = jwt.split('.');
  const claims = JSON.parse(fromB64url(c));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:a@example.org');
  assert.equal(claims.exp, 1_800_000_000 + 12 * 3600);
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, fromB64url(s)));
});

test('allowedEndpoint accepts the browser push services and nothing else', () => {
  for (const ok of ['https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://web.push.apple.com/QK', 'https://wns2-par02p.notify.windows.com/w/?token=x']) assert.ok(allowedEndpoint(ok), ok);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/x', 'https://127.0.0.1/x', 'https://user@fcm.googleapis.com/x', 'not a url', '']) assert.ok(!allowedEndpoint(bad), bad);
});

test('parseSubscription checks keys, language and rules', () => {
  const { ecdh, auth } = browserKeys();
  const body = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: b64url(ecdh.getPublicKey()), auth: b64url(auth) }, lang: 'de', rules: ['frost', 'nope', 'frost'] };
  const sub = parseSubscription(body, ['frost', 'gust']);
  assert.deepEqual(sub.rules, ['frost']);
  assert.equal(sub.lang, 'de');
  assert.equal(parseSubscription({ ...body, lang: 'fr', rules: undefined }, []).lang, 'en');
  assert.equal(parseSubscription({ ...body, rules: undefined }, []).rules, null);
  assert.throws(() => parseSubscription({ ...body, keys: { ...body.keys, auth: b64url(Buffer.alloc(8)) } }, []), /secret/);
  assert.throws(() => parseSubscription({ ...body, keys: { ...body.keys, p256dh: 'AAAA' } }, []), /key/);
  assert.throws(() => parseSubscription({ ...body, endpoint: 'https://example.org/x' }, []), /push service/);
});

test('PushService keeps its key, sends to matching subscribers and drops gone ones', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
  const cfg = { push: { enabled: true }, server: { data_dir: dir }, station: { name: 'Test' }, alerts: [{ id: 'frost' }, { id: 'gust' }] };
  const sent = [];
  const fetchImpl = async (url, opts) => { sent.push({ url, opts }); return { ok: !url.endsWith('/gone'), status: url.endsWith('/gone') ? 410 : 201 }; };
  const svc = new PushService(cfg, { fetchImpl });
  const key = svc.publicKey;
  assert.equal(new PushService(cfg).publicKey, key, 'the key pair survives a restart');

  const a = browserKeys(), b = browserKeys();
  const sub = (end, k, rules) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${end}`, keys: { p256dh: b64url(k.ecdh.getPublicKey()), auth: b64url(k.auth) }, lang: 'de', rules });
  svc.subscribe(sub('a', a, ['frost']));
  svc.subscribe(sub('gone', b, null));
  await svc.notify({ rule: 'frost', title: { en: 'Frost', de: 'Frost' }, text: { en: 'cold', de: 'kalt' } });
  assert.equal(sent.length, 2);
  const toA = sent.find((s) => s.url.endsWith('/a'));
  assert.equal(JSON.parse(decrypt(toA.opts.body, a.ecdh, a.auth)).body, 'kalt');
  assert.equal(toA.opts.headers['Content-Encoding'], 'aes128gcm');
  assert.deepEqual(svc.subs.map((s) => s.endpoint.split('/').pop()), ['a'], '410 removes the subscription');

  sent.length = 0;
  await svc.notify({ rule: 'frost', title: 'Frost', text: 'again' });
  assert.equal(sent.length, 0, 'the same rule within the cooldown does not push again');
  await svc.notify({ rule: 'gust', title: 'Gust', text: 'windy' });
  assert.equal(sent.length, 0, 'subscribers only get the rules they chose');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('PushService does nothing when disabled', () => {
  const svc = new PushService({ push: { enabled: false }, server: { data_dir: os.tmpdir() }, alerts: [] });
  assert.equal(svc.publicKey, null);
  assert.throws(() => svc.subscribe({}), /not enabled/);
});
