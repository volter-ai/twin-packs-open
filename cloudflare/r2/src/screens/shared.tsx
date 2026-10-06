// Screen helpers use the shared person/session kit and the vendor's ordinary credential lifecycle.
import type { HandlerContext } from '@volter/world-core';
import { signedIn, toSignIn } from '@volter/world-ui';
import { sameAccount, API_TOKEN, permissionGroups, groupRef, makeApiToken, rollApiToken, r2Policy, publicToken, type Row, type R2Permission } from '../semantics/shared.ts';

/** A dashboard path as the page links it: under the place a World serves the twin at (the context's publicBase), so a link or a
 *  form stays in the World; the path itself on dash.cloudflare.com. */
export const at = (ctx: HandlerContext, path: string): string => `${new URL(ctx.publicBase).pathname.replace(/\/+$/, '')}${path}`;
export const safeReturn = (ctx: HandlerContext, path: string): string => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : at(ctx, '/profile/api-tokens');
export function person(ctx: HandlerContext): { email: string; id: string } | Response {
  const who = signedIn(ctx, 'cf_session');
  const user = who ? ctx.rowsRaw('cf_user').find(row => row.email === who.email) : undefined;
  const here = new URL(ctx.call.request.url);
  return who && user ? { email: who.email, id: String(user.id) } : toSignIn(at(ctx, '/login'), at(ctx, here.pathname + here.search));
}
export function memberships(ctx: HandlerContext, email: string): Row[] {
  return ctx.rowsRaw('account_member').filter(member => member.email === email && member.status === 'accepted');
}
export async function dashboardToken(ctx: HandlerContext, email: string, id: string, account: string | undefined,
  form: Record<string, string>, groups: string[]): Promise<{ notice: string } | Response> {
  const token = form.token_id ? ctx.row(API_TOKEN, form.token_id) : undefined;
  const accessible = (held: Row): boolean => account ? held._kind === 'account' && sameAccount(ctx, held._account, account) || held._kind === 'user' && held._owner === email : held._kind === 'user' && held._owner === email;
  if (['roll', 'delete'].includes(form.action ?? '')) {
    if (!token || !accessible(token)) return new Response('Token not found.', { status: 404 });
    if (form.action === 'delete') { await ctx.remove(API_TOKEN, String(token.id), 'api_token.delete'); return { notice: 'Token deleted.' }; }
    return { notice: `New token value (shown once): ${await rollApiToken(ctx, token)}` };
  }
  if (!form.name?.trim()) return new Response('A token name is required.', { status: 400 });
  let policies: Row[];
  if (account) {
    if (!['admin-rw', 'admin-ro', 'object-rw', 'object-ro'].includes(form.permission ?? '')) return new Response('Choose a valid permission.', { status: 400 });
    if (form.permission.startsWith('object') && !form.bucket?.trim()) return new Response('A bucket scope is required.', { status: 400 });
    policies = [r2Policy(account, form.permission as R2Permission, form.bucket || '*', form.jurisdiction || 'default')];
  } else {
    const selected = (form.groups || groups.join(',')).split(',').map(name => name.trim()).filter(Boolean);
    if (!selected.length || selected.some(name => !permissionGroups().some(group => group.name === name))) return new Response('Choose published permission groups.', { status: 400 });
    const selectedAccount = form.account_id;
    if (!selectedAccount || !memberships(ctx, email).some(member => sameAccount(ctx, member.account_id, selectedAccount))) return new Response('Choose one of your accounts.', { status: 403 });
    policies = [{ effect: 'allow', resources: { [`com.cloudflare.api.account.${selectedAccount}`]: '*', [`com.cloudflare.api.user.${id}`]: '*' }, permission_groups: selected.map(groupRef) }];
  }
  const made = await makeApiToken(ctx, { name: form.name.trim(), kind: account && form.token_kind !== 'user' ? 'account' : 'user', owner: email, account, policies });
  return { notice: `Token value (shown once): ${made.value}; S3 Access Key ID: ${made.token.id}; Secret Access Key: ${ctx.crypto.sha256(made.value)}` };
}
export function shownTokens(ctx: HandlerContext, email: string, account?: string): Row[] {
  return ctx.rowsRaw(API_TOKEN).filter(token => account ? (token._kind === 'account' && sameAccount(ctx, token._account, account) || token._kind === 'user' && token._owner === email && JSON.stringify(token.policies).includes(account)) : token._kind === 'user' && token._owner === email).map(token => publicToken(ctx, token));
}
