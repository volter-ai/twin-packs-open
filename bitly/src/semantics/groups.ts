import type { HandlerContext } from '@volter/world-core';
import { account, badRequest, group, missing } from './shared.ts';

// source: spec:getGroupTags "tags currently used in the specified group. Maximum 1000"
export async function getGroupTags(ctx: HandlerContext): Promise<Response> {
  if (!group(ctx)) return missing();
  const tags = ctx.rowsRaw('BitlinkBody').filter(b => b._account === account(ctx) && b._group === ctx.call.params.group_guid)
    .flatMap(b => (b.tags ?? []) as string[]);
  return Response.json({ tags: [...new Set(tags)].slice(0, 1000) });
}

// source: spec:getBitlinksByGroup "paginated collection of Bitlinks for a group"
export async function getBitlinksByGroup(ctx: HandlerContext): Promise<Response> {
  if (!group(ctx)) return missing();
  const p = { ...ctx.params, ...ctx.call.params };
  const size = Number(p.size ?? 50);
  // Where the documentation stops: malformed pagination is refused with the vendor's BAD_REQUEST envelope; local page cap is 1000.
  if (!Number.isInteger(size) || size < 1 || size > 1000) return badRequest();
  // source: spec:/components/parameters/Archived "Whether or not to include archived resources"
  const archived = String(p.archived ?? 'off');
  if (!['on', 'off', 'both'].includes(archived)) return badRequest();
  // source: spec:/components/parameters/CreatedBefore "integer unix epoch"
  const before = p.created_before === undefined ? Infinity : Number(p.created_before);
  const after = p.created_after === undefined ? -Infinity : Number(p.created_after);
  if (Number.isNaN(before) || Number.isNaN(after)) return badRequest();
  // source: spec:getBitlinksByGroup "newest entries first"
  let rows = ctx.rowsRaw('BitlinkBody').filter(b => b._account === account(ctx) && b._group === p.group_guid)
    .reverse().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  // source: spec:/components/parameters/Archived "off"
  rows = rows.filter(b => archived === 'both' || Boolean(b.archived) === (archived === 'on'));
  // source: spec:/components/parameters/CreatedAfter "Timestamp"
  rows = rows.filter(b => Date.parse(String(b.created_at)) / 1000 < before && Date.parse(String(b.created_at)) / 1000 > after);
  // source: spec:/components/parameters/Query "value that you would like to search"
  if (p.query !== undefined) rows = rows.filter(b => `${b.title} ${b.long_url} ${b.id}`.toLowerCase().includes(String(p.query).toLowerCase()));
  // source: spec:/components/parameters/HostnamePathQuery "case-insensitive"
  if (p.hostname_path_query !== undefined) rows = rows.filter(b => String(b.id).toLowerCase().includes(String(p.hostname_path_query).toLowerCase()));
  // source: spec:/components/parameters/Tags "Filter by given tags"
  if (p.tags !== undefined) { const tags = Array.isArray(p.tags) ? p.tags : [p.tags]; rows = rows.filter(b => tags.every(t => (b.tags as unknown[]).includes(t))); }
  // source: spec:/components/parameters/EncodingLogin "authenticated user that created"
  if (p.encoding_login !== undefined) { const logins = Array.isArray(p.encoding_login) ? p.encoding_login : [p.encoding_login]; rows = rows.filter(b => logins.includes(b.created_by)); }
  // source: spec:/components/parameters/Deeplinks "Filter to only Bitlinks that contain deeplinks"
  if (p.deeplinks !== undefined && p.deeplinks !== 'both') rows = rows.filter(b => ((b.deeplinks as unknown[]).length > 0) === (p.deeplinks === 'on'));
  // source: spec:/components/parameters/FilterCustomBitlink "both"
  if (p.custom_bitlink !== undefined && p.custom_bitlink !== 'both') rows = rows.filter(b => ((b.custom_bitlinks as unknown[]).length > 0) === (p.custom_bitlink === 'on'));
  // source: spec:/components/parameters/SearchAfter "only use response from API as input value"
  // Where the documentation stops: opaque local cursors bind the filtered result set and last subject.
  const signature = ctx.crypto.sha256(JSON.stringify([p.group_guid, archived, before === Infinity ? null : before, after === -Infinity ? null : after, p.query, p.hostname_path_query, p.tags, p.encoding_login, p.deeplinks, p.custom_bitlink]));
  const cursor = (id: string) => ctx.crypto.sha256(`${signature}:${id}`);
  const start = p.search_after === undefined ? 0 : rows.findIndex(b => cursor(String(b.id)) === p.search_after) + 1;
  if (p.search_after !== undefined && start === 0) return badRequest();
  const page = rows.slice(start, start + size);
  const next = start + size < rows.length ? cursor(String(page.at(-1)!.id)) : '';
  const query = new URL(ctx.call.request.url).searchParams;
  query.set('size', String(size)); query.set('search_after', next);
  // source: spec:/components/schemas/BitlinksPagination "search_after"
  return Response.json({ links: page.map(b => ctx.render(b)), pagination: { size, search_after: next, next: next ? `https://api-ssl.bitly.com/v4/groups/${p.group_guid}/bitlinks?${query}` : '' } });
}
