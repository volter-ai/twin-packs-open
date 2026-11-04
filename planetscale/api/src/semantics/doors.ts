// The World's doors (docs/contributing/architecture.md, "Doors, screens and the gap"): a person's sign-up, which makes
// the organization they administer.
import { recordPerson, type HandlerContext } from '@volter/world-core';
import { branchOf, DATABASE, makeDatabase, makeOrganization, makePassword, organizationOf, PASSWORD, passwordSecret, type Row } from './shared.ts';

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
    try { await makeOrganization(ctx, { name: b.organization, billingEmail: email }); }
    catch (error) {
      if (error instanceof Response) return error;
      throw error;
    }
  }
  return Response.json({ email, organization: b.organization }, { status: 201 });
}

/** A name collision retries the native create once, without adopting another object's identity. */
async function namedCreate(ctx: HandlerContext, label: string, identity: string, max: number, make: (name: string) => Promise<string>): Promise<string> {
  const rule = { max, lower: true, allowed: /[a-z0-9-]/, first: /[a-z0-9]/ };
  try { return await make(ctx.vendorName(label, rule, { identity })); }
  catch (error) { if (!(error instanceof Response) || error.status !== 409) throw error; }
  try { return await make(ctx.vendorName(label, rule, { suffixed: true, identity })); }
  catch (error) {
    if (!(error instanceof Response) || error.status !== 409) throw error;
    const body = await error.json() as { code: string; message: string };
    throw ctx.refuse({ status: 409, code: body.code, message: `${body.message} World identity: ${identity}.` });
  }
}

/** POST /_twin/app-credentials: one organization's database and main-branch password for this deployment. */
// source: https://planetscale.com/docs/vitess/connecting/connection-strings "unique username and password pair"
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  try {
    const identity = await ctx.account();
    const org = await ctx.tenant('organization', async (organization) =>
      namedCreate(ctx, organization.id === 'default' ? 'world' : organization.id, organization.id, 32,
        name => makeOrganization(ctx, { name, billingEmail: organization.members[0]! })));
    const db = await ctx.deploymentObject(`database:${String(org.id)}`, 'database', async (deployment) =>
      namedCreate(ctx, deployment || 'world', deployment ? `${identity}/${deployment}` : identity, 64, async (name) => {
        const made = await makeDatabase(ctx, org, { name, region: 'aws-us-east-1', cluster: 'PS_10' });
        await ctx.write(DATABASE, String(made.id), { state: 'ready', ready: true, updated_at: ctx.occurredAt }, 'database.ready');
        return String(made.id);
      }));
    const branch = branchOf(ctx, db, 'main')!;
    const key = await ctx.accountKey('password', PASSWORD, {
      make: async () => String((await makePassword(ctx, db, branch, { name: 'world', role: 'admin', by: String(org._admin) })).row.id),
      read: async (row) => {
        if (row.deleted === true || row.expired === true || row.database !== db.id || row._branch !== branch.id) return undefined;
        const secret = await passwordSecret(ctx, String(row.id));
        return row._secret_sha256 === ctx.crypto.digest('sha256', secret) ? secret : undefined;
      },
    });
    const row = ctx.row(PASSWORD, key.id)!;
    const host = String(row.access_host_url), dbName = String(db.name);
    return Response.json({
      database_url: `mysql://${String(row.username)}:${key.secret}@${host}/${dbName}?sslaccept=strict`,
      native_url: `mysql://${String(row.username)}:${key.secret}@${host}/${dbName}`,
      http_url: `https://${String(row.username)}:${key.secret}@${host}`, host,
      username: row.username, password: key.secret, database: dbName,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}
