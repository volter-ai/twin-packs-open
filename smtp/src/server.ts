// FETCH-FIRST (runtime contract R12b) with a raw-TCP wire: the relay's SMTP listener (`port`, the kernel's `serveStream`
// carrying the byte-stream door's connections) and its policy port (`policyPort`, the manifest's `policy` side port: the
// pack's fetch, where the relay's operator sets its policy at /_twin/relay). A listener that fails to open releases the
// one already open; stop closes both and settles once both have.
import { serveHttp, serveStream, type PackFetchOptions } from '@volter/world-core';
import { createSmtpFetch } from './fetch.ts';
import { createSmtpTwinStream } from './stream.ts';

export async function createSmtpTwinServer(options: PackFetchOptions & { port?: number; policyPort?: number } = {}): Promise<{ port: number; policyPort: number; stop: () => Promise<void> }> {
  const policy = await serveHttp({ port: options.policyPort ?? 0, idleTimeout: 60, fetch: createSmtpFetch(options) });
  let smtp: Awaited<ReturnType<typeof serveStream>>;
  try { smtp = await serveStream({ port: options.port ?? 0, stream: createSmtpTwinStream(options) }); }
  catch (error) { await policy.stop(true); throw error; }
  return {
    port: smtp.port,
    policyPort: policy.port ?? options.policyPort ?? 0,
    stop: async () => { await Promise.all([smtp.stop(), policy.stop(true)]); },
  };
}
