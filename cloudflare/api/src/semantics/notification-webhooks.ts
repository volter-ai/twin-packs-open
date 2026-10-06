// Notifications' webhook destinations: where an account's notification policies send their alerts, a generic one with
// the secret Cloudflare sends in its `cf-webhook-auth` header (the manifest's events, ./events.ts).
import type { HandlerContext } from '@volter/world-core';
import { sameAccount, accountOf, fail, noAccount, ok, type Row } from './shared.ts';

const WEBHOOK = 'alerting_webhook';
const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});

/** A destination as the API answers it: its secret never ("Secrets are not returned in any API response body"). */
// source: spec:/components/schemas/aaa_secret "Secrets are not returned in any API response body."
const view = (w: Row): Row => ({ id: w.id, name: w.name, type: w.type, url: w.url, created_at: w.created_at, last_success: w.last_success ?? null, last_failure: w.last_failure ?? null });

/** The destination's type, by its URL: a chat service's own webhook, else a generic one. Where the documentation stops:
 *  the twin reads the type off the URL's host, as the dashboard's form does for the services it names. */
// source: https://developers.cloudflare.com/notifications/get-started/configure-webhooks/ "When creating a Google Chat, Slack, Discord, or Feishu webhook, the secret is part of the URL."
function typeOf(url: string): string {
  const host = new URL(url).hostname;
  if (host === 'hooks.slack.com') return 'slack';
  if (/(^|\.)discord(app)?\.com$/.test(host)) return 'discord';
  if (host === 'chat.googleapis.com') return 'gchat';
  if (/(^|\.)feishu\.cn$/.test(host)) return 'feishu';
  return 'generic';
}

/** `POST /accounts/{account_id}/alerting/v3/destinations/webhooks` `{ name, url, secret? }`: a destination (201), its id
 *  answered. */
// source: spec:notification-webhooks-create-a-webhook "Creates a new webhook destination."
export async function notification_webhooks_create_a_webhook(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const b = bodyOf(ctx);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const url = typeof b.url === 'string' ? b.url : '';
  // Where the documentation stops: a destination without its name or a URL that is no https URL takes the API's
  // invalid-request code
  if (!name) return fail(400, 17001, 'name is required');
  if (!/^https:\/\/[^\s/]+/.test(url)) return fail(400, 17001, 'url must be an https URL');
  const id = ctx.mint('aaa_webhooks');
  await ctx.write(WEBHOOK, id, {
    id, name, url, type: typeOf(url), created_at: ctx.occurredAt, last_success: null, last_failure: null, account_id: account.id,
    _secret: typeof b.secret === 'string' ? b.secret : '',
  }, 'alerting_webhook.create');
  return ok({ id }, 201);
}

/** `GET /accounts/{account_id}/alerting/v3/destinations/webhooks`: the account's destinations, without their secrets. */
// source: spec:notification-webhooks-list-webhooks "Gets a list of all configured webhook destinations."
export async function notification_webhooks_list_webhooks(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  return ok(ctx.rowsRaw(WEBHOOK).filter((w) => sameAccount(ctx, w.account_id, account.id) && w.deleted !== true).map((row) => view(ctx.own(row))));
}
