// FETCH-FIRST (runtime contract R12b): a fixed file, the kernel's serve seam around the pack's fetch (./fetch.ts).
import { clickhouse, privateTransportKey, serveHttp, serveStream, type PackFetchOptions } from '@volter/world-core';
import { createClickhouseFetch } from './fetch.ts';
import { createClickhouseTwinStream } from './stream.ts';
import type { ServerConfiguration } from './semantics/shared.ts';
import { readOriginalInputs, type OriginalInputs } from './engine/original-inputs.ts';
import { SOURCE_POLICY_HEADER } from './engine/user-policy.ts';

export async function createClickhouseTwinServer(options: PackFetchOptions & { port?: number; nativePort?: number; configuration?: ServerConfiguration; originalInputs?: OriginalInputs } = {}): Promise<{ port: number; nativePort: number; stop: () => Promise<void> }> {
  if (typeof clickhouse.encodeFrame !== 'function' || typeof clickhouse.decodeFrame !== 'function')
    throw new Error('ClickHouse twin requires the World kernel with native compression-frame support');
  const source = options.originalInputs ? await readOriginalInputs(options.originalInputs) : undefined;
  if (source && !source.complete) throw new Error('ClickHouse original input gaps: ' + source.directives.filter(row => row.disposition === 'gap').map(row => `${row.file}:${row.directive}: ${row.reason}`).join('\n'));
  const configuration = source ? { ...source.configuration, ...options.configuration } : options.configuration;
  if (source && configuration) for (const field of ['users', 'userPolicies', 'macros', 'clusters'] as const) {
    const original = source.configuration[field], declared = options.configuration?.[field];
    if (original && (field === 'users' || field === 'userPolicies')) for (const key of Object.keys(declared ?? {})) {
      if (!Object.hasOwn(original, key)) throw new Error(`ClickHouse operator ${field}.${key} is absent from the original users configuration`);
    }
    for (const key of Object.keys(original ?? {})) if (Object.hasOwn(declared ?? {}, key)
      && JSON.stringify(original![key]) !== JSON.stringify(declared![key])) throw new Error(`ClickHouse original ${field}.${key} conflicts with the operator declaration`);
    if (original || declared) Object.assign(configuration, { [field]: { ...original, ...declared } });
  }
  // The entire source reading must be consumed before the first store or listener change.
  const fetch = createClickhouseFetch(options);
  if (configuration) {
    const { databases = [], ...operator } = configuration;
    if (!Array.isArray(databases) || databases.some(value => typeof value !== 'string' || !value)) throw new Error('Invalid initial databases');
    if (operator.users !== undefined && (!operator.users || typeof operator.users !== 'object' || Array.isArray(operator.users) || !Object.keys(operator.users).length)) throw new Error('Invalid initial users');
    const configured = await fetch(new Request('http://clickhouse.operator/_twin/configuration', { method: 'POST', headers: {
      'content-type': 'application/json', ...(source?.configuration.users ? { [SOURCE_POLICY_HEADER]: privateTransportKey('clickhouse-source-policy') } : {}),
    }, body: JSON.stringify(operator) }));
    if (!configured.ok) throw new Error('ClickHouse operator configuration refused: ' + await configured.text());
    const [user, password] = Object.entries(operator.users ?? { default: '' })[0] ?? [];
    if (user === undefined || password === undefined) throw new Error('ClickHouse requires an initial user');
    for (const database of databases) {
      const url = new URL('http://clickhouse.operator/'); url.searchParams.set('user', user); url.searchParams.set('password', password);
      const created = await fetch(new Request(url, { method: 'POST', body: 'CREATE DATABASE IF NOT EXISTS `' + database.replace(/[\\`]/g, '\\$&') + '`' }));
      if (!created.ok) throw new Error('ClickHouse initial database refused: ' + await created.text());
    }
    // Original SQL remains a startup gap until its entrypoint initialization/resume contract is supplied.
  }
  // Bind native first: the HTTP boot answer cannot become visible before the side listener exists.
  const native = await serveStream({ port: options.nativePort ?? 0, stream: createClickhouseTwinStream(options, fetch) });
  try {
    const http = await serveHttp({ port: options.port ?? 0, idleTimeout: 60, fetch });
    return { port: http.port, nativePort: native.port, stop: async () => { native.stop(); await http.stop(true); } };
  } catch (error) { native.stop(); throw error; }
}
