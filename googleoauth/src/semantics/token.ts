// Google's token endpoint: an authorization code (with PKCE) for tokens, a refresh token for a new access token, and a
// service account's signed JWT assertion for an access token.
import type { HandlerContext } from '@volter/world-core';
import { accountBySub, clientOf, CODE, issue, live, nowSeconds, oauthError, REFRESH, type Row, SERVICE_ACCOUNT, SERVICE_ACCOUNT_KEY, ACCESS_TOKEN, credential, serial } from './shared.ts';

// source: https://developers.google.com/identity/protocols/oauth2/web-server "After the web server receives the authorization code, it can exchange the authorization code for an access token."
export async function token(ctx: HandlerContext): Promise<Response> {
  const p = ctx.params as Row;
  const grant = String(p.grant_type ?? '');
  // source: https://developers.google.com/identity/protocols/oauth2/service-account "urn:ietf:params:oauth:grant-type:jwt-bearer assertion The JWT, including signature."
  if (grant === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
    let claims: Row;
    let keyId: string | undefined;
    try { const decoded = ctx.crypto.jwtDecode(String(p.assertion ?? '')); claims = decoded.payload as Row; keyId = typeof decoded.header.kid === 'string' ? decoded.header.kid : undefined; } catch { return oauthError(400, 'invalid_grant', 'Invalid JWT Signature.'); }
    const sa = live(ctx.row(SERVICE_ACCOUNT, String(claims.iss ?? '')));
    if (!sa) return oauthError(400, 'invalid_grant', 'Invalid grant: account not found');
    // the assertion is signed with the account's key (the one its key file holds)
    const [h, pl, sig] = String(p.assertion ?? '').split('.');
    const managed = ctx.rowsRaw(SERVICE_ACCOUNT_KEY, { withDeleted: true }).filter((row) => row._service_account === sa.id);
    const keys = managed.filter((row) => row.deleted !== true);
    if (typeof sa.public_key === 'string' && !managed.some((row) => row.private_key_id === sa.private_key_id)) keys.push(sa);
    if (!keys.some((key) => (!keyId || key.private_key_id === keyId) && typeof key.public_key === 'string' && ctx.crypto.verifyWith(key.public_key, `${h}.${pl}`, Buffer.from(String(sig ?? ''), 'base64url')))) return oauthError(400, 'invalid_grant', 'Invalid JWT Signature.');
    if (Number(claims.exp ?? 0) < nowSeconds(ctx)) return oauthError(400, 'invalid_grant', 'Invalid JWT: Token must be a short-lived token (60 minutes) and in a reasonable timeframe.');
    const access = await credential(ctx, 'ya29.c.', `sa:${String(claims.iss)}:${ctx.occurredAt}:${await serial(ctx)}`, 180);
    await ctx.write(ACCESS_TOKEN, access, { clientId: sa.client_id ?? String(claims.iss), sub: String(claims.sub ?? claims.iss), scope: String(claims.scope ?? ''), expiresAt: nowSeconds(ctx) + 3599, revoked: false, serviceAccountEmail: String(claims.iss) }, 'access_token.create');
    return Response.json({ access_token: access, expires_in: 3599, token_type: 'Bearer' }, { headers: { 'cache-control': 'no-store' } });
  }
  const client = clientOf(ctx, p);
  if (!client) return oauthError(401, 'invalid_client', 'The OAuth client was not found.');
  // source: https://developers.google.com/identity/protocols/oauth2/web-server "After the web server receives the authorization code, it can exchange the authorization code for an access token."
  if (grant === 'authorization_code') {
    const key = ctx.crypto.digest('sha256', String(p.code ?? ''), 'hex');
    const code = live(ctx.row(CODE, key));
    if (!code || code.clientId !== client.client_id || Number(code.expires) < nowSeconds(ctx)) return oauthError(400, 'invalid_grant', 'Malformed auth code.');
    if (code.redirect_uri !== p.redirect_uri) return oauthError(400, 'redirect_uri_mismatch', 'Bad Request');
    if (code.challenge) {
      const verifier = String(p.code_verifier ?? '');
      const derived = code.method === 'S256' ? ctx.crypto.digest('sha256', verifier, 'base64url') : verifier;
      if (derived !== code.challenge) return oauthError(400, 'invalid_grant', 'Invalid code verifier.');
    }
    await ctx.remove(CODE, key, 'authorization_code.redeem');
    const account = accountBySub(ctx, String(code.sub));
    if (!account) return oauthError(400, 'invalid_grant', 'Account has been deleted');
    return Response.json(await issue(ctx, client, account, code.scopes as string[], code.offline === true, (code.nonce as string | null) ?? undefined), { headers: { 'cache-control': 'no-store' } });
  }
  // source: https://developers.google.com/identity/protocols/oauth2/web-server "Then, if the access token expires (or at any other time), you can use a refresh token to obtain a new access token."
  if (grant === 'refresh_token') {
    const held = live(ctx.row(REFRESH, ctx.crypto.digest('sha256', String(p.refresh_token ?? ''), 'hex')));
    if (!held || held.clientId !== client.client_id) return oauthError(400, 'invalid_grant', 'Token has been expired or revoked.');
    const account = accountBySub(ctx, String(held.sub));
    if (!account) return oauthError(400, 'invalid_grant', 'Token has been expired or revoked.');
    const out = await issue(ctx, client, account, held.scopes as string[], false);
    return Response.json(out, { headers: { 'cache-control': 'no-store' } });
  }
  return oauthError(400, 'unsupported_grant_type', `Invalid grant_type: ${grant}`);
}

