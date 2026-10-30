// The pre-authenticated customer portal opened by the application's Manage billing link.
import type { HandlerContext } from '@volter/world-core';
import { rowOf, CUSTOMER, customerView, orderView, ORDER, productView, PRODUCT, rowsOf, SESSION, SUBSCRIPTION } from '../semantics/shared.ts';

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

// source: https://polar.sh/docs/features/customer-portal/navigate-customers "no email code required"
// source: https://polar.sh/docs/features/customer-portal "active subscriptions"
export async function screen(ctx: HandlerContext): Promise<Response> {
  const token = new URL(ctx.call.request.url).searchParams.get('customer_session_token');
  const session = rowsOf(ctx, SESSION).find((s) => s.token === token && String(s.expires_at) > ctx.occurredAt);
  if (!session) return new Response('Unauthorized', { status: 401 });
  const customer = rowOf(ctx, CUSTOMER, String(session.customer_id));
  if (!customer) return new Response('Customer not found', { status: 404 });
  const subscriptions = rowsOf(ctx, SUBSCRIPTION).filter((s) => s.customer_id === customer.id && ['active', 'trialing'].includes(String(s.status)));
  const orders = rowsOf(ctx, ORDER).filter((o) => o.customer_id === customer.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const plans = subscriptions.map((s) => `<li>${esc(productView(ctx, rowOf(ctx, PRODUCT, String(s.product_id))!).name)}: ${esc(s.status)}</li>`).join('');
  const history = orders.map((o) => { const v = orderView(ctx, o); return `<li>${esc(v.invoice_number)} — ${esc(v.currency)} ${(Number(v.total_amount) / 100).toFixed(2)}</li>`; }).join('');
  return new Response(`<!doctype html><html lang="en"><title>Customer portal</title><main><h1>Billing for ${esc(customerView(ctx, customer).email)}</h1><h2>Subscriptions</h2><ul>${plans || '<li>No active subscriptions</li>'}</ul><h2>Purchase history</h2><ul>${history || '<li>No purchases</li>'}</ul><a href="${esc(session.return_url)}">Return to the application</a></main></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
