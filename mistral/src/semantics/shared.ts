import type { HandlerContext } from '@volter/world-core';
export async function appKey(ctx: HandlerContext): Promise<string> {
  const account = await ctx.account();
  const existing = ctx.rowsRaw('_api_key').find(k => (k._account ?? 'default') === account && k.deleted !== true);
  const id = existing ? String(existing.id) : ctx.mint('_api_key');
  // Console keys have no documented syntax guarantee. This opaque throwaway is not a vendor-issued secret.
  const value = await ctx.secret(`mistral-app:${id}`);
  if (!existing) await ctx.record('_api_key', { _account: account, sha256: ctx.crypto.digest('sha256',value,'hex') },id);
  return value;
}
