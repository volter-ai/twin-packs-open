// Stripe's state machines and the state candidates it rules not state (docs/contributing/architecture.md, "What an
// author writes": states), each move cited; the manifest takes each resource's whole.
import type { StateField, Transition } from '@volter/world-core';

const OPEN = ['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture', 'processing'];

/** A move no API call makes: Stripe's own (`vendor`), the clock's (`time`), or the person on a
 *  Stripe-hosted page (`external`: Checkout, the billing portal, a hosted invoice or 3DS page). */
const by = (actor: 'vendor' | 'time' | 'external', from: string[], to: string, source: string): Transition => ({ actor, from, to, source });
/** A bank account's `status` as a payout or payment destination. Stripe validates its routing number,
 *  verifies it (micro-deposits, or instantly) and marks it errored when a payout or debit to it fails
 *  (the page each machine cites); no call the twin serves does any of that (the customer-source verify is
 *  a gap), so no move of it is the twin's. */
const bankAccountStatus = (_doc: string): StateField => ({ initial: 'new', transitions: [] });

/** A flag an update sets either way. */
const flag = (operation: string, source: string): Transition[] => ['true', 'false'].map((to) => ({ operation, from: '*' as const, to, source }));

/** A PaymentIntent's `status`: which operation may move it from where, and what Stripe answers otherwise. */
const paymentIntentStatus: StateField = {
  // "After you create the PaymentIntent, its status is `requires_payment_method` until you attach a payment method"
  // (docs.stripe.com/payments/paymentintents/lifecycle)
  initial: 'requires_payment_method',
  transitions: [
    // created with its payment method, it "enters the `requires_confirmation` status and is ready to confirm" (the same page)
    { operation: 'PostPaymentIntents', from: ['requires_payment_method'], to: 'requires_confirmation', source: 'https://docs.stripe.com/payments/paymentintents/lifecycle' },
    // a bank debit confirmed (created with `confirm`, or confirmed) is submitted and processes: "The PaymentIntent you
    // create initially has a status of `processing`"
    ...['PostPaymentIntents',].map((operation) => ({
      operation, from: ['requires_payment_method', 'requires_confirmation', 'requires_action'], to: 'processing',
      source: 'https://docs.stripe.com/payments/ach-direct-debit/accept-a-payment?payment-ui=direct-api',
    })),
    // and succeeds: "After the payment has succeeded, the PaymentIntent status is updated from `processing`
    // to `succeeded`" (../engine/payment-intents.ts settleBankDebits)
    by('vendor', ['processing'], 'succeeded', 'https://docs.stripe.com/payments/ach-direct-debit/accept-a-payment?payment-ui=direct-api'),
    // creating one with `confirm` confirms it at once, landing where a confirm lands
    ...['requires_payment_method', 'requires_action', 'requires_capture', 'succeeded'].map((to) => ({
      operation: 'PostPaymentIntents',
      from: ['requires_payment_method', 'requires_confirmation'],
      to,
      source: 'spec:PostPaymentIntents "Set to `true` to attempt to [confirm this PaymentIntent](https://docs.stripe.com/api/payment_intents/confirm) immediately."',
    })),
    {
      operation: 'PostPaymentIntentsIntentCancel', from: OPEN, to: 'canceled',
      refusal: { status: 400, code: 'payment_intent_unexpected_state', message: 'You cannot cancel this PaymentIntent because it has a status of {from}. Only a PaymentIntent with one of the following statuses may be canceled: requires_payment_method, requires_capture, requires_confirmation, requires_action, processing.' },
      source: 'https://docs.stripe.com/api/payment_intents/cancel',
    },
    {
      // paying the invoice an intent collects for settles the intent
      operation: 'PostInvoicesInvoicePay',
      from: OPEN,
      to: 'succeeded',
      source: 'https://docs.stripe.com/api/invoices/pay',
    },
    // the customer pays, in the billing portal, the invoice an intent collects for after its charge was declined
    by('external', ['requires_payment_method'], 'succeeded', 'https://docs.stripe.com/customer-management'),
    // Stripe also fails a bank debit back to needing a payment method, completes 3-D Secure on the bank's page and
    // cancels a hold left uncaptured; the twin's bank debits succeed unless their test account stays processing, it has no 3-D Secure page, and it keeps
    // holds until they are canceled. Capture, increment_authorization, verify_microdeposits, apply_customer_balance and
    // the Terminal reader's present_payment_method are the gap (no demand, life step or refresh sends them:
    // ../manifest.ts unmodeled), so no move of theirs is declared.
  ],
};

