// Stripe's payment_intents operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import { PI, TYPES_GIVEN } from '../engine/payment-intents.ts';
import { asBool, mintClientSecret, nowUnix, validateMoney } from '../engine/stripe.ts';
import { confirmIntent, intentFields, confirmOnly, methodFromData, paymentIntentsSend } from './shared.ts';
import { cancelAuthorization, paymentIntentsLoad } from './shared.ts';
export async function PostPaymentIntents(ctx: HandlerContext): Promise<Response> {
  const params = ctx.params;
  const bad = validateMoney(params);
  if (bad) return paymentIntentsSend(ctx, bad);
  // what describes a confirmation needs one: error_on_requires_action, mandate, mandate_data, off_session and return_url
  // are each, in the served spec, a parameter that "can only be used with `confirm=true`" (shared.ts confirmOnly)
  const unconfirmed = confirmOnly(ctx, ['error_on_requires_action', 'mandate', 'mandate_data', 'off_session', 'return_url'], asBool(params.confirm));
  if (unconfirmed) return unconfirmed;
  // automatic_payment_methods: when enabled, Stripe selects eligible methods and answers the
  // normalized { enabled, allow_redirects } object
  const apmIn = params.automatic_payment_methods;
  const apmEnabled = apmIn && typeof apmIn === 'object' ? asBool((apmIn as Record<string, unknown>).enabled) : false;
  const automatic_payment_methods = apmEnabled ? { enabled: true, allow_redirects: ((apmIn as Record<string, unknown>).allow_redirects as string) ?? 'always' } : null;
  // the methods it may be paid with: allowed_payment_method_types in the served version, payment_method_types for a
  // caller pinned to an earlier one (docs.stripe.com/api/payment_intents/create)
  const given = Array.isArray(params.allowed_payment_method_types) ? params.allowed_payment_method_types : params.payment_method_types;
  const payment_method_types = Array.isArray(given) ? given.map(String) : ['card'];
  // `confirm` is an instruction, not a field: `confirm=true` attempts to confirm the intent at once
  // (https://docs.stripe.com/api/payment_intents/create#create_payment_intent-confirm)
  const { automatic_payment_methods: _a, payment_method_types: _p, allowed_payment_method_types: _ap, id: provided, expand: _e, confirm: confirmNow, payment_method_data: data, mandate_data: _mandate, ...rest } = params;
  // a create's payment_method_data makes its method, as a confirm's does (payment-methods.ts methodFromData)
  const made = await methodFromData(ctx, data);
  if (made) rest.payment_method = made;
  // the id is minted first so the client secret can carry it: Stripe.js parses the id back out
  const id = typeof provided === 'string' && provided ? provided : ctx.mint(PI);
  // it waits for a payment method until it has one, then for its confirmation (manifest.ts)
  const hasMethod = typeof rest.payment_method === 'string' && rest.payment_method !== '';
  if (hasMethod) ctx.legal(PI, 'status', 'PostPaymentIntents', 'requires_payment_method', 'requires_confirmation', id);
  const body = await ctx.write(
    PI,
    id,
    {
      object: 'payment_intent',
      created: nowUnix(ctx.occurredAt),
      status: hasMethod ? 'requires_confirmation' : 'requires_payment_method',
      client_secret: mintClientSecret(id, await ctx.secret(`client-secret:${id}`)),
      livemode: false,
      capture_method: 'automatic',
      amount_capturable: 0,
      amount_received: 0,
      next_action: null,
      automatic_payment_methods,
      payment_method_types,
      ...(Array.isArray(params.allowed_payment_method_types) ? { allowed_payment_method_types: payment_method_types } : {}),
      payment_method_options: (params.payment_method_options as object) ?? {},
      ...intentFields(rest),
    },
    'payment_intent.create',
  );
  if (Array.isArray(given)) await ctx.record(TYPES_GIVEN, { payment_intent: id }, id);
  if (asBool(confirmNow)) return confirmIntent(ctx, body, { ...params, payment_method: rest.payment_method });
  return ctx.reply(ctx.expand(PI, body));
}


// source: spec:GetPaymentIntentsSearch "Search for PaymentIntents"



export async function PostPaymentIntentsIntentCancel(ctx: HandlerContext): Promise<Response> {
  const loaded = paymentIntentsLoad(ctx, 'PostPaymentIntentsIntentCancel');
  if ('answer' in loaded) return loaded.answer;
  const cancellation_reason = typeof ctx.params.cancellation_reason === 'string' ? ctx.params.cancellation_reason : 'requested_by_customer';
  // "For PaymentIntents with a `status` of `requires_capture`, the remaining `amount_capturable` is automatically
  // refunded" (docs.stripe.com/api/payment_intents/cancel): the authorization is released (charges.ts)
  const held = loaded.pi.status === 'requires_capture' && typeof loaded.pi.latest_charge === 'string' ? ctx.get('charge', loaded.pi.latest_charge) : undefined;
  if (held && held.captured === false && held.refunded !== true) await cancelAuthorization(ctx, held);
  return ctx.reply(ctx.expand(PI, await ctx.write(PI, String(loaded.pi.id), { status: 'canceled', cancellation_reason, amount_capturable: 0 }, 'payment_intent.canceled')));
}
