// Tinybird DATA SOURCE SCHEMA — the ClickHouse®-typed column model a Data Source carries, plus the
// two things that model actually decides at ingest time:
//
//   1. TYPE VALIDATION → QUARANTINE. Tinybird never fails an append because one row is malformed:
//      "If you send rows that don't match the data source schema, they're automatically sent to the
//      quarantine table so that the ingest process doesn't fail" (docs: Quarantine Data Sources).
//      The response then reports the split as `{successful_rows, quarantined_rows}`. This module
//      owns the per-value decision and the vendor's own error TEXT for it — the docs' worked
//      example prints `c__error: ["value '' on column 'abslevel' is not Float32"]`, which is the
//      exact template `quarantineMessage` reproduces.
//   2. SCHEMA INFERENCE. `POST /v0/events` may create the Data Source it appends to (the published
//      limits table prices "Create Data Source using POST /v0/events" separately from appending to
//      one), so an append to an unknown name infers a schema from the first batch.
//
// ⚠ doc-UNVERIFIED, modeled deliberately (see README ## Coverage + the manifest's todos):
//   • the exact INFERRED ClickHouse type Tinybird picks per JSON type (this twin's table below is
//     the conservative widening: integer→Int64, fractional→Float64, string→String, bool→Bool,
//     null→Nullable(String)) — `tinybird.datasources.inference_exactness` (todo);
//   • a column MISSING from an NDJSON row takes its DEFAULT expression, or else its type's default
//     on a non-Nullable column and `null` on a Nullable one (ClickHouse's omitted-field rule, and
//     what dub's own lead ingest relies on); an explicit `null` on a non-Nullable column is
//     quarantined — `tinybird.ingest.missing_column_rule` (todo) files the live confirmation.
// An UNKNOWN column in the row (one the schema does not declare) is DROPPED, not quarantined —
// extra JSON keys are simply not mapped to a column.

import { clickhouse } from '@volter/world-core';
import { defaultOf, toStored } from './values.ts';

const { FLOAT_TYPES, INT_TYPES, isModeledSchemaType, UINT_TYPES, unwrapType } = clickhouse;
type ClickHouseColumn = clickhouse.ClickHouseColumn;

export { isModeledSchemaType, unwrapType };

/**
 * A Data Source column: its `{name, type}` as the Data Sources API renders it, plus the two
 * per-column modifiers of the schema DSL that decide ingest — the JSONPath the Events API reads
 * the value from (`json:$.a.b`, `json:$.tags[:]`) and the `DEFAULT` expression for a missing value.
 */
export type TinybirdColumn = ClickHouseColumn;

/** The quarantine bookkeeping columns Tinybird adds to every `<name>_quarantine` Data Source. */
export const QUARANTINE_COLUMNS: TinybirdColumn[] = [
  { name: 'c__error_column', type: 'Array(String)' },
  { name: 'c__error', type: 'Array(String)' },
  { name: 'c__import_id', type: 'Nullable(String)' },
  { name: 'insertion_date', type: 'DateTime' },
];

/**
 * The quarantine Data Source's schema for a parent whose columns are `columns`.
 *
 * Every original column becomes `Nullable(String)` — the vendor's own rule, stated verbatim in the
 * Quarantine guide's recovery recipe: "Because quarantine columns are `Nullable(String)`, cast
 * every column to its target type". §9 finding: this twin used to mirror the PARENT's types
 * (`Nullable(UInt8)`) while storing the raw offending value, so `meta` and `data` disagreed with
 * each other — a query could report a column as numeric and hand back the string that broke it,
 * and the documented cast-from-String recovery Pipe could not be written at all.
 */
export function quarantineSchema(columns: readonly TinybirdColumn[]): TinybirdColumn[] {
  return [...columns.map((c) => ({ name: c.name, type: 'Nullable(String)' })), ...QUARANTINE_COLUMNS];
}

/** Render one raw value the way a `Nullable(String)` quarantine column stores it. */
export function quarantineValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'bigint') return value.toString();
  return typeof value === 'string' ? value : JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

