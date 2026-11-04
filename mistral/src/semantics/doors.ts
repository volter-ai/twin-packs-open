import type { HandlerContext } from '@volter/world-core';

// source: https://docs.mistral.ai/admin/identity-access/api-keys.md
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const organization = await ctx.tenant('_organization', async (world) => String((await ctx.create('_organization', {
    name: world.label, owner: world.members[0]!.toLowerCase(),
  }, 'organization.create')).id));
  const workspace = await ctx.deploymentObject(`workspace:${organization.id}`, '_workspace', async (deployment) =>
    String((await ctx.create('_workspace', { name: deployment || organization.name, organization_id: organization.id }, 'workspace.create')).id));
  const key = await ctx.accountKey(`api-key:${workspace.id}`, '_api_key', {
    make: async () => {
      const id = await ctx.issue('_api_key');
      const value = await ctx.secret(`mistral-app:${id}`);
      await ctx.record('_api_key', { name: ctx.deployment() || 'world-app', workspace_id: workspace.id, sha256: ctx.crypto.sha256(value) }, id);
      return id;
    },
    read: async (row) => {
      if (row.revoked === true || row.workspace_id !== workspace.id) return undefined;
      const value = await ctx.secret(`mistral-app:${row.id}`);
      return row.sha256 === ctx.crypto.sha256(value) ? value : undefined;
    },
  });
  return Response.json({ api_key: key.secret }, { status: 201 });
}
