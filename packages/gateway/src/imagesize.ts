/** Reads W×H from a JPEG, PNG or WebP header without decoding (the returned size is recorded as-is). */
export function imageSize(buf: Uint8Array): { width: number; height: number; format: string } | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { width: dv.getUint32(16), height: dv.getUint32(20), format: 'png' };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = dv.getUint16(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7), format: 'jpeg' };
      i += 2 + len;
    }
    return null;
  }
  if (buf.length > 30 && String.fromCharCode(...buf.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...buf.subarray(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...buf.subarray(12, 16));
    if (chunk === 'VP8X') return { width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)), format: 'webp' };
    if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff, format: 'webp' };
    if (chunk === 'VP8L') {
      const b = dv.getUint32(21, true);
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, format: 'webp' };
    }
  }
  return null;
}
