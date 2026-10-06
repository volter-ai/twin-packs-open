// Customer semantics: the customer and what hangs off it (tax ids, the credit-balance ledger, the
// cash balance, legacy sources, attached payment methods) and the top-level Source object. List,
// update and delete of a customer, retrieve of a Source and the flat tax-id list are the derived core's.
import { invoicePrefix } from './invoices.ts';
import type { Row } from './common.ts';
/** What a new customer answers before any invoice: its invoice_prefix and a next_invoice_sequence of 1, a zero balance,
 *  no metadata (docs.stripe.com/api/customers/object). */
export const newCustomer = (id: string): Row => ({ invoice_prefix: invoicePrefix(id), next_invoice_sequence: 1, balance: 0, metadata: {}, invoice_settings: {} });

// ── tax ids: a customer's, keyed under it; `type` and `value` are required ──
