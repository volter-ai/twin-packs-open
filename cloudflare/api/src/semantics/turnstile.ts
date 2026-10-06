// Turnstile widgets: a site's sitekey (the widget its pages render) and its secret (what its server checks a visitor's
// token with at siteverify, the `siteverify` screen). Cal.com, Rallly and LibreChat each run on one an operator made.
import type { HandlerContext } from '@volter/world-core';
import { sameAccount, accountOf, fail, listed, noAccount, ok, type Row } from './shared.ts';

/** `POST /accounts/{account}/challenges/widgets` `{ name, mode, domains, … }`: the widget, its sitekey and its secret. */
// source: spec:accounts-turnstile-widget-create "Creates a Turnstile widget for an account."
export async function accounts_turnstile_widget_create(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const body = (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? ctx.body : {}) as Row;
  // source: spec:/components/schemas/turnstile_widget_mode "Widget Mode"
  const modes = ['non-interactive', 'invisible', 'managed'];
  const domains = body.domains;
  // source: spec:/components/schemas/turnstile_domains "The widget will only work on these domains, and their subdomains."
  // Where the documentation stops: the code and words of a widget refused for its input are not recorded; it takes the
  // API's invalid-request code
  if (typeof body.name !== 'string' || !body.name.trim() || !modes.includes(String(body.mode)) || !Array.isArray(domains) || domains.length > 10
    || domains.some((d) => typeof d !== 'string' || !d)) return fail(400, 10021, 'A name, a mode (non-interactive, invisible or managed) and up to ten domains are required.');
  // source: spec:/components/schemas/turnstile_region "This cannot be changed after creation."
  const region = String(body.region ?? 'world');
  if (!['world', 'china'].includes(region)) return fail(400, 10021, 'region is world or china.');
  const sitekey = ctx.mint('turnstile_widget_detail');
  const custody = await ctx.record('_credential_issue', { sitekey });
  // source: spec:/components/schemas/turnstile_secret "Secret key for this widget."
  const secret = `0x4AAAAAAA${(await ctx.secret(`turnstile-secret:${custody}`)).slice(0, 24)}`;
  const at = ctx.occurredAt;
  await ctx.write('turnstile_widget', sitekey, {
    sitekey, secret, name: body.name.trim(), domains: (domains as string[]).map((d) => d.toLowerCase()), mode: body.mode, region,
    bot_fight_mode: body.bot_fight_mode === true, offlabel: body.offlabel === true, ephemeral_id: body.ephemeral_id === true,
    clearance_level: String(body.clearance_level ?? 'no_clearance'), deployed_via: 'api', last_modified_via: 'api', created_on: at, modified_on: at,
    _account: account.id,
  }, 'turnstile_widget.create');
  // the widget as the vendor answers it: the kernel's view of the stored row
  return ok(ctx.get('turnstile_widget_detail', sitekey));
}

/** `GET /accounts/{account}/challenges/widgets`: the account's widgets as listings show them, never their secret, in the
 *  order made, a page of `per_page` (25 unless asked), as a vendor-backed World's refresh reads them back (the listing
 *  alone: no detail is read, so no live secret enters the tree). */
// source: spec:accounts-turnstile-widgets-list "Lists Turnstile widgets for an account."
// source: spec:/components/schemas/turnstile_widget_list "A Turnstile Widgets configuration as it appears in listings"
export async function accounts_turnstile_widgets_list(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const widgets = ctx.rowsRaw('turnstile_widget').filter((w) => sameAccount(ctx, w._account, account.id) && w.deleted !== true)
    .map((w) => ctx.get('turnstile_widget_detail', String(w.id)) ?? {}).map(({ secret: _secret, ...listing }) => listing);
  return listed(ctx, widgets, 1000, 25);
}
