import type { HandlerContext } from '@volter/world-core';
import { FONT, CATALOG, googleError } from './shared.ts';

// source: spec:webfonts.webfonts.list "Retrieves the list of fonts currently served by the Google Fonts Developer API."
export async function webfonts_webfonts_list(ctx: HandlerContext): Promise<Response> {
  const query = new URL(ctx.call.request.url).searchParams;
  // Where this scope stops: the demand selects the default static-TTF catalog.
  // VF/WOFF2/FAMILY_TAGS need an independently published capability snapshot.
  if (query.getAll('capability').some(c => c && c !== 'CAPABILITY_UNSPECIFIED'))
    return googleError(400, 'This published catalog does not provide the requested capability');
  const published = ctx.row(CATALOG, 'published');
  const names = Array.isArray(published?.families) ? published.families : [];
  let items = names.flatMap(family => {
    const row = ctx.row(FONT, String(published?.fingerprint) + ':' + String(family));
    return row ? [ctx.own(row)] : [];
  });
  for (const field of ['family', 'subset', 'category']) {
    const asked = query.getAll(field);
    if (asked.length) items = items.filter(item => asked.some(value => field === 'subset'
      ? Array.isArray(item.subsets) && item.subsets.includes(value) : item[field] === value));
  }
  // source: https://developers.google.com/fonts/docs/developer_api
  const sort = (query.get('sort') ?? 'alpha').toLowerCase();
  if (!['sort_undefined', 'alpha', 'date', 'popularity', 'style', 'trending'].includes(sort))
    return googleError(400, 'Invalid sort value');
  if (sort === 'alpha' || sort === 'sort_undefined') items.sort((a,b) => String(a.family).localeCompare(String(b.family), 'en'));
  else if (sort === 'date') items.sort((a,b) => String(b.lastModified).localeCompare(String(a.lastModified)));
  else if (sort === 'style') items.sort((a,b) => (Array.isArray(b.variants) ? b.variants.length : 0) - (Array.isArray(a.variants) ? a.variants.length : 0));
  // Popularity/trending retain the publisher's catalog order. The reference
  // snapshot is one actual font, not a manufactured global popularity ranking.
  return Response.json({ kind: 'webfonts#webfontList', items });
}
