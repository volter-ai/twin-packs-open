// What Execute shares with its helpers: who a psdb request is (its branch password and role), a branch's SQL state in
// the tree and a session's transaction over it, and psdb's answer as the driver reads it.
//
// Who a psdb request is: a branch password, sent as HTTP Basic (`Authorization: Basic base64(username:password)`,
// @planetscale/database's postJSON), which the dashboard made on the branch's Connect page (the api lane's `password`,
// kept by the SHA-256 of its secret). Its role says which statements it may run (Read-only "Can query rows", Write-only
// "Can modify rows", Read/Write both, Admin those and schema changes).
//
// A branch's SQL state in the World's tree, and a session's transaction over it. Each table is one subject (`table`,
// `<database>:<table>`, its definition) and each row one subject (`row`, `<database>:<table>:<rowid>`, its cells kept
// nested so a column's name never meets the kernel's own fields), as the tree contract keeps a set: one subject per
// member. A statement runs against the image the tree folds to (../engine/sql.ts, pure), and its writes come back as
// subject writes: at once outside a transaction, or held in the session (`_session`, bookkeeping) until COMMIT, the
// statements between reading the image with them laid over it. ROLLBACK drops them. A DDL statement in an open
// transaction commits it first (they "implicitly end any transaction active in the current session", MySQL 8.0 manual 15.3.3).
// source: https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html "implicitly end any transaction active in the current session"
//
// psdb's answer, as PlanetScale's own driver reads it (@planetscale/database 1.19.0, dist/index.js): `{ session, result:
// { fields, rows, rowsAffected, insertId }, error?, timing }`, each row `{ lengths, values }`: its cells' byte lengths
// (-1 for NULL) and their bytes concatenated, base64 ("const values = row.values ? atob(row.values) : ''" … "if (width
// < 0) return null"). A binary column's cells (charset 63) are their bytes; any other's their UTF-8 text.
// source: https://github.com/planetscale/database-js "execute('select 1 from dual')"
import type { HandlerContext } from '@volter/world-core';
import { emptyDatabase, execStatement, parseStatement, SqlError, tableKey, type Database, type Field, type QueryOutcome, type SessionVars, type Statement, type TableDef, type Write } from '../engine/sql.ts';

type Row = Record<string, unknown>;

export const PASSWORD = 'password';

/** A password's secret, `pscale_pw_` and characters drawn from a secret the World holds for its id: what the dashboard
 *  shows once when it makes the password (the api lane), and what the native MySQL wire derives again to check a
 *  sign-in against MySQL's stored form of it (./around.ts). Where the documentation stops: the secret's shape. */
export const passwordSecret = async (ctx: Pick<HandlerContext, 'secret'>, id: string): Promise<string> => `pscale_pw_${(await ctx.secret(`password:${id}`)).replace(/[-_]/g, '').slice(0, 43)}`;

export function callerPassword(ctx: Pick<HandlerContext, 'call' | 'rowsRaw' | 'crypto'>): Row | undefined {
  const raw = /^basic\s+(\S+)/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (!raw) return undefined;
  const decoded = Buffer.from(raw, 'base64').toString('utf8');
  const at = decoded.indexOf(':');
  if (at < 0) return undefined;
  const username = decoded.slice(0, at);
  const hash = ctx.crypto.sha256(decoded.slice(at + 1));
  return ctx.rowsRaw(PASSWORD).find((p) => p.username === username && p._secret_sha256 === hash && p.deleted !== true);
}

const READS = new Set<Statement['kind']>(['select', 'describe', 'show-tables', 'show-warnings', 'show-create-table', 'set-vars', 'set-transaction', 'begin', 'commit', 'rollback']);

/** Whether a password's role may run a statement, and its refusal as PlanetScale words it: the statement's verb, or DDL
 *  for a schema change, the password's user and the table. */
