// What the dashboard makes and the management API and psdb read: an organization (made with its administrator's
// sign-up), a database and its production branch `main`, a branch's passwords, the organization's service tokens and
// their accesses. A password's and a token's secret is shown once, when it is made, and kept by its SHA-256.
import { digest, type HandlerContext } from '@volter/world-core';
import { passwordSecret } from '../../../src/semantics/shared.ts';

export type Row = Record<string, unknown>;

export const ORGANIZATION = 'organization';
export const DATABASE = 'database';
export const BRANCH = 'branch';
export const PASSWORD = 'password';
export const SERVICE_TOKEN = 'service_token';
export const BACKUP = 'backup';
/** A service token's access on a database: one subject each (`<token>::<database>::<access>`), as a set is kept. */
export const TOKEN_ACCESS = '_token_access';
/** psdb's tables and rows (the pack root's src/semantics/shared.ts), which a database's deletion removes with it. */
export const ROW_TYPES = ['table', 'row'];

/** The organization a person administers, by its name. */
export const organizationOf = (ctx: Pick<HandlerContext, 'rowsRaw'>, name: string): Row | undefined => ctx.rowsRaw(ORGANIZATION).find((o) => o.name === name && o.deleted !== true);
export const databaseOf = (ctx: Pick<HandlerContext, 'rowsRaw'>, org: Row, name: string): Row | undefined => ctx.rowsRaw(DATABASE).find((d) => d._organization === org.id && d.name === name && d.deleted !== true);
export const branchOf = (ctx: Pick<HandlerContext, 'rowsRaw'>, db: Row, name: string): Row | undefined => ctx.rowsRaw(BRANCH).find((b) => b._database === db.id && b.name === name && b.deleted !== true);

/** A database as New database makes it: `pending` until provisioned (./clock.ts), with its production branch `main`. */
// source: https://planetscale.com/docs/vitess/tutorials/planetscale-quick-start-guide "production branch"
export async function makeDatabase(ctx: HandlerContext, org: Row, input: { name: string; region: string; cluster: string }): Promise<Row> {
  const id = ctx.mint('Database');
  const at = ctx.occurredAt;
  const region = { slug: input.region, display_name: input.region };
  await ctx.write(DATABASE, id, {
    id, name: input.name, state: 'pending', ready: false, kind: 'mysql', plan: 'scaler_pro', region, sharded: false, default_branch: 'main', production_branches_count: 1, development_branches_count: 0, branches_count: 1,
    automatic_migrations: false, require_approval_for_deploy: false, deletion_protected: false, allow_data_branching: false, foreign_keys_enabled: true, insights_enabled: true,
    html_url: `https://app.planetscale.com/${String(org.name)}/${input.name}`, url: `https://api.planetscale.com/v1/organizations/${String(org.name)}/databases/${input.name}`,
    created_at: at, updated_at: at, _organization: org.id, _cluster: input.cluster, deleted: false,
  }, 'database.create');
  const branch = ctx.mint('DatabaseBranch');
  await ctx.write(BRANCH, branch, {
    id: branch, name: 'main', production: true, ready: true, schema_ready: true, safe_migrations: false, sharded: false, kind: 'mysql', region, cluster_name: input.cluster, state: 'ready',
    mysql_address: `${input.region}.connect.psdb.cloud`, created_at: at, updated_at: at, _database: id, deleted: false,
  }, 'branch.create');
  return ctx.rowsRaw(DATABASE).find((d) => d.id === id)!;
}

/** A branch password as the Connect page makes it: "a unique username and password pair that can only be used to access
 *  the designated branch", shown once, its role and its host (`<region>.connect.psdb.cloud`). psdb reads it (the pack
 *  root's ./semantics/shared.ts). Where the documentation stops: the secret's shape, `pscale_pw_` and characters. */
// source: https://planetscale.com/docs/vitess/connecting/connection-strings "unique username and password pair"
/** A password's secret: the pack root's (./semantics/shared.ts), where psdb's MySQL wire derives it again too. */
export { passwordSecret };

export async function makePassword(ctx: HandlerContext, db: Row, branch: Row, input: { name: string; role: string; by: string }): Promise<{ row: Row; secret: string }> {
  const id = ctx.mint('DatabaseBranchPassword');
  const secret = await passwordSecret(ctx, id);
  const host = String(branch.mysql_address);
  await ctx.write(PASSWORD, id, {
    id, name: input.name, role: input.role, username: (await ctx.secret(`username:${id}`)).replace(/[^a-z0-9]/g, '').slice(0, 20), access_host_url: host, created_at: ctx.occurredAt, expired: false, renewable: false, replica: false,
    database_branch: { id: branch.id, name: branch.name, production: true, mysql_edge_address: host }, actor: { display_name: input.by, type: 'User' },
    // psdb's scope: the database's id (its tables' subjects) and its name (the schema a result's fields name)
    database: String(db.id), _schema: db.name, _branch: branch.id, _secret_sha256: digest('sha256', secret), deleted: false,
  }, 'password.create');
  return { row: ctx.rowsRaw(PASSWORD).find((p) => p.id === id)!, secret };
}

/** A service token as the settings page makes it: its id and token, shown once, no access until one is saved. Where the
 *  documentation stops: the token's shape, `pscale_tkn_` and characters. */
// source: https://planetscale.com/docs/api/reference/service-tokens "SERVICE_TOKEN_ID"
export async function makeServiceToken(ctx: HandlerContext, org: Row, name: string): Promise<{ row: Row; token: string }> {
  const id = ctx.mint('ServiceToken');
  const token = `pscale_tkn_${(await ctx.secret(`service-token:${id}`)).replace(/[-_]/g, '').slice(0, 43)}`;
  await ctx.write(SERVICE_TOKEN, id, {
    id, name, display_name: name, actor_type: 'ServiceToken', created_at: ctx.occurredAt, updated_at: ctx.occurredAt,
    _organization: org.id, _token_sha256: digest('sha256', token), deleted: false,
  }, 'service_token.create');
  return { row: ctx.rowsRaw(SERVICE_TOKEN).find((t) => t.id === id)!, token };
}

/** The service token a request carries: `Authorization: <SERVICE_TOKEN_ID>:<SERVICE_TOKEN>`. */
// source: https://planetscale.com/docs/api/reference/service-tokens "SERVICE_TOKEN_ID"
export function callerToken(ctx: Pick<HandlerContext, 'call' | 'rowsRaw'>): Row | undefined {
  const raw = (ctx.call.request.headers.get('authorization') ?? '').trim();
  const at = raw.indexOf(':');
  if (at < 1) return undefined;
  const id = raw.slice(0, at);
  const hash = digest('sha256', raw.slice(at + 1));
  return ctx.rowsRaw(SERVICE_TOKEN).find((t) => t.id === id && t._token_sha256 === hash && t.deleted !== true);
}

/** A token's accesses, each as the ServiceToken schema's `service_token_accesses` names one. */
export const accessesOf = (ctx: Pick<HandlerContext, 'rowsRaw'>, t: Row): Row[] =>
  ctx.rowsRaw(TOKEN_ACCESS).filter((a) => a._token === t.id && a.deleted !== true).map((a) => ({ id: a.id, access: a.access, resource_type: 'Database', resource: { id: a._database, name: a.resource_name, type: 'Database' } }));

/** Whether a token holds an access on a database. */
export const holds = (ctx: Pick<HandlerContext, 'rowsRaw'>, t: Row, access: string, db: Row): boolean =>
  ctx.rowsRaw(TOKEN_ACCESS).some((a) => a._token === t.id && a._database === db.id && a.access === access && a.deleted !== true);
