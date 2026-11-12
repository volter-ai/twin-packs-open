// FETCH-FIRST: the managed service's TCP listener and its discovery/clock HTTP listener.
import { serveHttp, serveStream, type PackFetchOptions } from '@volter/world-core';
import { createRedisFetch } from './fetch.ts';
import { createRedisTwinStream } from './stream.ts';
export async function createRedisTwinServer(options: PackFetchOptions & { port?: number; inspectPort?: number; password?: string } = {}): Promise<{ port: number; inspectPort: number; stop: () => void }> {
  const inspect = await serveHttp({ port: options.inspectPort ?? 0, fetch: createRedisFetch(options) });
  try {
    const tcp = await serveStream({ port: options.port ?? 0, stream: createRedisTwinStream(options) });
    return { port: tcp.port, inspectPort: inspect.port!, stop: () => { tcp.stop(); inspect.stop(true); } };
  } catch (e) { inspect.stop(true); throw e; }
}