/** `<name>_quarantine` — the documented naming convention, not a twin invention. */
export function quarantineName(datasource: string): string {
  return `${datasource}_quarantine`;
}
export function isQuarantineName(datasource: string): boolean {
  return datasource.endsWith('_quarantine');
}

// ── type grammar ────────────────────────────────────────────────────────────────────────────


/**
 * Inclusive value range per sized integer type, exact at every width: the Events API body is read
 * with `parseJsonLossless`, so a UInt64 of 18446744073709551615 arrives as that integer (a bigint)
 * rather than a rounded double, and is stored as its decimal string.
 */
const INT_RANGES: Record<string, { min: bigint; max: bigint }> = {
  Int8: { min: -(2n ** 7n), max: 2n ** 7n - 1n },
  Int16: { min: -(2n ** 15n), max: 2n ** 15n - 1n },
  Int32: { min: -(2n ** 31n), max: 2n ** 31n - 1n },
  Int64: { min: -(2n ** 63n), max: 2n ** 63n - 1n },
  Int128: { min: -(2n ** 127n), max: 2n ** 127n - 1n },
  Int256: { min: -(2n ** 255n), max: 2n ** 255n - 1n },
  UInt8: { min: 0n, max: 2n ** 8n - 1n },
  UInt16: { min: 0n, max: 2n ** 16n - 1n },
  UInt32: { min: 0n, max: 2n ** 32n - 1n },
  UInt64: { min: 0n, max: 2n ** 64n - 1n },
  UInt128: { min: 0n, max: 2n ** 128n - 1n },
  UInt256: { min: 0n, max: 2n ** 256n - 1n },
};

/**
 * JSON.parse that keeps integers exact: an integer literal beyond ±2^53 becomes a bigint (every
 * other value parses as JSON.parse would). Throws a SyntaxError on malformed input.
 */
export function parseJsonLossless(text: string): unknown {
  let i = 0;
  const ws = () => { while (i < text.length && ' \t\n\r'.includes(text[i]!)) i++; };
  const err = (): never => { throw new SyntaxError(`Unexpected token in JSON at position ${i}`); };
  const value = (): unknown => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      const out: Record<string, unknown> = {};
      ws();
      if (text[i] === '}') { i++; return out; }
      for (;;) {
        ws();
        if (text[i] !== '"') err();
        const k = str();
        ws();
        if (text[i++] !== ':') err();
        out[k] = value();
        ws();
        if (text[i] === ',') { i++; continue; }
        break;
      }
      if (text[i] !== '}') err();
      i++;
      return out;
    }
    if (c === '[') {
      i++;
      ws();
      return text[i] === ']' ? emptyArray() : arrayItems();
    }
    if (c === '"') return str();
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
    if (m && m[0].length > 0 && m[0] !== '-') {
      i += m[0].length;
      return m[2] || m[3] ? fraction(m[0]) : integer(m[0]);
    }
    const word = (['true', 'false', 'null'] as const).find((w) => text.startsWith(w, i));
    if (word) { i += word.length; return word === 'null' ? null : word === 'true'; }
    return err();
  };
  const emptyArray = (): unknown[] => { i++; return []; };
  // a non-empty array's items, read up to its `]`
  const arrayItems = (): unknown[] => {
    const out: unknown[] = [];
    for (;;) {
      out.push(value());
      ws();
      if (text[i] === ',') { i++; continue; }
      if (text[i] !== ']') err();
      i++;
      return out;
    }
  };
  const integer = (t: string): number | bigint => { const n = Number(t); return Number.isSafeInteger(n) ? n : BigInt(t); };
  const fraction = (t: string): number => {
    return Number(t);
  };
  const str = (): string => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) err();
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const v = value();
  ws();
  if (i < text.length) err();
  return v;
}

/** Is this a real calendar date/time, not merely date-SHAPED? §9 finding: the regexes alone
 *  accepted `2026-13-45 99:99:99` and `2026-02-30`, which the vendor quarantines. */
function isRealCalendarValue(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1) return false;
  // Day-of-month bound, leap years included.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return false;
  if (m[4] === undefined) return true;
  const [hh, mm, ss] = [Number(m[4]), Number(m[5]), Number(m[6])];
  return hh <= 23 && mm <= 59 && ss <= 59;
}


