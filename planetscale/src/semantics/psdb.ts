// psdb.v1alpha1.Database: the HTTP API PlanetScale's driver sends SQL to. Execute is what every application calls
// (../../journeys/demand.json: Dub's driver and Prisma's PlanetScale adapter, Substrate's Prisma client); a statement runs on the password's
// branch in the session the client carries, and is answered in psdb's envelope (./shared.ts).
import type { HandlerContext } from '@volter/world-core';
import { callerPassword, execute, roleRefusal, sessionFor, wireError, wireResult } from './shared.ts';

type Row = Record<string, unknown>;

/** An unauthenticated call: 401 in the same `{ session, error }` envelope. Where the documentation stops: its words. */
const unauthenticated = (): Response => Response.json({ session: null, error: { code: 'unauthenticated', message: 'invalid username or password' } }, { status: 401 });

/** `Execute { query, session }`: one statement. */
// source: https://github.com/planetscale/database-js "execute('select 1 from dual')"
export async function Execute(ctx: HandlerContext): Promise<Response> {
  const p = callerPassword(ctx);
  if (!p) return unauthenticated();
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  if (typeof b.query !== 'string') return Response.json({ code: 'invalid_argument', message: 'query is required' }, { status: 400 });
  const carried = (b.session && typeof b.session === 'object' ? (b.session as Row).signature : undefined) as string | undefined;
  const session = await sessionFor(ctx, carried, String(p.database), String(p.username));
  const ran = await execute(ctx, session, b.query, (stmt) => roleRefusal(p, stmt));
  return Response.json(ran.error ? wireError(ran.session, ran.error) : wireResult(ran.session, ran.outcome!));
}
