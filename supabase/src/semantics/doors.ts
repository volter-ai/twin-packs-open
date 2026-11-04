// The dashboard's New project provisions the project's native Postgres database and login role.
import type { HandlerContext } from '@volter/world-core';

type Row = Record<string, unknown>;
const ident = (value: string): string => `"${value.replace(/"/g, '""')}"`;
const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** A deployment Project owns a separate database; the direct default door uses its bound database. */
// source: https://supabase.com/docs/guides/deployment/branching
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  if (!ctx.engine.bound || ctx.engine.url === undefined) return unbound(ctx);
  const organization = await ctx.tenant('_organization', async (world) => String((await ctx.create('_organization', {
    name: world.label, owner: world.members[0]!.toLowerCase(),
  }, 'organization.create')).id));
  const account = await ctx.account();
  const project = await ctx.deploymentObject(`project:${organization.id}`, '_project', async (deployment) => {
    const direct = account === 'default' && !deployment;
    const binding = (await ctx.engine.batch({ statements: [{ text: 'SELECT current_database(), current_user' }] }))[0]!.rows[0]!;
    const boundDatabase = String(binding[0]), boundRole = String(binding[1]);
    if (direct) {
      const held = ctx.rowsRaw('_project').find((row) => row.name === 'world'
        && (row.organization_id === undefined || (row.organization_id === organization.id && row._default === true)));
      if (held) {
        await ctx.record('_project', { organization_id: organization.id, _default: true,
          _database_name: boundDatabase, _database_role: boundRole }, String(held.id));
        return String(held.id);
      }
    }
    const row = await ctx.create('_project', (id) => ({ ref: id, name: deployment || (direct ? 'world' : organization.name),
      organization_id: organization.id, created_at: ctx.occurredAt, _default: direct,
      _database_name: direct ? boundDatabase : id,
      _database_role: direct ? boundRole : `supabase_${id}`,
    }), 'project.create');
    const native = ctx.row('_project', String(row.id))!;
    if (!direct) {
      const role = String(native._database_role), database = String(native._database_name);
      await ctx.engine.script(`CREATE ROLE ${ident(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
      await ctx.engine.script(`CREATE DATABASE ${ident(database)} OWNER ${ident(role)}`);
      await ctx.engine.script(`REVOKE CONNECT ON DATABASE ${ident(database)} FROM PUBLIC`);
      await ctx.engine.script(`REVOKE CONNECT ON DATABASE ${ident(boundDatabase)} FROM PUBLIC`);
      if (boundDatabase !== 'postgres') await ctx.engine.script('REVOKE CONNECT ON DATABASE postgres FROM PUBLIC');
      await ctx.engine.script('REVOKE CONNECT ON DATABASE template1 FROM PUBLIC');
    }
    return String(row.id);
  });
  const read = async (row: Row): Promise<string | undefined> => {
    if (row.project_id !== project.id || row.role !== project._database_role || row.database !== project._database_name || row.revoked === true) return undefined;
    const value = project._default === true ? ctx.engine.url! : await ctx.secret(`supabase-database-password:${row.id}`);
    if (ctx.crypto.sha256(value) !== row.sha256) return undefined;
    if (project._default === true) return value;
    const url = new URL(ctx.engine.url!);
    url.username = String(row.role); url.password = value; url.pathname = `/${String(row.database)}`;
    return url.href;
  };
  const key = await ctx.accountKey(`database-login:${project.id}`, '_database_credential', {
    make: async () => {
      const prior = ctx.rowsRaw('_database_credential').find((row) => row.project_id === project.id);
      if (prior && await read(prior)) return String(prior.id);
      if (prior && (prior.revoked === true || prior.sha256 !== undefined)) await ctx.record('_database_credential', { deleted: true }, String(prior.id));
      const made = await ctx.createUnique('_database_credential', { project_id: project.id, role: project._database_role,
        database: project._database_name }, 'database_credential.reserve', { input: 'omit' });
      const id = String(made.row.id);
      const value = project._default === true ? ctx.engine.url! : await ctx.secret(`supabase-database-password:${id}`);
      if (project._default !== true) await ctx.engine.script(`ALTER ROLE ${ident(String(project._database_role))} PASSWORD ${literal(value)}`);
      await ctx.record('_database_credential', { sha256: ctx.crypto.sha256(value) }, id);
      return id;
    },
    read,
  });
  return ctx.reply({ ref: project.ref, database_url: key.secret }, 201);
}

function unbound(ctx: HandlerContext): Response {
  return ctx.reply({ message: "This World binds no managed Postgres to the supabase twin, so the project has no database to connect to: add a postgres service to the World's managed infrastructure" }, 503);
}
