// GitHub's users (https://docs.github.com/en/rest/users): the caller's own account with its private fields, an account
// by its numeric id or its login, and the caller's email addresses (kept `<login>::<email>` by the sign-up door and
// settings).
import type { HandlerContext } from '@volter/world-core';
import { account, fail, hasScope, json, notFound, page, type Row, shown, who } from './shared.ts';

/** users/get-authenticated: the caller's account, with what only they see when the token holds `read:user` or `user`
 *  (the public account otherwise); an App's or a run's token is no person. */
// source: https://docs.github.com/en/rest/users/users "OAuth app tokens and personal access tokens (classic) need the read:user scope, or the broader user scope, for this endpoint to return the private user response."
// source: https://docs.github.com/en/rest/users/users "Tokens without these scopes receive the public user response."
export async function users_get_authenticated(ctx: HandlerContext): Promise<Response> {
  const c = who(ctx);
  if (!c) return fail(ctx, 401, 'Requires authentication');
  if (c.kind !== 'user') return fail(ctx, 403, 'Resource not accessible by integration');
  const u = ctx.row('user', c.login);
  if (!u) return notFound(ctx);
  if (!hasScope(c, 'read:user')) return json(shown(ctx, u));
  const own = ctx.rowsRaw('repository').filter((r) => String((r.owner as Row).login) === c.login);
  const priv = own.filter((r) => r.private === true).length;
  return json({
    ...shown(ctx, u), public_repos: own.length - priv, private_gists: 0, total_private_repos: priv, owned_private_repos: priv, disk_usage: 0, collaborators: 0,
    two_factor_authentication: u._totp !== undefined && u._totp !== null, plan: PLAN,
  });
}

/** The plan a person's account is on: the World's people are on GitHub Free. */
const PLAN = { name: 'free', space: 976562499, collaborators: 0, private_repos: 10000 };

/** A person's public account; read by the person themselves, with their plan. */
// source: spec:users/get-by-username "A request authenticated as the specified user returns the actual values even if the token has no OAuth scopes."
// source: spec:/components/examples/public-user-response-with-git-hub-plan-information "private_repos"
function publicAccount(ctx: HandlerContext, u: Row): Row {
  const c = who(ctx);
  return c?.kind === 'user' && c.login === u.login ? { ...shown(ctx, u), plan: PLAN } : shown(ctx, u);
}

/** users/get-by-id: an account by its numeric id (the World keeps accounts by login). */
// source: https://docs.github.com/en/rest/users/users "This method takes their durable user ID instead of their login , which can change over time."
export async function users_get_by_id(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.call.params.account_id ?? ctx.call.params.id ?? '');
  // accounts are kept by their login: their numeric id is their own field
  const u = ctx.rowsRaw('user').find((x) => String(ctx.own(x).id) === id);
  return u ? json(publicAccount(ctx, u)) : notFound(ctx);
}

/** users/list-emails-for-authenticated-user: needs `user:email` (or `user`) of an OAuth token (where the documentation
 *  stops: a token without it is answered Not Found, as GitHub answers it). */
// source: https://docs.github.com/en/rest/users/emails "OAuth app tokens and personal access tokens (classic) need the user:email scope to use this endpoint."
export async function users_list_emails_for_authenticated_user(ctx: HandlerContext): Promise<Response> {
  const c = who(ctx);
  if (!c) return fail(ctx, 401, 'Requires authentication');
  if (c.kind !== 'user') return fail(ctx, 403, 'Resource not accessible by integration');
  if (!hasScope(c, 'user:email')) return fail(ctx, 404, 'Not Found');
  return json(page(ctx, ctx.rowsRaw('user_email').filter((e) => e._login === c.login).map((e) => { const { id: _key, ...own } = shown(ctx, e); return own; })));
}

/** users/get-by-username: a person's public account, or an organization's as an account (its `type` Organization),
 *  matched without regard to case; a login GitHub has no account for, 404. */
// source: https://docs.github.com/en/rest/users/users "Provides publicly available information about someone with a GitHub account."
export async function users_get_by_username(ctx: HandlerContext): Promise<Response> {
  const asked = String(ctx.call.params.username ?? '').toLowerCase();
  const u = ctx.rowsRaw('user').find((x) => String(x.login).toLowerCase() === asked);
  if (u) return json(publicAccount(ctx, u));
  const o = ctx.rowsRaw('org').find((x) => String(x.login).toLowerCase() === asked);
  if (!o) return notFound(ctx);
  const repos = ctx.rowsRaw('repository').filter((r) => String((r.owner as Row).login) === String(o.login) && r.private !== true).length;
  return json({
    ...account(ctx, String(o.login)), name: o.name ?? null, company: o.company ?? null, blog: o.blog ?? '', location: o.location ?? null, email: o.email ?? null, hireable: null,
    bio: o.description ?? null, twitter_username: o.twitter_username ?? null, public_repos: repos, public_gists: 0, followers: 0, following: 0, created_at: o.created_at, updated_at: o.updated_at,
  });
}