// source: https://planetscale.com/docs/vitess/security/password-roles "Can query and modify rows"
// source: https://planetscale.com/docs/vitess/security/password-roles "Select command denied to user"
// source: https://planetscale.com/docs/vitess/security/password-roles "Insert command denied to user"
// source: https://planetscale.com/docs/vitess/security/password-roles "DDL command denied to user"
// source: https://planetscale.com/docs/vitess/security/password-roles "(ACL check error)"
export function roleRefusal(p: Row, stmt: Statement): SqlError | undefined {
  const role = String(p.role);
  if (role === 'admin') return undefined;
  const ddl = isDdl(stmt);
  const reads = READS.has(stmt.kind);
  const allowed = ddl ? false : stmt.kind === 'select' ? role !== 'writer' : reads || role === 'writer' || role === 'readwriter';
  if (allowed) return undefined;
  const kind = stmt.kind.split('-')[0]!;
  const verb = ddl ? 'DDL' : `${kind[0]!.toUpperCase()}${kind.slice(1)}`;
  const factor = stmt.kind === 'select' ? stmt.from?.[0]?.factor : undefined;
  const table = 'table' in stmt && typeof stmt.table === 'string' ? stmt.table : factor && 'table' in factor ? factor.table : '';
  const user = String(p.username);
  return new SqlError(`${verb} command denied to user '${user}' for table '${table}' (ACL check error) (CallerID: ${user})`, 'PERMISSION_DENIED', 1142, '42000');
}

// ── a branch's SQL state and its sessions ─────────────────────────────────────────────────────────

export const TABLE = 'table';
export const ROW = 'row';
export const SESSION = '_session';

/** A session as the tree keeps it: its database, whether a transaction is open and the writes it holds, the access
 *  mode its transactions take, and its variables. A session is never closed: CloseSession is the gap, and the driver
 *  never calls it. */
export type Session = { id: string; database: string; user: string; inTransaction: boolean; pending: Write[]; txReadOnly: boolean; nextAccess?: string; sessionAccess?: string; vars: SessionVars };

const DDL = new Set<Statement['kind']>(['create-table', 'create-table-select', 'drop-table', 'alter-add-columns', 'alter-drop-columns', 'truncate']);
export const isDdl = (stmt: Statement): boolean => DDL.has(stmt.kind);

/** The image of a database: its tables and their rows, as the tree holds them. */
export function imageOf(ctx: Pick<HandlerContext, 'rowsRaw'>, database: string): Database {
  // source: https://dev.mysql.com/doc/refman/8.0/en/information-functions.html "Return the default (current) database name"
  // SQL names its database, while subject keys and password scope keep the database's opaque id.
  const account = ctx.rowsRaw('database').find((d) => d.id === database && d.deleted !== true);
  const db = emptyDatabase(String(account?.name ?? database));
  for (const t of ctx.rowsRaw(TABLE)) if (t.database === database && t.deleted !== true) db.tables.set(tableKey(String((t.def as TableDef).name)), t.def as TableDef);
  for (const r of ctx.rowsRaw(ROW)) {
    if (r.database !== database || r.deleted === true || !db.tables.has(String(r.table))) continue;
    const rows = db.rows.get(String(r.table)) ?? [];
    rows.push({ rowid: Number(r.rowid), cells: r.cells as Record<string, string | null> });
    db.rows.set(String(r.table), rows);
  }
  for (const rows of db.rows.values()) rows.sort((a, b) => a.rowid - b.rowid);
  return db;
}

/** Writes laid over an image: what a statement in an open transaction reads. */
export function overlay(db: Database, writes: Write[]): Database {
  for (const w of writes) {
    if (w.kind === 'table') { db.tables.set(tableKey(w.table.name), w.table); if (!db.rows.has(tableKey(w.table.name))) db.rows.set(tableKey(w.table.name), []); continue; }
    if (w.kind === 'drop-table') { db.tables.delete(tableKey(w.table)); db.rows.delete(tableKey(w.table)); continue; }
    const key = tableKey(w.table);
    const rows = (db.rows.get(key) ?? []).filter((r) => r.rowid !== (w.kind === 'row' ? w.row.rowid : w.rowid));
    if (w.kind === 'row') rows.push({ rowid: w.row.rowid, cells: { ...w.row.cells } });
    rows.sort((a, b) => a.rowid - b.rowid);
    db.rows.set(key, rows);
  }
  return db;
}

/** A row write a transaction held that made a new row (its rowid not in the table when the statement ran). */
type Held = Write & { fresh?: boolean };

