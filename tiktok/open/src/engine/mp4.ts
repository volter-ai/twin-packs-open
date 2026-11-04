// TikTok uses the first movie's duration and first picture track, rounded to seconds and whole pixels.
// A file with no such headers answers zeros; processing does not decode media.
import { readMp4Header } from '@volter/world-core';

type Mp4Facts = { duration: number; width: number; height: number };

export function mp4Facts(b: Uint8Array): Mp4Facts {
  const facts: Mp4Facts = { duration: 0, width: 0, height: 0 };
  const movie = readMp4Header(b).movies[0];
  if (!movie) return facts;
  for (const header of movie.headers) if (header.timescale > 0) facts.duration = Math.round(header.duration / header.timescale);
  const track = movie.tracks.find(({ width, height }) => Math.floor(width) > 0 && Math.floor(height) > 0);
  if (track) {
    facts.width = Math.floor(track.width);
    facts.height = Math.floor(track.height);
  }
  return facts;
}
