// TOTP (RFC 6238, built on HOTP from RFC 4226) for optional admin two-factor
// authentication — hand-rolled on node:crypto, no new dependency, same
// convention as the rest of the project. No QR code generation (that needs
// either a real QR encoder or an external service, neither of which fits
// "no new dependency" / "no external requests") — the admin UI instead
// shows the base32 secret as text plus an otpauth:// link, which every
// authenticator app accepts as manual entry and some will open directly.

import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// RFC 4226: HOTP(secret, counter). `secret` is the raw key buffer, not base32.
export function hotp(secretBuffer, counter, digits = 6) {
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(Math.max(0, Math.floor(counter))));
  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binCode % 10 ** digits).padStart(digits, '0');
}

// RFC 6238: TOTP(secret) = HOTP(secret, floor(unixSeconds / step)).
export function totp(secretBuffer, { step = 30, digits = 6, at = Date.now() } = {}) {
  const counter = Math.floor(at / 1000 / step);
  return hotp(secretBuffer, counter, digits);
}

export function generateSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160 bits, the usual TOTP secret size
}

function timingSafeEqualStr(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Verifies a user-typed code against a base32 secret, tolerating ±1 time
// step (30s) of clock drift between the server and the authenticator app.
export function verifyTotp(secretBase32, code, { step = 30, digits = 6, window = 1, at = Date.now() } = {}) {
  const cleaned = String(code || '').replace(/\s+/g, '');
  if (!/^\d+$/.test(cleaned) || cleaned.length !== digits) return false;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(at / 1000 / step);
  for (let i = -window; i <= window; i++) {
    if (timingSafeEqualStr(cleaned, hotp(secret, counter + i, digits))) return true;
  }
  return false;
}

// otpauth:// URI for manual entry / tap-to-open in an authenticator app.
export function otpauthUrl(secretBase32, { label, issuer = 'Ecowitt Weather Dashboard' } = {}) {
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params.toString()}`;
}
