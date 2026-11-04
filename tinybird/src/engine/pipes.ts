// PIPES as Tinybird runs them: a pipe is an ordered list of NODES, each a (possibly templated)
// SELECT that may read Data Sources, earlier nodes of the same pipe by name, or another pipe's
// published endpoint. One node is the pipe's ENDPOINT (queried over `/v0/pipes/<pipe>.json`); a
// node of type `materialized` is a MATERIALIZED VIEW writing into its target Data Source.
//
// Materialized views follow ClickHouse's trigger model, which Tinybird inherits: the view fires on
// every INSERT into its source table (the left-most table of the node's query), and its SELECT
// sees ONLY the inserted block wherever it names that source table — including inside
// subqueries — while every other table is read in full. The result is inserted into the target
// Data Source by column name (a missing column takes its type's default), and that insert fires
// the views whose source is the target, so `dub_click_events → dub_click_events_mv →
// dub_click_events_id` cascades from one `POST /v0/events`.
//
// Engines: `FINAL` over a ReplacingMergeTree collapses rows sharing the sorting key to the one with
// the greatest version column (`ENGINE_VER`; the latest insert on a tie) and drops rows whose
// `ENGINE_IS_DELETED` column is 1. An AggregatingMergeTree holds `AggregateFunction` states that
// `<fn>Merge` combines, so reading it without FINAL is always correct.

import { renderTinybirdTemplate } from './template.ts';
import {
  parseQuery, primaryTable, runSql, TinybirdQueryError, usedTables,
  type Catalog, type Query, type Relation,
} from './sql.ts';
import { baseType, fromStored, typeHead, valueKey, compareValues, toStored, defaultOf } from './values.ts';
import type { TinybirdColumn } from './schema.ts';

export type EngineSpec = {
  engine: string;
  sortingKey?: string;
  partitionKey?: string;
  ver?: string;
  isDeleted?: string;
  ttl?: string;
  settings?: string;
};

export type DatasourceModel = { name: string; columns: TinybirdColumn[]; engine: EngineSpec };

export type NodeType = 'standard' | 'endpoint' | 'materialized' | 'copy';
export type PipeNodeModel = {
  id: string;
  name: string;
  sql: string;
  type: NodeType;
  description?: string;
  /** For a materialized node: the target Data Source. */
  datasource?: string;
};
export type PipeModel = { name: string; nodes: PipeNodeModel[]; endpointNode?: string };

/** What a pipe execution reads: the workspace's Data Sources (with their rows) and pipes. */
export interface Workspace {
  datasource(name: string): DatasourceModel | undefined;
  rows(name: string): ReadonlyArray<Record<string, unknown>>;
  pipe(name: string): PipeModel | undefined;
}

// ── Data Source relations ───────────────────────────────────────────────────────────────────

