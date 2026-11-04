// THE MySQL-SUBSET ENGINE — the file that makes this pack a twin rather than a stub. `SELECT`
// returns what `INSERT` actually wrote, a duplicate primary key raises MySQL's own errno 1062
// `Duplicate entry`, `NOT NULL` refuses a null, `AUTO_INCREMENT` hands out the next id, and an
// unmodeled statement raises Vitess's own `unsupported:` UNIMPLEMENTED rather than a fake success.
//
// This module is PURE: it operates on an in-memory `Database` image and returns a `QueryOutcome`.
// It never touches the kernel, the clock, or the network — `../semantics/shared.ts` folds the kernel
// action log into the image, runs a statement here, and writes the touched subjects back. That
// split is what lets a transaction be an overlay (see the store) and what makes every expression /
// error / type-mapping assertion below testable without a server.
//
// Sources: spec/SOURCE.md, spec/doc-examples.json and the cited references in semantics/shared.ts.
// The demanded driver is @planetscale/database 1.19.0: it interpolates ? and named parameters into SQL
// before Execute and casts the returned cells by their field types. The wire is the vendored PlanetScale
// psdb Connect service; MySQL 8.0's reference gives the statement semantics; PlanetScale's compatibility
// and system-limits references give its unsupported statements and scalar bounds.
//
// ── WHAT "MySQL-SUBSET" HONESTLY MEANS ────────────────────────────────────────────────────────
// This is a hand-written parser over a deliberately bounded grammar, not MySQL. SELECT covers
// joins (inner, cross, left), derived tables, scalar/IN/EXISTS subqueries (correlated or not), row
// constructors, GROUP BY/HAVING with the aggregates, DISTINCT and locking reads; reads with no ORDER
// BY come back in primary-key order, as InnoDB's clustered index returns them. UNION, RIGHT/NATURAL
// joins, window functions, ALTER TABLE variants beyond adding/dropping columns, views, indexes-as-access-paths and the function library
// beyond the ones below are UNMODELED and raise `unsupported:` — the vendor's own UNIMPLEMENTED
// shape — never a fabricated empty result.

import { informationSchemaView, INFORMATION_SCHEMA, isInformationSchema } from './information-schema.ts';
import {
  aggregate, BINARY_COLLATION, binCollation, COERCIBLE, type Collation, collationNamed, databaseCollation, defaultCollation,
  DERIVATION_NAMES, type DT, EXPLICIT, IGNORABLE, IMPLICIT, likeMatch as collationLike, lookupCharset, lookupCollation, NONE, NUMERIC as NUMERIC_DERIVATION, SYSCONST,
} from './collation.ts';
import {
  compareJson, decAdd, decCmp, decDiv, decFromBigInt, decFromNumber, decIntDigits, decIsZero, decKey, decMod, decMul, decNeg, decRound, decSub, decText,
  decTrunc, type Dec, formatDouble, formatFloat, formatTemporal, inTimestampRange, JNum, JObj, jsonContains, jsonDepth, jsonKey, jsonObject, JsonTextError,
  jsonTypeName, type JV, packTemporal, parseDateTimeText, parseDec, parseJson, parseTemporalNumber, parseTimeText, printJson, roundFsp, stringNumberPrefix,
  type Temporal, type TemporalKind, temporalFromUtcMs, temporalNumberText, temporalUtcMs, type TemporalParse,
} from './values.ts';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// VALUES
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One stored cell. ALWAYS the MySQL TEXT representation of the value, or null.
 *
 * This is not a shortcut — it is the wire's own model. psdb packs every column of every row as raw
 * bytes with a per-column byte length (`row.lengths`/`row.values`), and the CLIENT casts those
 * bytes by the field's declared type (dist/cast.js: INT32 → parseInt, FLOAT64 → parseFloat, JSON →
 * JSON.parse, INT64 → left as a string, BLOB → Uint8Array). Storing text plus the column's type is
 * therefore isomorphic to what the vendor stores as far as this protocol can ever observe.
 */
export type Cell = string | null;

/** Vitess `query.Type` enum names, as protojson spells them — the values `Field.type` carries. */
export const VITESS_TYPES = [
  'NULL', 'INT8', 'UINT8', 'INT16', 'UINT16', 'INT24', 'UINT24', 'INT32', 'UINT32',
  'INT64', 'UINT64', 'FLOAT32', 'FLOAT64', 'TIMESTAMP', 'DATE', 'TIME', 'DATETIME',
  'YEAR', 'DECIMAL', 'TEXT', 'BLOB', 'VARCHAR', 'VARBINARY', 'CHAR', 'BINARY',
  'BIT', 'ENUM', 'SET', 'GEOMETRY', 'JSON', 'EXPRESSION',
] as const;
export type VitessType = (typeof VITESS_TYPES)[number];

/** MySQL's binary collation id. `@planetscale/database`'s `cast` treats charset 63 as BINARY and
 *  returns a `Uint8Array` for it (dist/cast.js `isBinary`), so getting this wrong changes the
 *  JavaScript type an integrator receives. utf8mb4_general_ci has id 45; text columns carry the id of their own resolved collation. */
export const BINARY_CHARSET = 63;
export const UTF8MB4_CHARSET = 45;

/** MySQL column flags, as `Field.flags` reports them (mysql_com.h). Only the ones this engine
 *  actually sets are named; the rest are deliberately absent rather than guessed. */
export const FLAG_NOT_NULL = 1;
export const FLAG_PRI_KEY = 2;
export const FLAG_UNIQUE_KEY = 4;
export const FLAG_BLOB = 16;
export const FLAG_UNSIGNED = 32;
export const FLAG_BINARY = 128;
export const FLAG_AUTO_INCREMENT = 512;

/** The published PlanetScale system limits this engine ENFORCES, with the page they came from.
 *  Live-read 2026-08-31 from planetscale.com/docs/reference/planetscale-system-limits. */
// source: https://planetscale.com/docs/reference/planetscale-system-limits "Per-query rows returned, updated, or deleted 100k"
export const PLANETSCALE_LIMITS = {
  source: 'https://planetscale.com/docs/reference/planetscale-system-limits (read 2026-08-31)',
  /** "Per-query rows returned, updated, or deleted: 100k". */
  maxRowsPerQuery: 100_000,
  /** "Tables per database schema (including views): 2048". */
  maxTablesPerSchema: 2048,
  /** "Columns per table: 1017". */
  maxColumnsPerTable: 1017,
} as const;

/** The version string both wires report (`VERSION()`, `@@version`, the native handshake). */
export const SERVER_VERSION = '8.0.0-volter-twin';

/** MySQL 8's default sql_mode (manual 7.1.11), which PlanetScale runs with and this engine
 *  enforces: strict writes, no zero dates, division by zero an error on write, full GROUP BY. */
export const SQL_MODE = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

/**
 * The system variables a client can read (`SELECT @@name`, `@@session.name`), with the values this
 * engine's behaviour actually has: `lower_case_table_names` is 2 because table names keep their
 * declared lettercase and compare case-insensitively; `transaction_isolation` is READ-COMMITTED
 * because every statement reads the latest committed rows (no REPEATABLE READ snapshot). Any other
 * name is MySQL's errno 1193.
 */
export const SYSTEM_VARIABLES: Record<string, string | number> = {
  version: SERVER_VERSION, version_comment: 'Volter PlanetScale twin', sql_mode: SQL_MODE,
  lower_case_table_names: 2, autocommit: 1, max_allowed_packet: 16 * 1024 * 1024 - 2, wait_timeout: 28800,
  socket: '', transaction_isolation: 'READ-COMMITTED', tx_isolation: 'READ-COMMITTED',
  character_set_client: 'utf8mb4', character_set_connection: 'utf8mb4', character_set_results: 'utf8mb4',
  character_set_server: 'utf8mb4', collation_connection: 'utf8mb4_0900_ai_ci', collation_server: 'utf8mb4_0900_ai_ci',
  group_concat_max_len: 1024, div_precision_increment: 4, innodb_lock_wait_timeout: 50,
  time_zone: 'SYSTEM', system_time_zone: 'UTC',
};

/** group_concat_max_len's default: GROUP_CONCAT's result is cut to this many bytes. */
const GROUP_CONCAT_MAX_LEN = 1024;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ERRORS — MySQL's errno/sqlstate under Vitess's vtrpc code
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A query failure, carrying BOTH halves of what PlanetScale actually returns: the vtrpc code that
 * lands in `ExecuteResponse.error.code` and the MySQL errno/sqlstate that MySQL clients key on.
 *
 * WHAT IS DELIBERATELY NOT FABRICATED: a real PlanetScale error message is prefixed with the
 * vttablet routing context — `target: <keyspace>.<shard>.<tablet_type>: vttablet: rpc error: code =
 * … desc = ` — which encodes the keyspace, shard and tablet type of the deployment that answered.
 * A local twin has no keyspace or shard, so inventing that prefix would be asserting a fact about a
 * cluster that does not exist. The MySQL half (message text, `(errno N) (sqlstate S)`) IS real and
 * is reproduced verbatim; `planetscale.errors.vttablet_prefix` files the omission as a todo.
 */
export class SqlError extends Error {
  constructor(
    message: string,
    /** the vtrpc code, protojson-spelled (`NOT_FOUND`, `INVALID_ARGUMENT`, `ALREADY_EXISTS`, …). */
    readonly code: string,
    readonly errno: number,
    readonly sqlState: string,
  ) {
    super(`${message} (errno ${errno}) (sqlstate ${sqlState})`);
    this.name = 'SqlError';
  }
}

const noSuchTable = (db: string, t: string) => new SqlError(`Table '${db}.${t}' doesn't exist`, 'NOT_FOUND', 1146, '42S02');
const tableExists = (t: string) => new SqlError(`Table '${t}' already exists`, 'ALREADY_EXISTS', 1050, '42S01');
const badField = (c: string, where: string) => new SqlError(`Unknown column '${c}' in '${where}'`, 'INVALID_ARGUMENT', 1054, '42S22');
const dupEntry = (value: string, key: string) => new SqlError(`Duplicate entry '${value}' for key '${key}'`, 'ALREADY_EXISTS', 1062, '23000');
const badNull = (c: string) => new SqlError(`Column '${c}' cannot be null`, 'INVALID_ARGUMENT', 1048, '23000');
const wrongValueCount = (row: number) => new SqlError(`Column count doesn't match value count at row ${row}`, 'INVALID_ARGUMENT', 1136, '21S01');
const noDefault = (c: string) => new SqlError(`Field '${c}' doesn't have a default value`, 'INVALID_ARGUMENT', 1364, 'HY000');

export const parseError = (position: number, near: string): SqlError =>
  new SqlError(`syntax error at position ${position}${near === '' ? '' : ` near '${near}'`}`, 'INVALID_ARGUMENT', 1064, '42000');

/**
 * An operation this twin does not model. Vitess's own refusal for a statement its planner cannot
 * build — the message begins `unsupported: ` and the vtrpc code is UNIMPLEMENTED. A twin MUST take
 * this path rather than answering an empty result set: a fabricated `[]` reads to the caller as
 * "the query ran and matched nothing", which is the exact fake-success the bar forbids.
 */
export const unsupported = (what: string): SqlError =>
  new SqlError(`unsupported: ${what}`, 'UNIMPLEMENTED', 1235, '42000');

/** Guard against a query whose result would exceed the vendor's published per-query row cap. */
const rowLimitExceeded = (n: number): SqlError =>
  new SqlError(
    `Query exceeded the maximum number of rows (${PLANETSCALE_LIMITS.maxRowsPerQuery}); got ${n}`,
    'RESOURCE_EXHAUSTED', 1153, 'HY000',
  );

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type ColumnDef = {
  name: string;
  /** the base type, uppercased and length-stripped: `VARCHAR`, `BIGINT`, `JSON`, … */
  dataType: string;
  /** the full MySQL rendering, as `Field.columnType` reports it: `varchar(255)`, `bigint unsigned`. */
  columnType: string;
  length: number | null;
  unsigned: boolean;
  nullable: boolean;
  /** `undefined` = the column declared no DEFAULT (distinct from `DEFAULT NULL`, which is `null`). */
  defaultValue?: Cell;
  /** Was the DEFAULT written as a hex literal (`DEFAULT x'00ff'`)? Then it is already bytes and
   *  `execCreateTable` must not UTF-8-encode it. */
  defaultIsBinaryLiteral?: boolean;
  /** `DEFAULT CURRENT_TIMESTAMP[(fsp)]`: the fractional-seconds precision. The value is read from
   *  the World clock (`ExecOptions.now`) when a row is inserted, never from the wall clock. */
  defaultCurrentTimestamp?: number;
  /** An expression default, `DEFAULT (expr)` (MySQL 8.0.13+): its text as COLUMN_DEFAULT reports it,
   *  with the literal value it evaluates to held in `defaultValue`. */
  defaultExpression?: string;
  autoIncrement: boolean;
  primaryKey: boolean;
  unique: boolean;
  /** A character column's character set and collation, resolved at CREATE TABLE from the column's
   *  own `CHARACTER SET`/`COLLATE`/`BINARY`, else the table's, else the database default. */
  charset?: string;
  collation?: string;
  /** Parse-time only: the column's `BINARY` attribute (its charset's _bin collation). */
  binaryAttribute?: boolean;
  /** Parse-time only: how the DEFAULT was written — a number literal, a string literal, or a
   *  parenthesised expression — which decides how CREATE TABLE converts it to the column's type. */
  defaultLiteral?: 'number' | 'string' | 'expression';
};

/** One column of an index: its name, an optional prefix length and its direction. */
export type IndexPart = { name: string; length?: number; desc?: boolean };
/** A non-unique secondary index. It changes access paths, not results — this engine has one access
 *  path (a scan) — but it is part of the catalog INFORMATION_SCHEMA.STATISTICS reports. */
export type IndexDef = { name: string; columns: IndexPart[]; type: 'BTREE' | 'FULLTEXT' };

export type TableDef = {
  name: string;
  columns: ColumnDef[];
  /** column names forming the PRIMARY KEY, in declaration order. Empty = no primary key. */
  primaryKey: string[];
  /** each UNIQUE constraint as `{ name, columns }` — the name is what errno 1062 reports. `parts`
   *  keeps each column's prefix length and direction for the catalog. */
  uniques: Array<{ name: string; columns: string[]; parts?: IndexPart[] }>;
  /** non-unique secondary and FULLTEXT indexes, in declaration order. */
  indexes?: IndexDef[];
  /** the table's declared default character set and collation (`DEFAULT CHARSET=… COLLATE=…`). */
  charset?: string;
  collation?: string;
  /** the persisted AUTO_INCREMENT watermark. InnoDB 8.0 persists this across restarts, and so does
   *  this engine — which is also what stops a delete-then-insert from reusing a retired id. */
  autoIncrement: number;
};

export type RowRec = {
  /** the engine's internal row identity — never a column, never exposed on the wire. Minted from
   *  the MAX rowid present in the table (see `nextRowId`), never from a row COUNT: a count-mint
   *  collides the instant a row above the count exists, which is what silently clobbers a
   *  connector-pulled row. */
  rowid: number;
  cells: Record<string, Cell>;
};

/** The in-memory image one statement executes against. */
export type Database = {
  /** the schema/database name — what `Field.database` reports and what errno 1146 names. */
  name: string;
  tables: Map<string, TableDef>;
  rows: Map<string, RowRec[]>;
};

export const emptyDatabase = (name: string): Database => ({ name, tables: new Map(), rows: new Map() });

/** MySQL identifiers are case-insensitive on the platforms PlanetScale runs (lower_case_table_names
 *  = 1), so tables are keyed lowercase while the DECLARED spelling is preserved for display. */
export const tableKey = (name: string): string => name.toLowerCase();

export function findTable(db: Database, name: string): TableDef {
  const t = db.tables.get(tableKey(name));
  if (t === undefined) throw noSuchTable(db.name, name);
  return t;
}

export function tableRows(db: Database, name: string): RowRec[] {
  return db.rows.get(tableKey(name)) ?? [];
}

/**
 * Row ids at or above this belong to the CONNECTOR: a pulled row's id is derived from the real
 * row's own identity, not from its position in a
 * `SELECT`, so a re-pull re-derives the same subject and a new real row gets a new one.
 *
 * The band exists because the two minting rules must never meet. §9 round one reproduced the
 * collision end-to-end when they shared a namespace: pull 1 → rowids 1,2; a local INSERT →
 * `nextRowId` = 3; pull 2, now returning a third real row, positionally assigned it rowid 3 as
 * well — so it landed on the LOCAL row's subject, the real row was silently dropped, and `syncPull`
 * reported deltas that changed nothing. Disjoint bands make that unrepresentable rather than
 * unlikely.
 */
export const PULLED_ROWID_BASE = 2 ** 32;

/**
 * The next LOCAL row id: MAX(existing local) + 1 — entropy-free, and collision-free in both
 * directions. Pulled ids are skipped (they live in their own band, above), so a local mint can
 * never land on a pulled row and a pull can never land on a local one.
 *
 * Never a row COUNT: a count-mint collides the moment a row above the count exists.
 */
export function nextRowId(rows: RowRec[]): number {
  let max = 0;
  for (const r of rows) if (r.rowid > max && r.rowid < PULLED_ROWID_BASE) max = r.rowid;
  return max + 1;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// TYPE MAPPING — declared MySQL type → the vitess `Field.type` the client casts by
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The mapping the whole protocol rests on. `@planetscale/database`'s `cast` (dist/cast.js) branches
 * ONLY on `field.type` and `field.charset`, so this table decides what JavaScript type an
 * integrator receives: INT32 → `number`, INT64 → `string` (bigint-safe, deliberately NOT cast),
 * FLOAT64 → `number`, JSON → a parsed object, DATETIME/DATE/TIME → the raw string, anything with
 * charset 63 → `Uint8Array`, everything else → a decoded UTF-8 string.
 */
export function vitessTypeFor(column: { dataType: string; unsigned: boolean }): VitessType {
  const u = column.unsigned;
  switch (column.dataType) {
    case 'BOOL': case 'BOOLEAN': case 'TINYINT': return u ? 'UINT8' : 'INT8';
    case 'SMALLINT': return u ? 'UINT16' : 'INT16';
    case 'MEDIUMINT': return u ? 'UINT24' : 'INT24';
    case 'INT': case 'INTEGER': return u ? 'UINT32' : 'INT32';
    case 'BIGINT': return u ? 'UINT64' : 'INT64';
    case 'FLOAT': return 'FLOAT32';
    case 'DOUBLE': case 'REAL': return 'FLOAT64';
    case 'DECIMAL': case 'NUMERIC': return 'DECIMAL';
    case 'DATE': return 'DATE';
    case 'DATETIME': return 'DATETIME';
    case 'TIMESTAMP': return 'TIMESTAMP';
    case 'TIME': return 'TIME';
    case 'YEAR': return 'YEAR';
    case 'JSON': return 'JSON';
    case 'CHAR': return 'CHAR';
    case 'BINARY': return 'BINARY';
    case 'VARBINARY': return 'VARBINARY';
    case 'BLOB': case 'TINYBLOB': case 'MEDIUMBLOB': case 'LONGBLOB': return 'BLOB';
    case 'TEXT': case 'TINYTEXT': case 'MEDIUMTEXT': case 'LONGTEXT': return 'TEXT';
    case 'ENUM': return 'ENUM';
    case 'SET': return 'SET';
    case 'BIT': return 'BIT';
    case 'VARCHAR': default: return 'VARCHAR';
  }
}

const BINARY_TYPES = new Set(['BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB', 'BINARY', 'VARBINARY']);

/** The vitess types a result column reports under MySQL's BINARY collation (charset 63). */
const BINARY_VITESS = new Set<VitessType>(['BLOB', 'BINARY', 'VARBINARY']);

const INTEGRAL = new Set(['INT8', 'UINT8', 'INT16', 'UINT16', 'INT24', 'UINT24', 'INT32', 'UINT32', 'INT64', 'UINT64', 'YEAR']);
const NUMERIC = new Set([...INTEGRAL, 'FLOAT32', 'FLOAT64', 'DECIMAL']);

export const isNumericVitessType = (t: VitessType): boolean => NUMERIC.has(t);

/**
 * Does a column of this vitess type report charset 63?
 *
 * TWO families do, and conflating them was a §9 round-one defect: the NUMERIC types report binary
 * because MySQL has no collation for a number, and the BLOB/BINARY/VARBINARY family reports it
 * because the value genuinely IS bytes. `@planetscale/database`'s `cast` branches on
 * `field.charset === 63` alone (dist/cast.js, `isBinary`), so a VARBINARY expression served with
 * charset 45 comes back to the caller as a mojibake STRING instead of a `Uint8Array` — and its
 * payload is UTF-8-expanded, so the byte lengths are wrong too.
 */
export const isBinaryCharsetType = (t: VitessType): boolean => NUMERIC.has(t) || BINARY_VITESS.has(t) || t === 'JSON';

/** The type-borne flags of a result column: BINARY with the binary charset, and BLOB for JSON. A
 *  JSON column is reported as MySQL reports it, charset 63 with BLOB|BINARY (144): the client's
 *  `cast` reaches its `isJson` branch before `isBinary`, and the packer writes JSON text as utf8mb4. */
const typeFlags = (t: VitessType): number => (isBinaryCharsetType(t) ? FLAG_BINARY : 0) | (t === 'JSON' ? FLAG_BLOB : 0);

/**
 * UTF-8-encode a string into this engine's byte-string form (one character per byte).
 *
 * A BINARY column's cell is always held this way, because that is what the wire packs verbatim and
 * what `LENGTH()` counts. Text arriving for such a column is encoded HERE, at write time.
 */
export function toByteString(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

/** The wire-shape of one result column. Mirrors `@planetscale/database`'s exported `Field`. */
export type Field = {
  name: string;
  type: VitessType;
  table?: string;
  orgTable?: string;
  database?: string;
  orgName?: string;
  columnLength?: number;
  charset?: number;
  flags?: number;
  columnType?: string;
  /** Engine-internal, never on the wire: the collation a character result column compares under
   *  (a derived table's column or an IN subquery's operand reads it back). */
  collation?: string;
};

export function fieldForColumn(db: Database, table: TableDef, column: ColumnDef, alias?: string): Field {
  const type = vitessTypeFor(column);
  // ONE rule with `expressionField` (§9 round two, finding 3: the two paths disagreed, so
  // `SELECT p` reported charset 63 while `SELECT CONCAT(p)` reported 45 for the same column).
  // Numeric columns report the binary collation in MySQL too — there is no collation for a number —
  // and the client's `cast` reaches its integral/float/decimal branches before `isBinary`, so the
  // JavaScript type an integrator receives is unchanged.
  const binary = isBinaryCharsetType(type);
  let flags = 0;
  if (!column.nullable) flags |= FLAG_NOT_NULL;
  if (column.primaryKey) flags |= FLAG_PRI_KEY;
  else if (column.unique) flags |= FLAG_UNIQUE_KEY;
  if (column.unsigned) flags |= FLAG_UNSIGNED;
  flags |= typeFlags(type);
  if (column.autoIncrement) flags |= FLAG_AUTO_INCREMENT;
  return {
    name: alias ?? column.name,
    type,
    table: table.name,
    orgTable: table.name,
    database: db.name,
    orgName: column.name,
    columnLength: column.length ?? defaultColumnLength(type),
    charset: binary ? BINARY_CHARSET : UTF8MB4_CHARSET,
    flags,
    columnType: column.columnType,
    ...(column.collation !== undefined ? { collation: column.collation } : {}),
  };
}

/** The column a derived table gets for a field its subquery produced: the field's own type and
 *  nullability, read back through the same mapping `vitessTypeFor` writes forward. */
function columnForField(field: Field): ColumnDef {
  const dataType = ((): string => {
    switch (field.type) {
      case 'INT8': case 'UINT8': return 'TINYINT';
      case 'INT16': case 'UINT16': return 'SMALLINT';
      case 'INT24': case 'UINT24': return 'MEDIUMINT';
      case 'INT32': case 'UINT32': return 'INT';
      case 'INT64': case 'UINT64': return 'BIGINT';
      case 'FLOAT32': return 'FLOAT';
      case 'FLOAT64': return 'DOUBLE';
      case 'DECIMAL': return 'DECIMAL';
      case 'DATE': case 'DATETIME': case 'TIMESTAMP': case 'TIME': case 'YEAR': case 'JSON': case 'CHAR': case 'BINARY': case 'VARBINARY': case 'BLOB': case 'TEXT': case 'ENUM': case 'SET': case 'BIT': return field.type;
      default: return 'VARCHAR';
    }
  })();
  const unsigned = ((field.flags ?? 0) & FLAG_UNSIGNED) !== 0;
  const columnType = field.columnType ?? `${dataType.toLowerCase()}${unsigned ? ' unsigned' : ''}`;
  return {
    name: field.name, dataType, columnType,
    length: field.columnLength ?? null, unsigned,
    nullable: ((field.flags ?? 0) & FLAG_NOT_NULL) === 0,
    autoIncrement: false, primaryKey: false, unique: false,
    ...(field.collation !== undefined ? { collation: field.collation } : {}),
  };
}

function defaultColumnLength(type: VitessType): number {
  switch (type) {
    case 'INT8': case 'UINT8': return 4;
    case 'INT16': case 'UINT16': return 6;
    case 'INT24': case 'UINT24': return 9;
    case 'INT32': case 'UINT32': return 11;
    case 'INT64': case 'UINT64': return 20;
    case 'FLOAT32': return 12;
    case 'FLOAT64': return 22;
    case 'DATE': return 10;
    case 'TIME': return 10;
    case 'DATETIME': case 'TIMESTAMP': return 19;
    case 'YEAR': return 4;
    case 'JSON': return 4294967295;
    case 'TEXT': return 262140;
    case 'BLOB': return 65535;
    default: return 255;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// TOKENIZER
// ─────────────────────────────────────────────────────────────────────────────────────────────

type TokKind = 'ident' | 'quoted-ident' | 'string' | 'number' | 'hex' | 'punct' | 'eof';
type Token = { kind: TokKind; value: string; pos: number };

const PUNCT3 = ['<=>', '->>'];
const PUNCT2 = ['<=', '>=', '<>', '!=', '||', '&&', '->', '<<', '>>', ':='];
const PUNCT1 = ['(', ')', ',', '.', '*', '+', '-', '/', '%', '=', '<', '>', ';', '?', '!', '~', '&', '|', '^'];

/** `noBackslashEscapes`: the session's NO_BACKSLASH_ESCAPES SQL mode ("Disable the use of the backslash character (\\) as
 *  an escape character within strings … backslash becomes an ordinary character like any other", manual 7.1.11). */
export function tokenize(sql: string, noBackslashEscapes = false): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (/\s/.test(c)) { i++; continue; }
    // comments: -- to EOL, # to EOL, /* … */
    if (c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '#') { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (c === '/' && sql[i + 1] === '*') { const end = sql.indexOf('*/', i + 2); i = end === -1 ? sql.length : end + 2; continue; }
    const start = i;
    // backtick-quoted identifier (MySQL doubles an embedded backtick)
    if (c === '`') {
      i++;
      let v = '';
      for (;;) {
        if (i >= sql.length) throw parseError(start + 1, '`');
        if (sql[i] === '`') {
          if (sql[i + 1] === '`') { v += '`'; i += 2; continue; }
          i++; break;
        }
        v += sql[i]; i++;
      }
      out.push({ kind: 'quoted-ident', value: v, pos: start + 1 });
      continue;
    }
    // string literal, single or double quoted. `@planetscale/database`'s own `format` emits single
    // quotes with backslash escapes (dist/sanitization.js), and MySQL also accepts '' as an
    // embedded quote — both forms are handled because both reach a real server.
    if (c === "'" || c === '"') {
      const q = c; i++;
      let v = '';
      for (;;) {
        if (i >= sql.length) throw parseError(start + 1, q);
        const ch = sql[i]!;
        if (ch === '\\' && !noBackslashEscapes) {
          const esc = sql[i + 1];
          if (esc === undefined) throw parseError(start + 1, q);
          v += unescapeChar(esc); i += 2; continue;
        }
        if (ch === q) {
          if (sql[i + 1] === q) { v += q; i += 2; continue; }
          i++; break;
        }
        v += ch; i++;
      }
      out.push({ kind: 'string', value: v, pos: start + 1 });
      continue;
    }
    // hex literals: 0xDEADBEEF and x'DEADBEEF' (the latter is what the SDK's `format` emits for a
    // Uint8Array — dist/text.js `uint8ArrayToHex`).
    if (c === '0' && (sql[i + 1] === 'x' || sql[i + 1] === 'X') && /[0-9a-fA-F]/.test(sql[i + 2] ?? '')) {
      i += 2; let v = '';
      while (i < sql.length && /[0-9a-fA-F]/.test(sql[i]!)) { v += sql[i]; i++; }
      out.push({ kind: 'hex', value: v, pos: start + 1 });
      continue;
    }
    // bit-value literals: b'01100001' and 0b01100001 (manual 11.1.5, "Bit-Value Literals"), read as the bytes they spell
    if (((c === 'b' || c === 'B') && sql[i + 1] === "'") || (c === '0' && sql[i + 1] === 'b' && /[01]/.test(sql[i + 2] ?? ''))) {
      const quoted = sql[i + 1] === "'";
      i += 2; let v = '';
      while (i < sql.length && /[01]/.test(sql[i]!)) { v += sql[i]; i++; }
      if (quoted) { if (sql[i] !== "'") throw parseError(start + 1, "b'"); i++; }
      const n = v === '' ? 0n : BigInt(`0b${v}`);
      const bytes = Math.max(1, Math.ceil(v.length / 8));
      out.push({ kind: 'hex', value: n.toString(16).padStart(bytes * 2, '0'), pos: start + 1 });
      continue;
    }
    if ((c === 'x' || c === 'X') && sql[i + 1] === "'") {
      i += 2; let v = '';
      while (i < sql.length && sql[i] !== "'") { v += sql[i]; i++; }
      if (sql[i] !== "'") throw parseError(start + 1, "x'");
      i++;
      if (!/^[0-9a-fA-F]*$/.test(v)) throw parseError(start + 1, `x'${v}'`);
      out.push({ kind: 'hex', value: v, pos: start + 1 });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] ?? ''))) {
      let v = '';
      while (i < sql.length && /[0-9.]/.test(sql[i]!)) { v += sql[i]; i++; }
      if (i < sql.length && /[eE]/.test(sql[i]!) && /[0-9+-]/.test(sql[i + 1] ?? '')) {
        v += sql[i]; i++;
        if (/[+-]/.test(sql[i]!)) { v += sql[i]; i++; }
        while (i < sql.length && /[0-9]/.test(sql[i]!)) { v += sql[i]; i++; }
      }
      out.push({ kind: 'number', value: v, pos: start + 1 });
      continue;
    }
    if (/[A-Za-z_@$]/.test(c)) {
      let v = '';
      while (i < sql.length && /[A-Za-z0-9_@$]/.test(sql[i]!)) { v += sql[i]; i++; }
      out.push({ kind: 'ident', value: v, pos: start + 1 });
      continue;
    }
    const three = sql.slice(i, i + 3);
    if (PUNCT3.includes(three)) { out.push({ kind: 'punct', value: three, pos: start + 1 }); i += 3; continue; }
    const two = sql.slice(i, i + 2);
    if (PUNCT2.includes(two)) { out.push({ kind: 'punct', value: two, pos: start + 1 }); i += 2; continue; }
    if (PUNCT1.includes(c)) { out.push({ kind: 'punct', value: c, pos: start + 1 }); i++; continue; }
    throw parseError(start + 1, c);
  }
  out.push({ kind: 'eof', value: '', pos: sql.length + 1 });
  return out;
}

function unescapeChar(c: string): string {
  switch (c) {
    case '0': return '\0';
    case 'b': return '\b';
    case 'n': return '\n';
    case 'r': return '\r';
    case 't': return '\t';
    case 'Z': return '\x1a';
    case '\\': return '\\';
    case "'": return "'";
    case '"': return '"';
    case '%': return '\\%';
    case '_': return '\\_';
    default: return c;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// AST
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type Expr =
  /** `collation` is an introducer's (`_utf8mb4'x'`); a plain string literal takes the connection's. */
  | { kind: 'literal'; value: Cell; hint: VitessType; collation?: string; hex?: true }
  /** `expr COLLATE name`: an EXPLICIT collation for the comparison it takes part in. */
  | { kind: 'collate'; arg: Expr; collation: string }
  | { kind: 'column'; table?: string; name: string }
  | { kind: 'star'; table?: string }
  | { kind: 'unary'; op: 'NOT' | '-' | 'BINARY' | '~'; arg: Expr }
  /** `x IS [NOT] TRUE | FALSE | UNKNOWN`: a truth test that is never NULL (manual 14.4.2). */
  | { kind: 'is'; arg: Expr; value: 'TRUE' | 'FALSE' | 'UNKNOWN'; negated: boolean }
  /** `x MEMBER OF (json_array)` (8.0.17+). */
  | { kind: 'member'; arg: Expr; doc: Expr }
  /** `CAST(x AS type)` / `CONVERT(x, type)` / `CONVERT(x USING charset)`: `to` is the target type. */
  | { kind: 'cast'; arg: Expr; to: ColumnDef; atTimeZone?: string }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'isnull'; arg: Expr; negated: boolean }
  /** `x IN (a, b)`, or `x IN (SELECT …)` when `subquery` is set (then `list` is empty). */
  | { kind: 'in'; arg: Expr; list: Expr[]; negated: boolean; subquery?: SelectStatement; run?: SubqueryRun }
  | { kind: 'like'; arg: Expr; pattern: Expr; negated: boolean; escape?: Expr }
  | { kind: 'between'; arg: Expr; low: Expr; high: Expr; negated: boolean }
  | { kind: 'call'; name: string; args: Expr[]; star: boolean; distinct?: boolean; order?: OrderTerm[]; separator?: string }
  /** A row constructor, `(a, b)`, compared element-wise (`=`, `<`, `IN`). */
  | { kind: 'row'; items: Expr[] }
  /** A scalar subquery, `(SELECT …)`. `run` is attached when the statement is bound for execution. */
  | { kind: 'subquery'; select: SelectStatement; run?: SubqueryRun }
  | { kind: 'exists'; select: SelectStatement; run?: SubqueryRun }
  | { kind: 'case'; operand?: Expr; whens: Array<{ when: Expr; then: Expr }>; otherwise?: Expr }
  /** A column BOUND to one source of the executing statement: `src` indexes the row tuple and
   *  `def` carries the column's declared type. Produced by binding, never by the parser. */
  | { kind: 'slot'; src: number; col: string; def: ColumnDef };

/** A bound subquery's evaluator: its result set, given the (outer) row it is evaluated for. */
export type SubqueryRun = ((row: EvalRow) => { fields: Field[]; rows: Cell[][] }) & {
  /** the result columns, typed statically: known before (and without) running it. */
  fields: () => Field[];
};

export type SelectItem = { expr: Expr; alias?: string; text: string };
export type OrderTerm = { expr: Expr; desc: boolean };

/** One table in FROM: a stored table (or INFORMATION_SCHEMA view), or a DERIVED TABLE, a
 *  parenthesised subquery MySQL requires an alias for (errno 1248), materialised once and then read
 *  exactly as a table is. */
export type TableFactor = { table: string; schema?: string; alias?: string } | { derived: SelectStatement; alias: string };
/** A joined table: `[INNER|CROSS] JOIN t [ON …]` or `LEFT [OUTER] JOIN t ON …`. */
export type JoinClause = { kind: 'inner' | 'left'; factor: TableFactor; on?: Expr };
/** One comma-separated FROM item: a table factor and the joins chained onto it. */
export type FromItem = { factor: TableFactor; joins: JoinClause[] };
export type SelectStatement = {
  kind: 'select'; items: SelectItem[]; distinct?: boolean; from?: FromItem[]; where?: Expr;
  groupBy?: Expr[]; having?: Expr; order: OrderTerm[]; limit?: number; offset?: number;
  /** `FOR UPDATE` / `FOR SHARE` / `LOCK IN SHARE MODE`: a locking read. */
  lock?: 'update' | 'share';
};

export type IsolationLevel = 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export type Statement =
  | SelectStatement
  /** `alias`/`aliasColumns`: the new row's name in ON DUPLICATE KEY UPDATE (`VALUES … AS new [(a, b)]`, 8.0.19+). */
  | { kind: 'insert'; table: string; columns: string[]; rows: Expr[][]; ignore: boolean; onDuplicate?: Array<{ column: string; value: Expr }>; alias?: string; aliasColumns?: string[] }
  | { kind: 'update'; table: string; alias?: string; set: Array<{ table?: string; column: string; value: Expr }>; where?: Expr; order: OrderTerm[]; limit?: number }
  /** The multiple-table form: `UPDATE table_references SET [t.]col = expr, … [WHERE …]` (execUpdateMulti). */
  | { kind: 'update-multi'; from: FromItem[]; set: Array<{ table?: string; column: string; value: Expr }>; where?: Expr }
  | { kind: 'delete'; table: string; where?: Expr; order: OrderTerm[]; limit?: number }
  | { kind: 'create-table'; table: string; ifNotExists: boolean; columns: ColumnDef[]; primaryKey: string[]; uniques: TableDef['uniques']; indexes: IndexDef[]; charset?: string; collation?: string }
  | { kind: 'drop-table'; table: string; ifExists: boolean }
  | { kind: 'create-table-select'; table: string; ifNotExists: boolean; select: SelectStatement }
  /** `ALTER TABLE t ADD [COLUMN] col_def [FIRST | AFTER c], …`: the one alteration this engine models. */
  | { kind: 'alter-add-columns'; table: string; adds: Array<{ column: ColumnDef; first?: boolean; after?: string }> }
  /** `ALTER TABLE t DROP [COLUMN] c, …`: a statement of drops only. */
  | { kind: 'alter-drop-columns'; table: string; drops: string[] }
  | { kind: 'truncate'; table: string }
  | { kind: 'show-tables' }
  | { kind: 'show-warnings' }
  | { kind: 'show-create-table'; table: string }
  | { kind: 'describe'; table: string }
  /** `SET [SESSION] TRANSACTION ISOLATION LEVEL …` / `SET [SESSION] TRANSACTION READ ONLY|WRITE`. */
  | { kind: 'set-transaction'; isolation?: IsolationLevel; access?: 'READ WRITE' | 'READ ONLY'; scope: 'next' | 'session' }
  /** `SET @var := expr, …` and `SET [SESSION] sql_mode = expr`: the session's user variables and its SQL mode. */
  | { kind: 'set-vars'; user: Array<{ name: string; value: Expr }>; sqlMode?: Expr; timeZone?: Expr; names?: { charset: string; collation?: string } }
  | { kind: 'begin'; access?: 'READ WRITE' | 'READ ONLY' }
  | { kind: 'commit' }
  | { kind: 'rollback' };

// ─────────────────────────────────────────────────────────────────────────────────────────────
// PARSER
// ─────────────────────────────────────────────────────────────────────────────────────────────

class Parser {
  private i = 0;
  /** Set while parsing a column DEFAULT, where a following COLLATE is the column's attribute. */
  private noCollate = false;
  constructor(private readonly toks: Token[], private readonly sql: string) {}

  private peek(k = 0): Token { return this.toks[Math.min(this.i + k, this.toks.length - 1)]!; }
  private next(): Token { return this.toks[this.i++]!; }
  private atEnd(): boolean { return this.peek().kind === 'eof'; }
  private word(k = 0): string { const t = this.peek(k); return t.kind === 'ident' ? t.value.toUpperCase() : ''; }
  private isWord(w: string, k = 0): boolean { return this.word(k) === w; }
  private takeWord(w: string): boolean { if (this.isWord(w)) { this.i++; return true; } return false; }
  private expectWord(w: string): void { if (!this.takeWord(w)) this.fail(); }
  private isPunct(p: string, k = 0): boolean { const t = this.peek(k); return t.kind === 'punct' && t.value === p; }
  private takePunct(p: string): boolean { if (this.isPunct(p)) { this.i++; return true; } return false; }
  private expectPunct(p: string): void { if (!this.takePunct(p)) this.fail(); }
  private fail(): never { const t = this.peek(); throw parseError(t.pos, this.sql.slice(Math.max(0, t.pos - 1), t.pos - 1 + 24).trim()); }

  private identifier(): string {
    const t = this.peek();
    if (t.kind === 'quoted-ident') { this.i++; return t.value; }
    if (t.kind === 'ident') { this.i++; return t.value; }
    this.fail();
  }

  /** A charset or collation name: an identifier or a quoted string (`COLLATE 'utf8mb4_bin'`). */
  private charsetName(): string {
    const t = this.peek();
    if (t.kind === 'string') { this.i++; return t.value.toLowerCase(); }
    return this.identifier().toLowerCase();
  }

  /** A table reference, with the `db.table` qualifier tolerated and dropped (one schema per twin). */
  private tableName(): string {
    return this.tableRef().name;
  }

  /** A table reference keeping its schema qualifier — how a SELECT names `INFORMATION_SCHEMA.X`. */
  private tableRef(): { name: string; schema?: string } {
    const first = this.identifier();
    if (this.isPunct('.')) { this.i++; return { schema: first, name: this.identifier() }; }
    return { name: first };
  }

  /** The optional alias after a table reference in FROM/JOIN. */
  private tableAlias(): string | undefined {
    if (this.takeWord('AS')) return this.identifier();
    if (this.peek().kind === 'quoted-ident' || (this.peek().kind === 'ident' && !RESERVED_AFTER_ITEM.has(this.word()))) return this.identifier();
    return undefined;
  }

  statement(): Statement {
    const w = this.word();
    switch (w) {
      case 'SELECT': return this.select();
      case 'INSERT': case 'REPLACE': return this.insert();
      case 'UPDATE': return this.update();
      case 'DELETE': return this.delete();
      case 'CREATE': return this.createTable();
      case 'DROP': return this.dropTable();
      case 'ALTER': return this.alterTable();
      case 'TRUNCATE': return this.truncate();
      case 'SHOW': return this.show();
      case 'DESCRIBE': case 'DESC': case 'EXPLAIN': {
        this.i++;
        // `EXPLAIN <statement>` is a REAL and commonly-used Vitess surface, and it is NOT the
        // single-table `DESCRIBE` this branch models. §9 round one: `EXPLAIN SELECT * FROM t` used
        // to be parsed as `DESCRIBE SELECT` and answered a confidently wrong errno 1146
        // ("Table 'twin.SELECT' doesn't exist"). Refuse it as unmodeled instead
        // (planetscale.select.explain is the filed todo).
        // Any EXPLAIN form other than the bare `EXPLAIN <table>` (which is DESCRIBE's synonym) is
        // filed surface, so it takes the `unsupported:` channel. §9 round two, finding 8, caught
        // the residue — REPLACE / FOR CONNECTION / TABLE still answered 1064.
        //
        // ONE guard, deliberately. The first version wrote the condition twice, and the revert
        // matrix then read the cell as HOLLOW: deleting one line left the other still refusing, so
        // the matrix was measuring a guard the pin does not depend on. A duplicated invariant is a
        // cell you cannot attribute.
        if (w === 'EXPLAIN') {
          const next = this.peek();
          const isBareTable = next.kind === 'quoted-ident'
            || (next.kind === 'ident' && !EXPLAIN_STATEMENT_WORDS.has(this.word()));
          if (!isBareTable) throw unsupported('EXPLAIN <statement> / EXPLAIN ANALYZE');
        }
        const table = this.tableName();
        // …and the trailing junk must be rejected, not silently ignored: `DESCRIBE t and junk`
        // used to be accepted because this branch returned without calling `finish()`.
        this.finish();
        return { kind: 'describe', table };
      }
      case 'SET': return this.setStatement();
      case 'BEGIN': this.i++; this.takeWord('WORK'); this.finish(); return { kind: 'begin' };
      case 'START': {
        this.i++; this.expectWord('TRANSACTION');
        // START TRANSACTION's characteristics: WITH CONSISTENT SNAPSHOT, and the access mode, which
        // the store holds for the transaction (a write in a READ ONLY one is errno 1792).
        let access: 'READ WRITE' | 'READ ONLY' | undefined;
        if (!this.atEnd() && !this.isPunct(';')) {
          do {
            if (this.takeWord('WITH')) { this.expectWord('CONSISTENT'); this.expectWord('SNAPSHOT'); continue; }
            this.expectWord('READ');
            if (this.takeWord('ONLY')) access = 'READ ONLY'; else { this.expectWord('WRITE'); access = 'READ WRITE'; }
          } while (this.takePunct(','));
        }
        this.finish();
        return { kind: 'begin', ...(access !== undefined ? { access } : {}) };
      }
      case 'COMMIT': this.i++; this.takeWord('WORK'); return { kind: 'commit' };
      case 'ROLLBACK': this.i++; this.takeWord('WORK'); return { kind: 'rollback' };
      case '': throw parseError(this.peek().pos, '');
      // "TABLE is a DML statement … which returns rows and columns of the named table" (manual 15.2.16): it is
      // SELECT * FROM the table, with the same ORDER BY and LIMIT
      case 'TABLE': {
        this.i++;
        const table = this.tableRef();
        const rest = this.sql.slice(this.peek().pos - 1).trim();
        if (rest !== '' && rest !== ';' && !/^(ORDER\s+BY|LIMIT)\b/i.test(rest)) this.fail();
        return parseStatement(`SELECT * FROM ${table.schema !== undefined ? `\`${table.schema}\`.` : ''}\`${table.name}\` ${rest}`);
      }
      default: throw unsupported(`this twin does not model the ${w} statement`);
    }
  }

  /** `SET [SESSION|LOCAL] TRANSACTION ISOLATION LEVEL … | READ WRITE | READ ONLY`. Without a scope
   *  word the characteristics apply to the NEXT transaction only; with SESSION/LOCAL to every later
   *  one in the session (MySQL 8 manual, SET TRANSACTION). Other session variables stay unmodeled. */
  private setStatement(): Statement {
    this.expectWord('SET');
    // `SET @x := 1, @y = 'a'`, `SET sql_mode = ''`, `SET SESSION sql_mode = …`, `SET @@sql_mode = …`, `SET @@session.sql_mode = …`
    // (manual 11.4 "User-Defined Variables"; 7.1.11 "Server SQL Modes": "To change the SQL mode at runtime, set the global
    // or session sql_mode system variable using a SET statement")
    const isModeWord = (k: number): boolean => ['SQL_MODE', 'TIME_ZONE', '@@SQL_MODE', '@@TIME_ZONE', '@@SESSION', '@@LOCAL'].includes(this.word(k));
    // SET NAMES charset [COLLATE collation] (manual 12.5: "sets the three session system variables character_set_client,
    // character_set_connection, and character_set_results"; the connection's collation is what a literal takes)
    if (this.takeWord('NAMES')) {
      const charset = this.takeWord('DEFAULT') ? 'utf8mb4' : this.charsetName();
      const collation = this.takeWord('COLLATE') ? this.charsetName() : undefined;
      this.finish();
      return { kind: 'set-vars', user: [], names: { charset, ...(collation !== undefined ? { collation } : {}) } };
    }
    if ((this.peek().kind === 'ident' && this.peek().value.startsWith('@')) || isModeWord(0) || ((this.isWord('SESSION') || this.isWord('LOCAL')) && ['SQL_MODE', 'TIME_ZONE'].includes(this.word(1)))) {
      const user: Array<{ name: string; value: Expr }> = [];
      let sqlMode: Expr | undefined; let timeZone: Expr | undefined;
      do {
        const t = this.peek();
        if (t.kind === 'ident' && t.value.startsWith('@') && !t.value.startsWith('@@')) {
          this.i++;
          if (!this.takePunct(':=')) this.expectPunct('=');
          user.push({ name: t.value.slice(1).toLowerCase(), value: this.expr() });
          continue;
        }
        if (this.isWord('GLOBAL') || this.word() === '@@GLOBAL') throw unsupported('SET GLOBAL');
        if (this.isWord('SESSION') || this.isWord('LOCAL')) this.i++;
        const w = this.word();
        if (w === '@@SESSION' || w === '@@LOCAL') { this.i++; this.expectPunct('.'); }
        else if (w === '@@SQL_MODE') { this.i++; sqlMode = this.assignedValue(); continue; }
        else if (w === '@@TIME_ZONE') { this.i++; if (!this.takePunct(':=')) this.expectPunct('='); timeZone = this.expr(); continue; }
        // time_zone (manual 7.1.15, "MySQL Server Time Zone Support": "SET time_zone = timezone;")
        if (this.word() === 'TIME_ZONE') { this.i++; if (!this.takePunct(':=')) this.expectPunct('='); timeZone = this.expr(); continue; }
        if (this.word() !== 'SQL_MODE') throw unsupported(`this twin does not model the SET statement for ${this.peek().value || 'this variable'}`);
        this.i++;
        sqlMode = this.assignedValue();
      } while (this.takePunct(','));
      this.finish();
      return { kind: 'set-vars', user, ...(sqlMode !== undefined ? { sqlMode } : {}), ...(timeZone !== undefined ? { timeZone } : {}) };
    }
    let scope: 'next' | 'session' = 'next';
    if (this.isWord('GLOBAL') && this.isWord('TRANSACTION', 1)) throw unsupported('SET GLOBAL TRANSACTION');
    if ((this.isWord('SESSION') || this.isWord('LOCAL')) && this.isWord('TRANSACTION', 1)) { this.i++; scope = 'session'; }
    if (!this.takeWord('TRANSACTION')) throw unsupported(`this twin does not model the SET statement for ${this.peek().value || 'this variable'}`);
    let isolation: IsolationLevel | undefined;
    let access: 'READ WRITE' | 'READ ONLY' | undefined;
    do {
      if (this.takeWord('ISOLATION')) {
        this.expectWord('LEVEL');
        if (this.takeWord('SERIALIZABLE')) isolation = 'SERIALIZABLE';
        else if (this.takeWord('REPEATABLE')) { this.expectWord('READ'); isolation = 'REPEATABLE READ'; }
        else { this.expectWord('READ'); if (this.takeWord('COMMITTED')) isolation = 'READ COMMITTED'; else { this.expectWord('UNCOMMITTED'); isolation = 'READ UNCOMMITTED'; } }
        continue;
      }
      this.expectWord('READ');
      if (this.takeWord('ONLY')) access = 'READ ONLY'; else { this.expectWord('WRITE'); access = 'READ WRITE'; }
    } while (this.takePunct(','));
    this.finish();
    return { kind: 'set-transaction', scope, ...(isolation !== undefined ? { isolation } : {}), ...(access !== undefined ? { access } : {}) };
  }

  /** The value a SET assigns: `= expr` or `:= expr`, with DEFAULT the variable's default (MySQL 8's sql_mode). */
  private assignedValue(): Expr {
    if (!this.takePunct(':=')) this.expectPunct('=');
    if (this.takeWord('DEFAULT')) return { kind: 'literal', value: SQL_MODE, hint: 'VARCHAR' };
    return this.expr();
  }

  /** `nested` is a derived table's subquery: it ends at its closing parenthesis, not at the end of the input. */
  private select(nested = false): SelectStatement {
    this.expectWord('SELECT');
    // Vitess accepts these leading modifiers; only DISTINCT changes semantics.
    const distinct = this.takeWord('DISTINCT') || this.takeWord('DISTINCTROW');
    if (!distinct) this.takeWord('ALL');
    this.takeWord('SQL_CALC_FOUND_ROWS');
    this.takeWord('SQL_NO_CACHE');
    const items: SelectItem[] = [];
    do {
      const startTok = this.peek();
      const expr = this.expr();
      const endTok = this.peek();
      const text = this.sql.slice(startTok.pos - 1, endTok.pos - 1).trim().replace(/\s+/g, ' ');
      let alias: string | undefined;
      // After AS a column alias may be a quoted string: MySQL 8.0 manual, 11.2 Schema Object Names, "In the select list
      // of a query, a quoted column alias can be specified using identifier or string quoting characters" (its example,
      // `SELECT 1 AS `one`, 2 AS 'two'`). Dub's lib/fetchers/get-network-program-counts.ts writes `AS "click"`.
      if (this.takeWord('AS')) alias = this.peek().kind === 'string' ? String(this.next().value) : this.identifier();
      else if (this.peek().kind === 'quoted-ident' || (this.peek().kind === 'ident' && !RESERVED_AFTER_ITEM.has(this.word()))) alias = this.identifier();
      items.push({ expr, text, ...(alias !== undefined ? { alias } : {}) });
    } while (this.takePunct(','));

    let from: FromItem[] | undefined;
    if (this.takeWord('FROM')) {
      from = [];
      do { from.push(this.fromItem()); } while (this.takePunct(','));
    }
    const where = this.takeWord('WHERE') ? this.expr() : undefined;
    let groupBy: Expr[] | undefined;
    if (this.takeWord('GROUP')) {
      this.expectWord('BY');
      groupBy = [];
      do { groupBy.push(this.expr()); } while (this.takePunct(','));
      if (this.isWord('WITH')) throw unsupported('GROUP BY … WITH ROLLUP');
    }
    const having = this.takeWord('HAVING') ? this.expr() : undefined;
    if (this.isWord('WINDOW')) throw unsupported('the WINDOW clause');
    const order = this.orderBy();
    const { limit, offset } = this.limitClause();
    let lock: 'update' | 'share' | undefined;
    if (this.takeWord('FOR')) {
      if (this.takeWord('UPDATE')) lock = 'update'; else { this.expectWord('SHARE'); lock = 'share'; }
      if (this.isWord('OF') || this.isWord('NOWAIT') || this.isWord('SKIP')) throw unsupported(`FOR ${lock.toUpperCase()} ${this.word()}`);
    } else if (this.takeWord('LOCK')) {
      this.expectWord('IN'); this.expectWord('SHARE'); this.expectWord('MODE'); lock = 'share';
    }
    // Set operations are UNMODELED SURFACE, not a syntax error. §9 round one: `SELECT 1 UNION
    // SELECT 2` used to answer errno 1064 even though `planetscale.select.union` is a filed todo —
    // so the pack knew the surface exists and still told the caller their SQL was malformed.
    if (this.isWord('UNION') || this.isWord('INTERSECT') || this.isWord('EXCEPT')) throw unsupported(`the ${this.word()} set operation`);
    if (!nested) this.finish();
    return {
      kind: 'select', items, order,
      ...(distinct ? { distinct } : {}),
      ...(from !== undefined ? { from } : {}),
      ...(where !== undefined ? { where } : {}),
      ...(groupBy !== undefined ? { groupBy } : {}),
      ...(having !== undefined ? { having } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {}),
      ...(lock !== undefined ? { lock } : {}),
    };
  }

  /** One table factor: a (possibly schema-qualified) table with its alias, or a derived table. */
  private tableFactor(): TableFactor {
    if (this.takePunct('(')) {
      if (!this.isWord('SELECT')) throw unsupported('parenthesised table references');
      const derived = this.select(true);
      this.expectPunct(')');
      const alias = this.tableAlias();
      // MySQL's own refusal, verbatim: a derived table is a table and every table in FROM has a name.
      if (alias === undefined) throw new SqlError('Every derived table must have its own alias', 'INVALID_ARGUMENT', 1248, '42000');
      return { derived, alias };
    }
    const ref = this.tableRef();
    // A PARTITION selector or an index hint sits between the table name and its alias. They are
    // unmodeled surface, and §9 round one caught them being swallowed as the ALIAS and then
    // reported as a bare syntax error — a confidently wrong answer to legal MySQL an ORM emits.
    if (this.isWord('PARTITION')) throw unsupported('PARTITION (…) selection');
    if (this.isWord('FORCE') || this.isWord('USE') || this.isWord('IGNORE')) throw unsupported('index hints (FORCE/USE/IGNORE INDEX)');
    const alias = this.tableAlias();
    if (this.isWord('PARTITION')) throw unsupported('PARTITION (…) selection');
    if (this.isWord('FORCE') || this.isWord('USE') || this.isWord('IGNORE')) throw unsupported('index hints (FORCE/USE/IGNORE INDEX)');
    return { table: ref.name, ...(ref.schema !== undefined ? { schema: ref.schema } : {}), ...(alias !== undefined ? { alias } : {}) };
  }

  /** A FROM item: a table factor and its chain of `[INNER|CROSS] JOIN` / `LEFT [OUTER] JOIN`. */
  private fromItem(): FromItem {
    const factor = this.tableFactor();
    const joins: JoinClause[] = [];
    for (;;) {
      let kind: JoinClause['kind'];
      if (this.isWord('JOIN') || this.isWord('STRAIGHT_JOIN')) { this.i++; kind = 'inner'; }
      else if ((this.isWord('INNER') || this.isWord('CROSS')) && this.isWord('JOIN', 1)) { this.i += 2; kind = 'inner'; }
      else if (this.isWord('LEFT') && this.isWord('JOIN', 1)) { this.i += 2; kind = 'left'; }
      else if (this.isWord('LEFT') && this.isWord('OUTER', 1) && this.isWord('JOIN', 2)) { this.i += 3; kind = 'left'; }
      else if (this.isWord('RIGHT') || this.isWord('NATURAL')) throw unsupported(`${this.word()} JOIN`);
      else break;
      const joined = this.tableFactor();
      if (this.isWord('USING')) throw unsupported('JOIN … USING (…)');
      // `[INNER|CROSS] JOIN` without ON is a cross join in MySQL; LEFT JOIN requires its condition.
      const on = this.takeWord('ON') ? this.expr() : undefined;
      if (on === undefined && kind === 'left') this.fail();
      joins.push({ kind, factor: joined, ...(on !== undefined ? { on } : {}) });
    }
    return { factor, joins };
  }

  private orderBy(): OrderTerm[] {
    const order: OrderTerm[] = [];
    if (this.takeWord('ORDER')) {
      this.expectWord('BY');
      do {
        const expr = this.expr();
        let desc = false;
        if (this.takeWord('DESC')) desc = true; else this.takeWord('ASC');
        order.push({ expr, desc });
      } while (this.takePunct(','));
    }
    return order;
  }

  private limitClause(): { limit?: number; offset?: number } {
    if (!this.takeWord('LIMIT')) return {};
    const first = this.intLiteral();
    if (this.takePunct(',')) return { limit: this.intLiteral(), offset: first };
    if (this.takeWord('OFFSET')) return { limit: first, offset: this.intLiteral() };
    return { limit: first };
  }

  private intLiteral(): number {
    const t = this.peek();
    if (t.kind !== 'number' || !/^\d+$/.test(t.value)) this.fail();
    this.i++;
    return Number(t.value);
  }

  private finish(): void {
    this.takePunct(';');
    if (!this.atEnd()) this.fail();
  }

  private insert(): Statement {
    const replace = this.isWord('REPLACE');
    if (replace) throw unsupported('REPLACE INTO');
    this.expectWord('INSERT');
    const ignore = this.takeWord('IGNORE');
    if (this.isWord('LOW_PRIORITY') || this.isWord('DELAYED') || this.isWord('HIGH_PRIORITY')) throw unsupported('INSERT priority modifiers');
    this.expectWord('INTO');
    const table = this.tableName();
    const columns: string[] = [];
    if (this.takePunct('(')) {
      do { columns.push(this.identifier()); } while (this.takePunct(','));
      this.expectPunct(')');
    }
    if (this.isWord('SELECT')) throw unsupported('INSERT … SELECT');
    const rows: Expr[][] = [];
    // `INSERT INTO t SET col = expr, …` (manual 15.2.7: "INSERT … SET" names each column with its value), one row
    if (columns.length === 0 && this.takeWord('SET')) {
      const vals: Expr[] = [];
      do { columns.push(this.identifier()); this.expectPunct('='); vals.push(this.expr()); } while (this.takePunct(','));
      rows.push(vals);
    } else {
      if (!this.takeWord('VALUES') && !this.takeWord('VALUE')) this.fail();
      do {
        // a row may be written ROW(…), the VALUES statement's row constructor (manual 15.2.7: "VALUES ROW(…), ROW(…)")
        this.takeWord('ROW');
        this.expectPunct('(');
        const vals: Expr[] = [];
        if (!this.isPunct(')')) { do { vals.push(this.expr()); } while (this.takePunct(',')); }
        this.expectPunct(')');
        rows.push(vals);
      } while (this.takePunct(','));
    }
    // `VALUES (…) AS alias [(col_alias, …)]`: the row alias ON DUPLICATE KEY UPDATE reads the new
    // row through (MySQL 8.0.19+, the replacement for VALUES(col)).
    let alias: string | undefined; let aliasColumns: string[] | undefined;
    if (this.takeWord('AS')) {
      alias = this.identifier();
      if (this.takePunct('(')) {
        aliasColumns = [];
        do { aliasColumns.push(this.identifier()); } while (this.takePunct(','));
        this.expectPunct(')');
      }
    }
    let onDuplicate: Array<{ column: string; value: Expr }> | undefined;
    if (this.takeWord('ON')) {
      this.expectWord('DUPLICATE');
      this.expectWord('KEY');
      this.expectWord('UPDATE');
      onDuplicate = [];
      do {
        const column = this.identifier();
        this.expectPunct('=');
        onDuplicate.push({ column, value: this.expr() });
      } while (this.takePunct(','));
    }
    this.finish();
    return {
      kind: 'insert', table, columns, rows, ignore, ...(onDuplicate !== undefined ? { onDuplicate } : {}),
      ...(alias !== undefined ? { alias } : {}), ...(aliasColumns !== undefined ? { aliasColumns } : {}),
    };
  }

  private update(): Statement {
    this.expectWord('UPDATE');
    // UPDATE [LOW_PRIORITY] [IGNORE] …: modifiers this engine does not model (IGNORE changes which errors stop a row)
    if (this.isWord('LOW_PRIORITY') || this.isWord('IGNORE')) throw unsupported(`UPDATE ${this.isWord('IGNORE') ? 'IGNORE' : 'LOW_PRIORITY'}`);
    // MySQL's multiple-table form, `UPDATE table_references SET assignment_list [WHERE where_condition]` (8.0 manual,
    // 15.2.17): table references with joins, commas or aliases, and assignments naming their table
    const start = this.i;
    const first = this.fromItem();
    // One table under an alias is still the single-table form (it takes ORDER BY and LIMIT); joins or a comma make
    // it the multiple-table form.
    if (first.joins.length > 0 || this.isPunct(',')) {
      const from = [first];
      while (this.takePunct(',')) from.push(this.fromItem());
      this.expectWord('SET');
      const set: Array<{ table?: string; column: string; value: Expr }> = [];
      do {
        const name = this.identifier();
        const qualified = this.takePunct('.') ? { table: name, column: this.identifier() } : { column: name };
        this.expectPunct('=');
        set.push({ ...qualified, value: this.expr() });
      } while (this.takePunct(','));
      const where = this.takeWord('WHERE') ? this.expr() : undefined;
      // "For the multiple-table syntax, ORDER BY and LIMIT cannot be used": MySQL's ER_WRONG_USAGE, 1221, "Incorrect
      // usage of %s and %s" (server error reference), naming UPDATE and the clause
      if (this.isWord('ORDER') || this.isWord('LIMIT')) throw new SqlError(`Incorrect usage of UPDATE and ${this.isWord('ORDER') ? 'ORDER BY' : 'LIMIT'}`, 'INVALID_ARGUMENT', 1221, 'HY000');
      this.finish();
      return { kind: 'update-multi', from, set, ...(where !== undefined ? { where } : {}) };
    }
    this.i = start;
    const table = this.tableName();
    const alias = this.takeWord('AS') ? this.identifier() : this.isWord('SET') ? undefined : this.identifier();
    this.expectWord('SET');
    const set: Array<{ table?: string; column: string; value: Expr }> = [];
    do {
      const name = this.identifier();
      const qualified = this.takePunct('.') ? { table: name, column: this.identifier() } : { column: name };
      this.expectPunct('=');
      set.push({ ...qualified, value: this.expr() });
    } while (this.takePunct(','));
    const where = this.takeWord('WHERE') ? this.expr() : undefined;
    const order = this.orderBy();
    const { limit } = this.limitClause();
    this.finish();
    return { kind: 'update', table, ...(alias !== undefined ? { alias } : {}), set, order, ...(where !== undefined ? { where } : {}), ...(limit !== undefined ? { limit } : {}) };
  }

  private delete(): Statement {
    this.expectWord('DELETE');
    this.expectWord('FROM');
    const table = this.tableName();
    const where = this.takeWord('WHERE') ? this.expr() : undefined;
    const order = this.orderBy();
    const { limit } = this.limitClause();
    this.finish();
    return { kind: 'delete', table, order, ...(where !== undefined ? { where } : {}), ...(limit !== undefined ? { limit } : {}) };
  }

  private truncate(): Statement {
    this.expectWord('TRUNCATE');
    this.takeWord('TABLE');
    const table = this.tableName();
    this.finish();
    return { kind: 'truncate', table };
  }

  private show(): Statement {
    this.expectWord('SHOW');
    if (this.takeWord('WARNINGS')) { this.finish(); return { kind: 'show-warnings' }; }
    if (this.isWord('CREATE') && this.isWord('TABLE', 1)) { this.i += 2; const table = this.tableName(); this.finish(); return { kind: 'show-create-table', table }; }
    if (this.takeWord('TABLES')) {
      if (this.isWord('FROM') || this.isWord('IN')) { this.i++; this.tableName(); }
      if (this.isWord('LIKE') || this.isWord('WHERE')) throw unsupported('SHOW TABLES LIKE/WHERE');
      this.finish();
      return { kind: 'show-tables' };
    }
    if (this.takeWord('COLUMNS') || this.takeWord('FIELDS')) {
      if (!this.takeWord('FROM') && !this.takeWord('IN')) this.fail();
      const table = this.tableName();
      this.finish();
      return { kind: 'describe', table };
    }
    throw unsupported(`SHOW ${this.word() || '<unknown>'}`);
  }

  private createTable(): Statement {
    this.expectWord('CREATE');
    // source: https://planetscale.com/docs/reference/mysql-compatibility "You cannot CREATE a logical database within a PlanetScale Vitess database."
    if (this.isWord('DATABASE') || this.isWord('SCHEMA')) throw unsupported('CREATE DATABASE — a PlanetScale branch already IS the database');
    if (this.isWord('INDEX') || this.isWord('UNIQUE') || this.isWord('VIEW') || this.isWord('TEMPORARY')) throw unsupported(`CREATE ${this.word()}`);
    this.expectWord('TABLE');
    let ifNotExists = false;
    if (this.takeWord('IF')) { this.expectWord('NOT'); this.expectWord('EXISTS'); ifNotExists = true; }
    const table = this.tableName();
    if (this.isWord('LIKE')) throw unsupported('CREATE TABLE … LIKE');
    // `CREATE TABLE t [AS] SELECT …` (manual 15.1.20.4, "CREATE TABLE ... SELECT Statement"): a table of the query's
    // columns holding its rows
    if (this.isWord('AS') || this.isWord('SELECT')) { this.takeWord('AS'); return { kind: 'create-table-select', table, ifNotExists, select: this.select() }; }
    this.expectPunct('(');
    const columns: ColumnDef[] = [];
    const primaryKey: string[] = [];
    const uniques: TableDef['uniques'] = [];
    const indexes: IndexDef[] = [];
    const parts = (): IndexPart[] => {
      this.expectPunct('(');
      const out: IndexPart[] = [];
      do { out.push(this.indexedColumn()); } while (this.takePunct(','));
      this.expectPunct(')');
      return out;
    };
    const indexName = (): string | undefined => (this.peek().kind === 'punct' ? undefined : this.identifier());
    do {
      if (this.isWord('PRIMARY')) {
        this.i++; this.expectWord('KEY');
        primaryKey.push(...parts().map((p) => p.name));
        continue;
      }
      if (this.isWord('UNIQUE')) {
        this.i++; this.takeWord('KEY') || this.takeWord('INDEX');
        const name = indexName();
        const cols = parts();
        uniques.push({ name: name ?? cols[0]!.name, columns: cols.map((p) => p.name), parts: cols });
        continue;
      }
      if (this.isWord('KEY') || this.isWord('INDEX') || this.isWord('FULLTEXT')) {
        // A non-unique secondary (or FULLTEXT) index changes access paths, not results. This engine
        // has one access path (a scan), so the declaration is recorded for the catalog
        // (INFORMATION_SCHEMA.STATISTICS) and changes nothing else. MATCH … AGAINST stays unmodeled.
        const type = this.isWord('FULLTEXT') ? 'FULLTEXT' : 'BTREE';
        this.i++;
        if (type === 'FULLTEXT') this.takeWord('KEY') || this.takeWord('INDEX');
        const name = indexName();
        const cols = parts();
        indexes.push({ name: name ?? cols[0]!.name, columns: cols, type });
        continue;
      }
      if (this.isWord('CONSTRAINT') || this.isWord('FOREIGN') || this.isWord('CHECK') || this.isWord('SPATIAL')) {
        throw unsupported(`the ${this.word()} table constraint`);
      }
      columns.push(this.columnDef());
    } while (this.takePunct(','));
    this.expectPunct(')');
    // Trailing table options. The default charset and collation are recorded for the catalog;
    // the rest (ENGINE=…, AUTO_INCREMENT=…, ROW_FORMAT=…) are consumed, since the storage engine
    // is not observable through this protocol.
    let charset: string | undefined; let collation: string | undefined;
    while (!this.atEnd() && !this.isPunct(';')) {
      if (this.isWord('CHARACTER') && this.isWord('SET', 1)) { this.i += 2; this.takePunct('='); charset = this.charsetName(); continue; }
      if (this.isWord('CHARSET')) { this.i++; this.takePunct('='); charset = this.charsetName(); continue; }
      if (this.isWord('COLLATE')) { this.i++; this.takePunct('='); collation = this.charsetName(); continue; }
      this.i++;
    }
    this.finish();
    // MySQL resolves every character column's collation when the table is created (10.3.4, 10.3.5):
    // the table's from its own clauses or the database default, each column's from its own or the table's.
    const resolved = resolveCharsetCollation(charset, collation) ?? { charset: 'utf8mb4', collation: databaseCollation().name };
    charset = resolved.charset; collation = resolved.collation;
    for (let k = 0; k < columns.length; k++) columns[k] = resolveColumnCollation(columns[k]!, resolved);
    for (const name of primaryKey) {
      const col = columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (col === undefined) throw new SqlError(`Key column '${name}' doesn't exist in table`, 'INVALID_ARGUMENT', 1072, '42000');
      col.primaryKey = true;
      col.nullable = false; // MySQL implicitly makes a PRIMARY KEY column NOT NULL
    }
    for (const u of uniques) {
      for (const name of u.columns) {
        const col = columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
        if (col === undefined) throw new SqlError(`Key column '${name}' doesn't exist in table`, 'INVALID_ARGUMENT', 1072, '42000');
        // Only a SINGLE-column UNIQUE makes its column unique on its own. A composite UNIQUE (a, b)
        // constrains the pair: marking each column unique would refuse (1, 2) after (1, 1).
        if (u.columns.length === 1) col.unique = true;
      }
    }
    for (const index of indexes) {
      for (const part of index.columns) {
        if (!columns.some((c) => c.name.toLowerCase() === part.name.toLowerCase())) throw new SqlError(`Key column '${part.name}' doesn't exist in table`, 'INVALID_ARGUMENT', 1072, '42000');
      }
    }
    for (const col of columns) {
      if (col.primaryKey && !primaryKey.some((n) => n.toLowerCase() === col.name.toLowerCase())) primaryKey.push(col.name);
    }
    return { kind: 'create-table', table, ifNotExists, columns, primaryKey, uniques, indexes,
      ...(charset !== undefined ? { charset } : {}), ...(collation !== undefined ? { collation } : {}) };
  }

  /** An index column reference, with MySQL's optional prefix length and direction. */
  private indexedColumn(): IndexPart {
    const name = this.identifier();
    let length: number | undefined;
    if (this.takePunct('(')) { length = this.intLiteral(); this.expectPunct(')'); }
    const desc = this.takeWord('DESC');
    if (!desc) this.takeWord('ASC');
    return { name, ...(length !== undefined ? { length } : {}), ...(desc ? { desc } : {}) };
  }

  private columnDef(): ColumnDef {
    const name = this.identifier();
    const typeTok = this.peek();
    if (typeTok.kind !== 'ident') this.fail();
    this.i++;
    const dataType = typeTok.value.toUpperCase();
    let length: number | null = null;
    let rendered = typeTok.value.toLowerCase();
    if (this.takePunct('(')) {
      if (dataType === 'ENUM' || dataType === 'SET') {
        const members: string[] = [];
        do {
          const t = this.peek();
          if (t.kind !== 'string') this.fail();
          this.i++;
          members.push(`'${t.value}'`);
        } while (this.takePunct(','));
        rendered += `(${members.join(',')})`;
      } else {
        const first = this.intLiteral();
        length = first;
        let text = String(first);
        if (this.takePunct(',')) text += `,${this.intLiteral()}`;
        rendered += `(${text})`;
      }
      this.expectPunct(')');
    }
    let unsigned = false;
    let nullable = true;
    let defaultValue: Cell | undefined;
    let defaultIsBinaryLiteral = false;
    let defaultLiteral: ColumnDef['defaultLiteral'];
    let defaultCurrentTimestamp: number | undefined;
    let hasDefault = false;
    let autoIncrement = false;
    let primaryKey = false;
    let unique = false;
    let charset: string | undefined; let collation: string | undefined; let binaryAttribute = false;
    for (;;) {
      if (this.takeWord('UNSIGNED')) { unsigned = true; rendered += ' unsigned'; continue; }
      if (this.takeWord('SIGNED')) continue;
      if (this.takeWord('ZEROFILL')) continue;
      if (this.takeWord('CHARACTER')) { this.expectWord('SET'); charset = this.charsetName(); continue; }
      if (this.takeWord('CHARSET')) { charset = this.charsetName(); continue; }
      if (this.takeWord('COLLATE')) { collation = this.charsetName(); continue; }
      if (this.takeWord('BINARY')) { binaryAttribute = true; continue; }
      if (this.takeWord('COMMENT')) { const t = this.peek(); if (t.kind !== 'string') this.fail(); this.i++; continue; }
      if (this.isWord('NOT') && this.isWord('NULL', 1)) { this.i += 2; nullable = false; continue; }
      if (this.isWord('NULL')) { this.i++; nullable = true; continue; }
      if (this.takeWord('AUTO_INCREMENT')) { autoIncrement = true; continue; }
      if (this.isWord('PRIMARY') && this.isWord('KEY', 1)) { this.i += 2; primaryKey = true; continue; }
      // A bare `KEY` in a COLUMN definition is MySQL's synonym for PRIMARY KEY. §9 round one found
      // this branch empty behind a comment claiming it was implemented, so `CREATE TABLE k (id INT
      // KEY)` answered a syntax error. (In a TABLE-level constraint `KEY` means a non-unique index
      // instead — that is the separate branch above, which runs first.)
      if (this.takeWord('KEY')) { primaryKey = true; continue; }
      if (this.takeWord('UNIQUE')) { this.takeWord('KEY'); unique = true; continue; }
      if (this.takeWord('DEFAULT')) {
        hasDefault = true;
        if (this.takeWord('NULL')) { defaultValue = null; continue; }
        if (this.isWord('CURRENT_TIMESTAMP') || this.isWord('NOW') || this.isWord('LOCALTIME') || this.isWord('LOCALTIMESTAMP')) {
          // A server-evaluated default. It is read at insert time from the World clock the store
          // passes in (`ExecOptions.now`), never from the wall clock. MySQL requires the default's
          // precision to match the column's (errno 1067 otherwise).
          const word = this.word(); this.i++;
          let fsp = 0;
          if (this.takePunct('(')) { if (!this.isPunct(')')) fsp = this.intLiteral(); this.expectPunct(')'); }
          else if (word === 'NOW') this.fail();
          const columnFsp = length ?? 0;
          if (!['DATETIME', 'TIMESTAMP'].includes(dataType) || fsp !== columnFsp) throw new SqlError(`Invalid default value for '${name}'`, 'INVALID_ARGUMENT', 1067, '42000');
          defaultCurrentTimestamp = fsp;
          continue;
        }
        this.noCollate = true;
        const parenthesised = this.isPunct('(');
        let defaultExpr: Expr;
        try { defaultExpr = this.expr(); } finally { this.noCollate = false; }
        defaultIsBinaryLiteral = defaultExpr.kind === 'literal' && defaultExpr.hint === 'VARBINARY';
        defaultValue = literalCell(defaultExpr);
        const literal = defaultExpr.kind === 'unary' ? defaultExpr.arg : defaultExpr;
        defaultLiteral = parenthesised ? 'expression' : literal.kind === 'literal' && literal.hint !== 'VARCHAR' && literal.hint !== 'VARBINARY' ? 'number' : 'string';
        continue;
      }
      if (this.takeWord('ON')) { this.expectWord('UPDATE'); throw unsupported('ON UPDATE CURRENT_TIMESTAMP'); }
      if (this.isWord('GENERATED') || this.isWord('AS') || this.isWord('VIRTUAL') || this.isWord('STORED')) throw unsupported('generated columns');
      break;
    }
    if (autoIncrement) nullable = false;
    // The DECLARED charset/collation; `resolveColumnCollations` settles them against the table's.
    const declared = {
      ...(charset !== undefined ? { charset } : {}), ...(collation !== undefined ? { collation } : {}),
      ...(binaryAttribute ? { binaryAttribute } : {}),
    };
    if (defaultCurrentTimestamp !== undefined) {
      return { name, dataType, columnType: rendered, length, unsigned, nullable, defaultCurrentTimestamp, autoIncrement, primaryKey, unique, ...declared };
    }
    return {
      name, dataType, columnType: rendered, length, unsigned, nullable,
      ...(hasDefault ? { defaultValue, defaultIsBinaryLiteral, ...(defaultLiteral !== undefined ? { defaultLiteral } : {}) } : {}),
      autoIncrement, primaryKey, unique, ...declared,
    };
  }

  /** `ALTER TABLE t ADD [COLUMN] col_def [FIRST | AFTER col], …` (MySQL 8.0 manual, 15.1.9 ALTER TABLE: "To add a column at
   *  a specific position within a table row, use FIRST or AFTER col_name. The default is to add the column last.").
   *  Every other alteration (DROP, MODIFY, CHANGE, RENAME, ADD INDEX, …) is unmodeled and refused as such. */
  private alterTable(): Statement {
    this.expectWord('ALTER');
    if (!this.takeWord('TABLE')) throw unsupported(`ALTER ${this.word() || '<unknown>'}`);
    const table = this.tableName();
    if (this.word() === 'DROP') {
      // `DROP [COLUMN] c, …` (MySQL 8.0 manual, 15.1.9: "DROP [COLUMN] col_name"); a DROP of an index, key or constraint,
      // and a statement that mixes drops with other alterations, are unmodeled
      const drops: string[] = [];
      do {
        if (!this.takeWord('DROP')) throw unsupported(`ALTER TABLE … DROP mixed with ${this.word() || '<unknown>'}`);
        if (['INDEX', 'KEY', 'PRIMARY', 'FOREIGN', 'CONSTRAINT', 'CHECK', 'PARTITION'].includes(this.word())) throw unsupported(`ALTER TABLE … DROP ${this.word()}`);
        this.takeWord('COLUMN');
        drops.push(this.identifier());
      } while (this.takePunct(','));
      this.finish();
      return { kind: 'alter-drop-columns', table, drops };
    }
    const adds: Array<{ column: ColumnDef; first?: boolean; after?: string }> = [];
    do {
      if (!this.takeWord('ADD')) throw unsupported(`ALTER TABLE … ${this.word() || '<unknown>'}`);
      if (this.isPunct('(')) throw unsupported('ALTER TABLE … ADD (col_def, …)');
      this.takeWord('COLUMN');
      if (['INDEX', 'KEY', 'UNIQUE', 'PRIMARY', 'CONSTRAINT', 'FOREIGN', 'FULLTEXT', 'SPATIAL', 'CHECK', 'PARTITION'].includes(this.word())) throw unsupported(`ALTER TABLE … ADD ${this.word()}`);
      const column = this.columnDef();
      if (this.takeWord('FIRST')) adds.push({ column, first: true });
      else if (this.takeWord('AFTER')) adds.push({ column, after: this.identifier() });
      else adds.push({ column });
    } while (this.takePunct(','));
    this.finish();
    return { kind: 'alter-add-columns', table, adds };
  }

  private dropTable(): Statement {
    this.expectWord('DROP');
    if (!this.takeWord('TABLE')) throw unsupported(`DROP ${this.word() || '<unknown>'}`);
    let ifExists = false;
    if (this.takeWord('IF')) { this.expectWord('EXISTS'); ifExists = true; }
    const table = this.tableName();
    if (this.takePunct(',')) throw unsupported('DROP TABLE with more than one table');
    this.finish();
    return { kind: 'drop-table', table, ifExists };
  }

  // ── expressions (precedence climbing) ──────────────────────────────────────────────────────

  expr(): Expr { return this.orExpr(); }

  // MySQL 8 operator precedence, lowest first (manual 15.4.1 "Operator Precedence"): OR / ||, XOR,
  // AND / &&, NOT, the comparisons (= <=> >= > <= < <> != IS LIKE IN MEMBER OF BETWEEN), |, &,
  // << >>, + -, * / DIV % MOD, ^, unary - ~ and !.
  private orExpr(): Expr {
    let left = this.xorExpr();
    while (this.isWord('OR') || this.isPunct('||')) { this.i++; left = { kind: 'binary', op: 'OR', left, right: this.xorExpr() }; }
    return left;
  }
  private xorExpr(): Expr {
    let left = this.andExpr();
    while (this.isWord('XOR')) { this.i++; left = { kind: 'binary', op: 'XOR', left, right: this.andExpr() }; }
    return left;
  }
  private andExpr(): Expr {
    let left = this.notExpr();
    while (this.isWord('AND') || this.isPunct('&&')) { this.i++; left = { kind: 'binary', op: 'AND', left, right: this.notExpr() }; }
    return left;
  }
  private notExpr(): Expr {
    if (this.takeWord('NOT')) return { kind: 'unary', op: 'NOT', arg: this.notExpr() };
    return this.comparison();
  }
  private comparison(): Expr {
    let left = this.bitOr();
    for (;;) {
      if (this.isWord('IS')) {
        this.i++;
        const negated = this.takeWord('NOT');
        if (this.takeWord('NULL')) { left = { kind: 'isnull', arg: left, negated }; continue; }
        const value = (['TRUE', 'FALSE', 'UNKNOWN'] as const).find((v) => this.isWord(v));
        if (value === undefined) this.fail();
        this.i++;
        left = { kind: 'is', arg: left, value, negated };
        continue;
      }
      if (this.isWord('MEMBER') && this.isWord('OF', 1)) {
        this.i += 2; this.expectPunct('(');
        const doc = this.expr(); this.expectPunct(')');
        left = { kind: 'member', arg: left, doc };
        continue;
      }
      let negated = false;
      if (this.isWord('NOT') && (this.isWord('IN', 1) || this.isWord('LIKE', 1) || this.isWord('BETWEEN', 1))) { this.i++; negated = true; }
      if (this.takeWord('IN')) {
        this.expectPunct('(');
        if (this.isWord('SELECT')) {
          const subquery = this.select(true);
          this.expectPunct(')');
          left = { kind: 'in', arg: left, list: [], negated, subquery };
          continue;
        }
        const list: Expr[] = [];
        if (!this.isPunct(')')) { do { list.push(this.expr()); } while (this.takePunct(',')); }
        this.expectPunct(')');
        left = { kind: 'in', arg: left, list, negated };
        continue;
      }
      if (this.takeWord('LIKE')) {
        const pattern = this.bitOr();
        const escape = this.takeWord('ESCAPE') ? this.bitOr() : undefined;
        left = { kind: 'like', arg: left, pattern, negated, ...(escape !== undefined ? { escape } : {}) };
        continue;
      }
      if (this.takeWord('BETWEEN')) {
        const low = this.bitOr();
        this.expectWord('AND');
        const high = this.bitOr();
        left = { kind: 'between', arg: left, low, high, negated };
        continue;
      }
      if (negated) this.fail();
      const t = this.peek();
      if (t.kind === 'punct' && ['=', '<', '>', '<=', '>=', '<>', '!=', '<=>'].includes(t.value)) {
        this.i++;
        if (this.isWord('SELECT')) this.fail();
        if ((this.isWord('ANY') || this.isWord('SOME') || this.isWord('ALL')) && this.isPunct('(', 1)) throw unsupported(`${this.word()} (subquery) comparisons`);
        left = { kind: 'binary', op: t.value === '<>' ? '!=' : t.value, left, right: this.bitOr() };
        continue;
      }
      return left;
    }
  }
  private bitOr(): Expr {
    let left = this.bitAnd();
    while (this.isPunct('|')) { this.i++; left = { kind: 'binary', op: '|', left, right: this.bitAnd() }; }
    return left;
  }
  private bitAnd(): Expr {
    let left = this.shift();
    while (this.isPunct('&')) { this.i++; left = { kind: 'binary', op: '&', left, right: this.shift() }; }
    return left;
  }
  private shift(): Expr {
    let left = this.additive();
    while (this.isPunct('<<') || this.isPunct('>>')) { const op = this.next().value; left = { kind: 'binary', op, left, right: this.additive() }; }
    return left;
  }
  private bitXor(): Expr {
    let left = this.unary();
    while (this.isPunct('^')) { this.i++; left = { kind: 'binary', op: '^', left, right: this.unary() }; }
    return left;
  }
  private additive(): Expr {
    let left = this.multiplicative();
    for (;;) {
      if (this.isPunct('+') || this.isPunct('-')) { const op = this.next().value; left = { kind: 'binary', op, left, right: this.multiplicative() }; continue; }
      return left;
    }
  }
  private multiplicative(): Expr {
    let left = this.bitXor();
    for (;;) {
      if (this.isPunct('*') || this.isPunct('/') || this.isPunct('%')) { const op = this.next().value; left = { kind: 'binary', op, left, right: this.bitXor() }; continue; }
      if (this.isWord('DIV') || this.isWord('MOD')) { const op = this.word() === 'DIV' ? 'DIV' : '%'; this.i++; left = { kind: 'binary', op, left, right: this.bitXor() }; continue; }
      return left;
    }
  }
  /** `expr COLLATE name` binds tighter than any operator (MySQL's `simple_expr COLLATE`). */
  private collated(): Expr {
    let e = this.primary();
    while (!this.noCollate && this.isWord('COLLATE')) {
      this.i++;
      e = { kind: 'collate', arg: e, collation: requireCollation(this.charsetName()).name };
    }
    return e;
  }
  private unary(): Expr {
    if (this.isPunct('-')) { this.i++; return { kind: 'unary', op: '-', arg: this.unary() }; }
    if (this.isPunct('~')) { this.i++; return { kind: 'unary', op: '~', arg: this.unary() }; }
    // `!` is NOT at the highest precedence: `!a = b` is `(NOT a) = b`.
    if (this.isPunct('!')) { this.i++; return { kind: 'unary', op: 'NOT', arg: this.unary() }; }
    // `BINARY expr`: MySQL's prefix cast to a binary string (what a catalog reader writes as
    // `BINARY table_name` for a byte-exact comparison). A following `,`/`)`/end is a column named binary.
    if (this.isWord('BINARY') && ['ident', 'quoted-ident', 'string', 'number', 'hex'].includes(this.peek(1).kind) || (this.isWord('BINARY') && this.isPunct('(', 1))) {
      this.i++; return { kind: 'unary', op: 'BINARY', arg: this.unary() };
    }
    if (this.isPunct('+')) { this.i++; return this.unary(); }
    return this.collated();
  }

  /** A CAST / CONVERT target type (manual 14.10 "Cast Functions and Operators"). */
  private castType(): ColumnDef {
    const w = this.word();
    if (w === '') this.fail();
    this.i++;
    const args = (): number[] => {
      if (!this.takePunct('(')) return [];
      const out = [this.intLiteral()];
      if (this.takePunct(',')) out.push(this.intLiteral());
      this.expectPunct(')');
      return out;
    };
    const varbinary = (n?: number): ColumnDef => ({ ...synthetic('', 'VARBINARY', n === undefined ? 'varbinary' : `varbinary(${n})`), length: n ?? null });
    switch (w) {
      case 'BINARY': { const [n] = args(); return varbinary(n); }
      case 'CHAR': case 'NCHAR': {
        const [n] = args();
        let collation = databaseCollation().name;
        let charset: string | undefined;
        if (this.isWord('CHARACTER') && this.isWord('SET', 1)) { this.i += 2; charset = this.charsetName(); }
        else if (this.takeWord('CHARSET')) charset = this.charsetName();
        if (charset !== undefined) {
          const cs = requireCharset(charset);
          if (cs === 'binary') return varbinary(n);
          collation = defaultCollation(cs).name;
        }
        return { ...synthetic('', 'VARCHAR', n === undefined ? 'varchar' : `varchar(${n})`), length: n ?? null, collation };
      }
      case 'DATE': return synthetic('', 'DATE', 'date');
      case 'YEAR': return synthetic('', 'YEAR', 'year');
      case 'DATETIME': case 'TIME': {
        const [fsp = 0] = args();
        if (fsp > 6) throw new SqlError(`Too-big precision ${fsp} specified for 'CAST'. Maximum is 6.`, 'INVALID_ARGUMENT', 1426, '42000');
        return synthetic('', w, `${w.toLowerCase()}${fsp > 0 ? `(${fsp})` : ''}`);
      }
      case 'DECIMAL': case 'DEC': case 'NUMERIC': {
        const [p = 10, sc = 0] = args();
        return { ...synthetic('', 'DECIMAL', `decimal(${p},${sc})`), length: p };
      }
      case 'SIGNED': if (!this.takeWord('INTEGER')) this.takeWord('INT'); return synthetic('', 'BIGINT', 'bigint');
      case 'UNSIGNED': if (!this.takeWord('INTEGER')) this.takeWord('INT'); return { ...synthetic('', 'BIGINT', 'bigint unsigned'), unsigned: true };
      case 'JSON': return synthetic('', 'JSON', 'json');
      case 'DOUBLE': this.takeWord('PRECISION'); return synthetic('', 'DOUBLE', 'double');
      case 'REAL': return synthetic('', 'DOUBLE', 'double');
      case 'FLOAT': { const [p = 0] = args(); return p > 24 ? synthetic('', 'DOUBLE', 'double') : synthetic('', 'FLOAT', 'float'); }
      default: this.i--; this.fail();
    }
  }

  private primary(): Expr {
    const t = this.peek();
    if (t.kind === 'punct' && t.value === '(') {
      this.i++;
      if (this.isWord('SELECT')) {
        const select = this.select(true);
        this.expectPunct(')');
        return { kind: 'subquery', select };
      }
      const e = this.expr();
      if (this.takePunct(',')) {
        // A row constructor: `(a, b)`. A one-element `(a)` is just a parenthesised expression.
        const items = [e];
        do { items.push(this.expr()); } while (this.takePunct(','));
        this.expectPunct(')');
        return { kind: 'row', items };
      }
      this.expectPunct(')');
      return e;
    }
    if (t.kind === 'punct' && t.value === '*') { this.i++; return { kind: 'star' }; }
    if (t.kind === 'punct' && t.value === '?') {
      // The client interpolates its own arguments before sending (dist/sanitization.js), so a `?`
      // reaching the server means the caller passed fewer args than placeholders — MySQL's own
      // parse error is the faithful answer, not a silent NULL.
      throw parseError(t.pos, '?');
    }
    if (t.kind === 'string') {
      // "Quoted strings placed next to each other are concatenated to a single string" (manual 11.1.1, String Literals)
      this.i++; let value = t.value;
      while (this.peek().kind === 'string') value += this.next().value;
      return { kind: 'literal', value, hint: 'VARCHAR' };
    }
    if (t.kind === 'number') { this.i++; return { kind: 'literal', value: t.value, hint: numberHint(t.value) }; }
    if (t.kind === 'hex') { this.i++; return { kind: 'literal', value: hexToBinaryString(t.value), hint: 'VARBINARY', hex: true }; }
    if (t.kind === 'quoted-ident') { this.i++; return this.jsonPath(this.columnOrQualified(t.value)); }
    // an introducer before a hexadecimal or bit-value literal (`_binary X'40'`) makes it a binary string in every context
    // (manual 14.12, "Bit Functions and Operators": "_binary X'40'" is evaluated as a binary string)
    if (t.kind === 'ident' && t.value.startsWith('_') && this.peek(1).kind === 'hex') {
      const found = lookupCharset(t.value.slice(1));
      if (!('found' in found)) { if ('unmodelled' in found) throw unsupported(`the _${found.unmodelled} introducer`); this.fail(); }
      const bytes = hexToBinaryString(this.peek(1).value); this.i += 2;
      if (found.found === 'binary') return { kind: 'literal', value: bytes, hint: 'VARBINARY' };
      return { kind: 'literal', value: new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0))), hint: 'VARCHAR', collation: defaultCollation(found.found).name };
    }
    if (t.kind === 'ident' && t.value.startsWith('_') && this.peek(1).kind === 'string') {
      // A character set introducer, `_utf8mb4'text'` / `_binary'bytes'` (10.3.8).
      const found = lookupCharset(t.value.slice(1));
      if (!('found' in found)) { if ('unmodelled' in found) throw unsupported(`the _${found.unmodelled} introducer`); this.fail(); }
      const text = this.peek(1).value; this.i += 2;
      if (found.found === 'binary') return { kind: 'literal', value: toByteString(text), hint: 'VARBINARY' };
      return { kind: 'literal', value: text, hint: 'VARCHAR', collation: defaultCollation(found.found).name };
    }
    if (t.kind === 'ident') {
      const upper = t.value.toUpperCase();
      // GRAMMAR-LEVEL families this twin FILES as todos must take the `unsupported:` channel, not
      // 1064. §9 round two, finding 8: round one fixed exactly this for UNION and left CASE, CAST
      // and INTERVAL answering "your SQL is malformed" for SQL that is perfectly well-formed and
      // that the pack's own manifest lists as known, unbuilt surface.
      if (upper === 'CASE') {
        this.i++;
        const operand = this.isWord('WHEN') ? undefined : this.expr();
        const whens: Array<{ when: Expr; then: Expr }> = [];
        while (this.takeWord('WHEN')) {
          const when = this.expr();
          this.expectWord('THEN');
          whens.push({ when, then: this.expr() });
        }
        if (whens.length === 0) this.fail();
        const otherwise = this.takeWord('ELSE') ? this.expr() : undefined;
        this.expectWord('END');
        return { kind: 'case', whens, ...(operand !== undefined ? { operand } : {}), ...(otherwise !== undefined ? { otherwise } : {}) };
      }
      if (upper === 'EXISTS' && this.isPunct('(', 1) && this.isWord('SELECT', 2)) {
        this.i += 2;
        const select = this.select(true);
        this.expectPunct(')');
        return { kind: 'exists', select };
      }
      if (upper === 'INTERVAL') throw unsupported('INTERVAL arithmetic');
      // DATE 'str', TIME 'str', TIMESTAMP 'str': the standard SQL typed literals (manual 11.1.3, "Date and Time Literals")
      if ((upper === 'DATE' || upper === 'TIME' || upper === 'TIMESTAMP') && this.peek(1).kind === 'string') {
        const text = this.peek(1).value; this.i += 2;
        const p = upper === 'TIME' ? parseTimeText(text) : parseDateTimeText(text);
        if (p === null || p.truncated) throw new SqlError(`Incorrect ${upper} value: '${text}'`, 'INVALID_ARGUMENT', 1525, 'HY000');
        const fsp = upper === 'DATE' ? 0 : Math.min(6, /\.(\d+)/.exec(text)?.[1]?.length ?? 0);
        const kind: TemporalKind = upper === 'DATE' ? 'DATE' : upper === 'TIME' ? 'TIME' : 'DATETIME';
        return { kind: 'literal', value: formatTemporal(p.t, kind, fsp), hint: kind };
      }
      if (upper === 'CAST' && this.isPunct('(', 1)) {
        this.i += 2; const arg = this.expr();
        // CAST(timestamp_value AT TIME ZONE [INTERVAL] '+00:00' AS DATETIME[(precision)]) (manual 14.10, 8.0.22): "the
        // only supported time zone is UTC", written '+00:00' or 'UTC'
        if (this.isWord('AT') && this.isWord('TIME', 1) && this.isWord('ZONE', 2)) {
          this.i += 3; this.takeWord('INTERVAL');
          const z = this.next();
          if (z.kind !== 'string') this.fail();
          this.expectWord('AS');
          const to = this.castType();
          this.expectPunct(')');
          if (to.dataType !== 'DATETIME') this.fail();
          if (!['+00:00', 'UTC'].includes(z.value.toUpperCase())) throw new SqlError(`Unknown or incorrect time zone: '${z.value}'`, 'INVALID_ARGUMENT', 1298, 'HY000');
          return { kind: 'cast', arg, to, atTimeZone: '+00:00' };
        }
        this.expectWord('AS');
        if (this.isWord('BINARY') && this.isPunct(')', 1)) { this.i++; this.expectPunct(')'); return { kind: 'unary', op: 'BINARY', arg }; }
        const to = this.castType();
        this.expectPunct(')');
        return { kind: 'cast', arg, to };
      }
      // GET_FORMAT({DATE|TIME|DATETIME|TIMESTAMP}, locale) (manual 14.7): its first argument is a keyword
      if (upper === 'GET_FORMAT' && this.isPunct('(', 1)) {
        this.i += 2;
        const kind = this.word();
        if (!['DATE', 'TIME', 'DATETIME', 'TIMESTAMP'].includes(kind)) this.fail();
        this.i++; this.expectPunct(',');
        const locale = this.expr();
        this.expectPunct(')');
        return { kind: 'call', name: 'GET_FORMAT', args: [{ kind: 'literal', value: kind === 'TIMESTAMP' ? 'DATETIME' : kind, hint: 'VARCHAR' }, locale], star: false };
      }
      // TRIM([{BOTH | LEADING | TRAILING} [remstr] FROM] str), TRIM([remstr FROM] str), LTRIM(str), RTRIM(str) (manual 14.8):
      // one call, TRIM(str, remstr, side), whose remstr is a space where none is given
      if ((upper === 'TRIM' || upper === 'LTRIM' || upper === 'RTRIM') && this.isPunct('(', 1)) {
        this.i += 2;
        const space: Expr = { kind: 'literal', value: ' ', hint: 'VARCHAR' };
        const side = (w: string): Expr => ({ kind: 'literal', value: w, hint: 'VARCHAR' });
        if (upper !== 'TRIM') {
          const str = this.expr(); this.expectPunct(')');
          return { kind: 'call', name: 'TRIM', args: [str, space, side(upper === 'LTRIM' ? 'LEADING' : 'TRAILING')], star: false };
        }
        let mode: string | undefined;
        if (this.isWord('BOTH') || this.isWord('LEADING') || this.isWord('TRAILING')) { mode = this.word(); this.i++; }
        if (mode !== undefined && this.takeWord('FROM')) { const str = this.expr(); this.expectPunct(')'); return { kind: 'call', name: 'TRIM', args: [str, space, side(mode)], star: false }; }
        const first = this.expr();
        if (this.takeWord('FROM')) { const str = this.expr(); this.expectPunct(')'); return { kind: 'call', name: 'TRIM', args: [str, first, side(mode ?? 'BOTH')], star: false }; }
        if (mode !== undefined) this.fail();
        this.expectPunct(')');
        return { kind: 'call', name: 'TRIM', args: [first], star: false };
      }
      if (upper === 'CONVERT' && this.isPunct('(', 1)) {
        this.i += 2; const arg = this.expr();
        if (this.takeWord('USING')) {
          const cs = requireCharset(this.charsetName());
          this.expectPunct(')');
          return { kind: 'cast', arg, to: cs === 'binary' ? synthetic('', 'VARBINARY', 'varbinary') : { ...synthetic('', 'VARCHAR', 'varchar'), collation: defaultCollation(cs).name } };
        }
        this.expectPunct(',');
        if (this.isWord('BINARY') && this.isPunct(')', 1)) { this.i++; this.expectPunct(')'); return { kind: 'unary', op: 'BINARY', arg }; }
        const to = this.castType();
        this.expectPunct(')');
        return { kind: 'cast', arg, to };
      }
      // `@@name`, `@@session.name`, `@@global.name`: a system variable, read as its constant value.
      if (t.value.startsWith('@@')) {
        let name = t.value.slice(2).toLowerCase(); this.i++;
        if (['session', 'global', 'local'].includes(name) && this.isPunct('.')) { this.i++; name = this.identifier().toLowerCase(); }
        // the session's SQL mode, which SET may have changed: read when the statement runs (withUserVariables)
        if (name === 'sql_mode') return { kind: 'column', name: '@@sql_mode' };
        const value = SYSTEM_VARIABLES[name];
        if (value === undefined) throw new SqlError(`Unknown system variable '${name}'`, 'INVALID_ARGUMENT', 1193, 'HY000');
        return typeof value === 'number' ? { kind: 'literal', value: String(value), hint: 'INT64' } : { kind: 'literal', value, hint: 'VARCHAR', collation: 'utf8mb3_general_ci' };
      }
      if (upper === 'NULL') { this.i++; return { kind: 'literal', value: null, hint: 'NULL' }; }
      if (upper === 'TRUE') { this.i++; return { kind: 'literal', value: '1', hint: 'INT8' }; }
      if (upper === 'FALSE') { this.i++; return { kind: 'literal', value: '0', hint: 'INT8' }; }
      if (this.isPunct('(', 1)) {
        this.i += 2;
        let star = false;
        const args: Expr[] = [];
        // `COUNT(DISTINCT …)`, `SUM(DISTINCT …)`: only an aggregate takes the DISTINCT modifier.
        // JSON_ARRAYAGG takes no DISTINCT in MySQL's grammar: a syntax error there.
        if (upper === 'JSON_ARRAYAGG' && this.isWord('DISTINCT')) this.fail();
        const distinct = AGGREGATES.has(upper) && this.takeWord('DISTINCT');
        if (this.isPunct('*')) { this.i++; star = true; }
        else if (!this.isPunct(')')) { do { args.push(this.expr()); } while (this.takePunct(',')); }
        // GROUP_CONCAT([DISTINCT] expr [, expr …] [ORDER BY {expr} [ASC | DESC], …] [SEPARATOR str_val]) (manual 14.19.1)
        let order: OrderTerm[] | undefined; let separator: string | undefined;
        if (upper === 'GROUP_CONCAT' && this.isWord('ORDER') && this.isWord('BY', 1)) {
          this.i += 2; order = [];
          do { const expr = this.expr(); const desc = this.takeWord('DESC'); if (!desc) this.takeWord('ASC'); order.push({ expr, desc }); } while (this.takePunct(','));
        }
        if (upper === 'GROUP_CONCAT' && this.takeWord('SEPARATOR')) { const t = this.next(); if (t.kind !== 'string') this.fail(); separator = t.value; }
        this.expectPunct(')');
        if (order !== undefined || separator !== undefined) {
          if (this.isWord('OVER')) throw unsupported('window functions (… OVER …)');
          return { kind: 'call', name: upper, args, star, ...(distinct ? { distinct } : {}), ...(order ? { order } : {}), ...(separator !== undefined ? { separator } : {}) };
        }
        if (this.isWord('OVER')) throw unsupported('window functions (… OVER …)');
        return { kind: 'call', name: upper, args, star, ...(distinct ? { distinct } : {}) };
      }
      // `CURRENT_TIMESTAMP`, `CURRENT_DATE`, `LOCALTIME`, … without parentheses are the function (manual 14.7).
      if (BARE_CLOCK_WORDS.has(upper) && !this.isPunct('.', 1)) { this.i++; return { kind: 'call', name: upper, args: [], star: false }; }
      this.i++;
      return this.jsonPath(this.columnOrQualified(t.value));
    }
    this.fail();
  }

  /** MySQL's JSON column-path operators: `col->'$.a'` is JSON_EXTRACT and `col->>'$.a'` is
   *  JSON_UNQUOTE(JSON_EXTRACT(…)). The left operand is always a column. */
  private jsonPath(column: Expr): Expr {
    if (!this.isPunct('->') && !this.isPunct('->>')) return column;
    const unquote = this.next().value === '->>';
    const t = this.peek();
    if (t.kind !== 'string') this.fail();
    this.i++;
    const extract: Expr = { kind: 'call', name: 'JSON_EXTRACT', args: [column, { kind: 'literal', value: t.value, hint: 'VARCHAR' }], star: false };
    return unquote ? { kind: 'call', name: 'JSON_UNQUOTE', args: [extract], star: false } : extract;
  }
  private columnOrQualified(first: string): Expr {
    if (this.isPunct('.')) {
      this.i++;
      if (this.isPunct('*')) { this.i++; return { kind: 'star', table: first }; }
      const name = this.identifier();
      // Prisma qualifies columns as schema.table.column. As with tableName(), the twin owns
      // one schema; retain the table qualifier and the column's original name.
      if (this.takePunct('.')) {
        if (this.takePunct('*')) return { kind: 'star', table: name };
        return { kind: 'column', table: name, name: this.identifier() };
      }
      return { kind: 'column', table: first, name };
    }
    return { kind: 'column', name: first };
  }
}

/** After `EXPLAIN`, these introduce a STATEMENT (or a modifier) rather than a table name. */
const EXPLAIN_STATEMENT_WORDS = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'ANALYZE', 'FORMAT', 'FOR', 'TABLE', 'FROM', 'FIELDS', 'COLUMNS',
]);

/** Words that can follow a select item / table name and are therefore never an implicit alias. */
const RESERVED_AFTER_ITEM = new Set([
  'FROM', 'WHERE', 'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'AS', 'AND', 'OR', 'NOT',
  'IS', 'IN', 'LIKE', 'BETWEEN', 'ON', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'UNION',
  'SET', 'VALUES', 'INTO', 'FOR', 'DIV', 'MOD', 'ASC', 'DESC', 'DUPLICATE', 'KEY',
  // Everything below follows a TABLE NAME in legal MySQL and is therefore never an implicit
  // alias. §9 round one: `SELECT * FROM t FORCE INDEX (PRIMARY)` swallowed `FORCE` as the alias
  // and then answered a bare syntax error — a confidently wrong reply to SQL an ORM emits. With
  // these reserved, the parser reaches the explicit `unsupported()` refusals in `select()`.
  'FORCE', 'USE', 'IGNORE', 'PARTITION', 'STRAIGHT_JOIN', 'INTERSECT', 'EXCEPT',
  'PROCEDURE', 'LOCK', 'WINDOW', 'INDEX', 'WITH', 'NATURAL', 'USING', 'OUTER',
]);

/** The aggregate functions: evaluated once per group, never per row. */
const AGGREGATES = new Set(['COUNT', 'SUM', 'MIN', 'MAX', 'AVG', 'JSON_ARRAYAGG', 'GROUP_CONCAT']);

const numberHint = (v: string): VitessType => (/[.eE]/.test(v) ? 'FLOAT64' : 'INT64');

/** MySQL hex literals denote BYTES; this engine's cell is text, so the bytes are held as a binary
 *  string (one char per byte) — which is exactly what the wire packer then length-prefixes. */
function hexToBinaryString(hex: string): string {
  const even = hex.length % 2 === 0 ? hex : `0${hex}`;
  let out = '';
  for (let i = 0; i < even.length; i += 2) out += String.fromCharCode(parseInt(even.slice(i, i + 2), 16));
  return out;
}

// ── charset and collation declarations ──────────────────────────────────────────────────────

/** A collation name → the modelled collation. MySQL's errno 1273 for a name MySQL does not know;
 *  the `unsupported:` channel for a real MySQL collation this twin does not model. */
function requireCollation(name: string): Collation {
  const r = lookupCollation(name);
  if ('found' in r) return r.found;
  if ('unmodelled' in r) throw unsupported(`the ${r.unmodelled} collation (planetscale.collation.other_collations)`);
  throw new SqlError(`Unknown collation: '${name}'`, 'INVALID_ARGUMENT', 1273, 'HY000');
}

function requireCharset(name: string): Collation['charset'] {
  const r = lookupCharset(name);
  if ('found' in r) return r.found;
  if ('unmodelled' in r) throw unsupported(`the ${r.unmodelled} character set (planetscale.collation.other_collations)`);
  throw new SqlError(`Unknown character set: '${name}'`, 'INVALID_ARGUMENT', 1115, '42000');
}

const notValidFor = (collation: string, charset: string): SqlError =>
  new SqlError(`COLLATION '${collation}' is not valid for CHARACTER SET '${charset}'`, 'INVALID_ARGUMENT', 1253, '42000');

/** `CHARACTER SET x` and/or `COLLATE y` → the pair they name (MySQL 8 manual 10.3.4): a charset
 *  alone takes its default collation, a collation alone implies its charset, both must agree. */
function resolveCharsetCollation(charset?: string, collation?: string): { charset: Collation['charset']; collation: string } | undefined {
  if (charset === undefined && collation === undefined) return undefined;
  const cs = charset === undefined ? undefined : requireCharset(charset);
  const co = collation === undefined ? undefined : requireCollation(collation);
  if (cs !== undefined && co !== undefined && co.charset !== cs) throw notValidFor(co.name, cs);
  const c = co ?? defaultCollation(cs!);
  return { charset: c.charset, collation: c.name };
}

const CHARACTER_TYPES = new Set(['CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'ENUM', 'SET']);

/** A character column's charset and collation (MySQL 8 manual 10.3.5): its own `CHARACTER SET` /
 *  `COLLATE`, `BINARY` meaning its charset's _bin collation, otherwise the table's. Other columns
 *  carry none. */
function resolveColumnCollation(col: ColumnDef, table: { charset: Collation['charset']; collation: string }): ColumnDef {
  const { binaryAttribute, charset, collation, ...rest } = col;
  if (!CHARACTER_TYPES.has(col.dataType)) return rest;
  const own = resolveCharsetCollation(charset, collation);
  if (own?.charset === 'binary') throw unsupported('CHARACTER SET binary on a character column');
  let c = collationNamed(own?.collation ?? table.collation)!;
  if (binaryAttribute === true) c = binCollation(c.charset);
  return { ...rest, charset: c.charset, collation: c.name };
}

function literalCell(e: Expr): Cell {
  if (e.kind === 'literal') return e.value;
  if (e.kind === 'unary' && e.op === '-' && e.arg.kind === 'literal' && e.arg.value !== null) return `-${e.arg.value}`;
  throw unsupported('a non-literal column DEFAULT');
}

export function parseStatement(sql: string, sqlMode?: string): Statement {
  const trimmed = sql.trim();
  if (trimmed === '' || trimmed === ';') throw parseError(1, '');
  const noBackslashEscapes = sqlMode !== undefined && sqlMode.toUpperCase().split(',').map((m) => m.trim()).includes('NO_BACKSLASH_ESCAPES');
  return new Parser(tokenize(trimmed, noBackslashEscapes), trimmed).statement();
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// EVALUATION
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Is this expression's RESULT binary — i.e. bytes rather than text?
 *
 * MySQL propagates binariness through an expression: `CONCAT(binary_col, …)` is binary, `UPPER` on
 * a binary value is a no-op that stays binary, and a hex literal is binary. This ONE predicate
 * governs storage (a source already in bytes is not re-encoded: `UPDATE b SET p = p` must not
 * double the value), the result type and charset of an expression (charset 63, so the client
 * returns a `Uint8Array`), and LENGTH / CHAR_LENGTH (bytes are counted, not re-encoded).
 *
 * `table` may be undefined (the constant-row `SELECT … FROM dual` path), where no column exists.
 */
export function staticBinary(e: Expr | undefined, table: TableDef | undefined): boolean {
  if (e === undefined) return false;
  switch (e.kind) {
    case 'literal': return e.hint === 'VARBINARY';
    case 'unary': return e.op === 'BINARY';
    case 'cast': return e.to.dataType === 'VARBINARY';
    case 'column': {
      const col = table?.columns.find((c) => c.name.toLowerCase() === e.name.toLowerCase());
      return col !== undefined && BINARY_TYPES.has(col.dataType);
    }
    case 'slot': return BINARY_TYPES.has(e.def.dataType);
    // Functions that PRESERVE their argument's type. MySQL's UPPER/LOWER/TRIM over a binary value
    // return it unchanged (there is no case to fold without a collation), and CONCAT over any
    // binary argument yields a binary result.
    case 'call':
      if (!['CONCAT', 'TRIM', 'LOWER', 'LCASE', 'UPPER', 'UCASE', 'COALESCE', 'IFNULL', 'NULLIF', 'IF'].includes(e.name)) return false;
      return (e.name === 'IF' ? e.args.slice(1) : e.args).some((a) => staticBinary(a, table));
    default:
      // Arithmetic and comparison yield numbers; `IS NULL`/`IN`/`LIKE`/`BETWEEN` yield 1/0.
      return false;
  }
}

/** A row under evaluation: the table's cells, plus the schema needed to type a comparison. A
 *  statement bound over several sources (joins, subqueries) reads its `slot` columns from `tuple`,
 *  one cell record per source, where a missing record is a LEFT JOIN's null extension. */
export type EvalRow = {
  cells: Record<string, Cell>; table?: TableDef; database?: string; tuple?: Tuple;
  /** Evaluating a value an INSERT or UPDATE stores: under strict mode with ERROR_FOR_DIVISION_BY_ZERO
   *  (MySQL 8's default sql_mode) a division by zero there is errno 1365, not NULL. */
  write?: boolean;
  /** ON DUPLICATE KEY UPDATE: the row the INSERT proposed, read by `VALUES(col)` and through the
   *  row alias (`AS new` → `new.col`, or its column aliases, `AS new (m, n)` → `m`). */
  values?: Record<string, Cell>;
  valuesAlias?: string;
  /** lowercased column alias → the table column it names (only with `AS new (m, n)`). */
  valuesNames?: Map<string, string>;
  /** The World clock's instant for the statement, which the clock functions read (INSERT values). */
  now?: string;
  /** The running statement's scope: its SQL mode, warnings, clock, collation and time zone. */
  statement: StatementScope;
};
export type Tuple = Array<Record<string, Cell> | undefined>;

/** MySQL three-valued logic: NULL is neither true nor false. */
type Tri = true | false | null;

/**
 * MySQL's truthiness. A string is coerced to a number by its LEADING NUMERIC PREFIX (with a
 * warning), so `'abc'` and `'0abc'` are both FALSE and `'1abc'` is TRUE. (`parseFloat` is not the
 * rule: it also accepts `Infinity`, which MySQL reads as 0.)
 */
function truthy(c: Cell): Tri {
  if (c === null) return null;
  const m = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(c);
  return m === null ? false : Number(m[0]) !== 0;
}

const and3 = (a: Tri, b: Tri): Tri => (a === false || b === false ? false : a === null || b === null ? null : true);

function columnOf(row: EvalRow, name: string): ColumnDef | undefined {
  const own = row.table?.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (own !== undefined) return own;
  const aliased = row.valuesNames?.get(name.toLowerCase());
  return aliased === undefined ? undefined : row.table?.columns.find((c) => c.name.toLowerCase() === aliased.toLowerCase());
}

function cellOf(cells: Record<string, Cell>, name: string): Cell | undefined {
  const key = Object.keys(cells).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : cells[key] ?? null;
}

function readColumn(row: EvalRow, e: { table?: string; name: string }): Cell {
  // `new.col` (or `new.m` with column aliases) reads the row the INSERT proposed.
  if (e.table !== undefined && row.values !== undefined && row.valuesAlias !== undefined && e.table.toLowerCase() === row.valuesAlias.toLowerCase()) {
    const target = row.valuesNames === undefined ? e.name : row.valuesNames.get(e.name.toLowerCase());
    const v = target === undefined ? undefined : cellOf(row.values, target);
    if (v === undefined) throw badField(`${e.table}.${e.name}`, 'field list');
    return v;
  }
  const own = cellOf(row.cells, e.name);
  if (own !== undefined) return own;
  const aliased = e.table === undefined ? row.valuesNames?.get(e.name.toLowerCase()) : undefined;
  if (aliased !== undefined && row.values !== undefined) return cellOf(row.values, aliased) ?? null;
  throw badField(e.table === undefined ? e.name : `${e.table}.${e.name}`, 'where clause');
}

/** MySQL `LIKE`: `%` = any sequence, `_` = any single character, `\` escapes both, every other
 *  character matched per character under `collation` (default: the connection's, utf8mb4_0900_ai_ci). */
export function likeMatch(value: string, pattern: string, collation: Collation = databaseCollation()): boolean {
  return collationLike(value, pattern, collation);
}

/** Rewrite a pattern written with `ESCAPE 'c'` into the backslash-escaped form `likeMatch` reads. */
function withEscape(pattern: string, escape: string): string {
  if (escape === '\\') return pattern;
  const chars = [...pattern];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (escape !== '' && c === escape && i + 1 < chars.length) { out += `\\${chars[++i]}`; continue; }
    out += c === '\\' ? '\\\\' : c;
  }
  return out;
}

// ── COLLATION IN EXPRESSIONS (MySQL 8 manual 10.8.4) ────────────────────────────────────────
// Every comparison of two strings — `=`, `<>`, `<`, BETWEEN, IN, LIKE, CASE, joins, row
// constructors, ORDER BY, GROUP BY, DISTINCT, MIN/MAX, COUNT(DISTINCT) and UNIQUE/PRIMARY KEY
// enforcement — runs under ONE collation chosen from its operands' collations and derivations:
// an explicit COLLATE (0) beats a column (2) beats a system constant (3) beats a string literal,
// which takes the connection collation (4), beats a number/temporal (5) beats NULL (6). A binary
// string (BINARY x, a VARBINARY/BLOB column, a hex literal) makes the comparison byte-wise. Numbers,
// temporals and JSON keep their own comparison and take no collation.

/** How an operand's collation derives: its kind, and for strings the collation and derivation. */
type OperandKind = 'string' | 'binary' | 'numeric' | 'other' | 'null';

const TEMPORAL_TYPES = new Set(['DATE', 'DATETIME', 'TIMESTAMP', 'TIME']);
/** A literal's collation: the connection's (SET NAMES … COLLATE), else the database default. */
const connection = (st: StatementScope): DT => ({ collation: (st.collation !== undefined ? collationNamed(st.collation) : undefined) ?? databaseCollation(), derivation: COERCIBLE });
const numericDt = (): DT => ({ collation: databaseCollation(), derivation: NUMERIC_DERIVATION });
const nullKind = (): { kind: OperandKind; dt: DT } => ({ kind: 'null', dt: { collation: BINARY_COLLATION, derivation: IGNORABLE } });
const binaryKind = (derivation: number): { kind: OperandKind; dt: DT } => ({ kind: 'binary', dt: { collation: BINARY_COLLATION, derivation } });

/** A declared column's collation kind: character columns under their collation (the database
 *  default when the catalog predates column collations), binary columns byte-wise, JSON and
 *  temporals their own, numbers numeric. */
function columnKind(def: ColumnDef): { kind: OperandKind; dt: DT } {
  if (isNumericVitessType(vitessTypeFor(def))) return { kind: 'numeric', dt: numericDt() };
  if (BINARY_TYPES.has(def.dataType)) return binaryKind(IMPLICIT);
  if (TEMPORAL_TYPES.has(def.dataType) || def.dataType === 'JSON' || def.dataType === 'BIT') return { kind: 'other', dt: numericDt() };
  return { kind: 'string', dt: { collation: collationNamed(def.collation) ?? databaseCollation(), derivation: IMPLICIT } };
}

const illegalMix = (dts: DT[], op: string): SqlError => {
  const d = (x: DT) => `(${x.collation.name},${DERIVATION_NAMES[x.derivation]})`;
  if (dts.length === 2) return new SqlError(`Illegal mix of collations ${d(dts[0]!)} and ${d(dts[1]!)} for operation '${op}'`, 'INVALID_ARGUMENT', 1267, 'HY000');
  if (dts.length === 3) return new SqlError(`Illegal mix of collations ${dts.map(d).join(', ')} for operation '${op}'`, 'INVALID_ARGUMENT', 1270, 'HY000');
  return new SqlError(`Illegal mix of collations for operation '${op}'`, 'INVALID_ARGUMENT', 1271, 'HY000');
};

/** The collation kind of a string-valued expression built from `parts` (CONCAT, COALESCE, CASE,
 *  …): numeric only when every part is numeric, otherwise the aggregated collation of the parts. */
function combine(parts: Array<{ kind: OperandKind; dt: DT }>, op: string): { kind: OperandKind; dt: DT } {
  const live = parts.filter((p) => p.kind !== 'null');
  if (live.length === 0) return nullKind();
  if (live.every((p) => p.kind === 'numeric')) return { kind: 'numeric', dt: numericDt() };
  let dt = parts[0]!.dt;
  for (const p of parts.slice(1)) dt = aggregate(dt, p.dt);
  if (dt.derivation === NONE) throw illegalMix(parts.map((p) => p.dt), op);
  return { kind: dt.collation.charset === 'binary' ? 'binary' : 'string', dt };
}

/** An expression's collation kind and, for strings, its collation and derivation. */
function exprKind(e: Expr, row: EvalRow): { kind: OperandKind; dt: DT } {
  switch (e.kind) {
    case 'literal':
      if (e.hint === 'VARCHAR') return { kind: 'string', dt: e.collation === undefined ? connection(row.statement) : { collation: collationNamed(e.collation)!, derivation: COERCIBLE } };
      if (e.hint === 'VARBINARY') return binaryKind(COERCIBLE);
      if (e.hint === 'NULL') return nullKind();
      if (e.hint === 'DATETIME' || e.hint === 'DATE') return { kind: 'other', dt: numericDt() };
      return { kind: 'numeric', dt: numericDt() };
    case 'column': {
      const def = columnOf(row, e.name);
      return def === undefined ? { kind: 'string', dt: { collation: databaseCollation(), derivation: IMPLICIT } } : columnKind(def);
    }
    case 'slot': return columnKind(e.def);
    case 'collate': {
      const inner = exprKind(e.arg, row);
      const c = collationNamed(e.collation)!;
      const charset = inner.kind === 'binary' ? 'binary' : inner.kind === 'string' ? inner.dt.collation.charset : 'utf8mb4';
      if (c.charset !== charset) throw notValidFor(c.name, charset);
      return { kind: c.charset === 'binary' ? 'binary' : 'string', dt: { collation: c, derivation: EXPLICIT } };
    }
    case 'unary': return e.op === 'BINARY' ? binaryKind(IMPLICIT) : { kind: 'numeric', dt: numericDt() };
    case 'cast':
      if (e.to.dataType === 'VARBINARY') return binaryKind(IMPLICIT);
      if (e.to.dataType === 'VARCHAR') return { kind: 'string', dt: { collation: collationNamed(e.to.collation) ?? databaseCollation(), derivation: IMPLICIT } };
      return columnKind(e.to);
    case 'case': return combine([...e.whens.map((w) => exprKind(w.then, row)), ...(e.otherwise !== undefined ? [exprKind(e.otherwise, row)] : [])], 'case');
    case 'subquery': {
      const field = e.run?.fields()[0];
      return field === undefined || field.type === 'NULL' ? nullKind() : columnKind(columnForField(field));
    }
    case 'call': {
      const args = (from = 0, to = e.args.length) => e.args.slice(from, to).map((a) => exprKind(a, row));
      switch (e.name) {
        case 'NOW': case 'CURRENT_TIMESTAMP': case 'LOCALTIME': case 'LOCALTIMESTAMP': case 'UTC_TIMESTAMP': case 'SYSDATE': case 'CURDATE': case 'CURRENT_DATE':
          return { kind: 'other', dt: numericDt() };
        case 'UNIX_TIMESTAMP': return { kind: 'numeric', dt: numericDt() };
        case 'CONCAT': return combine(args(), 'concat');
        case 'LOWER': case 'LCASE': case 'UPPER': case 'UCASE': case 'TRIM': return combine(args(0, 1), e.name.toLowerCase());
        case 'COALESCE': case 'IFNULL': case 'GREATEST': case 'LEAST': return combine(args(), e.name.toLowerCase());
        case 'NULLIF': return combine(args(0, 1), 'nullif');
        case 'IF': return combine(args(1, 3), 'if');
        case 'VALUES': return e.args[0] === undefined ? nullKind() : exprKind(e.args[0], row);
        // JSON text is utf8mb4 under utf8mb4_bin (MySQL 8 manual 13.5, "The JSON Data Type").
        case 'JSON_UNQUOTE': case 'JSON_TYPE': case 'JSON_QUOTE': return { kind: 'string', dt: { collation: collationNamed('utf8mb4_bin')!, derivation: IMPLICIT } };
        case 'DATABASE': case 'SCHEMA': case 'VERSION': return { kind: 'string', dt: { collation: collationNamed('utf8mb3_general_ci')!, derivation: SYSCONST } };
        case 'DATE_FORMAT': case 'GET_FORMAT': return { kind: 'string', dt: connection(row.statement) };
        case 'GROUP_CONCAT': return combine(args(), 'group_concat');
        case 'MIN': case 'MAX': return e.args[0] === undefined ? nullKind() : exprKind(e.args[0], row);
        default: {
          const t = staticType(e, row);
          const cls = clsOf(t);
          if (cls === 'string') return { kind: 'string', dt: connection(row.statement) };
          if (cls === 'binary') return binaryKind(IMPLICIT);
          if (cls === 'null') return nullKind();
          return { kind: cls === 'temporal' || cls === 'json' ? 'other' : 'numeric', dt: numericDt() };
        }
      }
    }
    default: return { kind: 'numeric', dt: numericDt() };
  }
}

// ── STATIC TYPES (MySQL 8.0 manual 14.5 "Flow Control Functions", 14.4.2 COALESCE, 14.24
// "Precision Math", 14.3 "Type Conversion in Expression Evaluation") ─────────────────────────
// Every expression has a MySQL type, derived from its operands without reading any value. The
// type decides how the expression compares, sorts and groups, how its arithmetic is computed
// (exact DECIMAL/BIGINT or DOUBLE), and what `Field.type` the client casts it by. `staticType`
// answers a ColumnDef, `null` for the NULL type of a literal NULL (which type aggregation
// ignores), or undefined only for an expression that has no scalar type (a row constructor, or
// a column before binding).

type StaticType = ColumnDef | null | undefined;

const typed = (dataType: string, columnType: string, extra: Partial<ColumnDef> = {}): ColumnDef =>
  ({ ...synthetic('', dataType, columnType), ...extra });
const BOOL_RESULT = (): ColumnDef => typed('BIGINT', 'bigint', { length: 1 });
const DOUBLE_RESULT = (): ColumnDef => typed('DOUBLE', 'double');

/** ROUND(X[, D])'s D when it is a constant (a number, or a negated one), clamped to ±30 (manual 14.6.2: "The maximum
 *  absolute value for D is 30"); undefined when D is an expression. */
function roundPlaces(e: Extract<Expr, { kind: 'call' }>): number | undefined {
  const d = e.args[1];
  if (d === undefined) return 0;
  const lit = d.kind === 'literal' ? d : d.kind === 'unary' && d.op === '-' && d.arg.kind === 'literal' ? d.arg : undefined;
  if (lit === undefined || lit.value === null || !/^\s*[+-]?\d+(\.\d*)?\s*$/.test(lit.value)) return undefined;
  const n = Math.trunc(Number(lit.value)) * (d.kind === 'unary' ? -1 : 1);
  return Math.max(-30, Math.min(30, n));
}

/** ROUND()'s result type (manual 14.6.2, 8.0.21 and later): BIGINT for an integer argument, DOUBLE for a floating-point
 *  or non-numeric one, and DECIMAL for a DECIMAL one, whose scale follows a constant D below the argument's (D, or 0 for a
 *  negative D) with the precision "extended by one place" ("ROUND(99.999, 2) … DECIMAL(5, 2)"; "ROUND(99.999, -1) …
 *  DECIMAL(3, 0)"), and is the argument's otherwise. */
function roundType(e: Extract<Expr, { kind: 'call' }>, t: StaticType): ColumnDef {
  const v = numView(t);
  if (v.k === 'int') return bigintType(v.unsigned);
  if (v.k !== 'decimal') return DOUBLE_RESULT();
  const d = roundPlaces(e);
  if (d === undefined || d >= v.scale) return decimalType(v.int + v.scale, v.scale);
  return d < 0 ? decimalType(v.int + 1, 0) : decimalType(v.int + d + 1, d);
}
const bigintType = (unsigned: boolean): ColumnDef => typed('BIGINT', unsigned ? 'bigint unsigned' : 'bigint', { unsigned });
const decimalType = (precision: number, scale: number): ColumnDef => {
  const p = Math.max(1, Math.min(65, precision)); const s = Math.min(30, scale);
  return typed('DECIMAL', `decimal(${Math.max(p, s)},${s})`, { length: Math.max(p, s) + (s > 0 ? 1 : 0) + 1 });
};

const INT64_MAX = 2n ** 63n - 1n;
const INT64_MIN = -(2n ** 63n);
const UINT64_MAX = 2n ** 64n - 1n;

/** A literal's type: a string is VARCHAR, a hex string VARBINARY, an integer BIGINT (BIGINT
 *  UNSIGNED above 2^63 − 1, DECIMAL above 2^64 − 1), a number with a point and no exponent an
 *  exact DECIMAL, one with an exponent DOUBLE (manual 11.1.2 "Numeric Literals"); TRUE and FALSE
 *  are the integers 1 and 0. */
function literalType(e: Extract<Expr, { kind: 'literal' }>): StaticType {
  switch (e.hint) {
    case 'NULL': return null;
    case 'VARCHAR': return typed('VARCHAR', 'varchar', e.collation !== undefined ? { collation: e.collation } : {});
    case 'VARBINARY': return typed('VARBINARY', 'varbinary');
    case 'FLOAT64': {
      const v = e.value ?? '';
      if (/[eE]/.test(v)) return DOUBLE_RESULT();
      const [int = '', frac = ''] = v.replace(/^[+-]/, '').split('.');
      const scale = frac.length; const precision = Math.max(1, int.replace(/^0+/, '').length + scale);
      // a decimal literal is UNSIGNED (its sign is a unary minus, a separate operator): the manual's DESCRIBE of
      // `CREATE TABLE t SELECT 2.5 AS a` shows `decimal(2,1) unsigned` (14.24.5, "Precision Math Examples")
      const d = decimalType(precision, scale);
      return { ...d, unsigned: true, columnType: `${d.columnType} unsigned` };
    }
    case 'INT8': return typed('TINYINT', 'tinyint');
    // A clock function's value (clockValue): typed as the DATETIME(fsp) or DATE it is.
    case 'DATETIME': { const fsp = (e.value ?? '').split('.')[1]?.length ?? 0; return synthetic('', 'DATETIME', fsp > 0 ? `datetime(${fsp})` : 'datetime'); }
    case 'DATE': return synthetic('', 'DATE', 'date');
    case 'TIME': { const fsp = (e.value ?? '').split('.')[1]?.length ?? 0; return synthetic('', 'TIME', fsp > 0 ? `time(${fsp})` : 'time'); }
    default: {
      if (!INTEGRAL.has(e.hint)) return undefined;
      const n = /^\d+$/.test(e.value ?? '') ? BigInt(e.value!) : 0n;
      if (n > UINT64_MAX) return decimalType(e.value!.length, 0);
      return bigintType(n > INT64_MAX);
    }
  }
}

type Cls = 'int' | 'decimal' | 'double' | 'string' | 'binary' | 'temporal' | 'json' | 'null';
const INT_FAMILY = new Set(['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT', 'BOOL', 'BOOLEAN', 'YEAR', 'BIT']);

/** The comparison class of a type. */
function clsOf(t: StaticType): Cls {
  if (t === null) return 'null';
  if (t === undefined) return 'string';
  const d = t.dataType;
  if (INT_FAMILY.has(d)) return 'int';
  if (d === 'DECIMAL' || d === 'NUMERIC') return 'decimal';
  if (d === 'FLOAT' || d === 'DOUBLE' || d === 'REAL') return 'double';
  if (TEMPORAL_TYPES.has(d)) return 'temporal';
  if (d === 'JSON') return 'json';
  if (BINARY_TYPES.has(d)) return 'binary';
  return 'string';
}

const fspOf = (c: ColumnDef): number => (TEMPORAL_TYPES.has(c.dataType) ? Number(/\((\d)\)/.exec(c.columnType)?.[1] ?? 0) : 0);

/** A DECIMAL type's precision and scale (`decimal` alone is (10,0), `decimal(5)` is (5,0)); a
 *  FLOAT/DOUBLE declared `(M,D)` reports its D. */
function precisionScale(t: ColumnDef): [number, number] {
  const m = /\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/.exec(t.columnType);
  return [Number(m?.[1] ?? 10), Number(m?.[2] ?? 0)];
}

const INT_DIGITS_OF: Record<string, number> = { TINYINT: 3, BOOL: 3, BOOLEAN: 3, SMALLINT: 5, MEDIUMINT: 8, INT: 10, INTEGER: 10, BIGINT: 19, YEAR: 4, BIT: 20 };

/** How a type takes part in arithmetic: exact integer, exact decimal of a scale, or DOUBLE (every
 *  string, JSON and approximate value). A temporal is its number: YYYYMMDD[hhmmss][.fsp]. */
type NumView = { k: 'int' | 'decimal' | 'double' | 'null'; scale: number; int: number; unsigned: boolean };
function numView(t: StaticType): NumView {
  if (t === null) return { k: 'null', scale: 0, int: 0, unsigned: false };
  const c = clsOf(t);
  if (c === 'int') return { k: 'int', scale: 0, int: INT_DIGITS_OF[t!.dataType] ?? 19, unsigned: t!.unsigned };
  if (c === 'decimal') { const [p, s] = precisionScale(t!); return { k: 'decimal', scale: s, int: p - s, unsigned: t!.unsigned }; }
  if (c === 'temporal') {
    const fsp = fspOf(t!); const int = t!.dataType === 'DATE' ? 8 : t!.dataType === 'TIME' ? 7 : 14;
    return fsp > 0 ? { k: 'decimal', scale: fsp, int, unsigned: false } : { k: 'int', scale: 0, int, unsigned: false };
  }
  return { k: 'double', scale: 0, int: 0, unsigned: false };
}

/** The result type of `l op r` (manual 14.6.1 "Arithmetic Operators", 14.24.3): DOUBLE when either
 *  operand is approximate or a string; otherwise BIGINT for + - * % DIV over integers (UNSIGNED
 *  when either is), and DECIMAL with scale max(s1, s2) for + - %, s1 + s2 for *, and s1 +
 *  div_precision_increment (4) for /. */
function arithType(op: string, lt: StaticType, rt: StaticType): ColumnDef {
  const l = numView(lt); const r = numView(rt);
  if (l.k === 'null' && r.k === 'null') return bigintType(false);
  const a = l.k === 'null' ? r : l; const b = r.k === 'null' ? l : r;
  if (a.k === 'double' || b.k === 'double') return DOUBLE_RESULT();
  if (op === 'DIV') return bigintType(a.unsigned || b.unsigned);
  if (op === '/') { const scale = Math.min(30, (l.k === 'null' ? 0 : l.scale) + DIV_PRECISION_INCREMENT); return decimalType(a.int + b.scale + scale, scale); }
  if (a.k === 'int' && b.k === 'int') return bigintType(op === '%' ? a.unsigned : a.unsigned || b.unsigned);
  if (op === '*') return decimalType(a.int + b.int + a.scale + b.scale, a.scale + b.scale);
  const scale = Math.max(a.scale, b.scale);
  return decimalType(Math.max(a.int, b.int) + (op === '%' ? 0 : 1) + scale, scale);
}

/** div_precision_increment's default (manual 7.1.8): digits `/` adds to its dividend's scale. */
const DIV_PRECISION_INCREMENT = 4;

const typeCache = new WeakMap<Expr, { table: TableDef | undefined; type: StaticType }>(); // cache: per-node derivation within one statement's AST

function staticType(e: Expr, row: EvalRow | undefined): StaticType {
  if (e.kind === 'literal' || e.kind === 'slot') return e.kind === 'slot' ? e.def : literalType(e);
  const hit = typeCache.get(e);
  if (hit !== undefined && hit.table === row?.table) return hit.type;
  const type = deriveType(e, row);
  if (e.kind !== 'subquery' || e.run !== undefined) typeCache.set(e, { table: row?.table, type });
  return type;
}

function deriveType(e: Expr, row: EvalRow | undefined): StaticType {
  switch (e.kind) {
    case 'literal': return literalType(e);
    case 'slot': return e.def;
    case 'column': return row === undefined ? undefined : columnOf(row, e.name);
    case 'collate': { const t = staticType(e.arg, row); return t === null || t === undefined ? t : { ...t, collation: e.collation }; }
    case 'unary':
      if (e.op === 'BINARY') return typed('VARBINARY', 'varbinary');
      if (e.op === 'NOT') return BOOL_RESULT();
      if (e.op === '~') return binaryStringOperand(e.arg) ? typed('VARBINARY', 'varbinary') : bigintType(true);
      return negType(staticType(e.arg, row));
    case 'binary':
      if (['AND', 'OR', 'XOR', '=', '!=', '<', '<=', '>', '>=', '<=>'].includes(e.op)) return BOOL_RESULT();
      if (['&', '|', '^', '<<', '>>'].includes(e.op)) return binaryBitwise(e.op, e.left, e.right, row) ? typed('VARBINARY', 'varbinary') : bigintType(true);
      return arithType(e.op, staticType(e.left, row), staticType(e.right, row));
    case 'isnull': case 'is': case 'in': case 'like': case 'between': case 'exists': case 'member': return BOOL_RESULT();
    case 'row': case 'star': return undefined;
    case 'cast': return e.to;
    // A scalar subquery has the type of its one column.
    case 'subquery': {
      const field = e.run?.fields()[0];
      if (field === undefined) return undefined;
      return field.type === 'NULL' ? null : columnForField(field);
    }
    // "The return type of a CASE expression result is the aggregated type of all result values."
    case 'case': return aggregateTypes([...e.whens.map((w) => staticType(w.then, row)), ...(e.otherwise !== undefined ? [staticType(e.otherwise, row)] : [])]);
    case 'call': {
      const arg = (i: number): StaticType => (e.args[i] === undefined ? null : staticType(e.args[i]!, row));
      switch (e.name) {
        // "The return type of COALESCE() is the aggregated type of the argument types." IFNULL(a, b)
        // is the two-argument COALESCE, IF aggregates its two branches and GREATEST/LEAST their
        // arguments.
        case 'COALESCE': case 'IFNULL': case 'GREATEST': case 'LEAST': {
          const t = aggregateTypes(e.args.map((_, i) => arg(i)));
          // a string result is as long as its longest argument's text (manual 14.5, IFNULL: DESCRIBE of `CREATE TABLE tmp
          // SELECT IFNULL(1,'test') AS test` shows a length of 4)
          if (t === null || t === undefined || (t.dataType !== 'VARCHAR' && t.dataType !== 'VARBINARY') || /\(/.test(t.columnType)) return t;
          const lengths = e.args.map((a) => textLength(a, row));
          if (lengths.some((n) => n === undefined)) return t;
          const n = Math.max(0, ...(lengths as number[]));
          return { ...t, columnType: `${t.columnType}(${n})`, length: n };
        }
        // the clock functions, where they are evaluated unbound (INSERT values): the type clockValue gives them bound
        case 'CURDATE': case 'CURRENT_DATE': return synthetic('', 'DATE', 'date');
        case 'UNIX_TIMESTAMP': {
          // with a date whose value has a fractional part, a DECIMAL of that many digits (manual 14.7)
          if (e.args.length === 0) return bigintType(false);
          const a = e.args[0]!;
          const t = staticType(a, row);
          const fsp = t !== null && t !== undefined && TEMPORAL_TYPES.has(t.dataType) ? fspOf(t) : a.kind === 'literal' ? Math.min(6, (/\.(\d+)/.exec(String(a.value ?? ''))?.[1]?.length ?? 0)) : 6;
          return fsp > 0 ? decimalType(12 + fsp, fsp) : bigintType(false);
        }
        case 'FROM_UNIXTIME': {
          if (e.args.length > 1) return typed('VARCHAR', 'varchar');
          const a = e.args[0]; const fsp = a?.kind === 'literal' ? Math.min(6, (/\.(\d+)/.exec(String(a.value ?? ''))?.[1]?.length ?? 0)) : numView(staticType(a ?? { kind: 'literal', value: null, hint: 'NULL' }, row)).scale;
          return synthetic('', 'DATETIME', fsp > 0 ? `datetime(${fsp})` : 'datetime');
        }
        case 'STR_TO_DATE': {
          // "DATETIME … if the format string contains both date and time parts, or a DATE or TIME value if the string
          // contains only date or time parts" (manual 14.7)
          let f = '%Y-%m-%d %H:%i:%s';
          // a constant format (a literal, GET_FORMAT(…)) decides the type; one read from a row cannot
          try { const v = e.args[1] === undefined ? null : evalExpr(e.args[1], { cells: {}, statement: row?.statement ?? detachedScope() }); if (v !== null) f = v; } catch { /* not constant */ }
          const date = /%[YyMmcbdeDjaWUuVvXx]/.test(f); const time = /%[HkIhlisSTrpf]/.test(f);
          const fsp = /%f/.test(f) ? 6 : 0;
          return date && time ? synthetic('', 'DATETIME', fsp ? `datetime(${fsp})` : 'datetime') : time ? synthetic('', 'TIME', fsp ? `time(${fsp})` : 'time') : synthetic('', 'DATE', 'date');
        }
        case 'STRCMP': case 'SLEEP': return typed('INT', 'int');
        case 'HEX': case 'CONV': return typed('VARCHAR', 'varchar');
        case 'UNHEX': return typed('VARBINARY', 'varbinary');
        case 'CURTIME': case 'CURRENT_TIME': case 'UTC_TIME': {
          const fsp = e.args[0]?.kind === 'literal' ? Number(e.args[0].value) || 0 : 0;
          return synthetic('', 'TIME', fsp > 0 ? `time(${fsp})` : 'time');
        }
        case 'UTC_DATE': return synthetic('', 'DATE', 'date');
        case 'NOW': case 'CURRENT_TIMESTAMP': case 'LOCALTIME': case 'LOCALTIMESTAMP': case 'UTC_TIMESTAMP': case 'SYSDATE': {
          const fsp = e.args[0]?.kind === 'literal' ? Number(e.args[0].value) || 0 : 0;
          return synthetic('', 'DATETIME', fsp > 0 ? `datetime(${fsp})` : 'datetime');
        }
        case 'IF': return aggregateTypes([arg(1), arg(2)]);
        // NULLIF: "The return value has the same type as the first argument."
        case 'NULLIF': { const t = arg(0); return t === null || t === undefined ? t : { ...t, nullable: true }; }
        // Functions that create, extract or aggregate JSON values return JSON (manual 13.5 "The JSON
        // Data Type", 14.17 "JSON Functions", 14.19.1 JSON_ARRAYAGG).
        case 'JSON_ARRAY': case 'JSON_OBJECT': case 'JSON_EXTRACT': case 'JSON_ARRAYAGG': return typed('JSON', 'json');
        // JSON_UNQUOTE, JSON_TYPE and JSON_QUOTE return utf8mb4 strings.
        case 'JSON_UNQUOTE': return typed('LONGTEXT', 'longtext', { collation: 'utf8mb4_bin' });
        case 'JSON_TYPE': case 'JSON_QUOTE': return typed('VARCHAR', 'varchar', { collation: 'utf8mb4_bin' });
        case 'JSON_CONTAINS': case 'JSON_VALID': case 'JSON_LENGTH': case 'JSON_DEPTH': return typed('BIGINT', 'bigint');
        case 'CONCAT': case 'LOWER': case 'LCASE': case 'UPPER': case 'UCASE': case 'TRIM': case 'DATE_FORMAT': case 'GET_FORMAT':
          return staticBinary(e, row?.table) ? typed('VARBINARY', 'varbinary') : typed('VARCHAR', 'varchar');
        case 'DATABASE': case 'SCHEMA': case 'VERSION': return typed('VARCHAR', 'varchar', { collation: 'utf8mb3_general_ci' });
        case 'CONVERT_TZ': { const t = arg(0); const fsp = t !== null && t !== undefined ? fspOf(t) : 0; return typed('DATETIME', `datetime${fsp > 0 ? `(${fsp})` : ''}`); }
        case 'LENGTH': case 'OCTET_LENGTH': case 'CHAR_LENGTH': case 'CHARACTER_LENGTH': return typed('BIGINT', 'bigint');
        case 'ROUND': return roundType(e, arg(0));
        case 'ABS': { const t = arg(0); const v = numView(t); return v.k === 'double' ? DOUBLE_RESULT() : v.k === 'null' ? bigintType(false) : v.k === 'int' ? bigintType(v.unsigned) : decimalType(v.int + v.scale, v.scale); }
        case 'VALUES': { const a = e.args[0]; return a !== undefined && a.kind === 'column' && row !== undefined ? columnOf(row, a.name) : undefined; }
        case 'COUNT': case 'SUM': case 'AVG': case 'MIN': case 'MAX': case 'GROUP_CONCAT': return aggregateColumn(e, e.args, '');
        default: return typed('VARCHAR', 'varchar');
      }
    }
    default: return undefined;
  }
}

/** Unary minus keeps an exact operand's type (an integer becomes a signed BIGINT) and makes
 *  anything else a DOUBLE. */
function negType(t: StaticType): ColumnDef {
  const v = numView(t);
  if (v.k === 'double') return DOUBLE_RESULT();
  if (v.k === 'decimal') return decimalType(v.int + v.scale, v.scale);
  return bigintType(false);
}

const INT_TYPES = ['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT'];
const intRank = (d: string): number => {
  if (d === 'BOOL' || d === 'BOOLEAN') return 0;
  if (d === 'INTEGER' || d === 'YEAR') return 3; // "YEAR arguments are treated similar to INT"
  if (d === 'BIT') return 4; // "BIT arguments are treated similar to BIGINT"
  return INT_TYPES.indexOf(d);
};
/** Integer digits of each integer rank, for the DECIMAL a mixed aggregate widens to. */
const INT_DIGITS = [3, 5, 8, 10, 19];
const TEXT_TYPES = new Set(['TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT']);
const CHAR_TYPES = new Set(['CHAR', 'VARCHAR', 'ENUM', 'SET']);

/**
 * MySQL's type aggregation for CASE/COALESCE/IFNULL/IF/GREATEST/LEAST, transcribed rule by rule
 * from the manual (8.0, 14.5 "Flow Control Functions", CASE): numeric → DOUBLE if any is double
 * precision, else DECIMAL if any is DECIMAL, else the widest integer (signed mixed with unsigned is
 * signed one rank wider; unsigned BIGINT with a signed integer is DECIMAL scale 0); all BIT → BIT,
 * all YEAR → YEAR; all CHAR/VARCHAR (SET and ENUM alike) → VARCHAR; character or binary strings →
 * VARBINARY; all JSON → JSON; all temporal → DATE/TIME/TIMESTAMP when uniform, else DATETIME; any
 * BLOB (TEXT is a BLOB with a charset) → BLOB; every other combination → VARCHAR, so JSON mixed
 * with a string is VARCHAR; literal NULLs are ignored. Operands of one identical type keep it.
 */
/** The most characters an expression's value can hold as text, where its type says: a literal's own text, a character
 *  type's length, an integer's digits and sign; undefined where the twin cannot say. */
function textLength(e: Expr, row: EvalRow | undefined): number | undefined {
  if (e.kind === 'literal') return e.value === null ? 0 : [...e.value].length;
  const t = staticType(e, row);
  if (t === null) return 0;
  if (t === undefined) return undefined;
  if (CHAR_TYPES.has(t.dataType) || BINARY_TYPES.has(t.dataType)) return t.length ?? undefined;
  const r = intRank(t.dataType);
  if (r >= 0) return (r === 4 && t.unsigned ? 20 : INT_DIGITS[r]!) + (t.unsigned ? 0 : 1);
  if (t.dataType === 'DECIMAL') { const [p2, sc] = precisionScale(t); return p2 + (sc > 0 ? 1 : 0) + 1; }
  return undefined;
}

function aggregateTypes(parts: StaticType[]): StaticType {
  if (parts.some((p) => p === undefined)) return undefined;
  const live = parts.filter((p): p is ColumnDef => p !== null && p !== undefined);
  if (live.length === 0) return null;
  const dts = live.map((p) => p.dataType);
  const every = (f: (d: string) => boolean): boolean => dts.every(f);
  const first = live[0]!;
  if (first.dataType !== 'ENUM' && first.dataType !== 'SET'
    && live.every((p) => p.dataType === first.dataType && p.columnType === first.columnType && p.unsigned === first.unsigned)) {
    return { ...first, name: '', nullable: true, primaryKey: false, unique: false, autoIncrement: false };
  }
  if (every((d) => d === 'BIT')) return typed('BIT', 'bit');
  if (every((d) => d === 'YEAR')) return typed('YEAR', 'year');
  if (live.every((p) => p.dataType === 'BIT' || isNumericVitessType(vitessTypeFor(p)))) {
    if (every((d) => d === 'FLOAT')) return typed('FLOAT', 'float');
    if (dts.some((d) => ['FLOAT', 'DOUBLE', 'REAL'].includes(d))) return DOUBLE_RESULT();
    const unsignedBig = live.some((p) => p.unsigned && intRank(p.dataType) === 4);
    const signedInt = live.some((p) => !p.unsigned && intRank(p.dataType) >= 0);
    if (dts.some((d) => d === 'DECIMAL' || d === 'NUMERIC') || (unsignedBig && signedInt)) {
      let scale = 0; let digits = 0;
      for (const p of live) {
        const r = intRank(p.dataType);
        if (r >= 0) { digits = Math.max(digits, r === 4 && p.unsigned ? 20 : INT_DIGITS[r]!); continue; }
        const [pp, s] = precisionScale(p); scale = Math.max(scale, s); digits = Math.max(digits, pp - s);
      }
      return decimalType(digits + scale, scale);
    }
    const signed = live.filter((p) => !p.unsigned).map((p) => intRank(p.dataType));
    const unsigned = live.filter((p) => p.unsigned).map((p) => intRank(p.dataType));
    const rank = signed.length === 0 ? Math.max(...unsigned) : Math.min(4, Math.max(...signed, ...unsigned.map((r) => r + 1)));
    const dataType = INT_TYPES[rank]!;
    const isUnsigned = signed.length === 0;
    return typed(dataType, `${dataType.toLowerCase()}${isUnsigned ? ' unsigned' : ''}`, { unsigned: isUnsigned });
  }
  if (every((d) => CHAR_TYPES.has(d))) return typed('VARCHAR', 'varchar');
  if (every((d) => d === 'JSON')) return typed('JSON', 'json');
  if (every((d) => TEMPORAL_TYPES.has(d))) {
    const fsp = Math.max(...live.map(fspOf));
    const suffix = fsp > 0 ? `(${fsp})` : '';
    if (every((d) => d === 'DATE')) return typed('DATE', 'date');
    for (const t of ['TIME', 'TIMESTAMP']) if (every((d) => d === t)) return typed(t, `${t.toLowerCase()}${suffix}`);
    return typed('DATETIME', `datetime${suffix}`);
  }
  if (dts.some((d) => TEXT_TYPES.has(d) || BINARY_TYPES.has(d) && d.endsWith('BLOB'))) {
    return dts.some((d) => BINARY_TYPES.has(d)) ? typed('LONGBLOB', 'longblob') : typed('LONGTEXT', 'longtext');
  }
  if (every((d) => CHAR_TYPES.has(d) || BINARY_TYPES.has(d))) return typed('VARBINARY', 'varbinary');
  return typed('VARCHAR', 'varchar');
}

// ── OPERANDS AND CONVERSIONS (manual 14.3 "Type Conversion in Expression Evaluation") ────────

/** An operand of a comparison: its type, the class it compares in, and (for strings) the
 *  collation and derivation it brings. */
type Operand = { cls: Cls; dt: DT; type: ColumnDef | null };

const operandCache = new WeakMap<Expr, { table: TableDef | undefined; op: Operand }>(); // cache: per-node derivation within one statement's AST

function operandOf(e: Expr, row: EvalRow): Operand {
  const hit = operandCache.get(e);
  if (hit !== undefined && hit.table === row.table) return hit.op;
  const type = staticType(e, row);
  const cls = clsOf(type);
  let dt: DT;
  if (cls === 'string' || cls === 'binary') {
    const k = exprKind(e, row);
    dt = k.kind === 'string' || k.kind === 'binary' ? k.dt
      : cls === 'binary' ? { collation: BINARY_COLLATION, derivation: IMPLICIT }
        : { collation: collationNamed(type?.collation) ?? databaseCollation(), derivation: k.kind === 'null' ? IGNORABLE : NUMERIC_DERIVATION };
  } else dt = cls === 'null' ? nullKind().dt : numericDt();
  const op: Operand = { cls, dt, type: type ?? null };
  if (e.kind !== 'subquery' || e.run !== undefined) operandCache.set(e, { table: row.table, op });
  return op;
}

/** The operand a type presents (a result field of a subquery, a stored column). */
function typeOperand(type: ColumnDef | null): Operand {
  const cls = clsOf(type);
  const dt = type === null ? nullKind().dt : columnKind(type).dt;
  return { cls, dt, type };
}

function fieldOperand(field: Field): Operand {
  return typeOperand(field.type === 'NULL' ? null : columnForField(field));
}

const ZERO: Dec = { m: 0n, s: 0 };
const temporalKindOf = (t: ColumnDef | null): TemporalKind => (t !== null && TEMPORAL_TYPES.has(t.dataType) ? t.dataType as TemporalKind : 'DATETIME');

/** A stored or computed temporal's parts (its canonical text; a value written by an older build
 *  may carry another spelling, which is read the way MySQL would read it). */
function temporalParts(v: string, kind: TemporalKind): TemporalParse | null {
  if (kind === 'TIME') return parseTimeText(v);
  return parseDateTimeText(v) ?? parseTemporalNumber(v, kind);
}

/** A value in exact (DECIMAL) context. */
function toDec(v: string, o: Operand): Dec {
  if (o.cls === 'temporal') {
    const kind = temporalKindOf(o.type); const p = temporalParts(v, kind);
    return p === null ? ZERO : parseDec(temporalNumberText(p.t, kind, o.type === null ? 0 : fspOf(o.type))) ?? ZERO;
  }
  if (o.cls === 'double') return decFromNumber(Number(v));
  if (o.cls === 'json') { try { const j = parseJson(v); return j instanceof JNum ? j.exact() : ZERO; } catch { return ZERO; } }
  return parseDec(v) ?? decFromNumber(stringNumberPrefix(v).value);
}

/** A value in DOUBLE context: a string by its numeric prefix (`'1abc'` is 1, `'abc'` 0). */
function toDouble(v: string, o: Operand): number {
  switch (o.cls) {
    case 'string': case 'binary': case 'null': return stringNumberPrefix(v).value;
    case 'temporal': return Number(decText(toDec(v, o)));
    case 'json': { try { const j = parseJson(v); return j instanceof JNum ? (j.kind === 'int' ? Number(j.int) : j.dbl) : 0; } catch { return 0; } }
    default: { const n = Number(v); return Number.isNaN(n) ? stringNumberPrefix(v).value : n; }
  }
}

/** A value in temporal context, packed for ordering: a string or number is read as a DATETIME
 *  (a TIME when `time`), an unreadable one as MySQL's zero value. */
function toPacked(v: string, o: Operand, time: boolean): bigint {
  let p: TemporalParse | null;
  if (o.cls === 'temporal') p = temporalParts(v, temporalKindOf(o.type));
  else if (o.cls === 'int' || o.cls === 'decimal' || o.cls === 'double') p = parseTemporalNumber(v, time ? 'TIME' : 'DATETIME');
  else p = time ? parseTimeText(v) : parseDateTimeText(v) ?? parseTemporalNumber(v, 'DATETIME');
  if (p === null) return 0n;
  return packTemporal(p.t, time || temporalKindOf(o.type) === 'TIME' && o.cls === 'temporal' ? 'TIME' : 'DATETIME');
}

/** A temporal's JSON form: DATETIME/TIMESTAMP/TIME with microseconds, as MySQL prints one. */
function jsonTemporal(v: string, o: Operand): string {
  const kind = temporalKindOf(o.type); const p = temporalParts(v, kind);
  if (p === null) return v;
  return formatTemporal(p.t, kind === 'TIMESTAMP' ? 'DATETIME' : kind, kind === 'DATE' ? 0 : 6);
}

/** A value as a JSON value: JSON-typed values parse, numbers stay numbers, temporals become their
 *  text, and every other string is a JSON string (manual 13.5: comparing JSON with a non-JSON
 *  value converts the latter to JSON). */
function toJson(v: string, o: Operand): JV {
  switch (o.cls) {
    case 'json': try { return parseJson(v); } catch { return v; }
    case 'int': { const d = parseDec(v); return d !== null && d.s === 0 ? JNum.int(d.m) : JNum.double(Number(v)); }
    case 'decimal': return JNum.decimal(parseDec(v) ?? ZERO);
    case 'double': return JNum.double(Number(v));
    case 'temporal': return jsonTemporal(v, o);
    default: return v;
  }
}

/** An expression whose value is a truth value, which JSON_ARRAY/JSON_OBJECT/JSON_ARRAYAGG embed as
 *  `true`/`false` (MySQL's `is_bool_func`), as they do the literals TRUE and FALSE. */
function isBoolExpr(e: Expr): boolean {
  switch (e.kind) {
    case 'isnull': case 'is': case 'in': case 'like': case 'between': case 'exists': case 'member': return true;
    case 'unary': return e.op === 'NOT';
    case 'binary': return ['AND', 'OR', 'XOR', '=', '!=', '<', '<=', '>', '>=', '<=>'].includes(e.op);
    case 'literal': return e.hint === 'INT8';
    default: return false;
  }
}

/** An SQL value as the JSON value JSON_ARRAY/JSON_OBJECT/JSON_ARRAYAGG embed. */
function sqlToJson(e: Expr, v: Cell, row: EvalRow): JV {
  if (v === null) return null;
  if (isBoolExpr(e)) return truthy(v) === true;
  return toJson(v, operandOf(e, row));
}

// ── COMPARISON ───────────────────────────────────────────────────────────────────────────────
// Two operands compare as (manual 14.3): JSON when either is JSON (the other converted to JSON, a
// string becoming a JSON string); strings under their collation when both are strings; exact
// DECIMAL when both are integers or decimals; temporals as points in time when both are temporal
// or one is temporal and the other a string (the string read as a DATETIME, or a TIME against a
// TIME); a temporal against a number as its number; and DOUBLE in every other case — so `'abc' = 0`
// is true and `'1abc' = 1` is true, as MySQL answers.

type CmpMode = 'exact' | 'double' | 'string' | 'temporal' | 'time' | 'json';

function pairMode(x: Operand, y: Operand): CmpMode {
  const a = x.cls === 'null' ? y.cls : x.cls; const b = y.cls === 'null' ? x.cls : y.cls;
  if (a === 'json' || b === 'json') return 'json';
  const str = (c: Cls): boolean => c === 'string' || c === 'binary' || c === 'null';
  if (str(a) && str(b)) return 'string';
  if (a === 'temporal' || b === 'temporal') {
    const other = a === 'temporal' ? b : a; const self = a === 'temporal' ? x : y;
    if (other === 'temporal' || str(other)) {
      const otherOp = a === 'temporal' ? y : x;
      const times = [self, otherOp].filter((o) => o.cls === 'temporal').every((o) => temporalKindOf(o.type) === 'TIME');
      return times ? 'time' : 'temporal';
    }
    return other === 'double' ? 'double' : 'exact';
  }
  const exact = (c: Cls): boolean => c === 'int' || c === 'decimal';
  if (exact(a) && exact(b)) return 'exact';
  return 'double';
}

/** The collation the string operands of a comparison are compared under (their aggregate, errno
 *  1267 on an illegal mix), or undefined when no operand is a string. */
function comparisonCollation(ops: Operand[], op: string): Collation | undefined {
  const strings = ops.filter((o) => o.cls === 'string' || o.cls === 'binary');
  if (strings.length === 0) return undefined;
  let dt = strings[0]!.dt;
  for (const o of strings.slice(1)) dt = aggregate(dt, o.dt);
  if (dt.derivation === NONE) throw illegalMix(strings.map((o) => o.dt), op);
  return dt.collation;
}

function compareIn(mode: CmpMode, x: Operand, y: Operand, a: string, b: string, collation: Collation | undefined): number {
  switch (mode) {
    case 'exact': return decCmp(toDec(a, x), toDec(b, y));
    case 'double': { const p = toDouble(a, x); const q = toDouble(b, y); return p < q ? -1 : p > q ? 1 : 0; }
    case 'temporal': case 'time': { const p = toPacked(a, x, mode === 'time'); const q = toPacked(b, y, mode === 'time'); return p < q ? -1 : p > q ? 1 : 0; }
    case 'json': return compareJson(toJson(a, x), toJson(b, y));
    default: {
      const c = collation ?? databaseCollation();
      if (c.charset === 'binary') { if (x.cls !== 'binary') a = toByteString(a); if (y.cls !== 'binary') b = toByteString(b); }
      return c.compare(a, b);
    }
  }
}

/** Compare operand i's value with operand j's under MySQL's rules for the pair. */
type Comparer = (i: number, j: number, a: Cell, b: Cell) => number | null;
function comparer(ops: Operand[], op: string): Comparer {
  const collation = comparisonCollation(ops, op);
  return (i, j, a, b) => (a === null || b === null ? null : compareIn(pairMode(ops[i]!, ops[j]!), ops[i]!, ops[j]!, a, b, collation));
}

const comparerCache = new WeakMap<Expr, { table: TableDef | undefined; cmp: Comparer }>(); // cache: per-node comparison within one statement's AST
function comparerFor(e: Expr, operands: Expr[], row: EvalRow, op: string): Comparer {
  const hit = comparerCache.get(e);
  if (hit !== undefined && hit.table === row.table) return hit.cmp;
  const cmp = comparer(operands.map((x) => operandOf(x, row)), op);
  comparerCache.set(e, { table: row.table, cmp });
  return cmp;
}

function keyIn(mode: CmpMode, o: Operand, v: string, collation: Collation | undefined): string {
  switch (mode) {
    case 'exact': return `n${decKey(toDec(v, o))}`;
    case 'double': { const n = toDouble(v, o); return `d${n === 0 ? 0 : n}`; }
    case 'temporal': case 'time': return `t${toPacked(v, o, mode === 'time')}`;
    case 'json': return `j${jsonKey(toJson(v, o))}`;
    default: {
      const c = collation ?? databaseCollation();
      return `s${c.key(c.charset === 'binary' && o.cls !== 'binary' ? toByteString(v) : v)}`;
    }
  }
}

/** The equality key two operands' values meet under when compared (a join's hash probe): the
 *  pair's comparison, expressed per side. */
function pairKeyers(ops: [Operand, Operand], op: string): [(v: Cell) => string | null, (v: Cell) => string | null] {
  const mode = pairMode(ops[0], ops[1]);
  const collation = comparisonCollation(ops, op);
  const side = (o: Operand) => (v: Cell): string | null => (v === null ? null : keyIn(mode, o, v, collation));
  return [side(ops[0]), side(ops[1])];
}

/** A key under which values of ONE operand that compare equal meet (GROUP BY, DISTINCT,
 *  COUNT(DISTINCT)): numbers by exact value, temporals as points in time, JSON by document,
 *  strings by collation key. */
function keyer(o: Operand): (v: Cell) => string | null {
  const mode: CmpMode = o.cls === 'int' || o.cls === 'decimal' ? 'exact' : o.cls === 'double' ? 'double'
    : o.cls === 'temporal' ? (temporalKindOf(o.type) === 'TIME' ? 'time' : 'temporal') : o.cls === 'json' ? 'json' : 'string';
  if (mode === 'string') {
    if (o.cls !== 'string') return (v) => (v === null ? null : `s${v}`);
    const c = o.dt.collation; return (v) => (v === null ? null : `s${c.key(v)}`);
  }
  return (v) => (v === null ? null : keyIn(mode, o, v, undefined));
}

/** The order one operand sorts in, by its own type, as a sort key per value and a comparison of
 *  keys (so a sort converts each value once). */
type OrderKey = { key: (v: string) => unknown; cmp: (a: unknown, b: unknown) => number };
const natural = (a: unknown, b: unknown): number => ((a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0);
function orderKey(o: Operand): OrderKey {
  switch (o.cls) {
    case 'int': case 'decimal': return { key: (v) => toDec(v, o), cmp: (a, b) => decCmp(a as Dec, b as Dec) };
    case 'double': return { key: (v) => toDouble(v, o), cmp: natural };
    case 'temporal': { const time = temporalKindOf(o.type) === 'TIME'; return { key: (v) => toPacked(v, o, time), cmp: natural }; }
    case 'json': return { key: (v) => toJson(v, o), cmp: (a, b) => compareJson(a as JV, b as JV) };
    case 'string': { const c = o.dt.collation; return { key: (v) => v, cmp: (a, b) => c.compare(a as string, b as string) }; }
    default: return { key: (v) => v, cmp: natural };
  }
}
function sorter(o: Operand): (a: string, b: string) => number {
  const k = orderKey(o);
  return (a, b) => k.cmp(k.key(a), k.key(b));
}

/** The key a UNIQUE/PRIMARY KEY value of `column` is enforced (and locked) under: two values
 *  collide exactly when the column's collation calls them equal (MySQL errno 1062). */
export function uniqueKeyPart(column: ColumnDef | undefined, value: string): string {
  if (column === undefined) return `s${value}`;
  const kind = columnKind(column);
  return kind.kind === 'string' ? `s${kind.dt.collation.key(value)}` : `s${value}`;
}

// ── EVALUATION ───────────────────────────────────────────────────────────────────────────────

/** A text rendering of an expression for MySQL's out-of-range messages (`'(`id` + 1)'`). */
function renderExpr(e: Expr): string {
  switch (e.kind) {
    case 'literal': return e.value === null ? 'NULL' : e.hint === 'VARCHAR' ? `'${e.value}'` : e.value;
    case 'column': return e.table === undefined ? `\`${e.name}\`` : `\`${e.table}\`.\`${e.name}\``;
    case 'slot': return `\`${e.col}\``;
    case 'binary': return `(${renderExpr(e.left)} ${e.op === 'DIV' ? 'DIV' : e.op} ${renderExpr(e.right)})`;
    case 'unary': return `${e.op === 'NOT' ? 'NOT ' : e.op}${renderExpr(e.arg)}`;
    case 'call': return `${e.name.toLowerCase()}(${e.args.map(renderExpr).join(',')})`;
    default: return '…';
  }
}

const outOfRange = (type: string, e: Expr): SqlError =>
  new SqlError(`${type} value is out of range in '${renderExpr(e)}'`, 'INVALID_ARGUMENT', 1690, '22003');

/** An integer result, checked against its type's range (errno 1690, as MySQL raises). */
function intResult(n: bigint, unsigned: boolean, e: Expr): string {
  if (unsigned ? n < 0n || n > UINT64_MAX : n < INT64_MIN || n > INT64_MAX) throw outOfRange(unsigned ? 'BIGINT UNSIGNED' : 'BIGINT', e);
  return n.toString();
}

/** A division or modulo by zero: NULL, except in a value an INSERT/UPDATE stores (errno 1365). */
function divisionByZero(row: EvalRow): null {
  if (row.write === true && row.statement.mode.divisionError) throw new SqlError('Division by 0', 'INVALID_ARGUMENT', 1365, '22012');
  return null;
}

/** Round half to even, C's rint(): how MySQL converts a DOUBLE to an integer. */
function rint(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}
const roundDecToInt = (d: Dec): bigint => decRound(d, 0).m;

function evalArith(e: Extract<Expr, { kind: 'binary' }>, row: EvalRow): Cell {
  const l = evalExpr(e.left, row); const r = evalExpr(e.right, row);
  if (l === null || r === null) return null;
  const lo = operandOf(e.left, row); const ro = operandOf(e.right, row);
  const t = staticType(e, row)!;
  if (clsOf(t) === 'double') {
    const a = toDouble(l, lo); const b = toDouble(r, ro);
    let out: number;
    switch (e.op) {
      case '+': out = a + b; break;
      case '-': out = a - b; break;
      case '*': out = a * b; break;
      case '/': if (b === 0) return divisionByZero(row); out = a / b; break;
      case '%': if (b === 0) return divisionByZero(row); out = a % b; break;
      default: { if (b === 0) return divisionByZero(row); return intResult(BigInt(Math.trunc(a / b)), false, e); }
    }
    if (!Number.isFinite(out)) throw outOfRange('DOUBLE', e);
    return formatDouble(out);
  }
  const exactOf = (v: string, o: Operand): Dec => (o.cls === 'double' || o.cls === 'string' || o.cls === 'binary' ? decFromNumber(toDouble(v, o)) : toDec(v, o));
  const a = exactOf(l, lo); const b = exactOf(r, ro);
  if (e.op === 'DIV') {
    if (decIsZero(b)) return divisionByZero(row);
    const q = decDiv(a, b, 1)!;
    return intResult(decTrunc(q), t.unsigned, e);
  }
  let out: Dec;
  switch (e.op) {
    case '+': out = decAdd(a, b); break;
    case '-': out = decSub(a, b); break;
    case '*': out = decMul(a, b); break;
    case '/': { const [, scale] = precisionScale(t); const q = decDiv(a, b, scale); if (q === null) return divisionByZero(row); out = q; break; }
    default: { const m = decMod(a, b); if (m === null) return divisionByZero(row); out = m; }
  }
  if (clsOf(t) === 'int') return intResult(decTrunc(out), t.unsigned, e);
  return decText(out, precisionScale(t)[1]);
}

/** A value as the unsigned 64-bit integer MySQL's bit operators work on. */
function toUint64(v: string, o: Operand): bigint {
  const n = o.cls === 'int' || o.cls === 'decimal' || o.cls === 'temporal' ? roundDecToInt(toDec(v, o)) : BigInt(rint(Math.max(-1.8446744073709552e19, Math.min(1.8446744073709552e19, toDouble(v, o)))));
  return BigInt.asUintN(64, n);
}

function evalBitwise(e: Extract<Expr, { kind: 'binary' }>, row: EvalRow): Cell {
  const l = evalExpr(e.left, row); const r = evalExpr(e.right, row);
  if (l === null || r === null) return null;
  if (binaryBitwise(e.op, e.left, e.right, row)) {
    // binary-string mode: the operation on the bytes, the result as long as the argument (manual 14.12; unequal lengths
    // are "ER_INVALID_BITWISE_OPERANDS_SIZE", errno 3513)
    if (e.op === '<<' || e.op === '>>') {
      const n = Number(toUint64(r, operandOf(e.right, row)));
      let bits = [...l].map((c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join('');
      bits = e.op === '<<' ? (bits.slice(Math.min(n, bits.length)) + '0'.repeat(Math.min(n, bits.length))) : ('0'.repeat(Math.min(n, bits.length)) + bits.slice(0, Math.max(0, bits.length - n)));
      let out = ''; for (let i = 0; i < bits.length; i += 8) out += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
      return out;
    }
    if (l.length !== r.length) throw new SqlError('Binary operands of bitwise operators must be of equal length', 'INVALID_ARGUMENT', 3513, 'HY000');
    let out = '';
    for (let i = 0; i < l.length; i++) {
      const a = l.charCodeAt(i); const b = r.charCodeAt(i);
      out += String.fromCharCode(e.op === '&' ? a & b : e.op === '|' ? a | b : a ^ b);
    }
    return out;
  }
  const a = toUint64(l, operandOf(e.left, row)); const b = toUint64(r, operandOf(e.right, row));
  switch (e.op) {
    case '&': return (a & b).toString();
    case '|': return (a | b).toString();
    case '^': return (a ^ b).toString();
    case '<<': return b >= 64n ? '0' : BigInt.asUintN(64, a << b).toString();
    default: return b >= 64n ? '0' : (a >> b).toString();
  }
}

/** Convert a CASE/COALESCE/IF/GREATEST result to the expression's aggregated type when that type
 *  is numeric or temporal (`COALESCE(decimal_2, 0)` is `0.00`; `IF(c, 1, 2.5)` gives `1.0`). */
function coerceResult(v: Cell, from: Expr, e: Expr, row: EvalRow): Cell {
  if (v === null) return null;
  const to = staticType(e, row);
  if (to === null || to === undefined) return v;
  const cls = clsOf(to);
  if (cls !== 'int' && cls !== 'decimal' && cls !== 'double' && cls !== 'temporal') return v;
  const src = operandOf(from, row);
  if (src.cls === cls && src.type !== null && src.type.columnType === to.columnType && src.type.dataType === to.dataType) return v;
  if (src.cls === 'int' && cls === 'int') return v;
  return castValue(v, src, to, row.statement);
}

export function evalExpr(e: Expr, row: EvalRow): Cell {
  switch (e.kind) {
    case 'literal': return e.value;
    case 'column': return readColumn(row, e);
    case 'star': throw unsupported('`*` outside a select list');
    case 'unary': {
      if (e.op === 'BINARY') {
        const value = evalExpr(e.arg, row);
        return value === null || staticBinary(e.arg, row.table) ? value : toByteString(value);
      }
      if (e.op === 'NOT') { const t = truthy(evalExpr(e.arg, row)); return t === null ? null : t ? '0' : '1'; }
      const value = evalExpr(e.arg, row);
      if (value === null) return null;
      const o = operandOf(e.arg, row);
      if (e.op === '~') {
        // binary-string mode inverts each byte (manual 14.12, "~")
        if (binaryStringOperand(e.arg)) return [...value].map((c) => String.fromCharCode(~c.charCodeAt(0) & 0xff)).join('');
        return (UINT64_MAX ^ toUint64(value, o)).toString();
      }
      const t = staticType(e, row)!;
      if (clsOf(t) === 'double') return formatDouble(-toDouble(value, o));
      const neg = decNeg(toDec(value, o));
      return clsOf(t) === 'int' ? intResult(decTrunc(neg), false, e) : decText(neg, precisionScale(t)[1]);
    }
    case 'isnull': {
      const v = evalExpr(e.arg, row);
      return (v === null) !== e.negated ? '1' : '0';
    }
    // IS [NOT] TRUE/FALSE/UNKNOWN tests truthiness and never returns NULL (manual 14.4.2).
    case 'is': {
      const t = truthy(evalExpr(e.arg, row));
      const hit = e.value === 'UNKNOWN' ? t === null : e.value === 'TRUE' ? t === true : t === false;
      return hit !== e.negated ? '1' : '0';
    }
    case 'member': {
      const v = evalExpr(e.arg, row); const d = evalExpr(e.doc, row);
      if (v === null || d === null) return null;
      const doc = jsonDocument(e.doc, d, 2, 'member of', row);
      const want = sqlToJson(e.arg, v, row);
      return (Array.isArray(doc) ? doc : [doc]).some((x) => compareJson(x, want) === 0) ? '1' : '0';
    }
    case 'cast': {
      if (e.atTimeZone !== undefined) {
        // the TIMESTAMP's instant, read in UTC: its value is written in the session time zone
        const src = operandOf(e.arg, row);
        if (src.type?.dataType !== 'TIMESTAMP') throw new SqlError(`Incorrect arguments to AT TIME ZONE`, 'INVALID_ARGUMENT', 1210, 'HY000');
        const v = evalExpr(e.arg, row);
        if (v === null) return null;
        const p = temporalFrom(v, src, 'DATETIME');
        if (p === null) return null;
        const instant = zoneInstant(temporalUtcMs(p.t), row.statement.timeZone) ?? temporalUtcMs(p.t);
        return formatTemporal(temporalFromUtcMs(instant, p.t.us), 'DATETIME', fspOf(e.to));
      }
      return castValue(evalExpr(e.arg, row), operandOf(e.arg, row), e.to, row.statement);
    }
    case 'slot': return row.tuple?.[e.src]?.[e.col] ?? null;
    case 'row': throw operandColumns(1);
    case 'subquery': {
      const result = runSubquery(e, row);
      if (result.fields.length !== 1) throw operandColumns(1);
      if (result.rows.length > 1) throw new SqlError('Subquery returns more than 1 row', 'INVALID_ARGUMENT', 1242, '21000');
      return result.rows[0]?.[0] ?? null;
    }
    case 'exists': return runSubquery(e, row).rows.length > 0 ? '1' : '0';
    case 'collate': { exprKind(e, row); return evalExpr(e.arg, row); }
    case 'case': {
      // A simple CASE compares its operand with every WHEN value under one collation (10.8.4).
      const cmp = e.operand === undefined ? undefined : comparerFor(e, [e.operand, ...e.whens.map((w) => w.when)], row, 'case');
      const operand = e.operand === undefined ? null : evalExpr(e.operand, row);
      for (let k = 0; k < e.whens.length; k++) {
        const { when, then } = e.whens[k]!;
        const hit = cmp === undefined
          ? truthy(evalExpr(when, row)) === true
          : cmp(0, k + 1, operand, evalExpr(when, row)) === 0;
        if (hit) return coerceResult(evalExpr(then, row), then, e, row);
      }
      return e.otherwise === undefined ? null : coerceResult(evalExpr(e.otherwise, row), e.otherwise, e, row);
    }
    case 'in': {
      // `x IN (…)` is `x = a OR x = b …` with MySQL's NULL rule: no match and a NULL comparison
      // anywhere is NULL, not FALSE. A row constructor compares element-wise, each position under
      // the comparison of that position's operands.
      const width = e.arg.kind === 'row' ? e.arg.items.length : 1;
      let sawNull = false;
      if (e.subquery !== undefined) {
        const result = runSubquery(e, row);
        if (result.fields.length !== width) throw operandColumns(width);
        const left = e.arg.kind === 'row' ? e.arg.items : [e.arg];
        const lv = left.map((x) => evalExpr(x, row));
        const cmps = left.map((x, i) => comparer([operandOf(x, row), fieldOperand(result.fields[i]!)], 'in'));
        for (const r of result.rows) {
          const cmp = rowEquality(lv, r, (i, a, b) => cmps[i]!(0, 1, a, b));
          if (cmp === true) return e.negated ? '0' : '1';
          if (cmp === null) sawNull = true;
        }
        return sawNull ? null : e.negated ? '1' : '0';
      }
      if (e.arg.kind === 'row') {
        const left = e.arg.items;
        for (const item of e.list) if (item.kind !== 'row' || item.items.length !== width) throw operandColumns(width);
        const rows = e.list as Array<Extract<Expr, { kind: 'row' }>>;
        const lv = left.map((x) => evalExpr(x, row));
        const cmps = left.map((x, i) => comparer([x, ...rows.map((r) => r.items[i]!)].map((o) => operandOf(o, row)), 'in'));
        for (let k = 0; k < rows.length; k++) {
          const rv = rows[k]!.items.map((x) => evalExpr(x, row));
          const cmp = rowEquality(lv, rv, (i, a, b) => cmps[i]!(0, k + 1, a, b));
          if (cmp === true) return e.negated ? '0' : '1';
          if (cmp === null) sawNull = true;
        }
        return sawNull ? null : e.negated ? '1' : '0';
      }
      const v = evalExpr(e.arg, row);
      if (v === null) return null;
      for (const item of e.list) if (item.kind === 'row') throw operandColumns(1);
      const cmp = comparerFor(e, [e.arg, ...e.list], row, 'in');
      for (let k = 0; k < e.list.length; k++) {
        const iv = evalExpr(e.list[k]!, row);
        if (iv === null) { sawNull = true; continue; }
        if (cmp(0, k + 1, v, iv) === 0) return e.negated ? '0' : '1';
      }
      // MySQL: `x IN (1, NULL)` with no match is NULL, not FALSE.
      if (sawNull) return null;
      return e.negated ? '1' : '0';
    }
    case 'like': {
      const v = evalExpr(e.arg, row);
      let p = evalExpr(e.pattern, row);
      if (v === null || p === null) return null;
      if (e.escape !== undefined) {
        const esc = evalExpr(e.escape, row) ?? '\\';
        if ([...esc].length > 1) throw new SqlError('Incorrect arguments to ESCAPE', 'INVALID_ARGUMENT', 1210, 'HY000');
        p = withEscape(p, esc);
      }
      // LIKE is a string operation whatever its operands' types: a number or temporal takes the
      // connection collation (NUMERIC derivation), and a binary operand makes the match byte-wise.
      const ops = [exprKind(e.arg, row), exprKind(e.pattern, row)];
      const { dt } = combine(ops, 'like');
      const binary = dt.collation.charset === 'binary';
      const bytes = (x: string, k: number) => (binary && ops[k]!.kind !== 'binary' ? toByteString(x) : x);
      return likeMatch(bytes(v, 0), bytes(p, 1), dt.collation) !== e.negated ? '1' : '0';
    }
    case 'between': {
      // `x BETWEEN a AND b` is `x >= a AND x <= b` in three-valued logic, so `10 NOT BETWEEN NULL
      // AND 5` is TRUE: 10 <= 5 is FALSE whatever the NULL bound is.
      const v = evalExpr(e.arg, row);
      if (v === null) return null;
      const lo = evalExpr(e.low, row);
      const hi = evalExpr(e.high, row);
      const cmp = comparerFor(e, [e.arg, e.low, e.high], row, 'between');
      const a = cmp(0, 1, v, lo); const b = cmp(0, 2, v, hi);
      const inRange = and3(a === null ? null : a >= 0, b === null ? null : b <= 0);
      if (inRange === null) return null;
      return inRange !== e.negated ? '1' : '0';
    }
    case 'call': return evalCall(e, row);
    case 'binary': {
      if (e.op === 'AND' || e.op === 'OR' || e.op === 'XOR') {
        const l = truthy(evalExpr(e.left, row));
        if (e.op === 'AND' && l === false) return '0';
        if (e.op === 'OR' && l === true) return '1';
        const r = truthy(evalExpr(e.right, row));
        if (e.op === 'XOR') return l === null || r === null ? null : l !== r ? '1' : '0';
        if (e.op === 'AND') {
          if (r === false) return '0';
          if (l === null || r === null) return null;
          return '1';
        }
        if (r === true) return '1';
        if (l === null || r === null) return null;
        return '0';
      }
      if (e.left.kind === 'row' || e.right.kind === 'row') return compareRowOperands(e.op, e.left, e.right, row);
      if (['+', '-', '*', '/', '%', 'DIV'].includes(e.op)) return evalArith(e, row);
      if (['&', '|', '^', '<<', '>>'].includes(e.op)) return evalBitwise(e, row);
      const l = evalExpr(e.left, row);
      const r = evalExpr(e.right, row);
      if (e.op === '<=>') {
        // The NULL-safe equality operator: NULL <=> NULL is TRUE, and it never yields NULL.
        if (l === null && r === null) return '1';
        if (l === null || r === null) return '0';
        return comparerFor(e, [e.left, e.right], row, '<=>')(0, 1, l, r) === 0 ? '1' : '0';
      }
      const cmp = comparerFor(e, [e.left, e.right], row, e.op === '!=' ? '<>' : e.op)(0, 1, l, r);
      if (cmp === null) return null;
      switch (e.op) {
        case '=': return cmp === 0 ? '1' : '0';
        case '!=': return cmp !== 0 ? '1' : '0';
        case '<': return cmp < 0 ? '1' : '0';
        case '<=': return cmp <= 0 ? '1' : '0';
        case '>': return cmp > 0 ? '1' : '0';
        case '>=': return cmp >= 0 ? '1' : '0';
        default: throw unsupported(`the ${e.op} operator`);
      }
    }
  }
}

/** MySQL's errno 1241 for an operand of the wrong width: a row where a scalar belongs, or rows of
 *  different widths compared. */
const operandColumns = (n: number): SqlError => new SqlError(`Operand should contain ${n} column(s)`, 'INVALID_ARGUMENT', 1241, '21000');

function runSubquery(e: { run?: SubqueryRun }, row: EvalRow): { fields: Field[]; rows: Cell[][] } {
  // Only a statement BOUND for execution carries `run`; an unbound subquery (a VALUES list, a
  // column DEFAULT) has no FROM scope to run in.
  if (e.run === undefined) throw unsupported('a subquery in this position');
  return e.run(row);
}

/** Compare two scalar operands MySQL's way. */
function compareOperands(a: Expr, b: Expr, row: EvalRow, op = '='): number | null {
  return comparer([operandOf(a, row), operandOf(b, row)], op)(0, 1, evalExpr(a, row), evalExpr(b, row));
}

/** Row equality: FALSE if any pair differs, else NULL if any pair involves NULL, else TRUE. */
function rowEquality(l: Cell[], r: Cell[], compare: (i: number, a: Cell, b: Cell) => number | null): boolean | null {
  let sawNull = false;
  for (let i = 0; i < l.length; i++) {
    const cmp = compare(i, l[i]!, r[i] ?? null);
    if (cmp === null) { sawNull = true; continue; }
    if (cmp !== 0) return false;
  }
  return sawNull ? null : true;
}

/** `(a, b) op (c, d)`: element-wise for `=`/`<>`/`<=>`, lexicographic for the orderings (MySQL 8
 *  manual, "Row Constructor Expression Optimization"). Both sides must have the same width. */
function compareRowOperands(op: string, left: Expr, right: Expr, row: EvalRow): Cell {
  const items = (x: Expr): Expr[] => (x.kind === 'row' ? x.items : [x]);
  const l = items(left); const r = items(right);
  if (l.length !== r.length) throw operandColumns(l.length);
  const pairs = l.map((x, i) => compareOperands(x, r[i]!, row, op === '!=' ? '<>' : op));
  if (op === '<=>') {
    const ok = l.every((x, i) => { const a = evalExpr(x, row); const b = evalExpr(r[i]!, row); return (a === null && b === null) || (a !== null && b !== null && pairs[i] === 0); });
    return ok ? '1' : '0';
  }
  if (op === '=' || op === '!=') {
    const eq = rowEquality(pairs.map(() => '0'), pairs.map((p) => (p === null ? null : String(p))), (_, a, b) => (a === null || b === null ? null : a === b ? 0 : 1));
    if (eq === null) return null;
    return (op === '=') === eq ? '1' : '0';
  }
  for (const p of pairs) {
    if (p === null) return null;
    if (p !== 0) return (op === '<' || op === '<=') === (p < 0) ? '1' : '0';
  }
  return op === '<=' || op === '>=' ? '1' : '0';
}

// ── CAST AND STORE: converting a value to a type ─────────────────────────────────────────────

/** Decode a byte string (one char per byte) as UTF-8; null when the bytes are not valid UTF-8. */
function utf8Of(bytes: string): string | null {
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i) & 0xff;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(arr); } catch { return null; }
}

/** A value's parts as a temporal of `kind`, read from its own type: another temporal converted
 *  (a DATETIME's date for a DATE, its time of day for a TIME), a number as `YYYYMMDD[hhmmss]` /
 *  `hhmmss`, a string in any literal form MySQL accepts. Null when it is not one. */
function temporalFrom(v: string, from: Operand, kind: TemporalKind): TemporalParse | null {
  if (from.cls === 'temporal') {
    const fromKind = temporalKindOf(from.type);
    const p = temporalParts(v, fromKind);
    if (p === null) return null;
    if (kind === 'TIME') return fromKind === 'TIME' ? p : { ...p, t: { ...p.t, y: 0, mo: 0, d: 0, neg: false } };
    if (fromKind === 'TIME') return null;
    return kind === 'DATE' ? { ...p, t: { ...p.t, h: 0, mi: 0, s: 0, us: 0 } } : p;
  }
  if (from.cls === 'int' || from.cls === 'decimal' || from.cls === 'double') return parseTemporalNumber(v, kind);
  if (kind === 'TIME') return parseTimeText(v);
  const p = parseDateTimeText(v) ?? (/^\s*\d+(\.\d*)?\s*$/.test(v) ? parseTemporalNumber(v, kind) : null);
  if (p === null) return null;
  return kind === 'DATE' ? { ...p, t: { ...p.t, h: 0, mi: 0, s: 0, us: 0 } } : p;
}

/**
 * CAST(v AS type) — and the conversion of a CASE/COALESCE result to its aggregated type — with
 * MySQL's non-strict CAST semantics (manual 14.10): a string to an integer by its integer prefix, a
 * DOUBLE rounded half to even, an exact value rounded half away from zero, an unreadable temporal
 * NULL, a string to JSON parsed (errno 3141 when it is not JSON).
 */
function castValue(v: Cell, from: Operand, to: ColumnDef, st: StatementScope): Cell {
  if (v === null) return null;
  if (to.dataType === 'YEAR') return castYear(v, from, st);
  switch (clsOf(to)) {
    case 'int': {
      let n: bigint;
      if (from.cls === 'double') n = BigInt(rint(Math.max(-1.8446744073709552e19, Math.min(1.8446744073709552e19, Number(v)))));
      else if (from.cls === 'int' || from.cls === 'decimal' || from.cls === 'temporal') n = roundDecToInt(toDec(v, from));
      else if (from.cls === 'json') n = roundDecToInt(toDec(v, from));
      else { const m = /^\s*([+-]?\d+)/.exec(v); n = m === null ? 0n : BigInt(m[1]!); }
      if (to.unsigned) return BigInt.asUintN(64, n).toString();
      if (n > INT64_MAX) return from.cls === 'int' && n <= UINT64_MAX ? BigInt.asIntN(64, n).toString() : INT64_MAX.toString();
      return (n < INT64_MIN ? INT64_MIN : n).toString();
    }
    case 'decimal': {
      const [p, s] = precisionScale(to);
      let d = from.cls === 'string' || from.cls === 'binary' ? parseDec(v) ?? decFromNumber(stringNumberPrefix(v).value) : toDec(v, from);
      d = decRound(d, s);
      if (decIntDigits(d) > p - s) { const max = { m: 10n ** BigInt(p) - 1n, s }; d = d.m < 0n ? decNeg(max) : max; }
      return decText(d, s);
    }
    case 'double': { const n = toDouble(v, from); return to.dataType === 'FLOAT' ? formatFloat(n) : formatDouble(n); }
    case 'temporal': {
      const kind = to.dataType as TemporalKind;
      const p = temporalFrom(v, from, kind);
      if (p === null) return null;
      const fsp = fspOf(to);
      return formatTemporal(roundFsp(p.t, fsp, kind), kind, fsp);
    }
    case 'json': {
      if (from.cls === 'json') return v;
      if (from.cls === 'string' || from.cls === 'null') {
        try { return printJson(parseJson(v)); } catch (err) {
          const j = err as JsonTextError;
          throw new SqlError(`Invalid JSON text in argument 1 to function cast_as_json: "${j.reason}" at position ${j.position}.`, 'INVALID_ARGUMENT', 3141, '22032');
        }
      }
      if (from.cls === 'binary') throw binaryJson();
      return printJson(toJson(v, from));
    }
    case 'binary': {
      let bytes = from.cls === 'binary' ? v : toByteString(v);
      if (to.length !== null) bytes = bytes.slice(0, to.length).padEnd(to.length, '\0');
      return bytes;
    }
    default: {
      let text = from.cls === 'binary' ? utf8Of(v) ?? v : v;
      if (to.length !== null) text = [...text].slice(0, to.length).join('');
      return text;
    }
  }
}

const binaryJson = (): SqlError => new SqlError("Cannot create a JSON value from a string with CHARACTER SET 'binary'.", 'INVALID_ARGUMENT', 3144, '22032');

/** The context of a value being stored: MySQL's messages name the column and the row. */
export type StoreContext = {
  /** strict mode (MySQL 8's default STRICT_TRANS_TABLES): an invalid or out-of-range value is an
   *  error; without it (INSERT IGNORE) the value is adjusted to the nearest valid one. */
  strict: boolean;
  /** 1-based row number within the statement, as the messages print it. */
  row: number;
  table: string;
  /** the World clock's instant (a TIME stored into a DATETIME takes today's date). */
  now?: string;
};

const INT_RANGE: Record<string, [bigint, bigint, bigint]> = {
  TINYINT: [-128n, 127n, 255n], BOOL: [-128n, 127n, 255n], BOOLEAN: [-128n, 127n, 255n],
  SMALLINT: [-32768n, 32767n, 65535n], MEDIUMINT: [-8388608n, 8388607n, 16777215n],
  INT: [-2147483648n, 2147483647n, 4294967295n], INTEGER: [-2147483648n, 2147483647n, 4294967295n],
  BIGINT: [INT64_MIN, INT64_MAX, UINT64_MAX],
};
const TEXT_BYTES: Record<string, number> = { TINYTEXT: 255, TEXT: 65535, MEDIUMTEXT: 16777215, LONGTEXT: 4294967295, TINYBLOB: 255, BLOB: 65535, MEDIUMBLOB: 16777215, LONGBLOB: 4294967295 };

const storeError = (message: string, errno: number, state: string): SqlError => new SqlError(message, 'INVALID_ARGUMENT', errno, state);
const quoteValue = (v: string): string => v.replace(/'/g, "\\'");

/** ENUM/SET members, as declared: `enum('a','b')`. */
function enumMembers(col: ColumnDef): string[] {
  const inner = /^\w+\((.*)\)/.exec(col.columnType)?.[1] ?? '';
  const out: string[] = [];
  const re = /'((?:[^']|'')*)'/g;
  for (let m = re.exec(inner); m !== null; m = re.exec(inner)) out.push(m[1]!.replace(/''/g, "'"));
  return out;
}

/** The value a NOT NULL column takes when a non-strict write (INSERT IGNORE) supplies NULL: its
 *  type's implicit default (manual 13.6 "Data Type Default Values"). */
export function implicitDefault(col: ColumnDef): string {
  switch (clsOf(col)) {
    case 'int': return col.dataType === 'YEAR' ? '0000' : '0';
    case 'decimal': return decText(ZERO, precisionScale(col)[1]);
    case 'double': return '0';
    case 'temporal': { const kind = col.dataType as TemporalKind; return formatTemporal({ y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0, us: 0, neg: false }, kind, fspOf(col)); }
    case 'json': return 'null';
    case 'binary': return col.dataType === 'BINARY' ? '\0'.repeat(col.length ?? 1) : '';
    default: return col.dataType === 'ENUM' ? enumMembers(col)[0] ?? '' : '';
  }
}

/**
 * Convert a value to `col`'s type for storage, as MySQL 8 does under its default sql_mode
 * (STRICT_TRANS_TABLES, NO_ZERO_IN_DATE, NO_ZERO_DATE; manual 7.1.11 "Server SQL Modes", 13
 * "Data Types"): integers rounded and range-checked (1264), strings that are not numbers refused
 * (1366, or 1265 when only a prefix is numeric), DECIMAL rounded to its scale and padded, DOUBLE
 * and FLOAT stored at their precision, temporals read from any accepted spelling and stored
 * canonically at the column's fsp (1292 for an unreadable or zero date), JSON validated and stored
 * normalized (3140), strings and binary strings checked against their length (1406), ENUM/SET
 * checked against their members (1265). Without strict mode the value is adjusted instead.
 */
export function storeValue(col: ColumnDef, value: Cell, src: Operand, c: StoreContext): Cell {
  if (value === null) return null;
  const at = `for column '${col.name}' at row ${c.row}`;
  const d = col.dataType;
  const truncated = (): SqlError => storeError(`Data truncated ${at}`, 1265, '01000');
  const range = (): SqlError => storeError(`Out of range value ${at}`, 1264, '22003');

  if (d === 'BIT') return value;
  if (BINARY_TYPES.has(d)) {
    let bytes = src.cls === 'binary' ? value : toByteString(value);
    const limit = d === 'BINARY' || d === 'VARBINARY' ? col.length ?? (d === 'BINARY' ? 1 : 65535) : TEXT_BYTES[d]!;
    if (bytes.length > limit) { if (c.strict) throw storeError(`Data too long ${at}`, 1406, '22001'); bytes = bytes.slice(0, limit); }
    if (d === 'BINARY') bytes = bytes.padEnd(limit, '\0');
    return bytes;
  }
  if (d === 'JSON') {
    if (src.cls === 'binary') throw binaryJson();
    if (src.cls !== 'json' && src.cls !== 'string' && src.cls !== 'null') {
      throw storeError(`Invalid JSON text: "not a JSON text, may need CAST" at position 0 in value for column '${c.table}.${col.name}'.`, 3140, '22032');
    }
    try { return printJson(parseJson(value)); } catch (err) {
      const j = err as JsonTextError;
      throw storeError(`Invalid JSON text: "${j.reason}" at position ${j.position} in value for column '${c.table}.${col.name}'.`, 3140, '22032');
    }
  }
  if (d === 'ENUM' || d === 'SET') {
    const members = enumMembers(col);
    const coll = collationNamed(col.collation) ?? databaseCollation();
    const find = (name: string): string | undefined => members.find((m) => coll.compare(m.replace(/ +$/, ''), name.replace(/ +$/, '')) === 0);
    const numeric = src.cls === 'int' || src.cls === 'decimal' || src.cls === 'double';
    if (d === 'ENUM') {
      if (numeric) {
        const n = Number(roundDecToInt(toDec(value, src)));
        if (n >= 1 && n <= members.length) return members[n - 1]!;
      } else {
        const hit = find(src.cls === 'binary' ? utf8Of(value) ?? value : value);
        if (hit !== undefined) return hit;
      }
      if (c.strict) throw truncated();
      return '';
    }
    let picked: Set<string>;
    if (numeric) {
      const bits = roundDecToInt(toDec(value, src));
      picked = new Set(members.filter((_, i) => (bits >> BigInt(i)) & 1n));
      if (bits < 0n || bits >= 1n << BigInt(members.length)) { if (c.strict) throw truncated(); }
    } else {
      const parts = value === '' ? [] : value.split(',');
      const hits = parts.map(find);
      if (hits.some((h) => h === undefined) && c.strict) throw truncated();
      picked = new Set(hits.filter((h): h is string => h !== undefined));
    }
    return members.filter((m) => picked.has(m)).join(',');
  }
  if (CHARACTER_TYPES.has(d)) {
    let text = value;
    if (src.cls === 'binary') {
      const decoded = utf8Of(value);
      if (decoded === null) {
        const hex = [...value.slice(0, 6)].map((ch) => `\\x${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`).join('');
        if (c.strict) throw storeError(`Incorrect string value: '${hex}' ${at}`, 1366, 'HY000');
        text = value;
      } else text = decoded;
    }
    if (d === 'CHAR' || d === 'VARCHAR') {
      const limit = col.length ?? 1;
      const chars = [...text];
      if (chars.length > limit) {
        // Excess trailing spaces are dropped silently in every mode; anything else is too long.
        if (!/^ *$/.test(chars.slice(limit).join('')) && c.strict) throw storeError(`Data too long ${at}`, 1406, '22001');
        text = chars.slice(0, limit).join('');
      }
      // CHAR is stored padded and returned with its trailing spaces removed.
      if (d === 'CHAR') text = text.replace(/ +$/, '');
      return text;
    }
    const limit = TEXT_BYTES[d]!;
    if (new TextEncoder().encode(text).length > limit) {
      if (c.strict) throw storeError(`Data too long ${at}`, 1406, '22001');
      let bytes = 0; let cut = '';
      for (const ch of text) { const n = new TextEncoder().encode(ch).length; if (bytes + n > limit) break; bytes += n; cut += ch; }
      text = cut;
    }
    return text;
  }

  switch (clsOf(col)) {
    case 'int': {
      if (d === 'YEAR') return storeYear(col, value, src, c, range);
      let n: bigint;
      if (src.cls === 'double') {
        const x = Number(value);
        if (!Number.isFinite(x)) { if (c.strict) throw range(); n = x > 0 ? UINT64_MAX : INT64_MIN; } else n = BigInt(rint(Math.max(-1e20, Math.min(1e20, x))));
      } else if (src.cls === 'string' || src.cls === 'binary' || src.cls === 'null' || src.cls === 'json') {
        const whole = parseDec(value);
        if (whole !== null) n = roundDecToInt(whole);
        else {
          const prefix = stringNumberPrefix(value);
          if (c.strict) {
            if (/^\s*[+-]?(\d|\.\d)/.test(value)) throw truncated();
            throw storeError(`Incorrect integer value: '${quoteValue(value)}' ${at}`, 1366, 'HY000');
          }
          n = BigInt(rint(prefix.value));
        }
      } else n = roundDecToInt(toDec(value, src));
      const [lo, hi, uhi] = INT_RANGE[d] ?? INT_RANGE.BIGINT!;
      const min = col.unsigned ? 0n : lo; const max = col.unsigned ? uhi : hi;
      if (n < min || n > max) { if (c.strict) throw range(); n = n < min ? min : max; }
      return n.toString();
    }
    case 'decimal': {
      const [p, s] = precisionScale(col);
      let dv: Dec;
      if (src.cls === 'string' || src.cls === 'binary' || src.cls === 'null' || src.cls === 'json') {
        const whole = parseDec(value);
        if (whole !== null) dv = whole;
        else {
          if (c.strict) {
            if (/^\s*[+-]?(\d|\.\d)/.test(value)) throw truncated();
            throw storeError(`Incorrect decimal value: '${quoteValue(value)}' ${at}`, 1366, 'HY000');
          }
          dv = decFromNumber(stringNumberPrefix(value).value);
        }
      } else dv = toDec(value, src);
      dv = decRound(dv, s);
      const max = { m: 10n ** BigInt(p) - 1n, s };
      if (decIntDigits(dv) > p - s || (col.unsigned && dv.m < 0n)) {
        if (c.strict) throw range();
        dv = col.unsigned && dv.m < 0n ? ZERO : dv.m < 0n ? decNeg(max) : max;
      }
      return decText(dv, s);
    }
    case 'double': {
      let x: number;
      if (src.cls === 'string' || src.cls === 'binary' || src.cls === 'null' || src.cls === 'json') {
        const prefix = stringNumberPrefix(value);
        if (!prefix.complete && c.strict) throw truncated();
        x = prefix.value;
      } else x = toDouble(value, src);
      const limit = d === 'FLOAT' ? 3.402823466e38 : Number.MAX_VALUE;
      if (!Number.isFinite(x) || Math.abs(x) > limit || (col.unsigned && x < 0)) {
        if (c.strict) throw range();
        x = col.unsigned && x < 0 ? 0 : x < 0 ? -limit : limit;
      }
      const scaled = /\(\s*\d+\s*,\s*(\d+)\s*\)/.exec(col.columnType);
      if (scaled !== null) x = Number(decText(decFromNumber(x), Number(scaled[1])));
      return d === 'FLOAT' ? formatFloat(x) : formatDouble(x);
    }
    case 'temporal': {
      const kind = d as TemporalKind;
      const word = kind === 'DATE' ? 'date' : kind === 'TIME' ? 'time' : 'datetime';
      const bad = (): SqlError => storeError(`Incorrect ${word} value: '${quoteValue(value)}' ${at}`, 1292, '22007');
      let p = temporalFrom(value, src, kind);
      if (p === null && src.cls === 'temporal' && kind !== 'TIME' && temporalKindOf(src.type) === 'TIME') {
        // A TIME stored into a DATETIME takes the current date (the World clock's).
        const time = temporalParts(value, 'TIME');
        const today = c.now === undefined ? null : parseDateTimeText(c.now.slice(0, 10));
        if (time !== null && today !== null) p = { t: { ...today.t, h: time.t.h, mi: time.t.mi, s: time.t.s, us: time.t.us }, truncated: false, zero: false };
      }
      const zero: Temporal = { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0, us: 0, neg: false };
      if (p === null || (p.truncated && src.cls !== 'temporal')) { if (c.strict) throw bad(); p = p ?? { t: zero, truncated: false, zero: true }; }
      if (kind !== 'TIME' && p.zero) { if (c.strict) throw bad(); }
      const fsp = fspOf(col);
      let t = roundFsp(p.t, fsp, kind);
      if (kind === 'TIMESTAMP' && !p.zero && !inTimestampRange(t)) { if (c.strict) throw bad(); t = zero; }
      return formatTemporal(t, kind, fsp);
    }
    default: return value;
  }
}

/** YEAR (manual 13.2.4): 1901–2155 or 0000; a number 1–69 is 2001–2069 and 70–99 is 1970–1999; a
 *  string '0'/'00' through '69' is 2000–2069. */
function storeYear(col: ColumnDef, value: string, src: Operand, c: StoreContext, range: () => SqlError): string {
  const text = value.trim();
  const isString = src.cls === 'string' || src.cls === 'binary' || src.cls === 'null';
  let n: number;
  if (isString) {
    if (!/^\d{1,4}$/.test(text)) { if (c.strict) throw storeError(`Incorrect integer value: '${quoteValue(value)}' for column '${col.name}' at row ${c.row}`, 1366, 'HY000'); return '0000'; }
    n = Number(text);
    if (text.length <= 2) n = n < 70 ? 2000 + n : 1900 + n;
  } else {
    n = Number(roundDecToInt(toDec(value, src)));
    if (n >= 1 && n <= 69) n += 2000; else if (n >= 70 && n <= 99) n += 1900;
  }
  if (n !== 0 && (n < 1901 || n > 2155)) { if (c.strict) throw range(); return '0000'; }
  return String(n).padStart(4, '0');
}

// ── JSON ─────────────────────────────────────────────────────────────────────────────────────
// A JSON cell holds the document's text, normalized as MySQL stores it. The functions below parse
// it (integers exact, `values.ts`), operate on the value and print results the way
// MySQL prints a JSON value.

/** A JSON function's document argument: a JSON value, or a string parsed as JSON text (errno 3141
 *  when it is not); any other type is errno 3146. */
function jsonDocument(e: Expr | undefined, v: string, position: number, fn: string, row: EvalRow): JV {
  const o = e === undefined ? typeOperand(null) : operandOf(e, row);
  if (o.cls === 'binary') throw binaryJson();
  if (o.cls !== 'json' && o.cls !== 'string' && o.cls !== 'null') {
    throw new SqlError(`Invalid data type for JSON data in argument ${position} to function ${fn}; a JSON string or JSON type is required.`, 'INVALID_ARGUMENT', 3146, '22032');
  }
  try { return parseJson(v); } catch (err) {
    const j = err as JsonTextError;
    throw new SqlError(`Invalid JSON text in argument ${position} to function ${fn}: "${j.reason}" at position ${j.position}.`, 'INVALID_ARGUMENT', 3141, '22032');
  }
}

/** A path leg's array position: `n`, or `last` / `last - n`. */
type JsonIndex = { last: boolean; n: number };
type JsonLeg = { kind: 'key'; key: string } | { kind: 'index'; at: JsonIndex } | { kind: 'range'; from: JsonIndex; to: JsonIndex }
  | { kind: 'wildcard' } | { kind: 'index-wildcard' } | { kind: 'recursive' };

/** A MySQL JSON path (manual 13.5, "Searching and Modifying JSON Values"): `$`, then `.key`,
 *  `."quoted key"`, `.*`, `[n]`, `[last]`, `[last-n]`, `[m to n]`, `[*]`, and `**` followed by a leg. */
function parseJsonPath(path: string): JsonLeg[] {
  const s = path.trim();
  let i = 0;
  const bad = (): SqlError => new SqlError(`Invalid JSON path expression. The error is around character position ${i}.`, 'INVALID_ARGUMENT', 3143, '42000');
  if (s[i] !== '$') throw bad();
  i++;
  const legs: JsonLeg[] = [];
  const index = (text: string): JsonIndex | null => {
    const m = /^(?:(last)(?:\s*-\s*(\d+))?|(\d+))$/.exec(text.trim());
    if (m === null) return null;
    return m[1] !== undefined ? { last: true, n: Number(m[2] ?? 0) } : { last: false, n: Number(m[3]) };
  };
  while (i < s.length) {
    if (s[i] === ' ') { i++; continue; }
    if (s.startsWith('**', i)) { legs.push({ kind: 'recursive' }); i += 2; continue; }
    if (s[i] === '.') {
      i++;
      if (s[i] === '*') { legs.push({ kind: 'wildcard' }); i++; continue; }
      if (s[i] === '"') {
        let j = i + 1; let key = '';
        while (j < s.length && s[j] !== '"') { if (s[j] === '\\') j++; key += s[j]; j++; }
        if (s[j] !== '"') throw bad();
        legs.push({ kind: 'key', key }); i = j + 1; continue;
      }
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(s.slice(i));
      if (m === null) throw bad();
      legs.push({ kind: 'key', key: m[0] }); i += m[0].length; continue;
    }
    if (s[i] === '[') {
      const close = s.indexOf(']', i);
      if (close < 0) throw bad();
      const inner = s.slice(i + 1, close).trim();
      if (inner === '*') legs.push({ kind: 'index-wildcard' });
      else {
        const range = /^(.*?)\s+to\s+(.*)$/.exec(inner);
        if (range !== null) {
          const from = index(range[1]!); const to = index(range[2]!);
          if (from === null || to === null) throw bad();
          legs.push({ kind: 'range', from, to });
        } else {
          const at = index(inner);
          if (at === null) throw bad();
          legs.push({ kind: 'index', at });
        }
      }
      i = close + 1; continue;
    }
    throw bad();
  }
  // `**` must be followed by a leg: `$**` alone is not a path.
  if (legs[legs.length - 1]?.kind === 'recursive') throw bad();
  return legs;
}

const multiMatch = (legs: JsonLeg[]): boolean => legs.some((l) => l.kind !== 'key' && l.kind !== 'index');

function jsonPathMatches(doc: JV, legs: JsonLeg[]): JV[] {
  let current: JV[] = [doc];
  const resolve = (at: JsonIndex, length: number): number => (at.last ? length - 1 - at.n : at.n);
  for (const leg of legs) {
    const next: JV[] = [];
    for (const v of current) {
      if (leg.kind === 'key') { if (v instanceof JObj && v.members.has(leg.key)) next.push(v.members.get(leg.key)!); }
      else if (leg.kind === 'index' || leg.kind === 'range') {
        // A non-array is read as a one-element array by an array leg.
        const arr = Array.isArray(v) ? v : [v];
        const from = resolve(leg.kind === 'index' ? leg.at : leg.from, arr.length);
        const to = leg.kind === 'index' ? from : resolve(leg.to, arr.length);
        for (let k = Math.max(0, from); k <= Math.min(to, arr.length - 1); k++) next.push(arr[k]!);
      } else if (leg.kind === 'wildcard') { if (v instanceof JObj) next.push(...v.members.values()); }
      else if (leg.kind === 'index-wildcard') { if (Array.isArray(v)) next.push(...v); }
      else {
        const everyDescendant = (x: JV): void => {
          next.push(x);
          if (Array.isArray(x)) x.forEach(everyDescendant);
          else if (x instanceof JObj) [...x.members.values()].forEach(everyDescendant);
        };
        everyDescendant(v);
      }
    }
    current = next;
  }
  return current;
}

// ── DATES ────────────────────────────────────────────────────────────────────────────────────

/** A zone's UTC offset in minutes at `instant`: `+hh:mm`/`-hh:mm`, `SYSTEM`/`UTC` (the server runs
 *  in UTC, as PlanetScale does), or a named zone from the time-zone database. Unknown is null. */
function zoneOffsetMinutes(zone: string, instant: number): number | null {
  const m = /^([+-])(\d{1,2}):(\d{2})$/.exec(zone.trim());
  if (m !== null) {
    const minutes = Number(m[2]) * 60 + Number(m[3]);
    // MySQL accepts offsets from -13:59 to +14:00.
    if (minutes > 14 * 60 || (m[1] === '-' && minutes > 13 * 60 + 59)) return null;
    return m[1] === '-' ? -minutes : minutes;
  }
  if (/^(SYSTEM|UTC)$/i.test(zone.trim())) return 0;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone.trim(), hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(instant));
    const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return Math.round((wall - Math.floor(instant / 1000) * 1000) / 60_000);
  } catch { return null; }
}

/** The UTC instant a wall time in `zone` names: the offset is taken at the instant itself, not at
 *  the wall time read as UTC, so a wall time near a DST change resolves to the zone's own offset. */
function zoneInstant(local: number, zone: string): number | null {
  const guess = zoneOffsetMinutes(zone, local);
  if (guess === null) return null;
  const first = local - guess * 60_000;
  const settled = zoneOffsetMinutes(zone, first);
  return settled === null ? null : local - settled * 60_000;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** MySQL's DATE_FORMAT specifiers (MySQL 8 manual, Date and Time Functions). */
/**
 * CAST(… AS YEAR) (manual 14.10, "These rules govern conversion to YEAR"): a four-digit number 1901-2155 is itself; one or
 * two digits add 2000 (1-69) or 1900 (70-99); "For a string which evaluates to 0, return 2000. For the number 0, return 0";
 * a DATE or DATETIME gives its year and a TIME "the current year"; a DECIMAL or DOUBLE is rounded to the nearest integer
 * first; anything else NULL. A string read only by its numeric prefix raises MySQL's truncation warning (1292), as the
 * manual's SHOW WARNINGS after CAST("1979aaa" AS YEAR) shows.
 */
function castYear(v: string, from: Operand, st: StatementScope): Cell {
  if (from.cls === 'temporal') {
    if (from.type?.dataType === 'TIME') {
      if (st.now === undefined) throw unsupported('CAST(TIME … AS YEAR) without a World clock instant (planetscale.functions.clock)');
      return String(new Date(Date.parse(st.now)).getUTCFullYear());
    }
    const p = temporalFrom(v, from, 'DATETIME');
    return p === null ? null : String(p.t.y).padStart(4, '0');
  }
  let n: number;
  if (from.cls === 'int' || from.cls === 'decimal') n = Number(roundDecToInt(toDec(v, from)));
  else if (from.cls === 'double') n = rint(Number(v));
  else {
    const m = /^\s*([+-]?\d+(?:\.\d*)?)/.exec(v);
    if (m === null) return null;
    if (m[0].length !== v.length) warn(st, 1292, `Truncated incorrect YEAR value: '${v}'`);
    n = Math.round(Number(m[1]));
    if (n === 0) return '2000';
  }
  if (n === 0) return '0';
  if (n >= 1 && n <= 69) return String(2000 + n);
  if (n >= 70 && n <= 99) return String(1900 + n);
  if (n >= 1901 && n <= 2155) return String(n);
  return null;
}

/** STR_TO_DATE's reading of `text` by `format` (manual 14.7: "the format string can contain literal characters and format
 *  specifiers beginning with %"; the specifiers are DATE_FORMAT's). Unset parts are zero; null when the text does not
 *  match. */
function strToDate(text: string, format: string): Temporal | null {
  const t: Temporal = { y: 0, mo: 0, d: 0, h: 0, mi: 0, s: 0, us: 0, neg: false };
  let i = 0; let pm: boolean | undefined; let hour12 = false;
  let weekYear: { year: number; mondayFirst: boolean } | undefined; let week: number | undefined; let weekday: number | undefined;
  // a number may follow spaces (STR_TO_DATE('May 1, 2013','%M %d,%Y') reads 2013 after ", ")
  const num = (max: number): number | null => { while (text[i] === ' ') i++; const m = new RegExp(`^\\d{1,${max}}`).exec(text.slice(i)); if (!m) return null; i += m[0].length; return Number(m[0]); };
  const word = (list: readonly string[], short: boolean): number | null => {
    const rest = text.slice(i).toLowerCase();
    for (let k = 0; k < list.length; k++) { const w = (short ? list[k]!.slice(0, 3) : list[k]!).toLowerCase(); if (rest.startsWith(w)) { i += w.length; return k; } }
    return null;
  };
  for (let k = 0; k < format.length; k++) {
    const c = format[k]!;
    if (c !== '%') {
      if (/\s/.test(c)) { while (i < text.length && /\s/.test(text[i]!)) i++; continue; }
      if (text[i] !== c) return null;
      i++; continue;
    }
    const sp = format[++k];
    let n: number | null = 0;
    switch (sp) {
      case 'Y': n = num(4); if (n !== null) t.y = n; break;
      case 'y': n = num(2); if (n !== null) t.y = n < 70 ? 2000 + n : 1900 + n; break;
      case 'm': case 'c': n = num(2); if (n !== null) t.mo = n; break;
      case 'M': case 'b': n = word(MONTHS, sp === 'b'); if (n !== null) t.mo = n + 1; break;
      case 'd': case 'e': n = num(2); if (n !== null) t.d = n; break;
      case 'D': n = num(2); if (n !== null) { t.d = n; const sfx = /^(st|nd|rd|th)/i.exec(text.slice(i)); if (sfx) i += 2; } break;
      case 'H': case 'k': n = num(2); if (n !== null) t.h = n; break;
      case 'h': case 'I': case 'l': n = num(2); if (n !== null) { t.h = n; hour12 = true; } break;
      case 'i': n = num(2); if (n !== null) t.mi = n; break;
      case 's': case 'S': n = num(2); if (n !== null) t.s = n; break;
      case 'f': { const m = /^\d{1,6}/.exec(text.slice(i)); if (!m) { n = null; break; } i += m[0].length; t.us = Number(m[0].padEnd(6, '0')); break; }
      case 'p': { const m = /^(AM|PM)/i.exec(text.slice(i)); if (!m) { n = null; break; } i += 2; pm = m[1]!.toUpperCase() === 'PM'; break; }
      case 'W': case 'a': n = word(WEEKDAYS, sp === 'a'); if (n !== null) weekday = n; break;
      case 'X': case 'x': n = num(4); if (n !== null) weekYear = { year: n, mondayFirst: sp === 'x' }; break;
      case 'V': case 'v': n = num(2); if (n !== null) week = n; break;
      case 'T': { const r = strToDate(text.slice(i), '%H:%i:%s'); if (r === null) { n = null; break; } const m = /^\d{1,2}:\d{1,2}:\d{1,2}/.exec(text.slice(i)); i += m![0].length; t.h = r.h; t.mi = r.mi; t.s = r.s; break; }
      case '%': if (text[i] !== '%') n = null; else i++; break;
      default: return null;
    }
    if (n === null) return null;
  }
  if (hour12) { if (t.h > 12 || t.h === 0) return null; if (pm === true && t.h < 12) t.h += 12; if (pm === false && t.h === 12) t.h = 0; }
  // a year, week and weekday (%X%V %W, %x%v %W) name a date: week 1 is the first week with a Sunday (%X%V, WEEK() mode 2) or
  // with four or more days of the year (%x%v, mode 3) (manual 14.7, WEEK())
  if (weekYear !== undefined && week !== undefined && weekday !== undefined) {
    const jan1 = Date.UTC(weekYear.year, 0, 1); const dow = new Date(jan1).getUTCDay();
    const start = weekYear.mondayFirst ? jan1 + (((dow + 6) % 7 <= 3 ? -((dow + 6) % 7) : 7 - ((dow + 6) % 7)) * 86_400_000) : jan1 + ((7 - dow) % 7) * 86_400_000;
    const offset = weekYear.mondayFirst ? (weekday + 6) % 7 : weekday;
    const at = new Date(start + ((week - 1) * 7 + offset) * 86_400_000);
    t.y = at.getUTCFullYear(); t.mo = at.getUTCMonth() + 1; t.d = at.getUTCDate();
  }
  if (t.mo > 12 || t.d > 31 || t.h > 23 || t.mi > 59 || t.s > 59) return null;
  return t;
}

/** GET_FORMAT()'s table (manual 14.7): the format string per value kind and locale; TIMESTAMP reads as DATETIME. */
const GET_FORMATS: Record<string, Record<string, string>> = {
  DATE: { USA: '%m.%d.%Y', JIS: '%Y-%m-%d', ISO: '%Y-%m-%d', EUR: '%d.%m.%Y', INTERNAL: '%Y%m%d' },
  DATETIME: { USA: '%Y-%m-%d %H.%i.%s', JIS: '%Y-%m-%d %H:%i:%s', ISO: '%Y-%m-%d %H:%i:%s', EUR: '%Y-%m-%d %H.%i.%s', INTERNAL: '%Y%m%d%H%i%s' },
  TIME: { USA: '%h:%i:%s %p', JIS: '%H:%i:%s', ISO: '%H:%i:%s', EUR: '%H.%i.%s', INTERNAL: '%H%i%s' },
};

const WEEK_MONDAY_FIRST = 1;
const WEEK_YEAR = 2;
const WEEK_FIRST_WEEKDAY = 4;

/** A date's week and the year it belongs to, by the week rules the manual's WEEK() modes give (14.7, WEEK(): "Monday is
 *  the first day of the week" or Sunday; weeks numbered 0-53 or 1-53; week 1 is "the first week with a Sunday in this
 *  year" or "with 4 or more days this year"). `behaviour` holds WEEK_MONDAY_FIRST, WEEK_YEAR (a date before week 1 is in
 *  the previous year's last week) and WEEK_FIRST_WEEKDAY (week 1 starts on the first first-day of the year). */
function calcWeek(p: Temporal, behaviour: number): { week: number; year: number } {
  const dayOf = (y: number, m: number, d: number): number => Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
  const daysIn = (y: number): number => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);
  const mondayFirst = (behaviour & WEEK_MONDAY_FIRST) !== 0;
  let weekYear = (behaviour & WEEK_YEAR) !== 0;
  const firstWeekday = (behaviour & WEEK_FIRST_WEEKDAY) !== 0;
  const daynr = dayOf(p.y, p.mo, Math.max(p.d, 1));
  let firstDaynr = dayOf(p.y, 1, 1);
  const dow = new Date(Date.UTC(p.y, 0, 1)).getUTCDay();
  let weekday = mondayFirst ? (dow + 6) % 7 : dow;
  let year = p.y;
  if (p.mo === 1 && p.d <= 7 - weekday) {
    if (!weekYear && ((firstWeekday && weekday !== 0) || (!firstWeekday && weekday >= 4))) return { week: 0, year };
    weekYear = true;
    year--;
    const days = daysIn(year);
    firstDaynr -= days;
    weekday = (weekday + 53 * 7 - days) % 7;
  }
  const days = (firstWeekday && weekday !== 0) || (!firstWeekday && weekday >= 4) ? daynr - (firstDaynr + (7 - weekday)) : daynr - (firstDaynr - weekday);
  if (weekYear && days >= 52 * 7) {
    const next = (weekday + daysIn(year)) % 7;
    if ((!firstWeekday && next < 4) || (firstWeekday && next === 0)) return { week: 1, year: year + 1 };
  }
  return { week: Math.floor(days / 7) + 1, year };
}

function dateFormat(p: Temporal, format: string): string | null {
  // an incomplete date (a zero month or day) has no weekday, day of the year or week: those specifiers make it NULL
  if ((p.mo === 0 || p.d === 0) && /%[WawjUuVvXxD]/.test(format)) return null;
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  const dow = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
  const doy = Math.round((Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(p.y, 0, 1)) / 86_400_000) + 1;
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  const suffix = (d: number): string => (d % 100 >= 11 && d % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][d % 10] ?? 'th');
  let out = '';
  for (let i = 0; i < format.length; i++) {
    const c = format[i]!;
    if (c !== '%' || i + 1 >= format.length) { out += c; continue; }
    const s = format[++i]!;
    switch (s) {
      case 'Y': out += pad(p.y, 4); break;
      case 'y': out += pad(p.y % 100); break;
      case 'm': out += pad(p.mo); break;
      case 'c': out += String(p.mo); break;
      case 'M': out += MONTHS[p.mo - 1] ?? ''; break;
      case 'b': out += (MONTHS[p.mo - 1] ?? '').slice(0, 3); break;
      case 'd': out += pad(p.d); break;
      case 'e': out += String(p.d); break;
      case 'D': out += `${p.d}${suffix(p.d)}`; break;
      case 'H': out += pad(p.h); break;
      case 'k': out += String(p.h); break;
      case 'h': case 'I': out += pad(h12); break;
      case 'l': out += String(h12); break;
      case 'i': out += pad(p.mi); break;
      case 'S': case 's': out += pad(p.s); break;
      case 'f': out += String(p.us).padStart(6, '0'); break;
      case 'p': out += p.h < 12 ? 'AM' : 'PM'; break;
      case 'T': out += `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`; break;
      case 'r': out += `${pad(h12)}:${pad(p.mi)}:${pad(p.s)} ${p.h < 12 ? 'AM' : 'PM'}`; break;
      case 'W': out += WEEKDAYS[dow]; break;
      case 'a': out += WEEKDAYS[dow]!.slice(0, 3); break;
      case 'w': out += String(dow); break;
      case 'j': out += pad(doy, 3); break;
      // the week specifiers (MySQL 8.0 manual 14.7, DATE_FORMAT: "%U Week (00..53), where Sunday is the first day of the
      // week; WEEK() mode 0", "%u … Monday … mode 1", "%V Week (01..53), where Sunday is the first day of the week; WEEK()
      // mode 2; used with %X", "%v … Monday … mode 3; used with %x", "%X Year for the week where Sunday is the first day of
      // the week, numeric, four digits; used with %V", "%x … Monday …")
      case 'U': out += pad(calcWeek(p, WEEK_FIRST_WEEKDAY).week); break;
      case 'u': out += pad(calcWeek(p, WEEK_MONDAY_FIRST).week); break;
      case 'V': out += pad(calcWeek(p, WEEK_YEAR | WEEK_FIRST_WEEKDAY).week); break;
      case 'v': out += pad(calcWeek(p, WEEK_YEAR | WEEK_MONDAY_FIRST).week); break;
      case 'X': out += pad(calcWeek(p, WEEK_YEAR | WEEK_FIRST_WEEKDAY).year, 4); break;
      case 'x': out += pad(calcWeek(p, WEEK_YEAR | WEEK_MONDAY_FIRST).year, 4); break;
      default: out += s; // `%%` → `%`, and MySQL prints any other unknown specifier's letter
    }
  }
  return out;
}

/** The functions this engine evaluates; any other name is refused as `unsupported:` when the
 *  statement is bound, before a row is read, so an empty result can never hide the refusal. */
const KNOWN_FUNCTIONS = new Set([
  ...AGGREGATES, 'JSON_CONTAINS', 'JSON_EXTRACT', 'JSON_UNQUOTE', 'JSON_TYPE', 'JSON_QUOTE', 'JSON_VALID', 'JSON_LENGTH', 'JSON_DEPTH',
  'JSON_ARRAY', 'JSON_OBJECT', 'DATE_FORMAT', 'GET_FORMAT', 'CONVERT_TZ', 'COALESCE', 'IFNULL', 'NULLIF', 'IF', 'GREATEST', 'LEAST', 'LOWER', 'LCASE',
  'UPPER', 'UCASE', 'TRIM', 'LENGTH', 'OCTET_LENGTH', 'CHAR_LENGTH', 'CHARACTER_LENGTH', 'ABS', 'ROUND',
  'STRCMP', 'SLEEP', 'SYSDATE', 'UNIX_TIMESTAMP', 'FROM_UNIXTIME', 'STR_TO_DATE', 'HEX', 'UNHEX', 'CONV', 'CONCAT', 'DATABASE', 'SCHEMA', 'VERSION', 'VALUES',
]);

function evalCall(e: Extract<Expr, { kind: 'call' }>, row: EvalRow): Cell {
  const arg = (i: number): Cell => (e.args[i] === undefined ? null : evalExpr(e.args[i]!, row));
  const fn = e.name.toLowerCase();
  switch (e.name) {
    case 'COUNT': case 'SUM': case 'MIN': case 'MAX': case 'AVG': case 'JSON_ARRAYAGG': case 'GROUP_CONCAT':
      // Binding replaces every aggregate the select list, HAVING and ORDER BY hold; one reaching
      // row evaluation stands in WHERE, ON or GROUP BY, where MySQL refuses it.
      throw new SqlError('Invalid use of group function', 'INVALID_ARGUMENT', 1111, 'HY000');
    case 'JSON_CONTAINS': {
      const target = arg(0); const candidate = arg(1);
      if (target === null || candidate === null) return null;
      let doc = jsonDocument(e.args[0], target, 1, fn, row);
      const want = jsonDocument(e.args[1], candidate, 2, fn, row);
      if (e.args.length > 2) {
        const path = arg(2);
        if (path === null) return null;
        const legs = parseJsonPath(path);
        if (multiMatch(legs)) throw new SqlError('In this situation, path expressions may not contain the * and ** tokens or an array range.', 'INVALID_ARGUMENT', 3149, '42000');
        const hits = jsonPathMatches(doc, legs);
        if (hits.length === 0) return null;
        doc = hits[0]!;
      }
      return jsonContains(doc, want) ? '1' : '0';
    }
    case 'JSON_EXTRACT': {
      const text = arg(0);
      if (text === null) return null;
      const doc = jsonDocument(e.args[0], text, 1, fn, row);
      const found: JV[] = []; let wrap = e.args.length > 2;
      for (let i = 1; i < e.args.length; i++) {
        const path = arg(i);
        if (path === null) return null;
        const legs = parseJsonPath(path);
        if (multiMatch(legs)) wrap = true;
        found.push(...jsonPathMatches(doc, legs));
      }
      if (found.length === 0) return null;
      return printJson(wrap ? found : found[0]!);
    }
    case 'JSON_UNQUOTE': {
      const v = arg(0);
      if (v === null) return null;
      if (operandOf(e.args[0]!, row).cls === 'json') {
        const j = jsonDocument(e.args[0], v, 1, fn, row);
        return typeof j === 'string' ? j : printJson(j);
      }
      if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
        try { return String(parseJson(v)); } catch (err) {
          const j = err as JsonTextError;
          throw new SqlError(`Invalid JSON text in argument 1 to function json_unquote: "${j.reason}" at position ${j.position}.`, 'INVALID_ARGUMENT', 3141, '22032');
        }
      }
      return v;
    }
    case 'DATE_FORMAT': {
      const v = arg(0); const format = arg(1);
      if (v === null || format === null) return null;
      const p = temporalFrom(v, operandOf(e.args[0]!, row), 'DATETIME');
      return p === null ? null : dateFormat(p.t, format);
    }
    case 'CONVERT_TZ': {
      const v = arg(0); const from = arg(1); const to = arg(2);
      if (v === null || from === null || to === null) return null;
      const src = operandOf(e.args[0]!, row);
      const p = temporalFrom(v, src, 'DATETIME');
      if (p === null) return null;
      // Wall time in `from` → the instant → wall time in `to`. An unknown zone is NULL, as in MySQL.
      const instant = zoneInstant(temporalUtcMs(p.t), from);
      if (instant === null) return null;
      const toOffset = zoneOffsetMinutes(to, instant);
      if (toOffset === null) return null;
      const out = temporalFromUtcMs(instant + toOffset * 60_000, p.t.us);
      const fsp = src.cls === 'temporal' && src.type !== null ? fspOf(src.type) : (/\.(\d+)/.exec(v)?.[1]?.length ?? 0);
      return formatTemporal(out, 'DATETIME', Math.min(6, fsp));
    }
    case 'JSON_TYPE': { const v = arg(0); return v === null ? null : jsonTypeName(jsonDocument(e.args[0], v, 1, fn, row)); }
    case 'JSON_QUOTE': { const v = arg(0); return v === null ? null : JSON.stringify(v); }
    case 'JSON_VALID': {
      const v = arg(0);
      if (v === null) return null;
      const o = operandOf(e.args[0]!, row);
      if (o.cls === 'json') return '1';
      if (o.cls !== 'string') return '0';
      try { parseJson(v); return '1'; } catch { return '0'; }
    }
    case 'JSON_DEPTH': { const v = arg(0); return v === null ? null : String(jsonDepth(jsonDocument(e.args[0], v, 1, fn, row))); }
    case 'JSON_LENGTH': {
      const text = arg(0);
      if (text === null) return null;
      let doc = jsonDocument(e.args[0], text, 1, fn, row);
      if (e.args.length > 1) {
        const path = arg(1);
        if (path === null) return null;
        const legs = parseJsonPath(path);
        if (multiMatch(legs)) throw new SqlError('In this situation, path expressions may not contain the * and ** tokens or an array range.', 'INVALID_ARGUMENT', 3149, '42000');
        const hits = jsonPathMatches(doc, legs);
        if (hits.length === 0) return null;
        doc = hits[0]!;
      }
      return String(Array.isArray(doc) ? doc.length : doc instanceof JObj ? doc.members.size : 1);
    }
    case 'JSON_ARRAY': return printJson(e.args.map((a, i) => sqlToJson(a, arg(i), row)));
    case 'JSON_OBJECT': {
      if (e.args.length % 2 !== 0) throw new SqlError("Incorrect parameter count in the call to native function 'JSON_OBJECT'", 'INVALID_ARGUMENT', 1582, '42000');
      const members = new Map<string, JV>();
      for (let i = 0; i < e.args.length; i += 2) {
        const key = arg(i);
        if (key === null) throw new SqlError('JSON documents may not contain NULL member names.', 'INVALID_ARGUMENT', 3158, '22032');
        if (!members.has(key)) members.set(key, sqlToJson(e.args[i + 1]!, arg(i + 1), row));
      }
      return printJson(jsonObject(members));
    }
    case 'COALESCE': case 'IFNULL': {
      for (let i = 0; i < e.args.length; i++) { const v = arg(i); if (v !== null) return coerceResult(v, e.args[i]!, e, row); }
      return null;
    }
    // NULLIF(a, b) is `CASE WHEN a = b THEN NULL ELSE a END`: equality under the pair's comparison.
    case 'NULLIF': { const a = arg(0); const b = arg(1); return a !== null && b !== null && compareOperands(e.args[0]!, e.args[1]!, row) === 0 ? null : a; }
    case 'IF': { const t = truthy(arg(0)); const k = t === true ? 1 : 2; return coerceResult(arg(k), e.args[k]!, e, row); }
    // GREATEST/LEAST compare in their aggregated type: as integers, DECIMAL or DOUBLE when numeric,
    // as strings when numbers and strings mix, as temporals when all are temporal; any NULL is NULL.
    case 'GREATEST': case 'LEAST': {
      const values = e.args.map((_, i) => arg(i));
      if (values.some((v) => v === null)) return null;
      const to = staticType(e, row);
      const target = to === null || to === undefined ? undefined : to;
      const converted = values.map((v, i) => (target === undefined ? v! : castValue(v, operandOf(e.args[i]!, row), target, row.statement) ?? v!));
      const order = target === undefined ? (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0) : sorter({ ...operandOf(e, row), cls: clsOf(target), type: target });
      return converted.reduce((best, v) => ((e.name === 'GREATEST' ? order(v, best) > 0 : order(v, best) < 0) ? v : best));
    }
    // §9 round two, finding 3: case-folding a BYTE is data corruption — `UPPER` turned 0xE6 into
    // 0xC6 inside a VARBINARY value. MySQL's UPPER/LOWER over a binary value are no-ops, because
    // there is no collation to fold with.
    case 'LOWER': case 'LCASE': { const v = arg(0); if (v === null) return null; return staticBinary(e.args[0], row.table) ? v : v.toLowerCase(); }
    case 'UPPER': case 'UCASE': { const v = arg(0); if (v === null) return null; return staticBinary(e.args[0], row.table) ? v : v.toUpperCase(); }
    case 'TRIM': {
      // TRIM removes every leading and/or trailing occurrence of remstr (manual 14.8, TRIM(): "all remstr prefixes or
      // suffixes removed"); a NULL remstr is NULL, an empty one removes nothing
      const v = arg(0); if (v === null) return null;
      const rem = e.args.length > 1 ? arg(1) : ' ';
      if (rem === null) return null;
      const side = e.args.length > 2 ? arg(2) : 'BOTH';
      let out = v;
      if (rem === '') return out;
      if (side !== 'TRAILING') while (out.startsWith(rem)) out = out.slice(rem.length);
      if (side !== 'LEADING') while (out.endsWith(rem)) out = out.slice(0, out.length - rem.length);
      return out;
    }
    case 'GET_FORMAT': {
      // the format strings the manual's GET_FORMAT() table gives (14.7); an unknown locale, like a NULL one, is NULL
      const kind = arg(0); const locale = arg(1);
      if (kind === null || locale === null) return null;
      return GET_FORMATS[kind]?.[locale.toUpperCase()] ?? null;
    }
    case 'LENGTH': case 'OCTET_LENGTH': {
      // MySQL's LENGTH() counts BYTES, not characters — LENGTH('日') is 3 while CHAR_LENGTH('日') is 1.
      // A BINARY column's cell is ALREADY byte-shaped (one char per byte), so its byte count IS its
      // string length; re-encoding it would double-count.
      const v = arg(0);
      if (v === null) return null;
      return String(staticBinary(e.args[0], row.table) ? v.length : new TextEncoder().encode(v).length);
    }
    case 'CHAR_LENGTH': case 'CHARACTER_LENGTH': {
      const v = arg(0);
      if (v === null) return null;
      // A binary value has no charset, so MySQL counts its bytes here too.
      return String(staticBinary(e.args[0], row.table) ? v.length : [...v].length);
    }
    case 'HEX': {
      // "For a string argument str, HEX() returns a hexadecimal string representation of str where each byte of each
      // character in str is converted to two hexadecimal digits … For a numeric argument N, HEX() returns a hexadecimal
      // string representation of the value of N treated as a longlong (BIGINT) number" (manual 14.8)
      const v = arg(0);
      if (v === null) return null;
      const o = operandOf(e.args[0]!, row);
      if (o.cls === 'int' || o.cls === 'decimal' || o.cls === 'double') {
        const n = o.cls === 'double' ? BigInt(rint(Number(v))) : roundDecToInt(toDec(v, o));
        return BigInt.asUintN(64, n).toString(16).toUpperCase();
      }
      const bytes = o.cls === 'binary' ? Uint8Array.from(v, (c) => c.charCodeAt(0)) : new TextEncoder().encode(v);
      return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    }
    case 'UNHEX': {
      // "interprets each pair of characters in the argument as a hexadecimal number and converts it to the byte
      // represented by the number … If the argument contains any nonhexadecimal digits … the result is NULL" (manual 14.8)
      const v = arg(0);
      if (v === null) return null;
      const hex = v.length % 2 === 1 ? `0${v}` : v;
      if (!/^[0-9a-fA-F]*$/.test(hex)) return null;
      let out = '';
      for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      return out;
    }
    case 'CONV': {
      // "Converts numbers between different number bases … from_base … to_base … minimum base is 2 and the maximum base is
      // 36. If from_base is a negative number, N is regarded as a signed number. Otherwise, N is treated as unsigned. CONV()
      // works with 64-bit precision" (manual 14.6.2)
      const n = arg(0); const f = arg(1); const t = arg(2);
      if (n === null || f === null || t === null) return null;
      const from = Math.trunc(Number(f)); const to = Math.trunc(Number(t));
      if (Math.abs(from) < 2 || Math.abs(from) > 36 || Math.abs(to) < 2 || Math.abs(to) > 36) return null;
      const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const text = n.trim().toUpperCase();
      const neg = text.startsWith('-');
      let value = 0n;
      for (const ch of neg || text.startsWith('+') ? text.slice(1) : text) {
        const d = digits.indexOf(ch);
        if (d < 0 || d >= Math.abs(from)) break;
        value = value * BigInt(Math.abs(from)) + BigInt(d);
      }
      value = BigInt.asUintN(64, neg ? -value : value);
      let signed = false;
      if (to < 0 && value > INT64_MAX) { value = BigInt.asUintN(64, -BigInt.asIntN(64, value)); signed = true; }
      const out = value.toString(Math.abs(to)).toUpperCase();
      return signed ? `-${out}` : out;
    }
    case 'STRCMP': {
      // "0 if the strings are the same, -1 if the first argument is smaller than the second … and 1 otherwise"; it
      // "performs the comparison using the collation of the arguments" (manual 14.8.1), as = and < do
      const a = arg(0); const b = arg(1);
      if (a === null || b === null) return null;
      if (evalExpr({ kind: 'binary', op: '=', left: e.args[0]!, right: e.args[1]! }, row) === '1') return '0';
      return evalExpr({ kind: 'binary', op: '<', left: e.args[0]!, right: e.args[1]! }, row) === '1' ? '-1' : '1';
    }
    case 'SLEEP': {
      // "Sleeps (pauses) for the number of seconds given … then returns 0" (manual 14.24): no wall clock passes in a World,
      // so the statement's own clock moves on, which SYSDATE() reads
      const v = arg(0);
      if (v === null) return null;
      row.statement.slept += Math.max(0, Number(v) || 0);
      return '0';
    }
    case 'SYSDATE': {
      // "SYSDATE() returns the time at which it executes. This differs from the behavior for NOW(), which returns a
      // constant time that indicates the time at which the statement began to execute" (manual 14.7)
      const fspArg = arg(0); const fsp = fspArg === null ? 0 : Math.min(6, Number(fspArg) || 0);
      const now = row.now ?? row.statement.now;
      if (now === undefined) throw unsupported('SYSDATE() without a World clock instant (planetscale.functions.clock)');
      return currentTimestamp(inSessionZone(new Date(Date.parse(now) + row.statement.slept * 1000).toISOString(), row.statement.timeZone), fsp);
    }
    case 'UNIX_TIMESTAMP': {
      // with a date: "the value of the argument as seconds since '1970-01-01 00:00:00' UTC", the date read in the
      // session time zone, which a World's is UTC (@@time_zone); with fractional seconds, a DECIMAL (manual 14.7)
      const v = arg(0);
      if (v === null) return null;
      const src = operandOf(e.args[0]!, row);
      const p = temporalFrom(v, src, 'DATETIME');
      if (p === null || p.zero) return '0';
      const t = staticType(e, row)!;
      const wall = temporalUtcMs(p.t);
      const ms = zoneInstant(wall, row.statement.timeZone) ?? wall; const secs = Math.floor(ms / 1000);
      if (clsOf(t) !== 'decimal') return String(secs);
      const scale = precisionScale(t)[1];
      return decText({ m: BigInt(secs) * 1_000_000n + BigInt(p.t.us), s: 6 }, scale);
    }
    case 'FROM_UNIXTIME': {
      // "a representation of unix_timestamp as a datetime or character string value", in the session time zone (UTC);
      // with a format, DATE_FORMAT's (manual 14.7)
      const v = arg(0);
      if (v === null) return null;
      const d = toDec(v, operandOf(e.args[0]!, row));
      if (d.m < 0n) return null;
      const us = Number((d.m * 1_000_000n) / 10n ** BigInt(d.s));
      const instant = Math.floor(us / 1000);
      const t = temporalFromUtcMs(instant + (zoneOffsetMinutes(row.statement.timeZone, instant) ?? 0) * 60_000, us % 1_000_000);
      if (e.args.length > 1) { const f = arg(1); return f === null ? null : dateFormat(t, f); }
      return formatTemporal(t, 'DATETIME', fspOf(staticType(e, row)!));
    }
    case 'STR_TO_DATE': {
      // the inverse of DATE_FORMAT(): the string read by the format's specifiers; NULL where it does not match (14.7)
      const v = arg(0); const f = arg(1);
      if (v === null || f === null) return null;
      const t = strToDate(v, f);
      const type = staticType(e, row)!;
      // "If the NO_ZERO_DATE SQL mode is enabled, zero dates are disallowed" (manual 14.7, STR_TO_DATE); NO_ZERO_IN_DATE
      // disallows a nonzero year with a zero month or day
      const zeroDate = t !== null && type.dataType !== 'TIME' && t.y === 0 && t.mo === 0 && t.d === 0;
      const zeroIn = t !== null && type.dataType !== 'TIME' && t.y !== 0 && (t.mo === 0 || t.d === 0);
      if (t === null || (zeroDate && row.statement.mode.noZeroDate) || (zeroIn && row.statement.mode.noZeroInDate)) {
        warn(row.statement, 1411, `Incorrect datetime value: '${v}' for function str_to_date`); return null;
      }
      return formatTemporal(t, type.dataType as TemporalKind, fspOf(type));
    }
    case 'ROUND': {
      // "round half away from zero" for an exact value, and the C library's "round to nearest even" for an approximate
      // one (manual 14.6.2, ROUND()); a NULL X or D is NULL
      const v = arg(0);
      if (v === null) return null;
      const dv = e.args.length > 1 ? arg(1) : '0';
      if (dv === null) return null;
      const d = Math.max(-30, Math.min(30, Math.trunc(Number(dv))));
      const o = operandOf(e.args[0]!, row); const t = staticType(e, row)!;
      if (clsOf(t) === 'double') {
        const x = toDouble(v, o); const f = 10 ** d;
        return formatDouble(d >= 0 ? rint(x * f) / f : rint(x / 10 ** -d) * 10 ** -d);
      }
      const r = decRound(toDec(v, o), d);
      const whole = d < 0 ? { m: r.m * 10n ** BigInt(-d), s: 0 } : r;
      return clsOf(t) === 'int' ? intResult(decTrunc(whole), t.unsigned, e) : decText(whole, precisionScale(t)[1]);
    }
    case 'ABS': {
      const v = arg(0);
      if (v === null) return null;
      const o = operandOf(e.args[0]!, row); const t = staticType(e, row)!;
      if (clsOf(t) === 'double') return formatDouble(Math.abs(toDouble(v, o)));
      const d = toDec(v, o); const abs = d.m < 0n ? decNeg(d) : d;
      return clsOf(t) === 'int' ? intResult(decTrunc(abs), t.unsigned, e) : decText(abs, precisionScale(t)[1]);
    }
    case 'CONCAT': {
      let out = '';
      for (let i = 0; i < e.args.length; i++) { const v = arg(i); if (v === null) return null; out += v; }
      return out;
    }
    case 'DATABASE': case 'SCHEMA': return row.database ?? null;
    case 'VERSION': return SERVER_VERSION;
    // VALUES(col) in ON DUPLICATE KEY UPDATE is the value the INSERT proposed for col; elsewhere NULL.
    case 'VALUES': {
      const a = e.args[0];
      if (a === undefined || a.kind !== 'column') throw parseError(1, 'VALUES');
      return row.values === undefined ? null : cellOf(row.values, a.name) ?? null;
    }
    default:
      if (CLOCK_FUNCTIONS.has(e.name)) { const c = clockValue(e, row.now, row.statement.timeZone); return c.value; }
      throw unsupported(`the ${e.name}() function`);
  }
}

// THE CLOCK FUNCTIONS, read from the World clock's instant for the statement (the instant the store
// hands every statement, the one `DEFAULT CURRENT_TIMESTAMP` reads). From the manual (14.7, "Date
// and Time Functions"): NOW([fsp]) "returns the current date and time as a value in 'YYYY-MM-DD
// hh:mm:ss'", with "a fractional seconds part of that many digits" when fsp (0 to 6) is given, and
// "returns a constant time that indicates the time at which the statement began to execute";
// CURRENT_TIMESTAMP, LOCALTIME and LOCALTIMESTAMP "are synonyms for NOW()"; CURDATE() "returns the
// current date as a value in 'YYYY-MM-DD'", CURRENT_DATE its synonym; UNIX_TIMESTAMP() with no
// argument "returns a Unix timestamp representing seconds since '1970-01-01 00:00:00' UTC";
// UTC_TIMESTAMP([fsp]) is the UTC date and time. Where the manual stops and the twin decides: the
// session time zone is UTC, so NOW() and UTC_TIMESTAMP() agree; SYSDATE(), "the time at which it
// executes", is the same instant, since a statement's execution takes no World time; a value is typed
// DATETIME(fsp) / DATE / BIGINT, so a numeric context reads it as the temporal types' numbers do; and
// UNIX_TIMESTAMP(date) is not served.
const CLOCK_FUNCTIONS = new Set(['NOW', 'CURRENT_TIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP', 'UTC_TIMESTAMP', 'CURDATE', 'CURRENT_DATE', 'UTC_DATE', 'CURTIME', 'CURRENT_TIME', 'UTC_TIME', 'UNIX_TIMESTAMP']);
const BARE_CLOCK_WORDS = new Set(['CURRENT_TIMESTAMP', 'LOCALTIME', 'LOCALTIMESTAMP', 'UTC_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME', 'UTC_TIME', 'UTC_DATE']);

/** A clock function's value at the World clock instant `now`, with the type it reports. */
function clockValue(e: Extract<Expr, { kind: 'call' }>, utcNow: string | undefined, timeZone: string): { value: string; hint: VitessType } {
  if (utcNow === undefined || Number.isNaN(Date.parse(utcNow))) throw unsupported(`${e.name}() without a World clock instant (planetscale.functions.clock)`);
  // the local functions read the World clock in the session time zone (manual 7.1.15: NOW(), CURTIME() and CURDATE() "are
  // interpreted according to the session time zone"); the UTC_ ones and UNIX_TIMESTAMP() do not
  const now = e.name.startsWith('UTC_') || e.name === 'UNIX_TIMESTAMP' ? utcNow : inSessionZone(utcNow, timeZone);
  // CURTIME([fsp]) and its synonyms: the time of day, "as a value in 'hh:mm:ss' or hhmmss format" (manual 14.7)
  if (e.name === 'CURTIME' || e.name === 'CURRENT_TIME' || e.name === 'UTC_TIME') {
    const a = e.args[0];
    if (e.args.length > 1 || (a !== undefined && (a.kind !== 'literal' || !/^\d+$/.test(String(a.value))))) throw parseError(1, e.name);
    const fsp = a === undefined ? 0 : Number(a.value);
    if (fsp > 6) throw new SqlError(`Too-big precision ${fsp} specified for '${e.name.toLowerCase()}'. Maximum is 6.`, 'INVALID_ARGUMENT', 1426, '42000');
    return { value: currentTimestamp(now, fsp).slice(11), hint: 'TIME' };
  }
  if (e.name === 'CURDATE' || e.name === 'CURRENT_DATE' || e.name === 'UTC_DATE') {
    if (e.args.length > 0) throw parseError(1, e.name);
    return { value: new Date(Date.parse(now)).toISOString().slice(0, 10), hint: 'DATE' };
  }
  if (e.name === 'UNIX_TIMESTAMP') {
    if (e.args.length > 0) throw unsupported('UNIX_TIMESTAMP(date) folded as a clock');
    return { value: String(Math.floor(Date.parse(now) / 1000)), hint: 'INT64' };
  }
  // NOW and its synonyms are grammar keywords whose precision is a bare number, `NOW([fsp])`: two arguments, a string
  // or an expression there is a syntax error (1064), not a function's wrong parameter count
  const a = e.args[0];
  if (e.args.length > 1 || (a !== undefined && (a.kind !== 'literal' || a.hint === 'VARCHAR' || !/^\d+$/.test(String(a.value))))) throw parseError(1, e.name);
  const fsp = a === undefined ? 0 : Number(a.value);
  if (fsp > 6) throw new SqlError(`Too-big precision ${fsp} specified for '${e.name.toLowerCase()}'. Maximum is 6.`, 'INVALID_ARGUMENT', 1426, '42000');
  return { value: currentTimestamp(now, fsp), hint: 'DATETIME' };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// STATEMENT EXECUTION
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** What one statement produced, in engine terms. `../semantics/wire.ts` turns this into protojson. */
export type QueryOutcome = {
  fields: Field[];
  rows: Cell[][];
  rowsAffected: number;
  insertId: number;
  /** subject writes the caller must persist. Empty for a pure read. */
  writes: Write[];
  /** the transaction verb this statement is, if any — the store owns the session bookkeeping. */
  transaction?: 'begin' | 'commit' | 'rollback';
  /** START TRANSACTION's access mode, or SET TRANSACTION's characteristics, for the store to hold. */
  access?: 'READ WRITE' | 'READ ONLY';
  setTransaction?: { scope: 'next' | 'session'; access?: 'READ WRITE' | 'READ ONLY'; isolation?: IsolationLevel };
  /** the stored rows a locking read (`FOR UPDATE` / `FOR SHARE`) returned; the store locks them. */
  locked?: Array<{ table: string; rowid: number }>;
  /** the session's variables after a SET of them, for the caller to carry in the session it answers */
  vars?: SessionVars;
};

export type Write =
  | { kind: 'table'; table: TableDef }
  | { kind: 'drop-table'; table: string }
  | { kind: 'row'; table: string; row: RowRec }
  | { kind: 'delete-row'; table: string; rowid: number };

const noRows = (writes: Write[] = [], rowsAffected = 0, insertId = 0): QueryOutcome =>
  ({ fields: [], rows: [], rowsAffected, insertId, writes });

export type ExecOptions = {
  /** The World clock's instant for this statement (ISO-8601). `DEFAULT CURRENT_TIMESTAMP` reads
   *  it; without it such a default is refused rather than taken from the wall clock. */
  now?: string;
  /** The statement runs in a READ ONLY transaction: a write is MySQL's errno 1792. */
  transactionReadOnly?: boolean;
  /** The session's user variables and SQL mode, as the client's session carries them (SessionVars). */
  vars?: SessionVars;
};

/** A user variable's value and the type it holds (manual 11.4: "User variables can be assigned a value from a limited set
 *  of data types: integer, decimal, floating-point, binary or nonbinary string, or NULL value"), as a Vitess BindVariable
 *  types it. */
export type UserVariable = { value: Cell; type: VitessType };
/** What a session holds between statements: its user variables (by lowercased name; manual 11.4: "User variable names are
 *  not case-sensitive") and its sql_mode, when it set one. */
export type SessionVars = { user: Record<string, UserVariable>; sqlMode?: string; collationConnection?: string; timeZone?: string; warnings?: Array<{ level: string; code: number; message: string }> };

/** The running statement's scope, made by execStatement and carried by every row it evaluates (EvalRow.statement) and
 *  every plan (ExecCtx.statement): the SQL mode it obeys (strict mode refuses an out-of-range or invalid value instead
 *  of adjusting it, and ERROR_FOR_DIVISION_BY_ZERO under strict mode refuses a division by zero in a stored value,
 *  manual 7.1.11); the warnings it raised (Level, Code, Message), which SHOW WARNINGS reads after it (manual 15.7.7.42:
 *  "SHOW WARNINGS … displays information about the conditions … that resulted from executing the most recent statement
 *  in the current session"); the seconds SLEEP() has slept so far in it, which SYSDATE() reads; the World clock's
 *  instant; the connection collation its literals take (SET NAMES … COLLATE), when the session set one; the session's
 *  sql_mode as @@sql_mode reads it; and the session's time_zone (SET time_zone; 'SYSTEM', which a World's is UTC, when
 *  none was set). */
export type StatementScope = {
  mode: { strict: boolean; divisionError: boolean; noZeroDate: boolean; noZeroInDate: boolean };
  warnings: Array<{ level: string; code: number; message: string }>;
  slept: number;
  now?: string;
  collation?: string;
  sqlModeText: string;
  timeZone: string;
};
/** A statement's scope from what its session holds and the World clock's instant. */
function scopeFor(opts: ExecOptions): StatementScope {
  return {
    mode: modeOf(opts.vars?.sqlMode), warnings: [], slept: 0, ...(opts.now !== undefined ? { now: opts.now } : {}),
    ...(opts.vars?.collationConnection !== undefined ? { collation: opts.vars.collationConnection } : {}),
    sqlModeText: opts.vars?.sqlMode ?? SQL_MODE, timeZone: opts.vars?.timeZone ?? 'SYSTEM',
  };
}
/** The scope of a probe that runs outside any statement (a constant folded while a type is derived with no row). */
const detachedScope = (): StatementScope => scopeFor({});
/** The World clock's instant as the session time zone's wall clock, written as an ISO instant. */
function inSessionZone(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  const offset = zoneOffsetMinutes(timeZone, ms) ?? 0;
  return new Date(ms + offset * 60_000).toISOString();
}
function warn(st: StatementScope, code: number, message: string): void { st.warnings.push({ level: 'Warning', code, message }); }
function modeOf(sqlMode: string | undefined): { strict: boolean; divisionError: boolean; noZeroDate: boolean; noZeroInDate: boolean } {
  const modes = new Set((sqlMode ?? SQL_MODE).toUpperCase().split(',').map((m) => m.trim()));
  const strict = modes.has('STRICT_TRANS_TABLES') || modes.has('STRICT_ALL_TABLES') || modes.has('TRADITIONAL');
  return { strict, divisionError: strict && (modes.has('ERROR_FOR_DIVISION_BY_ZERO') || modes.has('TRADITIONAL')),
    noZeroDate: modes.has('NO_ZERO_DATE') || modes.has('TRADITIONAL'), noZeroInDate: modes.has('NO_ZERO_IN_DATE') || modes.has('TRADITIONAL') };
}

/** A statement with every user variable it names (`@x`) read as its value; an unset one is NULL (manual 11.4: "If you refer
 *  to a variable that has not been initialized, it has a value of NULL"). */
function withUserVariables<T>(node: T, user: Record<string, UserVariable>, st: StatementScope): T {
  if (Array.isArray(node)) return node.map((n) => withUserVariables(n, user, st)) as T;
  if (node === null || typeof node !== 'object') return node;
  const o = node as Record<string, unknown>;
  // under SET NAMES binary, a string literal with no introducer is a binary string
  if (st.collation === 'binary' && o.kind === 'literal' && o.hint === 'VARCHAR' && o.collation === undefined && typeof o.value === 'string') {
    return { kind: 'literal', value: toByteString(o.value as string), hint: 'VARBINARY' } as T;
  }
  if (o.kind === 'column' && o.table === undefined && o.name === '@@sql_mode') return { kind: 'literal', value: st.sqlModeText, hint: 'VARCHAR', collation: 'utf8mb3_general_ci' } as T;
  if (o.kind === 'column' && o.table === undefined && typeof o.name === 'string' && o.name.startsWith('@') && !o.name.startsWith('@@')) {
    const v = user[o.name.slice(1).toLowerCase()];
    return (v === undefined || v.value === null ? { kind: 'literal', value: null, hint: 'NULL' } : { kind: 'literal', value: v.value, hint: v.type }) as T;
  }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, withUserVariables(v, user, st)])) as T;
}

/** `CURRENT_TIMESTAMP(fsp)` at the World clock's instant, in MySQL's UTC `YYYY-MM-DD hh:mm:ss[.f]`. */
function currentTimestamp(now: string | undefined, fsp: number): string {
  const instant = now === undefined ? NaN : Date.parse(now);
  if (Number.isNaN(instant)) throw unsupported('DEFAULT CURRENT_TIMESTAMP without a World clock instant (planetscale.ddl.default_current_timestamp)');
  const iso = new Date(instant).toISOString(); // YYYY-MM-DDTHH:MM:SS.mmmZ
  const fraction = `${iso.slice(20, 23)}000`.slice(0, fsp);
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}${fsp > 0 ? `.${fraction}` : ''}`;
}

export function execStatement(db: Database, stmt: Statement, opts: ExecOptions = {}): QueryOutcome {
  const st = scopeFor(opts);
  const outcome = execStatementIn(db, withUserVariables(stmt, opts.vars?.user ?? {}, st), opts, st);
  // every statement but SHOW WARNINGS replaces the session's warnings with its own
  if (stmt.kind === 'show-warnings') return outcome;
  const base: SessionVars = outcome.vars ?? opts.vars ?? { user: {} };
  const had = (opts.vars?.warnings ?? []).length > 0;
  if (st.warnings.length === 0 && !had) return outcome;
  const vars: SessionVars = { ...base, ...(st.warnings.length ? { warnings: st.warnings } : {}) };
  if (!st.warnings.length) delete vars.warnings;
  return { ...outcome, vars };
}

function execStatementIn(db: Database, stmt: Statement, opts: ExecOptions, st: StatementScope): QueryOutcome {
  const write = (): void => {
    if (opts.transactionReadOnly === true) throw new SqlError('Cannot execute statement in a READ ONLY transaction.', 'INVALID_ARGUMENT', 1792, '25006');
  };
  switch (stmt.kind) {
    case 'begin': return { ...noRows(), transaction: 'begin', ...(stmt.access !== undefined ? { access: stmt.access } : {}) };
    case 'commit': return { ...noRows(), transaction: 'commit' };
    case 'rollback': return { ...noRows(), transaction: 'rollback' };
    // The characteristics of later transactions, held by the store. The access mode is enforced;
    // every isolation level reads the latest committed rows (see the capability notes).
    case 'set-transaction': return { ...noRows(), setTransaction: { scope: stmt.scope, ...(stmt.access !== undefined ? { access: stmt.access } : {}), ...(stmt.isolation !== undefined ? { isolation: stmt.isolation } : {}) } };
    case 'set-vars': return execSetVars(db, stmt, opts, st);
    case 'create-table': return execCreateTable(db, stmt, write);
    case 'create-table-select': return execCreateTableSelect(db, stmt, write, st);
    case 'drop-table': return execDropTable(db, stmt, write);
    case 'alter-add-columns': return execAlterAddColumns(db, stmt, write, opts.now);
    case 'alter-drop-columns': return execAlterDropColumns(db, stmt, write);
    case 'truncate': return execTruncate(db, stmt, write);
    case 'show-tables': return execShowTables(db);
    case 'show-create-table': {
      // SHOW CREATE TABLE (manual 15.7.7.10): the table's name and the CREATE TABLE statement that creates it
      const t = findTable(db, stmt.table);
      const f = (name: string): Field => ({ name, type: 'VARCHAR', charset: UTF8MB4_CHARSET, flags: FLAG_NOT_NULL, columnType: 'varchar(1024)' });
      return { ...noRows(), fields: [f('Table'), f('Create Table')], rows: [[t.name, showCreateTable(t)]] };
    }
    case 'show-warnings': {
      const field = (name: string, type: VitessType, columnType: string): Field => ({ name, type, charset: type === 'UINT32' ? BINARY_CHARSET : UTF8MB4_CHARSET, flags: FLAG_NOT_NULL, columnType });
      return { ...noRows(), fields: [field('Level', 'VARCHAR', 'varchar(7)'), field('Code', 'UINT32', 'int unsigned'), field('Message', 'VARCHAR', 'varchar(512)')],
        rows: (opts.vars?.warnings ?? []).map((w) => [w.level, String(w.code), w.message]) };
    }
    case 'describe': return execDescribe(db, stmt.table);
    case 'select': return execSelect(db, stmt, st);
    case 'insert': return execInsert(db, stmt, write, st);
    case 'update': return execUpdate(db, stmt, write, st);
    case 'update-multi': return execUpdateMulti(db, stmt, write, st);
    case 'delete': return execDelete(db, stmt, write, st);
  }
}

/** SET of user variables and sql_mode: each value evaluated now (manual 11.4: "the value … is evaluated when the SET
 *  statement is executed"), typed as the expression is (an integer, a decimal, a double, a binary or nonbinary string). */
function execSetVars(db: Database, stmt: Extract<Statement, { kind: 'set-vars' }>, opts: ExecOptions, st: StatementScope): QueryOutcome {
  const vars: SessionVars = { ...(opts.vars ?? {}), user: { ...(opts.vars?.user ?? {}) } };
  const row: EvalRow = { cells: {}, database: db.name, statement: st, ...(opts.now !== undefined ? { now: opts.now } : {}) };
  for (const { name, value } of stmt.user) {
    const v = evalExpr(value, row);
    const t = staticType(value, row);
    const cls = clsOf(t);
    const type: VitessType = v === null ? 'NULL' : cls === 'int' ? 'INT64' : cls === 'decimal' ? 'DECIMAL' : cls === 'double' ? 'FLOAT64' : cls === 'binary' ? 'VARBINARY' : 'VARCHAR';
    vars.user[name] = { value: v, type };
  }
  if (stmt.names !== undefined) {
    // the engine's character set is utf8mb4 (as PlanetScale's databases are); SET NAMES names another only as unmodeled
    const cs = requireCharset(stmt.names.charset);
    // SET NAMES binary makes the connection's literals binary strings (manual 12.8.5: "SET NAMES binary … LOWER('aA')
    // returns 'aA'"); the engine's text character set is utf8mb4
    if (cs !== 'utf8mb4' && cs !== 'binary') throw unsupported(`SET NAMES ${stmt.names.charset} (a connection character set other than utf8mb4)`);
    const collation = stmt.names.collation !== undefined ? requireCollation(stmt.names.collation) : defaultCollation(cs);
    if (collation.charset !== cs) throw new SqlError(`COLLATION '${collation.name}' is not valid for CHARACTER SET '${cs}'`, 'INVALID_ARGUMENT', 1253, '42000');
    vars.collationConnection = collation.name;
  }
  if (stmt.timeZone !== undefined) {
    const z = evalExpr(stmt.timeZone, row);
    if (z === null || zoneOffsetMinutes(z, Date.parse(opts.now ?? '1970-01-01T00:00:00Z')) === null) throw new SqlError(`Unknown or incorrect time zone: '${z ?? 'NULL'}'`, 'INVALID_ARGUMENT', 1298, 'HY000');
    vars.timeZone = z;
  }
  if (stmt.sqlMode !== undefined) {
    const m = evalExpr(stmt.sqlMode, row);
    if (m === null) throw new SqlError("Variable 'sql_mode' can't be set to the value of 'NULL'", 'INVALID_ARGUMENT', 1231, '42000');
    vars.sqlMode = m.toUpperCase();
  }
  return { ...noRows(), vars };
}

/**
 * CREATE TABLE … SELECT: a table whose columns are the query's result columns, typed as the result is (manual 15.1.20.4:
 * "MySQL creates new columns for all elements in the SELECT"), NOT NULL where the result can never be NULL, a NOT NULL
 * column taking its type's implicit default as its DEFAULT (the manual's own examples: `DESCRIBE` of
 * `CREATE TABLE t SELECT 2.5 AS a, 25E-1 AS b` shows the defaults 0.0 and 0), and holding the query's rows.
 */
/** The CREATE TABLE statement SHOW CREATE TABLE prints for a table: its columns with their types, NULL-ness and
 *  defaults, its keys, and its table options, in MySQL's layout. */
function showCreateTable(t: TableDef): string {
  const q = (n: string): string => `\`${n.replace(/`/g, '``')}\``;
  const lit = (v: Cell): string => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
  const lines = t.columns.map((c) => {
    let l = `  ${q(c.name)} ${c.columnType}`;
    if (c.collation !== undefined && c.collation !== t.collation && CHAR_TYPES.has(c.dataType)) l += ` COLLATE ${c.collation}`;
    if (!c.nullable) l += ' NOT NULL';
    if (c.autoIncrement) l += ' AUTO_INCREMENT';
    else if (c.defaultCurrentTimestamp !== undefined) l += ` DEFAULT CURRENT_TIMESTAMP${c.defaultCurrentTimestamp ? `(${c.defaultCurrentTimestamp})` : ''}`;
    else if (c.defaultValue !== undefined) l += ` DEFAULT ${lit(c.defaultValue)}`;
    else if (c.nullable && !TEXT_TYPES.has(c.dataType) && c.dataType !== 'JSON' && !c.dataType.endsWith('BLOB')) l += ' DEFAULT NULL';
    return l;
  });
  if (t.primaryKey.length) lines.push(`  PRIMARY KEY (${t.primaryKey.map(q).join(',')})`);
  for (const u of t.uniques) lines.push(`  UNIQUE KEY ${q(u.name)} (${u.columns.map(q).join(',')})`);
  for (const i of t.indexes ?? []) lines.push(`  ${i.type === 'FULLTEXT' ? 'FULLTEXT ' : ''}KEY ${q(i.name)} (${i.columns.map((p) => q(p.name)).join(',')})`);
  const charset = t.charset ?? 'utf8mb4'; const collation = t.collation ?? databaseCollation().name;
  return `CREATE TABLE ${q(t.name)} (\n${lines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=${charset} COLLATE=${collation}`;
}

function execCreateTableSelect(db: Database, stmt: Extract<Statement, { kind: 'create-table-select' }>, write: () => void, st: StatementScope): QueryOutcome {
  write();
  if (db.tables.get(tableKey(stmt.table)) !== undefined) {
    if (stmt.ifNotExists) return noRows();
    throw tableExists(stmt.table);
  }
  const result = execSelect(db, stmt.select, st);
  const seen = new Set<string>();
  const columns: ColumnDef[] = result.fields.map((f) => {
    if (seen.has(f.name.toLowerCase())) throw new SqlError(`Duplicate column name '${f.name}'`, 'INVALID_ARGUMENT', 1060, '42S21');
    seen.add(f.name.toLowerCase());
    const columnType = f.columnType ?? 'varchar(255)';
    const m = /^(\w+)(?:\((\d+)(?:,\d+)?\))?/.exec(columnType);
    const unsigned = ((f.flags ?? 0) & FLAG_UNSIGNED) !== 0 || /\bunsigned\b/.test(columnType);
    const nullable = ((f.flags ?? 0) & FLAG_NOT_NULL) === 0;
    const col: ColumnDef = {
      name: f.name, dataType: (m?.[1] ?? 'VARCHAR').toUpperCase(), columnType, length: m?.[2] !== undefined ? Number(m[2]) : null,
      unsigned, nullable, autoIncrement: false, primaryKey: false, unique: false,
      ...(f.collation !== undefined ? { collation: f.collation, charset: f.collation.split('_')[0]! } : {}),
    };
    return nullable ? col : { ...col, defaultValue: implicitDefault(col) };
  });
  const table: TableDef = { name: stmt.table, columns, primaryKey: [], uniques: [], autoIncrement: 1 };
  const writes: Write[] = [{ kind: 'table', table }];
  // each value stored as its column's type stores it (a DOUBLE result's 25E-1 is stored as 2.5)
  result.rows.forEach((cells, i) => writes.push({ kind: 'row', table: stmt.table, row: { rowid: i + 1, cells: Object.fromEntries(columns.map((c, k) => [c.name, storeValue(c, cells[k] ?? null, fieldOperand(result.fields[k]!), { strict: st.mode.strict, row: i + 1, table: stmt.table })])) } }));
  return noRows(writes, result.rows.length);
}

function execCreateTable(db: Database, stmt: Extract<Statement, { kind: 'create-table' }>, write: () => void): QueryOutcome {
  write();
  const existing = db.tables.get(tableKey(stmt.table));
  if (existing !== undefined) {
    if (stmt.ifNotExists) return noRows();
    throw tableExists(stmt.table);
  }
  if (db.tables.size >= PLANETSCALE_LIMITS.maxTablesPerSchema) {
    throw new SqlError(`Too many tables; this database is limited to ${PLANETSCALE_LIMITS.maxTablesPerSchema} tables`, 'RESOURCE_EXHAUSTED', 1116, 'HY000');
  }
  if (stmt.columns.length === 0) {
    throw new SqlError('A table must have at least 1 column', 'INVALID_ARGUMENT', 1113, '42000');
  }
  if (stmt.columns.length > PLANETSCALE_LIMITS.maxColumnsPerTable) {
    throw new SqlError(`Too many columns; this table is limited to ${PLANETSCALE_LIMITS.maxColumnsPerTable} columns`, 'RESOURCE_EXHAUSTED', 1117, 'HY000');
  }
  const seen = new Set<string>();
  for (const c of stmt.columns) {
    const key = c.name.toLowerCase();
    if (seen.has(key)) throw new SqlError(`Duplicate column name '${c.name}'`, 'INVALID_ARGUMENT', 1060, '42S21');
    seen.add(key);
  }
  const autos = stmt.columns.filter((c) => c.autoIncrement);
  if (autos.length > 1) throw new SqlError('Incorrect table definition; there can be only one auto column and it must be defined as a key', 'INVALID_ARGUMENT', 1075, '42000');
  if (autos.length === 1 && !autos[0]!.primaryKey && !autos[0]!.unique) {
    throw new SqlError('Incorrect table definition; there can be only one auto column and it must be defined as a key', 'INVALID_ARGUMENT', 1075, '42000');
  }
  // Convert every DEFAULT to its column's type ONCE, here, as MySQL does when it creates the table
  // (a DECIMAL(10,2) DEFAULT 0 is stored and reported as 0.00; a binary column's default is its
  // bytes, so an insert never re-encodes it). A default the type refuses is errno 1067, and a
  // literal default on a TEXT/BLOB/JSON column is errno 1101 (only an expression default is allowed).
  for (let k = 0; k < stmt.columns.length; k++) stmt.columns[k] = columnWithStoredDefault(stmt.columns[k]!, stmt.table);
  const names = new Set<string>();
  for (const index of [...stmt.uniques, ...stmt.indexes]) {
    const key = index.name.toLowerCase();
    if (key === 'primary' || names.has(key)) throw new SqlError(`Duplicate key name '${index.name}'`, 'INVALID_ARGUMENT', 1061, '42000');
    names.add(key);
  }
  const table: TableDef = {
    name: stmt.table, columns: stmt.columns, primaryKey: stmt.primaryKey, uniques: stmt.uniques, autoIncrement: 1,
    ...(stmt.indexes.length ? { indexes: stmt.indexes } : {}),
    ...(stmt.charset !== undefined ? { charset: stmt.charset } : {}), ...(stmt.collation !== undefined ? { collation: stmt.collation } : {}),
  };
  return noRows([{ kind: 'table', table }]);
}

/** A parsed column with its DEFAULT converted to the column's type, as MySQL does when the column is created. */
function columnWithStoredDefault(parsed: ColumnDef, table: string): ColumnDef {
  const { defaultLiteral, ...col } = parsed;
  if (col.defaultValue === undefined) return col;
  const invalid = (): SqlError => new SqlError(`Invalid default value for '${col.name}'`, 'INVALID_ARGUMENT', 1067, '42000');
  if (col.defaultValue === null) { if (!col.nullable) throw invalid(); return col; }
  if (defaultLiteral !== 'expression' && (TEXT_TYPES.has(col.dataType) || col.dataType.endsWith('BLOB') || col.dataType === 'JSON')) {
    throw new SqlError(`BLOB, TEXT, GEOMETRY or JSON column '${col.name}' can't have a default value`, 'INVALID_ARGUMENT', 1101, '42000');
  }
  const src = typeOperand(col.defaultIsBinaryLiteral === true ? typed('VARBINARY', 'varbinary')
    : defaultLiteral === 'number' ? (/[.eE]/.test(col.defaultValue) ? typed('DOUBLE', 'double') : typed('BIGINT', 'bigint')) : typed('VARCHAR', 'varchar'));
  try { col.defaultValue = storeValue(col, col.defaultValue, src, { strict: true, row: 1, table }); } catch (err) {
    if (err instanceof SqlError) throw invalid();
    throw err;
  }
  return col;
}

/**
 * `ALTER TABLE t ADD COLUMN …`. Each column goes last, first, or after the named one (MySQL 8.0 manual, 15.1.9: "To add a
 * column at a specific position within a table row, use FIRST or AFTER col_name. The default is to add the column
 * last."), a name the table already has is errno 1060, an AFTER naming no column is errno 1054, and the table's column
 * limit holds. Every existing row takes the column's value as an INSERT that omits it would: its DEFAULT, the World
 * clock's instant for DEFAULT CURRENT_TIMESTAMP, NULL for a nullable column without one, and otherwise its type's
 * implicit default (manual 13.6, "Data Type Default Values": "For numeric types, the default is 0", "For string types
 * other than ENUM, the default value is the empty string"). Where the manual stops: neither page says what existing
 * rows receive; filling them this way is MySQL's observed behaviour, stated here as the twin's reading. A NOT NULL
 * temporal column without a DEFAULT on a table with rows would take a zero date, which MySQL's default sql_mode
 * refuses; its message is not modeled, so the twin refuses that one case as unmodeled. A column added as a key
 * (PRIMARY KEY, UNIQUE, AUTO_INCREMENT) is unmodeled too.
 */
function execAlterAddColumns(db: Database, stmt: Extract<Statement, { kind: 'alter-add-columns' }>, write: () => void, now: string | undefined): QueryOutcome {
  write();
  const table = findTable(db, stmt.table);
  const columns = [...table.columns];
  const added: ColumnDef[] = [];
  for (const add of stmt.adds) {
    const parsed = add.column;
    if (parsed.primaryKey || parsed.unique || parsed.autoIncrement) throw unsupported(`ALTER TABLE … ADD COLUMN ${parsed.name} as a key (planetscale.ddl.alter_table)`);
    if (columns.some((c) => c.name.toLowerCase() === parsed.name.toLowerCase())) throw new SqlError(`Duplicate column name '${parsed.name}'`, 'INVALID_ARGUMENT', 1060, '42S21');
    const resolved = { charset: (table.charset ?? 'utf8mb4') as Collation['charset'], collation: table.collation ?? databaseCollation().name };
    const col = resolveColumnCollation(columnWithStoredDefault(parsed, table.name), resolved);
    let at = columns.length;
    if (add.first === true) at = 0;
    else if (add.after !== undefined) {
      const i = columns.findIndex((c) => c.name.toLowerCase() === add.after!.toLowerCase());
      if (i < 0) throw badField(add.after, table.name);
      at = i + 1;
    }
    columns.splice(at, 0, col);
    added.push(col);
  }
  if (columns.length > PLANETSCALE_LIMITS.maxColumnsPerTable) {
    throw new SqlError(`Too many columns; this table is limited to ${PLANETSCALE_LIMITS.maxColumnsPerTable} columns`, 'RESOURCE_EXHAUSTED', 1117, 'HY000');
  }
  const rows = tableRows(db, table.name);
  const fill = (col: ColumnDef): Cell => {
    if (col.defaultCurrentTimestamp !== undefined) return currentTimestamp(now, col.defaultCurrentTimestamp);
    if (col.defaultValue !== undefined) return col.defaultValue;
    if (col.nullable) return null;
    if (clsOf(col) === 'temporal' && rows.length > 0) throw unsupported(`ALTER TABLE … ADD COLUMN ${col.name}: a NOT NULL temporal column with no DEFAULT on a table with rows (planetscale.ddl.alter_table)`);
    return implicitDefault(col);
  };
  const values = added.map((col) => [col.name, fill(col)] as const);
  const writes: Write[] = [{ kind: 'table', table: { ...table, columns } }];
  for (const r of rows) writes.push({ kind: 'row', table: table.name, row: { rowid: r.rowid, cells: { ...r.cells, ...Object.fromEntries(values) } } });
  return noRows(writes);
}

/**
 * `ALTER TABLE t DROP [COLUMN] c, …`: the columns leave the table and every row loses their values. A name the table
 * does not have is errno 1091 ("Can't DROP 'c'; check that column/key exists"), and dropping every column is errno 1090
 * ("You can't delete all columns with ALTER TABLE; use DROP TABLE instead"), as MySQL answers (MySQL 8.0 server error
 * reference, ER_CANT_DROP_FIELD_OR_KEY and ER_CANT_REMOVE_ALL_FIELDS). Where the twin stops: MySQL also removes the
 * column from any index holding it, and drops a primary key it was the whole of; the engine keys rows by their primary
 * key and keeps unique and secondary indexes by column, so dropping a column that is part of a key or an index is
 * refused as unmodeled.
 */
function execAlterDropColumns(db: Database, stmt: Extract<Statement, { kind: 'alter-drop-columns' }>, write: () => void): QueryOutcome {
  write();
  const table = findTable(db, stmt.table);
  let columns = [...table.columns];
  const dropped: string[] = [];
  for (const name of stmt.drops) {
    const col = columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (col === undefined) throw new SqlError(`Can't DROP '${name}'; check that column/key exists`, 'INVALID_ARGUMENT', 1091, '42000');
    const lower = col.name.toLowerCase();
    const keyed = table.primaryKey.some((k) => k.toLowerCase() === lower) || col.unique === true
      || table.uniques.some((u) => u.columns.some((c) => c.toLowerCase() === lower))
      || (table.indexes ?? []).some((i) => JSON.stringify(i).toLowerCase().includes(`"${lower}"`));
    if (keyed) throw unsupported(`ALTER TABLE … DROP COLUMN ${col.name}: a column of a key or an index (planetscale.ddl.alter_table)`);
    columns = columns.filter((c) => c !== col);
    dropped.push(col.name);
  }
  if (columns.length === 0) throw new SqlError("You can't delete all columns with ALTER TABLE; use DROP TABLE instead", 'INVALID_ARGUMENT', 1090, '42000');
  const writes: Write[] = [{ kind: 'table', table: { ...table, columns } }];
  for (const r of tableRows(db, table.name)) {
    const cells = { ...r.cells };
    for (const name of dropped) delete cells[name];
    writes.push({ kind: 'row', table: table.name, row: { rowid: r.rowid, cells } });
  }
  return noRows(writes);
}

function execDropTable(db: Database, stmt: Extract<Statement, { kind: 'drop-table' }>, write: () => void): QueryOutcome {
  write();
  const existing = db.tables.get(tableKey(stmt.table));
  if (existing === undefined) {
    if (stmt.ifExists) return noRows();
    throw new SqlError(`Unknown table '${db.name}.${stmt.table}'`, 'NOT_FOUND', 1051, '42S02');
  }
  const writes: Write[] = tableRows(db, stmt.table).map((r) => ({ kind: 'delete-row' as const, table: existing.name, rowid: r.rowid }));
  writes.push({ kind: 'drop-table', table: existing.name });
  return noRows(writes);
}

function execTruncate(db: Database, stmt: Extract<Statement, { kind: 'truncate' }>, write: () => void): QueryOutcome {
  write();
  const table = findTable(db, stmt.table);
  const writes: Write[] = tableRows(db, table.name).map((r) => ({ kind: 'delete-row' as const, table: table.name, rowid: r.rowid }));
  // MySQL's TRUNCATE resets AUTO_INCREMENT; DELETE does not. Reproducing that difference is the
  // whole reason the two are separate statements here rather than one code path.
  writes.push({ kind: 'table', table: { ...table, autoIncrement: 1 } });
  return noRows(writes);
}

const SHOW_TABLES_FIELD = (db: string): Field => ({
  name: `Tables_in_${db}`, type: 'VARCHAR', charset: UTF8MB4_CHARSET, columnLength: 256, flags: FLAG_NOT_NULL, columnType: 'varchar(64)',
});

function execShowTables(db: Database): QueryOutcome {
  const names = [...db.tables.values()].map((t) => t.name).sort((a, b) => a.localeCompare(b));
  return { fields: [SHOW_TABLES_FIELD(db.name)], rows: names.map((n) => [n]), rowsAffected: 0, insertId: 0, writes: [] };
}

const DESCRIBE_FIELDS: Field[] = ['Field', 'Type', 'Null', 'Key', 'Default', 'Extra'].map((name) => ({
  name, type: 'VARCHAR', charset: UTF8MB4_CHARSET, columnLength: 256, columnType: 'varchar(64)',
}));

function execDescribe(db: Database, name: string): QueryOutcome {
  const table = findTable(db, name);
  const rows: Cell[][] = table.columns.map((c) => [
    c.name,
    c.columnType,
    c.nullable ? 'YES' : 'NO',
    c.primaryKey ? 'PRI' : c.unique ? 'UNI' : '',
    c.defaultValue === undefined ? null : c.defaultValue,
    c.autoIncrement ? 'auto_increment' : '',
  ]);
  return { fields: DESCRIBE_FIELDS, rows, rowsAffected: 0, insertId: 0, writes: [] };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SELECT: FROM (tables, views, derived tables, joins) → WHERE → GROUP BY/aggregates → HAVING →
// ORDER BY → projection → DISTINCT → LIMIT, with scalar/IN/EXISTS subqueries bound into the scope.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** One table of an executing statement. `idx` is its position in every row tuple. */
type Source = {
  idx: number;
  /** what a qualifier names it by: its alias, else its table name. */
  name: string;
  table: TableDef;
  /** the schema `Field.database` reports for its columns. */
  database: Database;
  rows: Array<Record<string, Cell>>;
  /** a stored table's row identities, keyed by the cell record, for locking reads. */
  rowids?: Map<Record<string, Cell>, number>;
};

/** One query level's tables. `outerRefs` collects the columns of THESE tables that a nested
 *  subquery reads (a correlated reference), which ONLY_FULL_GROUP_BY checks like its own. */
type Scope = { sources: Source[]; parent?: Scope; correlated: boolean; outerRefs?: Array<Extract<Expr, { kind: 'slot' }>> };

/** Per-statement execution state: the image, a source counter shared by every nesting level (so a
 *  correlated subquery's tuple can carry its outer rows at their own indices), and each stored
 *  table's rows in clustered-index order, sorted once per statement. */
type ExecCtx = {
  db: Database; next: number; sources: Map<number, Source>; clustered: Map<string, RowRec[]>;
  /** An UPDATE/DELETE's target table (lowercased): a subquery reading it is errno 1093. */
  target?: string;
  /** A multiple-table UPDATE's target tables (lowercased): a subquery reading any of them is errno 1093. */
  targets?: Set<string>;
  /** …except the statement's own table references, which name them: only a subquery's reading is refused. */
  targetFactors?: Set<object>;
  /** How deep planning is inside derived tables, which MySQL materialises before the update. */
  derived: number;
  /** The running statement's scope; its World clock instant is what binding replaces each clock function with. */
  statement: StatementScope;
};

const newCtx = (db: Database, statement: StatementScope): ExecCtx => ({ db, next: 0, sources: new Map(), clustered: new Map(), derived: 0, statement });
const EMPTY_CELLS: Record<string, Cell> = {};
const lower = (s: string): string => s.toLowerCase();

// The last clustered order of each table definition (definitions are shared by every image until a schema change
// replaces them), reused while the table holds the same row records in the same order: the sort, one collation
// compare per pair, ran on every statement and grew with the table.
const clusteredMemo = new WeakMap<TableDef, { input: RowRec[]; rows: RowRec[] }>();

/**
 * A stored table's rows in PRIMARY KEY order. InnoDB stores a table as its clustered index, so a
 * read with no ORDER BY returns rows in primary-key order; a table with no primary key is
 * clustered on its hidden row id, which is insertion order (the engine's local rowid order).
 */
function clusteredRows(ctx: ExecCtx, table: TableDef): RowRec[] {
  const key = tableKey(table.name);
  const cached = ctx.clustered.get(key);
  if (cached !== undefined) return cached;
  let rows = tableRows(ctx.db, table.name);
  const sorted = clusteredMemo.get(table);
  if (sorted && sorted.input.length === rows.length && sorted.input.every((r, i) => r === rows[i])) {
    ctx.clustered.set(key, sorted.rows);
    return sorted.rows;
  }
  // its own copy, so the memo holds exactly the records it was sorted from, whoever holds the array
  const input = [...rows]; rows = input;
  if (table.primaryKey.length > 0) {
    // The clustered index is ordered by each key column's collation, as InnoDB orders it.
    const cols = table.primaryKey.map((n) => table.columns.find((c) => lower(c.name) === lower(n))!).filter(Boolean);
    const order = cols.map((c) => orderKey(typeOperand(c)));
    const keyed = rows.map((r) => ({ r, k: cols.map((c, i) => { const v = r.cells[c.name] ?? null; return v === null ? null : order[i]!.key(v); }) }));
    keyed.sort((a, b) => {
      for (let i = 0; i < cols.length; i++) {
        const x = a.k[i]; const y = b.k[i];
        const cmp = x === null || y === null ? (x === y ? 0 : x === null ? -1 : 1) : order[i]!.cmp(x, y);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
    rows = keyed.map((x) => x.r);
  }
  clusteredMemo.set(table, { input, rows });
  ctx.clustered.set(key, rows);
  return rows;
}

function openFactor(ctx: ExecCtx, factor: TableFactor): Source {
  const idx = ctx.next++;
  let source: Source;
  if ('derived' in factor) {
    // A derived table is its subquery's result read as a table, materialised once. MySQL 8
    // derived tables cannot see the enclosing query (no LATERAL), so it plans with no parent scope.
    ctx.derived++;
    let inner: ReturnType<SelectPlan['execute']>;
    try { inner = planSelect(ctx, factor.derived).execute(undefined); } finally { ctx.derived--; }
    const columns = inner.fields.map(columnForField);
    const seen = new Set<string>();
    for (const c of columns) {
      if (seen.has(lower(c.name))) throw new SqlError(`Duplicate column name '${c.name}'`, 'INVALID_ARGUMENT', 1060, '42S21');
      seen.add(lower(c.name));
    }
    const table: TableDef = { name: factor.alias, columns, primaryKey: [], uniques: [], autoIncrement: 0 };
    const rows = inner.rows.map((cells) => Object.fromEntries(columns.map((c, i) => [c.name, cells[i] ?? null])));
    source = { idx, name: factor.alias, table, database: emptyDatabase(''), rows };
  } else if (isInformationSchema(factor.schema)) {
    const view = informationSchemaView(ctx.db, factor.table);
    if (view === undefined) throw new SqlError(`Unknown table '${factor.table.toUpperCase()}' in information_schema`, 'NOT_FOUND', 1109, '42S02');
    source = { idx, name: factor.alias ?? view.table.name, table: view.table, database: emptyDatabase(INFORMATION_SCHEMA), rows: view.rows };
  } else {
    const table = findTable(ctx.db, factor.table);
    // MySQL cannot modify a table and select from it in a subquery (manual 15.2.15.12): errno
    // 1093. A derived table is materialised first, so reading the target through one is allowed.
    if (ctx.derived === 0 && ((ctx.target !== undefined && tableKey(table.name) === ctx.target) || (ctx.targets?.has(tableKey(table.name)) && !ctx.targetFactors?.has(factor)))) {
      throw new SqlError(`You can't specify target table '${factor.alias ?? table.name}' for update in FROM clause`, 'INVALID_ARGUMENT', 1093, 'HY000');
    }
    const recs = clusteredRows(ctx, table);
    source = {
      idx, name: factor.alias ?? factor.table, table, database: ctx.db, rows: recs.map((r) => r.cells),
      rowids: new Map(recs.map((r) => [r.cells, r.rowid])),
    };
  }
  ctx.sources.set(idx, source);
  return source;
}

function addSource(scope: Scope, source: Source): void {
  if (scope.sources.some((s) => lower(s.name) === lower(source.name))) throw new SqlError(`Not unique table/alias: '${source.name}'`, 'INVALID_ARGUMENT', 1066, '42000');
  scope.sources.push(source);
}

const slotFor = (source: Source, column: ColumnDef): Expr => ({ kind: 'slot', src: source.idx, col: column.name, def: column });

/**
 * Resolve a column reference MySQL's way: the innermost scope first, a qualifier naming a table by
 * its alias (or its name when unaliased), an unqualified name that two tables share is ambiguous
 * (errno 1052), and a name no scope has is errno 1054. A reference resolved in an ENCLOSING scope
 * makes every scope between them correlated, so their subqueries re-run per outer row.
 */
function resolveColumn(ref: { table?: string; name: string }, scope: Scope, where: string, required = true): Expr | undefined {
  for (let s: Scope | undefined = scope; s !== undefined; s = s.parent) {
    const named = ref.table === undefined ? s.sources : s.sources.filter((src) => lower(src.name) === lower(ref.table!));
    const hits: Array<{ source: Source; column: ColumnDef }> = [];
    for (const source of named) {
      const column = source.table.columns.find((c) => lower(c.name) === lower(ref.name));
      if (column !== undefined) hits.push({ source, column });
    }
    if (hits.length > 1) throw new SqlError(`Column '${ref.name}' in ${where} is ambiguous`, 'INVALID_ARGUMENT', 1052, '23000');
    if (hits.length === 1) {
      for (let t: Scope | undefined = scope; t !== undefined && t !== s; t = t.parent) t.correlated = true;
      const slot = slotFor(hits[0]!.source, hits[0]!.column) as Extract<Expr, { kind: 'slot' }>;
      if (s !== scope) (s.outerRefs ??= []).push(slot);
      return slot;
    }
    if (ref.table !== undefined && named.length > 0) break;
  }
  if (!required) return undefined;
  throw badField(ref.table === undefined ? ref.name : `${ref.table}.${ref.name}`, where);
}

/** The aggregates a grouped SELECT computes: each call is bound once and read through a slot of a
 *  synthetic source (`src`) that every group row carries. */
type AggState = { src: number; list: Array<{ call: Extract<Expr, { kind: 'call' }>; args: Expr[]; col: string; def: ColumnDef; order?: OrderTerm[] }> };

type BindOpts = {
  where: string;
  /** select-list aliases, consulted FIRST (ORDER BY, HAVING) or as a FALLBACK (GROUP BY). */
  aliases?: Map<string, Expr>;
  aliasFallback?: boolean;
  aggs?: AggState;
  inAggregate?: boolean;
};

/** A binary-string operand of a bit operator: a binary string that is not a hexadecimal, bit-value or NULL literal. */
const binaryStringOperand = (e: Expr): boolean =>
  !(e.kind === 'literal' && (e.hex === true || e.value === null)) && (e.kind === 'literal' ? e.hint === 'VARBINARY' : e.kind === 'unary' && e.op === 'BINARY');
/** Whether a bit operator is evaluated in binary-string mode (manual 14.12: "Binary-string evaluation occurs … if the
 *  arguments … are binary strings, and at least one of them is not a hexadecimal literal, bit-value literal, or NULL
 *  literal"; for a shift, its first argument). Where a binary string's type is only known once bound, the operator's
 *  evaluation decides again (evalBitwise). */
function binaryBitwise(op: string, left: Expr, right: Expr, row?: EvalRow): boolean {
  const isBin = (e: Expr): boolean => e.kind === 'literal' ? e.hint === 'VARBINARY' : e.kind === 'unary' ? e.op === 'BINARY'
    : row !== undefined && clsOf(staticType(e, row)) === 'binary';
  const binaryStringOperand = (e: Expr): boolean => !(e.kind === 'literal' && (e.hex === true || e.value === null)) && isBin(e);
  if (op === '<<' || op === '>>') return binaryStringOperand(left);
  return isBin(left) && isBin(right) && (binaryStringOperand(left) || binaryStringOperand(right));
}

/** A hexadecimal or bit-value literal read as the unsigned number its bytes spell; any other expression as it is. */
function hexAsNumber(e: Expr): Expr {
  if (e.kind !== 'literal' || e.hex !== true || e.value === null) return e;
  let n = 0n;
  for (const ch of e.value) n = (n << 8n) | BigInt(ch.charCodeAt(0));
  return { kind: 'literal', value: n.toString(), hint: 'UINT64' };
}

function bindExpr(ctx: ExecCtx, e: Expr, scope: Scope, opts: BindOpts): Expr {
  const b = (x: Expr): Expr => bindExpr(ctx, x, scope, opts);
  switch (e.kind) {
    case 'column': {
      if (opts.aliases !== undefined && e.table === undefined && !opts.aliasFallback) {
        const aliased = opts.aliases.get(lower(e.name));
        if (aliased !== undefined) return aliased;
      }
      const found = resolveColumn(e, scope, opts.where, !opts.aliasFallback);
      if (found !== undefined) return found;
      const aliased = e.table === undefined ? opts.aliases?.get(lower(e.name)) : undefined;
      if (aliased !== undefined) return aliased;
      throw badField(e.table === undefined ? e.name : `${e.table}.${e.name}`, opts.where);
    }
    case 'unary': return { ...e, arg: b(e.op === '~' || e.op === '-' ? hexAsNumber(e.arg) : e.arg) };
    case 'collate': return { ...e, arg: b(e.arg) };
    case 'isnull': return { ...e, arg: b(e.arg) };
    case 'is': return { ...e, arg: b(e.arg) };
    case 'cast': return { ...e, arg: b(e.arg) };
    case 'member': return { ...e, arg: b(e.arg), doc: b(e.doc) };
    case 'binary': {
      // "In numeric contexts, MySQL treats a hexadecimal literal like a BIGINT UNSIGNED" (manual 11.1.4); so does a
      // bit-value literal (11.1.5): an arithmetic or bit operator reads one as its number
      const bitwise = ['&', '|', '^', '<<', '>>'].includes(e.op);
      const numeric = ['+', '-', '*', '/', 'DIV', '%'].includes(e.op) || (bitwise && !binaryBitwise(e.op, e.left, e.right));
      return { ...e, left: b(numeric ? hexAsNumber(e.left) : e.left), right: b(numeric ? hexAsNumber(e.right) : e.right) };
    }
    case 'like': return { ...e, arg: b(e.arg), pattern: b(e.pattern), ...(e.escape !== undefined ? { escape: b(e.escape) } : {}) };
    case 'between': return { ...e, arg: b(e.arg), low: b(e.low), high: b(e.high) };
    case 'row': return { ...e, items: e.items.map(b) };
    case 'case': return {
      ...e, whens: e.whens.map((w) => ({ when: b(w.when), then: b(w.then) })),
      ...(e.operand !== undefined ? { operand: b(e.operand) } : {}), ...(e.otherwise !== undefined ? { otherwise: b(e.otherwise) } : {}),
    };
    case 'in': {
      const arg = b(e.arg);
      if (e.subquery !== undefined) {
        // MySQL 8 cannot execute LIMIT inside an IN subquery (manual 15.2.15.10, "Restrictions on
        // Subqueries"): errno 1235. A derived table around it is the documented workaround.
        if (e.subquery.limit !== undefined) throw new SqlError("This version of MySQL doesn't yet support 'LIMIT & IN/ALL/ANY/SOME subquery'", 'UNIMPLEMENTED', 1235, '42000');
        return { ...e, arg, run: bindSubquery(ctx, e.subquery, scope) };
      }
      return { ...e, arg, list: e.list.map(b) };
    }
    case 'subquery': case 'exists': return { ...e, run: bindSubquery(ctx, e.select, scope) };
    case 'call': {
      if (AGGREGATES.has(e.name)) {
        if (opts.aggs === undefined || opts.inAggregate) throw new SqlError('Invalid use of group function', 'INVALID_ARGUMENT', 1111, 'HY000');
        const args = e.args.map((a) => bindExpr(ctx, a, scope, { where: opts.where, inAggregate: true }));
        const col = `agg${opts.aggs.list.length}`;
        const def = aggregateColumn(e, args, col);
        const order = e.order?.map((o) => ({ expr: bindExpr(ctx, o.expr, scope, { where: opts.where, inAggregate: true }), desc: o.desc }));
        opts.aggs.list.push({ call: e, args, col, def, ...(order ? { order } : {}) });
        return { kind: 'slot', src: opts.aggs.src, col, def };
      }
      if (CLOCK_FUNCTIONS.has(e.name) && !(e.name === 'UNIX_TIMESTAMP' && e.args.length > 0)) { const c = clockValue(e, ctx.statement.now, ctx.statement.timeZone); return { kind: 'literal', value: c.value, hint: c.hint }; }
      // MOD(N, M) is the `%` operator (manual 14.6.2, MOD(): "Modulo operation. Returns the remainder of N divided by M")
      if (e.name === 'MOD') {
        if (e.args.length !== 2) throw new SqlError("Incorrect parameter count in the call to native function 'MOD'", 'INVALID_ARGUMENT', 1582, '42000');
        return b({ kind: 'binary', op: '%', left: e.args[0]!, right: e.args[1]! });
      }
      if (!KNOWN_FUNCTIONS.has(e.name)) {
        throw unsupported(`the ${e.name}() function`);
      }
      return { ...e, args: e.args.map(b) };
    }
    default: return e;
  }
}

/** A subquery bound in `scope`: planned once, executed once when it is uncorrelated (MySQL
 *  materialises it) or per outer row when it references the enclosing query. */
function bindSubquery(ctx: ExecCtx, select: SelectStatement, scope: Scope): SubqueryRun {
  const plan = planSelect(ctx, select, scope);
  let cached: { fields: Field[]; rows: Cell[][] } | undefined;
  const run = (row: EvalRow): { fields: Field[]; rows: Cell[][] } => {
    if (!plan.correlated) return (cached ??= plan.execute(undefined));
    return plan.execute(row.tuple);
  };
  return Object.assign(run, { fields: plan.fields });
}

function containsAggregate(e: Expr | undefined): boolean {
  if (e === undefined) return false;
  switch (e.kind) {
    case 'call': return AGGREGATES.has(e.name) || e.args.some(containsAggregate);
    case 'unary': case 'isnull': case 'collate': case 'is': case 'cast': return containsAggregate(e.arg);
    case 'member': return containsAggregate(e.arg) || containsAggregate(e.doc);
    case 'binary': return containsAggregate(e.left) || containsAggregate(e.right);
    case 'like': return containsAggregate(e.arg) || containsAggregate(e.pattern) || containsAggregate(e.escape);
    case 'between': return containsAggregate(e.arg) || containsAggregate(e.low) || containsAggregate(e.high);
    case 'in': return containsAggregate(e.arg) || e.list.some(containsAggregate);
    case 'row': return e.items.some(containsAggregate);
    case 'case': return containsAggregate(e.operand) || containsAggregate(e.otherwise) || e.whens.some((w) => containsAggregate(w.when) || containsAggregate(w.then));
    default: return false; // a subquery's aggregates are its own
  }
}

/** The static type of a bound expression when it has one (`staticType` at bind time). */
const typeOf = (e: Expr): ColumnDef | undefined => staticType(e, undefined) ?? undefined;

const EXACT_TYPES = new Set(['TINYINT', 'SMALLINT', 'MEDIUMINT', 'INT', 'INTEGER', 'BIGINT', 'DECIMAL', 'NUMERIC', 'BOOL', 'BOOLEAN', 'YEAR', 'BIT']);
const decimalScale = (c: ColumnDef | undefined): number => {
  if (c === undefined || !['DECIMAL', 'NUMERIC'].includes(c.dataType)) return 0;
  return Number(/\(\s*\d+\s*,\s*(\d+)\s*\)/.exec(c.columnType)?.[1] ?? 0);
};
const synthetic = (name: string, dataType: string, columnType: string, nullable = true): ColumnDef =>
  ({ name, dataType, columnType, length: null, unsigned: false, nullable, autoIncrement: false, primaryKey: false, unique: false });

/** An aggregate's result type, per MySQL 8: COUNT is BIGINT; SUM/AVG of an exact numeric is
 *  DECIMAL (AVG adds four digits of scale), of anything else DOUBLE; MIN/MAX keep the argument's
 *  type; JSON_ARRAYAGG is JSON; GROUP_CONCAT is text. */
function aggregateColumn(call: Extract<Expr, { kind: 'call' }>, args: Expr[], name: string): ColumnDef {
  const arg = typeOf(args[0] ?? { kind: 'literal', value: null, hint: 'NULL' });
  const exact = arg !== undefined ? EXACT_TYPES.has(arg.dataType) : args[0]?.kind === 'literal' && INTEGRAL.has(args[0].hint);
  switch (call.name) {
    case 'COUNT': return synthetic(name, 'BIGINT', 'bigint', false);
    case 'SUM': return exact ? synthetic(name, 'DECIMAL', `decimal(65,${decimalScale(arg)})`) : synthetic(name, 'DOUBLE', 'double');
    // AVG of an exact value: its precision and scale each widened by four (div_precision_increment), as the manual's
    // DESCRIBE of `CREATE TABLE y SELECT AVG(i), AVG(d) …` shows for INT and DECIMAL: decimal(14,4) (14.24.5)
    case 'AVG': {
      if (!exact) return synthetic(name, 'DOUBLE', 'double');
      const v = numView(arg ?? null);
      const scale = Math.min(30, decimalScale(arg) + 4);
      return { ...decimalType(v.k === 'null' ? 65 : Math.min(65, v.int + v.scale + 4), scale), name };
    }
    case 'MIN': case 'MAX': return arg !== undefined ? { ...arg, name, nullable: true, primaryKey: false, unique: false, autoIncrement: false } : synthetic(name, 'VARCHAR', 'varchar(255)');
    case 'JSON_ARRAYAGG': return synthetic(name, 'JSON', 'json');
    default: return { ...synthetic(name, 'TEXT', 'text'), ...(arg?.collation !== undefined ? { collation: arg.collation } : {}) };
  }
}

/** GROUP_CONCAT's ORDER BY between two rows' order values: NULL first ascending. */
function concatOrder(orders: { cmp: (a: string, b: string) => number; desc: boolean }[]) {
  return (a: { o: Cell[] }, b: { o: Cell[] }): number => {
    for (let i = 0; i < orders.length; i++) {
      const x = a.o[i] ?? null; const y = b.o[i] ?? null;
      const c = x === null ? (y === null ? 0 : -1) : y === null ? 1 : orders[i]!.cmp(x, y);
      if (c !== 0) return orders[i]!.desc ? -c : c;
    }
    return 0;
  };
}

/** MIN/MAX's step between the value held so far and the next, under the argument's order. */
function extreme(name: string, order: (a: string, b: string) => number) {
  return (best: string, v: string): string => {
    const cmp = order(v, best);
    return (name === 'MIN' ? cmp < 0 : cmp > 0) ? v : best;
  };
}

function computeAggregate(agg: AggState['list'][number], rows: Tuple[], database: string, statement: StatementScope): Cell {
  const evalAt = (t: Tuple, e: Expr): Cell => evalExpr(e, { cells: EMPTY_CELLS, tuple: t, database, statement });
  const { call, args, def } = agg;
  if (call.name === 'COUNT' && call.star) return String(rows.length);
  // The argument values per row; DISTINCT keeps the first of each tuple of values that compare
  // equal under their collations (COUNT(DISTINCT email) counts 'A@x' and 'a@x' once under a _ci column).
  // GROUP_CONCAT's ORDER BY: each row's order values beside its argument values, sorted before they are joined
  let pairs = rows.map((t) => ({ v: args.map((a) => evalAt(t, a)), o: (agg.order ?? []).map((ot) => evalAt(t, ot.expr)) }));
  if (call.name !== 'JSON_ARRAYAGG') pairs = pairs.filter((p) => p.v.every((x) => x !== null));
  const probe: EvalRow = { cells: EMPTY_CELLS, tuple: rows[0] ?? [], database, statement };
  if (call.distinct) {
    const keys = args.map((a) => keyer(operandOf(a, probe)));
    const seen = new Set<string>();
    pairs = pairs.filter((p) => { const k = JSON.stringify(p.v.map((x, i) => keys[i]!(x))); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  if (agg.order?.length) {
    const orders = agg.order.map((ot) => ({ cmp: sorter(operandOf(ot.expr, probe)), desc: ot.desc }));
    pairs = [...pairs].sort(concatOrder(orders));
  }
  const values: Cell[][] = pairs.map((p) => p.v);
  const firsts = values.map((v) => v[0]!);
  switch (call.name) {
    case 'COUNT': return String(values.length);
    case 'SUM': case 'AVG': {
      if (firsts.length === 0) return null;
      const o = operandOf(args[0]!, probe);
      if (def.dataType === 'DECIMAL') {
        // Exact: SUM keeps its argument's scale; AVG adds div_precision_increment (4) digits.
        const inScale = decimalScale(typeOf(args[0]!));
        const total = firsts.reduce((acc, v) => decAdd(acc, decRound(toDec(v, o), inScale)), { m: 0n, s: inScale } as Dec);
        if (call.name === 'SUM') return decText(total, inScale);
        return decText(decDiv(total, decFromBigInt(BigInt(firsts.length)), decimalScale(def))!, decimalScale(def));
      }
      const total = firsts.reduce((acc, v) => acc + toDouble(v, o), 0);
      return formatDouble(call.name === 'SUM' ? total : total / firsts.length);
    }
    case 'MIN': case 'MAX': {
      if (firsts.length === 0) return null;
      // Strings are ordered by the argument's collation: MAX over 'a', 'B' is 'B' under a _ci collation.
      const order = sorter(operandOf(args[0]!, probe));
      return firsts.reduce(extreme(call.name, order));
    }
    case 'JSON_ARRAYAGG': {
      if (rows.length === 0) return null;
      return printJson(values.map((v) => sqlToJson(args[0]!, v[0] ?? null, probe)));
    }
    default: {
      if (firsts.length === 0) return null;
      // GROUP_CONCAT's result is cut at group_concat_max_len (1024) bytes, as MySQL cuts it.
      const text = values.map((v) => v.join('')).join(call.separator ?? ',');
      if (new TextEncoder().encode(text).length <= GROUP_CONCAT_MAX_LEN) return text;
      let cut = ''; let used = 0;
      for (const ch of text) { const n = new TextEncoder().encode(ch).length; if (used + n > GROUP_CONCAT_MAX_LEN) break; used += n; cut += ch; }
      return cut;
    }
  }
}

/** Split a predicate into its AND-ed conjuncts. */
function conjuncts(e: Expr | undefined, out: Expr[] = []): Expr[] {
  if (e === undefined) return out;
  if (e.kind === 'binary' && e.op === 'AND') { conjuncts(e.left, out); conjuncts(e.right, out); return out; }
  out.push(e);
  return out;
}

/** The sources a bound expression reads, or undefined when it holds a subquery (whose reads are
 *  not visible here), which keeps it out of the predicate pushdown below. */
function sourcesRead(e: Expr, out: Set<number> = new Set()): Set<number> | undefined {
  switch (e.kind) {
    case 'slot': out.add(e.src); return out;
    case 'subquery': case 'exists': return undefined;
    case 'in': if (e.subquery !== undefined) return undefined; return [e.arg, ...e.list].every((x) => sourcesRead(x, out) !== undefined) ? out : undefined;
    case 'unary': case 'isnull': case 'collate': return sourcesRead(e.arg, out);
    case 'binary': return sourcesRead(e.left, out) && sourcesRead(e.right, out);
    case 'like': return sourcesRead(e.arg, out) && sourcesRead(e.pattern, out);
    case 'between': return sourcesRead(e.arg, out) && sourcesRead(e.low, out) && sourcesRead(e.high, out);
    case 'call': return e.args.every((x) => sourcesRead(x, out) !== undefined) ? out : undefined;
    case 'row': return e.items.every((x) => sourcesRead(x, out) !== undefined) ? out : undefined;
    case 'case': return [e.operand, e.otherwise, ...e.whens.flatMap((w) => [w.when, w.then])].every((x) => x === undefined || sourcesRead(x, out) !== undefined) ? out : undefined;
    default: return out;
  }
}

/** An equi-join key of `on` for the joined source: pairs of (joined-source slot, other-side expr)
 *  taken from `a = b` and `(a, b) = (c, d)` conjuncts. The join then probes a hash of the joined
 *  source's rows instead of scanning it for every left row; the full ON still decides each match. */
function equiKeys(on: Expr | undefined, joined: number): Array<{ inner: Extract<Expr, { kind: 'slot' }>; outer: Expr; innerLeft: boolean }> {
  const keys: Array<{ inner: Extract<Expr, { kind: 'slot' }>; outer: Expr; innerLeft: boolean }> = [];
  for (const c of conjuncts(on)) {
    if (c.kind !== 'binary' || c.op !== '=') continue;
    const l = c.left.kind === 'row' ? c.left.items : [c.left];
    const r = c.right.kind === 'row' ? c.right.items : [c.right];
    if (l.length !== r.length) continue;
    l.forEach((a, i) => {
      const bb = r[i]!;
      const side = (x: Expr, y: Expr, innerLeft: boolean): void => {
        const reads = sourcesRead(y);
        if (x.kind === 'slot' && x.src === joined && reads !== undefined && !reads.has(joined)) keys.push({ inner: x, outer: y, innerLeft });
      };
      side(a, bb, true); side(bb, a, false);
    });
  }
  return keys;
}


type Projection = { item: SelectItem; expr: Expr; field?: Field; refs: SlotExpr[] };
type SlotExpr = Extract<Expr, { kind: 'slot' }>;
export type SelectPlan = {
  correlated: boolean;
  /** the result columns, typed statically from the select list (no row is read to type them). */
  fields: () => Field[];
  execute: (outer: Tuple | undefined) => { fields: Field[]; rows: Cell[][]; locked: Array<{ table: string; rowid: number }> };
};

/** A structural signature of a bound expression: two expressions with one signature are the same
 *  expression (a select item that IS a GROUP BY expression, an ORDER BY term in the select list). */
const exprSig = (e: Expr): string => JSON.stringify(e, (k, v) => (k === 'def' ? undefined : v));

/** The slots of this query's own tables an expression reads outside aggregates and subqueries. */
function ownSlots(e: Expr, own: Set<number>, out: SlotExpr[] = []): SlotExpr[] {
  const walk = (x: Expr | undefined): void => {
    if (x === undefined) return;
    switch (x.kind) {
      case 'slot': if (own.has(x.src)) out.push(x); return;
      case 'subquery': case 'exists': return;
      case 'in': walk(x.arg); x.list.forEach(walk); return;
      case 'unary': case 'isnull': case 'collate': case 'is': case 'cast': walk(x.arg); return;
      case 'member': walk(x.arg); walk(x.doc); return;
      case 'binary': walk(x.left); walk(x.right); return;
      case 'like': walk(x.arg); walk(x.pattern); walk(x.escape); return;
      case 'between': walk(x.arg); walk(x.low); walk(x.high); return;
      case 'call': x.args.forEach(walk); return;
      case 'row': x.items.forEach(walk); return;
      case 'case': walk(x.operand); walk(x.otherwise); x.whens.forEach((w) => { walk(w.when); walk(w.then); }); return;
      default: return;
    }
  };
  walk(e);
  return out;
}

/** A column as MySQL's GROUP BY / DISTINCT messages name it: `db.table.column`. */
function qualifiedColumn(ctx: ExecCtx, slot: SlotExpr): string {
  const source = ctx.sources.get(slot.src);
  const db = source?.database.name ?? '';
  return `${db === '' ? '' : `${db}.`}${source?.name ?? ''}.${slot.col}`;
}

/**
 * ONLY_FULL_GROUP_BY (MySQL 8's default; manual 14.19.3 "MySQL Handling of GROUP BY"): in a
 * grouped query every select-list, HAVING and ORDER BY expression outside an aggregate must be a
 * GROUP BY expression or read only columns FUNCTIONALLY DEPENDENT on the GROUP BY columns (manual
 * 14.19.4 "Detection of Functional Dependence"): a grouped column; a column equated in WHERE or an
 * inner join's ON to a constant or a dependent column; every column of a table whose PRIMARY KEY
 * or NOT NULL UNIQUE key is dependent; and an outer-joined table's column its ON equates to a
 * dependent column of the preserved side. A violation is errno 1055, or 1140 in an aggregated
 * query without GROUP BY. A correlated subquery's references to this query's columns are checked
 * with the expression that holds the subquery.
 */
function checkFullGroupBy(ctx: ExecCtx, scope: Scope, explicit: boolean, groupBy: Expr[], where: Expr | undefined,
  joins: Array<{ kind: JoinClause['kind']; source: Source; on?: Expr }>, aggSrc: number,
  checks: Array<{ clause: string; index: number; expr: Expr; refs: SlotExpr[] }>): void {
  const own = new Set(scope.sources.map((x) => x.idx));
  const key = (x: SlotExpr): string => `${x.src}:${lower(x.col)}`;
  const det = new Set<string>();
  for (const g of groupBy) if (g.kind === 'slot' && own.has(g.src)) det.add(key(g));
  const eqs: Array<{ l: Expr; r: Expr; inner?: number }> = [];
  for (const c of conjuncts(where)) if (c.kind === 'binary' && c.op === '=') eqs.push({ l: c.left, r: c.right });
  for (const j of joins) for (const c of conjuncts(j.on)) if (c.kind === 'binary' && c.op === '=') eqs.push({ l: c.left, r: c.right, ...(j.kind === 'left' ? { inner: j.source.idx } : {}) });
  const determined = (x: Expr, notFrom?: number): boolean => {
    const reads = sourcesRead(x);
    if (reads === undefined) return false;
    if (notFrom !== undefined && reads.has(notFrom)) return false;
    return ownSlots(x, own).every((y) => det.has(key(y)));
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const { l, r, inner } of eqs) {
      for (const [a, b] of [[l, r], [r, l]] as const) {
        if (a.kind !== 'slot' || !own.has(a.src) || det.has(key(a))) continue;
        if (inner !== undefined && a.src !== inner) continue;
        if (determined(b, inner)) { det.add(key(a)); changed = true; }
      }
    }
    for (const source of scope.sources) {
      const t = source.table;
      const notNull = (n: string): boolean => t.columns.some((c) => lower(c.name) === lower(n) && !c.nullable);
      const keys = [
        ...(t.primaryKey.length > 0 ? [t.primaryKey] : []),
        ...t.uniques.map((u) => u.columns).filter((cols) => cols.every(notNull)),
        ...t.columns.filter((c) => c.unique && !c.nullable).map((c) => [c.name]),
      ];
      if (!keys.some((cols) => cols.every((n) => det.has(`${source.idx}:${lower(n)}`)))) continue;
      for (const c of t.columns) if (!det.has(`${source.idx}:${lower(c.name)}`)) { det.add(`${source.idx}:${lower(c.name)}`); changed = true; }
    }
  }
  const groupSigs = new Set(groupBy.map(exprSig));
  for (const { clause, index, expr, refs } of checks) {
    if (groupSigs.has(exprSig(expr))) continue;
    const walk = (x: Expr): SlotExpr | undefined => {
      if (groupSigs.has(exprSig(x))) return undefined;
      if (x.kind === 'slot') return x.src !== aggSrc && own.has(x.src) && !det.has(key(x)) ? x : undefined;
      for (const child of childExprs(x)) { const bad = walk(child); if (bad !== undefined) return bad; }
      return undefined;
    };
    const bad = walk(expr) ?? refs.find((x) => own.has(x.src) && !det.has(key(x)));
    if (bad === undefined) continue;
    if (!explicit) {
      throw new SqlError(`In aggregated query without GROUP BY, expression #${index} of ${clause} contains nonaggregated column '${qualifiedColumn(ctx, bad)}'; this is incompatible with sql_mode=only_full_group_by`, 'INVALID_ARGUMENT', 1140, '42000');
    }
    throw new SqlError(`Expression #${index} of ${clause} is not in GROUP BY clause and contains nonaggregated column '${qualifiedColumn(ctx, bad)}' which is not functionally dependent on columns in GROUP BY clause; this is incompatible with sql_mode=only_full_group_by`, 'INVALID_ARGUMENT', 1055, '42000');
  }
}

/** An expression's direct operands (a subquery's own expressions are its own). */
function childExprs(x: Expr): Expr[] {
  switch (x.kind) {
    case 'in': return [x.arg, ...x.list];
    case 'unary': case 'isnull': case 'collate': case 'is': case 'cast': return [x.arg];
    case 'member': return [x.arg, x.doc];
    case 'binary': return [x.left, x.right];
    case 'like': return [x.arg, x.pattern, ...(x.escape !== undefined ? [x.escape] : [])];
    case 'between': return [x.arg, x.low, x.high];
    case 'call': return x.args;
    case 'row': return x.items;
    case 'case': return [...(x.operand !== undefined ? [x.operand] : []), ...(x.otherwise !== undefined ? [x.otherwise] : []), ...x.whens.flatMap((w) => [w.when, w.then])];
    default: return [];
  }
}

/** SELECT DISTINCT with ORDER BY (manual 15.2.13, errno 3065/3066): an ORDER BY expression must
 *  be in the select list or read only columns that are; an aggregate must be a select item. */
function checkDistinctOrder(ctx: ExecCtx, scope: Scope, projections: Projection[], order: Array<{ expr: Expr }>, aggSrc: number | undefined): void {
  const own = new Set(scope.sources.map((x) => x.idx));
  const selected = new Set(projections.map((p) => exprSig(p.expr)));
  order.forEach((term, i) => {
    if (selected.has(exprSig(term.expr))) return;
    const outsideSelectList = (x: Expr): void => {
      if (selected.has(exprSig(x))) return;
      if (x.kind === 'slot') {
        if (aggSrc !== undefined && x.src === aggSrc) throw new SqlError(`Expression #${i + 1} of ORDER BY clause is not in SELECT list, contains aggregate function; this is incompatible with DISTINCT`, 'INVALID_ARGUMENT', 3066, 'HY000');
        if (own.has(x.src)) throw new SqlError(`Expression #${i + 1} of ORDER BY clause is not in SELECT list, references column '${qualifiedColumn(ctx, x)}' which is not in SELECT list; this is incompatible with DISTINCT`, 'INVALID_ARGUMENT', 3065, 'HY000');
        return;
      }
      childExprs(x).forEach(outsideSelectList);
    };
    outsideSelectList(term.expr);
  });
}

function planSelect(ctx: ExecCtx, stmt: SelectStatement, parent?: Scope): SelectPlan {
  const database = ctx.db.name;
  const scope: Scope = { sources: [], ...(parent !== undefined ? { parent } : {}), correlated: false };
  const from = stmt.from ?? [];
  const dual = from.length === 1 && from[0]!.joins.length === 0 && !('derived' in from[0]!.factor) && from[0]!.factor.schema === undefined && lower(from[0]!.factor.table) === 'dual';
  type JoinPlan = { kind: JoinClause['kind']; source: Source; on?: Expr; keys: ReturnType<typeof equiKeys>; index?: Map<string, Array<Record<string, Cell>>> };
  const items: Array<{ first: Source; joins: JoinPlan[] }> = [];
  if (!dual) {
    for (const item of from) {
      const first = openFactor(ctx, item.factor);
      addSource(scope, first);
      const joins: JoinPlan[] = [];
      for (const j of item.joins) {
        const source = openFactor(ctx, j.factor);
        addSource(scope, source);
        // An ON condition sees the tables of its own join chain (and enclosing queries), not the
        // other comma-separated FROM items.
        const onScope: Scope = { sources: [first, ...joins.map((x) => x.source), source], ...(parent !== undefined ? { parent } : {}), correlated: false };
        const on = j.on === undefined ? undefined : bindExpr(ctx, j.on, onScope, { where: 'on clause' });
        if (onScope.correlated) scope.correlated = true;
        joins.push({ kind: j.kind, source, ...(on !== undefined ? { on } : {}), keys: equiKeys(on, source.idx) });
      }
      items.push({ first, joins });
    }
  }

  // The select list, `*` / `t.*` expanded against this query's own tables.
  const grouped = stmt.groupBy !== undefined || stmt.items.some((i) => containsAggregate(i.expr)) || containsAggregate(stmt.having) || stmt.order.some((t) => containsAggregate(t.expr));
  const aggs: AggState | undefined = grouped ? { src: ctx.next++, list: [] } : undefined;
  const projections: Projection[] = [];
  // The columns of this query's tables that nested subqueries read, collected per clause.
  const refsSince = (from: number): SlotExpr[] => (scope.outerRefs ?? []).slice(from);
  const refCount = (): number => scope.outerRefs?.length ?? 0;
  for (const item of stmt.items) {
    if (item.expr.kind === 'star') {
      if (scope.sources.length === 0) throw new SqlError('No tables used', 'INVALID_ARGUMENT', 1096, 'HY000');
      const qualifier = item.expr.table;
      const chosen = qualifier === undefined ? scope.sources : scope.sources.filter((s) => lower(s.name) === lower(qualifier));
      if (chosen.length === 0) throw new SqlError(`Unknown table '${qualifier}'`, 'NOT_FOUND', 1051, '42S02');
      for (const s of chosen) for (const c of s.table.columns) projections.push({ item, expr: slotFor(s, c), field: sourceField(s, c), refs: [] });
      continue;
    }
    const before = refCount();
    const expr = bindExpr(ctx, item.expr, scope, { where: 'field list', ...(aggs !== undefined ? { aggs } : {}) });
    const source = expr.kind === 'slot' ? ctx.sources.get(expr.src) : undefined;
    const field = expr.kind === 'slot' && item.expr.kind === 'column' && source !== undefined
      ? sourceField(source, expr.def, item.alias)
      : expr.kind === 'slot' && aggs !== undefined && expr.src === aggs.src ? aggregateField(item, expr.def) : undefined;
    projections.push({ item, expr, refs: refsSince(before), ...(field !== undefined ? { field } : {}) });
  }
  const aliases = new Map<string, Expr>();
  for (const p of projections) if (p.item.alias !== undefined && !aliases.has(lower(p.item.alias))) aliases.set(lower(p.item.alias), p.expr);
  const positional = (e: Expr, clause: string): Expr | undefined => {
    if (e.kind !== 'literal' || e.hint !== 'INT64' || e.value === null) return undefined;
    const n = Number(e.value);
    if (n < 1 || n > projections.length) throw badField(e.value, clause);
    return projections[n - 1]!.expr;
  };

  const where = stmt.where === undefined ? undefined : bindExpr(ctx, stmt.where, scope, { where: 'where clause' });
  const groupBy = (stmt.groupBy ?? []).map((g) => positional(g, 'group statement') ?? bindExpr(ctx, g, scope, { where: 'group statement', aliases, aliasFallback: true }));
  const havingRefs = refCount();
  const having = stmt.having === undefined ? undefined : bindExpr(ctx, stmt.having, scope, { where: 'having clause', aliases, ...(aggs !== undefined ? { aggs } : {}) });
  const havingRefList = refsSince(havingRefs);
  const order = stmt.order.map((t) => {
    const before = refCount();
    const expr = positional(t.expr, 'order clause') ?? bindExpr(ctx, t.expr, scope, { where: 'order clause', aliases, ...(aggs !== undefined ? { aggs } : {}) });
    return { desc: t.desc, expr, refs: refsSince(before) };
  });

  if (aggs !== undefined) {
    const joins = items.flatMap((it) => it.joins);
    const checks = projections.map((p, i) => ({ clause: 'SELECT list', index: i + 1, expr: p.expr, refs: p.refs }));
    if (stmt.groupBy !== undefined) {
      if (having !== undefined) checks.push({ clause: 'HAVING clause', index: 1, expr: having, refs: havingRefList });
      order.forEach((o, i) => checks.push({ clause: 'ORDER BY clause', index: i + 1, expr: o.expr, refs: o.refs }));
    }
    checkFullGroupBy(ctx, scope, stmt.groupBy !== undefined, groupBy, where, joins, aggs.src, checks);
  }
  if (stmt.distinct === true && order.length > 0) checkDistinctOrder(ctx, scope, projections, order, aggs?.src);

  // Predicate pushdown: a WHERE conjunct that reads only a FROM item's first table, or an
  // INNER-joined table, filters that table's rows before the join. Neither is ever null-extended,
  // so the result is the same; the join simply has fewer rows to pair.
  const filters = new Map<number, Expr[]>();
  const residual: Expr[] = [];
  const pushable = new Set<number>();
  for (const it of items) { pushable.add(it.first.idx); for (const j of it.joins) if (j.kind === 'inner') pushable.add(j.source.idx); }
  for (const c of conjuncts(where)) {
    const reads = sourcesRead(c);
    const own = reads === undefined ? undefined : [...reads].filter((s) => ctx.sources.has(s) && scope.sources.some((x) => x.idx === s));
    if (reads !== undefined && own !== undefined && own.length === 1 && pushable.has(own[0]!)) {
      filters.set(own[0]!, [...(filters.get(own[0]!) ?? []), c]);
    } else residual.push(c);
  }

  const execute = (outer: Tuple | undefined): ReturnType<SelectPlan['execute']> => {
    const at = (t: Tuple): EvalRow => ({ cells: EMPTY_CELLS, tuple: t, database, statement: ctx.statement });
    const passes = (t: Tuple, preds: Expr[] | undefined): boolean => (preds ?? []).every((p) => truthy(evalExpr(p, at(t))) === true);
    const base: Tuple = outer === undefined ? [] : outer.slice();
    let tuples: Tuple[] = [base];
    for (const it of items) {
      let cur: Tuple[] = [];
      const firstFilter = filters.get(it.first.idx);
      for (const t of tuples) {
        for (const r of it.first.rows) {
          t[it.first.idx] = r;
          if (passes(t, firstFilter)) cur.push(t.slice());
        }
        t[it.first.idx] = undefined;
      }
      for (const j of it.joins) {
        const next: Tuple[] = [];
        const own = filters.get(j.source.idx);
        let candidates: (t: Tuple) => Array<Record<string, Cell>> = () => j.source.rows;
        if (j.keys.length > 0) {
          // Each equi-key pair meets under the pair's own comparison: numerically, or under the
          // collation of the two operands (a case-insensitive column joins case-insensitively).
          const keyers = j.keys.map((k) => {
            // Operands in their written order, so an illegal mix names them as MySQL does.
            const inner = operandOf(k.inner, at(base)); const outer = operandOf(k.outer, at(base));
            if (k.innerLeft) return pairKeyers([inner, outer], '=');
            const [o, i] = pairKeyers([outer, inner], '=');
            return [i, o] as const;
          });
          const index = new Map<string, Array<Record<string, Cell>>>();
          for (const r of j.source.rows) {
            const parts = j.keys.map((k, i) => keyers[i]![0](r[k.inner.col] ?? null));
            if (parts.some((p) => p === null)) continue;
            const key = JSON.stringify(parts);
            const bucket = index.get(key);
            if (bucket === undefined) index.set(key, [r]); else bucket.push(r);
          }
          candidates = (t) => {
            const parts = j.keys.map((k, i) => keyers[i]![1](evalExpr(k.outer, at(t))));
            if (parts.some((p) => p === null)) return [];
            return index.get(JSON.stringify(parts)) ?? [];
          };
        }
        for (const t of cur) {
          let matched = false;
          for (const r of candidates(t)) {
            t[j.source.idx] = r;
            if ((j.on === undefined || truthy(evalExpr(j.on, at(t))) === true) && passes(t, own)) { next.push(t.slice()); matched = true; }
          }
          t[j.source.idx] = undefined;
          if (!matched && j.kind === 'left') next.push(t.slice());
        }
        cur = next;
      }
      tuples = cur;
    }
    let rows = residual.length === 0 ? tuples : tuples.filter((t) => passes(t, residual));

    if (aggs !== undefined) {
      const groups = new Map<string, Tuple[]>();
      if (groupBy.length === 0) groups.set('', rows);
      else {
        // Rows group together when every GROUP BY value compares equal under its own collation.
        const keys = groupBy.map((g) => keyer(operandOf(g, at(base))));
        for (const t of rows) {
          const key = JSON.stringify(groupBy.map((g, i) => keys[i]!(evalExpr(g, at(t)))));
          const bucket = groups.get(key);
          if (bucket === undefined) groups.set(key, [t]); else bucket.push(t);
        }
      }
      rows = [...groups.values()].map((members) => {
        // A group row is its first member (so functionally dependent columns read as MySQL reads
        // them) plus the computed aggregates; an empty ungrouped set reads its columns as NULL.
        const t = (members[0] ?? base).slice();
        t[aggs.src] = Object.fromEntries(aggs.list.map((a) => [a.col, computeAggregate(a, members, database, ctx.statement)]));
        return t;
      });
    }
    if (having !== undefined) rows = rows.filter((t) => truthy(evalExpr(having, at(t))) === true);

    if (order.length > 0) {
      // Each term sorts by its own type: numbers numerically, temporals in time, strings under
      // their collation, JSON by JSON's order — whatever the expression that produced them.
      const probe = at(base);
      const keys = order.map((o) => orderKey(operandOf(o.expr, probe)));
      const keyed = rows.map((t) => ({ t, k: order.map((o, i) => { const v = evalExpr(o.expr, at(t)); return v === null ? null : keys[i]!.key(v); }) }));
      keyed.sort((x, y) => {
        for (let i = 0; i < order.length; i++) {
          const av = x.k[i]; const bv = y.k[i]; const desc = order[i]!.desc;
          // MySQL sorts NULLs FIRST ascending, LAST descending.
          if (av === null && bv === null) continue;
          if (av === null) return desc ? 1 : -1;
          if (bv === null) return desc ? -1 : 1;
          const cmp = keys[i]!.cmp(av, bv);
          if (cmp !== 0) return desc ? -cmp : cmp;
        }
        return 0;
      });
      rows = keyed.map((x) => x.t);
    }

    let out = rows.map((t) => ({ t, values: projections.map((p) => evalExpr(p.expr, at(t))) }));
    if (stmt.distinct) {
      // DISTINCT keeps the first row of each set of rows whose columns compare equal under their collations.
      const keys = projections.map((p) => keyer(operandOf(p.expr, at(base))));
      const seen = new Set<string>();
      out = out.filter((r) => { const key = JSON.stringify(r.values.map((v, i) => keys[i]!(v))); if (seen.has(key)) return false; seen.add(key); return true; });
    }
    const offset = stmt.offset ?? 0;
    out = stmt.limit === undefined ? out.slice(offset) : out.slice(offset, offset + stmt.limit);
    if (out.length > PLANETSCALE_LIMITS.maxRowsPerQuery) throw rowLimitExceeded(out.length);

    const fields = planFields();
    const locked: Array<{ table: string; rowid: number }> = [];
    if (stmt.lock !== undefined) {
      for (const r of out) for (const s of scope.sources) {
        const cells = r.t[s.idx];
        const rowid = cells === undefined ? undefined : s.rowids?.get(cells);
        if (rowid !== undefined) locked.push({ table: s.table.name, rowid });
      }
    }
    return { fields, rows: out.map((r) => r.values), locked };
  };
  let typedFields: Field[] | undefined;
  const planFields = (): Field[] => (typedFields ??= projections.map((p) => p.field ?? expressionField({ ...p.item, expr: p.expr }, { cells: EMPTY_CELLS, tuple: [], database, statement: ctx.statement })));
  return { get correlated() { return scope.correlated; }, fields: planFields, execute };
}

/** The field a stored/derived/view column reports, under its query alias. */
function sourceField(source: Source, column: ColumnDef, alias?: string): Field {
  const field = fieldForColumn(source.database, source.table, column, alias);
  return { ...field, table: source.name };
}

/** The field an aggregate reports: named by its SQL text, typed per `aggregateColumn`. */
function aggregateField(item: SelectItem, def: ColumnDef): Field {
  const type = vitessTypeFor(def);
  if (def.dataType === 'BIGINT') {
    return { name: item.alias ?? item.text, type: 'INT64', charset: BINARY_CHARSET, columnLength: 21, flags: FLAG_NOT_NULL | FLAG_BINARY, columnType: 'bigint' };
  }
  const binary = isBinaryCharsetType(type);
  return {
    name: item.alias ?? item.text, type, charset: binary ? BINARY_CHARSET : UTF8MB4_CHARSET,
    columnLength: def.dataType === 'DECIMAL' ? 67 : def.length ?? defaultColumnLength(type),
    flags: typeFlags(type) | (def.unsigned ? FLAG_UNSIGNED : 0), columnType: def.columnType,
    ...(def.collation !== undefined ? { collation: def.collation } : {}),
  };
}

function execSelect(db: Database, stmt: SelectStatement, st: StatementScope): QueryOutcome {
  const { fields, rows, locked } = planSelect(newCtx(db, st), stmt).execute(undefined);
  return { fields, rows, rowsAffected: 0, insertId: 0, writes: [], ...(stmt.lock !== undefined ? { locked } : {}) };
}

/** UPDATE/DELETE bind WHERE, ORDER BY and SET against their one table, like a single-table SELECT. */
function planTarget(db: Database, name: string, st: StatementScope, alias?: string): { ctx: ExecCtx; scope: Scope; source: Source; recs: RowRec[] } {
  const ctx = newCtx(db, st);
  const table = findTable(db, name);
  const source = openFactor(ctx, { table: table.name, ...(alias !== undefined ? { alias } : {}) });
  // From here on, a subquery of this statement that reads the target table directly is errno 1093.
  ctx.target = tableKey(table.name);
  return { ctx, scope: { sources: [source], correlated: false }, source, recs: clusteredRows(ctx, table) };
}

/**
 * The field MySQL emits for a computed select item: named by the expression's own SQL text unless
 * aliased, carrying no table/orgTable (it belongs to no table), and typed by the expression's
 * static MySQL type (`staticType`) — never by the values it happened to produce, so an all-numeric
 * VARCHAR stays VARCHAR, an empty result is typed the same as a full one, and a binary expression
 * reports charset 63 (the client's `cast` returns a `Uint8Array` for it).
 */
function expressionField(item: SelectItem, row: EvalRow): Field {
  const name = item.alias ?? item.text;
  const inferred = staticBinary(item.expr, row.table) ? typed('VARBINARY', 'varbinary') : staticType(item.expr, row);
  if (inferred === null) return { name, type: 'NULL', charset: BINARY_CHARSET, columnLength: 0, flags: FLAG_BINARY };
  const def = inferred ?? typed('VARCHAR', 'varchar');
  const t = vitessTypeFor(def);
  const [precision, scale] = precisionScale(def);
  const op = operandOf(item.expr, row);
  return {
    name,
    type: t,
    charset: isBinaryCharsetType(t) ? BINARY_CHARSET : UTF8MB4_CHARSET,
    columnLength: t === 'DECIMAL' ? precision + (scale > 0 ? 1 : 0) + 1 : def.length ?? defaultColumnLength(t),
    flags: typeFlags(t) | (def.unsigned ? FLAG_UNSIGNED : 0) | (neverNull(item.expr, row) ? FLAG_NOT_NULL : 0),
    columnType: def.columnType,
    ...(op.cls === 'string' ? { collation: op.dt.collation.name } : {}),
  };
}

/** Whether an expression can never be NULL, as MySQL's result metadata marks it NOT NULL (the manual's DESCRIBE of
 *  `CREATE TABLE t SELECT 2.5 AS a, 25E-1 AS b` shows both NO; of `… SELECT AVG(i) …` YES): a non-NULL literal, a NOT
 *  NULL column, arithmetic other than division over such operands (a division by zero is NULL), and IFNULL/COALESCE
 *  whose last argument is such. Anything else may be NULL. */
function neverNull(e: Expr, row: EvalRow): boolean {
  switch (e.kind) {
    case 'literal': return e.value !== null;
    case 'column': { const c = row.table?.columns.find((x) => x.name.toLowerCase() === e.name.toLowerCase()); return c !== undefined && !c.nullable; }
    case 'unary': return e.op === '-' && neverNull(e.arg, row);
    case 'binary': return ['+', '-', '*'].includes(e.op) && neverNull(e.left, row) && neverNull(e.right, row);
    case 'call': return (e.name === 'IFNULL' || e.name === 'COALESCE') && e.args.length > 0 && neverNull(e.args[e.args.length - 1]!, row);
    default: return false;
  }
}

function execInsert(db: Database, stmt: Extract<Statement, { kind: 'insert' }>, write: () => void, st: StatementScope): QueryOutcome {
  const now = st.now;
  write();
  const table = findTable(db, stmt.table);
  const columns = stmt.columns.length > 0 ? stmt.columns : table.columns.map((c) => c.name);
  const named = new Set<string>();
  for (const name of columns) {
    if (!table.columns.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw badField(name, 'field list');
    if (named.has(name.toLowerCase())) throw new SqlError(`Column '${name}' specified twice`, 'INVALID_ARGUMENT', 1110, '42000');
    named.add(name.toLowerCase());
  }
  // `VALUES (…) AS new (m, n)`: each column alias names the inserted column in its position.
  let valuesNames: Map<string, string> | undefined;
  if (stmt.aliasColumns !== undefined) {
    if (stmt.aliasColumns.length !== columns.length) throw new SqlError('In definition of view, derived table or common table expression, SELECT list and column names list have different column counts', 'INVALID_ARGUMENT', 1353, 'HY000');
    valuesNames = new Map(stmt.aliasColumns.map((a, i) => [a.toLowerCase(), canonical(table, columns[i]!)]));
  }
  // INSERT IGNORE turns MySQL's strict-mode errors into adjustments (a NULL into NOT NULL stores the
  // type's implicit default, an out-of-range number the nearest bound) and skips duplicate rows.
  const strict = !stmt.ignore && st.mode.strict;
  const live = [...tableRows(db, table.name)];
  const writes: Write[] = [];
  let rowid = nextRowId(live);
  let autoIncrement = table.autoIncrement;
  let rowsAffected = 0;
  let firstInsertId = 0;

  for (let r = 0; r < stmt.rows.length; r++) {
    const values = stmt.rows[r]!;
    if (values.length !== columns.length) throw wrongValueCount(r + 1);
    const context: StoreContext = { strict, row: r + 1, table: table.name, ...(now !== undefined ? { now } : {}) };
    const valueRow: EvalRow = { cells: {}, database: db.name, write: true, statement: st, ...(now !== undefined ? { now } : {}) };
    const provided = new Map<string, { value: Cell; src: Operand }>();
    for (let i = 0; i < columns.length; i++) {
      provided.set(columns[i]!.toLowerCase(), { value: evalExpr(values[i]!, valueRow), src: operandOf(values[i]!, valueRow) });
    }

    let mintedId: number | null = null;
    const cells: Record<string, Cell> = {};
    for (const col of table.columns) {
      const given = provided.get(col.name.toLowerCase());
      let value: Cell;
      if (given !== undefined && !(col.autoIncrement && (given.value === null || /^\s*[+-]?0*(\.0*)?\s*$/.test(given.value)))) {
        value = given.value;
        if (value === null && !col.nullable) {
          if (strict) throw badNull(col.name);
          value = implicitDefault(col);
        } else value = storeValue(col, value, given.src, context);
        if (col.autoIncrement && value !== null) {
          const n = Number(value);
          // MySQL: an explicit id at or above the watermark PUSHES the watermark past it, so the
          // next auto id can never collide with it. This is also the rule that stops a locally
          // minted id from landing on a connector-pulled one.
          if (Number.isFinite(n) && n >= autoIncrement) autoIncrement = Math.floor(n) + 1;
        }
      } else if (col.autoIncrement) {
        // An omitted, NULL or 0 AUTO_INCREMENT value takes the next id (no NO_AUTO_VALUE_ON_ZERO).
        mintedId = autoIncrement;
        autoIncrement += 1;
        value = String(mintedId);
      } else if (col.defaultCurrentTimestamp !== undefined) {
        value = currentTimestamp(now, col.defaultCurrentTimestamp);
      } else if (col.defaultValue !== undefined) {
        // Already converted to the column's type (and to bytes for a binary column) at CREATE TABLE.
        value = col.defaultValue;
        if (value === null && !col.nullable) value = implicitDefault(col);
      } else if (col.nullable) {
        value = null;
      } else {
        if (strict) throw noDefault(col.name);
        value = implicitDefault(col);
      }
      cells[col.name] = value;
    }

    const conflict = findConflict(table, live, cells, null);
    if (conflict !== null) {
      if (stmt.onDuplicate !== undefined) {
        const existing = conflict.row;
        const updated: Record<string, Cell> = { ...existing.cells };
        for (const assign of stmt.onDuplicate) {
          const col = table.columns.find((c) => c.name.toLowerCase() === assign.column.toLowerCase());
          if (col === undefined) throw badField(assign.column, 'field list');
          // Evaluated against the existing row, with the proposed one readable through VALUES(col)
          // and the row alias; assignments apply left to right, as an UPDATE's do.
          const at: EvalRow = {
            cells: updated, table, database: db.name, write: true, values: cells, statement: st, ...(now !== undefined ? { now } : {}),
            ...(stmt.alias !== undefined ? { valuesAlias: stmt.alias } : {}), ...(valuesNames !== undefined ? { valuesNames } : {}),
          };
          let next = evalExpr(assign.value, at);
          if (next === null && !col.nullable) {
            if (strict) throw badNull(col.name);
            next = implicitDefault(col);
          } else next = storeValue(col, next, operandOf(assign.value, at), context);
          updated[col.name] = next;
        }
        const assignedConflict = findConflict(table, live, updated, existing.rowid);
        if (assignedConflict !== null) throw dupEntry(assignedConflict.value, `${table.name}.${assignedConflict.key}`);
        const changed = table.columns.some((c) => (updated[c.name] ?? null) !== (existing.cells[c.name] ?? null));
        // MySQL's documented rowsAffected for ON DUPLICATE KEY UPDATE: 1 for an insert, 2 for an
        // update that changed the row, 0 for an update that changed nothing.
        rowsAffected += changed ? 2 : 0;
        if (changed) {
          const next = { rowid: existing.rowid, cells: updated };
          replaceRow(live, next);
          writes.push({ kind: 'row', table: table.name, row: next });
        }
        continue;
      }
      if (stmt.ignore) continue;
      throw dupEntry(conflict.value, `${table.name}.${conflict.key}`);
    }

    const row: RowRec = { rowid, cells };
    rowid += 1;
    live.push(row);
    writes.push({ kind: 'row', table: table.name, row });
    rowsAffected += 1;
    if (mintedId !== null && firstInsertId === 0) firstInsertId = mintedId;
  }

  if (autoIncrement !== table.autoIncrement) writes.push({ kind: 'table', table: { ...table, autoIncrement } });
  return { fields: [], rows: [], rowsAffected, insertId: firstInsertId, writes };
}

function replaceRow(rows: RowRec[], next: RowRec): void {
  const i = rows.findIndex((r) => r.rowid === next.rowid);
  if (i >= 0) rows[i] = next; else rows.push(next);
}

/** The first PRIMARY/UNIQUE constraint `cells` violates, or null. `exceptRowId` lets an UPDATE
 *  ignore the row it is itself rewriting. */
function findConflict(
  table: TableDef,
  rows: RowRec[],
  cells: Record<string, Cell>,
  exceptRowId: number | null,
): { key: string; value: string; row: RowRec } | null {
  const constraints: Array<{ name: string; columns: string[] }> = [];
  if (table.primaryKey.length > 0) constraints.push({ name: 'PRIMARY', columns: table.primaryKey });
  for (const u of table.uniques) constraints.push(u);
  for (const col of table.columns) {
    if (col.unique && !constraints.some((c) => c.columns.length === 1 && c.columns[0]!.toLowerCase() === col.name.toLowerCase())) {
      constraints.push({ name: col.name, columns: [col.name] });
    }
  }
  for (const c of constraints) {
    const key = c.columns.map((n) => cells[canonical(table, n)] ?? null);
    // MySQL: a NULL never collides in a UNIQUE index (but a PRIMARY KEY column cannot be NULL).
    if (key.some((v) => v === null)) continue;
    // Two values collide when the column's COLLATION calls them equal, not when their bytes match:
    // under a _ci collation 'A@x.com' and 'a@x.com' are one key (errno 1062).
    const defs = c.columns.map((n) => table.columns.find((col) => col.name.toLowerCase() === n.toLowerCase()));
    const want = key.map((v, i) => uniqueKeyPart(defs[i], v!));
    const hit = rows.find((r) => r.rowid !== exceptRowId && c.columns.every((n, i) => {
      const v = r.cells[canonical(table, n)] ?? null;
      return v !== null && uniqueKeyPart(defs[i], v) === want[i];
    }));
    if (hit !== undefined) return { key: c.name, value: key.join('-'), row: hit };
  }
  return null;
}

const canonical = (table: TableDef, name: string): string =>
  table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase())?.name ?? name;

/** Two target rows of an UPDATE/DELETE ORDER BY, compared key by key: NULL first ascending, last descending. */
function targetOrder(order: { desc: boolean; expr: Expr }[], probe: EvalRow) {
  return (x: { k: Cell[] }, y: { k: Cell[] }): number => {
    for (let i = 0; i < order.length; i++) {
      const av = x.k[i]!; const bv = y.k[i]!; const desc = order[i]!.desc;
      if (av === null && bv === null) continue;
      if (av === null) return desc ? 1 : -1;
      if (bv === null) return desc ? -1 : 1;
      const cmp = sorter(operandOf(order[i]!.expr, probe))(av, bv);
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  };
}

/**
 * The rows an UPDATE/DELETE targets: WHERE-matched, ordered by ORDER BY (rows InnoDB visits in
 * clustered-index order otherwise), then LIMIT-ed. Shared by both statements.
 *
 * §9 ROUND TWO, FINDING 12: `UPDATE`/`DELETE` used to PARSE their ORDER BY and throw it away, so
 * `DELETE FROM t ORDER BY created_at LIMIT 1` — the delete-the-oldest idiom — deleted whichever row
 * happened to come first. Silently ignoring a clause that decides WHICH row a LIMIT touches is the
 * fabricated-success class this pack forbids.
 */
function targetRows(
  plan: ReturnType<typeof planTarget>,
  stmt: { where?: Expr; order: OrderTerm[]; limit?: number },
): { targets: RowRec[]; at: (r: RowRec) => EvalRow } {
  const { ctx, scope, source, recs } = plan;
  const where = stmt.where === undefined ? undefined : bindExpr(ctx, stmt.where, scope, { where: 'where clause' });
  const order = stmt.order.map((t) => ({ desc: t.desc, expr: bindExpr(ctx, t.expr, scope, { where: 'order clause' }) }));
  const at = (r: RowRec): EvalRow => { const tuple: Tuple = []; tuple[source.idx] = r.cells; return { cells: r.cells, table: source.table, database: ctx.db.name, tuple, statement: ctx.statement }; };
  let targets = where === undefined ? recs : recs.filter((r) => truthy(evalExpr(where, at(r))) === true);
  if (order.length > 0) {
    const keyed = targets.map((r) => ({ r, k: order.map((o) => evalExpr(o.expr, at(r))) }));
    const probe = at({ rowid: 0, cells: {} });
    keyed.sort(targetOrder(order, probe));
    targets = keyed.map((x) => x.r);
  }
  if (stmt.limit !== undefined) targets = targets.slice(0, stmt.limit);
  if (targets.length > PLANETSCALE_LIMITS.maxRowsPerQuery) throw rowLimitExceeded(targets.length);
  return { targets, at };
}

function execUpdate(db: Database, stmt: Extract<Statement, { kind: 'update' }>, write: () => void, st: StatementScope): QueryOutcome {
  write();
  const plan = planTarget(db, stmt.table, st, stmt.alias);
  const { ctx, scope, source } = plan;
  const table = source.table;
  const set = stmt.set.map((assign) => {
    const col = table.columns.find((c) => c.name.toLowerCase() === assign.column.toLowerCase());
    // a qualified assignment names the table by the name the statement gives it (its alias, else its own)
    if (assign.table !== undefined && lower(assign.table) !== lower(source.name)) throw badField(`${assign.table}.${assign.column}`, 'field list');
    if (col === undefined) throw badField(assign.table !== undefined ? `${assign.table}.${assign.column}` : assign.column, 'field list');
    return { col, value: bindExpr(ctx, assign.value, scope, { where: 'field list' }) };
  });
  const { targets, at } = targetRows(plan, stmt);
  const live = [...tableRows(db, table.name)];
  const writes: Write[] = [];
  let rowsAffected = 0;
  let autoIncrement = table.autoIncrement;
  let visited = 0;
  for (const row of targets) {
    visited += 1;
    const cells: Record<string, Cell> = { ...row.cells };
    for (const { col, value } of set) {
      // MySQL evaluates single-table SET assignments left to right, each seeing the columns the
      // earlier ones already assigned (`SET a = a + 1, b = a` gives b the new a). The value is
      // converted to the column's type under strict mode, as an INSERT's is.
      const r = { ...at({ rowid: row.rowid, cells }), write: true };
      const next = evalExpr(value, r);
      if (next === null && !col.nullable) throw badNull(col.name);
      cells[col.name] = storeValue(col, next, operandOf(value, r), { strict: st.mode.strict, row: visited, table: table.name });
      if (col.autoIncrement && next !== null) {
        const n = Number(next);
        if (Number.isFinite(n) && n >= autoIncrement) autoIncrement = Math.floor(n) + 1;
      }
    }
    const changed = table.columns.some((c) => (cells[c.name] ?? null) !== (row.cells[c.name] ?? null));
    if (!changed) continue; // MySQL counts only rows whose values actually changed
    const conflict = findConflict(table, live, cells, row.rowid);
    if (conflict !== null) throw dupEntry(conflict.value, `${table.name}.${conflict.key}`);
    const next = { rowid: row.rowid, cells };
    replaceRow(live, next);
    writes.push({ kind: 'row', table: table.name, row: next });
    rowsAffected += 1;
  }
  if (autoIncrement !== table.autoIncrement) writes.push({ kind: 'table', table: { ...table, autoIncrement } });
  return { fields: [], rows: [], rowsAffected, insertId: 0, writes };
}

/**
 * The multiple-table UPDATE: "updates rows in each table named in table_references that satisfy the conditions. Each
 * matching row is updated once, even if it matches the conditions multiple times" (MySQL 8.0 manual, UPDATE). The join
 * is the SELECT the same references and WHERE make, projecting each target table's primary key and every assigned
 * value; each target row takes the values of its first match, stored as a single-table UPDATE stores them, and counts
 * only if it changed. Where the manual stops and the twin decides: a target table needs a primary key to be found again.
 */
function execUpdateMulti(db: Database, stmt: Extract<Statement, { kind: 'update-multi' }>, write: () => void, st: StatementScope): QueryOutcome {
  write();
  const factors = stmt.from.flatMap((f) => [f.factor, ...f.joins.map((j) => j.factor)]);
  const named = (f: TableFactor): string => ('derived' in f ? f.alias : f.alias ?? f.table);
  const targetOf = (assign: { table?: string; column: string }): TableFactor & { table: string } => {
    const hits = factors.filter((f): f is TableFactor & { table: string } => !('derived' in f) && (assign.table !== undefined
      ? lower(named(f)) === lower(assign.table)
      : findTable(db, f.table).columns.some((c) => lower(c.name) === lower(assign.column))));
    if (hits.length === 0) throw badField(assign.table !== undefined ? `${assign.table}.${assign.column}` : assign.column, 'field list');
    if (hits.length > 1) throw new SqlError(`Column '${assign.column}' in field list is ambiguous`, 'INVALID_ARGUMENT', 1052, '23000');
    return hits[0]!;
  };
  const assigns = stmt.set.map((a) => ({ ...a, factor: targetOf(a) }));
  const targets = [...new Set(assigns.map((a) => a.factor))];
  const items: SelectItem[] = [];
  const keyAt = new Map<TableFactor, number[]>();
  for (const f of targets) {
    const table = findTable(db, f.table);
    if (table.primaryKey.length === 0) throw unsupported(`multi-table UPDATE of ${table.name}, a table with no primary key`);
    // the key's columns as the table spells them (a PRIMARY KEY clause may spell them in another case)
    keyAt.set(f, table.primaryKey.map((k) => { items.push({ expr: { kind: 'column', table: named(f), name: canonical(table, k) }, text: k }); return items.length - 1; }));
  }
  const valueAt = assigns.map((a) => { items.push({ expr: a.value, text: 'value' }); return items.length - 1; });
  // a subquery of this statement that reads a target table directly is errno 1093, as in the single-table form
  const ctx = newCtx(db, st);
  ctx.targets = new Set(targets.map((f) => tableKey(f.table)));
  ctx.targetFactors = new Set(factors);
  const { fields, rows } = planSelect(ctx, { kind: 'select', items, from: stmt.from, ...(stmt.where !== undefined ? { where: stmt.where } : {}), order: [] }).execute(undefined);
  const writes: Write[] = [];
  let rowsAffected = 0;
  let matched = 0;
  // Each target TABLE once: a table named under two aliases takes the assignments of both, each from that alias's
  // first matching join row ("Each matching row is updated once, even if it matches the conditions multiple times").
  for (const tableName of [...new Set(targets.map((f) => findTable(db, f.table).name))]) {
    const table = findTable(db, tableName);
    const key = (cells: Record<string, Cell>) => JSON.stringify(table.primaryKey.map((k) => cells[canonical(table, k)] ?? null));
    const aliases = targets.filter((f) => findTable(db, f.table).name === tableName).map((f) => {
      const firstMatch = new Map<string, Cell[]>();
      for (const r of rows) {
        const k = JSON.stringify(keyAt.get(f)!.map((i) => r[i]));
        if (!firstMatch.has(k)) firstMatch.set(k, r);
      }
      return { firstMatch, mine: assigns.map((a, i) => ({ a, i })).filter(({ a }) => a.factor === f) };
    });
    const live = [...tableRows(db, table.name)];
    let visited = 0;
    for (const row of [...live]) {
      const hits = aliases.map((al) => ({ al, match: al.firstMatch.get(key(row.cells)) })).filter((h) => h.match !== undefined);
      if (hits.length === 0) continue;
      visited += 1;
      matched += 1;
      if (matched > PLANETSCALE_LIMITS.maxRowsPerQuery) throw rowLimitExceeded(matched);
      const cells: Record<string, Cell> = { ...row.cells };
      for (const { al, match } of hits) {
        for (const { a, i } of al.mine) {
          const col = table.columns.find((c) => lower(c.name) === lower(a.column));
          if (col === undefined) throw badField(a.table !== undefined ? `${a.table}.${a.column}` : a.column, 'field list');
          const next = match![valueAt[i]!] ?? null;
          if (next === null && !col.nullable) throw badNull(col.name);
          cells[col.name] = storeValue(col, next, fieldOperand(fields[valueAt[i]!]!), { strict: st.mode.strict, row: visited, table: table.name });
        }
      }
      if (!table.columns.some((c) => (cells[c.name] ?? null) !== (row.cells[c.name] ?? null))) continue;
      const conflict = findConflict(table, live, cells, row.rowid);
      if (conflict !== null) throw dupEntry(conflict.value, `${table.name}.${conflict.key}`);
      const next = { rowid: row.rowid, cells };
      replaceRow(live, next);
      writes.push({ kind: 'row', table: table.name, row: next });
      rowsAffected += 1;
    }
  }
  return { fields: [], rows: [], rowsAffected, insertId: 0, writes };
}

function execDelete(db: Database, stmt: Extract<Statement, { kind: 'delete' }>, write: () => void, st: StatementScope): QueryOutcome {
  write();
  const plan = planTarget(db, stmt.table, st);
  const { targets } = targetRows(plan, stmt);
  // DELETE does NOT reset AUTO_INCREMENT (only TRUNCATE does) — which is precisely what stops a
  // delete-then-insert from reissuing a retired id to a different row.
  const writes: Write[] = targets.map((r) => ({ kind: 'delete-row' as const, table: plan.source.table.name, rowid: r.rowid }));
  return { fields: [], rows: [], rowsAffected: targets.length, insertId: 0, writes };
}

