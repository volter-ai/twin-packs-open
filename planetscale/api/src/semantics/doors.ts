// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"): a person's sign-up, which makes
// the organization they administer.
import { recordPerson, type HandlerContext } from '@volter/world-core';
import { DATABASE, databaseOf, makeDatabase, makePassword, ORGANIZATION, organizationOf, PASSWORD, passwordSecret, type Row } from './shared.ts';
import { branchOf } from './shared.ts';

/** The users door's refusal of a request missing what a sign-up needs. */
function incomplete(): Response {
  return Response.json({ error: 'an email, a password and an organization name are required' }, { status: 400 });
}

/** POST /_twin/users/{email} {password, organization}: a person who can sign in, and their organization. */
export async function users(ctx: HandlerContext): Promise<Response> {
  const email = String(ctx.call.params.email ?? '').toLowerCase();
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || typeof b.password !== 'string' || !b.password || typeof b.organization !== 'string' || !/^[a-z0-9-]+$/.test(b.organization)) return incomplete();
  await recordPerson(ctx, email, b.password);
  if (!organizationOf(ctx, b.organization)) {
    const id = ctx.mint('Organization');
    await ctx.write(ORGANIZATION, id, { id, name: b.organization, billing_email: email, plan: 'scaler_pro', created_at: ctx.occurredAt, updated_at: ctx.occurredAt, _admin: email, deleted: false }, 'organization.create');
  }
  return Response.json({ email, organization: b.organization }, { status: 201 });
}

/** POST /_twin/app-credentials {organization?, database?}: what an application's environment needs from PlanetScale, as
 *  its owner makes it on the dashboard: the organization, a database (ready, as one made before the World began is) and
 *  an admin password on its main branch. Answered as the connection strings the dashboard's Connect page shows: a MySQL
 *  URL for Prisma and an HTTPS one for the serverless driver. The runtime issues them to a World's applications (the
 *  descriptor's credentialDoor). */
// source: https://planetscale.com/docs/vitess/connecting/connection-strings "unique username and password pair"
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  const account = await ctx.account();
  const orgName = `${typeof b.organization === 'string' ? b.organization : 'world'}${account === 'default' ? '' : `-${ctx.crypto.sha256(account).slice(0, 24)}`}`;
  const owner = account === 'default' ? 'owner@world.test' : `owner+${ctx.crypto.sha256(account).slice(0, 24)}@world.test`;
  let org = organizationOf(ctx, orgName);
  if (!org) {
    const id = ctx.mint('Organization');
    await ctx.write(ORGANIZATION, id, { id, name: orgName, billing_email: owner, plan: 'scaler_pro', created_at: ctx.occurredAt, updated_at: ctx.occurredAt, _admin: owner, deleted: false }, 'organization.create');
    org = organizationOf(ctx, orgName)!;
  }
  const dbName = typeof b.database === 'string' ? b.database : 'world';
  const db = databaseOf(ctx, org, dbName) ?? await makeDatabase(ctx, org, { name: dbName, region: 'aws-us-east-1', cluster: 'PS_10' });
  if (db.state !== 'ready') await ctx.write(DATABASE, String(db.id), { state: 'ready', ready: true, updated_at: ctx.occurredAt }, 'database.ready');
  const branch = branchOf(ctx, db, 'main')!;
  // the application's password, made the first time the runtime asks and the same at every boot after
  // a held key answers again only while its value still matches what is stored (a branch that made its own seed before
  // the key reached it derives another value, so it issues a new key rather than one that is refused)
  const found = ctx.rowsRaw(PASSWORD).find((p) => p.name === 'world' && p._branch === branch.id && p.deleted !== true && p.expired !== true);
  const again = found ? await passwordSecret(ctx, String(found.id)) : undefined;
  const held = found && again && found._secret_sha256 === ctx.crypto.digest('sha256', again) ? found : undefined;
  const { row, secret } = held ? { row: held, secret: again! } : await makePassword(ctx, db, branch, { name: 'world', role: 'admin', by: owner });
  const host = String(row.access_host_url);
  return Response.json({
    database_url: `mysql://${String(row.username)}:${secret}@${host}/${dbName}?sslaccept=strict`,
    // the same password on the twin's native MySQL wire: the runtime puts the side port's listener in its authority
    // (the descriptor's `side:mysql:native_url` fill), which speaks no TLS, so it asks for none
    native_url: `mysql://${String(row.username)}:${secret}@${host}/${dbName}`,
    http_url: `https://${String(row.username)}:${secret}@${host}`, host, username: row.username, password: secret, database: dbName,
  }, { status: 201 });
}
