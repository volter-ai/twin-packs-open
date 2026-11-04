// Business Login for Instagram's token endpoints: the code traded for a short-lived token on api.instagram.com, that
// token traded for a long-lived one, and a long-lived token refreshed, on graph.instagram.com.
import type { HandlerContext } from '@volter/world-core';
import { APP, ACCOUNT, CODE, BASIC, appById, appScopedId, appSecret, graphError, invalidParam, invalidToken, issueToken, oauthError, paramsOf, seconds, sha256, text, tokenBySha } from './shared.ts';

// source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "To get the access token, send a POST request to the https://api.instagram.com/oauth/access_token endpoint with the following parameters:"
export async function oauthAccessToken(ctx: HandlerContext): Promise<Response> {
  const p = paramsOf(ctx);
  const app = appById(ctx, p.client_id);
  // Where the documentation stops: the page shows one rejected answer ("If the request is malformed in some way");
  // every refusal of the exchange takes that body, its message saying what failed
  if (!app) return oauthError('Invalid platform app');
  if (text(p.client_secret) !== await appSecret(ctx, app)) return oauthError('Error validating client secret.');
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "Set this value to authorization_code ."
  if (text(p.grant_type) !== 'authorization_code') return oauthError('Invalid grant_type: this endpoint takes authorization_code');
  // "NOTE: The #_ appended to the end of the redirect URI is not part of the code itself, so strip it out."
  const given = text(p.code)?.replace(/#_$/, '');
  const code = given ? ctx.rowsRaw(CODE).find((c) => c.deleted !== true && c.sha256 === sha256(ctx, given)) : undefined;
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "This code is valid for 1 hour and can only be used once."
  if (!code || code.used === true || code.app !== app.id || Number(code.expires_at) <= seconds(ctx.occurredAt)) return oauthError('Matching code was not found or was already used');
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "This must be the same URI or we will reject the request."
  if (text(p.redirect_uri) !== code.redirect_uri) return oauthError('Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request');
  await ctx.record(CODE, { ...code, used: true }, String(code.id));
  const account = ctx.row(ACCOUNT, String(code.account))!;
  const permissions = code.permissions as string[];
  const token = await issueToken(ctx, { app: String(app.id), account: String(account.id), permissions, kind: 'short', source: 'business-login' });
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "On success, your app receives a JSON response containing the app user"
  return Response.json({ data: [{ access_token: token.value, user_id: appScopedId(ctx, app, account), permissions: permissions.join(',') }] });
}

// source: https://developers.facebook.com/documentation/instagram-platform/reference/access_token "Exchange a short-lived Instagram User access token, that expires in one hour, for long-lived Instagram User access token that expires in 60 days."
export async function accessToken(ctx: HandlerContext): Promise<Response> {
  const p = paramsOf(ctx);
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/access_token "Set this to ig_exchange_token"
  if (text(p.grant_type) !== 'ig_exchange_token') return invalidParam(ctx, '(#100) grant_type must be ig_exchange_token');
  const value = text(p.access_token);
  const short = value ? tokenBySha(ctx, value) : undefined;
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/access_token "The valid (unexpired) short-lived Instagram User Access Token that you want to exchange for a long-lived token."
  if (!short || short.kind !== 'short' || Number(short.expires_at) <= seconds(ctx.occurredAt)) return invalidToken(ctx);
  const app = ctx.row(APP, String(short.app))!;
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/access_token "secret from the App Dashboard"
  if (text(p.client_secret) !== await appSecret(ctx, app)) return invalidParam(ctx, '(#100) Error validating client secret.');
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/access_token "instagram_business_basic for apps that implemented Business Login for Instagram"
  if (!((short.permissions as string[] | undefined) ?? []).includes(BASIC)) return graphError(ctx, 403, 10, `(#10) Permission is either not granted or has been removed: ${BASIC}.`);
  const long = await issueToken(ctx, { app: String(short.app), account: String(short.account), permissions: short.permissions as string[], kind: 'long', source: 'ig_exchange_token' });
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/access_token "token_type set to bearer"
  return Response.json({ access_token: long.value, token_type: 'bearer', expires_in: long.expiresIn });
}

// source: https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token "Refresh a long-lived accesstoken that is at least 24 hours old but has not expired."
export async function refreshAccessToken(ctx: HandlerContext): Promise<Response> {
  const p = paramsOf(ctx);
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token "Set this to ig_refresh_token ."
  if (text(p.grant_type) !== 'ig_refresh_token') return invalidParam(ctx, '(#100) grant_type must be ig_refresh_token');
  const value = text(p.access_token);
  const held = value ? tokenBySha(ctx, value) : undefined;
  const now = seconds(ctx.occurredAt);
  if (!held || Number(held.expires_at) <= now) return invalidToken(ctx);
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token "The valid (unexpired) long-lived Instagram User Access Token that you want to refresh."
  if (held.kind !== 'long') return invalidParam(ctx, '(#100) Only a long-lived Instagram User access token can be refreshed');
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "The existing long-lived access token is at least 24 hours old"
  if (now - Number(held.issued_at) < 86400) return invalidParam(ctx, '(#100) The access token is less than 24 hours old and cannot be refreshed yet');
  // source: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login "The app user has granted your app the instagram_business_basic permission"
  if (!((held.permissions as string[] | undefined) ?? []).includes(BASIC)) return graphError(ctx, 403, 10, `(#10) Permission is either not granted or has been removed: ${BASIC}.`);
  // Where the documentation stops: the pages do not say the refreshed token stops working; it stays good until its own
  // expiry, beside the new one
  // source: https://developers.facebook.com/documentation/instagram-platform/reference/refresh_access_token "Refreshed tokens are valid for 60 days from the date at which they are refreshed."
  const fresh = await issueToken(ctx, { app: String(held.app), account: String(held.account), permissions: held.permissions as string[], kind: 'long', source: 'ig_refresh_token' });
  return Response.json({ access_token: fresh.value, token_type: 'bearer', expires_in: fresh.expiresIn });
}