/** A charge's `captured`: an authorization (capture_method=manual) is captured once, by the Charges API's capture or
 *  its PaymentIntent's; both are the gap here (no demand, life step or refresh sends them: ../manifest.ts unmodeled), so
 *  a held charge stays uncaptured until its intent is canceled, and no move is declared. */
const chargeCaptured: StateField = {
  initial: true,
  transitions: [],
};

/** A charge's `refunded`: true once refunds take its whole amount. A capture or a cancel never makes it so: "`refunded` will no longer be `true` for payment cancellation
 *  flows", and a partial capture makes no Refund (docs.stripe.com/changelog/basil/2025-03-31/remove-refund-from-partial-
 *  capture-and-payment-cancellation-flow). */
const chargeRefunded: StateField = {
  initial: false,
  transitions: [
    { operation: 'PostRefunds', from: ['false'], to: 'true', source: 'https://docs.stripe.com/api/charges/object#charge_object-refunded' },
    // (a charge's own refunds path, a credit note's refund and a refund's cancel are the gap here: ../manifest.ts unmodeled)
    // (an authorization left uncaptured is canceled after seven days, "Uncaptured PaymentIntents are cancelled a set
    // number of days (7 by default) after their creation", docs.stripe.com/api/payment_intents/capture; the twin keeps it)
  ],
};

/** A charge's `status`: the twin settles a charge when it is made (a declined one is never
 *  stored); an asynchronous one settles later, on the network's word. */
const chargeStatus: StateField = {
  initial: 'succeeded',
  transitions: [
    // (an asynchronous charge is pending at Stripe until it settles or fails; the twin's settle when made)
  ],
};

/** A charge's `paid`: true once it succeeded or was authorized; a pending one becomes paid when it settles. */
const chargePaid: StateField = {
  initial: true,
  // (a charge is paid when it settles; the twin's settle when made)
  transitions: [],
};

/** A refund's `status`: held pending for want of balance, then made; the rest is the network's. (Canceling one that
 *  waits on the customer is the gap here: ../manifest.ts unmodeled.) */
const refundStatus: StateField = {
  initial: 'succeeded',
  transitions: [
    { operation: 'PostRefunds', from: ['succeeded'], to: 'pending', source: 'https://docs.stripe.com/refunds' },
    by('vendor', ['pending'], 'succeeded', 'https://docs.stripe.com/refunds'),
    // a bank-transfer payment's refund waits in requires_action for the customer's bank details, and is made so
    // (semantics/refunds.ts); (Stripe also fails some refunds; the twin's do not fail)
  ],
};

/** A SetupIntent's `status`: confirm settles it, or leaves a bank account awaiting micro-deposits. (Its cancel and its
 *  micro-deposit verification are the gap here: ../manifest.ts unmodeled.) */
const setupIntentStatus: StateField = {
  // "After you create the SetupIntent, it has a status of `requires_payment_method` until you attach a payment method"
  // (docs.stripe.com/payments/paymentintents/lifecycle)
  initial: 'requires_payment_method',
  transitions: [
    // (Stripe completes 3-D Secure on the bank's page and settles an asynchronous method from processing; the
    // twin has no such page and settles every method at once)
  ],
};

const invoiceRefusal = (message: string) => ({ status: 400, code: 'invoice_not_editable', message });

/** An invoice's `status`: a draft is finalized (or sent, which finalizes it) into open, an open one
 *  is paid, written off or voided. Sending leaves any other status where it is. */
