// An account's own API tokens (account API tokens): listed by the account, as an integration reads them back (a
// vendor-backed World's refresh). A token is made by the dashboard or the World's appCredentials door.
import type { HandlerContext } from '@volter/world-core';
import { sameAccount, accountOf, API_TOKEN, bearerToken, listed, noAccount, publicToken } from './shared.ts';

/** `GET /accounts/{account_id}/tokens`: the account's tokens, never their values, to a token holding Account API Tokens
 *  Read or Write (around.ts); a person who is no Super Administrator sees only the tokens they made; an expired one only
 *  with `include_expired`. */
// source: spec:account-api-tokens-list-tokens "List Account Owned API tokens created for this account."
// source: spec:account-api-tokens-list-tokens "Results include active, disabled, and"
// source: https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/ "other members can only view and manage tokens which they created"
export async function account_api_tokens_list_tokens(ctx: HandlerContext): Promise<Response> {
  const account = accountOf(ctx);
  if (!account) return noAccount();
  const caller = bearerToken(ctx);
  const q = new URL(ctx.call.request.url).searchParams;
  const expired = q.get('include_expired') === 'true';
  const member = caller && caller._kind !== 'account' ? ctx.rowsRaw('account_member').find((m) => m.email === caller._owner && sameAccount(ctx, m.account_id, account.id) && m.status === 'accepted') : undefined;
  const all = !member || ((member.roles as string[] | undefined) ?? []).some((r) => r.startsWith('Super Administrator'));
  const rows = ctx.rowsRaw(API_TOKEN).filter((t) => t._kind === 'account' && sameAccount(ctx, t._account, account.id) && t.deleted !== true && (all || t._owner === caller?._owner)
    && (expired || !(typeof t.expires_on === 'string' && Date.parse(t.expires_on) <= Date.parse(ctx.occurredAt))));
  return listed(ctx, (q.get('direction') === 'desc' ? rows.reverse() : rows).map((t) => publicToken(ctx, t)));
}
