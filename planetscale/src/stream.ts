// PlanetScale's native MySQL wire (the connection string a database's Connect page gives Prisma, `mysql://…`), served
// beside psdb over the same engine and tree: the kernel's MySQL protocol (@volter/world-core/mysql), each statement run
// through the private transport (./semantics/around.ts) as psdb's Execute runs it. A password signs in by
// mysql_native_password against MySQL's stored form of its secret; one this World cannot derive again is refused by name.
import { mysql, type PackFetchOptions, type TwinStream } from '@volter/world-core';
import { SERVER_VERSION, type Field } from './engine/sql.ts';
import { createPlanetscaleFetch } from './fetch.ts';
import { WIRE_HEADER, wireKey } from './semantics/around.ts';

type Session = { password: string; session?: string; inTransaction: boolean };
type Answer = { session?: string; inTransaction?: boolean; error?: mysql.MysqlError; fields?: Field[]; rows?: (string | null)[][]; rowsAffected?: number; insertId?: number };

const T = mysql.MysqlType;
const UNSIGNED = 32, BINARY = 128, ENUM = 256, SET = 2048; // mysql_com.h
/** A Vitess field type (what psdb's fields carry) as MySQL's column type code and the flags Vitess sends with it. */
// source: https://github.com/vitessio/vitess/blob/main/go/sqltypes/type.go "typeToMySQL is the reverse of mysqlToType."
const COLUMN: Record<string, [number, number]> = {
  INT8: [T.TINY, 0], UINT8: [T.TINY, UNSIGNED], INT16: [T.SHORT, 0], UINT16: [T.SHORT, UNSIGNED], INT32: [T.LONG, 0],
  UINT32: [T.LONG, UNSIGNED], FLOAT32: [T.FLOAT, 0], FLOAT64: [T.DOUBLE, 0], NULL: [T.NULL, BINARY], TIMESTAMP: [T.TIMESTAMP, 0],
  INT64: [T.LONGLONG, 0], UINT64: [T.LONGLONG, UNSIGNED], INT24: [T.INT24, 0], UINT24: [T.INT24, UNSIGNED],
  DATE: [T.DATE, BINARY], TIME: [T.TIME, BINARY], DATETIME: [T.DATETIME, BINARY], YEAR: [T.YEAR, UNSIGNED], BIT: [T.BIT, UNSIGNED],
  JSON: [T.JSON, 0], DECIMAL: [T.NEWDECIMAL, 0], TEXT: [T.BLOB, 0], BLOB: [T.BLOB, BINARY], VARCHAR: [T.VAR_STRING, 0],
  VARBINARY: [T.VAR_STRING, BINARY], CHAR: [T.STRING, 0], BINARY: [T.STRING, BINARY], ENUM: [T.STRING, ENUM], SET: [T.STRING, SET],
  GEOMETRY: [T.GEOMETRY, 0],
};

function column(f: Field): mysql.MysqlColumn {
  // an EXPRESSION (a computed value Vitess does not type) answers as text
  const [type, flags] = COLUMN[f.type] ?? [T.VAR_STRING, 0];
  return {
    name: f.name, type, charset: f.charset, length: f.columnLength, flags: (f.flags ?? 0) | flags,
    ...(f.table ? { table: f.table } : {}), ...(f.orgTable ? { orgTable: f.orgTable } : {}),
    ...(f.orgName ? { orgName: f.orgName } : {}), ...(f.database ? { schema: f.database } : {}),
  };
}

/** A password whose secret this World can no longer derive (the World's seed for it changed since it was made): the
 *  wire cannot check it, and says so by name rather than refuse it as a wrong password. */
function predatesWire(user: string): { error: mysql.MysqlError } {
  return { error: { errno: 1045, sqlstate: '28000', message: `Access denied for user '${user}': this credential predates MySQL-wire access; rotate it` } };
}

export function createPlanetscaleTwinStream(options: PackFetchOptions = {}): TwinStream {
  const fetch = createPlanetscaleFetch(options);
  const call = async (body: Record<string, unknown>): Promise<any> => {
    const response = await fetch(new Request('http://planetscale.wire/', { method: 'POST', headers: { 'content-type': 'application/json', [WIRE_HEADER]: wireKey() }, body: JSON.stringify(body) }));
    if (!response.ok) throw new Error(`the MySQL wire's private transport answered ${response.status}`);
    return response.json();
  };
  return mysql.createMysqlStream<Session>({
    version: SERVER_VERSION,
    // the password names its database, as a PlanetScale connection string's does; the client's database is that one
    async connect(user, _database, check) {
      const { credentials } = await call({ op: 'credentials', user }) as { credentials: { id: string; nativeHash?: string }[] };
      const match = credentials.find((c) => c.nativeHash !== undefined && check.storedHash(c.nativeHash));
      if (match) return { session: { password: match.id, inTransaction: false } };
      // source: https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html "Access denied for user '%s'@'%s' (using password: %s)"
      if (credentials.length > 0 && credentials.every((c) => c.nativeHash === undefined)) return predatesWire(user);
      return { error: { errno: 1045, sqlstate: '28000', message: `Access denied for user '${user}'@'localhost' (using password: YES)` } };
    },
    async execute(s, sql) {
      const a = await call({ op: 'execute', password: s.password, session: s.session, sql }) as Answer;
      if (a.session) s.session = a.session;
      s.inTransaction = a.inTransaction === true;
      if (a.error) return { error: a.error };
      if (a.fields && a.fields.length > 0) return { columns: a.fields.map(column), rows: a.rows ?? [] };
      return { affectedRows: a.rowsAffected ?? 0, insertId: a.insertId ?? 0 };
    },
    inTransaction: (s) => s.inTransaction,
    // a connection gone with a transaction open leaves nothing behind: MySQL rolls it back
    close(s) { if (s.inTransaction) void call({ op: 'execute', password: s.password, session: s.session, sql: 'ROLLBACK' }).catch(() => {}); },
  });
}
