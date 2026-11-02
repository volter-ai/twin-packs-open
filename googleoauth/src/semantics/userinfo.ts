// The signed-in person, by an access token: OpenID Connect's userinfo (v1 and v3) and the oauth2 v2 API's older shape.
import type { HandlerContext } from '@volter/world-core';
import { accountBySub, accountClaims, bearer } from './shared.ts';

// Where Google's documentation stops: an absent or dead token's answer is recorded nowhere here; it is RFC 6750's 401
const refused = (): Response => Response.json({ error: 'invalid_request', error_description: 'Invalid Credentials' }, { status: 401, headers: { 'www-authenticate': 'Bearer realm="https://accounts.google.com/", error="invalid_token"' } });

function oidc(ctx: HandlerContext): Response {
  const row = bearer(ctx);
  const account = row ? accountBySub(ctx, String(row.sub)) : undefined;
  if (!row || !account) return refused();
  return Response.json({ sub: account.id, ...accountClaims(account, String(row.scope).split(' ')) });
}

// source: https://developers.google.com/identity/openid-connect/openid-connect "using the userinfo endpoint with an access token"
export async function userinfoV3(ctx: HandlerContext): Promise<Response> { return oidc(ctx); }

/** The oauth2 v2 API's userinfo: `id`, `verified_email` in place of `sub`, `email_verified`. */
// source: spec:oauth2.userinfo.get "The oauth2 v2 API's userinfo"
export async function oauth2_userinfo_get(ctx: HandlerContext): Promise<Response> {
  const row = bearer(ctx);
  const account = row ? accountBySub(ctx, String(row.sub)) : undefined;
  if (!row || !account) return refused();
  return Response.json({ id: account.id, email: account.email, verified_email: true, name: account.name ?? null, given_name: account.given_name ?? null, family_name: account.family_name ?? null, picture: account.picture ?? null });
}
