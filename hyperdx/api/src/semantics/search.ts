// HyperDX's search (spec tag Search): raw log and trace rows of one of the team's sources, filtered by a time window and
// a Lucene where clause, newest first, each row the columns asked for (the source's default select when none is).
import type { HandlerContext } from '@volter/world-core';
import { logRow, nanosOf, traceRow } from '../engine/columns.ts';
import { matches, orderBy, parseWhere, QueryError, resolveField, selector, splitList, type Node, type Table } from '../engine/search.ts';
import { isObjectId, LOG_RECORD, message, sourcesOf, SPAN, tableOf, teamOf } from './shared.ts';

type Row = Record<string, unknown>;

// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/config.ts "export const EXTERNAL_API_SEARCH_DEFAULT_MAX_RESULTS = 100;"
// source: spec:/components/schemas/SearchRequest/properties/maxResults "Maximum number of rows to return. Default is 100, max is 2000."
const DEFAULT_MAX = 100;
const MAX = 2000;
// source: spec:/components/schemas/SearchRequest/properties/startTime "Defaults to 15 minutes before endTime. Must be before endTime."
const LOOKBACK_MS = 15 * 60 * 1000;
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/search.ts "const DISALLOWED_COLUMNS_PATTERN = /;|(?<!\w)SELECT\s/i;"
const DISALLOWED_COLUMNS = /;|(?<!\w)SELECT\s/i;
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/search.ts "CH error types caused by user-supplied query content"
const USER_INPUT_ERRORS = new Set(['SYNTAX_ERROR', 'UNKNOWN_IDENTIFIER', 'UNKNOWN_TABLE', 'UNKNOWN_FUNCTION', 'UNKNOWN_AGGREGATE_FUNCTION', 'UNKNOWN_TYPE', 'BAD_ARGUMENTS', 'CANNOT_CONVERT_TYPE', 'THERE_IS_NO_COLUMN', 'NO_COMMON_TYPE', 'ILLEGAL_TYPE_OF_ARGUMENT']);

const kindOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isNaN(v) ? 'nan' : typeof v);

/** The body as HyperDX's request schema checks it (zod's own messages, each `path: message`, joined by `; `). */
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/utils/enhancedErrors.ts "errors.push(`Body validation failed: ${formatZodError(result.error)}`);"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/search.ts "message: 'sourceId must be a valid ObjectId',"
function validate(body: unknown): string[] {
  if (kindOf(body) !== 'object') return [`Expected object, received ${kindOf(body)}`];
  const b = body as Row;
  const issues: string[] = [];
  const str = (key: string, required: boolean): boolean => {
    if (b[key] === undefined) { if (required) issues.push(`${key}: Required`); return false; }
    if (typeof b[key] !== 'string') { issues.push(`${key}: Expected string, received ${kindOf(b[key])}`); return false; }
    return true;
  };
  const int = (key: string, min: number, max: number): void => {
    if (b[key] === undefined) return;
    if (typeof b[key] !== 'number' || Number.isNaN(b[key])) { issues.push(`${key}: Expected number, received ${kindOf(b[key])}`); return; }
    const n = b[key] as number;
    if (!Number.isInteger(n)) issues.push(`${key}: Expected integer, received float`);
    if (n < min) issues.push(`${key}: Number must be greater than or equal to ${min}`);
    if (n > max) issues.push(`${key}: Number must be less than or equal to ${max}`);
  };
  if (str('sourceId', true)) {
    if ((b.sourceId as string).length < 1) issues.push('sourceId: sourceId is required');
    if (!isObjectId(b.sourceId)) issues.push('sourceId: sourceId must be a valid ObjectId');
  }
  str('startTime', false);
  str('endTime', false);
  if (str('where', false) && (b.where as string).length > 8192) issues.push('where: String must contain at most 8192 character(s)');
  if (b.whereLanguage !== undefined && b.whereLanguage !== 'lucene' && b.whereLanguage !== 'sql') {
    issues.push(typeof b.whereLanguage === 'string' ? `whereLanguage: Invalid enum value. Expected 'lucene' | 'sql', received '${b.whereLanguage}'` : `whereLanguage: Expected 'lucene' | 'sql', received ${kindOf(b.whereLanguage)}`);
  }
  if (str('select', false)) {
    if ((b.select as string).length > 4096) issues.push('select: String must contain at most 4096 character(s)');
    if (DISALLOWED_COLUMNS.test(b.select as string)) issues.push('select: select must not contain semicolons or SELECT subqueries; use column references, map lookups, or scalar functions only');
  }
  if (str('orderBy', false) && (b.orderBy as string).length > 1024) issues.push('orderBy: String must contain at most 1024 character(s)');
  int('maxResults', 1, MAX);
  int('offset', 0, 10_000);
  return issues;
}

