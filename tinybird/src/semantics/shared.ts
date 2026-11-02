// What Tinybird's operations share (docs/contributing/architecture.md, "Pack layout"): the ingestion →
// queryable-Data-Source → published-Endpoint loop that is Tinybird, over the pack's state as the handler's context
// reaches it (`Store`), and the frame every handler answers through (`answer`: the caller its token names, by the
// operation's rule, and Tinybird's answer as a Response). The query language is the kernel's ClickHouse engine, under
// Tinybird's templates and Data Source rules (../engine/).
//
// THE STATE. Each subject is stored as the API answers it, so a refresh's observations (manifest.ts, `refresh`) are read
// as the twin's own writes are:
// - a Workspace under its id (the uuid GET /v0/workspace answers), the console's facts of it private (`_owner`,
//   `_organizationId`, `_createdAt`);
// - a Data Source, Pipe, token, tag or job under `<workspace id>/<kind>:<name or id>`, with the Workspace's id in `ws`
//   (the manifest's `parent` and `key`): the fields its list answers (a Data Source's `columns`, `engine`, `type`; a
//   Pipe's `nodes` and `endpoint`; a token's `scopes` as `{type, resource}`), the vendor's `id` and `type` read through
//   ctx.own, and what the vendor computes on each read (a Data Source's statistics, a Pipe's params) left to the answer;
// - each row of a Data Source an `event` subject (`<workspace id>/event:<data source>:<hash>`), its columns nested under
//   one `row` field so a column named `id` or `type` is the row's, never the kernel's; a row of tinybird.pipe_stats_rt,
//   which Tinybird writes as it answers an Endpoint or the Query API and no caller writes, is the World's `_event`.
import { digest, VendorUnreachableError, type HandlerContext } from '@volter/world-core';
import { TemplateError } from '../engine/template.ts';
import { isServiceDatasource, loggedUrl, PIPE_STATS_RT, PIPE_STATS_RT_COLUMNS, pipeStatsKept, tokenIdOf, ulidOf } from '../engine/service.ts';
import {
  checkRow,
  inferSchema,
  isQuarantineName,
  parseSchemaParam,
  quarantineName,
  quarantineSchema,
  quarantineValue,
  parseJsonLossless,
  type TinybirdColumn,
} from '../engine/schema.ts';
import {
  executeSql,
  parseQuery,
  parseSql,
  queryStatistics,
  renderFormat,
  renderTemplate,
  runSql,
  templateParams,
  TinybirdQueryError,
  usedTables,
  type Query,
  type QueryResult,
} from '../engine/sql.ts';
import {
  blockRelation,
  endpointNodeOf,
  materializedSource,
  materializedViews,
  nodeSchema,
  pipeCatalog,
  runMaterializedView,
  runNode,
 
  validatePipe,
  type EngineSpec,
  type PipeModel,
  type PipeNodeModel,
  type Workspace,
} from '../engine/pipes.ts';
import { fromStored, isWideIntegerType, stringifyJson, toStored, valueKey } from '../engine/values.ts';

// what the operations' handlers read of the engine
export { endpointNodeOf, fromStored, isQuarantineName, materializedViews, parseSchemaParam, parseSql, renderTemplate, runSql, usedTables };

/** The table engines a Data Source is made with here: the ones whose rows the kernel's ClickHouse engine reads as
 *  ClickHouse does (any other is a variant no demand or life step asks for: the gap). */
export const MODELED_ENGINES = new Set(['mergetree', 'replacingmergetree', 'aggregatingmergetree', 'summingmergetree', 'null']);

/** The page the error body's `documentation` names (the manifest's error envelope). */
export const TINYBIRD_DOCS_URL = 'https://www.tinybird.co/docs/api-reference';

/** The vendor's default region host, used only when a caller supplies no host of its own. */
export const TINYBIRD_DEFAULT_HOST = 'api.tinybird.co';

/** The origin this request arrived on, as an absolute URL base for self-referential fields. */
export function originOf(req: TinybirdRequest): string {
  const raw = (req.host ?? '').trim();
  if (!raw) return `https://${TINYBIRD_DEFAULT_HOST}`;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, '');
  // A local twin is plain HTTP; the vendor's own hosts are HTTPS.
  const scheme = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(raw) ? 'http' : 'https';
  return `${scheme}://${raw}`;
}

/** The regions a Workspace may live in, as the API reference's table lists them, each at the console path the Classic
 *  CLI maps its API host to (tinybird-cli's config.py). */
// source: https://www.tinybird.co/docs/api-reference "A workspace belongs to a region. The API for each region has a specific API base URL that you use to make API requests."
export const TINYBIRD_REGIONS: Array<{ path: string; label: string; api: string }> = [
  { path: 'gcp/europe-west3', label: 'Europe (Frankfurt) · GCP', api: 'https://api.tinybird.co' },
  { path: 'gcp/europe-west2', label: 'Europe (London) · GCP', api: 'https://api.europe-west2.gcp.tinybird.co' },
  { path: 'gcp/us-east4', label: 'US East (Virginia) · GCP', api: 'https://api.us-east.tinybird.co' },
  { path: 'gcp/northamerica-northeast2', label: 'North America (Toronto) · GCP', api: 'https://api.northamerica-northeast2.gcp.tinybird.co' },
  { path: 'aws/eu-central-1', label: 'Europe (Frankfurt) · AWS', api: 'https://api.eu-central-1.aws.tinybird.co' },
  { path: 'aws/eu-west-1', label: 'Europe (Ireland) · AWS', api: 'https://api.eu-west-1.aws.tinybird.co' },
  { path: 'aws/us-east-1', label: 'US East (Virginia) · AWS', api: 'https://api.us-east.aws.tinybird.co' },
  { path: 'aws/us-west-2', label: 'US West (Oregon) · AWS', api: 'https://api.us-west-2.aws.tinybird.co' },
  { path: 'aws/ap-east-1', label: 'Asia Pacific (Hong Kong) · AWS', api: 'https://api.ap-east-1.aws.tinybird.co' },
  { path: 'aws/ap-southeast-2', label: 'Asia Pacific (Sydney, Australia) · AWS', api: 'https://api.ap-southeast-2.aws.tinybird.co' },
];

/** The Events API's request size limit, the Free plan's 10 MB (semantics/events.ts cites it). */
export const TINYBIRD_MAX_EVENTS_BYTES = 10 * 1024 * 1024;

export const TINYBIRD_RESOURCE_TYPES = ['workspace', 'datasource', 'pipe', 'event', '_event', 'token', 'job', 'tag'] as const;
export type TinybirdResourceType = typeof TINYBIRD_RESOURCE_TYPES[number];

export type TinybirdRequest = {
  method: string;
  path: string;
  body?: string;
  headers?: Record<string, string>;
  /** The host the request was sent to (the region's API host): every URL an answer carries (`job_url`, a Pipe's
   *  `url`) is on it, so a caller following one stays in the region it called. */
  host?: string;
  occurredAt: string;
  /** the pack's state, as the handler's context reads and writes it */
  store: Store;
  vendorFetch?: HandlerContext['vendorFetch'];
  token?: Token;
  /** A secret the World holds (ctx.secret), mixed into every token value minted for the request, so none is computed
   *  from its Workspace and name. */
  salt?: string;
  readOnly?: boolean;
  /** The Workspace the request's token belongs to, set by the router once the token is resolved: every Data Source,
   *  Pipe, token, tag, job and row is one Workspace's. */
  ws?: string;
};
export type TinybirdResponse = { status: number; body: unknown; headers?: Record<string, string> };

// ── error envelope ──────────────────────────────────────────────────────────────────────────
export function tbError(status: number, error: string): TinybirdResponse {
  return { status, body: { error, documentation: TINYBIRD_DOCS_URL } };
}
/** The answer to what the twin does not serve: the manifest's `gap`, as the dispatch answers an operation no handler
 *  serves. A documented variant of a served operation that no demand or life step asks for (another grant, another
 *  flow, another format) answers it too (architecture, "Creating a pack", step 7). */
export function readOnlyRejection(): TinybirdResponse {
  return tbError(405, 'twin is read-only; omit readOnly to accept writes');
}

// ── kernel plumbing ─────────────────────────────────────────────────────────────────────────
/** A stored subject as the pack reads it: the kernel's `type` and `id`, its fields, and the vendor's own `id` and `type`
 *  (`vendorId`, `vendorType`: a Data Source's `t_…` id and its `type`), which the kernel keeps apart from its own. */
export type Row = Record<string, unknown> & { type: string; id: string; vendorId?: unknown; vendorType?: unknown };

/** Where a read or a write lands: the kernel root, and the Workspace. A Workspace's subjects are stored as
 *  `<workspace id>/<local id>` with a `ws` field, and read back under their local id (`datasource:<name>`), so two
 *  Workspaces may each have a Data Source of one name. */
export type Scope = { store: Store; ws?: string; occurredAt?: string };

/** The pack's state as a handler reaches it: every subject of every type it keeps (the deleted included), one subject
 *  written, and an id minted for a resource (the manifest's `ids`). */
export type Store = {
  rows(): Row[];
  write(type: string, id: string, fields: Record<string, unknown>, operation: string): Promise<Row>;
  mint(resource: string): string;
};

/** Every subject type the pack keeps. */
export const STORED_TYPES = ['workspace', 'datasource', 'pipe', 'event', '_event', 'token', 'job', 'tag', '_user_token', '_login_code', '_web_session'] as const;

/** The store of a handler's context: its reads (`rowsRaw`, every type, the deleted included, with the vendor's own `id`
 *  and `type` from ctx.own) and its writes (a bookkeeping `_` subject recorded, which journals no request). */
export function storeOf(ctx: HandlerContext): Store {
  const asRow = (type: string, r: Record<string, unknown>): Row => {
    const own = ctx.own(r);
    return { ...r, type, id: String(r.id), vendorId: own.id, vendorType: own.type };
  };
  return {
    rows: () => STORED_TYPES.flatMap((type) => ctx.rowsRaw(type, { withDeleted: true }).map((r) => asRow(type, r))),
    write: async (type, id, fields, operation) => {
      if (type.startsWith('_')) await ctx.record(type, fields, id);
      else await ctx.write(type, id, fields, operation);
      const stored = ctx.row(type, id, { withDeleted: true });
      return stored ? asRow(type, stored) : { type, id };
    },
    mint: (resource) => String(ctx.mint(resource)),
  };
}

export function wsOf(s: Scope): string {
  if (!s.ws) throw new Error('tinybird-twin: a Workspace read or write with no Workspace in scope');
  return s.ws;
}

export const dsKey = (name: string) => `datasource:${name}`;
export const pipeKey = (name: string) => `pipe:${name}`;
export const tokenKey = (name: string) => `token:${name}`;
export const jobKey = (id: string) => `job:${id}`;
export const tagKey = (name: string) => `tag:${name}`;

export function allRows(root: Scope): Row[] {
  const ws = wsOf(root);
  const pre = `${ws}/`;
  return root.store.rows()
    .filter((r) => r.ws === ws && r.id.startsWith(pre))
    .map((r) => ({ ...r, id: r.id.slice(pre.length) }));
}
export function rowsOfType(type: TinybirdResourceType, root: Scope): Row[] {
  return allRows(root).filter((r) => r.type === type && r.deleted !== true);
}
export function getRow(type: TinybirdResourceType, id: string, root: Scope): Row | undefined {
  return allRows(root).find((r) => r.type === type && r.id === id && r.deleted !== true);
}
export async function write(subjectType: TinybirdResourceType, subjectId: string, fields: Record<string, unknown>, operation: string, req: TinybirdRequest): Promise<Row> {
  const ws = wsOf(req);
  const row = await req.store.write(subjectType, `${ws}/${subjectId}`, { ...fields, ws }, operation);
  return { ...row, id: subjectId };
}

