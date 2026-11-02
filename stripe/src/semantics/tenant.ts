// Stripe platform keys select an independent merchant account. Connect remains inside that merchant's namespace.
import { isWorldAccountName, type HandlerContext } from '@volter/world-core';
import { requestKey } from '../engine/oauth.ts';
export function tenant(ctx: HandlerContext): string | undefined {
  const path = new URL(ctx.call.request.url).pathname;
  if (path.startsWith('/_twin/')) {
    const name = (ctx.body as Record<string, unknown> | undefined)?.account ?? 'default';
    return isWorldAccountName(name) ? name : undefined;
  }
  const key = requestKey(ctx.call.request);
  if (key) return ctx.rowsRaw('_platform_key').find(row => row.deleted !== true && row._sha256 === ctx.crypto.sha256(key))?._world_account as string | undefined;
  // Hosted Checkout, portal and Connect URLs carry their globally unique stored id rather than a merchant's secret key.
  const segments = path.split('/').filter(Boolean);
  // Visiting a Connect link replaces its id with the onboarding session stored on that same link.
  const session = /^\/setup\/s\/(onbs_[A-Za-z0-9_]+)\/?$/.exec(path)?.[1];
  const row = ['checkout.session', 'billing_portal.session', 'account_link']
    .flatMap(resource => ctx.rowsRaw(resource))
    .find(row => row.deleted !== true && typeof row.id === 'string' && segments.includes(row.id))
    ?? (session ? ctx.rowsRaw('account_link').find(row => row.deleted !== true && row._session === session) : undefined);
  return row?._world_account as string | undefined;
}