/** Writes made durable: each a subject write, in order. A row a transaction made whose rowid another session has taken
 *  since (an autocommit insert between its statement and its COMMIT) is given the table's next rowid, and the
 *  transaction's later writes to it follow; the rowid is the engine's own identity, never a column, so nothing the
 *  client saw changes. */
async function flush(ctx: HandlerContext, database: string, writes: Held[]): Promise<void> {
  const moved = new Map<string, number>();
  const durableMax = (table: string): number => ctx.rowsRaw(ROW).filter((r) => r.database === database && r.table === table).reduce((n, r) => Math.max(n, Number(r.rowid)), 0);
  const rowidOf = (table: string, rowid: number): number => moved.get(`${table}:${rowid}`) ?? rowid;
  for (const w of writes) {
    if (w.kind === 'row' && w.fresh) {
      const key = tableKey(w.table);
      const taken = ctx.rowsRaw(ROW).some((r) => r.id === `${database}:${key}:${w.row.rowid}` && r.deleted !== true);
      if (taken && !moved.has(`${key}:${w.row.rowid}`)) moved.set(`${key}:${w.row.rowid}`, Math.max(durableMax(key), ...[...moved.values()]) + 1);
    }
  }
  for (const w of writes) {
    if (w.kind === 'table') {
      await ctx.write(TABLE, `${database}:${tableKey(w.table.name)}`, { database, def: w.table, deleted: false }, 'table.put');
    } else if (w.kind === 'drop-table') {
      const key = tableKey(w.table);
      for (const r of ctx.rowsRaw(ROW)) if (r.database === database && r.table === key && r.deleted !== true) await ctx.remove(ROW, String(r.id), 'row.delete');
      await ctx.remove(TABLE, `${database}:${key}`, 'table.drop');
    } else if (w.kind === 'row') {
      const key = tableKey(w.table);
      const rowid = rowidOf(key, w.row.rowid);
      await ctx.write(ROW, `${database}:${key}:${rowid}`, { database, table: key, rowid, cells: w.row.cells, deleted: false }, 'row.put');
    } else {
      await ctx.remove(ROW, `${database}:${tableKey(w.table)}:${rowidOf(tableKey(w.table), w.rowid)}`, 'row.delete');
    }
  }
}

const saved = (s: Row): Session => ({
  id: String(s.id), database: String(s.database), user: String(s.user), inTransaction: s.inTransaction === true, pending: (s.pending as Write[]) ?? [], txReadOnly: s.txReadOnly === true,
  ...(typeof s.nextAccess === 'string' ? { nextAccess: s.nextAccess } : {}), ...(typeof s.sessionAccess === 'string' ? { sessionAccess: s.sessionAccess } : {}),
  vars: (s.vars as SessionVars) ?? { user: {} },
});

// source: https://dev.mysql.com/doc/refman/8.0/en/set-transaction.html "Subsequent transactions revert to using the session"
// A record is a field update: explicitly clear a consumed next-transaction setting in the held session.
async function keep(ctx: HandlerContext, s: Session): Promise<void> {
  await ctx.record(SESSION, { database: s.database, user: s.user, inTransaction: s.inTransaction, pending: s.pending as never, txReadOnly: s.txReadOnly, nextAccess: s.nextAccess ?? null, sessionAccess: s.sessionAccess ?? null, vars: s.vars as never }, s.id);
}

/** The session a request names, when it is this user's on this database; a new one otherwise ("if
 *  !clientSession { sess = session.New(…) }", ps-http-sim). */
// source: https://github.com/mattrobenolt/ps-http-sim/blob/main/main.go "if !clientSession"
export async function sessionFor(ctx: HandlerContext, id: string | undefined, database: string, user: string): Promise<Session> {
  const held = id ? ctx.rowsRaw(SESSION).find((s) => s.id === id) : undefined;
  if (held && held.database === database && held.user === user) return saved(held);
  const s: Session = { id: ctx.mint('Session'), database, user, inTransaction: false, pending: [], txReadOnly: false, vars: { user: {} } };
  await keep(ctx, s);
  return s;
}

/** A failure the engine raised that is not MySQL's refusal (a SqlError): the engine's own bug, raised as it came. */
function engineFault(e: unknown): never {
  throw e;
}