export function nowIso(req: TinybirdRequest): string {
  return req.occurredAt;
}
/** ClickHouse-style naive datetime (`YYYY-MM-DD HH:MM:SS.mmm`) — the format every Tinybird
 *  `created_at`/`updated_at`/`insertion_date` field uses (no `T`, no `Z`). */
export function chDateTime(iso: string): string {
  return iso.replace('T', ' ').replace(/Z$/, '').replace(/(\.\d{3})\d*$/, '$1');
}

/** A Tinybird resource id (`t_` and 32 hex), derived from its Workspace and name, and from the id the name last
 *  carried when it is made again after a delete, so a retired id is never issued again. */
// source: https://www.tinybird.co/docs/api-reference/pipe-api "so you can always refer to them in your 3rd party applications"
export function resourceId(kind: string, name: string, previous?: string): string {
  const seed = previous ? `tinybird-twin:${kind}:${name}:after:${previous}` : `tinybird-twin:${kind}:${name}`;
  return `t_${digest('sha256', seed).slice(0, 32)}`;
}

/** A subject as it was last stored, tombstoned or not. */
export function retired(s: Scope, subjectId: string): Row | undefined {
  return allRows(s).find((r) => r.id === subjectId);
}

/** The vendor id a (possibly tombstoned) subject last carried, so `resourceId` can ratchet past it. */
export function retiredId(type: TinybirdResourceType, subjectId: string, root: Scope): string | undefined {
  const raw = allRows(root).find((r) => r.type === type && r.id === subjectId);
  return typeof raw?.vendorId === 'string' ? raw.vendorId : undefined;
}

/**
 * Mint an EVENT subject id. Tinybird's Events API is explicitly NOT idempotent ("Sending the same
 * data more than once inserts it multiple times"), so two identical rows must become two rows —
 * which means the id cannot be a pure hash of the content. It is derived from the content AND
 * PROBED against the id-set already in state until it is free: never a module-level counter and
 * never a row count (either of which collides the moment a pulled vendor row occupies a gap above
 * the local count — the failure mode ADDING_A_TWIN.md §5 calls out by name).
 */
export function mintEventId(datasource: string, occurredAt: string, row: Record<string, unknown>, taken: Set<string>): string {
  const base = `tinybird-twin:event:${datasource}:${occurredAt}:${JSON.stringify(row)}`;
  const candidate = (salt: number): string => `event:${datasource}:${digest('sha256', `${base}:${salt}`).slice(0, 24)}`;
  let salt = 0;
  while (taken.has(candidate(salt))) salt++;
  taken.add(candidate(salt));
  return candidate(salt);
}

// ── tinybird.pipe_stats_rt: a row per Endpoint and Query API request (../engine/service.ts) ────────

export type LoggedRequest = {
  pipeId: string; pipeName: string; method: string; params: Record<string, string>; token: Token;
  response: TinybirdResponse; result?: QueryResult; tags?: string[];
};

/** Append the request's row to `tinybird.pipe_stats_rt`. A read-only World records nothing. */
export async function logPipeRequest(req: TinybirdRequest, r: LoggedRequest): Promise<void> {
  if (req.readOnly) return;
  const at = nowIso(req);
  const stats = r.result ? queryStatistics(r.result) : { elapsed: 0, rows_read: 0, bytes_read: 0 };
  const error = r.response.status >= 400;
  const errorMessage = error ? String((r.response.body as { error?: unknown } | null)?.error ?? '') : null;
  const url = loggedUrl(req.path);
  const row: Record<string, unknown> = {
    start_datetime: chDateTime(at).slice(0, 19),
    pipe_id: r.pipeId,
    pipe_name: r.pipeName,
    duration: stats.elapsed,
    read_bytes: stats.bytes_read,
    read_rows: stats.rows_read,
    result_rows: r.result?.rows ?? 0,
    url,
    error: error ? 1 : 0,
    error_message: errorMessage,
    request_id: ulidOf(Date.parse(at), `${wsOf(req)}:${r.method}:${url}:${at}`),
    token: tokenIdOf(wsOf(req), r.token.name),
    token_name: r.token.name,
    status_code: r.response.status,
    method: r.method,
    parameters: r.params,
    release: '',
    user_agent: req.headers?.['user-agent'] ?? null,
    resource_tags: r.tags ?? [],
    cpu_time: stats.elapsed,
    memory_usage: stats.bytes_read,
  };
  const snap = snapshot(req);
  const id = mintEventId(PIPE_STATS_RT, at, row, snap.eventIds);
  await write('_event', id, { ds: PIPE_STATS_RT, row, at: chDateTime(at), seq: snap.nextSeq }, 'event.pipe_stats', req);
}

/** A request's parameters as the row keeps them: its query, less `token`. */
export function requestParameters(query: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of query) if (k !== 'token') out[k] = v;
  return out;
}

// ── Data Sources ────────────────────────────────────────────────────────────────────────────

/** A Data Source as the handlers read it, from the fields its list answers (`datasourceFromRow`). */
export type Datasource = {
  name: string; dsId: string; columns: TinybirdColumn[]; createdAt: string; changedAt: string; sourceType: string;
  engine: EngineSpec; description: string;
};

/** The default engine a Data Source created without ENGINE options gets. */
export const DEFAULT_ENGINE: EngineSpec = { engine: 'MergeTree' };

