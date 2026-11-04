// The World's doors (the manifest's `doors`): what stands in for an act Stripe's API does not have, each under /_twin/.
import type { HandlerContext } from '@volter/world-core';
import type { Row } from '../engine/common.ts';
import { accountSettings } from '../engine/stripe.ts';
import { platformAccountId, credentialSandbox, endpointSecret, projectMerchant, retainedAppKey, selectedSandbox, balanceBody, payDuePayouts, settleDueEntries } from './shared.ts';
/** The merchant's account settings as edited on the Dashboard: nested settings and public details merge. */
export async function account(ctx: HandlerContext): Promise<Response> {
  await projectMerchant(ctx, selectedSandbox(ctx)!);
  const ex = ctx.get('account', platformAccountId(ctx))!;
  const given: Row = ctx.params;
  const { type: _t, account: _account, deployment: _deployment, settings: rawSettings, business_profile: rawProfile, ...rest } = given;
  const fields = {
    ...rest,
    settings: accountSettings(rawSettings, ex.settings as Row | undefined),
    ...(rawProfile && typeof rawProfile === 'object' ? { business_profile: { ...((ex.business_profile as Row | undefined) ?? {}), ...(rawProfile as Row) } } : {}),
  };
  return ctx.reply(await ctx.write('account', platformAccountId(ctx), fields, 'account.update'));
}

/** Time's events, sent when a caller drives them (a runner's drainer): what time settled on each account is written —
 *  payouts whose arrival date came (pending → paid, sent as payout.paid) and funds that came due (pending → available),
 *  for which the account is sent one balance.available ("Occurs whenever your Stripe balance has been updated (e.g., when
 *  a charge is available to be paid out)", docs.stripe.com/api/events/types) carrying its Balance, when an entry that
 *  settled adds to it ("This event is not fired for negative transactions", the same page); a connected account's
 *  events go to Connect endpoints. A read already sees these moves; the drain is what makes Stripe's events about them
 *  arrive. Answers what it sent. */
export async function drain(ctx: HandlerContext): Promise<Response> {
  const accounts = [undefined, ...ctx.rows('account').map((a) => String(a.id)).filter((id) => id !== platformAccountId(ctx))];
  const delivered: Array<{ type: string; id?: string; account?: string }> = [];
  for (const account of accounts) {
    for (const id of await payDuePayouts(ctx, account)) delivered.push({ type: 'payout.paid', id, ...(account ? { account } : {}) });
    if ((await settleDueEntries(ctx, account)).some((t) => Number(t.net) > 0)) {
      // the notice the event is sent for: the account's Balance, which has no id of its own (./events.ts renders it)
      await ctx.write('_balance_notice', `${account ?? platformAccountId(ctx)}:${ctx.occurredAt}`, { account: account ?? null, balance: balanceBody(ctx, account) }, 'balance.available');
      delivered.push({ type: 'balance.available', ...(account ? { account } : {}) });
    }
  }
  return Response.json({ delivered });
}

/** Sandbox API keys and the signing secrets used by its app and Connect endpoints. */
// source: https://docs.stripe.com/keys
// source: https://docs.stripe.com/sandboxes
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const sandbox = await credentialSandbox(ctx);
  await projectMerchant(ctx, sandbox);
  return Response.json({
    secret_key: await retainedAppKey(ctx, sandbox, 'secret'),
    publishable_key: await retainedAppKey(ctx, sandbox, 'publishable'),
    webhook_secret: await retainedAppKey(ctx, sandbox, 'webhook'),
    connect_webhook_secret: await retainedAppKey(ctx, sandbox, 'connect_webhook'),
  }, { status: 201 });
}

/** POST /_twin/webhook-endpoints {url, events, connect?}: an endpoint added on the Dashboard's Webhooks page, the events
 *  it takes, signed with the secret the World's application is issued (./doors.ts `appCredentials`): the twin's
 *  decision, since Stripe mints an endpoint's secret and lets no one choose one. */
// source: https://docs.stripe.com/webhooks "register a webhook endpoint, Stripe pushes real-time data to it when"
export async function webhookEndpoints(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;
  if (typeof b.url !== 'string' || !/^https?:\/\//.test(b.url) || !Array.isArray(b.events) || !b.events.length) return Response.json({ error: 'a url and its events are required' }, { status: 400 });
  const connect = b.connect === true;
  const sandbox = selectedSandbox(ctx)!;
  const reserved = await ctx.create('webhook_endpoint', { object: 'webhook_endpoint' }, 'webhook_endpoint.reserve');
  const id = String(reserved.id);
  const secret = await endpointSecret(ctx, sandbox, connect);
  await ctx.write('webhook_endpoint', id, { id, object: 'webhook_endpoint', url: b.url, enabled_events: b.events.map(String), status: 'enabled', connect, livemode: false, metadata: {}, api_version: null, application: null, description: null, secret, created: Math.floor(Date.parse(ctx.occurredAt) / 1000) }, 'webhook_endpoint.create');
  return Response.json({ id, secret }, { status: 201 });
}
