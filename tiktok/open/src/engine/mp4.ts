// An MP4's duration and picture size, read from its boxes (ISO/IEC 14496-12: `moov`'s `mvhd` holds the timescale and
// duration; a video `trak`'s `tkhd` its width and height, 16.16 fixed point). The twin decodes no media: a file that
// holds no such boxes answers zeros. Pure: it takes bytes and answers numbers.
export type Mp4Facts = { duration: number; width: number; height: number };

function boxes(b: Uint8Array, from: number, to: number): Array<{ type: string; start: number; end: number }> {
  const out: Array<{ type: string; start: number; end: number }> = [];
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = from;
  while (at + 8 <= to) {
    let size = v.getUint32(at);
    const type = String.fromCharCode(b[at + 4]!, b[at + 5]!, b[at + 6]!, b[at + 7]!);
    let header = 8;
    if (size === 1 && at + 16 <= to) { size = Number(v.getBigUint64(at + 8)); header = 16; }
    if (size === 0) size = to - at;
    if (size < header || at + size > to) break;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}

export function mp4Facts(b: Uint8Array): Mp4Facts {
  const facts: Mp4Facts = { duration: 0, width: 0, height: 0 };
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const moov = boxes(b, 0, b.length).find((x) => x.type === 'moov');
  if (!moov) return facts;
  for (const box of boxes(b, moov.start, moov.end)) {
    if (box.type === 'mvhd') {
      const version = b[box.start]!;
      if (box.start + (version === 1 ? 32 : 20) > box.end) continue;
      const scale = version === 1 ? v.getUint32(box.start + 20) : v.getUint32(box.start + 12);
      const duration = version === 1 ? Number(v.getBigUint64(box.start + 24)) : v.getUint32(box.start + 16);
      if (scale > 0) facts.duration = Math.round(duration / scale);
    }
    if (box.type === 'trak') {
      const tkhd = boxes(b, box.start, box.end).find((x) => x.type === 'tkhd');
      if (!tkhd) continue;
      const version = b[tkhd.start]!;
      const at = tkhd.start + (version === 1 ? 88 : 76);
      if (at + 8 > tkhd.end) continue;
      const width = v.getUint32(at) >>> 16;
      const height = v.getUint32(at + 4) >>> 16;
      if (width && height && !facts.width) { facts.width = width; facts.height = height; }
    }
  }
  return facts;
}