function splitKey(expr: string | undefined): string[] {
  if (!expr) return [];
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of expr.replace(/^\(|\)$/g, (m) => m)) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  const unwrapped = out.length === 1 && /^\(.*\)$/.test(out[0]!) ? splitKey(out[0]!.slice(1, -1)) : out;
  return unwrapped.map((k) => k.replace(/`/g, '').trim());
}

/** A Data Source's rows as an engine relation, with FINAL applied when asked for. */
export function datasourceRelation(ds: DatasourceModel, stored: ReadonlyArray<Record<string, unknown>>, final: boolean): Relation {
  const columns = ds.columns.map((c) => ({ name: c.name, type: c.type }));
  let rows = stored.map((r) => ds.columns.map((c) => fromStored(r[c.name], c.type)));
  // FINAL is ReplacingMergeTree's (the only engine a demanded datafile reads with it); on another engine it is refused
  if (final && ds.engine.engine.toLowerCase() !== 'replacingmergetree') throw new TinybirdQueryError(`Storage ${ds.engine.engine || 'MergeTree'} doesn't support FINAL`);
  if (final) rows = replacingFinal(ds, rows);
  return { columns, rows, declared: true };
}



/** One row read under FINAL: it replaces the kept row of its sorting key when its version is not lower. */
function keepLatest(winners: Map<string, { row: unknown[]; order: number }>, keyCols: number[], verCol: number, row: unknown[], order: number): void {
  const key = keyCols.map((i) => valueKey(row[i])).join('\u0001');
  const prev = winners.get(key);
  if (!prev) { winners.set(key, { row, order }); return; }
  // The greatest version wins; on a tie (or with no version column) the last inserted wins.
  if (verCol < 0 || compareValues(row[verCol], prev.row[verCol]) >= 0) winners.set(key, { row, order: prev.order });
}

function replacingFinal(ds: DatasourceModel, rows: unknown[][]): unknown[][] {
  const idx = (name: string | undefined) => (name ? ds.columns.findIndex((c) => c.name === name) : -1);
  const keyCols = splitKey(ds.engine.sortingKey).map((k) => idx(k));
  if (keyCols.some((i) => i < 0)) throw new TinybirdQueryError(`FINAL: sorting key '${ds.engine.sortingKey}' of '${ds.name}' uses expressions this twin does not model`);
  const verCol = idx(ds.engine.ver);
  const delCol = idx(ds.engine.isDeleted);
  const winners = new Map<string, { row: unknown[]; order: number }>();
  rows.forEach((row, order) => keepLatest(winners, keyCols, verCol, row, order));
  return [...winners.values()]
    .sort((a, b) => a.order - b.order)
    .map((w) => w.row)
    .filter((row) => delCol < 0 || !(row[delCol] === 1 || row[delCol] === true));
}

// ── node execution ──────────────────────────────────────────────────────────────────────────

function renderNode(node: PipeNodeModel, params: Record<string, string>, test: boolean): Query {
  const sql = renderTinybirdTemplate(node.sql, params, { test, name: node.name });
  return parseQuery(stripFormat(sql));
}
function stripFormat(sql: string): string {
  return sql.trim().replace(/;\s*$/, '');
}

export type PipeContext = {
  workspace: Workspace;
  params: Record<string, string>;
  nowMs: number;
  /** Publish-time validation: render every template with placeholders. */
  test?: boolean;
  /** Names that resolve to a fixed relation (a materialized view's inserted block). */
  overrides?: Map<string, Relation>;
};

/** Another Pipe read by name: its Endpoint's result. */
function pipeRelation(other: PipeModel, ctx: PipeContext, stack: string[]): Relation {
  const key = `pipe:${other.name}`;
  if (stack.includes(key)) throw new TinybirdQueryError(`Circular reference to pipe '${other.name}'`);
  const endpoint = endpointNodeOf(other);
  if (!endpoint) throw new TinybirdQueryError(`Pipe '${other.name}' has no published endpoint to read from`);
  return runSql(renderNode(endpoint, ctx.params, ctx.test === true), pipeCatalog(other, ctx, [...stack, key]), ctx.nowMs, { validate: ctx.test === true });
}

/** The catalog a node of `pipe` resolves FROM names against. */
export function pipeCatalog(pipe: PipeModel | undefined, ctx: PipeContext, stack: string[] = []): Catalog {
  const cache = new Map<string, Relation>();
  const catalog: Catalog = {
    table(name, final) {
      const override = ctx.overrides?.get(name);
      if (override) {
        if (final) throw new TinybirdQueryError(`FINAL is not allowed on the materialized view's source block '${name}'`);
        return override;
      }
      const node = pipe?.nodes.find((n) => n.name === name);
      if (node) {
        if (final) throw new TinybirdQueryError(`FINAL is not allowed on node '${name}'`);
        const key = `node:${name}`;
        if (stack.includes(key)) throw new TinybirdQueryError(`Circular reference to node '${name}'`);
        let rel = cache.get(key);
        if (!rel) {
          rel = runSql(renderNode(node, ctx.params, ctx.test === true), pipeCatalog(pipe, ctx, [...stack, key]), ctx.nowMs, { validate: ctx.test === true });
          cache.set(key, rel);
        }
        return rel;
      }
      const ds = ctx.workspace.datasource(name);
      if (ds) return datasourceRelation(ds, ctx.workspace.rows(name), final);
      const other = ctx.workspace.pipe(name);
      return other && other.name !== pipe?.name ? pipeRelation(other, ctx, stack) : undefined;
    },
  };
  return catalog;
}

export function endpointNodeOf(pipe: PipeModel): PipeNodeModel | undefined {
  if (pipe.endpointNode) return pipe.nodes.find((n) => n.id === pipe.endpointNode || n.name === pipe.endpointNode);
  return pipe.nodes.find((n) => n.type === 'endpoint');
}

/** Run a node of a pipe with request parameters. */
export function runNode(pipe: PipeModel, node: PipeNodeModel, ctx: PipeContext): { query: Query; catalog: Catalog } {
  const query = renderNode(node, ctx.params, ctx.test === true);
  return { query, catalog: pipeCatalog(pipe, ctx, [`node:${node.name}`]) };
}

/** A node's query error, named by its node (`notFoundIs400`: a table it names that is not found is the Pipe's 400). */
function nodeError(e: unknown, node: string, notFoundIs400: boolean): unknown {
  if (!(e instanceof TinybirdQueryError)) return e;
  return new TinybirdQueryError(`Error in node '${node}': ${e.message}`, notFoundIs400 && e.status === 404 ? 400 : e.status);
}

/**
 * Validate a pipe at publish the way `tb push` does: every node renders with placeholders
 * (the vendor's `test_mode`), parses, names only resources that exist (nodes of the pipe, Data
 * Sources, other pipes), and then goes through the analyzer — the node runs over its sources'
 * SCHEMAS with no rows, so an unknown column, an unknown function or an illegal argument type is
 * the vendor's 400 at publish even over an empty table. What the analyzer never sees stays lazy
 * exactly as it is for the vendor: a `{% if %}` branch a placeholder does not take is not rendered
 * at publish, so an error inside it surfaces only on a request that takes it. Returns the tables
 * each node reads.
 */
export function validatePipe(pipe: PipeModel, workspace: Workspace): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const node of pipe.nodes) {
    let q: Query;
    try { q = renderNode(node, {}, true); } catch (e) { throw nodeError(e, node.name, false); }
    const tables = usedTables(q);
    for (const t of tables) {
      const known = pipe.nodes.some((n) => n.name === t) || workspace.datasource(t) !== undefined || workspace.pipe(t) !== undefined;
      if (!known) throw new TinybirdQueryError(`Resource '${t}' not found (node '${node.name}')`);
    }
    out.set(node.name, tables);
  }
  for (const node of pipe.nodes) {
    try { nodeSchema(pipe, node, workspace, 0); } catch (e) { throw nodeError(e, node.name, true); }
  }
  return out;
}

