// The World's doors (architecture, "Doors, screens and the gap"): a Tripo account opened on Tripo's platform, with its
// credits, and its API key.
import type { HandlerContext } from '@volter/world-core';
import { ACCOUNT, sha256 } from './shared.ts';

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

// A malformed World fixture is a door caller's error, not a refusal of Tripo's balance API.
function invalidCredits(): Response {
  return Response.json({ message: 'balance must be a number of credits, 0 or more' }, { status: 400 });
}

/** An account and its API key: `tsk_` and 40 letters and digits drawn from the World's secret. */
export async function accounts(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  const balance = b.balance === undefined ? 0 : Number(b.balance);
  if (!Number.isFinite(balance) || balance < 0) return invalidCredits();
  const account = await ctx.tenant(ACCOUNT, async (world) => String((await ctx.create(ACCOUNT, {
    email: world.members[0]!.toLowerCase(), name: world.label, balance, frozen: 0,
  }, 'account.create')).id));
  const key = await ctx.accountKey(`api-key:${account.id}`, '_api_key', {
    make: async () => {
      const id = await ctx.issue('_api_key');
      const value = `tsk_${ctx.crypto.base62From(await ctx.secret(`tripo-api-key:${id}`), 40)}`;
      await ctx.record('_api_key', { account_id: account.id, name: ctx.deployment() || 'world-app', key_sha256: sha256(ctx, value) }, id);
      return id;
    },
    read: async (row) => {
      if (row.account_id !== account.id || row.deleted === true || row.revoked === true) return undefined;
      const value = `tsk_${ctx.crypto.base62From(await ctx.secret(`tripo-api-key:${row.id}`), 40)}`;
      return row.key_sha256 === sha256(ctx, value) ? value : undefined;
    },
  });
  return Response.json({ account_id: account.id, api_key: key.secret, balance: account.balance }, { status: 201 });
}
