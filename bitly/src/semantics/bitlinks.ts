import type { HandlerContext } from '@volter/world-core';
import { account, badRequest, missing } from './shared.ts';

// source: spec:createFullBitlink "Converts a long url to a Bitlink"
export async function createFullBitlink(ctx: HandlerContext): Promise<Response> {
  const checked = ctx.fields(ctx.params);
  if ('refused' in checked) return checked.refused;
  const p = checked.fields;
  const email = account(ctx);
  const selected = ctx.rowsRaw('Group').find(g => g._account === email && (p.group_guid === undefined || g.id === p.group_guid));
  if (!selected) return missing();
  // source: spec:/components/schemas/FullShorten "URL to be shortened"
  if (typeof p.long_url !== 'string' || !/^https?:\/\//i.test(p.long_url)) return badRequest();
  // source: spec:/components/schemas/FullShorten "bit.ly"
  const domain = String(p.domain ?? 'bit.ly');
  // source: spec:createFullBitlink "DNS_CONFIGURATION_ERROR"
  if (domain !== 'bit.ly' && !(selected.bsds as string[]).includes(domain)) return Response.json({ message: 'DNS_CONFIGURATION_ERROR' }, { status: 400 });
  // Where the documentation stops: identical URL/domain/group creation is deterministic; force_new_link allocates another subject.
  const existing = ctx.rowsRaw('BitlinkBody').find(b => b._account === email && b._group === selected.id && b.long_url === p.long_url && String(b.id).startsWith(`${domain}/`));
  if (existing && p.force_new_link !== true && p.force_new_link !== 'true') return Response.json(ctx.render(existing), { status: 200 });
  // source: spec:/components/parameters/Bitlink "domain and hash"
  const id = `${domain}/${await ctx.issue('_bitlink_id')}`;
  // source: spec:/components/schemas/BitlinkUpdate "created_at"
  const row = await ctx.write('BitlinkBody', id, {
    id, link: `https://${id}`, long_url: p.long_url, title: String(p.title ?? ''), tags: p.tags ?? [],
    archived: false, created_at: ctx.occurredAt, created_by: email,
    custom_bitlinks: [], deeplinks: [], references: { group: `https://api-ssl.bitly.com/v4/groups/${selected.id}` },
    _group: selected.id, _account: email,
  }, 'createFullBitlink');
  return Response.json(row, { status: 201 });
}
