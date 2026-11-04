// FETCH-FIRST (runtime contract R12b): a fixed file, the kernel's serve seam around the pack's fetch (./fetch.ts).
import { serveHttp, type PackFetchOptions } from '@volter/world-core';
import { createJiraFetch } from './fetch.ts';

export async function createJiraTwinServer(options: PackFetchOptions & { port?: number } = {}): Promise<{ port: number; stop: () => void }> {
  const fetch = createJiraFetch(options);
  // the vendor's sockets, when its manifest declares any (the kernel's sockets.ts)
  const server = await serveHttp({ port: options.port ?? 0, idleTimeout: 60, fetch, ...(fetch.upgrade ? { upgrade: fetch.upgrade } : {}) });
  return { port: server.port ?? options.port ?? 0, stop: () => server.stop(true) };
}
