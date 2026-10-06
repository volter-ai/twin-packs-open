// The account's workers.dev subdomain.
import type { HandlerContext } from '@volter/world-core';
import { sameAccount, accountOf, fail, noAccount, ok, type Row, SUBDOMAIN } from './shared.ts';

/** The account's subdomain, kept under the account's id, whichever of its ids that was when it was set. */
const subdomainOf = (ctx: HandlerContext, account: string): Row | undefined => ctx.rowsRaw(SUBDOMAIN).find((s) => s.deleted !== true && sameAccount(ctx, s.id, account));

// source: spec:worker-subdomain-get-subdomain "Returns a Workers subdomain for an account."
export async function worker_subdomain_get_subdomain(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const s = subdomainOf(ctx, String(account.id));
  // Where the documentation stops: the answer for an account with no subdomain yet is not recorded; the code is the one
  // wrangler reads as "no subdomain registered" (10007)
  return s && s.deleted !== true ? ok({ subdomain: s.subdomain }) : fail(404, 10007, 'workers.api.error.subdomain_not_found');
}

/** `PUT …/workers/subdomain` `{ subdomain }`: the account's subdomain, taken by no other account. */
// source: spec:worker-subdomain-create-subdomain "Creates a Workers subdomain for an account."
export async function worker_subdomain_create_subdomain(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const body = (ctx.body ?? {}) as Row;
  const name = typeof body.subdomain === 'string' ? body.subdomain.toLowerCase() : '';
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name)) return fail(400, 10032, 'workers.api.error.invalid_subdomain');
  if (ctx.rowsRaw(SUBDOMAIN).some((s) => s.subdomain === name && !sameAccount(ctx, s.id, account.id) && s.deleted !== true)) return fail(409, 10031, 'workers.api.error.subdomain_unavailable');
  await ctx.write(SUBDOMAIN, String(subdomainOf(ctx, String(account.id))?.id ?? account.id), { subdomain: name }, 'workers_subdomain.update');
  return ok({ subdomain: name });
}