// The MySQL rules the engine (../engine/, pure) answers here and the stated-rule examples replay: the information
// schema's columns, a collation's comparison and coercibility, and GROUP BY and DISTINCT's refusals.
// source: https://dev.mysql.com/doc/refman/8.0/en/information-schema-columns-table.html "COLUMN_NAME The name of the column."
// source: https://dev.mysql.com/doc/refman/8.0/en/information-schema-columns-table.html "ORDINAL_POSITION The position of the column within the table."
// source: https://dev.mysql.com/doc/refman/8.0/en/information-schema-columns-table.html "DATA_TYPE The column data type."
// source: https://dev.mysql.com/doc/refman/8.0/en/information-schema-tables-table.html "TABLE_SCHEMA The name of the schema (database) to which the table belongs."
// source: https://dev.mysql.com/doc/refman/8.0/en/information-schema-tables-table.html "TABLE_NAME The name of the table."
// source: https://dev.mysql.com/doc/refman/8.0/en/information-schema-statistics-table.html "NON_UNIQUE 0 if the index cannot contain duplicates, 1 if it can."
// source: https://dev.mysql.com/doc/refman/8.0/en/information-schema-statistics-table.html "INDEX_NAME The name of the index."
// source: https://dev.mysql.com/doc/refman/8.0/en/information-schema-statistics-table.html "If the index is the primary key, the name is always PRIMARY"
// source: https://dev.mysql.com/doc/refman/8.0/en/information-schema-table-constraints-table.html "CONSTRAINT_TYPE The type of constraint."
// source: https://dev.mysql.com/doc/refman/8.0/en/information-schema-key-column-usage-table.html "COLUMN_NAME The name of the column that has the constraint."
// source: https://dev.mysql.com/doc/refman/8.0/en/information-schema-schemata-table.html "SCHEMA_NAME The name of the schema."
// source: https://dev.mysql.com/doc/refman/8.0/en/group-by-handling.html "a query that has DISTINCT and ORDER BY is rejected as invalid if any ORDER BY expression does not satisfy at least one of these conditions"
// source: https://dev.mysql.com/doc/refman/8.0/en/group-by-handling.html "The expression is equal to one in the select list"
// source: https://dev.mysql.com/doc/refman/8.0/en/group-by-handling.html "All columns referenced by the expression and belonging to the query's selected tables are elements of the select list"
// source: https://dev.mysql.com/doc/refman/8.0/en/group-by-handling.html "MySQL rejects queries for which the select list, HAVING condition, or ORDER BY list refer to nonaggregated columns that are neither named in the GROUP BY clause nor are functionally dependent on them."
// source: https://dev.mysql.com/doc/refman/8.0/en/charset-unicode-sets.html "utf8mb4_unicode_ci supports mappings such as expansions; that is, when one character compares as equal to combinations of other characters."
// source: https://dev.mysql.com/doc/refman/8.0/en/charset-unicode-sets.html "is equal to ss in German and some other languages."
// source: https://dev.mysql.com/doc/refman/8.0/en/charset-unicode-sets.html "in contrast to PAD SPACE as used in collations based on UCA versions prior to 9.0.0"
// source: https://dev.mysql.com/doc/refman/8.0/en/charset-unicode-sets.html "support Basic Multilingual Plane (BMP) characters and supplementary characters that lie outside the BMP."
// source: https://dev.mysql.com/doc/refman/8.0/en/charset-collation-coercibility.html "For an operation with operands from the same character set but that mix a _bin collation and a _ci or _cs collation, the _bin collation is used."
// source: https://dev.mysql.com/doc/refman/8.0/en/charset-collation-coercibility.html "An explicit COLLATE clause has a coercibility of 0 (not coercible at all)."
// source: https://dev.mysql.com/doc/refman/8.0/en/charset-collation-coercibility.html "If both sides are Unicode, or both sides are not Unicode, it is an error."
// source: https://dev.mysql.com/doc/refman/8.0/en/charset-collation-coercibility.html "Use the collation with the lowest coercibility value."
// source: https://dev.mysql.com/doc/refman/8.0/en/charset-collation-coercibility.html "the side with Unicode character set wins, and automatic character set conversion is applied to the non-Unicode side."
// source: https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html "Symbol: ER_COLLATION_CHARSET_MISMATCH"
// source: https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html "COLLATION '%s' is not valid for CHARACTER SET '%s'"
// source: https://dev.mysql.com/doc/refman/8.0/en/charset-unicode-sets.html "The collation sorts characters not having a code point listed in the DUCET table using their implicit weight value, which is constructed according to the UCA."
/** One statement in a session: parsed, run over the image (with the session's transaction laid over it), its writes
 *  made durable or held, the transaction verbs and the session's variables carried. A refusal is MySQL's (SqlError). */
