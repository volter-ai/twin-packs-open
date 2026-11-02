// X's OAuth 1.0a legs (https://docs.x.com/fundamentals/authentication/api-reference, and the 3-legged walkthrough,
// https://docs.x.com/fundamentals/authentication/oauth-1-0a/obtaining-user-access-tokens), each a consumer-signed POST
// on api.x.com:
//
//   POST /oauth/request_token        step 1: a request token for a registered App (kept by its SHA-256, with its secret)
//   POST /oauth/access_token         step 3: an authorized request token + its verifier -> an access token
//
// Step 2 is a person on X's authorize screen (../screens/oauth1-authorize.ts). The request token's life across the legs is the
// manifest's machine (`_oauth1_request_token.state`), asked on every move. The access token and the App are the rows
// the x pack reads by contract (shared.ts, OAuth 1.0a): `_oauth1_token` named by the token, with its secret.
//
// THE CONSUMER this serves is twitter-api-v2's OAuth 1.0a flow: `generateAuthLink(callback, {authAccessType:'write',
// linkMode:'authenticate'})`, `login(oauth_verifier)`, then `v2.me()`, every one signed with HMAC-SHA1.
import { type HandlerContext, sha256 } from '@volter/world-core';
import { alnum, GAP, badAuthenticationData, credentialSalt, callbackNotApproved, credentialFields, credentialRow, CREDENTIAL, decide, formBody, formReply, invalidOrExpiredToken, nextRevIn, NOSTORE, requestTokensHeld, send, signedCall, verifyConsumer, type Row, type XResponse } from './shared.ts';
const REQUEST_TOKEN = CREDENTIAL.requestToken.type;

/** POST oauth/request_token. */
export async function post_oauth_request_token(ctx: HandlerContext): Promise<Response> {
  const salt = await credentialSalt(ctx);
  const call = signedCall(ctx);
  const at = ctx.occurredAt;
  return send(await decide<XResponse>(ctx, (rows) => {
    const checked = verifyConsumer(call, [...rows('oauth1_app')] as Row[], () => '');
    if ('fail' in checked) return { value: checked.fail };
    const { app, params } = checked;
    // "For OAuth 1.0a compliance this parameter is required" (api-reference). A missing one is a malformed request:
    // RFC 5849 §3.2 answers 400; the body is EXTRAPOLATION (215, pinned by `x.oauth1.request_token_error_wording`).
    const callback = params.get('oauth_callback');
    if (!callback) return { value: badAuthenticationData() };
    // Any callback other than `oob` "will have to be configured within the App's settings", matched exactly
    // (developer-apps troubleshooting). The World's App lists none and takes any.
    if (callback === 'oob') return { value: GAP };
    try { new URL(callback); } catch { return { value: callbackNotApproved() }; }
    if (!app.callbackUrls.includes(callback)) return { value: callbackNotApproved() };
    // x_auth_access_type "overrides the access level an application requests … supported values are read or write … to
    // register a read/write application but also request read only access": it can only narrow. A value outside the
    // two is ignored (EXTRAPOLATION, pinned by `x.oauth1.access_type_unknown_value`).
    const asked = new URLSearchParams(call.path.split('?')[1] ?? '').get('x_auth_access_type') ?? formBody(call).get('x_auth_access_type');
    const accessLevel = app.accessLevel === 'read' || asked === 'read' ? 'read' : 'read-write';
    const held = requestTokensHeld(rows);
    const token = alnum(`${salt}:oauth1_request_token:${at}:${held}:${app.consumerKey}`, 27);
    const secret = alnum(`${salt}:oauth1_request_token_secret:${at}:${held}:${token}`, 32);
    return {
      value: formReply({ oauth_token: token, oauth_token_secret: secret, oauth_callback_confirmed: 'true' }),
      write: {
        resource: REQUEST_TOKEN,
        id: sha256(token),
        fields: { consumerKey: app.consumerKey, secret, callback, accessLevel, state: 'issued', rev: 1 },
        operation: 'oauth1_request_token.issue',
      },
    };
  }));
}