const invoiceStatus: StateField = {
  initial: 'draft',
  transitions: [
    { operation: 'PostInvoicesInvoicePay', from: ['draft'], to: 'open', source: 'https://docs.stripe.com/invoicing/integration' },
    {
      // paying a draft finalizes it on the way: "To finalize a draft invoice, use the Dashboard, send it to the customer, or
      // pay it" (docs.stripe.com/invoicing/integration)
      operation: 'PostInvoicesInvoicePay',
      from: ['draft', 'open', 'uncollectible'],
      to: 'paid',
      refusal: invoiceRefusal('This invoice cannot be paid because it has status {from}.'),
      refusals: { paid: { status: 400, code: 'invoice_payment_intent_requires_action', message: 'This invoice has already been paid.' } },
      source: 'https://docs.stripe.com/api/invoices/pay',
    },
    // (marking one uncollectible is the gap here: ../manifest.ts unmodeled)
    // a guard: only a draft is deleted; a finalized invoice is voided instead
    // in any other state it is refused (a refusal with no `to` refuses where it stands)
    {
      // only a finalized invoice is voided; a draft is deleted
      operation: 'PostInvoicesInvoiceVoid',
      from: ['open', 'uncollectible'],
      to: 'void',
      refusal: invoiceRefusal('This invoice cannot be voided because it has status {from}.'),
      source: 'https://docs.stripe.com/api/invoices/void',
    },
    // confirming the PaymentIntent an invoice collects through pays the invoice
    // as does its bank debit succeeding once submitted (../engine/payment-intents.ts settleBankDebits)
    by('vendor', ['draft', 'open', 'uncollectible'], 'paid', 'https://docs.stripe.com/billing/subscriptions/build-subscriptions'),
    // (a bank transfer reconciled from the customer's cash balance pays one at Stripe; funding a cash balance is the gap
    // here: ../manifest.ts unmodeled)
    // a subscription's first invoice is paid on the Checkout page that started it
    by('external', ['draft'], 'paid', 'https://docs.stripe.com/payments/checkout/how-checkout-works'),
    // a subscription's renewal, drafted at its period's end, is finalized about an hour later and charged: paid, or
    // open when the charge is declined (../engine/renewals.ts)
    by('time', ['draft'], 'paid', 'https://docs.stripe.com/invoicing/integration/workflow-transitions#finalized'),
    by('time', ['draft'], 'open', 'https://docs.stripe.com/billing/subscriptions/overview#payment-status'),
    // an update that ends a subscription's trial invoices its new period and attempts payment at once: paid, or open
    // when the charge is declined or not attempted (semantics/subscriptions.ts applyTrialEnd)
    { operation: 'PostSubscriptionsSubscriptionExposedId', from: ['draft'], to: 'paid', source: 'https://docs.stripe.com/billing/subscriptions/upgrade-downgrade#immediate-payment' },
    // a trialing subscription's first invoice, for nothing, is paid as it is made ("An immediate invoice is still
    // created, but the amount is 0", docs.stripe.com/billing/subscriptions/trials/free-trials)
    { operation: 'PostSubscriptionsSubscriptionExposedId', from: ['draft'], to: 'open', source: 'https://docs.stripe.com/billing/subscriptions/upgrade-downgrade#immediate-payment' },
    // the customer pays an open invoice in the billing portal
    by('external', ['open'], 'paid', 'https://docs.stripe.com/customer-management'),
    // (Stripe also finalizes any other auto-advancing draft after an hour, retries an open invoice on its schedule
    // and, retries exhausted, may write it off, and takes payment on the hosted invoice page; the twin's other
    // invoices move only by the calls above)
  ],
};

