import type { HandlerContext } from '@volter/world-core';
import { isReadOnlyRequest, privateTransportKey } from '@volter/world-core';
import { clickhouse } from '@volter/world-core';
const { ClickHouseError, parseSql, stringifyJson, toOutput } = clickhouse;
import { SqlError } from '../engine/ddl.ts';
import { execute } from './shared.ts';
import { formatResult } from '../engine/format.ts';
import { WIRE_HEADER } from './shared.ts';
import { effectiveReadonly } from '../engine/user-policy.ts';
import type { ClientSetting } from '../engine/user-policy.ts';
import type { UserPolicy } from '../engine/configuration.ts';

// source: https://raw.githubusercontent.com/ClickHouse/ClickHouse/834cccbc6e8c7f0db21ec500394c3a567b83482f/src/Server/HTTPHandler.cpp "reserved_param_names"
const reservedParameters = new Set(['query', 'compress', 'decompress', 'user', 'password', 'quota_key', 'query_id', 'stacktrace', 'role',
  'buffer_size', 'wait_end_of_query', 'session_id', 'session_timeout', 'session_check', 'client_protocol_version', 'close_session', 'database', 'default_format']);
function httpSettings(request: Request, url: URL): ClientSetting[] {
  const external = (request.headers.get('content-type') ?? '').startsWith('multipart/form-data');
  return [...url.searchParams].filter(([name]) => name && !reservedParameters.has(name) && !name.startsWith('param_')
    && !(external && ['_format', '_types', '_structure'].some(suffix => name.endsWith(suffix))))
    .map(([name, value]) => ({ name, value }));
}

// source: https://clickhouse.com/docs/interfaces/http "for queries that modify data, you can only use the POST method"
async function run(ctx: HandlerContext, readonly: boolean): Promise<Response> {
  const request = ctx.call.request, url = new URL(request.url);
  const internal = request.headers.get(WIRE_HEADER) === privateTransportKey('clickhouse-native');
  try {
    let body = ctx.text;
    let user = url.searchParams.get('user') ?? request.headers.get('X-ClickHouse-User') ?? 'default';
    let password = url.searchParams.get('password') ?? request.headers.get('X-ClickHouse-Key') ?? '';
    const authorization = request.headers.get('authorization');
    if (authorization) {
      if (!authorization.startsWith('Basic ')) throw new SqlError(516, 'Authentication failed');
      let value: string; try { value = atob(authorization.slice(6)); } catch { throw new SqlError(516, 'Authentication failed'); }
      const at = value.indexOf(':'); if (at < 0) throw new SqlError(516, 'Authentication failed');
      user = value.slice(0, at); password = value.slice(at + 1);
    }
    const configuration = ctx.rows('_configuration').at(-1);
    const configured = configuration ? ctx.own(configuration).users as Record<string, string> | undefined : undefined;
    const expected = configured ? (Object.hasOwn(configured, user) ? configured[user] : undefined) : user === 'default' ? '' : undefined;
    if (expected === undefined || expected !== password) throw new SqlError(516, `${user}: Authentication failed`);
    const native = internal ? JSON.parse(body) as { query: string; data?: unknown[][]; describeInsert?: boolean; readonly?: boolean; readonlySetting?: unknown; settings?: ClientSetting[] } : undefined;
    const policies = configuration ? ctx.own(configuration).userPolicies as Record<string, UserPolicy> | undefined : undefined;
    const policy = policies && Object.hasOwn(policies, user) ? policies[user] : undefined;
    const settings = internal ? native?.settings ?? [] : httpSettings(request, url);
    const mode = effectiveReadonly(policy?.readonly ?? 0, internal ? native?.readonlySetting : undefined, readonly, settings);
    // The native important flag does not make a known setting unknown. The
    // common policy gate has already refused every unapplied change or
    // comparison gap, regardless of that flag, before any query write.
    let query = native?.query ?? [url.searchParams.get('query'), body].filter(value => value != null && value !== '').join('\n');
    if (!query.trim()) return new Response('Ok.\n');
    let format = request.headers.get('X-ClickHouse-Format') ?? url.searchParams.get('default_format') ?? 'TabSeparated';
    if (/^\s*(SELECT|WITH)\b/i.test(query)) format = parseSql(query).format ?? format;
    if (request.headers.get('X-ClickHouse-Format')) format = request.headers.get('X-ClickHouse-Format')!;
    // Validate the selected output before a mutating query makes its first write.
    if (!internal) formatResult({ meta: [], data: [], rows: 0, rowsRead: 0, bytesRead: 0 }, format);
    const result = await execute(ctx, { query, user, database: url.searchParams.get('database') ?? 'default', readonly: mode !== 0 || isReadOnlyRequest(request) || native?.readonly === true, ...(native?.data ? { data: native.data } : {}), ...(native?.describeInsert ? { describeInsert: true } : {}) });
    const headers: Record<string, string> = { 'X-ClickHouse-Format': format, 'X-ClickHouse-Timezone': 'UTC' };
    if (internal) return new Response(stringifyJson({ ...result, data: result.data.map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => [name, typeof value === 'number' && !Number.isFinite(value) ? String(value) : toOutput(value)]))) }), { headers: { 'content-type': 'application/json' } });
    const output = formatResult(result, format); headers['content-type'] = output.type;
    return new Response(output.body, { headers });
  } catch (error) {
    const code = request.signal.aborted ? 394 : error instanceof SqlError ? error.code : error instanceof ClickHouseError ? (/Unknown.*function/i.test(error.message) ? 46 : /Unknown.*(table|identifier|column)/i.test(error.message) ? 47 : 62) : 53;
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Code: ${code}. DB::Exception: ${message}.\n`, { status: code === 36 ? 400 : 500, headers: { 'content-type': 'text/plain; charset=utf-8', 'X-ClickHouse-Exception-Code': String(code) } });
  }
}
export async function query_get(ctx: HandlerContext): Promise<Response> { return run(ctx, true); }
export async function query_post(ctx: HandlerContext): Promise<Response> { return run(ctx, false); }
// source: https://clickhouse.com/docs/interfaces/http "This handler always returns"
export async function ping(_ctx: HandlerContext): Promise<Response> { return new Response('Ok.\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
