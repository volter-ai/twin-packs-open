// Stripe's promotion_codes operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { asBool } from '../engine/stripe.ts';
import { created, fail, list, newest, where } from './shared.ts';
export async function GetPromotionCodes(ctx: HandlerContext): Promise<Response> {
  return list(ctx, 'promotion_code', where(ctx, newest(ctx, 'promotion_code'), {
    code: (p, v) => p.code === v,
    active: (p, v) => asBool(p.active) === asBool(v),
    coupon: (p, v) => p.coupon === v,
    customer: (p, v) => p.customer === v,
  }));
}

// a code the caller does not give is derived from the promotion code's id
export async function PostPromotionCodes(ctx: HandlerContext): Promise<Response> {
  // what it promotes: promotion[type]=coupon and promotion[coupon] (2025-09-30.clover,
  // docs.stripe.com/changelog/clover/2025-09-30/polymorphic-coupon), or the top-level coupon a caller pinned to an
  // earlier version sends; the twin keeps the coupon's id on the code for its rules
  const given = ctx.params;
  const { promotion, coupon: legacy, ...params } = given;
  const promo = promotion && typeof promotion === 'object' ? (promotion as Record<string, unknown>) : undefined;
  if (promo && promo.type !== 'coupon') return fail(ctx, 'Invalid promotion[type]: must be coupon.', 400, 'parameter_invalid_string_enum');
  const coupon = typeof promo?.coupon === 'string' ? promo.coupon : typeof legacy === 'string' ? legacy : '';
  if (!coupon) return fail(ctx, promo ? 'Missing required param: promotion[coupon].' : 'Missing required param: promotion.', 400, 'parameter_missing');
  if (!ctx.get('coupon', coupon)) return fail(ctx, `No such coupon: '${coupon}'`, 400, 'resource_missing');
  const id = ctx.mint('promotion_code');
  const code = typeof params.code === 'string' && params.code ? params.code : `TWIN${id.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
  return ctx.reply(
    await created(ctx, 'promotion_code', { ...params, coupon, promotion: { type: 'coupon', coupon }, id, code }, {
      active: params.active !== undefined ? asBool(params.active) : true,
      customer: typeof params.customer === 'string' ? params.customer : null,
      expires_at: params.expires_at !== undefined ? Number(params.expires_at) : null,
      max_redemptions: params.max_redemptions !== undefined ? Number(params.max_redemptions) : null,
      times_redeemed: 0, livemode: false, metadata: {}, restrictions: { first_time_transaction: false, minimum_amount: null, minimum_amount_currency: null },
    }),
  );
}
