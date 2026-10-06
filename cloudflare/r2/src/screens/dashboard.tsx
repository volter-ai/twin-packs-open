// The dashboard's own address: a link to a page of "your account" names it `?to=/:account/<page>`, and the dashboard opens
// that page in the signed-in person's account. Cloudflare's documentation links every dashboard step so.
import type { HandlerContext } from '@volter/world-core';
import { redirect } from '@volter/world-ui';
import { at, memberships, person } from './shared.tsx';

// the documentation's dashboard link, to https://dash.cloudflare.com/?to=/:account/workers-and-pages:
// source: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ "Go to Workers & Pages"
export async function screen(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  // this answers the dashboard's root alone; a path no screen draws is not found
  if (url.pathname.replace(/\/+$/, '') !== '') return new Response('Not found.', { status: 404 });
  const who = person(ctx); if (who instanceof Response) return who;
  const account = memberships(ctx, who.email)[0];
  if (!account) return new Response('You are not a member of any account.', { status: 403 });
  const to = url.searchParams.get('to');
  // Where the documentation stops: the root without `to` opens the account's home, which the twin does not draw; it
  // opens the account's Workers & Pages
  const page = to && /^\/:account(\/[A-Za-z0-9/_-]*)?$/.test(to) ? to.replace(':account', String(account.account_id)) : `/${String(account.account_id)}/workers-and-pages`;
  return redirect(at(ctx, page));
}
