// FETCH-FIRST (runtime contract R12b): a fixed file, the kernel's serve seam around the pack's fetch (./fetch.ts).
import { serveHttp, serveStream, StreamListenerUnavailable, type PackFetchOptions } from '@volter/world-core';
import { createTwitchFetch } from './fetch.ts';

export async function createTwitchTwinServer(options: PackFetchOptions & { port?: number; ingestPort?: number } = {}): Promise<{ port: number; ingestPort: number; stop: () => void }> {
  const fetch = createTwitchFetch(options);
  const server = await serveHttp({ port: options.port ?? 0, idleTimeout: 60, fetch });
  // the vendor's RTMP ingest beside its HTTP host, on its side port (the manifest's live and sidePorts: `ingestPort`).
  // A runtime with no TCP listener at all serves the twin without one (ingestPort 0); a listen that fails (the port
  // taken) fails the twin's start, as its HTTP listener's would, so the World never records an ingest nothing serves
  let ingest: { port: number; stop: () => void } | undefined;
  try { ingest = await serveStream({ port: options.ingestPort ?? 0, stream: fetch.ingest! }); }
  catch (error) {
    if (!(error instanceof StreamListenerUnavailable)) { await server.stop(true); throw error; }
    console.error(`twitch twin: no RTMP ingest here (${error.message}); serving without one`);
  }
  return { port: server.port ?? options.port ?? 0, ingestPort: ingest?.port ?? 0, stop: () => { ingest?.stop(); void server.stop(true); } };
}
