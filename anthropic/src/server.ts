// FETCH-FIRST (runtime contract R12b): a fixed file, the kernel's serve seam around the pack's fetch (./fetch.ts).
import { serveHttp, type PackFetchOptions } from '@volter/world-core';
import { createAnthropicFetch } from './fetch.ts';

export async function createAnthropicTwinServer(options: PackFetchOptions & { port?: number } = {}): Promise<{ port: number; stop: () => void }> {
  const server = await serveHttp({ port: options.port ?? 0, idleTimeout: 60, fetch: createAnthropicFetch(options) });
  return { port: server.port ?? options.port ?? 0, stop: () => server.stop(true) };
}
