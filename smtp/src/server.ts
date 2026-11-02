// FETCH-FIRST (runtime contract R12b) with a raw-TCP wire: the relay's SMTP listener (`port`, the kernel's `serveStream`
// carrying the byte-stream door's connections) and its inspect port (`inspectPort`, the pack's fetch: the World's doors).
import { serveHttp, serveStream, type PackFetchOptions } from '@volter/world-core';
import { createSmtpFetch } from './fetch.ts';
import { createSmtpTwinStream } from './stream.ts';

export async function createSmtpTwinServer(options: PackFetchOptions & { port?: number; inspectPort?: number } = {}): Promise<{ port: number; inspectPort: number; stop: () => void }> {
  const inspect = await serveHttp({ port: options.inspectPort ?? 0, idleTimeout: 60, fetch: createSmtpFetch(options) });
  const smtp = await serveStream({ port: options.port ?? 0, stream: createSmtpTwinStream(options) });
  return {
    port: smtp.port,
    inspectPort: inspect.port ?? options.inspectPort ?? 0,
    stop: () => { smtp.stop(); inspect.stop(true); },
  };
}
