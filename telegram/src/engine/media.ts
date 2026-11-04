// What Telegram reads from an uploaded file's own bytes: an image's width and height (a PhotoSize), and a video's width,
// height and duration (a Video), each from the format's header as that format defines it. Pure computation over bytes.

type ImageSize = { width: number; height: number; mime: string };
type VideoInfo = { width: number; height: number; duration: number };

const u16be = (b: Uint8Array, i: number): number => (b[i]! << 8) | b[i + 1]!;
const u32be = (b: Uint8Array, i: number): number => ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!;
const u16le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const ascii = (b: Uint8Array, i: number, n: number): string => String.fromCharCode(...b.subarray(i, i + n));

/** An image's size from its header: PNG (IHDR), GIF (logical screen), JPEG (the first start-of-frame); undefined for
 *  anything else (a photo Telegram takes is a .jpg, .jpeg, .gif, .png, .tif or .bmp, MessagesManager.cpp's
 *  PHOTO_EXT_INVALID; the twin reads the first three). */
export function imageSize(b: Uint8Array): ImageSize | undefined {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') return { width: u32be(b, 16), height: u32be(b, 20), mime: 'image/png' };
  if (b.length >= 10 && ascii(b, 0, 3) === 'GIF') return { width: u16le(b, 6), height: u16le(b, 8), mime: 'image/gif' };
  // a JPEG's markers are walked to its first frame header; a JPEG with none, like any other file, has no size
  const jpeg = b.length >= 4 && b[0] === 0xff && b[1] === 0xd8;
  for (let i = 2; jpeg && i + 9 < b.length; i += b[i] !== 0xff ? 1 : jpegStep(b, i)) {
    const marker = b[i + 1]!;
    // SOF0-SOF15 but DHT (C4), JPG (C8) and DAC (CC) carry the frame's height and width
    if (b[i] === 0xff && marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16be(b, i + 5), width: u16be(b, i + 7), mime: 'image/jpeg' };
  }
  return undefined;
}

/** How far a JPEG's marker at `i` reaches: a marker with no length (SOI, TEM, RSTn) is its two bytes, any other its
 *  length after them. */
const jpegStep = (b: Uint8Array, i: number): number => {
  const marker = b[i + 1]!;
  return marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) ? 2 : 2 + u16be(b, i + 2);
};

/** An MP4's (ISO base media) duration in whole seconds from its movie header (mvhd), and the first track with a size
 *  from its track header (tkhd: 16.16 fixed-point width and height); undefined for a file that is not one. */
export function mp4Info(b: Uint8Array): VideoInfo | undefined {
  if (b.length < 12 || ascii(b, 4, 4) !== 'ftyp') return undefined;
  let duration: number | undefined;
  let width = 0;
  let height = 0;
  const walk = (start: number, end: number): void => {
    let i = start;
    while (i + 8 <= end) {
      let size = u32be(b, i);
      const type = ascii(b, i + 4, 4);
      let header = 8;
      if (size === 1 && i + 16 <= end) { size = u32be(b, i + 8) * 2 ** 32 + u32be(b, i + 12); header = 16; }
      if (size === 0) size = end - i;
      if (size < header || i + size > end) return;
      if (type === 'moov' || type === 'trak') walk(i + header, i + size);
      else if (type === 'mvhd') {
        const v = b[i + header]!;
        const timescale = v === 1 ? u32be(b, i + header + 20) : u32be(b, i + header + 12);
        const units = v === 1 ? u32be(b, i + header + 24) * 2 ** 32 + u32be(b, i + header + 28) : u32be(b, i + header + 16);
        if (timescale) duration = Math.round(units / timescale);
      } else if (type === 'tkhd' && !width) {
        const v = b[i + header]!;
        const at = i + header + (v === 1 ? 88 : 76);
        if (at + 8 <= i + size) { width = u32be(b, at) >>> 16; height = u32be(b, at + 4) >>> 16; }
      }
      i += size;
    }
  };
  walk(0, b.length);
  return duration === undefined ? undefined : { width, height, duration };
}
