// X's OAuth 2.0 token and revoke endpoints (https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token):
//
//   POST /2/oauth2/token   grant_type=authorization_code (code + redirect_uri + code_verifier, PKCE verified with real
//                          SHA-256) and grant_type=refresh_token (the spent refresh token rotates)
//   POST /2/oauth2/revoke  an App revokes a token it holds, and with it the (client, user) grant's every token
//
// Both are `application/x-www-form-urlencoded` (the docs' curl examples; a JSON object's fields are read too: formOf)
// and answer the RFC 6749 flat error body
// (shared.ts, family 1). A CONFIDENTIAL client authenticates with HTTP Basic, base64(client_id:
// client_secret), and "you don't need client id [in the body] for confidential clients with a valid Authorization
// Header"; a PUBLIC client has no secret and "you still are required to include Client Id in the body". A confidential
// client presenting no Basic header is refused: the docs document no client_secret_post alternative, and inventing that
// tolerance would be the inverse false-green (`x.token.client_secret_post`, todo pins the live behaviour).
//
// Every credential is kept by its SHA-256 (shared.ts, the state): the code a redemption consumes, the access and
// refresh tokens it issues. A redemption and a rotation each decide on their credential (the code consumed, the refresh token
// revoked), asking the machine for the move (../manifest.ts), before anything is issued; a decision, not a claim
// (shared.ts's header: two concurrent redemptions of one code can both be answered, the gap).
import { type HandlerContext, sha256 } from '@volter/world-core';
import { badAuthorizationCode, badRefreshToken, clientSecretMatches, credentialFields, credentialSalt, credentialRow, credentialRows, CREDENTIAL, decide, grantStands, headersOf, invalidClient, mintAccessToken, mintRefreshToken, nextRevIn, NOSTORE, nowSeconds, oauthError, parseScopeParam, pkceVerifies, put, putRev, rowsFor, send, type Row, type Rows, type XResponse } from './shared.ts';
/** X's documented default access-token lifetime: "Access tokens default to 2-hour validity" (docs.x.com
 *  authorization-code guide, fetched 2026-08-21). */
const ACCESS_TOKEN_TTL_SECONDS = 7200;

/**
 * Client authentication at the token and revoke endpoints (the docs' rule, above). The percent-decode of a Basic
 * credential applies RFC 6749 §2.3.1 (client_id and client_secret are form-urlencoded before Basic encoding); X's docs
 * describe the header only as base64(client_id:client_secret) — EXTRAPOLATION, and the containment of a hostile decode
 * is what `x.errors.malformed_client_auth_contained` certifies (the pack's route-boundary guard answers the
 * URIError it throws as the vendor's 400).
 */
// source: https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token "If you are working with confidential clients, you will need to use a basic authentication scheme for generating an authorization header with base64 encoding while making requests to the token endpoints."
function authenticateClient(form: URLSearchParams, headers: Record<string, string>, rows: Rows): { client: Row } | { fail: XResponse } {
  const lookup = (id: string) => rows('oauth_client').find((row) => row.id === id);
  const basic = headers['authorization'];
  if (basic && /^basic /i.test(basic)) {
    const decoded = Buffer.from(basic.slice(6).trim(), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep < 0) return { fail: invalidClient() };
    const clientId = decodeURIComponent(decoded.slice(0, sep));
    const secret = decodeURIComponent(decoded.slice(sep + 1));
    const client = lookup(clientId);
    if (!client || client.clientType === 'public' || !clientSecretMatches(rows, client, secret)) return { fail: invalidClient() };
    return { client };
  }
  const clientId = form.get('client_id');
  if (!clientId) return { fail: oauthError('invalid_request', 'Missing required parameter [client_id].', 400) };
  const client = lookup(clientId);
  if (!client) return { fail: invalidClient() };
  if (client.clientType === 'confidential') return { fail: invalidClient() };
  return { client };
}

/**
 * The leg's parameters: its form body (the docs' curl examples), or a JSON object's fields. twitter-api-v2 1.29.1 sends
 * both OAuth 2.0 legs JSON-encoded (dist/cjs/client-mixins/request-param.helper.js autoDetectBodyType: its "oauth2 takes
 * url encoded" branch tests `url.password` for the path, so every /2/ path is `json`), and applications complete X's
 * OAuth 2.0 with it (`loginWithOAuth2`, `refreshOAuth2Token`, `revokeOAuth2Token`), so X takes that body too. A JSON
 * body that does not parse, or that is not an object, carries no parameter.
 */
