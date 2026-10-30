// The hosted checkout (buy.polar.sh/<client secret>): what a customer sees after "continue to checkout" — the product,
// the price, their email, a test card, and Pay, which confirms the checkout through Polar's client API and returns the
// customer to the application's success URL (its `{CHECKOUT_ID}` filled, as Polar fills it).
// Declared in the manifest's screens (buy.polar.sh, `/{client_secret}`): the kernel calls `screen` for the page and for
// its Pay form (`/{client_secret}/pay`), over a context whose params carry the client secret; the page reads and pays
// through Polar's client API handlers.
// source: spec:/components/schemas/CheckoutProductsCreate/properties/success_url "{CHECKOUT_ID}"
import type { HandlerContext } from '@volter/world-core';
import { checkouts_client_confirm, checkouts_client_get } from '../semantics/checkouts.ts';

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

export async function screen(ctx: HandlerContext): Promise<Response> {
  const secret = String(ctx.call.params.client_secret);
  const paying = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '').endsWith('/pay');
  const base = ctx.publicBase.replace(/\/+$/, '');
  const read = await checkouts_client_get(ctx);
  if (!read.ok) return new Response('This checkout does not exist.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const c = (await read.json()) as { id: string; status: string; amount: number; currency: string; success_url: string; customer_email: string | null; product: { name: string; recurring_interval: string | null } | null };
  if (paying && ctx.call.request.method === 'POST') {
    const form = new URLSearchParams(ctx.text);
    // the page pays as Polar's own page does: the client API's confirm, with the email the customer gave
    const done = await checkouts_client_confirm({ ...ctx, body: { customer_email: form.get('email') || c.customer_email, confirmation_token_id: await ctx.secret(`test-stripe-confirmation:${c.id}`) } });
    if (!done.ok) return new Response(`The payment could not be completed (${done.status}).`, { status: done.status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response(null, { status: 303, headers: { location: c.success_url.replace('{CHECKOUT_ID}', c.id) } });
  }
  const money = `$${(Number(c.amount) / 100).toFixed(2)}`;
  const per = c.product?.recurring_interval ? ` / ${c.product.recurring_interval}` : '';
  const body = c.status !== 'open'
    ? `<p>This checkout is ${esc(c.status)}.</p>`
    : `<form method="post" action="${esc(base)}/${esc(secret)}/pay"><label>Email<input name="email" type="email" required value="${esc(c.customer_email)}"></label><label>Card<input value="4242 4242 4242 4242" readonly></label><button type="submit">Pay ${esc(money)}${esc(per)}</button></form>`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkout</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#f7f7f8;margin:0}main{max-width:440px;margin:48px auto;background:#fff;border:1px solid #e5e5e8;border-radius:12px;padding:28px}h1{font-size:20px;margin:0}p.price{font-size:30px;font-weight:600;margin:10px 0 20px}label{display:block;font-size:13px;color:#555;margin:12px 0}input{display:block;width:100%;box-sizing:border-box;padding:9px;border:1px solid #ccc;border-radius:8px;font:inherit;margin-top:4px}button{margin-top:16px;width:100%;padding:11px;border:0;border-radius:8px;background:#0062ff;color:#fff;font:inherit;cursor:pointer}</style></head><body><main><h1>${esc(c.product?.name ?? 'Checkout')}</h1><p class="price">${esc(money)}<small>${esc(per)}</small></p>${body}</main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
