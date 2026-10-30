// Polar's state machines, each move cited. Payment failures and the customer portal's cancellation are gaps;
// the merchant's cancellation at the period's end is served (subscriptions:update, its cancellation form).
import type { StateField } from '@volter/world-core';

/** A checkout's status: open until the customer confirms it on the hosted page (an outside party), then Polar takes the
 *  payment; it expires 24 hours after it was made. */
// source: spec:/components/schemas/CheckoutStatus "succeeded"
const checkoutStatus: StateField = {
  initial: 'open',
  transitions: [
    {
      operation: 'checkouts:client_confirm', actor: 'external', from: ['open'], to: 'confirmed',
      source: 'spec:checkouts:client_confirm "The checkout is expired, the customer already has an active subscription, or the organization is not ready to accept payments."',
    },
    { operation: 'checkouts:client_confirm', actor: 'external', from: ['confirmed', 'succeeded', 'failed', 'expired'], refusal: { status: 403, code: 'CheckoutForbiddenError', message: 'The checkout is expired, the customer already has an active subscription, or the organization is not ready to accept payments.' }, source: 'spec:checkouts:client_confirm "The checkout is expired, the customer already has an active subscription, or the organization is not ready to accept payments."' },
    { actor: 'vendor', from: ['confirmed'], to: 'succeeded', source: 'spec:checkouts:client_confirm "Orders and subscriptions will be processed."' },
    { actor: 'time', from: ['open'], to: 'expired', source: 'spec:checkouts:client_confirm "The checkout session is expired."' },
  ],
};

/** A subscription's status: it starts incomplete until its first payment (active, or trialing through a trial), and is
 *  canceled when its period ends after a cancellation. No operation the twin serves moves it further: the
 *  subscriptions' API (update, revoke) is the gap, no application of the demand calling it. */
// source: spec:/components/schemas/SubscriptionStatus "incomplete"
const subscriptionStatus: StateField = {
  initial: 'incomplete',
  transitions: [
    { operation: 'checkouts:client_confirm', actor: 'external', from: ['active', 'trialing'], refusal: { status: 403, code: 'CheckoutForbiddenError', message: 'The customer already has an active subscription.' }, source: 'spec:checkouts:client_confirm "the customer already has an active subscription"' },
    { actor: 'vendor', from: ['incomplete'], to: 'active', source: 'spec:/components/schemas/SubscriptionStatus "active"' },
    { actor: 'vendor', from: ['incomplete'], to: 'trialing', source: 'spec:/components/schemas/SubscriptionStatus "trialing"' },
    { actor: 'time', from: ['trialing'], to: 'active', source: 'https://polar.sh/docs/features/subscriptions/trials "Once the trial period ends, the customer will be automatically charged for the subscription, and their billing cycle will begin."' },
    { operation: 'subscriptions:update', actor: 'api', from: ['active', 'trialing'], source: 'spec:/components/schemas/SubscriptionCancel/properties/cancel_at_period_end "Cancel an active subscription once the current period ends."' },
    { operation: 'subscriptions:update', actor: 'api', from: ['incomplete', 'incomplete_expired', 'past_due', 'canceled', 'unpaid', 'paused'], refusal: { status: 403, code: 'NotActiveSubscription', message: 'Subscription is already canceled or will be at the end of the period, or is not active.' }, source: 'spec:subscriptions:update "Subscription is already canceled or will be at the end of the period, or is not active."' },
    { actor: 'time', from: ['active', 'trialing'], to: 'canceled', source: 'spec:/components/schemas/SubscriptionCancel/properties/cancel_at_period_end "Cancel an active subscription once the current period ends."' },
  ],
};

/** An order's status: pending until paid; a refund moves a paid order. */
// source: spec:/components/schemas/OrderStatus "partially_refunded"
const orderStatus: StateField = {
  initial: 'pending',
  transitions: [
    { actor: 'vendor', from: ['pending'], to: 'paid', source: 'spec:/components/schemas/OrderStatus "paid"' },
    { operation: 'refunds:create', actor: 'api', from: ['paid', 'partially_refunded'], to: 'partially_refunded', source: 'spec:/components/schemas/OrderStatus "partially_refunded"' },
    { operation: 'refunds:create', actor: 'api', from: ['paid', 'partially_refunded'], to: 'refunded', source: 'spec:/components/schemas/OrderStatus "refunded"' },
    { operation: 'refunds:create', actor: 'api', from: ['refunded'], refusal: { status: 403, code: 'RefundedAlready', message: 'Order is already fully refunded.' }, source: 'spec:refunds:create "Order is already fully refunded."' },
  ],
};

export const states = {
  // source: spec:/components/schemas/Product "A product."
  // Catalog/trial choices and archive flags are returned attributes; this scope
  // serves reads and creation, not merchant catalog mutations.
  Product: { notState: ['visibility', 'trial_interval', 'recurring_interval', 'meter_interval', 'is_recurring', 'is_archived'] },
  Checkout: { state: { status: checkoutStatus }, notState: ['is_business_customer', 'is_discount_applicable', 'is_free_product_price', 'is_payment_form_required', 'is_payment_required', 'is_payment_setup_required'] },
  Subscription: { state: { status: subscriptionStatus }, notState: ['recurring_interval', 'cancel_at_period_end'] },
  Order: { state: { status: orderStatus }, notState: ['billing_reason', 'is_invoice_generated', 'paid'] },
  Meter: { notState: ['unit'] },
  WebhookEndpoint: { notState: ['format'] },
};