/** POST oauth/access_token. */
export async function post_oauth_access_token(ctx: HandlerContext): Promise<Response> {
  const salt = await credentialSalt(ctx);
  const call = signedCall(ctx);
  const at = ctx.occurredAt;
  // THE CLAIM: the signature, the verifier and the request token's move to `exchanged` in one decision, so a request
  // token is traded once.
  const claimed = await decide<{ refused: XResponse } | { request: Row; requestToken: string; userId: string; screenName: string }>(ctx, (rows) => {
    const requestRow = (params: Map<string, string>) => credentialRow(rows, 'requestToken', params.get('oauth_token') ?? '');
    const checked = verifyConsumer(call, [...rows('oauth1_app')] as Row[], (params) => {
      const held = requestRow(params);
      // Unknown, already exchanged, denied or never approved: the token is not one X will trade.
      if (!held || held.row.consumerKey !== params.get('oauth_consumer_key')) return null;
      return String(held.row.secret);
    });
    if ('fail' in checked) return { value: { refused: checked.fail } };
    const held = requestRow(checked.params)!;
    // "applications not using the oauth_verifier will fail to complete the OAuth flow" (api-reference). The refusal's
    // body is EXTRAPOLATION (X answers this leg with a plain-text error, widely reported as below —
    // `x.oauth1.access_token_error_wording`).
    // source: https://docs.x.com/fundamentals/authentication/api-reference "OAuth 1.0a is strictly enforced and applications not using the oauth_verifier will fail to complete the OAuth flow."
    const verifier = checked.params.get('oauth_verifier') ?? formBody(call).get('oauth_verifier') ?? new URLSearchParams(call.path.split('?')[1] ?? '').get('oauth_verifier');
    if (!verifier || verifier !== held.row.verifier) {
      return { value: { refused: { status: 401, body: 'Error processing your OAuth request: Invalid oauth_verifier parameter', headers: { 'content-type': 'text/plain; charset=utf-8', ...NOSTORE } } } };
    }
    const userId = String(held.row.accountId);
    const account = (rows('account') as Row[]).find((r) => r.id === userId);
    if (!account) return missingTokenAccount();
    const refusal = ctx.legal(REQUEST_TOKEN, 'state', 'post_oauth_access_token', held.row.state, 'exchanged', held.key);
    if (refusal) return { value: { refused: invalidOrExpiredToken() } };
    return {
      value: { request: held.row, requestToken: checked.params.get('oauth_token') ?? '', userId, screenName: String(account.username ?? '') },
      write: {
        resource: REQUEST_TOKEN,
        id: held.key,
        fields: { ...credentialFields(held.row), state: 'exchanged', rev: nextRevIn(rows(REQUEST_TOKEN) as Row[], REQUEST_TOKEN, held.key) },
        operation: 'oauth1_request_token.exchange',
      },
    };
  });
  if ('refused' in claimed) return send(claimed.refused);
  const { request, requestToken, userId, screenName } = claimed;
  // X's user access tokens "do not expire but can be revoked" (obtaining-user-access-tokens), and "once an access_token
  // has been invalidated, new creation attempts will yield a different Access Token" (api-reference, invalidate_token)
  // — so until then a creation attempt yields the token the App already holds for that user and level. That reading is
  // EXTRAPOLATION from the two sentences, pinned by `x.oauth1.reauthorize_token_reuse_pin` (todo). The reuse is
  // decided and the new token written in one decision, so two exchanges for one (App, user, level) share one token.
  const issued = await decide<{ token: string; secret: string }>(ctx, (rows) => {
    const existing = (rows('_oauth1_token') as Row[]).find((r) => r.consumerKey === request.consumerKey && r.userId === userId && r.accessLevel === request.accessLevel && r.revoked !== true);
    if (existing) return { value: { token: String(existing.id), secret: String(existing.secret) } };
    const held = rows('_oauth1_token').length;
    // The docs describe a token as the user ID, a dash, and 40 alphanumerics;
    // its secret has 40 characters (fundamentals/authentication/api-reference).
    const token = `${userId}-${alnum(`${salt}:oauth1_token:${at}:${held}:${requestToken}`, 40)}`;
    const secret = alnum(`${salt}:oauth1_token_secret:${at}:${held}:${token}`, 40);
    return {
      value: { token, secret },
      write: { resource: '_oauth1_token', id: token, fields: { consumerKey: request.consumerKey, secret, userId, screenName, accessLevel: request.accessLevel, revoked: false, rev: 1 }, operation: '_oauth1_token.issue' },
    };
  });
  return send(formReply({ oauth_token: issued.token, oauth_token_secret: issued.secret, user_id: userId, screen_name: screenName }));
}



function missingTokenAccount(): { value: { refused: XResponse } } {
  return { value: { refused: invalidOrExpiredToken() } };
}
