// FETCH-FIRST (runtime contract R12b): a fixed file, the kernel's serve seam around the pack's fetch (./fetch.ts).
import { grpc, serveStream, type PackFetchOptions } from '@volter/world-core';
import schema from './generated/proto.gen.json' with { type: 'json' };
import { createPlanetscaleFetch } from './fetch.ts';
import { createPlanetscaleTwinStream } from './stream.ts';

export async function createPlanetscaleTwinServer(options: PackFetchOptions & { port?: number; wirePort?: number } = {}): Promise<{ port: number; wirePort: number; stop: () => void }> {
  const fetch = createPlanetscaleFetch(options);
  // the vendor speaks gRPC (its manifest's `grpc`): HTTP/2 and HTTP/1 on one port, each rpc through the fetch
  const server = await grpc.serveGrpc({ ...(options.port ? { port: options.port } : {}), fetch: async (r) => fetch(r), schema: schema as unknown as Parameters<typeof grpc.serveGrpc>[0]['schema'] });
  // the unit's own wire beside its API, on its side port (the manifest's sidePorts: `wirePort`)
  const wire = await serveStream({ port: options.wirePort ?? 0, stream: createPlanetscaleTwinStream(options) });
  return { port: server.port, wirePort: wire.port, stop: () => { wire.stop(); server.stop(); } };
}
