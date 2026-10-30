// Usage events (the `events` family: ingested by the application, read by meters) and, as the manifest's `events.render`,
// how Polar renders a webhook's `data`: the written object as the API answers it.
import type { EventWrite, HandlerContext, WriteHookContext } from '@volter/world-core';
import { rowOf,
  admits, among, bodyOf, customerFields, eventFields, environment, CHECKOUT, checkoutView, CUSTOMER, customerBy, customerView, EVENT, eventView, invalid, METER, missing, newest, newId, notFound, ORDER, orderView,
  PRODUCT, productView, type Row, rowsOf, SUBSCRIPTION, subscriptionView,
} from './shared.ts';

/** `POST /v1/events/ingest`: a batch of events. An event's `external_id` is the application's id for it: a second
 *  ingest of it is a duplicate, not a second event. An `external_customer_id` names the customer by the application's
 *  id; it does not create an unresolved customer. */
// source: spec:events:ingest "Ingest batch of events."
export async function events_ingest(ctx: HandlerContext): Promise<Response> {
  const events = bodyOf(ctx).events;
  if (!Array.isArray(events)) return missing('events');
  // Validate the complete batch before mutating it. External identities may remain unresolved.
  // source: spec:events:ingest "Validation Error"
  for (const [i, e] of (events as Row[]).entries()) {
    if (!e || typeof e.name !== 'string') return invalid(['events', i, 'name'], 'Field required', 'missing');
    if (e.customer_id !== undefined && !customerBy(ctx, { id: e.customer_id })) return invalid(['events', i, 'customer_id'], 'Customer does not exist.');
  }
  let inserted = 0;
  let duplicates = 0;
  for (const e of events as Row[]) {
    if (e.external_id != null && rowsOf(ctx, '_event_key').some((x) => x.external_id === e.external_id)) { duplicates += 1; continue; }
    const customer = e.customer_id !== undefined ? customerBy(ctx, { id: e.customer_id }) : e.external_customer_id !== undefined ? customerBy(ctx, { external: e.external_customer_id }) : undefined;
    const id = newId(ctx, EVENT);
    await ctx.write(EVENT, id, { ...eventFields(ctx, { id, timestamp: e.timestamp ?? ctx.occurredAt, name: e.name, customer_id: customer?.id ?? null, external_customer_id: e.external_customer_id ?? null, metadata: e.metadata ?? {} }), _environment: environment(ctx), _received_at: ctx.occurredAt }, 'event.ingest');
    if (e.external_id != null) await ctx.record('_event_key', { external_id: e.external_id, _environment: environment(ctx) });
    inserted += 1;
  }
  return Response.json({ inserted, duplicates });
}

/** `GET /v1/events/`: the organization's events, newest first, by customer (Polar's id or the application's), name,
 *  source, a meter's filter, or a time window. */
// source: spec:events:list "List events."
export async function events_list(ctx: HandlerContext): Promise<Response> {
  const meter = ctx.params.meter_id === undefined ? undefined : rowOf(ctx, METER, String(ctx.params.meter_id));
  if (ctx.params.meter_id !== undefined && (!meter || meter.deleted === true)) return notFound('Meter');
  // source: spec:events:list "Filter events after this timestamp."
  const after = ctx.params.start_timestamp === undefined ? undefined : Date.parse(String(ctx.params.start_timestamp));
  const before = ctx.params.end_timestamp === undefined ? undefined : Date.parse(String(ctx.params.end_timestamp));
  const q = String(ctx.params.query ?? '').toLowerCase();
  const rows = rowsOf(ctx, EVENT)
    .filter((e) => among(ctx, 'customer_id', e.customer_id) && among(ctx, 'external_customer_id', e.external_customer_id) && among(ctx, 'name', e.name) && among(ctx, 'source', 'user'))
    .filter((e) => !meter || admits(meter.filter as Row | undefined, e))
    .filter((e) => (after === undefined || Date.parse(String(e.timestamp)) > after) && (before === undefined || Date.parse(String(e.timestamp)) < before))
    .filter((e) => q === '' || String(e.name).toLowerCase().includes(q))
    .sort(newest('timestamp'));
  return ctx.list(EVENT, rows.map((e) => eventView(ctx, e)));
}

/** A webhook's `data`: the written object as the API answers it. */
export function data(ctx: WriteHookContext, write: EventWrite): Record<string, unknown> {
  const id = String(write.body.id ?? '');
  const row = rowOf(ctx, write.storedType, id) ?? write.body;
  return write.storedType === CHECKOUT ? checkoutView(ctx, row) : orderView(ctx, row);
}

/** Private routing value: sandbox endpoints only receive sandbox writes. */
export function values(ctx: WriteHookContext): Record<string, unknown> { return { '$environment': environment(ctx) }; }