/** The vendor's own quarantine error text (docs: Quarantine Data Sources worked example). */
export function quarantineMessage(column: string, value: unknown, type: string): string {
  const rendered = value === undefined || value === null ? '' : typeof value === 'string' ? value : typeof value === 'bigint' ? value.toString() : JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  return `value '${rendered}' on column '${column}' is not ${type}`;
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Does `value` fit `type`? Returns the COERCED value when it does (Tinybird stores the typed value,
 * so a `Bool` column holding `1` reads back as a boolean, never the number 1).
 */
export function coerceValue(type: string, value: unknown): { ok: true; value: unknown } | { ok: false } {
  const { base, nullable, array } = unwrapType(type);
  if (value === null || value === undefined) return nullable ? { ok: true, value: null } : { ok: false };
  if (array) return !Array.isArray(value) ? { ok: false } : value.length === 0 ? { ok: true, value: [] } : coerceItems(base, value);
  const head = base.replace(/\(.*\)$/s, '');
  if (head === 'String' || head === 'FixedString' || head === 'UUID' || head === 'IPv4' || head === 'IPv6') {
    return typeof value === 'string' ? { ok: true, value } : { ok: false };
  }
  if (INT_TYPES.has(head) || UINT_TYPES.has(head)) {
    // ClickHouse reads a JSON boolean into an integer column as 1 / 0
    // (`input_format_json_read_bools_as_numbers`, on by default): dub's click ingest sends
    // `bot` and `qr` as booleans into UInt8 columns.
    if (typeof value === 'boolean') return { ok: true, value: value ? 1 : 0 };
    // an integer beyond 2^53 is stored as its exact decimal string (no demanded column holds one past its type's range)
    if (typeof value === 'bigint') return { ok: true, value: value.toString() };
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) return { ok: false };
    const range = INT_RANGES[head];
    if (range && (BigInt(value) < range.min || BigInt(value) > range.max)) return { ok: false };
    return { ok: true, value };
  }
  if (FLOAT_TYPES.has(head)) return coerceFloat(value);
  return head === 'DateTime' || head === 'DateTime64' ? coerceDateTime(value) : coerceOther(head, value);
}

/** A DateTime column's value. */
function coerceDateTime(value: unknown): Coerced {
  if (typeof value !== 'string' || !DATETIME_RE.test(value) || !isRealCalendarValue(value)) return { ok: false };
  return { ok: true, value };
}

/** A Date column's value; a type this twin does not model (a Bool or JSON column, which no demanded datafile
 *  declares) is accepted rather than quarantining a row over the TWIN's gap (never an invented vendor rejection). */
function coerceOther(head: string, value: unknown): Coerced {
  return head === 'Date' || head === 'Date32' ? coerceDate(value) : { ok: true, value };
}


type Coerced = { ok: true; value: unknown } | { ok: false };

/** A non-empty array's items, each coerced to the element type. */
function coerceItems(base: string, value: unknown[]): Coerced {
  const out: unknown[] = [];
  for (const item of value) {
    const c = coerceValue(base, item);
    if (!c.ok) return { ok: false };
    out.push(c.value);
  }
  return { ok: true, value: out };
}



/** A Float column's value. */
function coerceFloat(value: unknown): Coerced {
  if (typeof value === 'bigint') return { ok: true, value: Number(value) };
  if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false };
  return { ok: true, value };
}

/** A Date column's value. */
function coerceDate(value: unknown): Coerced {
  if (typeof value !== 'string' || !DATE_RE.test(value) || !isRealCalendarValue(value)) return { ok: false };
  return { ok: true, value };
}


export type RowCheck =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; errorColumns: string[]; errors: string[]; row: Record<string, unknown> };

/**
 * Map one raw JSON row onto `columns`. Unknown keys are dropped; every declared column is validated
 * and coerced. A single bad column quarantines the whole row (and EVERY offending column is
 * reported, matching the documented `c__error_column`/`c__error` ARRAYS).
 */
