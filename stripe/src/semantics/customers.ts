// Stripe's customers operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { newCustomer } from '../engine/customers.ts';
import { nowUnix } from '../engine/stripe.ts';
import { at, attachable, attachPaymentMethod, created, customerMissing, expanded, fail, search } from './shared.ts';
// "If it’s for a deleted Customer, a subset of the customer’s information is returned, including a `deleted` property
// that’s set to true" (docs.stripe.com/api/customers/retrieve)
export async function GetCustomersCustomer(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'customer');
  const row = ctx.row('customer', id, { withDeleted: true });
  if (!row) return customerMissing(ctx, id);
  if (row.deleted === true) return ctx.reply({ id, object: 'customer', deleted: true });
  return ctx.reply(expanded(ctx, 'customer', ctx.get('customer', id)!));
}

export async function GetCustomersSearch(ctx: HandlerContext): Promise<Response> {
  return search(ctx, 'customer');
}

export async function PostCustomers(ctx: HandlerContext): Promise<Response> {
  // `payment_method` attaches that method to the new customer; it is not a field of the customer
  // (docs.stripe.com/api/customers/create#create_customer-payment_method)
  const pmId = typeof ctx.params.payment_method === 'string' ? ctx.params.payment_method : '';
  if (pmId && !attachable(ctx, pmId)) return fail(ctx, `No such PaymentMethod: '${pmId}'`, 400, 'resource_missing');
  const given = ctx.params;
  const { coupon: _c, payment_method: _pm, ...rest } = given;
  const id = ctx.mint('customer');
  const customer = await created(ctx, 'customer', { ...rest, id }, { livemode: false, discount: null, ...newCustomer(id) });
  // source: https://docs.stripe.com/billing/customer/balance "Represents the starting value of the customer invoice balance when a customer is created using the API with a non-zero invoice balance."
  if (Number(customer.balance ?? 0) !== 0) {
    await created(ctx, 'customer_balance_transaction', {
      customer: id, amount: Number(customer.balance), ending_balance: Number(customer.balance),
      currency: customer.currency ?? 'usd', type: 'initial', description: null, metadata: {},
      livemode: false, invoice: null, credit_note: null, checkout_session: null, customer_account: null,
    }, {});
  }
  if (pmId) await attachPaymentMethod(ctx, pmId, String(customer.id));
  return ctx.reply(customer);
}

// ── the credit-balance ledger: a negative amount is a credit; `ending_balance` is the running sum,
// mirrored onto the customer's `balance` ──


// source: spec:PostCustomersCustomer "Updates the specified customer by setting the values of the parameters passed."
export async function PostCustomersCustomer(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'customer');
  const customer = ctx.get('customer', id);
  if (!customer) return customerMissing(ctx, id);
  const { customer: _pathCustomer, ...fields } = ctx.params;
  // source: https://docs.stripe.com/billing/customer/balance "All modifications to the invoice balance are recorded as Transactions"
  // source: https://docs.stripe.com/billing/customer/balance "All Transactions created with the API or in the Dashboard have a type value of adjustment"
  if (typeof fields.balance === 'number' && fields.balance !== Number(customer.balance ?? 0)) {
    const balance = fields.balance;
    await created(ctx, 'customer_balance_transaction', {
      customer: id, amount: balance - Number(customer.balance ?? 0), ending_balance: balance,
      // Stripe inherits the customer's billing currency. Where no invoice has set it, this World's invoice currency is USD.
      currency: customer.currency ?? 'usd', type: 'adjustment',
      description: null, metadata: {}, livemode: false,
      invoice: null, credit_note: null, checkout_session: null, customer_account: null,
      created: nowUnix(ctx.occurredAt),
    }, {});
  }
  return ctx.reply(ctx.expand('customer', await ctx.write('customer', id, fields, 'customer.update')));
}
