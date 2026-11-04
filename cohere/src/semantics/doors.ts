// The World's doors: what Cohere's dashboard (API Keys) does.
//
//   POST /_twin/app-credentials     the application's key (the descriptor's credentialDoor), the same every boot
import type { HandlerContext } from '@volter/world-core';

const KEY = '_api_key';
// Where the documentation stops: the key's opaque length is a World choice, not a vendor guarantee.
// A World key is 40 letters and digits; the World keeps its SHA-256 and draws it from a held secret.
const keyValue = async (ctx: Pick<HandlerContext, 'secret'>, label: string): Promise<string> =>
  `${await ctx.secret(label)}${await ctx.secret(`${label}:2`)}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 40);

// source: https://docs.cohere.com/docs/rate-limits "You can create a trial or production key on the API keys page"
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const organization = await ctx.tenant('_organization', async (world) => {
    const owner = await ctx.createUnique('_owner', { email: world.members[0]!.toLowerCase() }, 'owner.create', { input: 'omit' });
    return String((await ctx.create('_organization', { name: world.label, owner_id: owner.row.id }, 'organization.create')).id);
  });
  const key = await ctx.accountKey(`api-key:${organization.id}`, KEY, {
    make: async () => {
      const id = await ctx.issue(KEY);
      const label = `cohere-api-key:${id}`;
      const value = await keyValue(ctx, label);
      await ctx.record(KEY, { name: ctx.deployment() || 'world-app', label, organization_id: organization.id, owner_id: organization.owner_id,
        key_type: 'trial', created: ctx.occurredAt, sha256: ctx.crypto.sha256(value) }, id);
      return id;
    },
    read: async (row) => {
      if (row.organization_id !== organization.id || row.owner_id !== organization.owner_id || row.revoked === true || typeof row.label !== 'string') return undefined;
      const value = await keyValue(ctx, row.label);
      return ctx.crypto.sha256(value) === row.sha256 ? value : undefined;
    },
  });
  return Response.json({ api_key: key.secret }, { status: 201 });
}
