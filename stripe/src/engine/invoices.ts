// Invoice and InvoiceItem semantics. The machine in ../manifest.ts says which moves of an invoice's
// `status` are legal (finalize, send, pay, mark_uncollectible, void) and what Stripe answers
// otherwise; these handlers compute each move, keep a draft's lines and totals in step with its
// items, and mint the PaymentIntent a finalized invoice collects through. The invoice list and the
// item list are the derived core's.
import type { Row } from './common.ts';
import { applyCouponDiscount } from './stripe.ts';

export const INV = 'invoice';

/** Whether leaving draft mints a PaymentIntent: only a charge_automatically invoice with a balance. */
// "Finalizing an invoice does the following: ... It creates an incomplete payment intent for the invoice"
// (docs.stripe.com/invoicing/integration/workflow-transitions), whichever its collection method
export const collectsThroughIntent = (inv: Row): boolean => inv.status === 'draft' && (Number(inv.amount_due) || 0) > 0;

export const transitions = (inv: Row): object => (inv.status_transitions as object) ?? {};

/** What finalizing assigns: the invoice's `number`, the customer's invoice_prefix and a sequence
 *  (https://docs.stripe.com/api/invoices/object#invoice_object-number), and for send_invoice a
 *  `due_date` days_until_due after finalization (#invoice_object-due_date). */
/** A customer's invoice_prefix, "The prefix for the customer used to generate unique invoice numbers"
 *  (docs.stripe.com/api/customers/object): the twin's, from the customer's id. */
export const invoicePrefix = (customerId: string): string => customerId.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase() || 'TWIN';

/** An invoice's payment as Stripe answers it (docs.stripe.com/api/invoice-payment/object): the PaymentIntent that
 *  collects the invoice, open until the invoice is paid. Where the documentation stops and the twin decides: an
 *  invoice has one payment, its default, and the payment's id is the invoice's with `inpay_`. */
export function invoicePayment(inv: Row): Row | undefined {
  if (typeof inv.payment_intent !== 'string') return undefined;
  const paid = inv.status === 'paid';
  const transitions = (inv.status_transitions as Row | undefined) ?? {};
  return {
    id: `inpay_${String(inv.id).replace(/^in_/, '')}`, object: 'invoice_payment', invoice: inv.id, is_default: true, livemode: false,
    amount_requested: Number(inv.amount_due ?? 0), amount_paid: paid ? Number(inv.amount_paid ?? inv.amount_due ?? 0) : null, currency: inv.currency,
    created: inv.created, payment: { type: 'payment_intent', payment_intent: inv.payment_intent },
    status: paid ? 'paid' : inv.status === 'void' ? 'canceled' : 'open',
    status_transitions: { paid_at: paid ? (transitions.paid_at ?? null) : null, canceled_at: inv.status === 'void' ? (transitions.voided_at ?? null) : null },
  };
}


export const linesOf = (inv: Row): Row[] => (inv.lines as { data?: Row[] } | undefined)?.data ?? [];


export const sumLines = (lines: Row[]): number => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);



/** Credit the previous price and debit the replacement for the same remaining service time. */
// source: https://docs.stripe.com/billing/subscriptions/prorations "Unused time on original 10 USD plan (credit)"
// source: https://docs.stripe.com/billing/subscriptions/prorations "Remaining time on new 20 USD plan (debit)"
// source: https://docs.stripe.com/billing/subscriptions/prorations "The current billing period’s start and end times are used to calculate the cost of the subscription before and after the change."
// source: https://docs.stripe.com/billing/subscriptions/prorations "By default, Stripe calculates prorations down to the second."
export function prorationLines(before: Row[], after: Row[], time: number, start: number, end: number, coupon: Row | undefined): Row[] {
  const out: Row[] = [];
  const discounted = (line: Row, lines: Row[]): number => {
    const total = sumLines(lines);
    // source: https://docs.stripe.com/billing/subscriptions/prorations "When calculating proration credits or debits, Stripe uses the subscription’s discounted price, not the original price."
    return Number(line.amount) - (total > 0 ? applyCouponDiscount(total, coupon) * Number(line.amount) / total : 0);
  };
  const priceId = (line: Row): unknown => typeof line.price === 'object' ? (line.price as Row).id : line.price;
  const append = (line: Row, lines: Row[], credit: boolean): void => {
    const billingPeriod = line.period as Row;
    const periodStart = Number(billingPeriod.start ?? start), periodEnd = Number(billingPeriod.end ?? end);
    const fraction = Math.max(0, Math.min(1, (periodEnd - time) / Math.max(1, periodEnd - periodStart)));
    const amount = Math.round(discounted(line, lines) * fraction) * (credit ? -1 : 1);
    if (!amount) return;
    out.push({ ...line, id: `${line.id}_${credit ? 'unused' : 'remaining'}`, amount, proration: true, discountable: false,
      period: { start: time, end: periodEnd }, description: `${credit ? 'Unused' : 'Remaining'} time on ${String((line.price as Row)?.nickname ?? priceId(line))}` });
  };
  for (const old of before) {
    const replacement = after.find(line => line.subscription_item === old.subscription_item);
    if (replacement && priceId(replacement) === priceId(old) && replacement.quantity === old.quantity) continue;
    append(old, before, true);
  }
  for (const next of after) {
    const previous = before.find(line => line.subscription_item && line.subscription_item === next.subscription_item);
    if (previous && priceId(previous) === priceId(next) && previous.quantity === next.quantity) continue;
    append(next, after, false);
  }
  return out;
}



// ── invoices ──

/** A draft invoice's fields before anything is on it: what a new invoice and a preview start from. */
export const draft = (now: number): Row => ({
  status: 'draft', livemode: false, currency: 'usd', collection_method: 'charge_automatically',
  auto_advance: false, attempt_count: 0, attempted: false,
  amount_due: 0, amount_paid: 0, amount_remaining: 0, amount_overpaid: 0, amount_paid_off_stripe: 0, amount_shipping: 0,
  subtotal: 0, total: 0, starting_balance: 0, post_payment_credit_notes_amount: 0, pre_payment_credit_notes_amount: 0,
  period_start: now, period_end: now, default_tax_rates: [], discounts: [],
  lines: { object: 'list', data: [], has_more: false, total_count: 0 },
  automatic_tax: { enabled: false, liability: null, status: null },
  status_transitions: { finalized_at: null, marked_uncollectible_at: null, paid_at: null, voided_at: null },
  issuer: { type: 'self' },
  payment_settings: { default_mandate: null, payment_method_options: null, payment_method_types: null },
  // a draft has no PaymentIntent: finalize mints it
  payment_intent: null,
});
