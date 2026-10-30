// Refunds of an original paid order. Polar's amount is cents, exclusive of tax;
// this twin's checkout orders have no tax (shared.ts's orderFields).
import type { HandlerContext } from '@volter/world-core';
import { bodyOf, environment, fail, invalid, ORDER, orgId, rowOf, vendorFields } from './shared.ts';

// source: spec:refunds:create "Create a refund."
// source: spec:/components/schemas/RefundCreate "Amount to refund in cents. Minimum is 1."
export async function refunds_create(ctx: HandlerContext): Promise<Response> {
  const body = bodyOf(ctx);
  if (typeof body.order_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.order_id))
    return invalid(['order_id'], 'Input should be a valid UUID version 4.');
  if (!Number.isSafeInteger(body.amount) || Number(body.amount) < 1) return invalid(['amount'], 'Amount must be a positive integer.');
  if (!['duplicate', 'fraudulent', 'customer_request', 'service_disruption', 'satisfaction_guarantee', 'other'].includes(String(body.reason)))
    return invalid(['reason'], 'Choose a documented refund reason.');
  if (body.revoke_benefits !== undefined && typeof body.revoke_benefits !== 'boolean') return invalid(['revoke_benefits'], 'Input should be a valid boolean.');
  if (body.comment != null && typeof body.comment !== 'string') return invalid(['comment'], 'Input should be a valid string.');
  const metadata = body.metadata ?? {};
  if (typeof metadata !== 'object' || Array.isArray(metadata) || Object.keys(metadata).length > 50 || Object.entries(metadata).some(([k, v]) =>
    k.length < 1 || k.length > 40 || !['string', 'number', 'boolean'].includes(typeof v) || typeof v === 'string' && (v.length < 1 || v.length > 500)))
    return invalid(['metadata'], 'Invalid refund metadata.');
  const order = rowOf(ctx, ORDER, body.order_id);
  if (!order) return invalid(['order_id'], 'Order does not exist.');
  // source: spec:/components/schemas/RefundCreate/properties/revoke_benefits "Only allowed in case the `order` is a one-time purchase."
  if (body.revoke_benefits === true && order.subscription_id != null) return invalid(['revoke_benefits'], 'Subscription benefits are revoked by canceling the subscription.');

  const amount = Number(body.amount);
  let refusal: Response | undefined, claimed = false;
  // The available balance is judged under the same action lock as the write.
  // Parallel requests cannot refund more than the original paid amount.
  await ctx.change('Order', body.order_id, (current) => {
    if (current.status === 'refunded') {
      refusal = fail(403, 'RefundedAlready', 'Order is already fully refunded.');
      return undefined;
    }
    if (!['paid', 'partially_refunded'].includes(String(current.status))) {
      refusal = invalid(['order_id'], 'Only a paid order can be refunded.');
      return undefined;
    }
    const refunded = Number(current.refunded_amount ?? 0) + amount, total = Number(current.total_amount);
    if (refunded > total) {
      refusal = invalid(['amount'], 'Amount exceeds the remaining refundable balance.');
      return undefined;
    }
    const status = refunded === total ? 'refunded' : 'partially_refunded';
    ctx.legal('Order', 'status', 'refunds:create', current.status, status, body.order_id as string, 'api');
    claimed = true;
    return { status, refunded_amount: refunded, refundable_amount: total - refunded, modified_at: ctx.occurredAt };
  }, 'order.refund');
  if (!claimed) return refusal ?? invalid(['order_id'], 'Order is unavailable.');
  // source: spec:/components/schemas/Refund "Refund"
  // Mint and retain under the kernel's create lock too: concurrent refunds of
  // different orders must receive different IDs.
  const refund = await ctx.create('_refund', id => ({
    id, created_at: ctx.occurredAt, modified_at: ctx.occurredAt, metadata, status: 'succeeded', reason: body.reason,
    amount, tax_amount: 0, currency: order.currency, organization_id: orgId(ctx), order_id: order.id,
    subscription_id: order.subscription_id ?? null, customer_id: order.customer_id, revoke_benefits: body.revoke_benefits ?? false, dispute: null,
    _environment: environment(ctx), _comment: body.comment ?? null,
  }), 'refund.create');
  return Response.json(vendorFields(ctx, refund), { status: 201 });
}