type Fields = Record<string, unknown>;
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** A column as the Data Sources API lists it: its name, type, default and JSONPath. */
export function columnView(c: TinybirdColumn): Fields {
  return {
    name: c.name,
    type: c.type,
    codec: null,
    default_value: c.defaultExpr ?? null,
    jsonpath: c.jsonpath ?? null,
    nullable: /^(LowCardinality\()?Nullable\(/.test(c.type),
    normalized_name: c.name,
  };
}

/** A listed column read back as the engine's. */
export function columnOf(c: Fields): TinybirdColumn {
  const jsonpath = text(c.jsonpath);
  const defaultExpr = text(c.default_value);
  return { name: String(c.name), type: String(c.type), ...(jsonpath !== undefined ? { jsonpath } : {}), ...(defaultExpr !== undefined ? { defaultExpr } : {}) };
}

/** A listed engine read back as the engine's options (an empty partition key is none). */
export function engineOf(e: unknown): EngineSpec {
  const o = (e && typeof e === 'object' ? e : {}) as Fields;
  const spec: EngineSpec = { engine: text(o.engine) || DEFAULT_ENGINE.engine };
  const put = (k: keyof EngineSpec, v: unknown): void => { if (typeof v === 'string' && v !== '') (spec as Record<string, string>)[k] = v; };
  put('sortingKey', o.engine_sorting_key);
  put('partitionKey', o.engine_partition_key);
  put('ver', o.engine_ver);
  put('isDeleted', o.engine_is_deleted);
  put('ttl', o.engine_ttl);
  put('settings', o.engine_settings);
  return spec;
}

/** A Data Source as it is stored: the fields its list answers that the Data Source itself holds (statistics, used_by
 *  and the quarantine count are the vendor's reading of its rows and Pipes, answered on each read). */
export function storedDatasource(ds: Datasource): Fields {
  return {
    id: ds.dsId, name: ds.name, created_at: ds.createdAt, updated_at: ds.changedAt, type: ds.sourceType,
    engine: engineView(ds.engine), description: ds.description, columns: ds.columns.map(columnView),
  };
}

export function datasourceFromRow(name: string, row: Row): Datasource {
  return {
    name,
    dsId: text(row.vendorId) ?? resourceId('datasource', name),
    columns: Array.isArray(row.columns) ? (row.columns as Fields[]).map(columnOf) : [],
    createdAt: text(row.created_at) ?? '',
    changedAt: text(row.updated_at) ?? '',
    sourceType: text(row.vendorType) ?? 'ndjson',
    engine: engineOf(row.engine),
    description: text(row.description) ?? '',
  };
}
export function readDatasource(name: string, root: Scope): Datasource | undefined {
  const row = getRow('datasource', dsKey(name), root);
  return row ? datasourceFromRow(name, row) : undefined;
}

/**
 * One read of the kernel tree, indexed for a request: Data Sources, their rows in insertion order,
 * and pipes. Every query and materialized view of a request reads through one of these, so a
 * request projects the tree once rather than once per table it touches.
 */
export type Snapshot = Workspace & {
  datasources: Map<string, Datasource>;
  pipes: Map<string, Pipe>;
  eventIds: Set<string>;
  nextSeq: number;
  append(ds: string, id: string, row: Record<string, unknown>): number;
};

export function snapshot(root: Scope): Snapshot {
  const datasources = new Map<string, Datasource>();
  const pipes = new Map<string, Pipe>();
  const byDs = new Map<string, Array<{ seq: number; row: Record<string, unknown> }>>();
  const eventIds = new Set<string>();
  let nextSeq = 0;
  for (const r of allRows(root)) {
    if (r.type === 'event' || r.type === '_event') {
      eventIds.add(r.id);
      const seq = typeof r.seq === 'number' ? r.seq : 0;
      if (seq >= nextSeq) nextSeq = seq + 1;
      if (r.deleted === true) continue;
      const ds = r.ds as string;
      let list = byDs.get(ds);
      if (!list) { list = []; byDs.set(ds, list); }
      list.push({ seq, row: (r.row as Record<string, unknown>) ?? {} });
      continue;
    }
    if (r.deleted === true) continue;
    if (r.type === 'datasource') datasources.set(r.name as string, datasourceFromRow(r.name as string, r));
    else if (r.type === 'pipe') pipes.set(r.name as string, pipeFromRow(r.name as string, r));
  }
  // Insertion order: the minted sequence (stable for rows from before sequences existed).
  for (const list of byDs.values()) list.sort((a, b) => a.seq - b.seq);
  const snap: Snapshot = {
    datasources,
    pipes,
    eventIds,
    nextSeq,
    datasource: (name) => {
      if (name === PIPE_STATS_RT) return { name, columns: PIPE_STATS_RT_COLUMNS, engine: DEFAULT_ENGINE };
      const d = datasources.get(name);
      return d ? { name: d.name, columns: d.columns, engine: d.engine } : undefined;
    },
    rows: (name) => {
      const rows = (byDs.get(name) ?? []).map((e) => e.row);
      if (name !== PIPE_STATS_RT) return rows;
      // source: https://www.tinybird.co/docs/classic/monitoring/service-datasources "This Data Source has a TTL of 3 months."
      const now = Date.parse(root.occurredAt ?? '');
      return rows.filter((r) => pipeStatsKept(Date.parse(`${String(r.start_datetime).replace(' ', 'T')}Z`), now));
    },
    pipe: (name) => pipes.get(name),
    append(ds, id, row) {
      eventIds.add(id);
      let list = byDs.get(ds);
      if (!list) { list = []; byDs.set(ds, list); }
      const seq = snap.nextSeq++;
      list.push({ seq, row });
      return seq;
    },
  };
  return snap;
}

export async function createDatasource(
  name: string, columns: TinybirdColumn[], req: TinybirdRequest,
  opts: { sourceType?: string; engine?: EngineSpec; description?: string } = {},
): Promise<Datasource> {
  const at = chDateTime(nowIso(req));
  const sourceType = opts.sourceType ?? 'ndjson';
  const made = (dsName: string, cols: TinybirdColumn[], engine: EngineSpec, description: string): Fields => ({
    ...storedDatasource({
      name: dsName, dsId: resourceId('datasource', `${wsOf(req)}:${dsName}`, retiredId('datasource', dsKey(dsName), req)),
      columns: cols, createdAt: at, changedAt: at, sourceType, engine, description,
    }),
    deleted: false,
  });
  await write('datasource', dsKey(name), made(name, columns, opts.engine ?? DEFAULT_ENGINE, opts.description ?? ''), 'datasource.create', req);
  // source: https://www.tinybird.co/docs/classic/get-data-in/data-operations/recover-from-quarantine "The quarantine Data Source is named {datasource_name}_quarantine and can be queried using Pipes like a regular Data Source."
  // it is made with the Data Source, so a Pipe reading it can be published before any row is quarantined (where the
  // page stops: it does not say when the quarantine table is made)
  if (!isQuarantineName(name)) {
    const qName = quarantineName(name);
    if (!getRow('datasource', dsKey(qName), req)) {
      await write('datasource', dsKey(qName), made(qName, quarantineSchema(columns), DEFAULT_ENGINE, ''), 'datasource.create_quarantine', req);
    }
  }
  return readDatasource(name, req)!;
}

export function engineView(e: EngineSpec): Record<string, unknown> {
  // the Data Sources API's list answer writes the partition key "" when there is none, and the primary key, which is
  // the sorting key unless a Data Source sets one (https://www.tinybird.co/docs/api-reference/datasource-api)
  return {
    engine: e.engine,
    ...(e.sortingKey !== undefined ? { engine_sorting_key: e.sortingKey, sorting_key: e.sortingKey, engine_primary_key: e.sortingKey } : {}),
    engine_partition_key: e.partitionKey ?? '',
    partition_key: e.partitionKey ?? '',
    ...(e.ver !== undefined ? { engine_ver: e.ver } : {}),
    ...(e.isDeleted !== undefined ? { engine_is_deleted: e.isDeleted } : {}),
    ...(e.ttl !== undefined ? { engine_ttl: e.ttl } : {}),
    ...(e.settings !== undefined ? { engine_settings: e.settings } : {}),
  };
}

/**
 * A Data Source as the Data Sources API answers it: the fields of its list answer ("getting a list of your Data
 * Sources", https://www.tinybird.co/docs/api-reference/datasource-api) and those an import job's `datasource` holds
 * (https://www.tinybird.co/docs/api-reference/jobs-api). Where the pages stop and the twin decides: a Workspace here has
 * one version of each resource (`version` 0, `project` null), shares nothing (`shared_with` []), sets no import headers,
 * runs on its one `default` cluster, and carries no Git commit (`last_commit` with empty fields, as the page's shows).
 */
export function datasourceView(ds: Datasource, root: Scope, snap?: Snapshot): Record<string, unknown> {
  const s = snap ?? snapshot(root);
  const rows = s.rows(ds.name);
  const sortingKey = ds.engine.sortingKey ?? (ds.engine.engine === 'MergeTree' ? ds.columns[0]?.name ?? '' : undefined);
  return {
    id: ds.dsId,
    name: ds.name,
    cluster: 'default',
    tags: {},
    created_at: ds.createdAt,
    updated_at: ds.changedAt,
    replicated: true,
    version: 0,
    project: null,
    headers: {},
    shared_with: [],
    engine: engineView({ ...ds.engine, ...(sortingKey !== undefined ? { sortingKey } : {}) }),
    description: ds.description,
    used_by: usedBy(ds.name, s),
    last_commit: { content_sha: '', status: 'changed', path: '' },
    errors_discarded_at: null,
    type: ds.sourceType,
    columns: ds.columns.map(columnView),
    statistics: { bytes: rows.reduce((n, r) => n + JSON.stringify(r).length, 0), row_count: rows.length },
    new_columns_detected: {},
    quarantine_rows: isQuarantineName(ds.name) ? 0 : s.rows(quarantineName(ds.name)).length,
  };
}

/** The Pipes that read a Data Source, by the tables their nodes' SQL names (`used_by`, Data Sources API). */
export function usedBy(name: string, snap: Snapshot): Array<{ id: string; name: string }> {
  return [...snap.pipes.values()].filter((p) => p.nodes.some((n) => nodeReads(n.sql).includes(name))).map((p) => ({ id: p.pipeId, name: p.name }));
}

/** The tables a node's SQL reads (its template rendered as the analyzer renders it); none where it does not parse. */
export function nodeReads(sql: string): string[] {
  try { return usedTables(parseSql(sql.trim().startsWith('%') ? renderTemplate(sql, {}, { probe: true }) : sql)); } catch { return []; }
}


// ── datafiles ───────────────────────────────────────────────────────────────────────────────
// A Data Source or Pipe written back as the `.datasource` / `.pipe` file that makes it, in the Classic datafile format
// (https://www.tinybird.co/docs/classic/cli/datafiles/datasource-files, …/pipe-files): its DESCRIPTION, the TOKEN lines
// of the tokens granted on it, TAGS, SCHEMA with each column's jsonpath, ENGINE settings; a Pipe's NODEs with their SQL,
// TYPE and DATASOURCE. `tb pull` and `tb push --only-changes` read these.

export const indent = (text: string, pad = '    '): string => text.split('\n').map((l) => (l.trim() ? pad + l : l)).join('\n');

export function tokenLines(req: TinybirdRequest, family: 'DATASOURCES' | 'PIPES', name: string): string[] {
  const grant = family === 'DATASOURCES' ? 'APPEND' : 'READ';
  return listTokens(req)
    .filter((t) => t.scopes.some((sc) => { const p = parseScope(sc); return p.family === family && p.action === grant && p.resource === name; }))
    .map((t) => `TOKEN "${t.name}" ${grant}`);
}

export function tagLine(req: TinybirdRequest, name: string, kind: 'datasource' | 'pipe'): string[] {
  const tags = rowsOfType('tag', req).filter((t) => ((t.resources as TagResource[]) ?? []).some((r) => r.name === name && (r.type === undefined || r.type === kind))).map((t) => String(t.name));
  return tags.length ? [`TAGS "${tags.join(', ')}"`] : [];
}

export function datasourceDatafile(ds: Datasource, req: TinybirdRequest): string {
  const out = [...tokenLines(req, 'DATASOURCES', ds.name)];
  if (ds.description) out.push('', 'DESCRIPTION >', indent(ds.description));
  out.push(...tagLine(req, ds.name, 'datasource'));
  out.push('', 'SCHEMA >', ds.columns.map((c) => `    \`${c.name}\` ${c.type}${c.jsonpath !== undefined ? ` \`json:${c.jsonpath}\`` : ''}${c.defaultExpr !== undefined ? ` DEFAULT ${c.defaultExpr}` : ''}`).join(',\n'));
  const e = ds.engine;
  out.push('', `ENGINE "${e.engine}"`);
  if (e.partitionKey !== undefined) out.push(`ENGINE_PARTITION_KEY "${e.partitionKey}"`);
  if (e.sortingKey !== undefined) out.push(`ENGINE_SORTING_KEY "${e.sortingKey}"`);
  if (e.ver !== undefined) out.push(`ENGINE_VER "${e.ver}"`);
  if (e.isDeleted !== undefined) out.push(`ENGINE_IS_DELETED "${e.isDeleted}"`);
  if (e.ttl !== undefined) out.push(`ENGINE_TTL "${e.ttl}"`);
  return `${out.join('\n').replace(/^\n+/, '')}\n`;
}

export function pipeDatafile(p: Pipe, req: TinybirdRequest): string {
  const out: string[] = [];
  if (p.description) out.push('DESCRIPTION >', indent(p.description), '');
  out.push(...tokenLines(req, 'PIPES', p.name));
  out.push(...tagLine(req, p.name, 'pipe'));
  const endpoint = endpointNodeOf(p);
  for (const n of p.nodes) {
    out.push('', `NODE ${n.name}`);
    if (n.description) out.push('DESCRIPTION >', indent(n.description), '');
    out.push('SQL >', '', indent(n.sql), '');
    if (n.type === 'materialized') out.push('TYPE materialized', `DATASOURCE ${n.datasource ?? ''}`);
    else if (endpoint?.id === n.id) out.push('TYPE endpoint');
  }
  return `${out.join('\n').replace(/^\n+/, '')}\n`;
}

// ── Pipes ───────────────────────────────────────────────────────────────────────────────────

export type Pipe = PipeModel & { pipeId: string; description: string; createdAt: string; changedAt: string };

/** A node as it is stored: the fields of the Pipes API's node that the node itself holds (its dependencies and
 *  parameters are read from its SQL on each answer). */
export function storedNode(n: PipeNodeModel): Fields {
  return {
    id: n.id, name: n.name, sql: n.sql, description: n.description ?? null, node_type: n.type,
    materialized: n.type === 'materialized' ? n.datasource ?? null : false, ...(n.datasource ? { datasource: n.datasource } : {}),
  };
}

/** A listed node read back as the engine's: the vendor's `default` node is a standard one. */
export function nodeOf(o: Fields): PipeNodeModel {
  const kind = text(o.node_type) ?? 'standard';
  const type = (['endpoint', 'materialized', 'copy'].includes(kind) ? kind : 'standard') as PipeNodeModel['type'];
  const description = text(o.description);
  const datasource = text(o.datasource) ?? text(o.materialized);
  return { id: String(o.id), name: String(o.name), sql: text(o.sql) ?? '', type, ...(description ? { description } : {}), ...(datasource ? { datasource } : {}) };
}

/** A Pipe as it is stored: the Pipes API's fields of it, its published node as `endpoint`. */
export function storedPipe(p: Pipe): Fields {
  return {
    id: p.pipeId, name: p.name, description: p.description, endpoint: endpointNodeOf(p)?.id ?? null,
    created_at: p.createdAt, updated_at: p.changedAt, type: pipeType(p), nodes: p.nodes.map(storedNode),
  };
}

export function pipeFromRow(name: string, row: Row): Pipe {
  const endpoint = text(row.endpoint);
  return {
    name,
    nodes: Array.isArray(row.nodes) ? (row.nodes as Fields[]).map(nodeOf) : [],
    ...(endpoint ? { endpointNode: endpoint } : {}),
    pipeId: text(row.vendorId) ?? resourceId('pipe', name),
    description: text(row.description) ?? '',
    createdAt: text(row.created_at) ?? '',
    changedAt: text(row.updated_at) ?? '',
  };
}
export function readPipe(name: string, root: Scope): Pipe | undefined {
  const row = getRow('pipe', pipeKey(name), root);
  return row ? pipeFromRow(name, row) : undefined;
}

/** The pipe's type as the Pipes API reports it. */
export function pipeType(p: Pipe): string {
  if (p.nodes.some((n) => n.type === 'materialized')) return 'materialized';
  if (p.nodes.some((n) => n.type === 'copy')) return 'copy';
  if (endpointNodeOf(p)) return 'endpoint';
  return 'default';
}

export function safeTemplateParams(sql: string): Array<Record<string, unknown>> {
  try { return templateParams(sql).map((t) => ({ name: t.name, type: t.type, ...(t.default !== undefined ? { default: t.default } : {}), required: t.required })); } catch { return []; }
}

export function pipeParams(p: Pipe): Array<Record<string, unknown>> {
  const seen = new Map<string, Record<string, unknown>>();
  for (const n of p.nodes) for (const prm of safeTemplateParams(n.sql)) if (!seen.has(prm.name as string)) seen.set(prm.name as string, prm);
  return [...seen.values()];
}

/** A node as the Pipes API answers it (its publish and list examples, https://www.tinybird.co/docs/api-reference/pipe-api):
 *  with the tables it reads (`dependencies`), and one version of it (`version` 0, `project` null, no stored `result`). */
export function nodeView(p: Pipe, n: PipeNodeModel): Record<string, unknown> {
  const endpoint = endpointNodeOf(p);
  return {
    id: n.id,
    name: n.name,
    sql: n.sql,
    description: n.description ?? null,
    // null where it is not materialized, as the list and publish examples answer
    materialized: n.type === 'materialized' ? n.datasource ?? null : null,
    dependencies: nodeReads(n.sql),
    tags: {},
    created_at: p.createdAt,
    updated_at: p.changedAt,
    version: 0,
    project: null,
    result: null,
    ignore_sql_errors: false,
    node_type: endpoint?.id === n.id ? 'endpoint' : n.type,
    ...(n.datasource ? { datasource: n.datasource } : {}),
    params: safeTemplateParams(n.sql),
  };
}

export function pipeView(p: Pipe, origin: string): Record<string, unknown> {
  const endpoint = endpointNodeOf(p);
  const materialized = p.nodes.find((n) => n.type === 'materialized');
  return {
    id: p.pipeId,
    name: p.name,
    description: p.description,
    // the published node's id, as the publish example answers it
    endpoint: endpoint?.id ?? null,
    created_at: p.createdAt,
    updated_at: p.changedAt,
    parent: null,
    type: pipeType(p),
    nodes: p.nodes.map((n) => nodeView(p, n)),
    ...(endpoint ? { url: `${origin}/v0/pipes/${p.name}.json` } : {}),
    // the published node, and when the Pipe was last changed with it published (the Pipes API's create example)
    ...(endpoint ? { published_version: endpoint.id, published_date: p.changedAt } : {}),
    ...(materialized ? { materialized_node: materialized.id } : {}),
    // A pipe's parameters are every node's: a request's parameters reach all of them.
    params: endpoint ? pipeParams(p) : [],
  };
}

// ── Tokens ──────────────────────────────────────────────────────────────────────────────────

export type Token = { name: string; token: string; scopes: string[]; description?: string };

/** A listed scope (`{type, resource, filter}`) read back as the scope string a token is granted with. */
export function scopeString(s: unknown): string {
  if (typeof s === 'string') return s;
  const o = (s && typeof s === 'object' ? s : {}) as Fields;
  return [o.type, o.resource, o.filter].filter((p) => typeof p === 'string' && p !== '').join(':');
}

/** A token as it is stored: as the Tokens API lists it, with how many times it has been refreshed kept private. */
export function storedToken(t: Token, generation: number): Fields {
  return { name: t.name, description: t.description ?? '', scopes: t.scopes.map(scopeView), token: t.token, _generation: generation };
}

/** A stored token read back. */
export function tokenOf(r: Row): Token {
  return {
    name: String(r.name),
    token: String(r.token),
    scopes: Array.isArray(r.scopes) ? (r.scopes as unknown[]).map(scopeString) : [],
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
  };
}

/** How many times a stored token has been refreshed (none for one a refresh read from the vendor). */
export const generationOf = (r: Row | undefined): number => (typeof r?._generation === 'number' ? r._generation : 0);

/** The Workspace's static tokens. */
export function listTokens(root: Scope): Token[] {
  return rowsOfType('token', root).map(tokenOf);
}

/** Who a request's credential names: a Workspace's static token (the Workspace it belongs to, which must still
 *  exist), or a person's user token. A value the twin never issued, or one refreshed, deleted or gone with its
 *  Workspace, names nobody. */
// source: https://www.tinybird.co/docs/classic/administration/auth-tokens "They remain valid until deleted or refreshed."
export type Caller = { kind: 'workspace'; ws: string; token: Token } | { kind: 'user'; email: string };

export function findCaller(value: string | undefined, store: Store): Caller | undefined {
  if (!value) return undefined;
  const rows = store.rows();
  const user = rows.find((r) => r.type === '_user_token' && r.token === value && r.deleted !== true);
  if (user) return { kind: 'user', email: user.email as string };
  const t = rows.find((r) => r.type === 'token' && r.token === value && r.deleted !== true && typeof r.ws === 'string');
  if (!t) return undefined;
  const ws = t.ws as string;
  if (!liveWorkspace(rows, ws)) return undefined;
  return { kind: 'workspace', ws, token: tokenOf(t) };
}

/** Whether a Workspace of this id is stored and not deleted. */
export const liveWorkspace = (rows: Row[], ws: string): boolean => rows.some((r) => r.type === 'workspace' && r.id === ws && r.deleted !== true);

/** A static token's value: `p.` and 64 hex, from its Workspace, its name, how many times it has been refreshed (so a
 *  refresh never re-issues a value) and a secret the World holds (so no one computes it from those). */
export function tokenValue(ws: string, name: string, generation: number, salt: string): string {
  return `p.${digest('sha256', `tinybird-twin:token:${salt}:${ws}:${name}:${generation}`)}`;
}

// ── Workspaces ──────────────────────────────────────────────────────────────────────────────

export type TinybirdWorkspace = { id: string; name: string; organizationId: string; owner: string; createdAt: string };

/** Every Workspace alive in the root: one the console made carries who owns it; one a refresh read from the vendor names
 *  no owner the console knows. */
export function tinybirdWorkspaces(store: Store): TinybirdWorkspace[] {
  return store.rows()
    .filter((r) => r.type === 'workspace' && r.deleted !== true)
    .map((r) => ({ id: r.id, name: String(r.name), organizationId: text(r._organizationId) ?? '', owner: text(r._owner) ?? '', createdAt: text(r._createdAt) ?? '' }));
}

/** A Workspace's static tokens, for its Tokens page. */
export function tinybirdWorkspaceTokens(store: Store, ws: string): Array<{ name: string; token: string; scopes: string[] }> {
  return listTokens({ store, ws }).map((t) => ({ name: t.name, token: t.token, scopes: t.scopes }));
}

/** A person's user token, minted with their first Workspace and kept for every Workspace they make after. */
export function tinybirdUserToken(store: Store, email: string): string | undefined {
  const row = store.rows().find((r) => r.type === '_user_token' && r.email === email && r.deleted !== true);
  return row?.token as string | undefined;
}

/**
 * Create a Workspace in an Organization, as the console's Create Workspace does, its id a uuid the World mints, with the
 * tokens every Workspace is created with, and its creator's user token.
 */
export async function createTinybirdWorkspace(
  opts: { store: Store; occurredAt: string; name: string; organizationId: string; owner: string; salt: string },
): Promise<TinybirdWorkspace> {
  const id = opts.store.mint('Workspace');
  const req: TinybirdRequest = { method: 'POST', path: '/', store: opts.store, ws: id, occurredAt: opts.occurredAt };
  const at = chDateTime(opts.occurredAt);
  // as GET /v0/workspace answers it, the console's facts of it private
  await opts.store.write('workspace', id, { id, name: opts.name, _organizationId: opts.organizationId, _owner: opts.owner, _createdAt: at, deleted: false }, 'workspace.create');
  // source: https://www.tinybird.co/docs/classic/administration/auth-tokens "All Workspaces are created with a set of basic Tokens that you can add to by creating additional Tokens"
  // source: https://www.tinybird.co/docs/classic/administration/auth-tokens "admin token for that Workspace, used for signing JWTs."
  // source: https://www.tinybird.co/docs/classic/administration/auth-tokens "admin <your-email> token for that Workspace that belongs specifically to your user account for CLI usage."
  // source: https://www.tinybird.co/docs/classic/administration/auth-tokens "create datasource token for creating Data Sources in that Workspace."
  // where the page stops: it names no scope for the two admin tokens beyond "admin"; both are ADMIN here
  const defaults: Array<[string, string[]]> = [
    ['admin token', ['ADMIN']],
    [`admin ${opts.owner}`, ['ADMIN']],
    ['create datasource token', ['DATASOURCES:CREATE']],
  ];
  for (const [name, scopes] of defaults) {
    await write('token', tokenKey(name), { ...storedToken({ name, token: tokenValue(id, name, 0, opts.salt), scopes }, 0), deleted: false }, 'token.create', req);
  }
  // source: https://www.tinybird.co/docs/classic/administration/auth-tokens "Your user Token is specific to your user account. It's a permanent Token for performing operations that aren't limited to a single Workspace, such as creating new Workspaces."
  if (!tinybirdUserToken(opts.store, opts.owner)) {
    // p3: keyed by the salt the World draws from ctx.secret (tinybird-token-salt)
    const token = `p.${digest('sha256', `tinybird-twin:user-token:${opts.salt}:${opts.owner}`)}`;
    await opts.store.write('_user_token', `_user_token:${opts.owner}`, { email: opts.owner, token }, 'user_token.create');
  }
  return { id, name: opts.name, organizationId: opts.organizationId, owner: opts.owner, createdAt: at };
}

/** A Workspace deleted with everything in it, its tokens too. */
export async function deleteWorkspace(req: TinybirdRequest): Promise<void> {
  // source: https://www.tinybird.co/docs/classic/administration/workspaces "Deleting a Workspace deletes all resources within the Workspace, including Data Sources, ingested data, Pipes, and published API Endpoints."
  for (const r of allRows(req)) {
    if (r.deleted === true) continue;
    await write(r.type as TinybirdResourceType, r.id, { deleted: true }, `${r.type}.workspace_delete`, req);
  }
  await req.store.write('workspace', wsOf(req), { deleted: true }, 'workspace.delete');
}

export function tokenView(t: Token): Record<string, unknown> {
  return { name: t.name, description: t.description ?? '', scopes: t.scopes.map((s) => scopeView(s)), token: t.token };
}
/** A scope string's parts: `FAMILY:ACTION[:<resource>[:<sql_filter>]]`, the resource the third segment alone. */
// source: https://www.tinybird.co/docs/api-reference/token-api "Format is SCOPE:TYPE[:arg][:filter]"
export type ParsedScope = { family: string; action?: string; resource?: string; filter?: string };

export function parseScope(scope: string): ParsedScope {
  const parts = scope.trim().split(':');
  const head = (parts[0] ?? '').toUpperCase();
  const family = head === 'DATASOURCE' ? 'DATASOURCES' : head === 'PIPE' ? 'PIPES' : head;
  const out: ParsedScope = { family };
  if (parts[1]) out.action = parts[1].toUpperCase();
  if (parts[2]) out.resource = parts[2];
  if (parts.length > 3) out.filter = parts.slice(3).join(':');
  return out;
}

/** The canonical `FAMILY:ACTION` a scope grants (or the bare family for ADMIN/TOKENS). */
export function normalizeScope(scope: string): string {
  const p = parseScope(scope);
  return p.action ? `${p.family}:${p.action}` : p.family;
}

export function scopeView(scope: string): Record<string, unknown> {
  const p = parseScope(scope);
  const type = p.action ? `${p.family}:${p.action}` : p.family;
  return {
    type,
    ...(p.resource !== undefined ? { resource: p.resource } : {}),
    ...(p.filter !== undefined ? { filter: p.filter } : {}),
  };
}

/** The scopes the Tokens page's table lists, as `FAMILY:ACTION` (or a bare family). A scope outside it is refused at
 *  create rather than stored and refused at first use. */
// source: https://www.tinybird.co/docs/classic/administration/auth-tokens "DATASOURCES:DROP:datasource_name Allows your Token to delete the specified Data Sources."
// source: https://www.tinybird.co/docs/classic/administration/auth-tokens "ORG_DATASOURCES:READ Gives your Token the capacity of reading organization service datasources"
export const KNOWN_SCOPES = new Set([
  'ADMIN', 'TOKENS',
  'DATASOURCES:READ', 'DATASOURCES:APPEND', 'DATASOURCES:CREATE', 'DATASOURCES:DROP',
  'PIPES:READ', 'PIPES:CREATE', 'PIPES:DROP',
  'ORG_DATASOURCES:READ', 'WORKSPACE:READ_ALL',
]);

export function isKnownScope(scope: string): boolean {
  return KNOWN_SCOPES.has(normalizeScope(scope));
}

/** Does `token` hold `required` (a canonical `FAMILY:ACTION`)? `resource` is the Data Source or Pipe touched; with none,
 *  any grant in the family will do (a list, which then shows only what the token holds: `grantedResources`). */
// source: https://www.tinybird.co/docs/classic/administration/auth-tokens "ADMIN All permissions are granted."
// source: https://www.tinybird.co/docs/classic/administration/auth-tokens "When adding the DATASOURCES:READ scope to a Token, it automatically gives read permissions to the quarantine Data Source associated with it."
export function hasScope(token: Token, required: string, resource?: string): boolean {
  if (token.scopes.some((s) => normalizeScope(s) === 'ADMIN')) return true;
  return token.scopes.some((s) => {
    const p = parseScope(s);
    if (normalizeScope(s) !== required) return false;
    if (p.resource === undefined) return true; // a family-wide grant
    if (resource === undefined) return true; // "any grant in this family" (list routes)
    if (p.resource === resource) return true;
    return required === 'DATASOURCES:READ' && quarantineName(p.resource) === resource;
  });
}

/** The resources a token may see in a family, or `undefined` when it may see all of them. */
export function grantedResources(token: Token, required: string): Set<string> | undefined {
  return token.scopes.some((s) => normalizeScope(s) === 'ADMIN') ? undefined : namedResources(token, required);
}

/** The resources a scoped token names in a family (`DATASOURCES:READ:<name>`, `PIPES:READ:<name>`), or undefined for a
 *  family-wide grant; a Data Source's read covers its quarantine table. */
export function namedResources(token: Token, required: string): Set<string> | undefined {
  const named = new Set<string>();
  for (const s of token.scopes) {
    const p = parseScope(s);
    if (normalizeScope(s) !== required) continue;
    if (p.resource === undefined) return undefined; // family-wide
    named.add(p.resource);
    if (required === 'DATASOURCES:READ') named.add(quarantineName(p.resource));
  }
  return named;
}

// ── request helpers ─────────────────────────────────────────────────────────────────────────

export function parseForm(body: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body) return out;
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}
/** One file of a multipart form body, by its field name. */
export function filePart(body: string, boundary: string, field: string): string | undefined {
  const crlf = (part: string): boolean => part.includes('\r\n\r\n');
  const split = (part: string): number => (crlf(part) ? part.indexOf('\r\n\r\n') : part.indexOf('\n\n'));
  const part = body.split(`--${boundary}`).find((p) => split(p) >= 0 && new RegExp(`name="${field}"`).test(p.slice(0, split(p))));
  return part === undefined ? undefined : part.slice(split(part) + (crlf(part) ? 4 : 2)).replace(/\r?\n$/, '');
}
export function parseJsonObject(body: string | undefined): Record<string, unknown> | undefined {
  if (!body || !body.trim()) return undefined;
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** One Events API JSON object, read with its integers exact (see `parseJsonLossless`). */
export function parseEventObject(text: string): Record<string, unknown> | undefined {
  let v: unknown;
  try { v = parseJsonLossless(text); } catch { return notJson(); }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}
/** A line that is not JSON: no demanded caller sends one (Dub's zod-bird writes each event with JSON.stringify). */
export function notJson(): undefined {
  return undefined;
}

/** The request's token: the Authorization header's Bearer token, else the `token` query parameter. */
// source: https://www.tinybird.co/docs/api-reference "There are two ways to authenticate your requests in the Tinybird API: using an authorization header, or using a URL parameter."
export function requestToken(req: TinybirdRequest, query: URLSearchParams): string | undefined {
  const header = req.headers?.['authorization'];
  if (header !== undefined) return /^Bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim();
  return query.get('token') ?? undefined;
}




/** `body`'s answer, or `refuse`'s to the query error it throws (any other error is thrown on). */
export function refusingQueries<T>(refuse: (e: TinybirdQueryError) => T, body: () => T): T {
  try { return body(); } catch (e) { if (e instanceof TinybirdQueryError) return refuse(e); throw e; }
}

/** A node the request runs whose SQL does not run. */
export function nodeRunRefusal(e: TinybirdQueryError, pipe: Pipe, node: PipeNodeModel): TinybirdResponse {
  // source: https://www.tinybird.co/docs/classic/work-with-data/query-parameters "The function gets an object as the first argument, which is sent as JSON"
  if (e instanceof TemplateError && e.body !== undefined) return { status: e.status, body: e.body };
  return tbError(e.status, `[Error] ${e.message} (pipe '${pipe.name}', node '${node.name}')`);
}

/** A query the engine refuses, in the vendor's error body (anything else is the engine's own fault, and throws). */
export function queryRefusal(e: unknown, message: (m: string) => string = (m) => m, status?: number): TinybirdResponse {
  // source: https://www.tinybird.co/docs/classic/work-with-data/query-parameters "The function gets an object as the first argument, which is sent as JSON"
  if (e instanceof TemplateError && e.body !== undefined) return { status: status ?? e.status, body: e.body };
  if (e instanceof TinybirdQueryError) return tbError(status ?? e.status, message(e.message));
  throw e;
}

// ── /v0/events ──────────────────────────────────────────────────────────────────────────────

/** A column's `DEFAULT` expression, evaluated the way ClickHouse fills a missing value. */
export function defaultEvaluator(nowMs: number): (expr: string, type: string) => unknown {
  return (expr, type) => {
    const rel = runSql(parseSql(`SELECT ${expr}`), { table: () => undefined }, nowMs);
    return toStored(rel.rows[0]?.[0] ?? null, type);
  };
}

export type PendingRow = { ds: string; id: string; seq: number; row: Record<string, unknown>; operation: string };

/**
 * Fire the materialized views whose source is `dsName` over the rows just inserted into it, and
 * cascade into the views of each target. Everything is computed in memory against the request's
 * snapshot first, so a view that fails leaves NOTHING written (ClickHouse fails the INSERT when a
 * dependent view throws).
 */
export function materializeCascade(snap: Snapshot, dsName: string, inserted: Array<Record<string, unknown>>, at: string, nowMs: number, out: PendingRow[], depth = 0): void {
  if (inserted.length === 0) return;
  if (depth > 16) throw new TinybirdQueryError(`Materialized views cascade deeper than 16 levels from '${dsName}'`);
  const views = materializedViews([...snap.pipes.values()]).filter((v) => v.source === dsName);
  const source = snap.datasource(dsName);
  if (!source) return;
  for (const view of views) {
    const block = blockRelation(source, inserted);
    let rows: Array<Record<string, unknown>>;
    try { rows = runMaterializedView(view, block, snap, nowMs); } catch (e) { throw e instanceof TinybirdQueryError ? new TinybirdQueryError(`Materialized view '${view.pipe.name}' (node '${view.node.name}') failed on insert into '${dsName}': ${e.message}`, 422) : e; }
    for (const row of rows) {
      const id = mintEventId(view.target, at, row, snap.eventIds);
      const seq = snap.append(view.target, id, row);
      out.push({ ds: view.target, id, seq, row, operation: 'event.materialize' });
    }
    materializeCascade(snap, view.target, rows, at, nowMs, out, depth + 1);
  }
}

/** The words no Data Source, Pipe or node is named by. */
// source: https://www.tinybird.co/docs/api-reference "The following keywords are reserved. You can't use them to name Data Sources, Pipes, nodes or Workspaces. Case is ignored."
export const RESERVED_WORDS = new Set(`Array Bool Boolean Date Date32 DateTime DateTime32 DateTime64 Decimal Decimal128 Decimal256 Decimal32 Decimal64 Enum
  Enum16 Enum8 FixedString Float32 Float64 IPv4 IPv6 Int128 Int16 Int256 Int32 Int64 Int8 MultiPolygon Point Polygon Ring String TABLE UInt128
  UInt16 UInt256 UInt32 UInt64 UInt8 UUID _temporary_and_external_tables add after all and anti any array as asc asof between by case collate
  column columns cross cube custom_error day_diff default defined desc distinct else end enumerate_with_last error exists from full functions
  generateRandom global group having if ilike in inner insert interval into join left like limit limits max min not null numbers_mt on one or
  order outer prewhere public right sample select semi split_to_array sql_and sql_unescape system table then tinybird to union using where
  with zeros_mt zip`.split(/\s+/).map((w) => w.toLowerCase()));

export function reservedWordRefusal(name: string): TinybirdResponse | undefined {
  return RESERVED_WORDS.has(name.toLowerCase()) ? tbError(400, `'${name}' is a reserved word: it cannot name a Data Source, Pipe or node`) : undefined;
}

/** A new Data Source's or Pipe's name refused: a reserved word, or the name of a resource of the other kind. */
// source: https://www.tinybird.co/docs/api-reference "Pipe, Data Source and node names are globally unique."
// source: https://www.tinybird.co/docs/api-reference/pipe-api "names must be unique"
export function namingRefusal(req: TinybirdRequest, name: string, other: 'pipe' | 'datasource'): TinybirdResponse | undefined {
  const taken = other === 'pipe' ? readPipe(name, req) : readDatasource(name, req);
  return reservedWordRefusal(name) ?? (taken ? tbError(409, `There’s another resource with the same name, names must be unique: '${name}' is a ${other === 'pipe' ? 'Pipe' : 'Data Source'}`) : undefined);
}


/** Insert rows into a Data Source (created from them when it does not exist, as both the Events API and a Data
 *  Source append do), quarantining each row its schema cannot hold and firing the Materialized Views over the rest. */
export async function ingestRows(req: TinybirdRequest, name: string, rows: Array<Record<string, unknown>>): Promise<TinybirdResponse | { accepted: Array<Record<string, unknown>>; quarantined: unknown[] }> {
  if (!readDatasource(name, req)) {
    const unnamed = namingRefusal(req, name, 'pipe');
    if (unnamed) return unnamed;
    const inferred = inferSchema(rows);
    // a body of `{}` infers no column: nothing to make a Data Source of, never a column-less one
    if (inferred.length === 0) return tbError(400, `Cannot create Data Source '${name}': no columns could be inferred from the request body`);
    await createDatasource(name, inferred, req);
  }
  const snap = snapshot(req);
  const ds = snap.datasources.get(name)!;

  const at = nowIso(req);
  const nowMs = Date.parse(at);
  const evalDefault = defaultEvaluator(nowMs);
  const accepted: Array<Record<string, unknown>> = [];
  const quarantined: Array<{ row: Record<string, unknown>; errorColumns: string[]; errors: string[] }> = [];
  for (const raw of rows) {
    const check = checkRow(ds.columns, raw, { evalDefault });
    if (check.ok) accepted.push(check.row);
    else quarantined.push({ row: check.row, errorColumns: check.errorColumns, errors: check.errors });
  }

  const pending: PendingRow[] = [];
  for (const row of accepted) {
    const id = mintEventId(name, at, row, snap.eventIds);
    const seq = snap.append(name, id, row);
    pending.push({ ds: name, id, seq, row, operation: 'event.append' });
  }
  try { materializeCascade(snap, name, accepted, at, nowMs, pending); } catch (e) { return queryRefusal(e); }
  for (const p of pending) {
    await write('event', p.id, { ds: p.ds, row: p.row, at: chDateTime(at), seq: p.seq }, p.operation, req);
  }

  for (const q of quarantined) {
    const qName = quarantineName(name);
    // source: https://www.tinybird.co/docs/classic/get-data-in/data-operations/recover-from-quarantine "Additionally, all columns in a quarantine Data Source are stored as String ."
    // source: https://www.tinybird.co/docs/classic/get-data-in/data-operations/recover-from-quarantine "The quarantine Data Source contains additional meta-columns c__error_column , c__error , c__import_id , and insertion_date with information about the errors and the rows"
    const stored: Record<string, unknown> = {};
    for (const col of ds.columns) stored[col.name] = quarantineValue(q.row[col.name]);
    stored.c__error_column = q.errorColumns;
    stored.c__error = q.errors;
    stored.c__import_id = null;
    stored.insertion_date = chDateTime(at);
    const id = mintEventId(qName, at, stored, snap.eventIds);
    const seq = snap.append(qName, id, stored);
    await write('event', id, { ds: qName, row: stored, at: chDateTime(at), seq }, 'event.quarantine', req);
  }

  return { accepted, quarantined };
}






// ── /v0/pipes ───────────────────────────────────────────────────────────────────────────────

export function nowMsOf(req: TinybirdRequest): number {
  return Date.parse(nowIso(req));
}

/** HTTP query controls omitted from template parameter bindings. */
// source: spec:/calls/59 "pipeline"
// Documentation stops: the Query API page demonstrates {{pipeline}} as a template variable and does not
// reserve its name. The vendored CLI query operation sends pipeline as its own request control; this twin
// keeps that control out of /v0/sql template bindings. Endpoint variables keep pipeline available.
export const RESERVED_QUERY_PARAMS = new Set(['token', 'q', 'cli_version', 'from', 'pipeline', 'playground', 'debug', 'explain', 'output_format_json_quote_64bit_integers']);

/** Scope filters constrain the rows a read may see; writes always use the full Workspace snapshot. */
// source: https://www.tinybird.co/docs/api-reference/token-api "Format is SCOPE:TYPE[:arg][:filter]"
export function readSnapshot(req: TinybirdRequest): Snapshot {
  const snap = snapshot(req);
  if (!req.token || hasScope(req.token, 'ADMIN')) return snap;
  const grants = req.token.scopes.map(parseScope);
  return { ...snap, rows(name) {
    const scopes = grants.filter((scope) => scope.family === 'DATASOURCES' && scope.action === 'READ' && (scope.resource === undefined || scope.resource === name));
    if (!scopes.length || scopes.some((scope) => scope.filter === undefined)) return snap.rows(name);
    const datasource = snap.datasource(name);
    if (!datasource) return [];
    const rows = snap.rows(name);
    const relation = { columns: datasource.columns, rows: rows.map((row) => datasource.columns.map((col) => fromStored(row[col.name], col.type))) };
    const results = scopes.map((scope) => runSql(parseSql(`SELECT (${scope.filter}) FROM ${name}`), { table: () => relation }, nowMsOf(req)).rows);
    return rows.filter((_row, i) => results.some((result) => result[i]?.[0] === 1 || result[i]?.[0] === true));
  } };
}

// source: https://www.tinybird.co/docs/classic/cli/template-functions "The following template functions are available"
export function runPipeQuery(pipe: Pipe, params: Record<string, string>, req: TinybirdRequest): { ok: true; result: QueryResult } | { ok: false; response: TinybirdResponse } {
  const snap = readSnapshot(req);
  const node = endpointNodeOf(pipe);
  if (!node) return { ok: false, response: tbError(404, `The pipe '${pipe.name}' does not have an endpoint yet`) };
  const nowMs = nowMsOf(req);
  return refusingQueries<{ ok: true; result: QueryResult } | { ok: false; response: TinybirdResponse }>((e) => ({ ok: false, response: nodeRunRefusal(e, pipe, node) }), () => {
    const { query, catalog } = runNode(pipe, node, { workspace: snap, params, nowMs });
    return { ok: true, result: executeSql(query, catalog, nowMs) };
  });
}

/** An Endpoint's answer to a request its token may make, and the result it ran: its JSON, the request's parameters
 *  given to its template. Its other formats (CSV, NDJSON, Parquet) and SQL over its result (`q`) are variants no
 *  demand or life step asks for: the gap. */
export async function endpointAnswer(req: TinybirdRequest, pipe: Pipe, extension: string, query: URLSearchParams): Promise<{ response: TinybirdResponse; result?: QueryResult }> {
  // source: https://www.tinybird.co/docs/api-reference/pipe-api "Returns the published node data in a particular format."
  // source: https://www.tinybird.co/docs/api-reference/pipe-api "json JSON including data, statistics and schema information"
  if (!['json', 'csv', 'ndjson'].includes(extension) || query.has('q')) return { response: tbError(404, `Not found: ${req.method} ${req.path.split('?')[0]}`) };
  // its template's parameters come in the query string, which the POST form exists to spare a long query
  // source: https://www.tinybird.co/docs/api-reference/pipe-api "Use this endpoint when the query is too long to be passed as a query string parameter."
  const params: Record<string, string> = {};
  // Documentation stops at Endpoint-level reserved names: its page does not reserve pipeline.
  // The CLI renderer allows it as a variable; this is not evidence of the Endpoint HTTP wire.
  for (const [k, v] of query) if ((k === 'pipeline' || !RESERVED_QUERY_PARAMS.has(k)) && !k.startsWith('__tb__')) params[k] = v;
  const run = runPipeQuery(pipe, params, req);
  if (!run.ok) return { response: run.response };
  // source: https://www.tinybird.co/docs/api-reference/pipe-api/api-endpoints "The csv format includes a header row with column names by default"
  // source: https://www.tinybird.co/docs/api-reference/pipe-api/api-endpoints "Pass __tb__csv_header=false to omit that row and get plain CSV instead."
  const format = extension === 'csv' ? (query.get('__tb__csv_header') === 'false' ? 'csv' : 'csvwithnames') : 'ndjson';
  return { response: { status: 200, body: extension === 'json' ? jsonEnvelope(run.result, query) : renderFormat(format, run.result), headers: { 'content-type': extension === 'csv' ? 'text/csv' : extension === 'ndjson' ? 'application/x-ndjson' : 'application/json' } }, result: run.result };
}



/** The JSON answer of an Endpoint or the Query API: the result's meta, data, rows and statistics, a 64-bit-or-wider
 *  integer a bare number unless `output_format_json_quote_64bit_integers=1` asks for it quoted. */
// source: https://www.tinybird.co/docs/api-reference/query-api "As a response, it gives you the query metadata, the resulting data and some performance statistics."
// source: https://www.tinybird.co/docs/api-reference/pipe-api "Possible values: 0 — Integers are output without quotes. 1 — Integers are enclosed in quotes. Default value is 0"
export function jsonEnvelope(result: QueryResult, query?: URLSearchParams): Record<string, unknown> {
  // quoting 64-bit integers (`output_format_json_quote_64bit_integers=1`) is asked by no demanded caller: the gap
  const data = result.data;
  return {
    meta: result.meta,
    data,
    rows: result.rows,
    ...(result.rowsBeforeLimitAtLeast !== undefined ? { rows_before_limit_at_least: result.rowsBeforeLimitAtLeast } : {}),
    statistics: queryStatistics(result),
  };
}

export const NODE_TYPES = new Set(['standard', 'endpoint', 'materialized', 'default']);

/** The nodes a create from full JSON carries (`tb push` sends a datafile's nodes so), or the refusal of ones Tinybird
 *  would not make: a Copy node is a variant no demand or life step asks for (the gap). */
// source: https://www.tinybird.co/docs/api-reference/pipe-api "Creating a Pipe providing full JSON"
export function requestNodes(req: TinybirdRequest, pipeName: string, json: Record<string, unknown>): PipeNodeModel[] | TinybirdResponse {
  const raw = Array.isArray(json.nodes) ? (json.nodes as Array<Record<string, unknown>>) : [];
  // where the page stops: it names no refusal of a create with no node; it is the 400 the page gives "empty or wrong SQL"
  if (raw.length === 0) return tbError(400, 'You need to provide at least one node');
  const kinds = raw.map((n) => (typeof n.type === 'string' ? n.type.toLowerCase() : typeof n.node_type === 'string' ? (n.node_type as string).toLowerCase() : 'standard'));
  if (kinds.includes('copy')) return tbError(404, `Not found: ${req.method} ${req.path.split('?')[0]}`);
  const seen = new Set<string>();
  const nodes: PipeNodeModel[] = [];
  raw.forEach((n, i) => {
    const name = typeof n.name === 'string' && n.name ? n.name : `${pipeName}_${i}`;
    const typeRaw = kinds[i]!;
    nodes.push({
      id: resourceId('node', `${wsOf(req)}:${pipeName}:${name}`),
      name,
      sql: typeof n.sql === 'string' ? n.sql : '',
      type: NODE_TYPES.has(typeRaw) ? ((typeRaw === 'default' ? 'standard' : typeRaw) as PipeNodeModel['type']) : ('invalid' as PipeNodeModel['type']),
      ...(typeof n.description === 'string' && n.description ? { description: n.description } : {}),
      ...(typeof n.datasource === 'string' && n.datasource ? { datasource: n.datasource } : {}),
    });
    if (seen.has(name)) nodes[nodes.length - 1]!.type = 'duplicate' as PipeNodeModel['type'];
    seen.add(name);
  });
  // where the page stops: these are refused as the 400 it gives a create, "empty or wrong SQL or API param value"
  // source: https://www.tinybird.co/docs/api-reference/pipe-api "empty or wrong SQL or API param value"
  const bad = nodes.find((n) => !NODE_TYPES.has(n.type));
  if (bad) return tbError(400, bad.type === ('duplicate' as string) ? `Node name '${bad.name}' is duplicated in pipe '${pipeName}'` : `Unknown node type for node '${bad.name}'`);
  if (nodes.some((n) => n.name === pipeName)) return tbError(400, `A node cannot be named like its pipe ('${pipeName}')`);
  if (nodes.some((n) => !n.sql.trim())) return tbError(400, 'Every node needs SQL');
  const typed = nodes.filter((n) => n.type === 'endpoint' || n.type === 'materialized');
  if (typed.length > 1) return tbError(400, `A pipe can have only one endpoint or materialized node (pipe '${pipeName}')`);
  const mv = nodes.find((n) => n.type === 'materialized');
  if (mv && !mv.datasource) return tbError(400, `Materialized node '${mv.name}' needs a DATASOURCE`);
  return nodes;
}

export async function createPipe(req: TinybirdRequest, query: URLSearchParams, name: string, description: string, nodes: PipeNodeModel[] | TinybirdResponse, json: Record<string, unknown>): Promise<TinybirdResponse> {
  if (!Array.isArray(nodes)) return nodes;
  const force = query.get('force') === 'true';
  const existing = readPipe(name, req);
  if (existing && !force) return tbError(409, `Pipe '${name}' already exists`);
  const unnamed = namingRefusal(req, name, 'datasource') ?? nodes.map((n) => reservedWordRefusal(n.name)).find(Boolean);
  if (unnamed) return unnamed;
  const snap = snapshot(req);
  const draft: Pipe = {
    name, nodes, pipeId: resourceId('pipe', `${wsOf(req)}:${name}`, retiredId('pipe', pipeKey(name), req)),
    description, createdAt: '', changedAt: '',
  };
  // every node is resolved against the Workspace at create: SQL that does not parse or a FROM naming nothing is the
  // create's 400, never an Endpoint that fails later
  // source: https://www.tinybird.co/docs/api-reference/pipe-api "empty or wrong SQL or API param value"
  try {
    validatePipe(draft, snap);
  } catch (e) { return queryRefusal(e, (m) => `Invalid SQL for pipe '${name}': ${m}`, 400); }
  const mv = nodes.find((n) => n.type === 'materialized');
  let createdDatasource = false;
  if (mv) {
    const source = materializedSource(draft, mv);
    if (!source || !snap.datasource(source)) return tbError(400, `Materialized node '${mv.name}': its source table must be a Data Source`);
    // source: https://www.tinybird.co/docs/api-reference/pipe-api/materialized-views "If the Data Source does not exist, it creates automatically with the default settings."
    // a materialized node names a Data Source the push made before it (tb push --push-deps); one it would create is the gap
    if (!snap.datasource(mv.datasource!)) return tbError(404, `Not found: ${req.method} ${req.path.split('?')[0]}`);
    const created = false;
    createdDatasource = created;
  }
  const at = chDateTime(nowIso(req));
  // source: https://www.tinybird.co/docs/api-reference/pipe-api "Bear in mind, if you use this method to overwrite an existing Pipe, the endpoint will only be maintained if the node name is the same."
  const published = existing ? endpointNodeOf(existing) : undefined;
  const kept = published ? nodes.find((n) => n.name === published.name) : undefined;
  await write('pipe', pipeKey(name), {
    ...storedPipe({ ...draft, ...(kept ? { endpointNode: kept.id } : {}), createdAt: existing?.createdAt || at, changedAt: at }),
    deleted: false,
  }, existing ? 'pipe.replace' : 'pipe.create', req);
  const created = readPipe(name, req)!;
  // the create answer's nodes say false where they are not materialized (the page's create example)
  const shown = pipeView(created, originOf(req));
  const view = { ...shown, nodes: (shown.nodes as Array<Record<string, unknown>>).map((n) => ({ ...n, materialized: n.materialized ?? false })) };
  if (mv) {
    const target = readDatasource(mv.datasource!, req)!;
    return { status: 200, body: { ...view, datasource: datasourceView(target, req), created_datasource: createdDatasource } };
  }
  return { status: 200, body: view };
}


// ── /v0/workspace ───────────────────────────────────────────────────────────────────────────

/** A Workspace as GET /v0/workspace answers it. Where the documentation stops: no page shows the answer; this is the
 *  twin's, with the fields tinybird-cli reads (`id`, `name`, `is_branch`, `main`). */
export function workspaceView(w: TinybirdWorkspace, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: w.id, name: w.name, ...extra, is_branch: false, main: null };
}


// ── /v0/tags (labels on Data Sources and Pipes; `tb push` syncs a datafile's TAGS) ──────────

export type TagResource = { id?: string; name?: string; type?: string };

export function tagView(row: Row): Record<string, unknown> {
  return {
    id: text(row.vendorId) ?? resourceId('tag', String(row.name)),
    name: row.name,
    resources: (row.resources as TagResource[]) ?? [],
    created_at: text(row.created_at) ?? '',
    updated_at: text(row.updated_at) ?? '',
  };
}

export function cleanTagResources(raw: unknown): TagResource[] | undefined {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return undefined;
  const out: TagResource[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return undefined;
    const o = r as Record<string, unknown>;
    out.push({
      ...(typeof o.id === 'string' ? { id: o.id } : {}),
      ...(typeof o.name === 'string' ? { name: o.name } : {}),
      ...(typeof o.type === 'string' ? { type: o.type } : {}),
    });
  }
  return out;
}

/** GET /v0/pipes/<pipe>/nodes/<node>/analysis: the columns the node's output has. */
export function nodeAnalysis(req: TinybirdRequest, pipe: Pipe, nodeRef: string | undefined, node: PipeNodeModel | undefined, token: Token): TinybirdResponse {
  if (!hasScope(token, 'PIPES:READ', pipe.name)) return tbError(403, `token does not have the PIPES:READ scope for '${pipe.name}'`);
  if (!node) return tbError(404, `Node '${nodeRef}' not found in pipe '${pipe.name}'`);
  const snap = snapshot(req);
  return refusingQueries<TinybirdResponse>((e) => queryRefusal(e, (m) => `Invalid SQL for node '${node.name}': ${m}`, 400), () => {
    const columns = nodeSchema(pipe, node, snap, nowMsOf(req));
    return { status: 200, body: { analysis: { pipe: { id: pipe.pipeId, name: pipe.name }, node: { id: node.id, name: node.name }, datasource: { columns: columns.map((c) => ({ name: c.name, type: c.type })) } }, warnings: [] } };
  });
}


/** Engine options as the Data Sources API receives them (`engine`, `engine_sorting_key`, …). */
// source: https://www.tinybird.co/docs/api-reference/datasource-api "Optional. Engine parameters and options, check the Engines section for more details"
export function engineFromParams(get: (k: string) => string | undefined): EngineSpec {
  const engine = get('engine');
  const spec: EngineSpec = { engine: engine && engine.trim() ? engine.trim() : 'MergeTree' };
  const put = (k: keyof EngineSpec, v: string | undefined) => { if (v !== undefined && v.trim() !== '') (spec as Record<string, string>)[k] = v.trim().replace(/^"(.*)"$/, '$1'); };
  put('sortingKey', get('engine_sorting_key'));
  put('partitionKey', get('engine_partition_key'));
  put('ver', get('engine_ver'));
  put('isDeleted', get('engine_is_deleted'));
  put('ttl', get('engine_ttl'));
  // source: https://www.tinybird.co/docs/api-reference/datasource-api "engine_settings=index_granularity=2048, ttl_only_drop_parts=false"
  put('settings', get('engine_settings'));
  return spec;
}

// ── /v0/datasources ─────────────────────────────────────────────────────────────────────────

export async function truncateDatasource(name: string, req: TinybirdRequest): Promise<number> {
  const prefix = `event:${name}:`;
  const victims = rowsOfType('event', req).filter((r) => r.id.startsWith(prefix) && r.ds === name);
  for (const v of victims) await write('event', v.id, { deleted: true }, 'event.truncate', req);
  return victims.length;
}

/** The CSV dialect and name/type inference for Data Sources imports. */
// source: https://www.tinybird.co/docs/api-reference/datasource-api "The one-character string separating the fields."
export function csvImport(file: string, get: (key: string) => string | undefined): Array<Record<string, unknown>> {
  const delimiter = get('dialect_delimiter') ?? ',';
  const records: string[][] = [];
  let fields: string[] = [], value = '', quoted = false;
  for (let i = 0; i < file.length; i++) {
    const ch = file[i]!;
    if (ch === '"') {
      if (quoted && file[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && ch === delimiter) { fields.push(value); value = ''; }
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      fields.push(value); value = '';
      if (fields.some((field) => field !== '')) records.push(fields);
      fields = [];
      if (ch === '\r' && file[i + 1] === '\n') i++;
    } else value += ch;
  }
  if (quoted) throw new TinybirdQueryError('Unclosed quoted CSV field', 400);
  if (value || fields.length) records.push([...fields, value]);
  const names = records.shift() ?? [];
  // source: https://www.tinybird.co/docs/api-reference/datasource-api "When using false all columns are created as String"
  // Where the page stops: it gives no exact inference table; numeric CSV cells use the same conservative widening as NDJSON.
  return records.map((record) => Object.fromEntries(names.map((name, i) => {
    const v = record[i] ?? '';
    return [name, get('type_guessing') !== 'false' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v];
  })));
}

/** An import job, done or failed; no failed source read manufactures rows. */
// source: https://www.tinybird.co/docs/api-reference/jobs-api "error : The job has finished with an error."
export async function importJob(req: TinybirdRequest, o: { name: string; mode: string; url?: string; file?: string; accepted?: number; quarantined?: number; error?: string }): Promise<TinybirdResponse> {
  const ds = readDatasource(o.name, req);
  const at = chDateTime(nowIso(req)), id = req.store.mint('Job');
  const status = o.error ? 'error' : 'done';
  const job = {
    id, kind: 'import', job_id: id, status, created_at: at, updated_at: at, started_at: at, is_cancellable: false,
    mode: o.mode, datasource: ds ? datasourceView(ds, req) : { name: o.name }, import_id: id, url: o.url ?? null,
    statistics: { bytes: Buffer.byteLength(o.file ?? '', 'utf8'), row_count: o.accepted ?? 0 }, quarantine_rows: o.quarantined ?? 0, invalid_lines: 0,
    // Where the documentation stops: Jobs documents status=error but does not publish the exact failed-URL message or error detail key.
    ...(o.error ? { error: o.error } : {}),
  };
  await write('job', jobKey(id), { ...job, deleted: false }, 'job.create', req);
  return { status: 200, body: { id, import_id: id, job_id: id, job_url: `${originOf(req)}/v0/jobs/${id}`, datasource: { ...(ds ? { id: ds.dsId } : {}), name: o.name }, quarantine_rows: o.quarantined ?? 0, invalid_lines: 0, error: o.error ?? false } };
}

/** CSV or NDJSON import in create, append or replace mode, from a local file or a World's twinned URL. */
export async function appendRows(req: TinybirdRequest, o: { name?: string; mode?: string; format: string; file?: string; schema?: string; get: (key: string) => string | undefined }): Promise<TinybirdResponse> {
  const { name, format } = o;
  const mode = o.mode ?? 'append';
  // source: https://www.tinybird.co/docs/api-reference/datasource-api "This parameter is mandatory when using the append or replace modes."
  // Documentation stops at the required field; it does not give the missing-name message.
  if (!name) return tbError(400, "You need to provide a value for 'name' to append");
  if (isQuarantineName(name)) return tbError(400, `'${name}' is a quarantine Data Source; quarantine tables are written by Tinybird, not appended to`);
  const existing = readDatasource(name, req);
  if (mode === 'create' && existing) return tbError(409, `Data Source '${name}' already exists`);
  const unnamed = existing ? undefined : namingRefusal(req, name, 'pipe');
  if (unnamed) return unnamed;
  const declared = o.schema ? parseSchemaParam(o.schema) : undefined;
  if (o.schema && !declared) return tbError(400, `Invalid schema: '${o.schema}'`);
  let file = o.file;
  const url = o.get('url');
  if (url !== undefined) {
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "The URL of the CSV with the data to be imported"
    try {
      const source = await req.vendorFetch!(url);
      if (!source.ok) return importJob(req, { name, mode, url, error: `Unable to fetch import URL: HTTP ${source.status}` });
      file = await source.text();
    } catch (error) {
      if (!(error instanceof VendorUnreachableError)) throw error;
      // Where the page stops: the exact wording for an unreachable URL is not published; the documented failed import job states the cause.
      return importJob(req, { name, mode, url, error: `Unable to fetch import URL: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  // Documentation stops at the file/URL requirement; the exact missing-input wording is not published.
  if (file === undefined) return tbError(400, 'An import needs file contents or a URL');
  let rows: Array<Record<string, unknown>>;
  if (format === 'csv') {
    try { rows = csvImport(file, o.get); } catch (error) { return queryRefusal(error); }
  } else if (format === 'ndjson') {
    rows = [];
    for (const line of file.split('\n')) {
      if (!line.trim()) continue;
      const obj = parseEventObject(line);
      if (!obj) return tbError(400, `Invalid NDJSON: each line must be a JSON object (offending line: ${line.slice(0, 80)})`);
      rows.push(obj);
    }
  } else return tbError(404, `Not found: ${req.method} ${req.path.split('?')[0]}`);
  // source: https://www.tinybird.co/docs/api-reference/datasource-api "The append mode inserts the new rows provided into an existing Data Source (it will also create it if it does not exist yet)."
  if (!existing && (declared?.length || rows.length)) await createDatasource(name, declared ?? inferSchema(rows), req, { sourceType: format, engine: engineFromParams(o.get) });
  // source: https://www.tinybird.co/docs/api-reference/datasource-api "The replace mode will remove the previous Data Source and its data and replace it with the new one"
  if (mode === 'replace') {
    const condition = o.get('replace_condition');
    if (!condition) await truncateDatasource(name, req);
    else {
      const ds = readDatasource(name, req)!;
      const victims = rowsOfType('event', req).filter(row => row.ds === name);
      // source: https://www.tinybird.co/docs/classic/get-data-in/data-operations/replace-and-delete-data "The replace condition filters the new data that's appended, meaning it excludes rows not matching the condition."
      // source: https://www.tinybird.co/docs/classic/get-data-in/data-operations/replace-and-delete-data "Because the replace process uses the payload rows to identify which partitions to work on."
      const partition = ds.engine.partitionKey || '0';
      let incoming: unknown[][], storedPartitions: unknown[][];
      try {
        const checked = rows.map(row => checkRow(ds.columns, row, { evalDefault: defaultEvaluator(nowMsOf(req)) }).row);
        const relation = (data: Array<Record<string, unknown>>) => ({ columns: ds.columns, rows: data.map(row => ds.columns.map(col => fromStored(row[col.name], col.type))) });
        incoming = runSql(parseSql(`SELECT (${condition}), (${partition}) FROM ${name}`), { table: () => relation(checked) }, nowMsOf(req)).rows;
        storedPartitions = runSql(parseSql(`SELECT (${partition}) FROM ${name}`), { table: () => relation(victims.map(row => row.row as Record<string, unknown>)) }, nowMsOf(req)).rows;
      } catch (error) { return queryRefusal(error); }
      const selected = incoming.map(row => row[0] === 1 || row[0] === true);
      const touched = new Set(incoming.filter((_row, i) => selected[i]).map(row => valueKey(row[1])));
      rows = rows.filter((_row, i) => selected[i]);
      for (let i = 0; i < victims.length; i++) if (touched.has(valueKey(storedPartitions[i]?.[0]))) await write('event', victims[i]!.id, { deleted: true }, 'event.replace', req);
    }
  }
  const ingested = await ingestRows(req, name, rows);
  if ('status' in ingested) return ingested;
  return importJob(req, { name, mode, url, file, accepted: ingested.accepted.length, quarantined: ingested.quarantined.length });
}

/** A Data Source answered with only the attributes `attrs` names, or whole. */
// source: https://www.tinybird.co/docs/api-reference/datasource-api "comma separated list of the Data Source attributes to return in the response. Example: attrs=name,id,engine . Leave empty to return a full response"
export function attributes(view: Record<string, unknown>, query: URLSearchParams): Record<string, unknown> {
  const attrs = (query.get('attrs') ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  return attrs.length === 0 ? view : Object.fromEntries(attrs.filter((a) => a in view).map((a) => [a, view[a]]));
}


// ── /v0/sql (the Query API) ─────────────────────────────────────────────────────────────────


/** The Query API's answer to `GET /v0/sql?q=…`, the result it ran, and whether it read a Service Data Source (such a
 *  call is not logged). Its POST forms are no operation the twin serves; a FORMAT other than JSON, CSVWithNames and JSONEachRow, and
 *  a Service Data Source other than tinybird.pipe_stats_rt, are variants no demand or life step asks for: the gap. */
export function sqlAnswer(req: TinybirdRequest, query: URLSearchParams, token: Token): { response: TinybirdResponse; result?: QueryResult; service?: boolean } {
  // source: https://www.tinybird.co/docs/api-reference/query-api "Every resource in Tinybird is secured so to use the Query API you must provide a Token with Pipe read permissions."
  if (!hasScope(token, 'DATASOURCES:READ') && !hasScope(token, 'PIPES:READ')) return { response: tbError(403, 'token does not have the DATASOURCES:READ scope') };
  // source: https://www.tinybird.co/docs/api-reference/query-api "q String The SQL query"
  const q = query.get('q') ?? undefined;
  if (!q) return { response: tbError(400, "You need to provide a value for 'q'") };
  const params: Record<string, string> = {};
  for (const [k, v] of query) if (!RESERVED_QUERY_PARAMS.has(k) && !k.startsWith('__tb__')) params[k] = v;
  let plan: Query;
  try { plan = parseQuery(renderTemplate(q.trim(), params)); } catch (e) { return { response: queryRefusal(e) }; }
  const snap = readSnapshot(req);
  let service = false;
  for (const t of usedTables(plan)) {
    if (isServiceDatasource(t)) {
      service = true;
      if (t !== PIPE_STATS_RT) return { response: tbError(404, `Not found: ${req.method} ${req.path.split('?')[0]}`) };
      // source: https://www.tinybird.co/docs/classic/administration/auth-tokens "WORKSPACE:READ_ALL Gives your Token read permission to all workspace resources: datasources, pipes, tinybird.* service data sources"
      if (!hasScope(token, 'WORKSPACE:READ_ALL')) return { response: tbError(403, `token does not have the WORKSPACE:READ_ALL scope, which reading '${t}' needs`) };
      continue;
    }
    const isDs = snap.datasources.has(t);
    const isPipe = !isDs && snap.pipes.has(t);
    if (!isDs && !isPipe) return { response: tbError(404, `Resource '${t}' not found`) };
    if (isDs && !hasScope(token, 'DATASOURCES:READ', t)) return { response: tbError(403, `token does not have the DATASOURCES:READ scope for '${t}'`) };
    if (isPipe && !hasScope(token, 'PIPES:READ', t)) return { response: tbError(403, `token does not have the PIPES:READ scope for '${t}'`) };
  }
  // source: https://www.tinybird.co/docs/api-reference/query-api "Data can be fetched in different formats. Just append FORMAT <format_name> to your SQL query"
  // source: https://www.tinybird.co/docs/api-reference/query-api "CSVWithNames CSV with header"
  // source: https://www.tinybird.co/docs/api-reference/query-api "JSONEachRow Newline-delimited JSON values (NDJSON)"
  const wanted = plan.format?.toLowerCase();
  if (wanted !== undefined && wanted !== 'json' && wanted !== 'csvwithnames' && wanted !== 'jsoneachrow') return { response: tbError(404, `Not found: ${req.method} ${req.path.split('?')[0]}`) };
  return refusingQueries<{ response: TinybirdResponse; result?: QueryResult; service?: boolean }>((e) => ({ response: queryRefusal(e) }), () => {
    const nowMs = nowMsOf(req);
    const result = executeSql(plan, pipeCatalog(undefined, { workspace: snap, params, nowMs }), nowMs);
    const response: TinybirdResponse = wanted === 'csvwithnames'
      ? { status: 200, body: renderFormat('csvwithnames', result), headers: { 'content-type': 'text/csv' } }
      : wanted === 'jsoneachrow'
        ? { status: 200, body: renderFormat('ndjson', result), headers: { 'content-type': 'application/x-ndjson' } }
        : { status: 200, body: jsonEnvelope(result, query) };
    return { response, result, service };
  });
}

// ── /v0/tokens ──────────────────────────────────────────────────────────────────────────────

// ── /v0/jobs ────────────────────────────────────────────────────────────────────────────────

/** A stored job as the Jobs API answers it: its own fields, its vendor id as `id`. */
export function jobOf(r: Row): Record<string, unknown> {
  const skip = new Set(['type', 'id', 'vendorId', 'vendorType', 'updatedAt', 'deleted', 'ws']);
  const rest = Object.fromEntries(Object.entries(r).filter(([k]) => !skip.has(k) && !k.startsWith('_')));
  return { id: r.vendorId, ...rest };
}

/** The Workspace's jobs, in the order they were made. */
export function jobsListed(req: TinybirdRequest): Array<Record<string, unknown>> {
  const nowMs = nowMsOf(req);
  const ms = (t: unknown): number => Date.parse(`${String(t).replace(' ', 'T')}Z`);
  // source: https://www.tinybird.co/docs/api-reference/jobs-api "We can get a list of the last 100 jobs in the last 48 hours"
  return rowsOfType('job', req).map(jobOf)
    .filter((j) => nowMs - ms(j.created_at) <= 48 * 3_600_000)
    .slice(-100);
}

// ── the frame every handler answers through ────────────────────────────────────────────────────

/** Who may call an operation: any valid token (auth), a user token or an `admin <email>` token (the user's Workspaces), a
 *  user token (a Workspace's deletion), or a Workspace's token (the rest). */
export type Who = 'any' | 'user-or-admin' | 'user' | 'workspace';

/** Tinybird's answer as a Response: nothing for 204 and 205, text as it is (CSV, NDJSON, a datafile), else JSON. */
export function send(r: TinybirdResponse): Response {
  if (r.body === null || r.status === 204 || r.status === 205) return new Response(null, { status: r.status, headers: r.headers ?? {} });
  const [text, type] = typeof r.body === 'string' ? [r.body, 'text/plain'] : [stringifyJson(r.body), 'application/json'];
  return new Response(text, { status: r.status, headers: { 'content-type': type, ...(r.headers ?? {}) } });
}

/** The request as the operations read it. */
export function requestOf(ctx: HandlerContext): TinybirdRequest {
  const url = new URL(ctx.call.request.url);
  const headers: Record<string, string> = {};
  ctx.call.request.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  const host = headers['x-volter-twin-original-host'] ?? headers['host'] ?? url.host;
  const readOnly = headers['x-volter-read-only']?.trim() === '1';
  return { method: ctx.call.request.method.toUpperCase(), path: url.pathname + url.search, body: ctx.text || (ctx.body === undefined ? undefined : stringifyJson(ctx.body)), headers, host, occurredAt: ctx.occurredAt, store: storeOf(ctx), vendorFetch: ctx.vendorFetch, readOnly };
}

/** An operation answered: its caller resolved by `who` (every route is authenticated, an unknown or missing token the
 *  vendor's 403 before anything else), then `work`. */
export async function answer(ctx: HandlerContext, who: Who, work: (req: TinybirdRequest, query: URLSearchParams, token: Token, caller: Caller) => Promise<TinybirdResponse> | TinybirdResponse): Promise<Response> {
  const req = requestOf(ctx);
  req.salt = await ctx.secret('tinybird-token-salt');
  const query = new URL(ctx.call.request.url).searchParams;
  const caller = findCaller(requestToken(req, query), req.store);
  // source: https://www.tinybird.co/docs/api-reference/events-api "403 The token isn't valid."
  if (!caller) return send(tbError(403, 'invalid token'));
  if (who === 'any') return send(await work(req, query, undefined as unknown as Token, caller));
  if (who === 'user-or-admin') {
    const email = caller.kind === 'user' ? caller.email : /^admin (\S+@\S+)$/.exec(caller.token.name)?.[1];
    if (!email) return send(tbError(403, 'listing Workspaces needs a user token or an admin <email> token'));
    return send(await work(req, query, undefined as unknown as Token, { ...caller, email } as Caller));
  }
  // source: https://www.tinybird.co/docs/classic/administration/auth-tokens "user token for creating new Workspaces or deleting ones where you are an admin."
  if (who === 'user') return send(caller.kind === 'user' ? await work(req, query, undefined as unknown as Token, caller) : tbError(403, 'deleting a Workspace needs a user token'));
  if (caller.kind === 'user') return send(tbError(403, 'a user token acts on Workspaces, not inside one: use a Workspace token'));
  req.ws = caller.ws;
  req.token = caller.token;
  return send(await work(req, query, caller.token, caller));
}

/** A path parameter, decoded. */
export const param = (ctx: HandlerContext, name: string): string => {
  const v = String(ctx.call.params[name] ?? '');
  try { return decodeURIComponent(v); } catch { return v; }
};
