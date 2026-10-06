// Stripe's shared computation over rows already read: the fields each object's spec gives, a row as Stripe answers it,
// and the list and refund shapes (the handlers' shared behaviour is ../semantics/shared.ts).
import surface from '../generated/surface.gen.json' with { type: 'json' };

export type Row = Record<string, unknown>;

/** Keep the rows whose field equals the request's parameter of the same name, for each name given. */
/** A list's range filter on a unix time (`created[gte]=…&created[lt]=…`, or one exact time). */
export function inRange(t: unknown, v: unknown): boolean {
  const at = Number(t);
  const r = (v && typeof v === 'object' ? v : { gte: v, lte: v }) as Row;
  return (r.gt === undefined || at > Number(r.gt)) && (r.gte === undefined || at >= Number(r.gte)) && (r.lt === undefined || at < Number(r.lt)) && (r.lte === undefined || at <= Number(r.lte));
}

export const SPEC_FIELDS = new Map((surface.resources as Array<{ name: string; fields: Array<{ name: string }> }>).map((r) => [r.name, new Set(r.fields.map((f) => f.name))]));

/** A stored subject of any stored type, tombstones included, in the pack's view: what the pack's
 *  shared helpers look a price, a payment method or a card up by, read from the context's tree. */
export type Find = (storedType: string, id: string) => Row | undefined;

/** An account's external_accounts, "External accounts (bank accounts and debit cards) currently attached to this
 *  account" (docs.stripe.com/api/accounts/object), as the list its example answers. */
export const externalList = (account: string, data: Row[]): Row => ({ object: 'list', data, has_more: false, total_count: data.length, url: `/v1/accounts/${account}/external_accounts` });




/** A removed discount as Stripe answers it: the discount, marked deleted (docs.stripe.com/api/discounts/delete). */
export function deletedDiscount(d: Row, now: unknown): Row {
  const coupon = d.coupon && typeof d.coupon === 'object' ? String((d.coupon as Row).id) : typeof d.coupon === 'string' ? d.coupon : null;
  return {
    id: d.id ?? `di_${coupon ?? 'twin'}`, object: 'discount', deleted: true, checkout_session: d.checkout_session ?? null, customer: d.customer ?? null,
    invoice: d.invoice ?? null, invoice_item: d.invoice_item ?? null, promotion_code: d.promotion_code ?? null, subscription: d.subscription ?? null,
    subscription_item: d.subscription_item ?? null, source: d.source ?? { type: 'coupon', coupon }, start: d.start ?? now,
  };
}



/** A refund's destination_details for a card charge: "If this is a `card` refund, this hash contains the transaction
 *  specific details" and its `type` "can be `refund`, `reversal`, or `pending`" — a reversal, where "The original charge
 *  will drop off the bank statement altogether", for an authorization released uncaptured, else a refund, "a credit entry
 *  on the bank statement" (docs.stripe.com/api/refunds/object). The network's reference number the twin never has. A
 *  charge not paid by card answers none. */
export function refundDestination(charge: Row, type: 'refund' | 'reversal'): Row {
  const pmd = charge.payment_method_details as Row | null | undefined;
  if (pmd && pmd.type !== 'card') return {};
  return { destination_details: { type: 'card', card: { reference: null, reference_status: null, reference_type: null, type } } };
}
