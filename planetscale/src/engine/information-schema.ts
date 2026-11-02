// INFORMATION_SCHEMA — MySQL 8's catalog views, DERIVED on every read from the engine's own
// catalog (`Database.tables`). Nothing here is stored: each call folds the current image into
// virtual rows, so the views cannot drift from the tables they describe.
//
// Reference: https://dev.mysql.com/doc/refman/8.0/en/information-schema-table-reference.html
// (column lists, types and value conventions per view). The views and columns Prisma's MySQL
// schema describer reads (sql-schema-describer/src/mysql.rs) are the ones whose values are
// modeled in full; every other column carries MySQL's value for a fresh InnoDB table or NULL.
//
// What the engine cannot hold is answered truthfully as EMPTY: it has no views, routines,
// triggers, CHECK constraints or foreign keys, so VIEWS / ROUTINES / TRIGGERS /
// CHECK_CONSTRAINTS / REFERENTIAL_CONSTRAINTS have no rows. That is the real answer for a
// schema without those objects, not a placeholder.
import type { Cell, ColumnDef, Database, IndexDef, TableDef } from './sql.ts';
import { DEFAULT_COLLATION_OF, modelledCollations } from './collation.ts';

export const INFORMATION_SCHEMA = 'information_schema';

/** MySQL 8's defaults for a table declared without a charset/collation. */
export const DEFAULT_CHARSET = 'utf8mb4';
export const DEFAULT_COLLATION = 'utf8mb4_0900_ai_ci';

/** Identifier columns: the names of schemas, tables, columns, indexes, constraints and routines. */
const IDENTIFIER = /(_SCHEMA|_NAME)$/;
const NOT_IDENTIFIER = new Set(['CHARACTER_SET_NAME', 'COLLATION_NAME', 'DEFAULT_CHARACTER_SET_NAME', 'DEFAULT_COLLATION_NAME', 'CATALOG_NAME', 'EXTERNAL_NAME']);

/** A catalog column, declared the way MySQL 8 declares it (`SHOW CREATE TABLE information_schema.X`).
 *  Its text columns are utf8mb3. An identifier column compares the way this engine resolves the
 *  identifier it holds: case-insensitively, as MySQL does with lower_case_table_names = 2 (names
 *  keep their declared lettercase and are looked up in lowercase; the catalog's name columns then
 *  compare under utf8mb3_tolower_ci, modelled here by utf8mb3_general_ci). So `FROM EV` and
 *  `WHERE TABLE_NAME = 'EV'` agree about a table declared `ev`. Other text compares byte for byte. */