/** A subscription's `status` as the twin's own operations move it; canceling ends any subscription. */
const subscriptionStatus: StateField = {
  initial: 'active',
  transitions: [
    { operation: 'DeleteSubscriptionsSubscriptionExposedId', from: '*', to: 'canceled', source: 'https://docs.stripe.com/api/subscriptions/cancel' },
    // (a test clock's advance moves no subscription itself: when the clock reaches its target, a trial that ended there
    // ends by time's move below, on the next request; ../engine/test-clocks.ts finishClockAdvances)
    // (canceling a subscription schedule, which cancels its subscription, is the gap here: ../manifest.ts unmodeled)
    // confirming the first invoice's PaymentIntent, or paying the invoice itself, pays it and activates the subscription
    // or when its bank debit succeeds once submitted (../engine/payment-intents.ts settleBankDebits)
    by('vendor', ['incomplete'], 'active', 'https://docs.stripe.com/billing/subscriptions/build-subscriptions'),
    // paying the invoice a subscription waits on (its first, or a renewal that failed) makes it active
    { operation: 'PostInvoicesInvoicePay', from: ['incomplete', 'past_due'], to: 'active', source: 'https://docs.stripe.com/billing/subscriptions/overview#payment-status' },
    // an update's `trial_end`: `now` ends a trial at once and charges the new period, active when paid and past_due when
    // not; a future timestamp starts a trial on a subscription out of one (semantics/subscriptions.ts applyTrialEnd)
    { operation: 'PostSubscriptionsSubscriptionExposedId', from: ['trialing'], to: 'active', source: 'https://docs.stripe.com/api/subscriptions/update#update_subscription-trial_end' },
    { operation: 'PostSubscriptionsSubscriptionExposedId', from: ['trialing'], to: 'past_due', source: 'https://docs.stripe.com/billing/subscriptions/upgrade-downgrade#immediate-payment' },
    {
      operation: 'PostSubscriptionsSubscriptionExposedId', from: ['active', 'past_due'], to: 'trialing',
      // (Where the documentation stops and the twin decides: the wording of the refusal for a subscription neither
      // active nor past_due; a canceled one answers what Stripe answers any update of a canceled subscription.)
      refusal: { status: 400, message: 'A trial can only be added to an active or past_due subscription; this one is {from}.' },
      refusals: { canceled: { status: 400, message: 'A canceled subscription can only update its cancellation_details and metadata.' } },
      source: 'https://docs.stripe.com/billing/subscriptions/trials/free-trials#adding-a-new-trial-to-a-subscription-previously-in-a-trial',
    },
    // a trial ends on its own clock (Stripe pauses one that ends with no payment method to bill; the twin's
    // trials end active), and a renewal whose charge is declined leaves the subscription past_due
    // (../engine/renewals.ts)
    by('time', ['trialing'], 'active', 'https://docs.stripe.com/billing/subscriptions/trials'),
    by('time', ['active'], 'past_due', 'https://docs.stripe.com/billing/subscriptions/overview#payment-status'),
    // one set to cancel at its period's end is canceled when the period ends
    by('time', ['active', 'trialing', 'past_due'], 'canceled', 'https://docs.stripe.com/billing/subscriptions/cancel#cancel-at-end-of-cycle'),
    // the customer pays the invoice it waits on in the billing portal
    by('external', ['past_due'], 'active', 'https://docs.stripe.com/customer-management'),
    // (Stripe also expires an incomplete subscription after 23 hours, and retries a failed renewal on its schedule,
    // the settings ending the retries unpaid or canceled; the twin makes no retry)
    // the customer cancels in the billing portal
    by('external', ['active', 'trialing', 'past_due', 'unpaid', 'paused'], 'canceled', 'spec:/components/schemas/portal_subscription_cancel "Whether to cancel subscriptions immediately or at the end of the billing period."'),
  ],
};

const notOpen = (verb: string) => ({ status: 400, code: 'checkout_session_not_open', message: `You may only ${verb} a Checkout Session that is currently in the \`open\` state.` });

/** A Checkout Session's `status`: an open session expires (asked to, or 24 hours on), or completes
 *  when the customer pays on the hosted page. Completion is the external actor's move, the one the
 *  hosted Checkout page (src/screens/checkout.tsx) performs. */
const checkoutStatus: StateField = {
  initial: 'open',
  transitions: [
    { actor: 'external', from: ['open'], to: 'complete', refusal: notOpen('complete'), source: 'https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-status' },
    // (Stripe expires an open session at expires_at; the twin keeps it open until asked)
  ],
};

/** A Checkout Session's `payment_status`: the customer completing a payment or subscription session
 *  pays it; a delayed payment method settles later. */
const checkoutPaymentStatus: StateField = {
  initial: 'unpaid',
  transitions: [
    { actor: 'external', from: '*', to: 'paid', source: 'https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-payment_status' },
    // (a delayed method settles a session later at Stripe; the twin's settle on the page)
  ],
};

/** A dispute's `status`: a disputed test card's charge opens one (needs_response, or warning_needs_response for an
 *  inquiry). Submitting evidence and closing (conceding) are the gap here (../manifest.ts unmodeled), so nothing puts a
 *  dispute under review for the bank to decide; the bank escalates an inquiry and loses one left unanswered at
 *  Stripe, and the twin decides none. */
const disputeStatus: StateField = {
  initial: 'warning_needs_response',
  transitions: [],
};

/** A payout's `status`: cancel ends it; reversing cancels it and pays a reversal, never twice. */
const payoutStatus: StateField = {
  initial: 'pending',
  transitions: [
    // (canceling a pending payout and reversing a paid one are the gap here: ../manifest.ts unmodeled)
    // it arrives in the bank on its arrival date
    by('time', ['pending'], 'paid', 'https://docs.stripe.com/payouts#payout-statuses'),
    // (a bank may fail a payout at Stripe; the twin's arrive)
  ],
};

