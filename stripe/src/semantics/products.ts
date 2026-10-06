// Stripe's products operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { asBool, nowUnix } from '../engine/stripe.ts';
import { created, list, newest, where } from './shared.ts';
export async function GetProducts(ctx: HandlerContext): Promise<Response> {
  return list(ctx, 'product', where(ctx, newest(ctx, 'product'), {
    active: (p, v) => asBool(p.active) === asBool(v),
    ids: (p, v) => (Array.isArray(v) ? v.map(String).includes(String(p.id)) : String(p.id) === String(v)),
  }));
}

export async function PostProducts(ctx: HandlerContext): Promise<Response> {
  return ctx.reply(await created(ctx, 'product', ctx.params, { active: true, livemode: false, images: [], marketing_features: [], metadata: {}, updated: nowUnix(ctx.occurredAt) }));
}

/** `GET /v1/products/search?query=`: the products Stripe's search language selects. */
// source: spec:GetProductsSearch "Search for products you’ve previously created using Stripe’s"

// source: spec:PostProductsProductFeatures "Creates a product_feature"