/** Every field a where clause names, resolved once, so a name no column has is refused before any row is read. */
function fieldsOf(node: Node): string[] {
  switch (node.kind) {
    case 'and': case 'or': return [...fieldsOf(node.left), ...fieldsOf(node.right)];
    case 'not': return fieldsOf(node.node);
    case 'term': return node.field === undefined ? [] : [node.field];
    case 'range': return [node.field];
    default: return [];
  }
}

// source: spec:searchEvents "Search Raw Logs and Traces"
// source: spec:searchEvents "Rows are ordered by timestamp descending (most recent first)."
export async function searchEvents(ctx: HandlerContext): Promise<Response> {
  // the body as Express's JSON parser read it (./around.ts has refused one that does not parse); another type is no body
  const typed = (ctx.call.request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase() === 'application/json';
  const body: unknown = typed && ctx.text.trim() !== '' ? JSON.parse(ctx.text) : {};
  const issues = validate(body);
  if (issues.length) return message(400, `Body validation failed: ${issues.join('; ')}`);
  const b = body as Row;

  // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/mcp/tools/query/helpers.ts "error: 'Invalid startTime or endTime: must be valid ISO 8601 strings',"
  // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/mcp/tools/query/helpers.ts "return { error: 'endTime must be greater than startTime' };"
  const end = b.endTime !== undefined ? Date.parse(String(b.endTime)) : Date.parse(ctx.occurredAt);
  const start = b.startTime !== undefined ? Date.parse(String(b.startTime)) : end - LOOKBACK_MS;
  if (Number.isNaN(end) || Number.isNaN(start)) return message(400, 'Invalid startTime or endTime: must be valid ISO 8601 strings');
  if (start >= end) return message(400, 'endTime must be greater than startTime');

  const team = teamOf(ctx);
  // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/utils/search.ts "message: `Source not found: ${config.sourceId}`,"
  const source = team ? sourcesOf(ctx, team).find((s) => s.id === b.sourceId) : undefined;
  if (!source) return message(404, `Source not found: ${String(b.sourceId)}`);
  const table: Table = tableOf(source);

  try {
    const where = parseWhere(typeof b.where === 'string' ? b.where : '');
    for (const f of fieldsOf(where)) resolveField(table, f);
    // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/common-utils/src/core/searchChartConfig.ts "source's `defaultTableSelectExpression` (for Log / Trace sources), falling"
    const columns = splitList(typeof b.select === 'string' && b.select.trim() ? b.select : String(source.defaultTableSelectExpression)).map((e) => selector(table, e));
    // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/utils/search.ts ": `${orderByParts[0]} DESC`;"
    const order = orderBy(table, typeof b.orderBy === 'string' && b.orderBy.trim() ? b.orderBy.trim() : `${String(source.timestampValueExpression)} DESC`);
    // the window holds both its ends
    // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/common-utils/src/core/renderChartConfig.ts "dateRangeEndInclusive: chartConfig.dateRangeEndInclusive ?? true,"
    const from = BigInt(start) * 1_000_000n;
    const to = BigInt(end) * 1_000_000n;
    const project = source.kind === 'trace' ? traceRow : logRow;
    const rows = ctx.rowsRaw(source.kind === 'trace' ? SPAN : LOG_RECORD).filter((r) => r.deleted !== true).map(project)
      .filter((row) => { const t = nanosOf(String(row.Timestamp)); return t >= from && t <= to; })
      .filter((row) => matches(table, where, row))
      .sort(order);
    const offset = typeof b.offset === 'number' ? b.offset : 0;
    const limit = typeof b.maxResults === 'number' ? b.maxResults : DEFAULT_MAX;
    const data = rows.slice(offset, offset + limit).map((row) => Object.fromEntries(columns.map((c) => [c.name, c.read(row)])));
    // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/search.ts "return res.json({ data: result.data, rows: result.data.length });"
    return Response.json({ data, rows: data.length });
  } catch (e) {
    if (!(e instanceof QueryError)) throw e;
    // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/search.ts "return res.status(400).json({ message: `${chType}: ${safeMsg}` });"
    if (USER_INPUT_ERRORS.has(e.type)) return message(400, `${e.type}: ${e.message.split('\n')[0]!.slice(0, 300)}`);
    // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/search.ts "return res.status(500).json({ message: 'Query execution failed' });"
    return message(500, 'Query execution failed');
  }
}
