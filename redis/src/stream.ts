import { redis, type PackFetchOptions, type TwinStream } from '@volter/world-core';
import { createRedisFetch } from './fetch.ts';
import { DIALECT, wireKey, WIRE_HEADER } from './semantics/shared.ts';

// source: https://redis.io/docs/latest/develop/reference/protocol-spec/ "A client sends a request to the Redis server as an array of strings."
export function createRedisTwinStream(options: PackFetchOptions & { password?: string } = {}): TwinStream {
  const fetch = createRedisFetch(options);
  return redis.createRedisStream({ dialect: DIALECT, version: '7.4.0', databases: 16, password: options.password,
    async run(commands, database) {
      const response = await fetch(new Request('http://redis.wire/', { method: 'POST', headers: { 'content-type': 'application/json', [WIRE_HEADER]: wireKey() }, body: JSON.stringify({ commands, database }) }));
      if (!response.ok) throw new Error(`Redis private transport answered ${response.status}`);
      return await response.json();
    },
  });
}
