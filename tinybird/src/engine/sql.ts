// Tinybird's QUERY SURFACE: the kernel's ClickHouse® SQL engine (the root's `clickhouse`), with Tinybird's own
// front: a node's template (`%` on its first line, `{{ }}` and `{% %}`), rendered before the SQL is parsed.
import { clickhouse } from '@volter/world-core';
import { renderTinybirdTemplate, templateVariables, isTemplate } from './template.ts';
import { TinybirdQueryError } from './values.ts';

export { TinybirdQueryError };
export const { executeSql, parseQuery, parseSql, primaryTable, queryStatistics, renderFormat, runSql, usedTables } = clickhouse;
export type Catalog = clickhouse.Catalog;
export type Query = clickhouse.Query;
export type QueryResult = clickhouse.QueryResult;
export type Relation = clickhouse.Relation;

export type TemplateParam = { name: string; type: string; default?: string; required: boolean };

/** The request parameters a node's template declares. */
export function templateParams(sql: string): TemplateParam[] {
  return templateVariables(sql).map((v) => ({ name: v.name, type: v.type, ...(v.default !== undefined ? { default: v.default } : {}), required: v.required }));
}

/**
 * Render a node's SQL. `probe` renders it the way the vendor validates at publish (every variable a
 * placeholder). Template syntax in SQL without the `%` marker is refused: it would reach ClickHouse
 * as literal braces.
 */
export function renderTemplate(sql: string, params: Record<string, string>, opts: { probe?: boolean } = {}): string {
  if (!isTemplate(sql)) {
    if (/\{\{|\{%/.test(sql)) throw new TinybirdQueryError('Template syntax requires the % marker on the first line of the node');
    return sql;
  }
  return renderTinybirdTemplate(sql, params, { test: opts.probe === true }).replace(/^\s+/, '');
}