/** A credit note's `status`: issued, then voided once at Stripe. Issuing and voiding one are the gap here
 *  (../manifest.ts unmodeled): a vendor-backed World reads credit notes back from its root (GetCreditNotes). */
const creditNoteStatus: StateField = {
  initial: 'issued',
  transitions: [],
};

/** A subscription schedule's `status`: releasing ends it, and an ended one refuses it. (Canceling one is the gap here:
 *  ../manifest.ts unmodeled.) */
const scheduleStatus: StateField = {
  initial: 'active',
  transitions: [
    // "A schedule can only be released if its status is not_started or active" (the release page)
    // its phases run on the clock: it starts at its start date and ends with its last phase
    // (a schedule whose end_behavior is cancel completes at its end at Stripe; the twin's release)
    // (Stripe starts a schedule at its start date and ends it with its last phase; the twin's start at once
    // and end when canceled or released)
  ],
};

/** A quote's `status`: at Stripe a draft is finalized into open, an open one accepted, and either canceled. Quotes are
 *  the gap here (../manifest.ts unmodeled): a vendor-backed World reads them back from its root (GetQuotes), so no
 *  move is the twin's. */
const quoteStatus: StateField = {
  initial: 'draft',
  transitions: [],
};

const setBy = (operation: string, values: string[], source: string): Transition[] => values.map((to) => ({ operation, from: '*' as const, to, source }));

/** An Issuing authorization's `status`: approve and decline close a pending one, once; a capture
 *  closes it, or leaves it pending when told not to close. */
const issuingAuthorizationStatus: StateField = {
  initial: 'pending',
  transitions: [
    // approving keeps it pending (approved) until the merchant captures; declining closes it
    { operation: 'PostIssuingAuthorizationsAuthorizationApprove', from: ['pending'], source: 'https://docs.stripe.com/issuing/purchases/authorizations' },
    // in any other state it is refused (a refusal with no `to` refuses where it stands)
    { operation: 'PostIssuingAuthorizationsAuthorizationApprove', from: '*', refusal: { status: 400, code: 'authorization_already_finalized', message: 'This authorization has already been finalized (status {from}).' }, source: 'https://docs.stripe.com/issuing/purchases/authorizations' },
    { operation: 'PostIssuingAuthorizationsAuthorizationDecline', from: ['pending'], to: 'closed', refusal: { status: 400, code: 'authorization_already_finalized', message: 'This authorization has already been finalized (status {from}).' }, source: 'https://docs.stripe.com/api/issuing/authorizations/decline' },
    { operation: 'PostTestHelpersIssuingAuthorizationsAuthorizationCapture', from: ['pending'], to: 'closed', source: 'https://docs.stripe.com/api/issuing/authorizations/test_mode_capture' },
    { operation: 'PostTestHelpersIssuingAuthorizationsAuthorizationCapture', from: ['pending'], source: 'https://docs.stripe.com/api/issuing/authorizations/test_mode_capture' },
    // a real-time request no one answered is decided when its window ends: "If Stripe doesn't receive your approve or
    // decline response within 2 seconds, the Authorization is automatically approved or declined based on your timeout
    // settings" (semantics/issuing.ts lapseRealtimeRequests)
    by('time', ['pending'], 'closed', 'https://docs.stripe.com/issuing/controls/real-time-authorizations'),
    // (Stripe also closes, reverses and expires one as the merchant and the clock act; in test mode the
    // capture helper above closes it, and the twin serves no other)
  ],
};

/** A Treasury flow's `status`: at Stripe a processing flow cancels, the network posts or fails it, and a posted one may
 *  come back returned. Treasury's flows are the gap here (../manifest.ts unmodeled): a vendor-backed World reads them
 *  back from its root, so no move is the twin's. */
const flow: StateField = { initial: 'processing', transitions: [] };

