// The account chooser's choice (accounts.google.com): the account consents, and the browser returns to the client's
// redirect with a code, the state, the scopes granted and `authuser` (Google's callback parameters).
import type { HandlerContext } from '@volter/world-core';
import { authorize } from '../semantics/authorization.ts';
import { accountBySub, clientById, CODE, credential, nowSeconds, serial } from '../semantics/shared.ts';

export async function screen(ctx: HandlerContext): Promise<Response> {
  // source: https://developers.google.com/identity/openid-connect/openid-connect "select_account The authorization server prompts the user to select a user account."
  if (ctx.call.request.method === 'GET') return authorize(ctx);
  // the chooser's page is the authorization operation's answer; the choice it posts (…/auth/choose) is this screen's
  if (ctx.call.request.method !== 'POST' || !new URL(ctx.call.request.url).pathname.endsWith('/choose')) return new Response('Error 404 (Not Found)', { status: 404 });
  const form = new URLSearchParams(ctx.text);
  const q = new URLSearchParams(form.get('request') ?? '');
  const client = clientById(ctx, q.get('client_id') ?? '');
  const account = accountBySub(ctx, form.get('sub') ?? '');
  const redirect = q.get('redirect_uri') ?? '';
  if (!client || !account || !((client.redirect_uris as string[] | undefined) ?? []).includes(redirect)) return new Response('Error 400: invalid_request', { status: 400 });
  const scopes = (q.get('scope') ?? 'openid').split(/\s+/).filter(Boolean);
  const code = await credential(ctx, '4/0A', `code:${String(client.client_id)}:${String(account.id)}:${ctx.occurredAt}:${await serial(ctx)}`, 70);
  await ctx.record(CODE, { clientId: client.client_id, sub: account.id, redirect_uri: redirect, scopes, offline: q.get('access_type') === 'offline', nonce: q.get('nonce'), challenge: q.get('code_challenge'), method: q.get('code_challenge_method') ?? 'plain', expires: nowSeconds(ctx) + 600 }, ctx.crypto.digest('sha256', code, 'hex'));
  const back = new URL(redirect);
  if (q.get('state') !== null) back.searchParams.set('state', q.get('state')!);
  back.searchParams.set('code', code);
  back.searchParams.set('scope', scopes.join(' '));
  back.searchParams.set('authuser', '0');
  back.searchParams.set('prompt', 'consent');
  return new Response(null, { status: 302, headers: { location: back.toString() } });
}
