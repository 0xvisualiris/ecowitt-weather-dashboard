// How response bodies go out: which compression the client gets, compressed
// copies kept for bodies that don't change (the page's files, radar frames),
// and ETags so a browser or the edge cache in front can revalidate a file
// with a 304 instead of downloading it again.
//
// Only compression happens here, never decompression: the Brotli decoder flaw
// CVE-2026-111497 is in the decoding side, and the runtime is pinned to a
// patched Node.js anyway (see the Dockerfile).
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const { BROTLI_PARAM_QUALITY, BROTLI_PARAM_SIZE_HINT } = zlib.constants;

// Bodies smaller than this go out as they are: compression saves less than its headers cost.
export const MIN_COMPRESS = 1024;

// Brotli quality per use. A body compressed once and kept can afford more
// effort than one compressed per request. Quality 11 is left out on purpose:
// for an 810 KB radar frame it took 1.6 s against 31 ms at 9, for 12% less.
export const BR_ONCE = 9;
export const BR_PER_REQUEST = 5;

// The best encoding the client accepts: br, then gzip, else none.
// "q=0" means "not this one" (RFC 9110 12.5.3).
export function negotiate(acceptEncoding = '') {
  const ok = new Set();
  for (const part of String(acceptEncoding).toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    if (q && !(Number(q.slice(2)) > 0)) continue;
    ok.add(name.trim());
  }
  if (ok.has('br')) return 'br';
  if (ok.has('gzip')) return 'gzip';
  return null;
}

export function compress(buf, encoding, brQuality = BR_PER_REQUEST) {
  if (encoding === 'gzip') return zlib.gzipSync(buf);
  if (encoding === 'br') {
    return zlib.brotliCompressSync(buf, { params: { [BROTLI_PARAM_QUALITY]: brQuality, [BROTLI_PARAM_SIZE_HINT]: buf.length } });
  }
  return buf;
}

// A body that never changes, compressed at most once per encoding, on first request.
export class Encoded {
  constructor(buf) {
    this.buf = buf;
    this.variants = {};
  }
  get(encoding) {
    if (!encoding) return this.buf;
    return (this.variants[encoding] ??= compress(this.buf, encoding, BR_ONCE));
  }
}

// One encoded copy per radar grid, released together with the frame.
const gridCopies = new WeakMap();
export function encodedGrid(grid) {
  let enc = gridCopies.get(grid);
  if (!enc) gridCopies.set(grid, (enc = new Encoded(Buffer.from(grid.buffer, grid.byteOffset, grid.byteLength))));
  return enc;
}

// A weak ETag: the same for every encoding of the same content.
export const etagOf = (buf) => `W/"${crypto.createHash('sha1').update(buf).digest('base64url').slice(0, 22)}"`;

// If-None-Match is a list of ETags or "*" (RFC 9110 13.1.2, weak comparison).
export function matches(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false;
  const bare = (t) => t.trim().replace(/^W\//, '');
  return ifNoneMatch.split(',').some((t) => t.trim() === '*' || bare(t) === bare(etag));
}

// The page's files, read once and kept with their ETag and compressed copies.
// A file is read again when its size or modification time changes, or when
// `variant` does (the station name that index.html and the manifest carry).
export class StaticFiles {
  constructor() {
    this.files = new Map();
  }
  // Returns { encoded, etag }, or null when the path isn't a regular file.
  get(file, variant = '', transform = (b) => b) {
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    if (!st.isFile()) return null;
    const stamp = `${st.size}:${st.mtimeMs}:${variant}`;
    const hit = this.files.get(file);
    if (hit && hit.stamp === stamp) return hit;
    const buf = transform(fs.readFileSync(file));
    const entry = { stamp, encoded: new Encoded(buf), etag: etagOf(buf) };
    this.files.set(file, entry);
    return entry;
  }
}