export const states = {
  'billing.meter': {
    notState: ['event_time_window'],
    // (deactivating and reactivating a meter are the gap here: ../manifest.ts unmodeled)
    state: { status: { initial: 'active', transitions: [] } },
  },
  'billing.credit_grant': {
    notState: ['category'],
  },
  'billing.alert': {
    // (activating, deactivating and archiving an alert are the gap here: ../manifest.ts unmodeled)
    state: { status: { initial: 'active', transitions: [] } },
  },
  payment_intent: {
    state: { status: paymentIntentStatus },
    notState: ['cancellation_reason', 'capture_method', 'confirmation_method', 'setup_future_usage'],
  },
  customer: {
    notState: ['tax_exempt'],
  },
  tax_id: {
    notState: ['type'],
  },
  customer_balance_transaction: {
    notState: ['type'],
  },
  customer_cash_balance_transaction: {
    notState: ['type'],
  },
  payment_source: {
    state: { status: bankAccountStatus('https://docs.stripe.com/api/customer_bank_accounts/object#customer_bank_account_object-status') },
    notState: ['allow_redisplay', 'business_type', 'regulated_status', 'type'],
  },
  source: {
    state: {
        status: {
          initial: 'chargeable',
          transitions: [
            // (Stripe makes a redirect source chargeable when the customer authorizes it on the bank's page;
            // the twin has no such page, so a non-card source stays pending)
            // Stripe also fails a source the customer abandons, consumes a single-use one once charged and
            // cancels one left unused; the twin's sources stay chargeable
          ],
        },
      },
    notState: ['allow_redisplay', 'type'],
  },
  charge: {
    state: { status: chargeStatus, captured: chargeCaptured, paid: chargePaid, refunded: chargeRefunded },
  },
  refund: {
    state: { status: refundStatus },
    notState: ['pending_reason', 'reason'],
  },
  setup_intent: {
    state: { status: setupIntentStatus },
    notState: ['cancellation_reason'],
  },
  payment_method: {
    notState: ['allow_redisplay', 'type'],
  },
  subscription: {
    state: { status: subscriptionStatus },
    notState: ['collection_method'],
  },
  invoice: {
    state: { status: invoiceStatus },
    notState: ['billing_reason', 'collection_method', 'customer_tax_exempt'],
  },
  'checkout.session': {
    state: { status: checkoutStatus, payment_status: checkoutPaymentStatus },
    notState: ['billing_address_collection', 'customer_creation', 'locale', 'mode', 'origin_context', 'payment_method_collection', 'redirect_on_completion', 'submit_type', 'ui_mode'],
  },
  mandate: {
    // Stripe activates a pending mandate, spends a single-use one with its payment and deactivates one revoked; the twin
    // makes no mandate (micro-deposit verification, which accepts one, is the gap here: ../manifest.ts unmodeled), so no
    // move is the twin's
    state: { status: { initial: 'active', transitions: [] } },
    notState: ['type'],
  },
  dispute: {
    state: { status: disputeStatus },
    notState: ['is_charge_refundable'],
  },
  payout: {
    state: { status: payoutStatus },
    notState: ['reconciliation_status', 'type'],
  },
  balance_transaction: {
    state: { status: { initial: 'available', vendorInitial: 'pending', transitions: [by('time', ['pending'], 'available', 'https://docs.stripe.com/api/balance_transactions/object#balance_transaction_object-status')] } },
    notState: ['balance_type', 'type'],
  },
  coupon: {
    notState: ['duration'],
    state: { valid: { initial: true, transitions: [by('time', ['true'], 'false', 'spec:/components/schemas/coupon/properties/redeem_by "Date after which the coupon can no longer be redeemed."')] } },
  },
  promotion_code: {
    state: {
        active: {
          initial: true,
          transitions: [
            ...flag('PostPromotionCodesPromotionCode', 'https://docs.stripe.com/api/promotion_codes/update'),
          ],
        },
      },
  },
  credit_note: {
    state: { status: creditNoteStatus },
    notState: ['reason', 'type'],
  },
  subscription_schedule: {
    state: { status: scheduleStatus },
    notState: ['end_behavior'],
  },
  'entitlements.feature': {
    // (updating a feature, which "permanently" deactivates it, is the gap here: ../manifest.ts unmodeled)
    state: { active: { initial: true, transitions: [] } },
  },
  'test_helpers.test_clock': {
    state: {
        status: {
          initial: 'ready',
          transitions: [
            // "advancing: The clock has started to advance but hasn't reached the specified time"; "ready: The clock has
            // completed advancing to the specified time" (docs.stripe.com/billing/testing/test-clocks/api-advanced-usage)
            by('vendor', ['advancing'], 'ready', 'https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage'),
            // (Stripe may also end an advance in internal_failure; the twin's advances complete)
          ],
        },
      },
  },
  webhook_endpoint: {
    // (disabling and enabling an endpoint by its update is the gap here: ../manifest.ts unmodeled)
    state: { status: { initial: 'enabled', transitions: [] } },
  },
  account: {
    notState: ['business_type', 'type'],
  },
  person: {
    notState: ['political_exposure'],
  },
  capability: {
    state: {
        status: {
          initial: 'unrequested',
          transitions: [
            // (requesting or unrequesting a capability by its update is the gap here: ../manifest.ts unmodeled)
            // Stripe reviews the account's requirements
          ],
        },
      },
  },
  external_account: {
    state: { status: bankAccountStatus('https://docs.stripe.com/api/external_account_bank_accounts/object#account_bank_account_object-status') },
    notState: ['allow_redisplay', 'regulated_status'],
  },
  application_fee: {
    state: { refunded: { initial: false, transitions: [
      { operation: 'PostRefunds', from: ['false'], to: 'true', source: 'https://docs.stripe.com/connect/destination-charges#issue-refunds' },
      ] } },
  },
  file: {
    notState: ['purpose'],
  },
  'identity.verification_session': {
    // the person verifies on Stripe's hosted page, and Stripe decides (docs.stripe.com/identity/how-sessions-work);
    // sessions are the gap here (../manifest.ts unmodeled) and a vendor-backed World reads them back from its root,
    // so no move is the twin's
    state: { status: { initial: 'requires_input', transitions: [] } },
    notState: ['type'],
  },
  'identity.verification_report': {
    notState: ['type'],
  },
  'billing_portal.session': {
    notState: ['locale'],
  },
  'billing_portal.configuration': {
    state: { active: { initial: true, transitions: [] } },
    notState: ['is_default'],
  },
  tax_rate: {
    // (archiving a rate by its update is the gap here: ../manifest.ts unmodeled)
    state: { active: { initial: true, transitions: [] } },
    notState: ['jurisdiction_level', 'rate_type', 'state', 'tax_type'],
  },
  'tax.settings': {
    notState: ['status'],
  },
  'tax.registration': {
    state: {
        // Stripe schedules a registration with a future active_from and expires one at expires_at; the twin's
        // are active from the start and never expire
        status: { initial: 'active', transitions: [] },
      },
  },
  'tax.transaction': {
    notState: ['type'],
  },
  payment_link: {
    // (switching a link off by its update is the gap here: ../manifest.ts unmodeled)
    state: { active: { initial: true, transitions: [] } },
    notState: ['billing_address_collection', 'customer_creation', 'payment_method_collection', 'submit_type'],
  },
  quote: {
    state: { status: quoteStatus },
    notState: ['collection_method'],
  },
  review: {
    // an elevated-risk card's charge opens one (shared.ts openReview); approving it is the gap here (../manifest.ts
    // unmodeled), and Stripe closes one when the payment is refunded or disputed, which the twin does not
    state: { open: { initial: true, transitions: [] } },
    notState: ['closed_reason', 'opened_reason'],
  },
  'radar.value_list': {
    notState: ['item_type'],
  },
  'issuing.cardholder': {
    // (a cardholder's status set by its update is the gap here: ../manifest.ts unmodeled)
    state: { status: { initial: 'active', transitions: [] } },
    notState: ['type'],
  },
  'issuing.card': {
    // a card is made inactive unless its create names a status: "Defaults to inactive" (docs.stripe.com/api/issuing/cards/create)
    state: { status: { initial: 'inactive', transitions: setBy('PostIssuingCardsCard', ['active', 'inactive', 'canceled'], 'https://docs.stripe.com/api/issuing/cards/update') } },
    notState: ['cancellation_reason', 'replacement_reason', 'type'],
  },
  'issuing.authorization': {
    state: { status: issuingAuthorizationStatus },
    notState: ['authorization_method', 'card_presence'],
  },
  'issuing.transaction': {
    notState: ['type', 'wallet'],
  },
  'issuing.dispute': {
    // (submitting one to the network is the gap here, ../manifest.ts unmodeled, and Stripe decides a submitted dispute
    // won or lost and expires one never submitted: a vendor-backed World reads them back from its root)
    state: { status: { initial: 'unsubmitted', transitions: [] } },
    notState: ['loss_reason'],
  },
  'issuing.personalization_design': {
    // a new design waits on Stripe's review (docs.stripe.com/issuing/cards/physical/personalization-design); designs and
    // the test helpers that decide them are the gap here (../manifest.ts unmodeled), read back from a vendor-backed root
    state: { status: { initial: 'review', transitions: [] } },
  },
  'terminal.reader': {
    notState: ['device_type'],
    // (a real reader goes offline and back; the twin's simulated readers stay online)
    state: { status: { initial: 'online', transitions: [] } },
  },
  'terminal.configuration': {
    notState: ['is_account_default'],
  },
  topup: {
    state: {
        status: {
          // a top-up starts pending (the create page's example answers "status": "pending") and its funds arrive days
          // later: "USA (USD) ACH Debit Transfer 5 days" (docs.stripe.com/connect/top-ups; semantics/terminal.ts)
          initial: 'pending',
          transitions: [
            // (canceling a pending top-up is the gap here: ../manifest.ts unmodeled)
            // to the Issuing balance alike: "Your top-ups can take up to 5 business days to become available"
            // (docs.stripe.com/issuing/funding/balance)
            by('vendor', ['pending'], 'succeeded', 'https://docs.stripe.com/connect/top-ups'),
            // (Stripe also fails a top-up or reverses a settled one; the twin's top-ups do neither)
          ],
        },
      },
    notState: ['initiated_by'],
  },
  'treasury.financial_account': {
    state: { status: { initial: 'open', transitions: [] } },
    notState: ['is_default'],
  },
  'treasury.outbound_payment': {
    state: { status: flow },
  },
  'treasury.outbound_transfer': {
    state: { status: flow },
  },
  'treasury.inbound_transfer': {
    state: { status: flow },
  },
  'treasury.received_credit': {
    state: { status: { initial: 'succeeded', transitions: [] } },
    notState: ['failure_code', 'network'],
  },
  'treasury.received_debit': {
    state: { status: { initial: 'succeeded', transitions: [] } },
    notState: ['failure_code', 'network'],
  },
  'treasury.transaction': {
    notState: ['flow_type'],
    // a transaction posts as its flow settles and is voided when its flow is canceled, both Stripe's (the flows are the
    // gap here: ../manifest.ts unmodeled)
    state: { status: { initial: 'open', transitions: [] } },
  },
  'treasury.transaction_entry': {
    notState: ['flow_type', 'type'],
  },
  'climate.order': {
    state: {
        status: {
          // an order is created confirmed: the create page's example answers "status": "confirmed" with confirmed_at set
          // (docs.stripe.com/api/climate/order/create)
          initial: 'confirmed',
          // (Stripe funds, confirms and delivers an order over months, and cancels one asked to; orders are the gap here,
          // ../manifest.ts unmodeled, read back from a vendor-backed root)
          transitions: [],
        },
      },
    notState: ['cancellation_reason'],
  },
  'financial_connections.account': {
    state: {
        status: {
          initial: 'active',
          // (disconnecting one is the gap here, ../manifest.ts unmodeled; Stripe marks an account inactive when the bank
          // link breaks, and active again)
          transitions: [],
        },
      },
    notState: ['category', 'subcategory'],
  },
  'financial_connections.transaction': {
    // (a bank's pending transaction posts or is voided at Stripe; the twin's arrive posted)
    state: { status: { initial: 'posted', transitions: [] } },
  },
  'reporting.report_run': {
    // "When first created, the object appears with status="pending""; "When the run completes, Stripe updates the
    // object, and it has a status of succeeded" (docs.stripe.com/reports/api). Report runs are the gap here
    // (../manifest.ts unmodeled), read back from a vendor-backed root, so Stripe's move is not the twin's.
    state: { status: { initial: 'pending', transitions: [] } },
  },
  product: {
    state: { active: { initial: true, transitions: [] } },
  },
  price: {
    notState: ['billing_scheme', 'tax_behavior', 'tiers_mode', 'type'],
    // (deleting a plan, which leaves its price inactive, is the gap here: ../manifest.ts unmodeled)
    state: { active: { initial: true, transitions: [] } },
  },
} satisfies Record<string, { state?: Record<string, StateField>; notState?: string[] }>;