function column(name: string, type: string, nullable = true): ColumnDef {
  const m = /^(\w+)(?:\((.*)\))?( unsigned)?$/.exec(type)!;
  const base = m[1]!.toUpperCase();
  const first = m[2] !== undefined && /^\d+/.test(m[2]) ? Number(/^\d+/.exec(m[2])![0]) : null;
  const text = ['CHAR', 'VARCHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'ENUM'].includes(base);
  const identifier = IDENTIFIER.test(name) && !NOT_IDENTIFIER.has(name);
  return {
    name, dataType: base, columnType: type, length: first, unsigned: m[3] !== undefined, nullable,
    autoIncrement: false, primaryKey: false, unique: false,
    ...(text ? { charset: 'utf8mb3', collation: identifier ? 'utf8mb3_general_ci' : 'utf8mb3_bin' } : {}),
  };
}
const view = (name: string, columns: ColumnDef[]): TableDef => ({ name, columns, primaryKey: [], uniques: [], autoIncrement: 0 });

const TABLES = view('TABLES', [
  column('TABLE_CATALOG', 'varchar(64)', false), column('TABLE_SCHEMA', 'varchar(64)', false), column('TABLE_NAME', 'varchar(64)', false),
  column("TABLE_TYPE", "enum('BASE TABLE','VIEW','SYSTEM VIEW')", false), column('ENGINE', 'varchar(64)'), column('VERSION', 'int'),
  column("ROW_FORMAT", "enum('Fixed','Dynamic','Compressed','Redundant','Compact','Paged')"), column('TABLE_ROWS', 'bigint unsigned'),
  column('AVG_ROW_LENGTH', 'bigint unsigned'), column('DATA_LENGTH', 'bigint unsigned'), column('MAX_DATA_LENGTH', 'bigint unsigned'),
  column('INDEX_LENGTH', 'bigint unsigned'), column('DATA_FREE', 'bigint unsigned'), column('AUTO_INCREMENT', 'bigint unsigned'),
  column('CREATE_TIME', 'timestamp'), column('UPDATE_TIME', 'datetime'), column('CHECK_TIME', 'datetime'),
  column('TABLE_COLLATION', 'varchar(64)'), column('CHECKSUM', 'bigint'), column('CREATE_OPTIONS', 'varchar(256)'), column('TABLE_COMMENT', 'text'),
]);
const COLUMNS = view('COLUMNS', [
  column('TABLE_CATALOG', 'varchar(64)', false), column('TABLE_SCHEMA', 'varchar(64)', false), column('TABLE_NAME', 'varchar(64)', false),
  column('COLUMN_NAME', 'varchar(64)'), column('ORDINAL_POSITION', 'int unsigned', false), column('COLUMN_DEFAULT', 'text'),
  column('IS_NULLABLE', 'varchar(3)', false), column('DATA_TYPE', 'longtext'), column('CHARACTER_MAXIMUM_LENGTH', 'bigint'),
  column('CHARACTER_OCTET_LENGTH', 'bigint'), column('NUMERIC_PRECISION', 'bigint unsigned'), column('NUMERIC_SCALE', 'bigint unsigned'),
  column('DATETIME_PRECISION', 'int unsigned'), column('CHARACTER_SET_NAME', 'varchar(64)'), column('COLLATION_NAME', 'varchar(64)'),
  column('COLUMN_TYPE', 'mediumtext', false), column("COLUMN_KEY", "enum('','PRI','UNI','MUL')", false), column('EXTRA', 'varchar(256)'),
  column('PRIVILEGES', 'varchar(154)'), column('COLUMN_COMMENT', 'text', false), column('GENERATION_EXPRESSION', 'longtext', false),
  column('SRS_ID', 'int unsigned'),
]);
const STATISTICS = view('STATISTICS', [
  column('TABLE_CATALOG', 'varchar(64)', false), column('TABLE_SCHEMA', 'varchar(64)', false), column('TABLE_NAME', 'varchar(64)', false),
  column('NON_UNIQUE', 'int', false), column('INDEX_SCHEMA', 'varchar(64)', false), column('INDEX_NAME', 'varchar(64)'),
  column('SEQ_IN_INDEX', 'int unsigned', false), column('COLUMN_NAME', 'varchar(64)'), column('COLLATION', 'varchar(1)'),
  column('CARDINALITY', 'bigint'), column('SUB_PART', 'bigint'), column('PACKED', 'binary(0)'), column('NULLABLE', 'varchar(3)', false),
  column('INDEX_TYPE', 'varchar(11)', false), column('COMMENT', 'varchar(8)', false), column('INDEX_COMMENT', 'varchar(2048)', false),
  column('IS_VISIBLE', 'varchar(3)', false), column('EXPRESSION', 'longtext'),
]);
const TABLE_CONSTRAINTS = view('TABLE_CONSTRAINTS', [
  column('CONSTRAINT_CATALOG', 'varchar(64)'), column('CONSTRAINT_SCHEMA', 'varchar(64)'), column('CONSTRAINT_NAME', 'varchar(64)'),
  column('TABLE_SCHEMA', 'varchar(64)'), column('TABLE_NAME', 'varchar(64)'), column('CONSTRAINT_TYPE', 'varchar(11)', false),
  column('ENFORCED', 'varchar(3)', false),
]);
const KEY_COLUMN_USAGE = view('KEY_COLUMN_USAGE', [
  column('CONSTRAINT_CATALOG', 'varchar(64)'), column('CONSTRAINT_SCHEMA', 'varchar(64)'), column('CONSTRAINT_NAME', 'varchar(64)'),
  column('TABLE_CATALOG', 'varchar(64)'), column('TABLE_SCHEMA', 'varchar(64)'), column('TABLE_NAME', 'varchar(64)'),
  column('COLUMN_NAME', 'varchar(64)'), column('ORDINAL_POSITION', 'int unsigned', false), column('POSITION_IN_UNIQUE_CONSTRAINT', 'int unsigned'),
  column('REFERENCED_TABLE_SCHEMA', 'varchar(64)'), column('REFERENCED_TABLE_NAME', 'varchar(64)'), column('REFERENCED_COLUMN_NAME', 'varchar(64)'),
]);
const REFERENTIAL_CONSTRAINTS = view('REFERENTIAL_CONSTRAINTS', [
  column('CONSTRAINT_CATALOG', 'varchar(64)'), column('CONSTRAINT_SCHEMA', 'varchar(64)'), column('CONSTRAINT_NAME', 'varchar(64)'),
  column('UNIQUE_CONSTRAINT_CATALOG', 'varchar(64)'), column('UNIQUE_CONSTRAINT_SCHEMA', 'varchar(64)'), column('UNIQUE_CONSTRAINT_NAME', 'varchar(64)'),
  column("MATCH_OPTION", "enum('NONE','PARTIAL','FULL')", false), column("UPDATE_RULE", "enum('NO ACTION','RESTRICT','CASCADE','SET NULL','SET DEFAULT')", false),
  column("DELETE_RULE", "enum('NO ACTION','RESTRICT','CASCADE','SET NULL','SET DEFAULT')", false), column('TABLE_NAME', 'varchar(64)'),
  column('REFERENCED_TABLE_NAME', 'varchar(64)'),
]);
const CHECK_CONSTRAINTS = view('CHECK_CONSTRAINTS', [
  column('CONSTRAINT_CATALOG', 'varchar(64)'), column('CONSTRAINT_SCHEMA', 'varchar(64)'), column('CONSTRAINT_NAME', 'varchar(64)'),
  column('CHECK_CLAUSE', 'longtext', false),
]);
// INFORMATION_SCHEMA.COLLATIONS (manual 28.3.6): one row per collation the server supports. The twin's are the ones its
// engine models (collation.ts), a subset of MySQL's (the twin's decision: a collation it lists is one it can
// compare by); SORTLEN is MySQL's for each.
const COLLATIONS = view('COLLATIONS', [
  column('COLLATION_NAME', 'varchar(64)', false), column('CHARACTER_SET_NAME', 'varchar(64)', false), column('ID', 'bigint unsigned', false),
  column('IS_DEFAULT', 'varchar(3)', false), column('IS_COMPILED', 'varchar(3)', false), column('SORTLEN', 'int unsigned', false),
  column("PAD_ATTRIBUTE", "enum('PAD SPACE','NO PAD')", false),
]);
const SORTLEN: Record<string, number> = { binary: 1, utf8mb4_0900_ai_ci: 0, utf8mb4_0900_as_ci: 0, utf8mb4_0900_as_cs: 0, utf8mb4_0900_bin: 1, utf8mb4_bin: 1,
  utf8mb4_general_ci: 1, utf8mb4_unicode_ci: 8, utf8mb3_general_ci: 1, utf8mb3_bin: 1, utf8mb3_unicode_ci: 8 };
const VIEWS = view('VIEWS', [
  column('TABLE_CATALOG', 'varchar(64)'), column('TABLE_SCHEMA', 'varchar(64)'), column('TABLE_NAME', 'varchar(64)'),
  column('VIEW_DEFINITION', 'longtext'), column("CHECK_OPTION", "enum('NONE','LOCAL','CASCADED')"), column("IS_UPDATABLE", "enum('NO','YES')"),
  column('DEFINER', 'varchar(288)'), column("SECURITY_TYPE", "varchar(7)"), column('CHARACTER_SET_CLIENT', 'varchar(64)', false),
  column('COLLATION_CONNECTION', 'varchar(64)', false),
]);
const ROUTINES = view('ROUTINES', [
  column('SPECIFIC_NAME', 'varchar(64)', false), column('ROUTINE_CATALOG', 'varchar(64)'), column('ROUTINE_SCHEMA', 'varchar(64)'),
  column('ROUTINE_NAME', 'varchar(64)', false), column("ROUTINE_TYPE", "enum('FUNCTION','PROCEDURE')", false), column('DATA_TYPE', 'longtext'),
  column('ROUTINE_BODY', 'varchar(8)', false), column('ROUTINE_DEFINITION', 'longtext'), column('EXTERNAL_NAME', 'varbinary(0)'),
  column('IS_DETERMINISTIC', 'varchar(3)', false), column('SQL_DATA_ACCESS', 'varchar(17)', false), column('SECURITY_TYPE', 'varchar(7)', false),
  column('CREATED', 'timestamp', false), column('LAST_ALTERED', 'timestamp', false), column('SQL_MODE', 'varchar(520)', false),
  column('ROUTINE_COMMENT', 'text', false), column('DEFINER', 'varchar(288)', false),
]);
const TRIGGERS = view('TRIGGERS', [
  column('TRIGGER_CATALOG', 'varchar(64)'), column('TRIGGER_SCHEMA', 'varchar(64)'), column('TRIGGER_NAME', 'varchar(64)', false),
  column("EVENT_MANIPULATION", "enum('INSERT','UPDATE','DELETE')", false), column('EVENT_OBJECT_SCHEMA', 'varchar(64)'),
  column('EVENT_OBJECT_TABLE', 'varchar(64)'), column('ACTION_STATEMENT', 'longtext', false),
]);
const SCHEMATA = view('SCHEMATA', [
  column('CATALOG_NAME', 'varchar(64)'), column('SCHEMA_NAME', 'varchar(64)'), column('DEFAULT_CHARACTER_SET_NAME', 'varchar(64)', false),
  column('DEFAULT_COLLATION_NAME', 'varchar(64)', false), column('SQL_PATH', 'binary(0)'), column("DEFAULT_ENCRYPTION", "enum('NO','YES')", false),
]);

// ─────────────────────────────────────────────────────────────────────────────────────────────
// COLUMN METADATA — MySQL 8's rendering of a declared column
// ─────────────────────────────────────────────────────────────────────────────────────────────

const INTEGERS: Record<string, { type: string; precision: number }> = {
  TINYINT: { type: 'tinyint', precision: 3 }, SMALLINT: { type: 'smallint', precision: 5 }, MEDIUMINT: { type: 'mediumint', precision: 7 },
  INT: { type: 'int', precision: 10 }, INTEGER: { type: 'int', precision: 10 }, BIGINT: { type: 'bigint', precision: 19 },
};
const TEXT_LENGTH: Record<string, number> = { TINYTEXT: 255, TEXT: 65535, MEDIUMTEXT: 16777215, LONGTEXT: 4294967295, TINYBLOB: 255, BLOB: 65535, MEDIUMBLOB: 16777215, LONGBLOB: 4294967295 };
const CHARACTER_TYPES = new Set(['CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'ENUM', 'SET']);

/** The parenthesised arguments of a declared type (`decimal(5,2)` → ['5','2']; enum members verbatim). */
function typeArguments(col: ColumnDef): string | undefined {
  const open = col.columnType.indexOf('(');
  return open < 0 ? undefined : col.columnType.slice(open + 1, col.columnType.lastIndexOf(')'));
}
const numbers = (args: string | undefined): number[] => (args ?? '').split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s)).map(Number);
/** ENUM/SET members, unquoted (MySQL doubles an embedded quote in COLUMN_TYPE). */
function members(args: string | undefined): string[] {
  return [...(args ?? '').matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!.replace(/''/g, "'"));
}

export type ColumnMetadata = {
  dataType: string; columnType: string; characterMaximumLength: number | null; characterOctetLength: number | null;
  numericPrecision: number | null; numericScale: number | null; datetimePrecision: number | null;
  characterSet: string | null; collation: string | null;
};

/** MySQL 8.0.19+'s rendering: integer display widths are dropped (except `tinyint(1)`), BOOLEAN is
 *  `tinyint(1)`, a zero fractional-seconds precision is not printed, DECIMAL defaults to (10,0). */
export function columnMetadata(col: ColumnDef, table: TableDef): ColumnMetadata {
  const args = typeArguments(col); const nums = numbers(args);
  const unsigned = col.unsigned ? ' unsigned' : '';
  // A character column's own resolved collation (sql.ts resolves it at CREATE TABLE),
  // falling back to the table's declared default for a catalog written before columns carried one.
  const collation = col.collation ?? table.collation ?? DEFAULT_COLLATION;
  const charset = col.charset ?? (col.collation !== undefined ? col.collation.split('_')[0]! : table.charset ?? DEFAULT_CHARSET);
  const none = { characterMaximumLength: null, characterOctetLength: null, numericPrecision: null, numericScale: null, datetimePrecision: null, characterSet: null, collation: null };
  const base = col.dataType;
  if (base === 'BOOL' || base === 'BOOLEAN') return { ...none, dataType: 'tinyint', columnType: 'tinyint(1)', numericPrecision: 3, numericScale: 0 };
  const integer = INTEGERS[base];
  if (integer) {
    const width = base === 'TINYINT' && nums[0] === 1 ? '(1)' : '';
    return { ...none, dataType: integer.type, columnType: `${integer.type}${width}${unsigned}`, numericPrecision: base === 'BIGINT' && col.unsigned ? 20 : integer.precision, numericScale: 0 };
  }
  if (base === 'DECIMAL' || base === 'NUMERIC' || base === 'DEC' || base === 'FIXED') {
    const p = nums[0] ?? 10; const s = nums[1] ?? 0;
    return { ...none, dataType: 'decimal', columnType: `decimal(${p},${s})${unsigned}`, numericPrecision: p, numericScale: s };
  }
  if (base === 'FLOAT' || base === 'DOUBLE' || base === 'REAL') {
    const type = base === 'FLOAT' ? 'float' : 'double';
    const scaled = nums.length === 2;
    return { ...none, dataType: type, columnType: `${type}${scaled ? `(${nums[0]},${nums[1]})` : ''}${unsigned}`, numericPrecision: scaled ? nums[0]! : type === 'float' ? 12 : 22, numericScale: scaled ? nums[1]! : null };
  }
  if (base === 'DATETIME' || base === 'TIMESTAMP' || base === 'TIME') {
    const fsp = nums[0] ?? 0; const type = base.toLowerCase();
    return { ...none, dataType: type, columnType: fsp > 0 ? `${type}(${fsp})` : type, datetimePrecision: fsp };
  }
  if (base === 'DATE' || base === 'YEAR' || base === 'JSON') return { ...none, dataType: base.toLowerCase(), columnType: base.toLowerCase() };
  if (base === 'BIT') { const n = nums[0] ?? 1; return { ...none, dataType: 'bit', columnType: `bit(${n})`, numericPrecision: n }; }
  if (base === 'CHAR' || base === 'VARCHAR') {
    const n = nums[0] ?? 1; const type = base.toLowerCase();
    return { ...none, dataType: type, columnType: `${type}(${n})`, characterMaximumLength: n, characterOctetLength: n * 4, characterSet: charset, collation };
  }
  if (base === 'BINARY' || base === 'VARBINARY') {
    const n = nums[0] ?? 1; const type = base.toLowerCase();
    return { ...none, dataType: type, columnType: `${type}(${n})`, characterMaximumLength: n, characterOctetLength: n };
  }
  if (TEXT_LENGTH[base] !== undefined) {
    const type = base.toLowerCase(); const n = TEXT_LENGTH[base]!;
    const text = CHARACTER_TYPES.has(base);
    return { ...none, dataType: type, columnType: type, characterMaximumLength: n, characterOctetLength: n,
      ...(text ? { characterSet: charset, collation } : {}) };
  }
  if (base !== 'ENUM' && base !== 'SET') return { ...none, dataType: base.toLowerCase(), columnType: col.columnType };
  const values = members(args); const type = base.toLowerCase();
  const longest = base === 'ENUM' ? Math.max(0, ...values.map((v) => [...v].length)) : values.reduce((n, v) => n + [...v].length, 0) + Math.max(0, values.length - 1);
  return { ...none, dataType: type, columnType: `${type}(${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',')})`, characterMaximumLength: longest, characterOctetLength: longest * 4, characterSet: charset, collation };
}

/** Every index of a table in MySQL's order: PRIMARY, then UNIQUE, then the others, each in declaration order. */
export function tableIndexes(table: TableDef): Array<IndexDef & { unique: boolean }> {
  const part = (name: string) => ({ name });
  const out: Array<IndexDef & { unique: boolean }> = [];
  if (table.primaryKey.length) out.push({ name: 'PRIMARY', columns: table.primaryKey.map(part), type: 'BTREE', unique: true });
  for (const u of table.uniques) out.push({ name: u.name, columns: u.parts ?? u.columns.map(part), type: 'BTREE', unique: true });
  for (const col of table.columns) {
    if (col.unique && !out.some((i) => i.unique && i.columns.length === 1 && i.columns[0]!.name.toLowerCase() === col.name.toLowerCase())) {
      out.push({ name: col.name, columns: [part(col.name)], type: 'BTREE', unique: true });
    }
  }
  for (const i of table.indexes ?? []) out.push({ ...i, unique: false });
  return out;
}

/** COLUMN_KEY: PRI for a primary-key column, UNI for the column of a single-column UNIQUE index,
 *  MUL for the first column of any other index, otherwise empty (MySQL's documented precedence). */
function columnKey(col: ColumnDef, indexes: Array<IndexDef & { unique: boolean }>): string {
  const is = (i: IndexDef, n = 0) => i.columns[n]?.name.toLowerCase() === col.name.toLowerCase();
  if (indexes.some((i) => i.name === 'PRIMARY' && i.columns.some((_, n) => is(i, n)))) return 'PRI';
  if (indexes.some((i) => i.unique && i.columns.length === 1 && is(i))) return 'UNI';
  if (indexes.some((i) => is(i))) return 'MUL';
  return '';
}

/** COLUMN_DEFAULT as MySQL 8 reports it: the literal's text unquoted, or the expression text. */
function columnDefault(col: ColumnDef): Cell {
  if (col.defaultCurrentTimestamp !== undefined) return col.defaultCurrentTimestamp > 0 ? `CURRENT_TIMESTAMP(${col.defaultCurrentTimestamp})` : 'CURRENT_TIMESTAMP';
  if (col.defaultExpression !== undefined) return col.defaultExpression;
  if (col.defaultValue === undefined || col.defaultValue === null) return null;
  if (col.dataType === 'BIT' || col.dataType === 'BINARY' || col.dataType === 'VARBINARY') {
    return `0x${[...col.defaultValue].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}`;
  }
  return col.defaultValue;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE VIEWS
// ─────────────────────────────────────────────────────────────────────────────────────────────

type Rows = Array<Record<string, Cell>>;
const row = (view: TableDef, values: Cell[]): Record<string, Cell> => Object.fromEntries(view.columns.map((c, i) => [c.name, values[i] ?? null]));
const n = (v: number | null): Cell => (v === null ? null : String(v));

function sortedTables(db: Database): TableDef[] {
  return [...db.tables.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

const DERIVE: Record<string, (db: Database) => Rows> = {
  COLLATIONS: () => [...modelledCollations()].sort((a, b) => a.id - b.id).map((c) => row(COLLATIONS, [c.name, c.charset, String(c.id),
    DEFAULT_COLLATION_OF[c.charset] === c.name ? 'Yes' : '', 'Yes', String(SORTLEN[c.name] ?? 1), c.pad ? 'PAD SPACE' : 'NO PAD'])),
  TABLES: (db) => sortedTables(db).map((t) => {
    const rows = db.rows.get(t.name.toLowerCase())?.length ?? 0;
    const secondary = tableIndexes(t).filter((i) => i.name !== 'PRIMARY').length;
    return row(TABLES, ['def', db.name, t.name, 'BASE TABLE', 'InnoDB', '10', 'Dynamic', String(rows), '0',
      // InnoDB's size for a table this small: one 16 KiB page for the clustered index, one per secondary index.
      '16384', '0', String(16384 * secondary), '0',
      t.columns.some((c) => c.autoIncrement) ? String(t.autoIncrement) : null,
      null, null, null, t.collation ?? DEFAULT_COLLATION, null, '', '']);
  }),
  COLUMNS: (db) => sortedTables(db).flatMap((t) => {
    const indexes = tableIndexes(t);
    return t.columns.map((c, i) => {
      const m = columnMetadata(c, t);
      const generated = c.defaultCurrentTimestamp !== undefined || c.defaultExpression !== undefined;
      const extra = c.autoIncrement ? 'auto_increment' : generated ? 'DEFAULT_GENERATED' : '';
      return row(COLUMNS, ['def', db.name, t.name, c.name, String(i + 1), columnDefault(c), c.nullable ? 'YES' : 'NO', m.dataType,
        n(m.characterMaximumLength), n(m.characterOctetLength), n(m.numericPrecision), n(m.numericScale), n(m.datetimePrecision),
        m.characterSet, m.collation, m.columnType, columnKey(c, indexes), extra, 'select,insert,update,references', '', '', null]);
    });
  }),
  STATISTICS: (db) => sortedTables(db).flatMap((t) => {
    const stored = db.rows.get(t.name.toLowerCase()) ?? [];
    return tableIndexes(t).flatMap((index) => index.columns.map((part, seq) => {
      const col = t.columns.find((c) => c.name.toLowerCase() === part.name.toLowerCase());
      const prefix = index.columns.slice(0, seq + 1).map((p) => t.columns.find((c) => c.name.toLowerCase() === p.name.toLowerCase())?.name ?? p.name);
      const cardinality = new Set(stored.map((r) => JSON.stringify(prefix.map((k) => r.cells[k] ?? null)))).size;
      const fulltext = index.type === 'FULLTEXT';
      return row(STATISTICS, ['def', db.name, t.name, index.unique ? '0' : '1', db.name, index.name, String(seq + 1), col?.name ?? part.name,
        fulltext ? null : part.desc ? 'D' : 'A', String(cardinality), part.length === undefined ? null : String(part.length), null,
        col?.nullable ? 'YES' : '', index.type, '', '', 'YES', null]);
    }));
  }),
  TABLE_CONSTRAINTS: (db) => sortedTables(db).flatMap((t) => tableIndexes(t).filter((i) => i.unique).map((i) =>
    row(TABLE_CONSTRAINTS, ['def', db.name, i.name, db.name, t.name, i.name === 'PRIMARY' ? 'PRIMARY KEY' : 'UNIQUE', 'YES']))),
  KEY_COLUMN_USAGE: (db) => sortedTables(db).flatMap((t) => tableIndexes(t).filter((i) => i.unique).flatMap((i) => i.columns.map((part, seq) =>
    row(KEY_COLUMN_USAGE, ['def', db.name, i.name, 'def', db.name, t.name,
      t.columns.find((c) => c.name.toLowerCase() === part.name.toLowerCase())?.name ?? part.name, String(seq + 1), null, null, null, null])))),
  SCHEMATA: (db) => [row(SCHEMATA, ['def', INFORMATION_SCHEMA, 'utf8mb3', 'utf8mb3_general_ci', null, 'NO']),
    row(SCHEMATA, ['def', db.name, DEFAULT_CHARSET, DEFAULT_COLLATION, null, 'NO'])],
  REFERENTIAL_CONSTRAINTS: () => [],
  CHECK_CONSTRAINTS: () => [],
  VIEWS: () => [],
  ROUTINES: () => [],
  TRIGGERS: () => [],
};

const VIEW_DEFS: Record<string, TableDef> = {
  TABLES, COLUMNS, COLLATIONS, STATISTICS, TABLE_CONSTRAINTS, KEY_COLUMN_USAGE, REFERENTIAL_CONSTRAINTS, CHECK_CONSTRAINTS, VIEWS, ROUTINES, TRIGGERS, SCHEMATA,
};

export const isInformationSchema = (schema: string | undefined): boolean => schema?.toLowerCase() === INFORMATION_SCHEMA;

/** One catalog view, derived from `db` now: its definition and its rows. MySQL's own errno 1109
 *  for a view it does not have (information_schema is a read-only system schema). */
export function informationSchemaView(db: Database, name: string): { table: TableDef; rows: Rows } | undefined {
  const key = name.toUpperCase();
  const table = VIEW_DEFS[key];
  if (table === undefined) return undefined;
  return { table, rows: DERIVE[key]!(db) };
}
