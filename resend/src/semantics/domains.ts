// Sending domains: added (its records to set at the owner's DNS host), read, listed, verified and removed, each the
// team's own. Verifying marks it pending; Resend then finds its records at the owner's DNS host (./clock.ts).
import type { HandlerContext } from '@volter/world-core';
import { createDomain, DOMAIN, domainView, invalid, notFound, pageOf, type Row, recordsOf, teamOf, verifyDomain } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
const view = domainView;
const own = (ctx: HandlerContext): Row | undefined => ctx.rowsRaw(DOMAIN).find((d) => d.id === ctx.call.params.domain_id && d._team === teamOf(ctx) && d.deleted !== true);

/** POST /domains */
// source: spec:domains/create "Create a new domain"
export async function domains_create(ctx: HandlerContext): Promise<Response> {
  return createDomain(ctx, teamOf(ctx), bodyOf(ctx));
}

/** GET /domains/{domain_id} */
// source: spec:domains/get "Retrieve a single domain"
export async function domains_get(ctx: HandlerContext): Promise<Response> {
  const d = own(ctx);
  return d ? Response.json(view(ctx.own(d))) : notFound('Domain');
}

/** GET /domains: the team's domains, each without its records, newest first, paged. */
// source: spec:domains/list "Retrieve a list of domains"
export async function domains_list(ctx: HandlerContext): Promise<Response> {
  const mine = ctx.rowsRaw(DOMAIN).filter((d) => d._team === teamOf(ctx) && d.deleted !== true).reverse();
  return pageOf(ctx, mine, (d) => { const { records: _r, object: _o, tracking_subdomain: _t, ...rest } = view(ctx.own(d)); return rest; });
}

/** PATCH /domains/{domain_id}: its open and click tracking, its TLS, its tracking subdomain and its capabilities; the
 *  domain's id answered. A tracking subdomain changed adds or moves its Tracking CNAME among the records. */
// source: spec:domains/update "Update an existing domain"
export async function domains_update(ctx: HandlerContext): Promise<Response> {
  const d = own(ctx);
  if (!d) return notFound('Domain');
  const p = bodyOf(ctx);
  // source: spec:/components/schemas/UpdateDomainOptions/properties/tls "enforced | opportunistic."
  if (p.tls !== undefined && p.tls !== 'enforced' && p.tls !== 'opportunistic') return invalid('Invalid `tls`. Possible values are enforced | opportunistic.');
  for (const k of ['open_tracking', 'click_tracking'] as const) if (p[k] !== undefined && typeof p[k] !== 'boolean') return invalid(`Invalid \`${k}\`: expected a boolean.`);
  const caps = { ...(d.capabilities as Row), ...((p.capabilities ?? {}) as Row) };
  const tracking = typeof p.tracking_subdomain === 'string' && p.tracking_subdomain ? p.tracking_subdomain : (d.tracking_subdomain as string | undefined);
  const records = (d.records as Row[]).filter((r) => r.record !== 'Tracking' && r.record !== 'Receiving');
  const fresh = recordsOf(String(d.name), String(d.region), '', tracking, caps.receiving === 'enabled').filter((r) => r.record === 'Tracking' || r.record === 'Receiving')
    .map((r) => (d.records as Row[]).find((h) => h.record === r.record && h.name === r.name) ?? r);
  await ctx.write(DOMAIN, String(d.id), {
    ...(typeof p.open_tracking === 'boolean' ? { open_tracking: p.open_tracking } : {}),
    ...(typeof p.click_tracking === 'boolean' ? { click_tracking: p.click_tracking } : {}),
    ...(p.tls !== undefined ? { tls: p.tls } : {}),
    ...(tracking ? { tracking_subdomain: tracking } : {}),
    capabilities: caps, records: [...records, ...fresh],
  }, 'domain.update');
  return Response.json({ object: 'domain', id: d.id });
}

/** POST /domains/{domain_id}/verify: Resend starts checking its records (pending); a verified domain stays verified. */
// source: spec:domains/verify "Verify an existing domain"
export async function domains_verify(ctx: HandlerContext): Promise<Response> {
  const d = own(ctx);
  return d ? verifyDomain(ctx, d) : notFound('Domain');
}

/** DELETE /domains/{domain_id} */
// source: spec:domains/remove "Remove an existing domain"
export async function domains_remove(ctx: HandlerContext): Promise<Response> {
  const d = own(ctx);
  if (!d) return notFound('Domain');
  await ctx.remove(DOMAIN, String(d.id), 'domain.delete');
  return Response.json({ object: 'domain', id: d.id, deleted: true });
}
