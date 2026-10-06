// Stripe's prices operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import type { Row } from '../engine/common.ts';
import { asBool } from '../engine/stripe.ts';
import { at, created, fail, list, newest, tieredPrice, where } from './shared.ts';
// `type` is not stored (it collides with the tree's discriminator), so `recurring` stands for it
export async function GetPrices(ctx: HandlerContext): Promise<Response> {
  return list(ctx, 'price', where(ctx, newest(ctx, 'price'), {
    active: (p, v) => asBool(p.active) === asBool(v),
    product: (p, v) => p.product === v,
    currency: (p, v) => p.currency === v,
    type: (p, v) => (v === 'recurring' ? !!p.recurring : !p.recurring),
    lookup_keys: (p, v) => (Array.isArray(v) ? v.map(String) : [String(v)]).includes(String(p.lookup_key)),
  }));
}

export async function GetPricesPrice(ctx: HandlerContext): Promise<Response> {
  const p = ctx.get('price', at(ctx, 'price'));
  return p ? ctx.reply(p) : fail(ctx, `No such price: '${at(ctx, 'price')}'`, 404, 'resource_missing');
}

export async function PostPrices(ctx: HandlerContext): Promise<Response> {
  const params = ctx.params;
  // the product must exist
  const product = typeof params.product === 'string' ? params.product : '';
  if (!product || !ctx.get('product', product)) return fail(ctx, `No such product: '${product}'`, 400, 'resource_missing');
  // a tiered price needs tiers_mode and tiers, each tier with up_to and a unit or flat amount; it
  // has no single unit_amount, and its last tier's up_to is null (∞)
  const scheme = typeof params.billing_scheme === 'string' ? params.billing_scheme : 'per_unit';
  if (scheme === 'tiered') return tieredPrice(ctx, params);
  // a price that recurs is billed by subscriptions; any other is paid once. Its recurring block answers what the create
  // left out as Stripe does: `usage_type` "Defaults to `licensed`", and the create example's answer
  // (docs.stripe.com/api/prices/create) carries `"interval_count": 1, "trial_period_days": null`; a meter only a metered
  // price names
  if (params.recurring && typeof params.recurring === 'object') {
    const r = params.recurring as Row;
    params.recurring = { ...r, interval_count: r.interval_count !== undefined ? Math.trunc(Number(r.interval_count)) : 1, usage_type: r.usage_type ?? 'licensed', trial_period_days: r.trial_period_days !== undefined ? Math.trunc(Number(r.trial_period_days)) : null, meter: r.meter ?? null };
  }
  return ctx.reply(await created(ctx, 'price', params, { active: true, livemode: false, billing_scheme: 'per_unit', type: params.recurring ? 'recurring' : 'one_time', metadata: {} }));
}
