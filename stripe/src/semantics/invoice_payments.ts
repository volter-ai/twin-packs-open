// Stripe's invoice_payments operations (docs/contributing/architecture.md, "What an author writes"): each handler over the
// handler contract's context, computing with the engine (../engine/).
import type { HandlerContext } from '@volter/world-core';
import type { Row } from '../engine/common.ts';
import { INV, invoicePayment } from '../engine/invoices.ts';
import { list, newest } from './shared.ts';
export async function GetInvoicePayments(ctx: HandlerContext): Promise<Response> {
  const p = ctx.params;
  const wanted = (p.payment as Row | undefined)?.payment_intent;
  const items = newest(ctx, INV)
    .filter((inv) => typeof p.invoice !== 'string' || inv.id === p.invoice)
    .map(invoicePayment).filter((x): x is Row => !!x)
    .filter((x) => typeof wanted !== 'string' || (x.payment as Row).payment_intent === wanted)
    .filter((x) => typeof p.status !== 'string' || x.status === p.status);
  return list(ctx, 'invoice_payment', items);
}
