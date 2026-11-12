// What every family of HyperDX's External API shares: the team the request's personal API key belongs to, the team's
// sources (the Logs and Traces sources HyperDX sets a team up with), and the API's answers (`{ message }`). The
// vendor's shared records (../../../src/semantics/shared.ts) are re-exported, as every lane's are.
import type { HandlerContext } from '@volter/world-core';
import { LOG_COLUMNS, TRACE_COLUMNS } from '../engine/columns.ts';
import type { Table } from '../engine/search.ts';

export * from '../../../src/semantics/shared.ts';
type Row = Record<string, unknown>;

/** The World's team (HyperDX's Team): its id, name and the label its keys are drawn from. */
export const TEAM = '_team';
/** A user's personal API key (HyperDX's User.accessKey), held by its SHA-256. */
export const ACCESS_KEY = '_access_key';

/** An answer of the API: its status and `{ message }`. */
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/sources.ts "return res.status(404).json({ message: 'Source not found' });"
export const message = (status: number, text: string): Response => Response.json({ message: text }, { status });

const sha256 = (ctx: Pick<HandlerContext, 'crypto'>, v: string): string => ctx.crypto.digest('sha256', v, 'hex');

/** A UUID v4 drawn from the World's secret for a label: HyperDX makes a user's access key and a team's API key so. */
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/models/user.ts "return uuidv4();"
export async function keyValue(ctx: Pick<HandlerContext, 'secret' | 'crypto'>, label: string): Promise<string> {
  const h = sha256(ctx, await ctx.secret(label));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[parseInt(h[16]!, 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A MongoDB ObjectId (24 hex digits) for a name, the same for the same name. */
export const objectId = (ctx: Pick<HandlerContext, 'crypto'>, name: string): string => sha256(ctx, name).slice(0, 24);

/** Whether a string is an ObjectId as HyperDX's validation reads one (24 hex digits). */
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/utils/zod.ts "}, 'Invalid ObjectId');"
export const isObjectId = (s: unknown): boolean => typeof s === 'string' && /^[0-9a-fA-F]{24}$/.test(s);

/** The team the request's personal API key belongs to (the manifest's auth gate has checked the key is held). */
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/middleware/auth.ts "return req.headers.authorization?.split('Bearer ')[1];"
export function teamOf(ctx: HandlerContext): Row | undefined {
  const value = (ctx.call.request.headers.get('authorization') ?? '').split('Bearer ')[1];
  if (!value) return undefined;
  const hash = sha256(ctx, value);
  const key = ctx.rowsRaw(ACCESS_KEY).find((k) => k.deleted !== true && k.sha256 === hash);
  return key ? ctx.rowsRaw(TEAM).find((t) => t.deleted !== true && t.id === key.team) : undefined;
}

// ── the team's sources ───────────────────────────────────────────────────────────────────────

/** The Logs and Traces sources HyperDX sets a new team up with (its DEFAULT_SOURCES, which the HyperDX image sets), on
 *  the team's ClickHouse connection, each pointing at the other; in the external form the sources API answers
 *  (toExternalSource: the source's fields, its id, granularities short). */
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/setupDefaults.ts "Sets up default connections and sources for a team"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/docker/hyperdx/entry.local.base.sh "Timestamp,ServiceName,SeverityText,Body"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/docker/hyperdx/entry.local.base.sh "Timestamp,ServiceName,StatusCode,round(Duration/1e6),SpanName"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/common-utils/src/externalSource.ts "A source in the shape the external API (`/api/v2/sources`) returns: only"
export function sourcesOf(ctx: Pick<HandlerContext, 'crypto'>, team: Row): Row[] {
  const id = (name: string): string => objectId(ctx, `${String(team.id)}:source:${name}`);
  const connection = objectId(ctx, `${String(team.id)}:connection:Local ClickHouse`);
  const base = { disabled: false, connection, querySettings: [] };
  return [
    {
      id: id('Logs'), name: 'Logs', kind: 'log', ...base, from: { databaseName: 'default', tableName: 'otel_logs' },
      timestampValueExpression: 'Timestamp', displayedTimestampValueExpression: 'Timestamp', implicitColumnExpression: 'Body',
      serviceNameExpression: 'ServiceName', bodyExpression: 'Body', eventAttributesExpression: 'LogAttributes',
      resourceAttributesExpression: 'ResourceAttributes', defaultTableSelectExpression: 'Timestamp,ServiceName,SeverityText,Body',
      severityTextExpression: 'SeverityText', severityNumberExpression: 'SeverityNumber', eventNameExpression: 'EventName',
      traceIdExpression: 'TraceId', spanIdExpression: 'SpanId',
      metadataMaterializedViews: { kvRollupTable: 'otel_logs_kv_rollup_15m', granularity: '15m' },
      traceSourceId: id('Traces'),
    },
    {
      id: id('Traces'), name: 'Traces', kind: 'trace', ...base, from: { databaseName: 'default', tableName: 'otel_traces' },
      timestampValueExpression: 'Timestamp', displayedTimestampValueExpression: 'Timestamp', implicitColumnExpression: 'SpanName',
      serviceNameExpression: 'ServiceName', eventAttributesExpression: 'SpanAttributes', resourceAttributesExpression: 'ResourceAttributes',
      defaultTableSelectExpression: 'Timestamp,ServiceName,StatusCode,round(Duration/1e6),SpanName', traceIdExpression: 'TraceId',
      spanIdExpression: 'SpanId', durationExpression: 'Duration', durationPrecision: 9, parentSpanIdExpression: 'ParentSpanId',
      spanNameExpression: 'SpanName', spanKindExpression: 'SpanKind', statusCodeExpression: 'StatusCode',
      statusMessageExpression: 'StatusMessage', spanEventsValueExpression: 'Events', spanLinksValueExpression: 'Links',
      metadataMaterializedViews: { kvRollupTable: 'otel_traces_kv_rollup_15m', granularity: '15m' },
      logSourceId: id('Logs'),
    },
  ];
}

/** The table a source reads: its columns and the column a bare term searches. */
export const tableOf = (source: Row): Table =>
  source.kind === 'trace' ? { columns: TRACE_COLUMNS, implicit: String(source.implicitColumnExpression) } : { columns: LOG_COLUMNS, implicit: String(source.implicitColumnExpression) };
