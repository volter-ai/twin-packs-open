// A connection owns its negotiation and in-flight block, never stored table data.
// HTTP and native calls reach the same handler/context and query engine.
// source: https://raw.githubusercontent.com/ClickHouse/clickhouse-docs/main/docs/native-protocol/server.md "Response to"
import { privateTransportKey, type DerivedFetch, type PackFetchOptions, type TwinStream } from '@volter/world-core';
import { clickhouse } from '@volter/world-core';
const { stringifyJson } = clickhouse;
type ClickHouseColumn = clickhouse.ClickHouseColumn;
type QueryResult = clickhouse.QueryResult;
import { createClickhouseFetch } from './fetch.ts';
import { SqlError } from './engine/ddl.ts';
import { dataPacket, endOfStream, exception, NeedMore, readBlock, readCompressedBlock, Reader, Writer, type Block } from './engine/codec.ts';
import { WIRE_HEADER } from './semantics/shared.ts';
import type { ReadonlyMode } from './engine/configuration.ts';
import { parseReadonly } from './engine/user-policy.ts';
import type { ClientSetting } from './engine/user-policy.ts';

// Negotiating this revision disables fields added after the implemented layout.
const REVISION = 54429;
type Packet = { kind: 'hello'; revision: number; database: string; user: string; password: string }
  | { kind: 'query'; sql: string; readonly: boolean; readonlySetting?: ReadonlyMode; settings: ClientSetting[]; compressed: boolean }
  | { kind: 'data'; name: string; block: Block }
  | { kind: 'ping' }
  | { kind: 'cancel' };
