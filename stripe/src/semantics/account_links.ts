// Stripe's account_links operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { nowUnix } from '../engine/stripe.ts';
import { accountMissing, fail } from './shared.ts';
// ── hosted onboarding links and embedded-component sessions ──
export async function PostAccountLinks(ctx: HandlerContext): Promise<Response> {
  const account = typeof ctx.params.account === 'string' ? ctx.params.account : '';
  if (!account) return fail(ctx, 'Missing required param: account.', 400, 'parameter_missing');
  if (!ctx.get('account', account)) return accountMissing(ctx, account, 400);
  const linkType = typeof ctx.params.type === 'string' ? ctx.params.type : '';
  if (linkType !== 'account_onboarding' && linkType !== 'account_update') return fail(ctx, 'Invalid account link type: must be account_onboarding or account_update.', 400, 'parameter_invalid_string_enum');
  // the owner is sent back to return_url when done, and to refresh_url for a new link once this one is used or expired
  for (const k of ['refresh_url', 'return_url']) if (typeof ctx.params[k] !== 'string' || !ctx.params[k]) return fail(ctx, `Missing required param: ${k}.`, 400, 'parameter_missing');
  const now = Number(nowUnix(ctx.occurredAt));
  const id = ctx.mint('account_link');
  const link = { object: 'account_link', created: now, expires_at: now + 300, url: `https://connect.stripe.com/setup/${id}` };
  await ctx.write('account_link', id, { ...link, account, type: linkType, refresh_url: ctx.params.refresh_url, return_url: ctx.params.return_url, used: false }, 'account_link.create');
  return ctx.reply(link);
}
