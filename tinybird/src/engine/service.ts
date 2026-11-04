// Tinybird's Service Data Sources: "Service data sources that you can use to inspect what's going on in your Tinybird
// account … For example, you can get real time stats about API calls or a log of every operation over your data
// sources" (https://www.tinybird.co/docs/classic/monitoring/service-datasources). Each is a table under `tinybird.`
// a Workspace's queries read like any Data Source (`FROM tinybird.pipe_stats_rt`).
//
// SERVED: `tinybird.pipe_stats_rt`, "information about all requests made to your API endpoints in real time", with the
// page's columns and types. The twin appends one row per Endpoint request and per Query API request (whose `pipe_id` and
// `pipe_name` are `query_api`); "Calls made against Service data sources are not logged". "This Data Source has a TTL
// of 3 months": an older row on the World clock is not read. Tinybird's own CLI reads it before overriding an
// Endpoint, to replay its recent requests against the new version (`tb push --force`, tinybird-cli's PipeCheckerRunner).
//
// Every other Service Data Source the page lists is read by no demand or life step: a query naming one is the gap.
//
// Where the page stops and the twin decides: `duration` and `cpu_time` are the twin's deterministic elapsed time (the
// same figure its `statistics.elapsed` answers), `memory_usage` is the bytes the query read, `token` (the page's "API
// call token identifier") is a UUID derived from the Workspace and the token's name, `request_id` is a ULID derived from
// the request's instant and content, and `parameters` holds the request's parameters except `token`, which the page says
// is removed from `url` "for security reasons".
import { digestBytes, uuidFrom } from '@volter/world-core';
import type { TinybirdColumn } from './schema.ts';

export const PIPE_STATS_RT = 'tinybird.pipe_stats_rt';

/** `tinybird.pipe_stats_rt`'s columns, as the Service Data Sources page lists them. */
export const PIPE_STATS_RT_COLUMNS: TinybirdColumn[] = [
  { name: 'start_datetime', type: 'DateTime' },
  { name: 'pipe_id', type: 'String' },
  { name: 'pipe_name', type: 'String' },
  { name: 'duration', type: 'Float64' },
  { name: 'read_bytes', type: 'UInt64' },
  { name: 'read_rows', type: 'UInt64' },
  { name: 'result_rows', type: 'UInt64' },
  { name: 'url', type: 'String' },
  { name: 'error', type: 'UInt8' },
  { name: 'error_message', type: 'Nullable(String)' },
  { name: 'request_id', type: 'String' },
  { name: 'token', type: 'String' },
  { name: 'token_name', type: 'String' },
  { name: 'status_code', type: 'Int32' },
  { name: 'method', type: 'String' },
  { name: 'parameters', type: 'Map(String, String)' },
  { name: 'release', type: 'String' },
  { name: 'user_agent', type: 'Nullable(String)' },
  { name: 'resource_tags', type: 'Array(String)' },
  { name: 'cpu_time', type: 'Float64' },
  { name: 'memory_usage', type: 'UInt64' },
];

export const isServiceDatasource = (name: string): boolean => name.startsWith('tinybird.');

/** Whether a row of tinybird.pipe_stats_rt made at `rowMs` is still kept at `nowMs`: "This Data Source has a TTL of 3
 *  months", a row three calendar months old gone. */
export function pipeStatsKept(rowMs: number, nowMs: number): boolean {
  const now = new Date(nowMs);
  return rowMs >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds());
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID ("Format is ULID string"): 48 bits of the instant in ms, then 80 bits here derived from `seed`. */
export function ulidOf(ms: number, seed: string): string {
  let time = '';
  let t = ms;
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32]! + time; t = Math.floor(t / 32); }
  const h = digestBytes('sha256', seed);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[h[i]! % 32];
  return time + rand;
}

/** A token's identifier: a UUID derived from its Workspace and name. */
export function tokenIdOf(ws: string, name: string): string {
  return uuidFrom(`tinybird-twin:token-id:${ws}:${name}`);
}

/** The request's URL as the row keeps it: its path and query, with the `token` parameter removed. */
export function loggedUrl(path: string): string {
  const [p, q] = path.split('?');
  if (q === undefined) return p!;
  const kept = q.split('&').filter((pair) => pair !== '' && pair.split('=')[0] !== 'token');
  return kept.length ? `${p}?${kept.join('&')}` : p!;
}