function packet(reader: Reader, hello: boolean, compressed: boolean): Packet {
  const type = reader.number();
  if (type === 0 && !hello) {
    reader.string(); reader.uint(); reader.uint(); const revision = reader.number();
    const database = reader.string(), user = reader.string(), password = reader.string();
    if (revision < REVISION) throw new SqlError(48, 'This native revision is not implemented');
    return { kind: 'hello', revision, database, user, password };
  }
  if (!hello) throw new SqlError(102, 'Expected Hello packet');
  if (type === 4) return { kind: 'ping' };
  if (type === 3) return { kind: 'cancel' };
  if (type === 2) { const name = reader.string(); return { kind: 'data', name, block: compressed ? readCompressedBlock(reader) : readBlock(reader) }; }
  if (type !== 1) throw new SqlError(102, 'Unexpected packet from client');
  reader.string(); // query_id
  const queryKind = reader.byte();
  if (queryKind) {
    reader.string(); reader.string(); reader.string();
    if (reader.byte() !== 1) throw new SqlError(48, 'Non-TCP ClientInfo is not implemented');
    reader.string(); reader.string(); reader.string(); reader.uint(); reader.uint(); reader.uint();
    reader.string(); reader.uint(); // quota key, client version patch at negotiated54429
  }
  let readonly = false, readonlySetting: ReadonlyMode | undefined;
  const settings: ClientSetting[] = [];
  while (true) {
    const key = reader.string(); if (!key) break;
    // The reached0.2.10 client's writer encodes key, flags, value, in that order.
    const flags = reader.byte(), value = reader.string();
    settings.push({ name: key, value, flags });
    if (key === 'readonly') { readonlySetting = parseReadonly(value); readonly = readonlySetting !== 0; }
  }
  if (reader.number() !== 2) throw new SqlError(48, 'Partial query stages are not implemented');
  const compression = reader.number(), sql = reader.string();
  if (compression !== 0 && compression !== 1) throw new SqlError(117, 'Invalid compression flag');
  return { kind: 'query', sql, readonly, settings, ...(readonlySetting !== undefined ? { readonlySetting } : {}), compressed: compression === 1 };
}
function finiteJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(finiteJson);
  return typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;
}
export function createClickhouseTwinStream(options: PackFetchOptions = {}, fetch: DerivedFetch = createClickhouseFetch(options)): TwinStream {
  return (sink) => {
    let bytes = new Uint8Array(), greeted = false, closed = false, pumping = false;
    let credentials = { database: 'default', user: 'default', password: '' };
    let phase: 'ready' | 'external' | 'insert' | 'running' = 'ready';
    let query: Extract<Packet, { kind: 'query' }> | undefined;
    let columns: ClickHouseColumn[] = [], inserted: unknown[][] = [];
    let cancelled = false;
    let settled = Promise.resolve(), operation: AbortController | undefined;
    const fail = (error: unknown): void => { sink.write(exception(error)); closed = true; operation?.abort(); bytes = new Uint8Array(); inserted = []; sink.end(); };
    const call = async (sql: string, args: { readonly?: boolean; readonlySetting?: ReadonlyMode; settings?: ClientSetting[]; data?: unknown[][]; describeInsert?: boolean } = {}): Promise<QueryResult> => {
      const url = new URL('http://clickhouse.native/');
      url.searchParams.set('database', credentials.database || 'default');
      url.searchParams.set('user', credentials.user); url.searchParams.set('password', credentials.password);
      cancelled = false; operation = new AbortController();
      const response = await fetch(new Request(url, {
        method: 'POST', headers: { 'content-type': 'application/json', [WIRE_HEADER]: privateTransportKey('clickhouse-native') },
        body: stringifyJson({ query: sql, ...args, ...(args.data ? { data: args.data.map(row => row.map(finiteJson)) } : {}) }), signal: operation.signal,
      }));
      if (response.status !== 200) throw new SqlError(Number(response.headers.get('X-ClickHouse-Exception-Code') ?? 1002), await response.text());
      return await response.json() as QueryResult;
    };
    const complete = async (): Promise<void> => {
      if (!query) throw new SqlError(102, 'No query is in progress');
      const current = query; phase = 'running';
      const result = await call(current.sql, { readonly: current.readonly, settings: current.settings, ...(current.readonlySetting !== undefined ? { readonlySetting: current.readonlySetting } : {}), ...(inserted ? { data: inserted } : {}) });
      if (!closed && !cancelled) { sink.write(dataPacket(result, true, current.compressed)); if (result.rows) sink.write(dataPacket(result, false, current.compressed)); sink.write(endOfStream()); }
      if (cancelled && !closed) sink.write(endOfStream());
      query = undefined; inserted = []; columns = []; phase = 'ready';
    };
    const handle = async (value: Packet): Promise<void> => {
      if (value.kind === 'hello') {
        credentials = { database: value.database, user: value.user, password: value.password };
        // The handshake checks the requested user's and database's actual held state.
        await call('SELECT 1', { readonly: true });
        if (closed) return;
        sink.write(new Writer().uint(0).string('ClickHouse').uint(26).uint(9).uint(REVISION).string('UTC').string('World ClickHouse').uint(13).finish());
        greeted = true; return;
      }
      if (value.kind === 'ping') { sink.write(new Writer().uint(4).finish()); return; }
      if (value.kind === 'cancel') { query = undefined; columns = []; inserted = []; phase = 'ready'; operation?.abort(); sink.write(endOfStream()); return; }
      if (value.kind === 'query') {
        if (phase !== 'ready') throw new SqlError(102, 'A query is already in progress');
        query = value; phase = 'external'; inserted = []; return;
      }
      if (!query) throw new SqlError(102, 'Unexpected Data packet');
      if (phase === 'external') {
        if (value.name || value.block.columns.length || value.block.rows.length) throw new SqlError(48, 'External tables are not implemented');
        if (/^\s*INSERT\b/i.test(query.sql)) {
          const result = await call(query.sql, { readonly: query.readonly, settings: query.settings, ...(query.readonlySetting !== undefined ? { readonlySetting: query.readonlySetting } : {}), describeInsert: true });
          columns = result.meta; sink.write(dataPacket(result, true, query.compressed)); phase = 'insert';
        } else {
          // SELECT/DDL has no input data: preserve the common handler's ordinary statement path.
          phase = 'running'; const result = await call(query.sql, { readonly: query.readonly, settings: query.settings, ...(query.readonlySetting !== undefined ? { readonlySetting: query.readonlySetting } : {}) });
          if (!closed && !cancelled) { sink.write(dataPacket(result, true, query.compressed)); if (result.rows) sink.write(dataPacket(result, false, query.compressed)); sink.write(endOfStream()); }
          if (cancelled && !closed) sink.write(endOfStream());
          query = undefined; phase = 'ready';
        }
        return;
      }
      if (phase !== 'insert' || value.name) throw new SqlError(102, 'Unexpected Data packet');
      if (!value.block.columns.length && !value.block.rows.length) { await complete(); return; }
      if (value.block.columns.length !== columns.length || value.block.columns.some((column, i) => column.name !== columns[i]!.name || column.type !== columns[i]!.type)) throw new SqlError(53, 'Insert block schema differs from its sample');
      inserted.push(...value.block.rows);
    };
    const pump = (): void => {
      if (pumping || closed) return;
      pumping = true;
      settled = (async () => {
        while (bytes.length && !closed) {
          const reader = new Reader(bytes); let value: Packet;
          try { value = packet(reader, greeted, query?.compressed === true); } catch (error) { if (error instanceof NeedMore) break; throw error; }
          bytes = bytes.slice(reader.at); await handle(value);
        }
      })().catch(error => {
        if (!closed && cancelled) { cancelled = false; query = undefined; columns = []; inserted = []; phase = 'ready'; sink.write(endOfStream()); }
        else if (!closed) fail(error);
      }).finally(() => { pumping = false; });
    };
    return {
      data(chunk) {
        if (closed) return;
        if (phase === 'running' && bytes.length === 0 && chunk.length === 1 && chunk[0] === 3) { cancelled = true; operation?.abort(); return; }
        const joined = new Uint8Array(bytes.length + chunk.length); joined.set(bytes); joined.set(chunk, bytes.length); bytes = joined; pump();
      },
      settled: () => settled,
      close() { closed = true; operation?.abort(); bytes = new Uint8Array(); inserted = []; },
    };
  };
}