function formOf(ctx: HandlerContext): URLSearchParams {
  if (!(ctx.call.request.headers.get('content-type') ?? '').toLowerCase().includes('json')) return new URLSearchParams(ctx.text);
  const body = ctx.body;
  const out = new URLSearchParams();
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out.set(k, String(v));
  }
  return out;
}

/** The token body both official SDKs type: lowercase `bearer`, the 2-hour expiry, the granted scope, and a refresh
 *  token when the grant carries offline.access. */
function issuedTokenResponse(accessToken: string, grantedScope: string, refreshToken?: string): XResponse {
  const body: Record<string, unknown> = {
    token_type: 'bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    access_token: accessToken,
    // the FULL granted set: X's consent is all-or-nothing, and the scope is space-separated on the wire
    scope: grantedScope,
  };
  if (refreshToken) body['refresh_token'] = refreshToken;
  return { status: 200, body, headers: { ...NOSTORE } };
}

/** A refresh token rides EXACTLY when the grant carries offline.access ("The offline.access scope enables refresh token
 *  issuance", the Authorization Code Flow page). */
function refreshFor(scope: string, refreshToken: string): string | undefined {
  if (parseScopeParam(scope).includes('offline.access')) return refreshToken;
  return undefined;
}

/** Issue an access token (and a refresh token) for a claimed code or a spent refresh token, as bookkeeping — each in a
 *  decision that finds the (client, user) grant still standing. A revoke writes the grant's revocation BEFORE it sweeps
 *  the grant's tokens (post_2_oauth2_revoke), so a token issued before that write is swept, and one decided after it is
 *  never issued: a revoke racing a redemption or a rotation leaves no working token. False when the grant was revoked. */
async function issue(ctx: HandlerContext, grant: { clientId: string; sub: string; scope: string }, access: string, refresh: string | undefined): Promise<boolean> {
  const fields = { clientId: grant.clientId, sub: grant.sub, scope: grant.scope };
  const issueOne = (resource: string, id: string, row: Record<string, unknown>, operation: string) => decide<boolean>(ctx, (rows) => (
    grantStands(rows, grant.clientId, grant.sub) ? { value: true, write: { resource, id, fields: row, operation } } : { value: false }
  ));
  if (!await issueOne(CREDENTIAL.access.type, sha256(access), { ...fields, expiresAt: nowSeconds(ctx) + ACCESS_TOKEN_TTL_SECONDS, revoked: false, rev: 1 }, 'access_token.issue')) return false;
  if (refresh && !await issueOne(CREDENTIAL.refresh.type, sha256(refresh), { ...fields, revoked: false, rev: 1 }, 'refresh_token.issue')) return false;
  return true;
}

/** POST /2/oauth2/token. */
export async function post_2_oauth2_token(ctx: HandlerContext): Promise<Response> {
  // X's token endpoint is form-encoded (the docs' curl examples), and takes the JSON body twitter-api-v2 sends (formOf)
  const form = formOf(ctx);
  const grantType = form.get('grant_type');
  if (!grantType) return send(oauthError('invalid_request', 'Missing required parameter [grant_type].', 400));
  if (grantType === 'authorization_code') return send(await authorizationCodeGrant(ctx, form));
  if (grantType === 'refresh_token') return send(await refreshTokenGrant(ctx, form));
  // X's OAuth 2.0 user-token endpoint documents exactly the two grants (the spec's patched `grant_type` enum). The
  // app-only bearer flow lives at the v1.1 `/oauth2/token` path, filed as `x.app_only.bearer_token`, todo.
  // source: https://www.rfc-editor.org/rfc/rfc6749 "The authorization grant type is not supported by the authorization server."
  return send(oauthError('unsupported_grant_type', `Unsupported grant_type: ${grantType}.`, 400));
}

