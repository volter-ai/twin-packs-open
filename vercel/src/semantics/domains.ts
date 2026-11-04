// The team's domains: listed, their configuration (as Vercel sees their DNS), removed with the project domains under
// them, and made a Vercel DNS zone.
import type { HandlerContext } from '@volter/world-core';
import { apexOf, configOf, DOMAIN, fail, PROJECT, PROJECT_DOMAIN, pageOf, type Row, scopeOf, teamDomain, view } from './shared.ts';

/** `GET /v5/domains`: the team's domains, newest first. */
// source: spec:getDomains "Retrieves a list of domains registered for the authenticated user or team. By default it returns the last 20 domains if no limit is provided."
export async function getDomains(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  const { items, pagination } = pageOf(ctx, ctx.rowsRaw(DOMAIN).filter((d) => d.teamId === s.team.id));
  return Response.json({ domains: items.map((d) => view(ctx, d, true)), pagination });
}

/** `GET /v6/domains/{domain}/config`: how Vercel sees the domain's DNS (./shared.ts, configOf). */
// source: spec:getDomainConfig "Get a Domain's configuration."
export async function getDomainConfig(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  return Response.json(configOf(ctx, s.team, String(ctx.call.params.domain).toLowerCase()));
}

/** `DELETE /v6/domains/{domain}`: the team domain, and the project domains under it ("Deleting a domain will
 *  automatically remove any associated aliases"). */
// source: spec:deleteDomain "Deleting a domain will automatically remove any associated aliases."
export async function deleteDomain(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  const name = apexOf(String(ctx.call.params.domain).toLowerCase());
  const d = teamDomain(ctx, s.team, name);
  if (!d) return fail(404, 'not_found', `Domain ${name} not found`);
  const teamProjects = new Set(ctx.rowsRaw(PROJECT).filter((p) => p.accountId === s.team.id).map((p) => p.id));
  for (const pd of ctx.rowsRaw(PROJECT_DOMAIN).filter((x) => x.apexName === name && teamProjects.has(x.projectId))) await ctx.remove(PROJECT_DOMAIN, String(pd.id), 'project_domain.delete');
  await ctx.remove(DOMAIN, String(d.id), 'domain.delete');
  return Response.json({ uid: d.id });
}

/** `PATCH /v3/domains/{domain}` `{ op: "update", zone }`: whether Vercel's DNS serves the domain (Dub's
 *  configureVercelNameservers). Moving a domain (`op: "move-out"`) is the gap. */
// source: spec:patchDomain "Update or move apex domain."
export async function patchDomain(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  // the other ops (move-out and the rest) no application sends: answered as the twin's gap, Vercel's unknown request
  if (b.op !== 'update') return fail(404, 'not_found', 'Not Found');
  const name = apexOf(String(ctx.call.params.domain).toLowerCase());
  const d = teamDomain(ctx, s.team, name);
  if (!d) return fail(404, 'not_found', `Domain ${name} not found`);
  if (b.echMode !== undefined && !['auto', 'disabled'].includes(String(b.echMode))) return fail(400, 'bad_request', 'Invalid echMode');
  if (typeof b.zone === 'boolean' && b.zone !== (d.zone === true)) {
    const refused = ctx.legal('domain', 'zone', 'patchDomain', String(d.zone === true), String(b.zone), String(d.id));
    if (refused) return fail(refused.status, String(refused.code ?? 'bad_request'), refused.message);
    await ctx.write(DOMAIN, String(d.id), { zone: b.zone, serviceType: b.zone ? 'zeit.world' : 'external' }, 'domain.update');
  }
  // source: spec:patchDomain "Encrypted Client Hello enrollment."
  if (b.echMode !== undefined) {
    await ctx.write(DOMAIN, String(d.id), { echMode: String(b.echMode) }, 'domain.update');
  }
  return Response.json({ zone: ctx.row(DOMAIN, String(d.id))?.zone === true, echMode: String(ctx.row(DOMAIN, String(d.id))?.echMode ?? 'auto') });
}
