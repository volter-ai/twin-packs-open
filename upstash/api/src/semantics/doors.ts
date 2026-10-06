// The World's doors (architecture, "Doors, screens and the gap"), each declared in the manifest's `doors`: a person's
// sign-up, and the credentials the runtime issues a World's application, made as the console's pages make them.
import { recordPerson, type HandlerContext } from '@volter/world-core';
import { DATABASE, makeDatabase, openQStash, type Row } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
function bad(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

/** POST /_twin/users/{email} {password}: a person who can sign in to the console. */
export async function users(ctx: HandlerContext): Promise<Response> {
  const email = String(ctx.call.params.email ?? '').toLowerCase();
  const b = bodyOf(ctx);
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || typeof b.password !== 'string' || !b.password) return bad('an email and a password are required');
  await recordPerson(ctx, email, b.password);
  return Response.json({ email }, { status: 201 });
}

/** POST /_twin/app-credentials {owner?}: what an application's environment needs from Upstash, made as its owner makes
 *  them on the console: a Redis database (its REST URL and token) and the account's QStash (its token and signing keys).
 *  The runtime issues these to a World's applications (the descriptor's credentialDoor). */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const owner = (typeof b.owner === 'string' ? b.owner : 'owner@world.test').toLowerCase();
  // the application's database, made the first time the runtime asks and the same at every boot after
  const name = typeof b.name === 'string' ? b.name : 'world';
  const d = ctx.rowsRaw(DATABASE).find((x) => x.customer_id === owner && x.database_name === name && x.deleted !== true) ?? await makeDatabase(ctx, { owner, name, region: 'us-east-1' });
  const q = await openQStash(ctx, { owner, region: 'eu-central-1' });
  return Response.json({
    redis_url: `https://${String(d.endpoint)}.upstash.io`, redis_token: d.rest_token,
    qstash_url: q._url, qstash_token: q.token, qstash_current_signing_key: q._current_signing_key, qstash_next_signing_key: q._next_signing_key,
  }, { status: 201 });
}
