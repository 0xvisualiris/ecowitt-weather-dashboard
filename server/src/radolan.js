// Decodes a DWD RADOLAN composite (the national radar precipitation grid) —
// a stable, well-documented ASCII-header + raw-binary-grid format, hand-
// parsed the same way dwd.js hand-parses a MOSMIX KMZ: no format-specific
// library, just a known structure.
//
// Layout: an ASCII header, terminated by an ETX (0x03) byte, followed by
// width*height little-endian uint16 values, one per grid cell, row-major
// from the north-west corner. Each 16-bit value's low 12 bits are the
// quantized measurement (apply the header's PR precision to get mm); 2500
// in those 12 bits is DWD's fixed "no data" sentinel (outside radar range),
// confirmed against real files rather than assumed. The remaining header
// fields read here: GP (grid width/height) and PR (precision exponent,
// e.g. "E-02" means multiply by 10^-2).

const NODATA_RAW = 2500;

export function decodeRadolan(buf) {
  const etx = buf.indexOf(0x03);
  if (etx < 0) throw new Error('RADOLAN: no header terminator (ETX) found');
  const header = buf.subarray(0, etx).toString('ascii');

  const gp = header.match(/GP\s*(\d+)\s*x\s*(\d+)/);
  if (!gp) throw new Error('RADOLAN: no GP (grid size) field in header');
  const width = Number(gp[1]), height = Number(gp[2]);

  const pr = header.match(/PR\s*E([+-]\d+)/);
  const precision = pr ? 10 ** Number(pr[1]) : 0.1;

  // Header's leading DDHHMM (day/hour/minute, UTC) right after the 2-char product code.
  const ts = header.match(/^\w{2}(\d{2})(\d{2})(\d{2})/);
  const now = new Date();
  let timestamp = null;
  if (ts) {
    const day = Number(ts[1]), hour = Number(ts[2]), minute = Number(ts[3]);
    const year = now.getUTCFullYear(), month = now.getUTCMonth();
    // The header has no year/month – infer the most recent occurrence of
    // this day-of-month not in the future (handles the turn of a month).
    timestamp = Date.UTC(year, month, day, hour, minute);
    if (timestamp > now.getTime() + 3600_000) timestamp = Date.UTC(year, month - 1, day, hour, minute);
  }

  const payload = buf.subarray(etx + 1);
  const expected = width * height * 2;
  if (payload.length < expected) throw new Error(`RADOLAN: payload too short (${payload.length} < ${expected} bytes)`);

  // 255 = no data (outside radar range), 0 = valid reading of zero, 1-254 =
  // a clamped display class for the intensity. Not the precise mm value —
  // this feeds a client-side color ramp for a live visual, not analysis.
  const grid = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const raw = payload.readUInt16LE(i * 2);
    const v = raw & 0x0fff;
    if (v === NODATA_RAW) { grid[i] = 255; continue; }
    if (v === 0) { grid[i] = 0; continue; }
    const mm = v * precision;
    grid[i] = Math.max(1, Math.min(254, Math.round(mm * 20))); // display scaling, tuned for the 5-min RY product
  }

  return { width, height, precision, timestamp, grid };
}
