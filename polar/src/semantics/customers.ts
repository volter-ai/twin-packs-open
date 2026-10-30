// Customers: by Polar's id or by the application's own (`external_id`), and their state.
import type { HandlerContext } from '@volter/world-core';
import { rowOf, bodyOf, customerFields, environment, CUSTOMER, customerBy, customerState, customerView, invalid, missing, newest, newId, notFound, type Row, rowsOf, SUBSCRIPTION } from './shared.ts';

const FIELDS = ['email', 'name', 'external_id', 'billing_name', 'billing_address', 'tax_id', 'locale', 'metadata'];

/** A customer's email or external id already held by another: Polar's 422. */
function taken(ctx: HandlerContext, fields: Row, except?: unknown): Response | undefined {
  const emailTaken = typeof fields.email === 'string' && rowsOf(ctx, CUSTOMER).some((c) => c.id !== except && String(c.email).toLowerCase() === String(fields.email).toLowerCase());
  return emailTaken ? duplicateEmail() : fields.external_id != null && rowsOf(ctx, CUSTOMER).some((c) => c.id !== except && c.external_id === fields.external_id) ? duplicateExternal() : undefined;
}

/** `POST /v1/customers/`: an individual customer, its email required. */
// source: spec:customers:create "Create a customer."
export async function customers_create(ctx: HandlerContext): Promise<Response> {
  const body = bodyOf(ctx);
  if (typeof body.email !== 'string' || body.email === '') return missing('email');
  const refused = taken(ctx, body);
  if (refused) return refused;
  const id = newId(ctx, CUSTOMER);
  const fields: Row = { id, created_at: ctx.occurredAt, modified_at: null, email_verified: false };
  for (const k of FIELDS) if (k in body) fields[k] = body[k];
  await ctx.write(CUSTOMER, id, { ...customerFields(ctx, fields), _environment: environment(ctx) }, 'customer.create');
  return Response.json(customerView(ctx, rowOf(ctx, CUSTOMER, id)!), { status: 201 });
}

const byExternal = (ctx: HandlerContext): Row | undefined => customerBy(ctx, { external: decodeURIComponent(ctx.call.params.external_id ?? '') });

/** `GET /v1/customers/{id}`: the customer as the API answers it. */
// source: spec:customers:get "Get a customer by ID."
export async function customers_get(ctx: HandlerContext): Promise<Response> {
  const c = customerBy(ctx, { id: ctx.call.params.id });
  return c ? Response.json(customerView(ctx, c)) : notFound('Customer');
}

// source: spec:customers:get_state_external "Get a customer state by external ID."
export async function customers_get_state_external(ctx: HandlerContext): Promise<Response> {
  const c = byExternal(ctx);
  return c ? Response.json(await customerState(ctx, c)) : notFound('Customer');
}

/** `GET /v1/customers/`: the organization's customers, newest first, by exact email, a query over name, email and
 *  external id, or whether they hold a live subscription. */
// source: spec:customers:list "List customers."
export async function customers_list(ctx: HandlerContext): Promise<Response> {
  const q = String(ctx.params.query ?? '').toLowerCase();
  // source: spec:customers:list "Filter by active customers, i.e. customers with at least one trialing, active or past_due subscription."
  const live = new Set(rowsOf(ctx, SUBSCRIPTION).filter((s) => ['trialing', 'active', 'past_due'].includes(String(s.status))).map((s) => s.customer_id));
  const active = ctx.params.active === undefined ? undefined : String(ctx.params.active) === 'true';
  const rows = rowsOf(ctx, CUSTOMER)
    .filter((c) => ctx.params.email === undefined || String(c.email ?? '').toLowerCase() === String(ctx.params.email).toLowerCase())
    .filter((c) => q === '' || [c.name, c.email, c.external_id].some((v) => typeof v === 'string' && v.toLowerCase().includes(q)))
    .filter((c) => active === undefined || live.has(c.id) === active)
    .sort(newest('created_at'));
  return ctx.list(CUSTOMER, rows.map((c) => customerView(ctx, c)));
}

// source: spec:customers:create "Validation Error"
// Where the documentation stops: the error wording for the duplicate external id.
function duplicateExternal(): Response {
  return invalid(['external_id'], 'A customer with this external ID already exists.');
}

// source: spec:customers:create "Validation Error"
// Where documentation stops: the duplicate-email error message.
function duplicateEmail(): Response {
  return invalid(['email'], 'A customer with this email address already exists.');
}