/**
 * The Data Source a materialized node fires on: the left-most table of its query, with the pipe's
 * own nodes expanded (nodes compose as subqueries, so `SELECT … FROM filtered` where `filtered`
 * reads `src` triggers on `src`, as Tinybird's materialized pipes do).
 */
export function materializedSource(pipe: PipeModel, node: PipeNodeModel, seen = new Set<string>()): string | undefined {
  let table: string | undefined;
  try { table = primaryTable(renderNode(node, {}, true)); } catch { return undefined; }
  const inner = table === undefined ? undefined : pipe.nodes.find((n) => n.name === table && n !== node);
  // a node it reads is read through to that node's own table
  return inner && !seen.has(inner.name) ? (seen.add(node.name), materializedSource(pipe, inner, seen)) : table;
}


/** The output schema a node would produce (for a materialized node creating its target). */
export function nodeSchema(pipe: PipeModel, node: PipeNodeModel, workspace: Workspace, nowMs: number): TinybirdColumn[] {
  const ctx: PipeContext = { workspace: emptyRows(workspace), params: {}, nowMs, test: true };
  const { query, catalog } = runNode(pipe, node, ctx);
  return runSql(query, catalog, nowMs, { validate: true }).columns;
}
function emptyRows(w: Workspace): Workspace {
  return { datasource: (n) => w.datasource(n), rows: () => [], pipe: (n) => w.pipe(n) };
}

// ── materialized views ──────────────────────────────────────────────────────────────────────

export type MaterializedView = { pipe: PipeModel; node: PipeNodeModel; source: string; target: string };

/** Every materialized node in the workspace, with the table it fires on. */
export function materializedViews(pipes: readonly PipeModel[]): MaterializedView[] {
  const out: MaterializedView[] = [];
  for (const pipe of pipes) {
    for (const node of pipe.nodes) {
      if (node.type !== 'materialized' || !node.datasource) continue;
      const source = materializedSource(pipe, node);
      if (source) out.push({ pipe, node, source, target: node.datasource });
    }
  }
  return out;
}

/**
 * Run one view over an inserted block and shape its result for the target by column NAME.
 * Returns the stored rows to append to the target.
 */
export function runMaterializedView(view: MaterializedView, block: Relation, workspace: Workspace, nowMs: number): Array<Record<string, unknown>> {
  const target = workspace.datasource(view.target);
  if (!target) throw new TinybirdQueryError(`Materialized view '${view.pipe.name}.${view.node.name}': target Data Source '${view.target}' not found`);
  const overrides = new Map([[view.source, block]]);
  const ctx: PipeContext = { workspace, params: {}, nowMs, overrides };
  const { query, catalog } = runNode(view.pipe, view.node, ctx);
  const rel = runSql(query, catalog, nowMs);
  const index = new Map(rel.columns.map((c, i) => [c.name, i]));
  return rel.rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const col of target.columns) {
      const i = index.get(col.name);
      const v = i === undefined ? defaultOf(col.type) : r[i];
      out[col.name] = toStored(v, col.type);
    }
    return out;
  });
}

/** A Data Source's stored rows as the relation a view's source block is. */
export function blockRelation(ds: DatasourceModel, stored: ReadonlyArray<Record<string, unknown>>): Relation {
  return datasourceRelation(ds, stored, false);
}

/** Is this type something the twin can hold in a Data Source column? */
