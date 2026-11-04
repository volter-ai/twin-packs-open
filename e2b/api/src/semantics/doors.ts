// The World's doors (architecture, "Doors, screens and the gap"): an E2B team and its API key (a team is made on E2B's
// dashboard; the API's key operations need a signed-in team member's token), and a template the e2b CLI built
// (`e2b template build`, a build the World does not run), as the image the World's machine pool runs for its sandboxes.
import type { HandlerContext } from '@volter/world-core';
import { ENVD_VERSION, obj, projectFor, projectKey, readProjectKey, teamOf, TEMPLATE } from './shared.ts';

const bad = (message: string, status = 400): Response => Response.json({ message }, { status });

/** The selected deployment's project and its API key: `e2b_` and 40 hex digits drawn from the World's secret. */
export async function teams(ctx: HandlerContext): Promise<Response> {
  const name = obj(ctx.body).name;
  const team = await projectFor(ctx, typeof name === 'string' ? name : undefined);
  const key = await ctx.accountKey(`api-key:${team.id}`, '_api_key', {
    make: () => projectKey(ctx, team),
    read: (row) => row._team === team.id ? readProjectKey(ctx, row) : Promise.resolve(undefined),
  });
  return Response.json({ team_id: team.id, api_key: key.secret }, { status: 201 });
}

/** A template built with the e2b CLI, stored as the API lists it (Template), with the image the World runs for it. */
export async function templates(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  if (typeof b.alias !== 'string' || !/^[a-z0-9-]+$/.test(b.alias)) return bad('an alias is lowercase letters, digits and dashes');
  if (typeof b.image !== 'string' || !b.image) return bad('a template needs the image the World runs for it');
  const team = ctx.call.request.headers.has('x-api-key') ? teamOf(ctx) : await projectFor(ctx, typeof b.team === 'string' ? b.team : undefined);
  if (!team) return bad('Invalid API key', 401);
  if (b.team !== undefined && b.team !== team.name) return bad('no such team', 404);
  const id = ctx.mint(TEMPLATE);
  await ctx.write(TEMPLATE, id, {
    templateID: id, buildID: ctx.mint('_build'), cpuCount: Number(b.cpuCount ?? 2), memoryMB: Number(b.memoryMB ?? 512), diskSizeMB: Number(b.diskSizeMB ?? 512),
    public: false, aliases: [b.alias], names: [b.alias], createdAt: ctx.occurredAt, updatedAt: ctx.occurredAt, createdBy: null,
    lastSpawnedAt: null, spawnCount: 0, buildCount: 1, envdVersion: String(b.envdVersion ?? ENVD_VERSION), buildStatus: 'ready',
    _image: b.image, _team: team.id, ...(Array.isArray(b.command) ? { _command: b.command.map(String) } : {}),
  }, 'template.build');
  return Response.json({ templateID: id, alias: b.alias }, { status: 201 });
}
