// Customer sessions: a token a customer's browser carries into the customer portal.
import type { HandlerContext } from '@volter/world-core';
import { bodyOf, customerBy, createSession, invalid, missing } from './shared.ts';

// source: spec:customer-sessions:create "Create a customer session."
export async function customer_sessions_create(ctx: HandlerContext): Promise<Response> {
  const body = bodyOf(ctx);
  if (body.customer_id === undefined && body.external_customer_id === undefined) return missing('customer_id');
  const customer = body.customer_id !== undefined ? customerBy(ctx, { id: body.customer_id }) : customerBy(ctx, { external: body.external_customer_id });
  // source: spec:customer-sessions:create "Validation Error"
  if (!customer) return invalid([body.customer_id !== undefined ? 'customer_id' : 'external_customer_id'], 'Customer does not exist.');
  return Response.json(await createSession(ctx, customer, body.return_url), { status: 201 });
}
