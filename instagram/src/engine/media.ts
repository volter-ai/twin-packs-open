// What Instagram reads of a fetched file before it publishes it, as pure computation over its bytes: whether an image
// is a JPEG and its frame's width and height (from its start-of-frame marker), whether a video is an MP4 or MOV (its
// `ftyp` box) and its duration (from its `mvhd` box). The twin decodes no picture or sound.

/** A JPEG's width and height, from its first start-of-frame marker; undefined for bytes that are not a JPEG. */
export function jpegFacts(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return undefined;
    const marker = bytes[at + 1]!;
    // fill bytes, and the markers that carry no length
    if (marker === 0xff) { at += 1; continue; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
    const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
    if (length < 2) return undefined;
    // SOF0..SOF15, but DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (at + 9 > bytes.length) return undefined;
      const height = (bytes[at + 5]! << 8) | bytes[at + 6]!;
      const width = (bytes[at + 7]! << 8) | bytes[at + 8]!;
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    // the scan begins: no frame header came before it
    if (marker === 0xda) return undefined;
    at += 2 + length;
  }
  return undefined;
}

/** Whether bytes begin as a PNG does. */
const isPng = (bytes: Uint8Array): boolean => bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;

/** The format an image's bytes are in, by their signature: `JPEG`, `PNG`, or `unknown`. */
export const imageFormat = (bytes: Uint8Array): 'JPEG' | 'PNG' | 'unknown' => (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'JPEG' : isPng(bytes) ? 'PNG' : 'unknown');

const box = (bytes: Uint8Array, at: number): { size: number; type: string } | undefined => {
  if (at + 8 > bytes.length) return undefined;
  const size = ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
  const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
  return { size, type };
};

/** An MP4 or MOV file's facts: whether it opens with an `ftyp` box, and its duration in seconds from the movie header
 *  (`moov` > `mvhd`: its timescale and duration, version 0 or 1), when it carries one. */
export function mp4Facts(bytes: Uint8Array): { isMp4: boolean; durationSeconds?: number } {
  const first = box(bytes, 0);
  if (!first || first.type !== 'ftyp') return { isMp4: false };
  let at = 0;
  while (at + 8 <= bytes.length) {
    const b = box(bytes, at);
    if (!b || b.size < 8) break;
    if (b.type === 'moov') {
      let inner = at + 8;
      while (inner + 8 <= Math.min(bytes.length, at + b.size)) {
        const c = box(bytes, inner);
        if (!c || c.size < 8) break;
        if (c.type === 'mvhd') {
          const version = bytes[inner + 8];
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          if (version === 1 && inner + 40 <= bytes.length) {
            const timescale = view.getUint32(inner + 28);
            const duration = Number(view.getBigUint64(inner + 32));
            return { isMp4: true, ...(timescale ? { durationSeconds: duration / timescale } : {}) };
          }
          if (inner + 28 <= bytes.length) {
            const timescale = view.getUint32(inner + 20);
            const duration = view.getUint32(inner + 24);
            return { isMp4: true, ...(timescale ? { durationSeconds: duration / timescale } : {}) };
          }
        }
        inner += c.size;
      }
    }
    at += b.size;
  }
  return { isMp4: true };
}
