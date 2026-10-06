// Sending domains: added (its records to set at the owner's DNS host), read, listed, verified and removed, each the
// team's own. Verifying marks it pending; Resend then finds its records at the owner's DNS host (./clock.ts).
import type { HandlerContext } from '@volter/world-core';
import { DOMAIN, invalid, notFound, pageOf, recordsOf, type Row, stamp, teamOf } from './shared.ts';

const REGIONS = ['us-east-1', 'eu-west-1', 'sa-east-1', 'ap-northeast-1'];
const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
const view = (d: Row): Row => ({ object: 'domain', id: d.id, name: d.name, status: d.status, created_at: d.created_at, region: d.region, open_tracking: d.open_tracking, click_tracking: d.click_tracking, ...(d.tracking_subdomain ? { tracking_subdomain: d.tracking_subdomain } : {}), capabilities: d.capabilities, records: d.records });
const own = (ctx: HandlerContext): Row | undefined => ctx.rowsRaw(DOMAIN).find((d) => d.id === ctx.call.params.domain_id && d._team === teamOf(ctx) && d.deleted !== true);

/** POST /domains */
// source: spec:domains/create "Create a new domain"
export async function domains_create(ctx: HandlerContext): Promise<Response> {
  const p = bodyOf(ctx);
  const name = typeof p.name === 'string' ? p.name.trim().toLowerCase() : '';
  if (!name) return invalid('Missing `name` field.', 422, 'missing_required_field');
  const region = typeof p.region === 'string' ? p.region : 'us-east-1';
  if (!REGIONS.includes(region)) return invalid(`Invalid \`region\`. Possible values are ${REGIONS.join(' | ')}.`);
  // source: https://resend.com/docs/api-reference/errors "domain has been registered already."
  if (ctx.rowsRaw(DOMAIN).some((d) => d.name === name && d.deleted !== true)) return invalid(`The ${name} domain has been registered already.`, 403);
  const caps = (p.capabilities ?? {}) as Row;
  const receiving = caps.receiving === 'enabled';
  // source: https://resend.com/docs/api-reference/domains/create-domain "tracking_subdomain"
  const tracking = typeof p.tracking_subdomain === 'string' && p.tracking_subdomain ? p.tracking_subdomain : 'links';
  const id = ctx.mint(DOMAIN);
  const dkim = (await ctx.secret(`resend-dkim:${id}`)).replace(/[-_]/g, 'A').slice(0, 172);
  // source: https://resend.com/docs/api-reference/domains/create-domain "tracking_subdomain"
  // The published default response includes the Tracking CNAME even with click_tracking false.
  const row: Row = {
    id, object: 'domain', name, status: 'not_started', created_at: stamp(ctx.occurredAt), region, open_tracking: p.open_tracking === true, click_tracking: p.click_tracking === true,
    ...(tracking ? { tracking_subdomain: tracking } : {}), capabilities: { sending: caps.sending === 'disabled' ? 'disabled' : 'enabled', receiving: receiving ? 'enabled' : 'disabled' },
    records: recordsOf(name, region, dkim, tracking, receiving), _team: teamOf(ctx),
  };
  await ctx.write(DOMAIN, id, row, 'domain.create');
  const { object: _o, ...created } = view({ ...row, id });
  return Response.json(created, { status: 201 });
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
  if (!d) return notFound('Domain');
  if (d.status !== 'verified') {
    const refused = ctx.legal(DOMAIN, 'status', 'domains/verify', d.status, 'pending');
    if (refused) return invalid(refused.message, refused.status);
    await ctx.write(DOMAIN, String(d.id), { status: 'pending', records: (d.records as Row[]).map((r) => ({ ...r, status: 'pending' })), _verify_at: ctx.occurredAt }, 'domain.verify');
  }
  return Response.json({ object: 'domain', id: d.id });
}

/** DELETE /domains/{domain_id} */
// source: spec:domains/remove "Remove an existing domain"
export async function domains_remove(ctx: HandlerContext): Promise<Response> {
  const d = own(ctx);
  if (!d) return notFound('Domain');
  await ctx.remove(DOMAIN, String(d.id), 'domain.delete');
  return Response.json({ object: 'domain', id: d.id, deleted: true });
}
