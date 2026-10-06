// Workers Custom Domains (Cloudflare's "Domains" API): a hostname in one of the account's zones whose every path the
// Worker answers. Attached through the API, or by `wrangler deploy` for a route with `custom_domain: true`, which asks
// the script's domains changeset and then puts the script's domain records. The World answers the hostname with the
// Worker's static assets (../../../src/workers-assets.ts, the r2 lane's `around`).
import type { HandlerContext } from '@volter/world-core';
import { sameAccount, zoneAccount, accountOf, fail, noAccount, noScript, ok, type Row, scriptNamed } from './shared.ts';

const DOMAIN = 'worker_domain';
const bodyOf = (ctx: HandlerContext): unknown => ctx.body;
const live = (ctx: HandlerContext, account: string): Row[] => ctx.rowsRaw(DOMAIN).filter((d) => sameAccount(ctx, d.account_id, account) && d.deleted !== true);
const view = (d: Row): Row => ({ id: d.id, hostname: d.hostname, service: d.service, environment: d.environment ?? 'production', zone_id: d.zone_id, zone_name: d.zone_name, cert_id: d.cert_id });

/** The account's active zone a hostname is in: the one named, or the longest zone name the hostname ends with. */
// source: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ "Custom Domains are routes to a domain or subdomain (such as example.com or shop.example.com) within a Cloudflare zone where the Worker is the origin."
// source: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ "An active Cloudflare zone"
function zoneFor(ctx: HandlerContext, account: string, hostname: string, zoneId?: unknown, zoneName?: unknown): Row | undefined {
  const zones = ctx.rowsRaw('zone').filter((z) => sameAccount(ctx, zoneAccount(z), account) && z.deleted !== true && z.status === 'active');
  if (typeof zoneId === 'string' && zoneId) return zones.find((z) => z.id === zoneId);
  if (typeof zoneName === 'string' && zoneName) return zones.find((z) => z.name === zoneName);
  return zones.filter((z) => hostname === z.name || hostname.endsWith(`.${String(z.name)}`)).sort((a, b) => String(b.name).length - String(a.name).length)[0];
}

/** The DNS records the zone holds at a hostname, which a Custom Domain is never put over: Cloudflare refuses it until they
 *  are deleted, whatever the override flags say (measured against the API, 2026-10-02: 409, code 100117). */
// source: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ "You cannot create a Custom Domain on a hostname with an existing CNAME DNS record or on a zone you do not own."
const externalRecords = (ctx: HandlerContext, zone: string, hostname: string): Row[] =>
  ctx.rowsRaw('dns_record').filter((r) => r.zone_id === zone && r.name === hostname && ['CNAME', 'A', 'AAAA'].includes(String(ctx.own(r).type)) && r.deleted !== true);
const recordsHeld = (hostname: string): Response =>
  fail(409, 100117, `Hostname '${hostname}' already has externally managed DNS records (A, CNAME, etc). Delete them first or try a different hostname.`);

type Origin = { hostname: string; zone_id?: string; zone_name?: string; previews_enabled?: boolean };
const originsOf = (v: unknown): Origin[] | undefined =>
  Array.isArray(v) && v.every((o) => o && typeof o === 'object' && typeof (o as Row).hostname === 'string') ? (v as Origin[]) : undefined;

// Where the documentation stops: the refusal for a hostname in no zone of the account is not recorded; the code is the
// one the Domains API answers an invalid request with
const noZone = (hostname: string): Response => fail(400, 100117, `Hostname '${hostname}' is not in an active zone on this account.`);

/** A domain attached (made, or moved to this Worker). */
async function attach(ctx: HandlerContext, account: string, service: string, o: Origin, zone: Row): Promise<Row> {
  const held = live(ctx, account).find((d) => d.hostname === o.hostname);
  const id = held ? String(held.id) : ctx.mint('workers_Domain');
  await ctx.write(DOMAIN, id, {
    id, account_id: account, hostname: o.hostname, service, environment: 'production', zone_id: zone.id, zone_name: zone.name,
    cert_id: held?.cert_id ?? ctx.crypto.uuidFrom(`worker-domain-cert:${id}`), previews_enabled: o.previews_enabled ?? false,
  }, held ? 'worker_domain.update' : 'worker_domain.create');
  return ctx.row(DOMAIN, id)!;
}

/** `PUT /accounts/{account}/workers/domains` `{ hostname, service, zone_id? }`: the domain attached to the Worker. */
// source: spec:workers.domains.update "Attaches a domain that routes traffic to a Worker."
export async function workers_domains_update(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const b = (bodyOf(ctx) ?? {}) as Row;
  if (typeof b.hostname !== 'string' || typeof b.service !== 'string') return fail(400, 10021, 'hostname and service are required');
  if (!scriptNamed(ctx, String(account.id), b.service)) return noScript();
  const zone = zoneFor(ctx, String(account.id), b.hostname, b.zone_id, b.zone_name);
  if (!zone) return noZone(b.hostname);
  if (!live(ctx, String(account.id)).some((d) => d.hostname === b.hostname) && externalRecords(ctx, String(zone.id), b.hostname).length) return recordsHeld(b.hostname);
  return ok(view(await attach(ctx, String(account.id), b.service, { hostname: b.hostname }, zone)));
}

/** `GET /accounts/{account}/workers/domains`: the account's domains, filtered by zone, Worker or hostname. */
// source: spec:workers.domains.list "List Worker Domains"
export async function workers_domains_list(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const q = new URL(ctx.call.request.url).searchParams;
  const keep = (d: Row): boolean => ['zone_id', 'zone_name', 'service', 'hostname'].every((k) => !q.get(k) || String(d[k]) === q.get(k));
  return ok(live(ctx, String(account.id)).filter(keep).map(view));
}

