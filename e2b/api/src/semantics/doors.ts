// The World's doors (architecture, "Doors, screens and the gap"): an E2B team and its API key (a team is made on E2B's
// dashboard; the API's key operations need a signed-in team member's token), and a template the e2b CLI built
// (`e2b template build`, a build the World does not run), as the image the World's machine pool runs for its sandboxes.
import type { HandlerContext } from '@volter/world-core';
import { ENVD_VERSION, obj, sha256, TEAM, TEMPLATE } from './shared.ts';

const bad = (message: string, status = 400): Response => Response.json({ message }, { status });

/** A team, made once by its name, and its API key: `e2b_` and 40 hex digits drawn from the World's secret. */
export async function teams(ctx: HandlerContext): Promise<Response> {
  const account = await ctx.account();
  const name = `${String(obj(ctx.body).name ?? 'World team')}${account === 'default' ? '' : ` (${account})`}`;
  let team = ctx.rowsRaw(TEAM).find((t) => t.name === name && (t._world_account ?? 'default') === account);
  const keyOf = async (id: string): Promise<string> => `e2b_${sha256(ctx, await ctx.secret(`e2b-api-key:${id}`)).slice(0, 40)}`;
  if (!team) {
    const id = ctx.mint(TEAM);
    await ctx.record(TEAM, { name, _world_account: account, key_sha256: sha256(ctx, await keyOf(id)) }, id);
    team = ctx.row(TEAM, id)!;
  }
  return Response.json({ team_id: team.id, api_key: await keyOf(String(team.id)) }, { status: 201 });
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