export function checkRow(
  columns: readonly TinybirdColumn[],
  raw: Record<string, unknown>,
  opts: { evalDefault?: (expr: string, type: string) => unknown } = {},
): RowCheck {
  const row: Record<string, unknown> = {};
  const errorColumns: string[] = [];
  const errors: string[] = [];
  for (const col of columns) {
    let value: unknown;
    if (col.jsonpath) value = readJsonPath(raw, col.jsonpath);
    else value = Object.prototype.hasOwnProperty.call(raw, col.name) ? raw[col.name] : undefined;
    // A missing value takes the column's DEFAULT expression when it declares one.
    if ((value === undefined || value === null) && col.defaultExpr && opts.evalDefault && !unwrapType(col.type).nullable) {
      value = opts.evalDefault(col.defaultExpr, col.type);
    } else if (value === undefined && !unwrapType(col.type).nullable) value = omittedDefault(col.type);
    const coerced = coerceValue(col.type, value);
    if (!coerced.ok) {
      errorColumns.push(col.name);
      errors.push(quarantineMessage(col.name, value, col.type));
      continue;
    }
    row[col.name] = coerced.value;
  }
  if (errorColumns.length > 0) return { ok: false, errorColumns, errors, row: { ...raw } };
  return { ok: true, row };
}

/**
 * An OMITTED field on a non-Nullable column takes its type's default, as ClickHouse's JSONEachRow does
 * (`input_format_defaults_for_omitted_fields`). Consumer evidence: dub's lead schema sends `trigger` only when the click
 * had one, and its lead materialized view maps `trigger = ''` to 'link'/'qr'. An explicit `null` stays a quarantine.
 */
function omittedDefault(type: string): unknown {
  return toStored(defaultOf(type), type);
}


/**
 * Read a column's value by its JSONPath (`$.a`, `$.a.b`, `$.a[0]`, `$.tags[:]`, `$['a-b']`). `[:]`
 * selects the whole array. A path that does not match yields `undefined`.
 */
