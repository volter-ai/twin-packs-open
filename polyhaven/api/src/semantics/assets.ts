import type { HandlerContext } from '@volter/world-core';
import { assets, assetView, typeOf as typeOfAsset, requestedType, listed, inAll, phText } from './shared.ts';

// source: spec:get_assets "A list of assets, including their individual metadata."
export async function get_assets(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  // source: spec:get_assets "(e.g. `/assets?t=hdris&c=outdoor`)"
  const type = requestedType(q.get('type') ?? q.get('t'));
  if (type instanceof Response) return type;
  // source: spec:get_assets "Only assets that match all categories specified will be included."
  const wanted = listed(q.get('categories') ?? q.get('c'));
  // source: spec:get_assets "Bad request, e.g. unsupported asset type or unknown category"
  // Documentation gives the error class and text envelope, not an exact unknown-category sentence.
  const known = new Set(assets(ctx).flatMap((a) => a.categories as string[] ?? []));
  if (wanted.some((category) => !known.has(category))) return phText(400, 'Unknown category');
  const found = assets(ctx).filter((a) => (type === 'all' || typeOfAsset(ctx, a) === type) && inAll(a, wanted));
  return Response.json(Object.fromEntries(found.map((a) => [String(a.id), assetView(ctx, a)])));
}

