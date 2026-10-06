// Accounts: the accounts a token reaches, as an integration reads them back (a vendor-backed World's refresh). An account
// is made by the dashboard's sign-up (the World's appCredentials door), never by this API.
import type { HandlerContext } from '@volter/world-core';
import { ACCOUNT, bearerToken, listed, personInAccount, type Row } from './shared.ts';

/** `GET /accounts`: the accounts the token reaches (an account token its own, a user's token the accounts its person is
 *  a member of), by `name`, in the order made unless `direction` is `desc`. */
// source: spec:accounts-list-accounts "List all accounts you have ownership or verified access to."
export async function accounts_list_accounts(ctx: HandlerContext): Promise<Response> {
  const caller = bearerToken(ctx);
  const q = new URL(ctx.call.request.url).searchParams;
  const name = q.get('name');
  const rows = ctx.rowsRaw(ACCOUNT).filter((a) => a.deleted !== true && caller !== undefined && personInAccount(ctx, caller, String(a.id)) && (name === null || a.name === name))
    .map((row): Row => { const a = ctx.own(row); return ({ id: a.id, name: a.name, type: a.type, settings: a.settings ?? {}, created_on: a.created_on }); });
  return listed(ctx, q.get('direction') === 'desc' ? rows.reverse() : rows);
}
