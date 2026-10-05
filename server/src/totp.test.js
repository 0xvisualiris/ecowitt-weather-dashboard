import test from 'node:test';
import assert from 'node:assert/strict';
import { base32Encode, base32Decode, hotp, totp, verifyTotp, generateSecret, otpauthUrl } from './totp.js';

// RFC 6238 Appendix B test vectors (SHA1, 8-digit, secret "12345678901234567890"
// ASCII, T0=0, step=30s). A 6-digit code is just `% 10^6` of the same
// counter's HOTP value, i.e. the last 6 digits of the 8-digit vector — this
// cross-checks our hotp()/totp() against the official reference values.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const VECTORS = [
  { t: 59, otp8: '94287082' },
  { t: 1111111109, otp8: '07081804' },
  { t: 1111111111, otp8: '14050471' },
  { t: 1234567890, otp8: '89005924' },
  { t: 2000000000, otp8: '69279037' },
  { t: 20000000000, otp8: '65353130' },
];

test('hotp matches RFC 4226/6238 reference vectors (8-digit)', () => {
  for (const { t, otp8 } of VECTORS) {
    const counter = Math.floor(t / 30);
    assert.equal(hotp(RFC_SECRET, counter, 8), otp8);
  }
});

test('totp (6-digit) matches the last 6 digits of the reference vectors', () => {
  for (const { t, otp8 } of VECTORS) {
    assert.equal(totp(RFC_SECRET, { at: t * 1000, digits: 6 }), otp8.slice(-6));
  }
});

test('base32 encode/decode round-trips arbitrary bytes', () => {
  for (const len of [0, 1, 5, 10, 16, 20, 33]) {
    const buf = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37) % 256));
    assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  }
});

test('base32Decode ignores separators and is case-insensitive', () => {
  const secret = generateSecret();
  const withSpaces = secret.toLowerCase().replace(/(.{4})/g, '$1 ').trim();
  assert.deepEqual(base32Decode(withSpaces), base32Decode(secret));
});

test('verifyTotp accepts the current code and rejects a wrong one', () => {
  const secret = generateSecret();
  const now = Date.now();
  const code = totp(base32Decode(secret), { at: now });
  assert.equal(verifyTotp(secret, code, { at: now }), true);
  assert.equal(verifyTotp(secret, '000000', { at: now }), code === '000000');
  assert.equal(verifyTotp(secret, 'not-a-code', { at: now }), false);
});

test('verifyTotp tolerates one step of clock drift either way, not two', () => {
  const secret = generateSecret();
  const now = Date.now();
  const prevStep = totp(base32Decode(secret), { at: now - 30_000 });
  const nextStep = totp(base32Decode(secret), { at: now + 30_000 });
  const twoAway = totp(base32Decode(secret), { at: now - 90_000 });
  assert.equal(verifyTotp(secret, prevStep, { at: now }), true);
  assert.equal(verifyTotp(secret, nextStep, { at: now }), true);
  assert.equal(verifyTotp(secret, twoAway, { at: now }), twoAway === totp(base32Decode(secret), { at: now }));
});

test('verifyTotp rejects a code of the wrong length', () => {
  const secret = generateSecret();
  assert.equal(verifyTotp(secret, '12345', {}), false);
  assert.equal(verifyTotp(secret, '1234567', {}), false);
});

test('otpauthUrl embeds the secret and a valid otpauth scheme', () => {
  const secret = generateSecret();
  const url = otpauthUrl(secret, { label: 'admin' });
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.match(url, new RegExp(`secret=${secret}`));
});

test('generateSecret produces a 32-character base32 string (160 bits)', () => {
  const secret = generateSecret();
  assert.equal(secret.length, 32);
  assert.match(secret, /^[A-Z2-7]+$/);
});
