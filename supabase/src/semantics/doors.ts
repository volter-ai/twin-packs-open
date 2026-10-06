// The twin's own door under `/_twin/` (docs/contributing/architecture.md, "Doors, screens and the gap"): the account's
// sign-up, the one bootstrap (the descriptor's credentialDoor). No API call is possible before it, and no demanded
// application calls the Management API, so the door makes the World's project, as the dashboard's New project makes one,
// and answers what the application connects with: the project's Postgres database, which in a World is the World's own
// managed Postgres (architecture.md, managed infrastructure).
import type { HandlerContext } from '@volter/world-core';

/** POST /_twin/app-credentials: what the World's application holds, as the runtime issues it at every boot, the same each
 *  time: the World's project `world` (made the first time) and its database's URL. A World with no managed Postgres bound
 *  has no database to hand out: 503, as every use of an unbound database is refused. */
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  if (!ctx.engine.bound || ctx.engine.url === undefined) return unbound(ctx);
  let ref = ctx.rowsRaw('_project').find((p) => p.name === 'world')?.ref as string | undefined;
  if (ref === undefined) {
    // a project's ref: twenty lowercase letters
    // source: spec:/components/schemas/V1ProjectResponse_Output/properties/ref "Project ref"
    ref = ctx.crypto.lettersFrom('project:world', 20);
    await ctx.record('_project', { ref, name: 'world', created_at: ctx.occurredAt }, `_project_${ref}`);
  }
  // source: https://supabase.com/docs/guides/functions/secrets "The URL for your Postgres database. Use it to connect directly to your database."
  return ctx.reply({ ref, database_url: ctx.engine.url }, 201);
}

/** A World with no managed Postgres bound: the project has no database to hand out. */
function unbound(ctx: HandlerContext) {
  return ctx.reply({ message: "This World binds no managed Postgres to the supabase twin, so the project has no database to connect to: add a postgres service to the World's managed infrastructure" }, 503);
}
