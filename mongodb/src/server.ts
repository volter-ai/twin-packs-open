// FETCH-FIRST: the managed service's TCP listener and its discovery/clock HTTP listener.
import { serveHttp, serveStream, type PackFetchOptions } from '@volter/world-core';
import { createMongodbFetch } from './fetch.ts';
import { createMongodbTwinStream } from './stream.ts';
import type { SingleMemberHandshake } from './engine/replica-handshake.ts';

export async function createMongodbTwinServer(options: PackFetchOptions & { port?: number; inspectPort?: number; replicaSet?: string } = {}): Promise<{ port: number; inspectPort: number; stop: () => void }> {
  let replicaSet: SingleMemberHandshake | undefined;
  if (options.replicaSet !== undefined) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(options.replicaSet)) throw new Error('MongoDB replica-set handshake needs a valid set name');
    if (!Number.isInteger(options.port) || options.port! < 1 || options.port! > 65535) throw new Error('MongoDB replica-set handshake needs an explicit listener port');
    replicaSet = { setName: options.replicaSet, self: `127.0.0.1:${options.port}` };
  }
  const inspect = await serveHttp({ port: options.inspectPort ?? 0, fetch: createMongodbFetch(options) });
  try {
    const tcp = await serveStream({ port: options.port ?? 0, stream: createMongodbTwinStream({ ...options, replicaSet }) });
    return { port: tcp.port, inspectPort: inspect.port!, stop: () => { tcp.stop(); inspect.stop(true); } };
  } catch (e) { inspect.stop(true); throw e; }
}
