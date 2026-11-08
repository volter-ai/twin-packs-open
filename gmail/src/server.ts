// FETCH-FIRST (runtime contract R12b) with a wire of the pack's own: the webmail on the main port (the pack's fetch) and
// Gmail's receiving SMTP server on its side port (`smtpPort`, the manifest's sidePorts: the kernel's `serveStream`
// carrying the byte-stream door's connections), where the World's senders hand gmail.com's mail (ctx.mail). A listener
// that fails to open releases the one already open; stop closes both and settles once both have.
import { serveHttp, serveStream, type PackFetchOptions } from '@volter/world-core';
import { createGmailFetch } from './fetch.ts';
import { createGmailTwinStream } from './stream.ts';

export async function createGmailTwinServer(options: PackFetchOptions & { port?: number; smtpPort?: number } = {}): Promise<{ port: number; smtpPort: number; stop: () => Promise<void> }> {
  const server = await serveHttp({ port: options.port ?? 0, idleTimeout: 60, fetch: createGmailFetch(options) });
  let smtp: Awaited<ReturnType<typeof serveStream>>;
  try { smtp = await serveStream({ port: options.smtpPort ?? 0, stream: createGmailTwinStream(options) }); }
  catch (error) { await server.stop(true); throw error; }
  return {
    port: server.port ?? options.port ?? 0,
    smtpPort: smtp.port,
    stop: async () => { await Promise.all([smtp.stop(), server.stop(true)]); },
  };
}