export function readJsonPath(doc: unknown, path: string): unknown {
  let p = path.trim();
  if (!p.startsWith('$')) return undefined;
  p = p.slice(1);
  let cur: unknown = doc;
  const re = /^(?:\.([A-Za-z_$][\w$-]*)|\[\s*'([^']*)'\s*\]|\[\s*"([^"]*)"\s*\]|\[\s*(-?\d+)\s*\]|\[:\])/;
  while (p.length > 0) {
    const m = re.exec(p);
    if (!m) return undefined;
    p = p.slice(m[0].length);
    if (m[0] === '[:]') {
      if (!Array.isArray(cur)) return undefined;
      continue;
    }
    if (cur === null || typeof cur !== 'object') return undefined;
    // an index into an array (`$.a[0]`) is read by no demanded datafile's jsonpath
    if (m[4] !== undefined) return undefined;
    const key = m[1] ?? m[2] ?? m[3]!;
    if (Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[key];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** Infer one column type from a JSON value (see the ⚠ note in this file's header). */
export function inferType(value: unknown): string {
  if (value === null || value === undefined) return 'Nullable(String)';
  if (typeof value === 'boolean') return 'Bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'Int64' : 'Float64';
  if (typeof value === 'bigint') return value > 2n ** 63n - 1n ? 'UInt64' : 'Int64';
  if (Array.isArray(value)) return `Array(${value.length > 0 ? unwrapType(inferType(value[0])).base : 'String'})`;
  // a nested object infers JSON, which can hold its document (Tinybird's exact mapping for one is not documented)
  return typeof value === 'string' ? (DATETIME_RE.test(value) && isRealCalendarValue(value) ? 'DateTime' : 'String') : typeof value === 'object' ? 'JSON' : 'String';
}


/**
 * Infer a whole schema from a batch. Column ORDER is first-seen order across the batch (stable and
 * deterministic); a column that is `null` in the first row it appears in but typed later widens to
 * `Nullable(<that type>)` rather than staying `Nullable(String)`.
 */
export function inferSchema(rows: readonly Record<string, unknown>[]): TinybirdColumn[] {
  const order: string[] = [];
  const seen = new Map<string, { type: string; sawNull: boolean; typed: boolean }>();
  for (const row of rows) {
    for (const [name, value] of Object.entries(row)) {
      const isNull = value === null || value === undefined;
      const existing = seen.get(name);
      // §9 finding: this used to be `unwrapType(inferType(value)).base`, which THREW AWAY the
      // `Array(` wrapper `inferType` had just produced — so auto-creating from a batch containing
      // an array inferred a scalar `String` column and then quarantined 100% of that same batch.
      // A brand-new Data Source rejecting the rows that defined it is self-contradictory, so the
      // inferred type is now kept whole and only the NULLABILITY is decided here.
      const inferred = isNull ? undefined : inferType(value);
      if (!existing) {
        order.push(name);
        seen.set(name, { type: inferred ?? 'String', sawNull: isNull, typed: !isNull });
        continue;
      }
      if (isNull) { existing.sawNull = true; continue; }
      if (!existing.typed) { existing.type = inferred!; existing.typed = true; continue; }
      // Int64 seen alongside a fractional value widens to Float64 (never the reverse).
      if (existing.type === 'Int64' && inferred === 'Float64') existing.type = 'Float64';
    }
  }
  return order.map((name) => {
    const info = seen.get(name)!;
    // Array and JSON columns are never wrapped in Nullable (ClickHouse forbids Nullable(Array(…))
    // and a JSON column already admits null).
    const wrappable = !/^Array\(/.test(info.type) && info.type !== 'JSON';
    return { name, type: info.sawNull && wrappable ? `Nullable(${info.type})` : info.type };
  });
}

/**
 * Parse the Data Sources API's `schema` parameter — the vendor's own DSL, e.g.
 * `date DateTime, city String, temp Float32`. Returns undefined for an unparseable line so the
 * caller can answer with the vendor's 400 rather than silently creating a wrong-shaped table.
 */
export function parseSchemaParam(schema: string): TinybirdColumn[] | undefined {
  const columns: TinybirdColumn[] = [];
  let depth = 0;
  let current = '';
  const parts: string[] = [];
  for (const ch of schema) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  if (depth !== 0) return undefined; // unbalanced parentheses
  parts.push(current);
  for (const raw of parts) {
    const part = raw.trim().replace(/`/g, '');
    if (!part) continue;
    const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s+([\s\S]+)$/.exec(part);
    if (!nameMatch) return undefined;
    const name = nameMatch[1]!;
    // Consume the type as a BALANCED expression rather than with a flat regex. §9 finding: the old
    // pattern stopped at the first inner comma, so `Decimal(10, 2)` was stored as the nonsense type
    // `Decimal(10` — silently creating a wrong-shaped table, which is exactly what this function's
    // own docstring promises not to do.
    const rest = nameMatch[2]!.trim();
    let d = 0;
    let end = rest.length;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i]!;
      if (ch === '(') d++;
      else if (ch === ')') d--;
      else if (/\s/.test(ch) && d === 0) { end = i; break; }
      if (d < 0) return undefined;
    }
    if (d !== 0) return undefined;
    const type = rest.slice(0, end).trim();
    const trailing = rest.slice(end).trim();
    if (!type || !isModeledSchemaType(type)) return undefined;
    // The vendor's schema DSL allows per-column modifiers (`json:$.path`, `DEFAULT …`); anything
    // else trailing the type is a typo, not a modifier, and must not be silently ignored.
    if (trailing && !/^(json:|DEFAULT\s|CODEC\(|MATERIALIZED\s|ALIAS\s|TTL\s)/i.test(trailing)) return undefined;
    const col: TinybirdColumn = { name, type };
    const jsonpath = /(?:^|\s)json:(\S+)/.exec(trailing)?.[1];
    if (jsonpath) col.jsonpath = jsonpath;
    const def = /(?:^|\s)DEFAULT\s+([\s\S]+?)(?=\s+(?:CODEC\(|TTL\s|json:)|$)/i.exec(trailing)?.[1];
    if (def) col.defaultExpr = def.trim();
    columns.push(col);
  }
  return columns.length > 0 ? columns : undefined;
}