async function authorizationCodeGrant(ctx: HandlerContext, form: URLSearchParams): Promise<XResponse> {
  const code = form.get('code');
  if (!code) return oauthError('invalid_request', 'Missing required parameter [code].', 400);
  const redirectUri = form.get('redirect_uri');
  if (!redirectUri) return oauthError('invalid_request', 'Missing required parameter [redirect_uri].', 400);
  const verifier = form.get('code_verifier');
  if (!verifier) return oauthError('invalid_request', 'Missing required parameter [code_verifier].', 400);
  const issuedMs = Date.parse(ctx.occurredAt);
  const accessToken = mintAccessToken(rowsFor(ctx), issuedMs, code, await credentialSalt(ctx));
  const refreshToken = mintRefreshToken(rowsFor(ctx), issuedMs, code, await credentialSalt(ctx));
  const headers = headersOf(ctx.call.request);
  const now = nowSeconds(ctx);
  // THE CLAIM: every check and the code's consumption in one decision, so exactly one redemption holds it. An unusable
  // code — unknown, already redeemed, expired, minted for another client, a redirect_uri other than its own, a
  // verifier that does not satisfy its challenge — gets the one indistinguishable answer (telling them apart would
  // leak which codes exist).
  const claimed = await decide<{ refused: XResponse } | { client: Row; code: Row }>(ctx, (rows) => {
    const auth = authenticateClient(form, headers, rows);
    if ('fail' in auth) return { value: { refused: auth.fail } };
    const held = credentialRow(rows, 'code', code);
    const row = held?.row;
    if (!held || !row || row.clientId !== auth.client.id || row.revoked === true) return { value: { refused: badAuthorizationCode() } };
    if (typeof row.expiresAt === 'number' && now >= row.expiresAt) return { value: { refused: badAuthorizationCode() } };
    if (redirectUri !== row.redirectUri) return { value: { refused: badAuthorizationCode() } };
    // PKCE: S256 with real SHA-256, or plain compared literally (shared.ts, PKCE)
    if (!pkceVerifies(row.codeChallengeMethod === 'S256' ? 'S256' : 'plain', String(row.codeChallenge ?? ''), verifier)) return { value: { refused: badAuthorizationCode() } };
    // source: https://www.rfc-editor.org/rfc/rfc6749 "If an authorization code is used more than once, the authorization server MUST deny the request and SHOULD revoke (when possible) all tokens previously issued based on that authorization code."
    if (ctx.legal('_authorization_code', 'consumed', 'post_2_oauth2_token', row.consumed, 'true', held.key)) return { value: { refused: badAuthorizationCode() } };
    return {
      value: { client: auth.client, code: row },
      write: {
        resource: CREDENTIAL.code.type,
        id: held.key,
        fields: { ...credentialFields(row), consumed: true, rev: nextRevIn(rows(CREDENTIAL.code.type) as Row[], CREDENTIAL.code.type, held.key) },
        operation: 'authorization_code.redeem',
      },
    };
  });
  if ('refused' in claimed) return claimed.refused;
  const scope = String(claimed.code.scope);
  const refresh = refreshFor(scope, refreshToken);
  if (!await issue(ctx, { clientId: String(claimed.client.id), sub: String(claimed.code.sub), scope }, accessToken, refresh)) return badAuthorizationCode();
  return issuedTokenResponse(accessToken, scope, refresh);
}

async function refreshTokenGrant(ctx: HandlerContext, form: URLSearchParams): Promise<XResponse> {
  const presented = form.get('refresh_token');
  if (!presented) return oauthError('invalid_request', 'Missing required parameter [refresh_token].', 400);
  const issuedMs = Date.parse(ctx.occurredAt);
  const accessToken = mintAccessToken(rowsFor(ctx), issuedMs, presented, await credentialSalt(ctx));
  const replacement = mintRefreshToken(rowsFor(ctx), issuedMs, presented, await credentialSalt(ctx));
  const headers = headersOf(ctx.call.request);
  // THE CLAIM: the spent refresh token is revoked in the decision that checks it, so one rotation wins. Refresh tokens
  // ROTATE (the reported wire behaviour; `x.refresh.rotation`, live pin `x.refresh.token_lifetime`).
  const claimed = await decide<{ refused: XResponse } | { client: Row; refresh: Row }>(ctx, (rows) => {
    const auth = authenticateClient(form, headers, rows);
    if ('fail' in auth) return { value: { refused: auth.fail } };
    const held = credentialRow(rows, 'refresh', presented);
    const row = held?.row;
    if (!held || !row || row.clientId !== auth.client.id) return { value: { refused: badRefreshToken() } };
    // source: https://www.rfc-editor.org/rfc/rfc6749 "The provided authorization grant (e.g., authorization code, resource owner credentials) or refresh token is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client."
    if (ctx.legal('_refresh_token', 'revoked', 'post_2_oauth2_token', row.revoked, 'true', held.key)) return { value: { refused: badRefreshToken() } };
    return {
      value: { client: auth.client, refresh: row },
      write: {
        resource: CREDENTIAL.refresh.type,
        id: held.key,
        fields: { ...credentialFields(row), revoked: true, rev: nextRevIn(rows(CREDENTIAL.refresh.type) as Row[], CREDENTIAL.refresh.type, held.key) },
        operation: 'post_2_oauth2_token',
      },
    };
  });
  if ('refused' in claimed) return claimed.refused;
  const scope = String(claimed.refresh.scope);
  if (!await issue(ctx, { clientId: String(claimed.client.id), sub: String(claimed.refresh.sub), scope }, accessToken, replacement)) return badRefreshToken();
  return issuedTokenResponse(accessToken, scope, replacement);
}


