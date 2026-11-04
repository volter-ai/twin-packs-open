// The World's doors (architecture, "Doors, screens and the gap"): Fly's tokens, as `fly tokens create` makes them (an
// organization token, or a deploy token scoped to one app), and a machine's process exiting on its own.
import type { HandlerContext } from '@volter/world-core';
import { makeApp, APP, exitedMachine, MACHINE, obj, sha256, TOKEN } from './shared.ts';

const bad = (message: string, status = 400): Response => Response.json({ message }, { status });

/** A token for an organization, or a deploy token for one of its apps: `fo1_` or `fm2_` and 43 characters drawn from
 *  the World's secret, kept by its SHA-256 and answered again for the same ask. */
export async function tokens(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  if (b.account !== undefined || b.deployment !== undefined) return deploymentToken(ctx);
  const org = typeof b.org === 'string' && /^[a-z0-9-]+$/.test(b.org) ? b.org : undefined;
  if (!org) return bad('org must be an organization slug');
  const app = typeof b.app === 'string' ? b.app : undefined;
  if (app !== undefined && !ctx.rowsRaw(APP).some((a) => a.deleted !== true && a.name === app && a._org === org)) return bad(`no app ${app} in ${org}`);
  const label = `fly-token:${org}:${app ?? ''}`;
  const value = `${app ? 'fm2_' : 'fo1_'}${(await ctx.secret(label)).replace(/[^A-Za-z0-9]/g, '').slice(0, 43)}`;
  if (!ctx.rowsRaw(TOKEN).some((t) => t.sha256 === sha256(ctx, value))) await ctx.record(TOKEN, { org, app: app ?? null, sha256: sha256(ctx, value) }, await ctx.issue(TOKEN));
  return Response.json({ token: value, org, app: app ?? null }, { status: 201 });
}

/** A machine's process exits (a worker that drained its queue): it is stopped, and destroyed with auto_destroy. */
export async function exit(ctx: HandlerContext): Promise<Response> {
  const m = ctx.row(MACHINE, String(ctx.call.params.id));
  if (!m) return bad('no machine of that id', 404);
  return exitedMachine(ctx, m);
}

async function deploymentToken(ctx: HandlerContext): Promise<Response> {
  try {
    const organizationId = await ctx.account();
    const org = await ctx.tenant('_organization', async (organization) => {
      const rule = { max: Number.MAX_SAFE_INTEGER, lower: true, allowed: /[a-z0-9-]/ };
      const label = organization.id;
      const create = (suffixed: boolean) => {
        const name = ctx.vendorName(label, rule, { suffixed, identity: organization.id });
        return ctx.createUnique('_organization', { org_slug: name, name: organization.label, owner: organization.members[0]! }, 'organization.create', { id: name });
      };
      let made = await create(false);
      if (!made.created) made = await create(true);
      if (!made.created) throw bad(`organization slug is taken (${organization.id})`, 409);
      return String(made.row.org_slug);
    });
    const app = await ctx.deploymentObject(`app:${String(org.id)}`, APP, async (deployment) => {
      const label = deployment || 'world';
      const identity = deployment ? `${organizationId}/${deployment}` : organizationId;
      const rule = { max: 63, lower: true, allowed: /[a-z0-9-]/, first: /[a-z0-9]/ };
      const name = label.length < 2 ? `app-${label}` : label;
      let made = await makeApp(ctx, ctx.vendorName(name, rule, { identity }), String(org.id), 'default');
      if (made instanceof Response) made = await makeApp(ctx, ctx.vendorName(name, rule, { suffixed: true, identity }), String(org.id), 'default');
      if (made instanceof Response) throw Response.json({ error: `app name is already taken (${identity})` }, { status: 422 });
      return String(made.id);
    });
    const key = await ctx.accountKey('deploy-token', TOKEN, {
      make: async () => {
        const id = await ctx.issue(TOKEN);
        const label = `fly-deploy-token:${id}`;
        const value = `fm2_${(await ctx.secret(label)).replace(/[^A-Za-z0-9]/g, '').slice(0, 43)}`;
        await ctx.record(TOKEN, { org: org.id, app: app.name, label, sha256: sha256(ctx, value) }, id);
        return id;
      },
      read: async (row) => {
        if (row.org !== org.id || row.app !== app.name || typeof row.label !== 'string') return undefined;
        const value = `fm2_${(await ctx.secret(row.label)).replace(/[^A-Za-z0-9]/g, '').slice(0, 43)}`;
        return sha256(ctx, value) === row.sha256 ? value : undefined;
      },
    });
    return Response.json({ token: key.secret, org: org.id, app: app.name }, { status: 201 });
  } catch (error) { if (error instanceof Response) return error; throw error; }
}
