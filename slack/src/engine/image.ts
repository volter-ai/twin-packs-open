// An image's size as its own header gives it: Slack answers an uploaded image's `original_w` and `original_h`
// (https://docs.slack.dev/reference/objects/file-object). PNG's IHDR (https://www.w3.org/TR/png/#11IHDR), GIF's logical
// screen (https://www.w3.org/Graphics/GIF/spec-gif89a.txt, 18) and JPEG's start-of-frame (ITU T.81, B.2.2).

/** The width and height an image's bytes declare, or undefined for bytes that are none of PNG, GIF or JPEG. */
export function imageSize(b: Uint8Array): { w: number; h: number } | undefined {
  const u16be = (i: number): number => (b[i]! << 8) | b[i + 1]!;
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { w: ((b[16]! << 24) >>> 0) + (b[17]! << 16) + (b[18]! << 8) + b[19]!, h: ((b[20]! << 24) >>> 0) + (b[21]! << 16) + (b[22]! << 8) + b[23]! };
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { w: b[6]! | (b[7]! << 8), h: b[8]! | (b[9]! << 8) };
  // a JPEG's segments, each a marker and its length, up to the start of frame (SOF0–SOF15 but DHT, JPG and DAC)
  const frame = (i: number): { w: number; h: number } | undefined => i + 9 >= b.length || b[i] !== 0xff ? undefined
    : b[i + 1]! >= 0xc0 && b[i + 1]! <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(b[i + 1]!) ? { w: u16be(i + 7), h: u16be(i + 5) }
    : frame(i + 2 + u16be(i + 2));
  return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 ? frame(2) : undefined;
}
