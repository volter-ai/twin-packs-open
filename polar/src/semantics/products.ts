// Products and their prices.
import type { HandlerContext } from '@volter/world-core';
import { rowOf, bodyOf, environment, productFields, priceView, invalid, missing, newId, PRODUCT, productView, type Row, rowsOf } from './shared.ts';

const AMOUNT_TYPES = new Set(['fixed', 'free', 'custom', 'metered_unit', 'seat_based']);

/** `POST /v1/products/`: a product with its prices, each given an id. */
// source: spec:products:create "Create a product."
export async function products_create(ctx: HandlerContext): Promise<Response> {
  const body = bodyOf(ctx);
  if (typeof body.name !== 'string' || body.name === '') return missing('name');
  const prices = Array.isArray(body.prices) ? body.prices as Row[] : [];
  if (prices.length === 0) return missing('prices');
  const bad = prices.findIndex((p) => !AMOUNT_TYPES.has(String(p.amount_type)));
  if (bad >= 0) return invalid(['prices', bad, 'amount_type'], 'Input tag does not match any of the expected tags', 'union_tag_invalid');
  const id = newId(ctx, PRODUCT);
  const stored: Row[] = [];
  for (const price of prices) {
    const priceId = ctx.mint('_price');
    await ctx.record('_price', {}, priceId);
    stored.push(priceView(ctx, { ...price, id: priceId }, { ...body, id, created_at: ctx.occurredAt }));
  }
  await ctx.write(PRODUCT, id, { ...productFields(ctx, {
    id, created_at: ctx.occurredAt, modified_at: null, name: body.name, description: body.description ?? null, recurring_interval: body.recurring_interval ?? null,
    recurring_interval_count: body.recurring_interval_count ?? (body.recurring_interval ? 1 : null), trial_interval: body.trial_interval ?? null,
    trial_interval_count: body.trial_interval_count ?? null, visibility: body.visibility ?? 'public', is_archived: false, prices: stored, benefit_ids: [], metadata: body.metadata ?? {},
  }), _environment: environment(ctx) }, 'product.create');
  return Response.json(productView(ctx, rowOf(ctx, PRODUCT, id)!), { status: 201 });
}

/** `GET /v1/products/`: filtered by archived, recurring, a query over names, or a benefit they grant. */
// source: spec:products:list "List products."
export async function products_list(ctx: HandlerContext): Promise<Response> {
  const flag = (v: unknown): boolean | undefined => (v === undefined ? undefined : String(v) === 'true');
  const archived = flag(ctx.params.is_archived);
  const recurring = flag(ctx.params.is_recurring);
  const q = String(ctx.params.query ?? '').toLowerCase();
  const rows = rowsOf(ctx, PRODUCT)
    .filter((p) => archived === undefined || Boolean(p.is_archived) === archived)
    .filter((p) => recurring === undefined || (p.recurring_interval != null) === recurring)
    .filter((p) => q === '' || String(p.name).toLowerCase().includes(q))
    .filter((p) => ctx.params.benefit_id === undefined || ((p.benefit_ids as string[] | undefined) ?? []).includes(String(ctx.params.benefit_id)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return ctx.list('Product', rows.map((p) => productView(ctx, p)));
}
