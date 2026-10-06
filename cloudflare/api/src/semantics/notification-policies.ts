// Notifications' policies: which alert an account is sent, and to which destinations (./notification-webhooks.ts). Each
// webhook a policy names is one route the manifest's events deliver over (`_alert_route`, the policy's and the
// destination's), so an alert reaches every destination its policy names.
import type { HandlerContext } from '@volter/world-core';
import { sameAccount, accountOf, fail, noAccount, ok, type Row } from './shared.ts';

const POLICY = 'alerting_policy';
const ROUTE = '_alert_route';
const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});
const view = (p: Row): Row => ({
  id: p.id, name: p.name, description: p.description ?? '', alert_type: p.alert_type, enabled: p.enabled, mechanisms: p.mechanisms,
  filters: p.filters ?? {}, ...(p.alert_interval ? { alert_interval: p.alert_interval } : {}), created: p.created, modified: p.modified,
});

/** `POST /accounts/{account_id}/alerting/v3/policies` `{ name, alert_type, enabled, mechanisms, filters?, description?,
 *  alert_interval? }`: a policy, its id answered; each webhook it names must be one of the account's destinations. */
// source: spec:notification-policies-create-a-notification-policy "Creates a new Notification policy."
export async function notification_policies_create_a_notification_policy(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const b = bodyOf(ctx);
  // Where the documentation stops: a policy missing a field its schema requires, or naming a destination the account
  // does not have, takes the API's invalid-request code
  // source: spec:/components/schemas/aaa_alert_type "Refers to which event will trigger a Notification dispatch."
  for (const field of ['name', 'alert_type', 'enabled', 'mechanisms']) if (b[field] === undefined) return fail(400, 17001, `${field} is required`);
  const mechanisms = (b.mechanisms && typeof b.mechanisms === 'object' ? b.mechanisms : {}) as Row;
  const hooks = (Array.isArray(mechanisms.webhooks) ? mechanisms.webhooks : []) as Row[];
  const destinations = hooks.map((h) => ctx.row('alerting_webhook', String(h.id)));
  if (destinations.some((d) => !d || d.deleted === true || !sameAccount(ctx, d.account_id, account.id))) return fail(400, 17001, 'a webhook the policy names is not a destination of the account');
  const id = ctx.mint('aaa_policies');
  await ctx.write(POLICY, id, {
    id, name: b.name, description: b.description ?? '', alert_type: b.alert_type, enabled: b.enabled === true, mechanisms, filters: b.filters ?? {},
    ...(typeof b.alert_interval === 'string' ? { alert_interval: b.alert_interval } : {}), created: ctx.occurredAt, modified: ctx.occurredAt, account_id: account.id,
  }, 'alerting_policy.create');
  for (const d of destinations) {
    await ctx.record(ROUTE, { policy_id: id, policy_name: b.name, alert_type: b.alert_type, enabled: b.enabled === true, account_id: account.id, webhook_id: d!.id }, `${id}:${String(d!.id)}`);
  }
  return ok({ id });
}

/** `GET /accounts/{account_id}/alerting/v3/policies`: the account's policies. */
// source: spec:notification-policies-list-notification-policies "Get a list of all Notification policies."
export async function notification_policies_list_notification_policies(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  return ok(ctx.rowsRaw(POLICY).filter((p) => sameAccount(ctx, p.account_id, account.id) && p.deleted !== true).map(view));
}