// source: https://planetscale.com/docs/reference/planetscale-system-limits "Per-query rows returned, updated, or deleted 100k"
// source: https://planetscale.com/docs/reference/mysql-compatibility "You cannot CREATE a logical database within a PlanetScale Vitess database."
export async function execute(ctx: HandlerContext, session: Session, sql: string, check?: (stmt: Statement) => SqlError | undefined): Promise<{ session: Session; outcome?: QueryOutcome; error?: SqlError }> {
  let s = { ...session };
  let stmt: Statement;
  try { stmt = parseStatement(sql, s.vars.sqlMode); } catch (e) { if (e instanceof SqlError) return { session: s, error: e }; return engineFault(e); }
  const denied = check?.(stmt);
  if (denied) return { session: s, error: denied };
  // SET TRANSACTION for the next transaction "is not permitted within transactions" (ERROR 1568 (25001))
  // source: https://dev.mysql.com/doc/refman/8.0/en/set-transaction.html "The statement is not permitted within transactions"
  // source: https://dev.mysql.com/doc/refman/8.0/en/set-transaction.html "Transaction characteristics can't be changed"
  if (stmt.kind === 'set-transaction' && stmt.scope === 'next' && s.inTransaction) return { session: s, error: new SqlError("Transaction characteristics can't be changed while a transaction is in progress", 'FAILED_PRECONDITION', 1568, '25001') };
  if (s.inTransaction && isDdl(stmt)) {
    await flush(ctx, s.database, s.pending);
    s = { ...s, inTransaction: false, pending: [], txReadOnly: false };
  }
  let outcome: QueryOutcome;
  const before = new Map<string, Set<number>>();
  try {
    const image = overlay(imageOf(ctx, s.database), s.inTransaction ? s.pending : []);
    for (const [table, rows] of image.rows) before.set(table, new Set(rows.map((r) => r.rowid)));
    outcome = execStatement(image, stmt, { now: ctx.occurredAt, transactionReadOnly: s.inTransaction && s.txReadOnly, vars: s.vars });
  } catch (e) {
    if (e instanceof SqlError) { await keep(ctx, s); return { session: s, error: e }; } return engineFault(e);
  }
  if (outcome.vars) s.vars = outcome.vars;
  if (outcome.setTransaction) {
    if (outcome.setTransaction.scope === 'next' && outcome.setTransaction.access) s.nextAccess = outcome.setTransaction.access;
    // SESSION applies "to all subsequent transactions", and between transactions it "overrides any preceding statement that
    // sets the next-transaction value"
    // source: https://dev.mysql.com/doc/refman/8.0/en/set-transaction.html "The statement applies to all subsequent transactions"
    // source: https://dev.mysql.com/doc/refman/8.0/en/set-transaction.html "overrides any preceding statement that sets the next-transaction value"
    if (outcome.setTransaction.scope === 'session' && outcome.setTransaction.access) { s.sessionAccess = outcome.setTransaction.access; if (!s.inTransaction) delete s.nextAccess; }
  }
  if (outcome.transaction === 'begin') {
    // "Beginning a transaction causes any pending transaction to be committed"
    // source: https://dev.mysql.com/doc/refman/8.0/en/commit.html "Beginning a transaction causes any pending transaction to be committed"
    if (s.inTransaction) await flush(ctx, s.database, s.pending);
    const access = outcome.access ?? s.nextAccess ?? s.sessionAccess;
    s = { ...s, inTransaction: true, pending: [], txReadOnly: access === 'READ ONLY' };
    delete s.nextAccess;
  } else if (outcome.transaction === 'commit') {
    await flush(ctx, s.database, s.pending);
    s = { ...s, inTransaction: false, pending: [], txReadOnly: false };
  } else if (outcome.transaction === 'rollback') {
    s = { ...s, inTransaction: false, pending: [], txReadOnly: false };
  } else if (outcome.writes.length) {
    if (s.inTransaction) {
      // InnoDB hands out AUTO_INCREMENT values outside the transaction: the table's raised watermark is durable at once,
      // so another session's insert takes the next id, and a rollback does not give it back
      // source: https://dev.mysql.com/doc/refman/8.0/en/innodb-auto-increment-handling.html "Once a value is generated for an auto-increment column, it cannot be rolled back"
      await flush(ctx, s.database, outcome.writes.filter((w) => w.kind === 'table'));
      const held: Held[] = outcome.writes.filter((w) => w.kind !== 'table').map((w) => (w.kind === 'row' && !before.get(tableKey(w.table))?.has(w.row.rowid) ? { ...w, fresh: true } : w));
      s.pending = [...s.pending, ...held];
    } else await flush(ctx, s.database, outcome.writes);
  }
  await keep(ctx, s);
  return { session: s, outcome };
}

