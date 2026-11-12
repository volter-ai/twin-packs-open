// The v2 API's reads: the search (/full_json: assets filtered by type and keywords, ordered, paged) and the download
// redirect (/get: a zip's name to its place on the download host).
import type { HandlerContext } from '@volter/world-core';
import { ASSET, listOf, ORDERS } from './shared.ts';

// source: https://docs.ambientcg.com/api/v2/full_json/ "It delivers metadata and downloadable files for all assets in a JSON-format."
export async function fullJson(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  // source: https://docs.ambientcg.com/api/v2/full_json/ "Multiple values can be concatenated using a comma which will be interpreted as a logical OR."
  // source: https://docs.ambientcg.com/api/v2/full_json/ "Any invalid value will lead to zero results."
  const types = listOf(q.get('type'), /,/);
  // source: https://docs.ambientcg.com/api/v2/full_json/ "A list of keywords, separated by commas or spaces."
  // Where the documentation stops: the twin finds an asset when every keyword is its id or one of its tags or name's words
  const words = listOf(q.get('q'), /[,\s]+/).map((w) => w.toLowerCase());
  // source: https://docs.ambientcg.com/api/v2/full_json/ "Non-existent id s will be ignored."
  const ids = listOf(q.get('id'), /,/);
  // source: https://docs.ambientcg.com/api/v2/full_json/ "Not setting the parameter, setting it to an empty string or any other value will be interpreted as Latest"
  const sort = q.get('sort') && q.get('sort')! in ORDERS ? q.get('sort')! : 'Latest';
  // source: spec:fullJson "Method used to create the asset."
  const methods = listOf(q.get('method'), /,/);
  // source: spec:fullJson "Returns all assets released on one specific day."
  const date = q.get('date');
  const found = ctx.rows(ASSET).filter((a) => {
    const terms = new Set([String(a.assetId).toLowerCase(), ...(a.tags as string[] ?? []).map((t) => t.toLowerCase()), ...String(a.displayName).toLowerCase().split(/\s+/)]);
    return (!types.length || types.includes(String(a.dataType))) && (!ids.length || ids.includes(String(a.assetId))) && (!methods.length || methods.includes(String(a.creationMethod))) && (!date || String(a.releaseDate).startsWith(date)) && words.every((w) => terms.has(w));
  }).sort(ORDERS[sort]!);
  // source: https://docs.ambientcg.com/api/v2/full_json/ "Integer between 1 and 250."
  const limit = q.get('limit') ? Math.min(250, Math.max(1, Math.trunc(Number(q.get('limit'))) || 1)) : undefined;
  // source: https://docs.ambientcg.com/api/v2/full_json/ "The offset will only take effect if a limit (see above) has been set."
  const offset = limit !== undefined ? Math.max(0, Math.trunc(Number(q.get('offset') ?? 0)) || 0) : 0;
  const page = limit === undefined ? found : found.slice(offset, offset + limit);
  const pageUrl = (at: number): string => {
    const u = new URL(`https://ambientcg.com/api/v2/full_json?${q}`);
    u.searchParams.set('offset', String(at));
    return u.toString();
  };
  return Response.json({
    searchQuery: {
      forceSpecificAssetId: false, category: [], assetId: ids, dataType: types, creationMethod: methods.length ? methods : null, queryString: q.get('q') ?? '', sort,
      createdUsingAssetId: null, basedOnAssetId: null, variationsOfAssetId: null, limit: limit ?? null, offset,
    },
    numberOfResults: found.length,
    // source: recording:2026-10-01-terminal-page.json "topLevelKeys"
    // The terminal response has no next-page key; retain a link only while results remain.
    ...(limit !== undefined && offset + limit < found.length ? { nextPageHttp: pageUrl(offset + limit) } : {}),
    currentPageHttp: pageUrl(offset),
    foundAssets: page,
  });
}

