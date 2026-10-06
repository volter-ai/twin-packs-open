// External person signup and host discovery only; buckets, tokens and deployments use their ordinary APIs/screens.
import { personOf, recordPerson, type HandlerContext } from '@volter/world-core';
import { DOMAIN, WORKER_DOMAIN, workerHosts, apiError } from './shared.ts';

// source: https://developers.cloudflare.com/fundamentals/account/create-account/ "Create an account"
export async function users(ctx: HandlerContext): Promise<Response> {
  const email = String(ctx.call.params.email ?? '').trim().toLowerCase(); const body = (ctx.body ?? {}) as Record<string, unknown>;
  if (!email.includes('@') || typeof body.password !== 'string' || !body.password) return apiError(400, 10021, 'An email and throwaway password are required.');
  const held = ctx.rowsRaw('cf_user').find(user => user.email === email);
  if (held && personOf(ctx, email)) return apiError(409, 10021, 'The person already exists.');
  // a user the World made with its account (its owner) signs up to the dashboard by setting a password
  if (held) { await recordPerson(ctx, email, body.password); return Response.json({ id: held.id, email }, { status: 201 }); }
  const id = ctx.mint('User');
  await recordPerson(ctx, email, body.password);
  await ctx.write('cf_user', id, { id, email, first_name: null, last_name: null, username: id, two_factor_authentication_enabled: false,
    two_factor_authentication_locked: false, suspended: false, created_on: ctx.occurredAt, modified_on: ctx.occurredAt }, 'user.signup');
  return Response.json({ id, email }, { status: 201 });
}
/** The hostnames Cloudflare answers for the account: R2 public domains, and Workers Custom Domains. */
// source: https://developers.cloudflare.com/r2/buckets/public-buckets/ "Connect a bucket to a custom domain"
// source: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ "Custom Domains point all paths of a domain or subdomain to your Worker."
// source: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/ "All Workers are assigned a workers.dev route when they are created or renamed"
export async function hosts(ctx: HandlerContext): Promise<Response> {
  return Response.json({ hosts: [...ctx.rowsRaw(DOMAIN).map(domain => String(domain.domain)),
    ...workerHosts(ctx),
    ...ctx.rowsRaw(WORKER_DOMAIN).filter(domain => domain.deleted !== true).map(domain => String(domain.hostname))] });
}
