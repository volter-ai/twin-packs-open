// Orders: made when a checkout is paid (./checkouts.ts), read back by the application.
import type { HandlerContext } from '@volter/world-core';
import { ORDER, orderView, rowOf, rowsOf, notFound } from './shared.ts';

const FILTERS = ['checkout_id', 'customer_id', 'product_id', 'subscription_id', 'status'];

/** Orders have no organization_id in their vendor shape. Resolve the environment before rendering rather than
 *  asking the generic organization-field tenancy filter to read a field the vendor does not return. */
// source: spec:orders:get "Get an order by ID."
export async function orders_get(ctx: HandlerContext): Promise<Response> {
  const order = rowOf(ctx, ORDER, String(ctx.call.params.id));
  return order ? Response.json(orderView(ctx, order)) : notFound('Order');
}

/** `GET /v1/orders/`: the organization's orders, newest first, filtered by the checkout, customer, product,
 *  subscription or status named. */
// source: spec:orders:list "List orders."
export async function orders_list(ctx: HandlerContext): Promise<Response> {
  const rows = rowsOf(ctx, ORDER)
    .filter((o) => FILTERS.every((k) => ctx.params[k] === undefined || ([] as unknown[]).concat(ctx.params[k]).map(String).includes(String(o[k]))))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return ctx.list('Order', rows.map((o) => orderView(ctx, o)));
}
