import type { HandlerContext } from '@volter/world-core';
import { assets, typeOf as typeOfAsset, TYPES, requestedType, listed, inAll } from './shared.ts';

// source: spec:get_categories_type "The list of categories also show the number of assets inside them."
export async function get_categories_type(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const named = String(ctx.call.params.type);
  const type = requestedType(named);
  if (type instanceof Response) return type;
  // source: spec:get_categories_type "only returns categories with assets that are also in these categories"
  const within = listed(q.get('in'));
  const pool = assets(ctx).filter((a) => inAll(a, within));
  const counts = new Map<string, number>();
  const count = (k: string): void => { counts.set(k, (counts.get(k) ?? 0) + 1); };
  // source: spec:get_categories_type "If `all` is passed as the {type}, then rather than returning categories, it simply returns a list of the asset types instead, with their asset counts."
  if (type === 'all') for (const a of pool) count(Object.keys(TYPES).find((t) => TYPES[t] === typeOfAsset(ctx, a))!);
  // Where the documentation stops: a category the request names in `in` is not counted again (api.polyhaven.com, read 2026-09-30)
  else for (const a of pool.filter((x) => typeOfAsset(ctx, x) === type)) for (const c of (a.categories as string[] | undefined) ?? []) if (!within.includes(c)) count(c);
  // Where the documentation stops: most assets first, as api.polyhaven.com answers; the twin orders a tie by name
  const ordered = [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
  // source: spec:get_categories_type "If this is not specified, then an `all` \"category\" is also returned, with the count of all assets of the specified type."
  const all = within.length ? [] : [['all', type === 'all' ? pool.length : pool.filter((a) => typeOfAsset(ctx, a) === type).length] as const];
  return Response.json(Object.fromEntries([...all, ...ordered]));
}
