// What Cloudflare's API v4 does around every request (docs/contributing/architecture.md, around.ts): a token held by the
// account (the manifest's `auth.held`) is let through to an operation only with one of the permission groups it needs, on
// the account or zone the path names ("Authentication error", code 10000, 403); every answer carries Cloudflare's own
// headers for when and which request it was, Date on the World's clock and a cf-ray. Where the documentation stops: the
// ray is derived from the instant and the request (the twin's).
import { digest, type HandlerContext } from '@volter/world-core';
import { allows, fail, heldToken, live, needOf, zoneAccount } from './shared.ts';
import { personInAccount, sameAccount } from '../../../src/semantics/shared.ts';

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const need = needOf(ctx.call.operation.id, ctx.call.request.method);
  const token = heldToken(ctx);
  const zone = ctx.call.params.zone_id;
  // a disabled or expired token is refused as one never made; a live one needs a group the operation takes
  const account = ctx.call.params.account_id ?? (zone ? zoneAccount(ctx.row('zone', zone)) : undefined);
  const res = token && account && !personInAccount(ctx, token, account) ? fail(403, 10000, 'Authentication error')
    : token && !live(token, ctx.occurredAt) ? fail(401, 10000, 'Authentication error')
    : token && need && !allows(token, need.groups, { account: ctx.call.params.account_id, zone, zoneAccount: zone ? zoneAccount(ctx.row('zone', zone)) : undefined }, (a, b) => sameAccount(ctx, a, b)) ? fail(403, 10000, 'Authentication error')
    : await next();
  const headers = new Headers(res.headers);
  headers.set('date', new Date(Date.parse(ctx.occurredAt)).toUTCString());
  if (!headers.has('cf-ray')) headers.set('cf-ray', `${digest('sha256', `${ctx.occurredAt}:${ctx.call.request.method}:${ctx.call.request.url}`).slice(0, 16)}-SJC`);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
