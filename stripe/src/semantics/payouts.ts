// Stripe's payouts operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { validateMoney } from '../engine/stripe.ts';
import { account, asOf, created, kept, list, newest, fail, noExternalAccount, payoutBank, payoutDefaults, refusePayout, send, settlePayout } from './shared.ts';
export async function PostPayouts(ctx: HandlerContext): Promise<Response> {
  const bad = validateMoney(ctx.params);
  if (bad) return send(ctx, bad);
  const acct = account(ctx);
  if (acct && !ctx.get('account', acct)) return fail(ctx, `No such account: '${acct}'`, 400, 'account_invalid');
  const amount = Math.trunc(Number(ctx.params.amount) || 0);
  const currency = String(ctx.params.currency ?? 'usd');
  // a connected account is paid out to its own bank account
  if (acct && !ctx.rows('external_account').some((e) => e.account === acct && (e.currency ?? currency) === currency)) return noExternalAccount(ctx, currency);
  const refused = refusePayout(ctx, amount, currency);
  if (refused) return refused;
  const id = ctx.mint('payout');
  const bt = await settlePayout(ctx, id, -amount, currency);
  return ctx.reply(await created(ctx, 'payout', { ...ctx.params, id }, { status: 'pending', ...payoutDefaults(ctx), balance_transaction: bt, destination: acct ? payoutBank(ctx, acct, currency) : null, ...(acct ? { _account: acct } : {}) }));
}


// source: https://docs.stripe.com/connect/authentication "Stripe-Account header"
// source: https://docs.stripe.com/payouts "paid"
export async function GetPayouts(ctx: HandlerContext): Promise<Response> {
  const acct = account(ctx);
  const payouts = newest(ctx, 'payout').filter((p) => (kept(ctx, 'payout', p, '_account') ?? null) === (acct ?? null));
  return list(ctx, 'payout', payouts.map((p) => asOf(ctx, p)));
}
