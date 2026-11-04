// Telegram's format acceptance and presentation policy over the shared file-header facts.
import { readImageHeader, readMp4Header } from '@volter/world-core';

/** Telegram reads PNG's IHDR, GIF's logical screen and JPEG's first frame; other formats have no photo size. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | undefined {
  const image = readImageHeader(bytes);
  if (!image || image.type === 'image/webp') return undefined;
  if (image.type === 'image/png' && String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return undefined;
  if (image.type === 'image/jpeg' && (!image.jpeg || image.jpeg.frameEnd >= bytes.length)) return undefined;
  return { width: image.width, height: image.height };
}

/** Whole-second duration from the last usable movie header, and the first track whose floored width is nonzero. */
export function mp4Info(bytes: Uint8Array): { width: number; height: number; duration: number } | undefined {
  if (bytes.length < 12) return undefined;
  const file = readMp4Header(bytes);
  if (!file.fileType) return undefined;
  let duration: number | undefined;
  let width = 0;
  let height = 0;
  for (const movie of file.movies) {
    for (const header of movie.headers) {
      if (header.timescale) duration = Math.round(header.duration / header.timescale);
    }
    for (const track of movie.tracks) {
      if (!width) { width = Math.floor(track.width); height = Math.floor(track.height); }
    }
  }
  return duration === undefined ? undefined : { width, height, duration };
}
