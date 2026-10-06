// The World's doors (the manifest's `doors`): what stands in for an act Stripe's API does not have, each under /_twin/.
import type { HandlerContext } from '@volter/world-core';
import type { Row } from '../engine/common.ts';
import { platformAccountDefault } from '../engine/connect.ts';
import { accountSettings, PLATFORM_ACCOUNT_ID } from '../engine/stripe.ts';
import { balanceBody, payDuePayouts, settleDueEntries } from './shared.ts';
/** The platform's own account settings (its payout schedule, its public name) change on Stripe's Dashboard, which has no
 *  API: this stands in for that page. The account is Stripe's default until the page first changes it (the same default
 *  GET /v1/account answers); a hash is merged into what the account holds, as an update merges it. */
export async function account(ctx: HandlerContext): Promise<Response> {
  const ex = ctx.get('account', PLATFORM_ACCOUNT_ID);
  const given: Row = ctx.params;
  const { type: _t, settings: rawSettings, business_profile: rawProfile, ...rest } = given;
  const { id: _id, ...base } = platformAccountDefault();
  const fields = {
    ...(ex ? {} : base),
    ...rest,
    settings: accountSettings(rawSettings, ex?.settings as Row | undefined),
    ...(rawProfile && typeof rawProfile === 'object' ? { business_profile: { ...((ex?.business_profile as Row | undefined) ?? {}), ...(rawProfile as Row) } } : {}),
  };
  return ctx.reply(await ctx.write('account', PLATFORM_ACCOUNT_ID, fields, 'account.update'));
}

/** Time's events, sent when a caller drives them (a runner's drainer): what time settled on each account is written —
 *  payouts whose arrival date came (pending → paid, sent as payout.paid) and funds that came due (pending → available),
 *  for which the account is sent one balance.available ("Occurs whenever your Stripe balance has been updated (e.g., when
 *  a charge is available to be paid out)", docs.stripe.com/api/events/types) carrying its Balance, when an entry that
 *  settled adds to it ("This event is not fired for negative transactions", the same page); a connected account's
 *  events go to Connect endpoints. A read already sees these moves; the drain is what makes Stripe's events about them
 *  arrive. Answers what it sent. */
export async function drain(ctx: HandlerContext): Promise<Response> {
  const accounts = [undefined, ...ctx.rows('account').map((a) => String(a.id)).filter((id) => id !== PLATFORM_ACCOUNT_ID)];
  const delivered: Array<{ type: string; id?: string; account?: string }> = [];
  for (const account of accounts) {
    for (const id of await payDuePayouts(ctx, account)) delivered.push({ type: 'payout.paid', id, ...(account ? { account } : {}) });
    if ((await settleDueEntries(ctx, account)).some((t) => Number(t.net) > 0)) {
      // the notice the event is sent for: the account's Balance, which has no id of its own (./events.ts renders it)
      await ctx.write('_balance_notice', `${account ?? PLATFORM_ACCOUNT_ID}:${ctx.occurredAt}`, { account: account ?? null, balance: balanceBody(ctx, account) }, 'balance.available');
      delivered.push({ type: 'balance.available', ...(account ? { account } : {}) });
    }
  }
  return Response.json({ delivered });
}

/** POST /_twin/app-credentials: the platform's API keys as the dashboard's API keys page shows them, a secret key and a
 *  publishable key (`sk_test_…`, `pk_test_…`), held by their SHA-256, and the signing secrets its webhook endpoints
 *  are made with. The runtime issues them to a World's applications at every boot (the descriptor's credentialDoor), so
 *  the answer is the same each time: the account's one pair of keys, made the first time. Where the documentation
 *  stops: the keys' length and alphabet after the prefix. */
// source: https://docs.stripe.com/keys "Publishable keys"
export async function appCredentials(ctx: HandlerContext): Promise<Response> {
  const secretKey = `sk_test_51${(await ctx.secret('stripe-platform-key:app')).replace(/[^A-Za-z0-9]/g, '').slice(0, 96)}`;
  const publishableKey = `pk_test_51${(await ctx.secret('stripe-publishable-key:app')).replace(/[^A-Za-z0-9]/g, '').slice(0, 96)}`;
  if (!ctx.rowsRaw('_platform_key').some((k) => k.id === 'secret:app' && k._sha256 === ctx.crypto.sha256(secretKey))) {
    await ctx.record('_platform_key', { kind: 'secret', _sha256: ctx.crypto.sha256(secretKey), created: ctx.occurredAt, deleted: false }, 'secret:app');
    await ctx.record('_platform_key', { kind: 'publishable', _sha256: ctx.crypto.sha256(publishableKey), created: ctx.occurredAt, deleted: false }, 'publishable:app');
  }
  // the signing secrets the application verifies its webhooks with, its account's and its Connect endpoint's: an
  // endpoint made for it (the webhookEndpoints door) is signed with the one of its kind, so the two agree
  return Response.json({ secret_key: secretKey, publishable_key: publishableKey, webhook_secret: await appEndpointSecret(ctx, false), connect_webhook_secret: await appEndpointSecret(ctx, true) }, { status: 201 });
}

/** The signing secret the World's application is issued for its account's endpoints, or for its Connect endpoint. */
const appEndpointSecret = async (ctx: HandlerContext, connect: boolean): Promise<string> =>
  `whsec_${(await ctx.secret(connect ? 'stripe-webhook-secret:connect' : 'stripe-webhook-secret:app')).replace(/[^A-Za-z0-9]/g, '').slice(0, 32)}`;

/** POST /_twin/webhook-endpoints {url, events, connect?}: an endpoint added on the Dashboard's Webhooks page, the events
 *  it takes, signed with the secret the World's application is issued (./doors.ts `appCredentials`): the twin's
 *  decision, since Stripe mints an endpoint's secret and lets no one choose one. */
// source: https://docs.stripe.com/webhooks "register a webhook endpoint, Stripe pushes real-time data to it when"
export async function webhookEndpoints(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Record<string, unknown>;
  if (typeof b.url !== 'string' || !/^https?:\/\//.test(b.url) || !Array.isArray(b.events) || !b.events.length) return Response.json({ error: 'a url and its events are required' }, { status: 400 });
  const connect = b.connect === true;
  const id = ctx.mint('webhook_endpoint');
  const secret = await appEndpointSecret(ctx, connect);
  await ctx.write('webhook_endpoint', id, { id, object: 'webhook_endpoint', url: b.url, enabled_events: b.events.map(String), status: 'enabled', connect, livemode: false, metadata: {}, api_version: null, application: null, description: null, secret, created: Math.floor(Date.parse(ctx.occurredAt) / 1000) }, 'webhook_endpoint.create');
  return Response.json({ id, secret }, { status: 201 });
}
