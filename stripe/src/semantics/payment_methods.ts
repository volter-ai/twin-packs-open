// Stripe's payment_methods operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { PM } from '../engine/payment-methods.ts';
import { at, pmMissing } from './shared.ts';
export async function GetPaymentMethodsPaymentMethod(ctx: HandlerContext): Promise<Response> {
  const m = ctx.get(PM, at(ctx, 'payment_method'));
  return m ? ctx.reply(m) : pmMissing(ctx, at(ctx, 'payment_method'));
}

// the raw card number, cvc and bank account number are never echoed: the modeled sub-object is
// what the PaymentMethod carries, with the decline outcome its card implies, so a later charge
// naming it only by id declines the same way


export async function PostPaymentMethodsPaymentMethodDetach(ctx: HandlerContext): Promise<Response> {
  const id = at(ctx, 'payment_method');
  if (!ctx.get(PM, id)) return pmMissing(ctx, id);
  return ctx.reply(await ctx.write(PM, id, { customer: null }, 'payment_method.detach'));
}
