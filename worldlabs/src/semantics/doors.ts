// The World's doors (architecture, "Doors, screens and the gap"): a World Labs account and the API key the developer
// portal gives it.
import type { HandlerContext } from '@volter/world-core';
import { ACCOUNT, sha256 } from './shared.ts';

/** An account and its API key: 40 letters and digits drawn from the World's secret. */
export async function accounts(ctx: HandlerContext): Promise<Response> {
  const account = await ctx.tenant(ACCOUNT, async (world) => String((await ctx.create(ACCOUNT, {
    email: world.members[0]!.toLowerCase(), name: world.label,
  }, 'account.create')).id));
  const key = await ctx.accountKey(`api-key:${account.id}`, '_api_key', {
    make: async () => {
      const id = await ctx.issue('_api_key');
      const value = ctx.crypto.base62From(await ctx.secret(`worldlabs-api-key:${id}`), 40);
      await ctx.record('_api_key', { account_id: account.id, name: ctx.deployment() || 'world-app', key_sha256: sha256(ctx, value) }, id);
      return id;
    },
    read: async (row) => {
      if (row.account_id !== account.id || row.deleted === true || row.revoked === true) return undefined;
      const value = ctx.crypto.base62From(await ctx.secret(`worldlabs-api-key:${row.id}`), 40);
      return row.key_sha256 === sha256(ctx, value) ? value : undefined;
    },
  });
  return Response.json({ account_id: account.id, api_key: key.secret }, { status: 201 });
}
