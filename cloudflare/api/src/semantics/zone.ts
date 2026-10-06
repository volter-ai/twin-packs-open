// Zones: a domain added to an account (the dashboard's Add a site, or this API), pending until its registrar points it
// at the two nameservers Cloudflare assigns (the World learns that from the `dns` door, an external DNS publication).
import type { HandlerContext } from '@volter/world-core';
import { accountRow, sameAccount, zoneAccount, allows, fail, listed, ok, personInAccount, bearerToken, type Row } from './shared.ts';

// Cloudflare's nameserver pool, as its schema's example names it; a zone takes two of it, by its id
// source: spec:/components/schemas/zones_zone/properties/name_servers "The name servers Cloudflare assigns to a zone."
const POOL = ['bob', 'lola', 'ada', 'bart', 'cruz', 'dana', 'elle', 'fred'];

/** `POST /zones` `{ account: { id }, name, type? }`: the zone, pending, with its two assigned nameservers. */
// source: spec:zones-post "The zone is created in a pending state and must be activated by updating your domain's"
export async function zones_post(ctx: HandlerContext): Promise<Response> {
  const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {}) as Row;
  const accountId = typeof (body.account as Row | undefined)?.id === 'string' ? String((body.account as Row).id) : '';
  const name = typeof body.name === 'string' ? body.name.toLowerCase() : '';
  const type = String(body.type ?? 'full');
  // source: spec:/components/schemas/zones_name "The domain name."
  if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name) || name.length > 253) return fail(400, 1099, 'Invalid zone name');
  if (!['full', 'partial', 'secondary', 'internal'].includes(type)) return fail(400, 1099, 'Invalid zone type');
  const account = accountRow(ctx, accountId);
  const caller = bearerToken(ctx);
  // Where the documentation stops: a zone for an account the token cannot reach takes the API's authentication error
  if (!account || account.deleted === true || !caller || !personInAccount(ctx, caller, accountId)) return fail(403, 10000, 'Authentication error');
  // Where the documentation stops: the code and words of a zone the account holds already are not recorded here
  if (ctx.rowsRaw('zone').some((z) => z.name === name && sameAccount(ctx, zoneAccount(z), accountId) && z.deleted !== true)) return fail(400, 1061, `${name} already exists`);
  const id = ctx.mint('zones_zone');
  const pick = parseInt(id.slice(0, 4), 16) % POOL.length;
  const servers = [POOL[pick]!, POOL[(pick + 1 + (parseInt(id.slice(4, 8), 16) % (POOL.length - 1))) % POOL.length]!].map((n) => `${n}.ns.cloudflare.com`);
  const at = ctx.occurredAt;
  await ctx.write('zone', id, {
    id, name, type, status: 'pending', paused: false, development_mode: 0, name_servers: servers, original_name_servers: null, original_registrar: null,
    original_dnshost: null, account: { id: accountId, name: account.name }, owner: { id: null, type: 'user', email: null },
    meta: { cdn_only: false, custom_certificate_quota: 0, dns_only: false, foundation_dns: false, page_rule_quota: 3, phishing_detected: false, step: 2 },
    plan: { id: '0feeeeeeeeeeeeeeeeeeeeeeeeeeeeee', name: 'Free Website', price: 0, currency: 'USD', frequency: '', is_subscribed: false, can_subscribe: false, legacy_id: 'free', legacy_discount: false, externally_managed: false },
    permissions: [], created_on: at, modified_on: at, activated_on: null, vanity_name_servers: [], verification_key: null,
  }, 'zone.create');
  return ok(ctx.get('zones_zone', id) ?? {});
}

/** `GET /zones`: the zones the token may read (Zone Read or Write on the zone or its account), by `name`, `status`,
 *  `account.id` and `account.name`, ordered by `order` when named, each as `POST /zones` answers it. */
// source: spec:zones-get "Lists, searches, sorts, and filters your zones."
export async function zones_get(ctx: HandlerContext): Promise<Response> {
  const caller = bearerToken(ctx);
  const q = new URL(ctx.call.request.url).searchParams;
  // source: spec:zones-get "Whether to match all search requirements or at least one (any)."
  // source: spec:zones-get "Filter by an account ID."
  const value = (z: Row, field: string): string => String(field === 'account.id' ? zoneAccount(z) : field === 'account.name' ? (z.account as Row | undefined)?.name : z[field]);
  const tests = (['name', 'status', 'account.id', 'account.name'] as const)
    .filter((param) => q.get(param) !== null).map((param) => (z: Row): boolean => param === 'account.id'
      ? sameAccount(ctx, zoneAccount(z), q.get(param)) : value(z, param) === q.get(param));
  const any = q.get('match') === 'any';
  const zones = ctx.rowsRaw('zone').filter((z) => z.deleted !== true && caller !== undefined && personInAccount(ctx, caller, zoneAccount(z))
    && allows(caller, ['Zone Read', 'Zone Write'], { zone: String(z.id), zoneAccount: zoneAccount(z) }, (a, b) => sameAccount(ctx, a, b)))
    .filter((z) => tests.length === 0 || (any ? tests.some((t) => t(z)) : tests.every((t) => t(z))));
  const order = q.get('order');
  const key = (z: Row): string => order ? value(z, order) : '';
  if (order) zones.sort((a, b) => key(a).localeCompare(key(b)));
  if (q.get('direction') === 'desc') zones.reverse();
  return listed(ctx, zones.map((z) => ctx.get('zones_zone', String(z.id)) ?? {}));
}
