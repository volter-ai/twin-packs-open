// Stripe's coupons operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { amountOffOf, created, fail } from './shared.ts';
export async function PostCoupons(ctx: HandlerContext): Promise<Response> {
  const params = ctx.params;
  const hasPct = params.percent_off !== undefined;
  const hasAmt = params.amount_off !== undefined;
  if (hasPct === hasAmt) return fail(ctx, 'You must pass exactly one of `amount_off` and `percent_off`.', 400, 'parameter_missing');
  let percentOff: number | null = null;
  let amountOff: number | null = null;
  if (hasPct) {
    percentOff = Number(params.percent_off);
    if (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100) return fail(ctx, 'Invalid number: percent_off must be > 0 and <= 100.', 400, 'parameter_invalid_number');
  }
  const off = hasPct ? null : amountOffOf(ctx, params);
  if (off instanceof Response) return off;
  amountOff = off;
  const duration = typeof params.duration === 'string' ? params.duration : 'once';
  if (!['once', 'repeating', 'forever'].includes(duration)) return fail(ctx, 'Invalid duration: must be one of once, repeating, or forever.', 400, 'parameter_invalid_string_enum');
  if (duration === 'repeating' && params.duration_in_months === undefined) return fail(ctx, 'Missing required param: duration_in_months (required when duration=repeating).', 400, 'parameter_missing');
  return ctx.reply(
    await created(ctx, 'coupon', params, {
      percent_off: percentOff, amount_off: amountOff,
      currency: amountOff !== null ? params.currency : null,
      duration, duration_in_months: duration === 'repeating' ? Number(params.duration_in_months) : null,
      name: typeof params.name === 'string' ? params.name : null,
      valid: true, livemode: false, times_redeemed: 0, metadata: {},
      max_redemptions: params.max_redemptions !== undefined ? Number(params.max_redemptions) : null,
      redeem_by: params.redeem_by !== undefined ? Number(params.redeem_by) : null,
      applies_to: null,
    }),
  );
}
