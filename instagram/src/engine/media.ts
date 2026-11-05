// What Instagram reads of a fetched file before it publishes it, as pure computation over its bytes: whether an image
// is a JPEG and its frame's width and height (from its start-of-frame marker), whether a video is an MP4 or MOV (its
// `ftyp` box) and its duration (from its `mvhd` box). The twin decodes no picture or sound.
import { readImageHeader, readMp4Header } from '@volter/world-core';

/** A JPEG's width and height, from its first start-of-frame marker; undefined for bytes that are not a JPEG. */
export function jpegFacts(bytes: Uint8Array): { width: number; height: number } | undefined {
  const image = readImageHeader(bytes);
  // Instagram accepts fill and standalone markers, but not stray bytes, short segments or a zero-size frame.
  return image?.type === 'image/jpeg' && image.jpeg && !image.jpeg.nonMarkerBytes && !image.jpeg.shortSegments && image.width > 0 && image.height > 0
    ? { width: image.width, height: image.height } : undefined;
}

/** Whether bytes begin as a PNG does. */
const isPng = (bytes: Uint8Array): boolean => bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;

/** The format an image's bytes are in, by their signature: `JPEG`, `PNG`, or `unknown`. */
export const imageFormat = (bytes: Uint8Array): 'JPEG' | 'PNG' | 'unknown' => (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'JPEG' : isPng(bytes) ? 'PNG' : 'unknown');

/** An MP4 or MOV file's facts: whether it opens with an `ftyp` box, and its duration in seconds from the movie header
 *  (`moov` > `mvhd`: its timescale and duration, version 0 or 1), when it carries one. */
export function mp4Facts(bytes: Uint8Array): { isMp4: boolean; durationSeconds?: number } {
  const file = readMp4Header(bytes);
  if (!file.fileType) return { isMp4: false };
  // Use the first readable movie header and keep fractional seconds; a zero scale supplies no duration.
  // The shared reader omits truncated/unknown-version headers instead of reading beyond their declared boxes.
  const header = file.movies.flatMap((movie) => movie.headers)[0];
  return { isMp4: true, ...(header?.timescale ? { durationSeconds: header.duration / header.timescale } : {}) };
}
