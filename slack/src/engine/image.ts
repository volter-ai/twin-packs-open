// An image's size as its own header gives it: Slack answers an uploaded image's `original_w` and `original_h`
// (https://docs.slack.dev/reference/objects/file-object). PNG's IHDR (https://www.w3.org/TR/png/#11IHDR), GIF's logical
// screen (https://www.w3.org/Graphics/GIF/spec-gif89a.txt, 18) and JPEG's start-of-frame (ITU T.81, B.2.2).
import { readImageHeader } from '@volter/world-core';

/** The width and height an image's bytes declare, or undefined for bytes that are none of PNG, GIF or JPEG. */
export function imageSize(b: Uint8Array): { w: number; h: number } | undefined {
  const image = readImageHeader(b);
  if (!image || image.type === 'image/webp' || (image.type === 'image/gif' && b[3] !== 0x38)) return undefined;
  // Slack requires contiguous length-bearing JPEG markers and one byte after the frame dimensions.
  if (image.type === 'image/jpeg' && (!image.jpeg || image.jpeg.frameEnd >= b.length || image.jpeg.nonMarkerBytes || image.jpeg.standaloneMarkers || image.jpeg.fillBytes)) return undefined;
  return { w: image.width, h: image.height };
}
