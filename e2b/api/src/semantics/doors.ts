// The World's doors (architecture, "Doors, screens and the gap"): an E2B team and its API key (a team is made on E2B's
// dashboard; the API's key operations need a signed-in team member's token), and a template the e2b CLI built
// (`e2b template build`, a build the World does not run), as the image the World's machine pool runs for its sandboxes.
import type { HandlerContext } from '@volter/world-core';
import { ENVD_VERSION, obj, projectKey, readProjectKey, TEAM, TEMPLATE } from './shared.ts';

const bad = (message: string, status = 400): Response => Response.json({ message }, { status });

/** A team, made once by its name, and its API key: `e2b_` and 40 hex digits drawn from the World's secret. */
export async function teams(ctx: HandlerContext): Promise<Response> {
  const workspace = await ctx.tenant('_workspace', async (organization) => String((await ctx.create('_workspace', {
    name: organization.label, owner: organization.members[0]!.toLowerCase(),
  }, 'workspace.create')).id));
  const account = await ctx.account();
  const name = obj(ctx.body).name;
  const team = await ctx.deploymentObject(`project:${workspace.id}:${typeof name === 'string' ? name : ''}`, TEAM, async (deployment) => {
    const existing = !deployment && typeof name === 'string' ? ctx.rowsRaw(TEAM).find((row) => row.name === name && (row._world_account ?? 'default') === account) : undefined;
    if (existing) {
      await ctx.record(TEAM, { workspaceId: workspace.id, _default: account === 'default' }, String(existing.id));
      return String(existing.id);
    }
    return String((await ctx.create(TEAM, { name: typeof name === 'string' ? name : deployment || (account === 'default' ? 'World team' : workspace.name),
      workspaceId: workspace.id, _world_account: account, _default: account === 'default' && !deployment,
    }, 'project.create')).id);
  });
  const key = await ctx.accountKey(`api-key:${team.id}`, '_api_key', {
    make: () => projectKey(ctx, team),
    read: (row) => row._team === team.id ? readProjectKey(ctx, row) : Promise.resolve(undefined),
  });
  return Response.json({ team_id: team.id, api_key: key.secret }, { status: 201 });
}

/** A template built with the e2b CLI, stored as the API lists it (Template), with the image the World runs for it. */
export async function templates(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const team = ctx.rowsRaw(TEAM).find((t) => t.name === String(b.team ?? 'World team'));
  if (!team) return bad('no such team', 404);
  if (typeof b.alias !== 'string' || !/^[a-z0-9-]+$/.test(b.alias)) return bad('an alias is lowercase letters, digits and dashes');
  if (typeof b.image !== 'string' || !b.image) return bad('a template needs the image the World runs for it');
  const id = ctx.mint(TEMPLATE);
  await ctx.write(TEMPLATE, id, {
    templateID: id, buildID: ctx.mint('_build'), cpuCount: Number(b.cpuCount ?? 2), memoryMB: Number(b.memoryMB ?? 512), diskSizeMB: Number(b.diskSizeMB ?? 512),
    public: false, aliases: [b.alias], names: [b.alias], createdAt: ctx.occurredAt, updatedAt: ctx.occurredAt, createdBy: null,
    lastSpawnedAt: null, spawnCount: 0, buildCount: 1, envdVersion: String(b.envdVersion ?? ENVD_VERSION), buildStatus: 'ready',
    _image: b.image, _team: team.id, ...(Array.isArray(b.command) ? { _command: b.command.map(String) } : {}),
  }, 'template.build');
  return Response.json({ templateID: id, alias: b.alias }, { status: 201 });
}