const domainOf = (ctx: HandlerContext): Row | undefined => {
  const d = ctx.row(DOMAIN, String(ctx.call.params.domain_id ?? ''));
  return d && d.deleted !== true && sameAccount(ctx, d.account_id, ctx.call.params.account_id) ? d : undefined;
};
// Where the documentation stops: a missing domain's code is not recorded; the API's not-found code is answered
const noDomain = (): Response => fail(404, 100116, 'Domain not found.');

// source: spec:workers.domains.get "Get Worker Domain"
export async function workers_domains_get(ctx: HandlerContext): Promise<Response> {
  const d = domainOf(ctx);
  return d ? ok(view(d)) : noDomain();
}

/** `GET /accounts/{account}/workers/domains/records/{id}`: the same domain, as wrangler reads one it would move. */
// source: https://unpkg.com/wrangler@4.143.0/wrangler-dist/cli.js "/workers/domains/records/"
export async function worker_domains_get_record(ctx: HandlerContext): Promise<Response> {
  return workers_domains_get(ctx);
}

/** `DELETE …/workers/domains/{id}`: the domain detached; the Worker no longer answers the hostname. */
// source: spec:workers.domains.delete "Detach Worker Domain"
export async function workers_domains_delete(ctx: HandlerContext): Promise<Response> {
  const d = domainOf(ctx);
  if (!d) return noDomain();
  await ctx.remove(DOMAIN, String(d.id), 'worker_domain.delete');
  return ok(null);
}

/** `POST …/workers/scripts/{name}/domains/changeset?replace_state=true` `[origins]`: what putting these origins would
 *  change: domains added, ones held that are updated (`modified` when another Worker holds them), the script's others
 *  removed (replacing its state), and hostnames whose DNS records conflict. */
// source: https://unpkg.com/wrangler@4.143.0/wrangler-dist/cli.js "/domains/changeset?replace_state=true"
export async function worker_domains_changeset(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const name = String(ctx.call.params.script_name);
  const origins = originsOf(bodyOf(ctx));
  if (!origins) return fail(400, 10021, 'The body is a list of origins, each with a hostname.');
  const held = live(ctx, String(account.id));
  const replace = new URL(ctx.call.request.url).searchParams.get('replace_state') === 'true';
  // as the API answers it: each entry with an id, an empty environment and certificate, enabled; the zones it touches.
  // A hostname's own DNS records are not a conflict here: putting the records refuses them (measured, 2026-10-02)
  const out = { added: [] as Row[], updated: [] as Row[], removed: [] as Row[], conflicting: [] as Row[], affected_zones: [] as string[] };
  for (const o of origins) {
    const zone = zoneFor(ctx, String(account.id), o.hostname, o.zone_id, o.zone_name);
    if (!zone) return noZone(o.hostname);
    const d = held.find((x) => x.hostname === o.hostname);
    const entry = { id: d ? d.id : ctx.crypto.sha256(`worker-domain-change:${String(account.id)}:${o.hostname}`).slice(0, 40), zone_id: zone.id, zone_name: zone.name, hostname: o.hostname, service: name, environment: '', cert_id: '', previews_enabled: o.previews_enabled ?? false, enabled: true };
    if (d) out.updated.push({ ...entry, modified: d.service !== name || (o.previews_enabled !== undefined && o.previews_enabled !== d.previews_enabled) });
    else out.added.push(entry);
    if (!out.affected_zones.includes(String(zone.id))) out.affected_zones.push(String(zone.id));
  }
  if (replace) for (const d of held) if (d.service === name && !origins.some((o) => o.hostname === d.hostname)) out.removed.push(view(d));
  return ok(out);
}

/** `PUT …/workers/scripts/{name}/domains/records` `{ override_scope, override_existing_origin,
 *  override_existing_dns_record, origins }`: the script's domains made these, refusing to take one another Worker holds
 *  unless told to, and refusing a hostname the zone holds DNS records at. */
// source: https://unpkg.com/wrangler@4.143.0/wrangler-dist/cli.js "override_existing_dns_record: false"
export async function worker_domains_put_records(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const name = String(ctx.call.params.script_name);
  if (!scriptNamed(ctx, String(account.id), name)) return noScript();
  const b = (bodyOf(ctx) ?? {}) as Row;
  const origins = originsOf(b.origins);
  if (!origins) return fail(400, 10021, 'origins is a list, each with a hostname.');
  const held = live(ctx, String(account.id));
  const plan: Array<{ o: Origin; zone: Row }> = [];
  for (const o of origins) {
    const zone = zoneFor(ctx, String(account.id), o.hostname, o.zone_id, o.zone_name);
    if (!zone) return noZone(o.hostname);
    const d = held.find((x) => x.hostname === o.hostname);
    // Where the documentation stops: the codes of these two refusals are not recorded
    if (d && d.service !== name && b.override_existing_origin !== true) return fail(409, 100117, `${o.hostname} is already a Custom Domain of the Worker ${String(d.service)}.`);
    if (!d && externalRecords(ctx, String(zone.id), o.hostname).length) return recordsHeld(o.hostname);
    plan.push({ o, zone });
  }
  const made: Row[] = [];
  for (const { o, zone } of plan) made.push(view(await attach(ctx, String(account.id), name, o, zone)));
  if (b.override_scope === true) {
    for (const d of held) if (d.service === name && !origins.some((o) => o.hostname === d.hostname)) await ctx.remove(DOMAIN, String(d.id), 'worker_domain.delete');
  }
  return ok(made);
}
