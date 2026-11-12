// The OpenID Connect provider (@better-auth/oauth-provider as auth.ts configures it): authorize (a person signed in on
// the login page), the token endpoint (authorization code with PKCE, refresh token, client credentials for a product's
// organizations token, the device code) and userinfo (GET), as Volter's products call them (journeys/demand.json).
// Introspection, revocation, end-session and POST userinfo are called by none and answer the gap.
import type { HandlerContext } from '@volter/world-core';
import {
  claimsOf, clientById, grants, linked, linkedClaims, clientOf, CODE, DEVICE, issuerOf, isPublic, live, nowSeconds, oauthError, redirectAllowed, REFRESH, type Row, SCOPES, sessionUser, sessionOf, tokensFor, userById, verified, serial } from './shared.ts';

const params = (ctx: HandlerContext): Row => (ctx.params ?? {}) as Row;
const GRANTS = ['authorization_code', 'client_credentials', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'];
const page = (status: number, text: string): Response => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** `GET /api/auth/oauth2/authorize`: a registered client's authorization request. Without a signed-in person the
 *  browser goes to the login page with the request; with one, back to the client's redirect with a code (and `iss`). */
// source: spec:/paths/~1api~1auth~1oauth2~1authorize/get "Authorize an OAuth 2.1 request from query parameters or an application/x-www-form-urlencoded POST body"
export async function get_api_auth_oauth2_authorize(ctx: HandlerContext): Promise<Response> {
  const q = params(ctx);
  const client = clientById(ctx, String(q.client_id ?? ''));
  if (!client) return page(400, 'invalid_client: this client is not registered with the identity service');
  const redirect = String(q.redirect_uri ?? '');
  if (!redirectAllowed(client, redirect)) return page(400, 'invalid_redirect: this redirect_uri is not registered for the client');
  // source: recording:provider-source.txt "client is not authorized to use the authorization_code grant"
  if (!grants(client, 'authorization_code')) return Response.redirect(`${issuerOf(ctx)}/error?error=unauthorized_client`, 302);
  if (q.response_type !== 'code') return Response.redirect(`${redirect}?error=unsupported_response_type&state=${encodeURIComponent(String(q.state ?? ''))}`, 302);
  // source: recording:provider-source.txt "The following scopes are invalid:"
  const scopes = String(q.scope ?? client.scope ?? SCOPES.join(' ')).split(/\s+/).filter(Boolean);
  const allowed = typeof client.scope === 'string' ? client.scope.split(/\s+/) : SCOPES;
  if (scopes.some((scope) => !allowed.includes(scope))) return Response.redirect(`${redirect}?error=invalid_scope&state=${encodeURIComponent(String(q.state ?? ''))}`, 302);
  // source: recording:provider-source.txt "if (client.requirePKCE ?? true) return \"pkce is required for this client\";"
  const pkceRequired = isPublic(client) || client.require_pkce !== false || (scopes.includes('offline_access') && !(scopes.includes('openid') && q.nonce));
  if ((pkceRequired || q.code_challenge || q.code_challenge_method) && (q.code_challenge_method !== 'S256' || typeof q.code_challenge !== 'string' || !q.code_challenge)) return Response.redirect(`${redirect}?error=invalid_request&error_description=${encodeURIComponent('an S256 code_challenge is required')}&state=${encodeURIComponent(String(q.state ?? ''))}`, 302);
  // prompt=login asks the person to sign in again even with a session (OpenID Connect Core 3.1.2.1)
  const user = q.prompt === 'login' ? undefined : sessionUser(ctx);
  if (!user) return new Response(null, { status: 302, headers: { location: `${issuerOf(ctx)}/login?${new URL(ctx.call.request.url).searchParams.toString()}` } });
  // source: recording:provider-source.txt "if (client.skipConsent) return redirectWithAuthorizationCode"
  // The demanded first-party clients skip consent. No consent screen is served; refuse that gap rather than grant it.
  if (!client.skip_consent || q.prompt === 'consent') return consentGap();
  const authTime = Math.floor(Date.parse(String(sessionOf(ctx)?.created)) / 1000);
  // drawn from a secret the World holds (ctx.secret): a code is a credential until it is exchanged
  const code = ctx.crypto.uuidFrom(await ctx.secret(`volteridentity:code:${String(client.client_id)}:${String(user.id)}:${ctx.occurredAt}:${await serial(ctx, 'code')}`));
  await ctx.record(CODE, { client: client.client_id, user: user.id, redirect_uri: redirect, scopes, auth_time: authTime, nonce: q.nonce ?? null, challenge: q.code_challenge ?? null, resource: q.resource ?? null, expires: nowSeconds(ctx) + 600 }, ctx.crypto.digest('sha256', code, 'hex'));
  const back = new URL(redirect);
  back.searchParams.set('code', code);
  if (q.state !== undefined) back.searchParams.set('state', String(q.state));
  back.searchParams.set('iss', issuerOf(ctx));
  return new Response(null, { status: 302, headers: { location: back.toString() } });
}

/** `POST /api/auth/oauth2/token`: a grant for tokens. */
// source: spec:/paths/~1api~1auth~1oauth2~1token/post "Obtain an OAuth2.1 access token"
export async function post_api_auth_oauth2_token(ctx: HandlerContext): Promise<Response> {
  const p = params(ctx);
  const grant = String(p.grant_type ?? '');
  if (grant === 'urn:ietf:params:oauth:grant-type:device_code') return deviceGrant(ctx, p);
  const client = clientOf(ctx, p);
  if (!client) return oauthError(401, 'invalid_client', 'client authentication failed');
  // a client takes only the grants it was registered for (its grant_types, /admin/clients)
  if (GRANTS.includes(grant) && !grants(client, grant)) return oauthError(400, 'unauthorized_client', `the client is not registered for ${grant}`);
  if (grant === 'client_credentials') {
    // a public client holds no credential of its own to grant on (RFC 6749 4.4)
    if (isPublic(client)) return oauthError(400, 'unauthorized_client', 'a public client may not use client_credentials');
    // a product's own scope, granted by the operator alone (auth.ts: "`organizations` is a product's own scope"): the
    // client's client_credentials_scopes
    const asked = String(p.scope ?? '').split(/\s+/).filter(Boolean);
    const allowed = (client.client_credentials_scopes as string[] | undefined) ?? [];
    if (asked.some((s) => !allowed.includes(s))) return oauthError(400, 'invalid_scope', 'a scope asked is not the client\'s');
    const resource = typeof p.resource === 'string' ? p.resource : undefined;
    if (resource && !linked(client, resource)) return oauthError(400, 'invalid_target', 'the resource is not one this client is linked to');
    return tokensFor(ctx, client, undefined, asked, resource);
  }
  if (grant === 'authorization_code') {
    const key = ctx.crypto.digest('sha256', String(p.code ?? ''), 'hex');
    const code = live(ctx.row(CODE, key));
    if (!code || code.client !== client.client_id || Number(code.expires) < nowSeconds(ctx)) return oauthError(400, 'invalid_grant', 'the code is not valid');
    if (code.redirect_uri !== p.redirect_uri) return oauthError(400, 'invalid_grant', 'the redirect_uri is not the code\'s');
    // PKCE, S256 only (the discovery document's code_challenge_methods_supported); a public client's code always has a
    // challenge, so its exchange always needs the verifier
    if (isPublic(client) && !code.challenge) return oauthError(400, 'invalid_grant', 'a public client\'s code must have been asked with PKCE');
    if (code.challenge && ctx.crypto.digest('sha256', String(p.code_verifier ?? ''), 'base64url') !== code.challenge) return oauthError(400, 'invalid_grant', 'the code_verifier does not match');
    // the resource the tokens are for: the one asked at the token endpoint, else at authorize (RFC 8707 2.2)
    const resource = typeof p.resource === 'string' ? p.resource : (code.resource as string | null) ?? undefined;
    if (resource && !linked(client, resource)) return oauthError(400, 'invalid_target', 'the resource is not one this client is linked to');
    await ctx.remove(CODE, key, 'authorization_code.redeem');
    const user = userById(ctx, String(code.user));
    if (!user) return oauthError(400, 'invalid_grant', 'the person is gone');
    return tokensFor(ctx, client, user, code.scopes as string[], resource, (code.nonce as string | null) ?? undefined, Number(code.auth_time));
  }
  return grant === 'refresh_token' ? refreshGrant(ctx, client, p) : unsupportedGrant(grant);
}

async function refreshGrant(ctx: HandlerContext, client: Row, p: Row): Promise<Response> {
    const key = ctx.crypto.digest('sha256', String(p.refresh_token ?? ''), 'hex');
    const held = live(ctx.row(REFRESH, key));
    if (!held || held.client !== client.client_id || Number(held.expires) <= nowSeconds(ctx)) return oauthError(400, 'invalid_grant', 'the refresh token is not valid');
    const user = userById(ctx, String(held.user));
    if (!user) return oauthError(400, 'invalid_grant', 'the person is gone');
    // Held-resource and scope checks precede revoked reuse; issuance policy follows it.
    // a refresh asks for a resource of its own (@volter/identity's tokenFor: an access token whose audience is the product)
    const resource = typeof p.resource === 'string' ? p.resource : (held.resource as string | null) ?? undefined;
    // source: recording:provider-refresh-source.txt "requested resource invalid"
    if (resource && held.resource && resource !== held.resource) return oauthError(400, 'invalid_target', 'the requested resource was not granted');
    // The provider checks the held resource before the requested scopes.
    // source: recording:provider-refresh-source.txt "if (!validScopes.has(requestedScope)) throw new APIError"
    const scopes = held.scopes as string[];
    const requestedScopes = typeof p.scope === 'string' ? p.scope.split(' ') : undefined;
    if (requestedScopes?.some((scope) => !scopes.includes(scope))) return oauthError(400, 'invalid_scope', 'the requested scope was not granted');
    // Only a known, unexpired predecessor of this authenticated client can invalidate a family.
    // This is the vendor's existing zero-grace configuration; bounded response replay is outside this pack.
    // source: recording:provider-refresh-source.txt "await invalidateRefreshFamily(ctx, client_id, refreshToken.userId);"
    if (held.status === 'rotated') {
      const family = ctx.rowsRaw(REFRESH).filter((row) => row.deleted !== true && row.client === held.client && row.user === held.user);
      const ids = new Set(family.map((row) => String(row.id)));
      // source: recording:provider-refresh-source.txt "model: \"oauthAccessToken\""
      // JWT access tokens remain governed by signature/expiry, as at the issuer. Only opaque children are removed.
      for (const access of ctx.rowsRaw('_access_token')) if (access.deleted !== true && ids.has(String(access.refreshId)))
        await ctx.remove('_access_token', String(access.id), 'refresh_family.invalidate');
      for (const row of family) await ctx.remove(REFRESH, String(row.id), 'refresh_family.invalidate');
      return oauthError(400, 'invalid_grant', 'the refresh token is not valid');
    }
    // Current client/resource registration is resolved only for an active grant's issuance.
    // source: recording:provider-refresh-source.txt "const grantIssuance = await resolveResourceGrantIssuance(ctx, opts, {"
    if (resource && !linked(client, resource)) return oauthError(400, 'invalid_target', 'the resource is not one this client is linked to');
    return tokensFor(ctx, client, user, requestedScopes ?? scopes, resource, undefined, typeof held.auth_time === 'number' ? held.auth_time : undefined, held);
}

/** The device-code grant (RFC 8628 3.4): pending until the person approves on the device page, then the tokens. */
async function deviceGrant(ctx: HandlerContext, p: Row): Promise<Response> {
  const key = ctx.crypto.digest('sha256', String(p.device_code ?? ''), 'hex');
  // a confidential client polls with its secret, a public one with its id alone (the token endpoint's client authentication)
  const client = clientOf(ctx, p);
  if (!client) return oauthError(401, 'invalid_client', 'client authentication failed');
  if (!grants(client, 'urn:ietf:params:oauth:grant-type:device_code')) return oauthError(400, 'unauthorized_client', 'the client is not registered for the device code');
  const d = live(ctx.row(DEVICE, key));
  if (!d || d.client !== client.client_id) return oauthError(400, 'invalid_grant', 'the device code is not valid');
  if (Number(d.expires) < nowSeconds(ctx)) return oauthError(400, 'expired_token', 'the device code has expired');
  if (d.status === 'denied') return oauthError(400, 'access_denied', 'the person denied the request');
  if (d.status !== 'approved') return oauthError(400, 'authorization_pending', 'the person has not yet approved the request');
  const user = userById(ctx, String(d.user));
  if (!user) return oauthError(400, 'invalid_grant', 'the device code is not valid');
  await ctx.remove(DEVICE, key, 'device_code.redeem');
  return tokensFor(ctx, client, user, d.scopes as string[], undefined, undefined, typeof d.auth_time === 'number' ? d.auth_time : undefined);
}

/** The person an access token names, for userinfo. */
async function bearerUser(ctx: HandlerContext): Promise<{ user: Row; scopes: string[] } | undefined> {
  const token = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const opaque = token ? live(ctx.row('_access_token', ctx.crypto.digest('sha256', token, 'hex'))) : undefined;
  const claims = opaque && Number(opaque.expires) > nowSeconds(ctx) ? { sub: opaque.user, scope: (opaque.scopes as string[]).join(' ') } : token ? await verified(ctx, token) : undefined;
  const user = claims ? userById(ctx, String(claims.sub)) : undefined;
  return user && claims ? { user, scopes: String(claims.scope ?? '').split(' ') } : undefined;
}
const userinfo = async (ctx: HandlerContext): Promise<Response> => {
  const who = await bearerUser(ctx);
  return who ? Response.json({ sub: who.user.id, ...claimsOf(who.user, who.scopes), ...linkedClaims(ctx, who.user) }) : oauthError(401, 'invalid_token', 'the access token is not valid');
};
// source: spec:/paths/~1api~1auth~1oauth2~1userinfo/get "Get OpenID Connect user information (UserInfo endpoint)"
export async function get_api_auth_oauth2_userinfo(ctx: HandlerContext): Promise<Response> { return userinfo(ctx); }

/** An unsupported grant receives the OAuth error taxonomy, not a success. */
// source: https://www.rfc-editor.org/rfc/rfc6749 "The authorization grant type is not supported by the authorization server."
function unsupportedGrant(grant: string): Response {
  return oauthError(400, 'unsupported_grant_type', `${grant} is not supported`);
}

/** Consent-dependent clients are outside the served first-party flows; no authorization is fabricated for them. */
function consentGap(): Response {
  return oauthError(400, 'invalid_request', 'the twin does not serve the consent flow');
}