// ── psdb's answer ───────────────────────────────────────────────────────────────────────────────

const BINARY_CHARSET = 63;

/** The session as the client carries it back on its next call: opaque to the driver, which stores whatever the answer
 *  names. Where the documentation stops: its shape (the twin's id as its signature, and whether a transaction is open). */
export const wireSession = (s: Session): Row => ({ signature: s.id, vitessSession: present({ inTransaction: s.inTransaction, autocommit: true }) });

/** A proto3 message as Connect's JSON writes it: every field of implicit presence at its default value (false, zero, the
 *  empty string, an empty repeated field) left out (protobuf's JSON mapping, cited at wireResult). */
const present = (o: Row): Row => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== false && v !== 0 && v !== '' && !(Array.isArray(v) && v.length === 0)));

// Vitess's Type enum's zero value is NULL_TYPE: a NULL column's type is that default, and so left out like any other
const wireField = (f: Field): Row => present(Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== 'collation' && !(k === 'type' && (v === 'NULL' || v === 'NULL_TYPE')))));

function wireRow(fields: Field[], cells: Array<string | null>): Row {
  const lengths: string[] = [];
  const parts: Buffer[] = [];
  cells.forEach((cell, i) => {
    if (cell === null) { lengths.push('-1'); return; }
    const bytes = Buffer.from(cell, fields[i]?.charset === BINARY_CHARSET ? 'latin1' : 'utf8');
    lengths.push(String(bytes.length));
    parts.push(bytes);
  });
  // source: https://raw.githubusercontent.com/planetscale/database-js/v1.19.0/src/index.ts "row.values ? atob(row.values) : ''"
  return present({ lengths, values: Buffer.concat(parts).toString('base64') });
}

// The result as Connect's JSON serializer writes the proto's QueryResult (`uint64 rows_affected`, `uint64 insert_id`,
// `repeated Row rows`, each of implicit presence): a field at its default value (a zero count, an empty repeated field)
// is left out, which is why the driver reads `result?.rowsAffected ? ... : 0` and `result.rows ?? []`.
// source: https://protobuf.dev/programming-guides/json/ "and that have their default value are omitted by default in JSON output"
// source: https://protobuf.dev/programming-guides/json/ "empty repeated and map fields"
// source: https://raw.githubusercontent.com/planetscale/database-js/v1.19.0/src/index.ts "const rowsAffected = result?.rowsAffected ? parseInt(result.rowsAffected, 10) : 0"
export function wireResult(s: Session, outcome: QueryOutcome): Row {
  return {
    session: wireSession(s),
    result: {
      ...(outcome.fields.length ? { fields: outcome.fields.map(wireField) } : {}),
      ...(outcome.rows.length ? { rows: outcome.rows.map((r) => wireRow(outcome.fields, r)) } : {}),
      ...(outcome.rowsAffected ? { rowsAffected: String(outcome.rowsAffected) } : {}),
      ...(outcome.insertId ? { insertId: String(outcome.insertId) } : {}),
    },
    timing: 0.001,
  };
}

/** A statement's refusal: 200, the session, and `{ code, message }` with MySQL's message, errno and sqlstate. */
export const wireError = (s: Session, e: SqlError): Row => ({ session: wireSession(s), error: { code: e.code, message: e.message } });
