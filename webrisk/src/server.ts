// FETCH-FIRST (runtime contract R12b): a fixed file, the kernel's serve seam around the pack's fetch (./fetch.ts).
import { grpc, type PackFetchOptions } from '@volter/world-core';
import schema from './generated/proto.gen.json' with { type: 'json' };
import { createWebriskFetch } from './fetch.ts';

export async function createWebriskTwinServer(options: PackFetchOptions & { port?: number } = {}): Promise<{ port: number; stop: () => void }> {
  const fetch = createWebriskFetch(options);
  // the vendor speaks gRPC (its manifest's `grpc`): HTTP/2 and HTTP/1 on one port, each rpc through the fetch
  return grpc.serveGrpc({ ...(options.port ? { port: options.port } : {}), fetch: async (r) => fetch(r), schema: schema as unknown as Parameters<typeof grpc.serveGrpc>[0]['schema'] });
}
