// The MySQL wire's private transport (../stream.ts): the native wire beside psdb runs each statement here, in a
// handler's context, through the same engine, sessions and password roles as psdb's Execute (./psdb.ts), so one
// database answers both wires, as PlanetScale's own product does. The key is this process's own (privateTransportKey):
// the transport is never a vendor credential nor a public door.
import { mysql, privateTransportKey, type HandlerContext } from '@volter/world-core';
import { execute, PASSWORD, passwordSecret, roleRefusal, sessionFor } from './shared.ts';

export const WIRE_HEADER = 'x-volter-mysql-wire';
export const wireKey = (): string => privateTransportKey('planetscale-mysql');

type Row = Record<string, unknown>;
type WireRequest =
  | { op: 'credentials'; user: string }
  | { op: 'execute'; password: string; session?: string; sql: string };

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  if (ctx.call.request.method !== 'POST' || ctx.call.request.headers.get(WIRE_HEADER) !== wireKey()) return next();
  const input = await ctx.call.request.json() as WireRequest;
  if (input.op === 'credentials') {
    // each live password of the user, by MySQL's stored form of its secret (mysql_native_password's SHA1(SHA1())), as a
    // MySQL server keeps it: the secret is derived again as the credential door derives it, and only when it still
    // matches what is stored; a password whose secret this World cannot derive again answers without one
    const credentials: Row[] = [];
    for (const p of ctx.rowsRaw(PASSWORD).filter((r) => r.username === input.user && r.deleted !== true && r.expired !== true)) {
      const secret = await passwordSecret(ctx, String(p.id));
      credentials.push(ctx.crypto.sha256(secret) === p._secret_sha256 ? { id: p.id, nativeHash: mysql.nativePasswordHash(secret) } : { id: p.id });
    }
    return Response.json({ credentials });
  }
  const p = ctx.rowsRaw(PASSWORD).find((r) => r.id === input.password && r.deleted !== true && r.expired !== true);
  // MySQL's access refusal: the password the connection signed in with was deleted or expired since
  // source: https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html "ER_ACCESS_DENIED_ERROR"
  if (!p) return Response.json({ error: { errno: 1045, sqlstate: '28000', message: 'Access denied: the password this connection signed in with was deleted or has expired' } });
  const session = await sessionFor(ctx, input.session, String(p.database), String(p.username));
  const ran = await execute(ctx, session, input.sql, (stmt) => roleRefusal(p, stmt));
  const held = { session: ran.session.id, inTransaction: ran.session.inTransaction };
  if (ran.error) return Response.json({ ...held, error: { errno: ran.error.errno, sqlstate: ran.error.sqlState, message: ran.error.message } });
  const o = ran.outcome!;
  return Response.json({ ...held, fields: o.fields, rows: o.rows, rowsAffected: o.rowsAffected, insertId: o.insertId });
}
