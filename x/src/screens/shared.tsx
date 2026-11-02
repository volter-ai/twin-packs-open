// What X's screens share. The authorize screens (screens/oauth2-authorize.tsx, oauth1-authorize.tsx,
// oauth1-authenticate.tsx): the OAuth 2.0 authorize screen with its consent and decision, the OAuth 1.0a authorize and
// authenticate screens with theirs, the page shell and the error page. And x.com's pages (./web.ts, ./home.tsx,
// ./login.tsx), below: where a page was reached, who is signed in, an operation the person makes, and the shell, skin
// and pieces every page draws.
//
// x.com's OAuth 2.0 authorize screen (docs/contributing/architecture.md, "Screens": a hosted flow), at the vendor's
// own path: `GET /i/oauth2/authorize` on x.com (and twitter.com, which X's legacy official SDK still targets).
//
// ── WHY THIS PACK IS BROWSER-FACING ─────────────────────────────────────────────────────────────
// The whole point of the authorization-code flow is that a browser is redirected to the vendor, a person reads what the
// app is asking for, and clicks Authorize. A twin that skipped the screen and 302'd straight back would be a bypass,
// not a twin — every integration bug that lives in the consent leg (wrong redirect_uri, missing state, a user who
// cancels) would be invisible. So the twin SERVES HTML at the vendor's real path, rendered server-side from its own
// state with @volter/world-ui's consent and flow page. The googleoauth pack is the class precedent.
//
// THE ROUND TRIP is the screen's contract (the Authorization Code Flow page,
// https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code, and its callback example
// `https://www.example.com/?state=state&code=VGNibzFWSWRE…`): the authorize URL and its parameters, the person's two
// decisions ("Authorize app", "Cancel"), and the redirect each sends — the callback with exactly `state` and `code`,
// or with `error=access_denied`. The screen's form posts its decision back to the authorize path, which stands in for
// the undocumented internal endpoint x.com's own form posts to (./oauth2-authorize.tsx); the decision is the
// `auth_request.settled` move the manifest declares, asked of the machine.
//
// The person who consents is the one signed in at x.com (./login.tsx, X's auth_token cookie: a password, no 2FA, no risk
// engine); a visitor nobody signed in is sent to sign in first and returned to the screen. EVIDENCE BOUNDARIES are marked inline: behaviours grounded in
// docs.x.com / the v2 OpenAPI / X's official SDK sources say so; behaviours derived from RFC 6749/7636 are marked
// EXTRAPOLATION with a manifest todo pinning them.
//
// X's OAuth 1.0a authorize screens (docs/contributing/architecture.md, "Screens": hosted flows), on api.x.com (and
// api.twitter.com), where X serves them (https://docs.x.com/fundamentals/authentication/api-reference):
//
//   GET  /oauth/authorize     step 2: the screen, always shown ("The user will always be prompted to authorize access
//                             to your application, even if access was previously granted")
//   GET  /oauth/authenticate  step 2, Sign in with X: "if the user has already granted the application permission, the
//                             redirect will occur without the user having to re-approve", unless force_login=true
//   POST /oauth/authorize     the screen's own form: Authorize app or Cancel
//
// The decision posts to `POST oauth/authorize` on the host that served the screen, as X's own authorize screen does
// (its form's action is `https://api.x.com/oauth/authorize`; the form fields are the twin's). It must be a path this
// pack claims on api.x.com: that host is shared with the `x` pack, which owns its `/_twin/*`, so a `/_twin/` door there
// never reached this pack in a World (a walk of 2026-09-28: "Authorize app" answered the x pack's JSON 400).
//
// Each move of the request token is the manifest's `_oauth1_request_token.state` machine, asked: shown (`pending`,
// bound to the account the screen names), approved (`authorized`, with the verifier), cancelled (`denied`).
import { type HandlerContext, twinVendorUrl, isReadOnlyRequest, READ_ONLY_REQUEST_HEADER, sha256 } from '@volter/world-core';
import { CONSENT_CSS, Consent, flowPage, signedIn } from '@volter/world-ui';
import surface from '../generated/surface.gen.json' with { type: 'json' };
import { CALLER_HEADER, xHostOf, cardOf, type LinkCard, type Resource, tree, webPost, webProfile, X_DEFAULT_PROFILE_IMAGE_URL } from '../semantics/shared.ts';
import { alnum, authRequestIdFor, CODE_CHALLENGE, CREDENTIAL, credentialFields, credentialSalt, credentialRow, credentialRows, describeScopes, formatScopeParam, mintAuthorizationCode, nextRevIn, normalizeChallengeMethod, NOSTORE, nowSeconds, oauth1AppOf, oauthError, parseScopeParam, put, putRev, redirectUriAllowed, type Row, type Rows, rowsFor, sortScopesForConsent, stableHex, type XResponse } from '../semantics/shared.ts';

/** Decide from the current rows, then persist the consent move through the public handler contract. */
async function decide<T>(ctx: HandlerContext, d: (rows: (resource: string) => Row[]) => { value: T; write?: { resource: string; id: string; fields: Record<string, unknown>; operation: string } }): Promise<T> {
  const { value, write } = d((resource) => ctx.rowsRaw(resource) as Row[]);
  if (write) await ctx.write(write.resource, write.id, write.fields, write.operation);
  return value;
}

/** X's real hosts. The authorize screen lives on the site host; the API on api.x.com. The legacy twitter.com pair still
 *  serves the same surface and X's legacy official SDK still targets it. */
export const AUTHORIZE_ORIGIN = 'https://x.com';
export const AUTHORIZE_PATH = '/i/oauth2/authorize';

/** X's authorization codes are short-lived; 30 seconds is the widely-reported figure. EXTRAPOLATION — not read from a
 *  fetched official artefact; pinned as `x.token.code_ttl` (todo). The single-use rule, by contrast, is hard
 *  protocol (the manifest's `_authorization_code.consumed`). */
export const AUTH_CODE_TTL_SECONDS = 30;

/** Where a screen was reached and how it was started. `origin` is the twin's public base (a World mount included), or
 *  undefined for an in-process call on X's own host (the vendor's own URLs are used). */
export type ScreenEnv = { origin: string | undefined; readOnly: boolean };

/**
 * The authorize endpoint's un-redirectable failure path: until the redirect_uri is proven to belong to the client there
 * is no address the twin may bounce an error to, so unknown-client and bad-callback failures render the vendor's error
 * page (served WITH the failure's status: a 200 would hide the failure from scripts). EXTRAPOLATION: X's live page and
 * its HTTP status were not captured — the security boundary itself is RFC 6749 §4.1.2.1's hard rule. Pinned as
 * `x.authorize.error_page_fidelity` (todo).
 */
export function errorPage(_env: ScreenEnv, e: { status: number; code: string; detail: string; requestParam?: string }): XResponse {
  return pageAnswer(flowPage({
    title: `Error ${e.status}: ${e.code} / X`,
    css: [CONSENT_CSS],
    status: e.status,
    headers: NOSTORE,
    body: (
      <main className="consent">
        <h1 className="consent-heading">Something went wrong</h1>
        <p className="error-detail">You weren&apos;t able to give access to the App. {e.detail}</p>
        <p className="error-code">Error {e.status}: {e.code}</p>
        {e.requestParam ? <p className="error-request">Request details: {e.requestParam}</p> : null}
      </main>
    ),
  }), e.status);
}

/** A visitor nobody signed in at x.com: sent to x.com's sign-in, which returns them to the screen they asked for. The
 *  sign-in is x.com's on X's own hosts, and the twin's own (its base, a World's place included) where the twin is reached
 *  at its own address, as the consent form's action is (`env.origin`); the return address is the screen's path on that
 *  same site, an api.x.com screen by its address on api.x.com, which X's session cookie reaches (./login.tsx). */
// source: https://docs.x.com/fundamentals/authentication/api-reference "The method will use the currently logged in user as the account for access authorization"
// source: https://docs.x.com/fundamentals/authentication/api-reference "Prefills the username input box of the OAuth login screen with the given value."
// Where the documentation stops: X signs a visitor in on the authorize page itself; the twin sends the visitor to
// x.com's sign-in flow and back, the one sign-in it draws.
function toSignIn(ctx: HandlerContext, env: ScreenEnv): XResponse {
  const url = new URL(ctx.call.request.url);
  const host = namedHost(ctx.call.request);
  const path = `${url.pathname}${url.search}`;
  const back = env.origin === undefined && (host === 'api.x.com' || host === 'api.twitter.com') ? `https://api.x.com${path}` : path;
  return { status: 302, body: '', headers: { location: `${env.origin ?? 'https://x.com'}/i/flow/login?redirect_after_login=${encodeURIComponent(back)}`, ...NOSTORE } };
}

/** A rendered page as the screens answer (a status, a body, headers). */
export function pageAnswer(page: Response, status: number): XResponse & { page: Response } {
  return { status, body: '', headers: {}, page };
}

/** A 302 back to a VALIDATED redirect_uri carrying an OAuth error (RFC 6749 §4.1.2.1). */
function redirectError(redirectUri: string, error: string, state: string | null, description?: string): XResponse {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state !== null) url.searchParams.set('state', state);
  return { status: 302, body: '', headers: { location: url.toString(), ...NOSTORE } };
}

/** The success bounce. X's documented callback carries EXACTLY `state` and `code` (the user-access-token guide's
 *  example: `https://www.example.com/?state=state&code=VGNibzFWSWRE…`) — no scope echo, no extra parameters, and the
 *  twin adds none. */
function redirectSuccess(redirectUri: string, code: string, state: string): XResponse {
  const url = new URL(redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code', code);
  return { status: 302, body: '', headers: { location: url.toString(), ...NOSTORE } };
}

/** GET /i/oauth2/authorize: validate the authorization request, record it, and render the screen. */
export async function authorizeScreen(ctx: HandlerContext, env: ScreenEnv, query: URLSearchParams): Promise<XResponse> {
  const rows = rowsFor(ctx);

  // 1. client_id — without a trusted client there is no trusted redirect_uri, so failures here render the error page.
  const clientId = query.get('client_id');
  if (!clientId) return errorPage(env, { status: 400, code: 'invalid_request', detail: 'Missing required parameter: client_id.', requestParam: 'client_id' });
  const client = rows('oauth_client').find((r) => r.id === clientId);
  if (!client) return errorPage(env, { status: 401, code: 'invalid_client', detail: 'The client_id does not name a known App.', requestParam: `client_id=${clientId}` });

  // 2. redirect_uri — THE SECURITY BOUNDARY. X validates the callback against the App's registered Callback URLs with
  //    exact matching; an unregistered one gets the page, never a bounce.
  const redirectUri = query.get('redirect_uri');
  if (!redirectUri) return errorPage(env, { status: 400, code: 'invalid_request', detail: 'Missing required parameter: redirect_uri.', requestParam: 'redirect_uri' });
  if (!redirectUriAllowed(client, redirectUri)) {
    return errorPage(env, {
      status: 400,
      code: 'invalid_request',
      detail: 'The redirect_uri does not match any registered Callback URL for this App. X compares callback URLs exactly.',
      requestParam: `redirect_uri=${redirectUri}`,
    });
  }

  // 3. Everything after the boundary has a trustworthy address, so protocol errors bounce there (RFC 6749 §4.1.2.1 —
  //    EXTRAPOLATION for X: the docs show no authorize error examples; the page-vs-redirect split for each case is
  //    pinned by `x.authorize.error_channel`, todo).
  const state = query.get('state');
  const respond = (error: string, description: string) => redirectError(redirectUri, error, state, description);

  const responseType = query.get('response_type');
  if (!responseType) return respond('invalid_request', 'Missing required parameter: response_type.');
  // `code` is the ONLY response_type X's OAuth 2.0 documents — there is no implicit flow to model, so an unknown value
  // is the vendor's own unsupported_response_type, not "unmodelled".
  if (responseType !== 'code') return respond('unsupported_response_type', `Unsupported response_type: ${responseType}.`);

  const scopes = parseScopeParam(query.get('scope'));
  if (scopes.length === 0) return respond('invalid_request', 'Missing required parameter: scope.');

  // `state` is REQUIRED by X: both official SDKs' authorize-URL builders make it non-optional (twitter-api-typescript-sdk
  // GenerateAuthUrlOptions; xdk oauth2_auth) and the docs describe it as the CSRF check with a 500-character ceiling.
  if (state === null) return respond('invalid_request', 'Missing required parameter: state.');
  if (state.length > 500) return respond('invalid_request', 'The state parameter must be at most 500 characters.');

  // PKCE is REQUIRED on X's OAuth 2.0 — the docs' parameter tables list code_challenge, and the LEGACY official SDK
  // always sends one. (The current xdk sends it only after setPkceParameters — the docs table, not the SDKs, is the
  // load-bearing evidence; §9 round two.)
  const codeChallenge = query.get('code_challenge');
  if (!codeChallenge) return respond('invalid_request', 'Missing required parameter: code_challenge.');
  const rawMethod = query.get('code_challenge_method');
  // Method omitted ⇒ `plain` (RFC 7636 §4.3 default — EXTRAPOLATION for X, whose docs always show the parameter; pinned
  // by `x.authorize.challenge_method_default`, todo).
  const method = rawMethod === null ? 'plain' : normalizeChallengeMethod(rawMethod);
  if (method === null) return respond('invalid_request', `Invalid code_challenge_method: ${rawMethod}. Expected S256 or plain.`);

  if (env.readOnly) return oauthError('temporarily_unavailable', 'this twin was started read-only; omit readOnly to accept writes', 405);

  const account = signedInAccount(ctx);
  // nobody signed in at x.com: the person signs in first and comes back to this screen
  if (!account) return toSignIn(ctx, env);

  // 4. Record the request, then render the screen. The auth_request row is what the Authorize/Cancel post resolves —
  //    the browser never carries the parameters back, so they cannot be tampered with between the two legs. The screen
  //    is bound to the account it shows, so a later session switch cannot make it mint for another.
  // The challenge itself is bookkeeping (`_code_challenge`, by the request's handle): with `plain` it is the verifier.
  const fields = { clientId, redirectUri, scope: formatScopeParam(scopes), state, codeChallengeSha256: sha256(codeChallenge), codeChallengeMethod: method, accountId: account.id, settled: false };
  // The handle is SERVED (it is the authorize form's own hidden field), so R9 governs it: minted from the world instant +
  // the rows already held, never from entropy, and an identical authorize at the same instant reuses the pending row.
  // Only an unsettled row is reused, and the write keeps it unsettled (no move of `settled`). The decision reads the rows
  // as they stand when it runs; a second request decided before this one's write lands is not excluded.
  const requestId = await decide<string>(ctx, (current) => {
    const prior = current('auth_request') as Row[];
    const id = authRequestIdFor(prior, ctx.occurredAt, fields);
    return { value: id, write: { resource: 'auth_request', id, fields: { ...fields, rev: nextRevIn(prior, 'auth_request', id) }, operation: 'auth_request.create' } };
  });
  await ctx.record(CODE_CHALLENGE, { codeChallenge }, requestId);
  return renderConsent(ctx, env, requestId);
}

/** The screen for a recorded authorization request, or the error page for one unknown or settled: the App asking, the
 *  account consenting, what the scopes let it view and do, and where Authorize sends the person. It never invents an
 *  app name, an account or a scope row. */
export function renderConsent(ctx: HandlerContext, env: ScreenEnv, requestId: string): XResponse {
  const request = ctx.row('auth_request', requestId);
  const client = request && request.settled !== true ? ctx.row('oauth_client', String(request.clientId)) : undefined;
  const account = client ? ctx.row('account', String(request!.accountId ?? '')) : undefined;
  if (!request || !client || !account) return errorPage(env, { status: 400, code: 'invalid_request', detail: 'Unknown or expired authorization request.' });
  const app = String(client.name ?? '');
  const heading: Record<string, string> = { view: `Things ${app} can view`, do: `Things ${app} can do`, session: 'Until you revoke access' };
  let redirectHost = String(request.redirectUri);
  try { redirectHost = new URL(String(request.redirectUri)).host; } catch { /* shown as registered */ }
  return consentPage(env, {
    app,
    account,
    permissions: describeScopes(sortScopesForConsent(parseScopeParam(String(request.scope ?? '')))).map((s) => ({ title: s.label, detail: heading[s.group] ?? '' })),
    fields: { auth_request: requestId },
    action: `${env.origin ?? AUTHORIZE_ORIGIN}${AUTHORIZE_PATH}`,
    redirectHost,
  });
}

/** X's authorize page for an App, the account it consents as and the permissions it lists (both screens'). */
export function consentPage(_env: ScreenEnv, v: { app: string; account: Record<string, unknown>; permissions: Array<{ title: string; detail: string }>; fields: Record<string, string>; action: string; redirectHost: string }): XResponse {
  const who = String(v.account.name || v.account.username || v.account.id);
  const handle = v.account.username ? ` (@${String(v.account.username)})` : '';
  return pageAnswer(flowPage({
    title: `Authorize ${v.app} to access your account? / X`,
    css: [CONSENT_CSS],
    headers: NOSTORE,
    body: (
      <Consent
        heading={`${v.app} wants to access your X account`}
        app={{ name: v.app }}
        request={`Signed in as ${who}${handle}`}
        permissions={v.permissions}
        action={v.action}
        fields={v.fields}
        deny={{ name: 'decision', value: 'deny', label: 'Cancel' }}
        allow={{ name: 'decision', value: 'allow', label: 'Authorize app' }}
        note={`${v.redirectHost ? `You'll be redirected to ${v.redirectHost}. ` : ''}You can revoke access to any app at any time from the Apps and sessions section of your X settings.`}
      />
    ),
  }), 200);
}

/**
 * The person's decision: Authorize app or Cancel, posted by the screen's form. SETTLING is the claim: the request's
 * `settled` move (asked of the machine) in the one decision that checks it, so a decision cannot be replayed. Allow →
 * the (client, user) grant and a single-use code (kept by its SHA-256), and the callback with `state` and `code`;
 * Cancel → the callback with `error=access_denied`.
 */
export async function consentDecision(ctx: HandlerContext, form: URLSearchParams): Promise<XResponse> {
  const requestId = form.get('auth_request') ?? '';
  const allow = form.get('decision') === 'allow';
  const code = mintAuthorizationCode(rowsFor(ctx), Date.parse(ctx.occurredAt), requestId, await credentialSalt(ctx));
  const settled = await decide<{ refused: XResponse } | { request: Row; account?: Row }>(ctx, (rows) => {
    const request = (rows('auth_request') as Row[]).find((r) => r.id === requestId);
    if (!request || request.settled === true) return { value: { refused: invalidConsentRequest() } };
    // Bind consent to the account displayed when this request was created. A concurrent session switch cannot make the
    // screen name one account while minting credentials for another.
    const account = allow ? (rows('account') as Row[]).find((r) => r.id === request.accountId) : undefined;
    if (allow && !account) return { value: { refused: oauthError('invalid_request', 'The account shown for this authorization request no longer exists.', 400) } };
    const refusal = ctx.legal('auth_request', 'settled', 'consent', request.settled, 'true', requestId, 'external');
    if (refusal) return { value: { refused: oauthError('invalid_request', refusal.message, refusal.status) } };
    return {
      value: { request, ...(account ? { account } : {}) },
      write: { resource: 'auth_request', id: requestId, fields: { settled: true, rev: nextRevIn(rows('auth_request') as Row[], 'auth_request', requestId) }, operation: 'auth_request.settle' },
    };
  });
  if ('refused' in settled) return settled.refused;
  const { request, account } = settled;
  const redirectUri = String(request.redirectUri);
  const state = String(request.state ?? '');
  if (!allow || !account) return redirectError(redirectUri, 'access_denied', state);
  const scopes = parseScopeParam(String(request.scope));
  const grantId = `${request.clientId}:${account.id}`;
  await putRev(ctx, '_grant', grantId, { clientId: request.clientId, sub: account.id, scopes }, 'grant.consent');
  await put(ctx, CREDENTIAL.code.type, sha256(code), {
    clientId: request.clientId,
    sub: account.id,
    scope: formatScopeParam(scopes),
    redirectUri,
    // the challenge the request was made with: its bookkeeping row
    codeChallenge: ctx.row(CODE_CHALLENGE, requestId)?.codeChallenge,
    codeChallengeMethod: request.codeChallengeMethod,
    consumed: false,
    expiresAt: nowSeconds(ctx) + AUTH_CODE_TTL_SECONDS,
    rev: 1,
  }, 'authorization_code.issue');
  return redirectSuccess(redirectUri, code, state);
}

// ── OAuth 1.0a ─────────────────────────────────────────────────────────────────────────────────

const REQUEST_TOKEN = CREDENTIAL.requestToken.type;

/** The page X shows for a request token it does not hold. The "Whoa there!" wording is X's classic page as widely
 *  reported; status and DOM are EXTRAPOLATION (`x.oauth1.invalid_token_page`). */
function invalidRequestTokenPage(env: ScreenEnv): XResponse {
  return errorPage(env, { status: 400, code: 'invalid_request_token', detail: 'Whoa there! The request token for this page is invalid. It may have already been used, or expired because it is too old. Please go back to the site or application that sent you here and try again; it was probably just a mistake.' });
}

/** What an OAuth 1.0a token lets an App do, as X's authorize screen lists it. OAuth 1.0a has no scopes: the App's
 *  permission level (Read / Read and write) decides the grant (docs.x.com developer-apps, "App permissions (OAuth
 *  1.0a)"). The lines follow X's OAuth 1.0a authorize page as widely screenshotted; the live wording was not captured
 *  (`x.oauth1.consent_wording`, todo). */
const OAUTH1_CONSENT_ROWS: Record<'read' | 'write', string[]> = {
  read: [
    'Posts from your timeline (including protected Posts) as well as your Lists and collections.',
    'Your X profile information and account settings.',
    'Accounts you follow, mute, and block.',
  ],
  write: [
    'Follow and unfollow accounts for you.',
    'Update your profile and account settings for you.',
    'Post and delete Posts for you, and engage with Posts posted by others (Like, un-Like, or reply to a Post, Repost, etc.) for you.',
    'Create, manage, and delete Lists and collections for you.',
    'Mute, block, and report accounts for you.',
  ],
};

function withParams(callback: string, params: Record<string, string>): string {
  const url = new URL(callback);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** GET oauth/authorize | oauth/authenticate. */
export async function oauth1Screen(ctx: HandlerContext, env: ScreenEnv, mode: 'authorize' | 'authenticate', query: URLSearchParams): Promise<XResponse> {
  const token = query.get('oauth_token') ?? '';
  const rows = rowsFor(ctx);
  const row = credentialRow(rows, 'requestToken', token)?.row;
  if (!row || (row.state !== 'issued' && row.state !== 'pending')) return invalidRequestTokenPage(env);
  const app = oauth1AppOf([...rows('oauth1_app')], String(row.consumerKey));
  if (!app) return invalidRequestTokenPage(env);
  if (env.readOnly) return oauthError('temporarily_unavailable', 'this twin was started read-only; omit readOnly to accept writes', 405);
  const account = signedInAccount(ctx);
  if (!account) return toSignIn(ctx, env);
  // Sign in with X: skipped for an App the person already approved, unless force_login=true. A grant at a narrower
  // level than this request asks for is not that permission. X does this only for an App with the "Use Sign in with X"
  // setting enabled; the twin treats every App as having it (EXTRAPOLATION — `x.oauth1.sign_in_with_x_setting`).
  const grant = rows('_oauth1_grant').find((r) => r.id === `${app.consumerKey}:${account.id}`);
  const covered = grant && grant.revoked !== true && (grant.accessLevel === 'read-write' || row.accessLevel === 'read');
  if (mode === 'authenticate' && covered && query.get('force_login') !== 'true') {
    return oauth1Decision(ctx, env, token, 'allow', String(account.id));
  }
  // Bind the screen to the account it shows, so a later session switch cannot mint for another.
  const presented = await decide<boolean>(ctx, (current) => {
    const held = credentialRow(current as never, 'requestToken', token);
    // decided (or exchanged) since the read above, as the rows stand now: not reopened
    if (!held || (held.row.state !== 'issued' && held.row.state !== 'pending')) return { value: false };
    if (ctx.legal(REQUEST_TOKEN, 'state', 'screen', held.row.state, 'pending', held.key, 'external')) return { value: false };
    return {
      value: true,
      write: { resource: REQUEST_TOKEN, id: held.key, fields: { ...credentialFields(held.row), state: 'pending', accountId: account.id, rev: nextRevIn(current(REQUEST_TOKEN) as Row[], REQUEST_TOKEN, held.key) }, operation: 'oauth1_request_token.present' },
    };
  });
  if (!presented) return invalidRequestTokenPage(env);
  const level = row.accessLevel === 'read' ? 'read' : 'write';
  let redirectHost = '';
  if (row.callback !== 'oob') {
    try { redirectHost = new URL(String(row.callback)).host; } catch { redirectHost = String(row.callback); }
  }
  return consentPage(env, {
    app: app.name,
    account,
    permissions: [
      ...OAUTH1_CONSENT_ROWS.read.map((title) => ({ title, detail: `Things ${app.name} can view` })),
      ...(level === 'write' ? OAUTH1_CONSENT_ROWS.write.map((title) => ({ title, detail: `Things ${app.name} can do` })) : []),
    ],
    fields: { auth_request: token },
    action: `${env.origin ?? 'https://api.x.com'}/oauth/authorize`,
    redirectHost,
  });
}

/**
 * The decision (POST oauth/authorize, or an authenticate that skips the screen with `accountId`). Allow → the callback
 * with `oauth_token` and `oauth_verifier` (obtaining-user-access-tokens), or for `oob` the PIN page; Cancel → the
 * callback with `denied=<request token>` (the flowchart on the same page; the parameter name is the widely reported
 * one — EXTRAPOLATION, `x.oauth1.denied_callback`).
 */
export async function oauth1Decision(ctx: HandlerContext, env: ScreenEnv, token: string, decision: string, accountId?: string): Promise<XResponse> {
  const salt = await credentialSalt(ctx);
  const at = ctx.occurredAt;
  type Decided = { page?: 'invalid'; denied?: string; allowed?: string; verifier?: string; appName?: string; grant?: { id: string; fields: Record<string, unknown> } };
  const decided = await decide<Decided>(ctx, (current) => {
    const rows = current as never as Rows;
    const held = credentialRow(rows, 'requestToken', token);
    const row = held?.row;
    const who = accountId ?? (row ? String(row.accountId ?? '') : '');
    if (!held || !row || (accountId ? row.state !== 'issued' && row.state !== 'pending' : row.state !== 'pending') || !who) return { value: { page: 'invalid' } };
    const app = oauth1AppOf([...rows('oauth1_app')], String(row.consumerKey));
    const rev = nextRevIn(rows(REQUEST_TOKEN) as Row[], REQUEST_TOKEN, held.key);
    // an App gone since the screen was shown: the token names nobody X would redirect for
    if (!app) return { value: { page: 'invalid' } };
    if (decision !== 'allow') {
      if (ctx.legal(REQUEST_TOKEN, 'state', 'screen', row.state, 'denied', held.key, 'external')) return { value: { page: 'invalid' } };
      return { value: { denied: String(row.callback) }, write: { resource: REQUEST_TOKEN, id: held.key, fields: { ...credentialFields(row), state: 'denied', rev }, operation: 'oauth1_request_token.deny' } };
    }
    if (ctx.legal(REQUEST_TOKEN, 'state', 'screen', row.state, 'authorized', held.key, 'external')) return { value: { page: 'invalid' } };
    const verified = credentialRows(rows, 'requestToken').filter((c) => typeof c.row.verifier === 'string').length;
    // The web flow's verifier is an opaque string (obtaining-user-access-tokens' example: 42 alphanumerics; the twin
    // mints 32). The separate out-of-band PIN flow is unserved.
    const verifier = alnum(`${salt}:oauth1_verifier:${at}:${verified}:${token}`, 32);
    const grantId = `${app.consumerKey}:${who}`;
    // A narrower approval does not take back a wider one the person already gave this App.
    const prior = (rows('_oauth1_grant') as Row[]).find((r) => r.id === grantId);
    const level = prior && prior.revoked !== true && prior.accessLevel === 'read-write' ? 'read-write' : row.accessLevel;
    return {
      value: { allowed: String(row.callback), verifier, appName: app.name, grant: { id: grantId, fields: { consumerKey: app.consumerKey, userId: who, accessLevel: level, revoked: false } } },
      write: { resource: REQUEST_TOKEN, id: held.key, fields: { ...credentialFields(row), state: 'authorized', verifier, accountId: who, rev }, operation: 'oauth1_request_token.authorize' },
    };
  });
  if (decided.page === 'invalid') return invalidRequestTokenPage(env);
  if (decided.denied !== undefined) {
    return { status: 302, body: '', headers: { location: withParams(decided.denied, { denied: token }), ...NOSTORE } };
  }
  // the (App, user) approval that lets Sign in with X skip the screen next time
  if (decided.grant) await putRev(ctx, '_oauth1_grant', decided.grant.id, decided.grant.fields, 'oauth1_grant.approve');
  return { status: 302, body: '', headers: { location: withParams(decided.allowed!, { oauth_token: token, oauth_verifier: decided.verifier! }), ...NOSTORE } };
}

// ── x.com's pages: the shell, the skin and the pieces every page of x.com draws (./web.ts, ./home.tsx, ./login.tsx) ──

export const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The host a request was made to: the World's proxy keeps it in Host, or names it when it rewrote Host. */
export function namedHost(request: Request): string {
  const named = request.headers.get('x-volter-twin-original-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  return named.replace(/:\d+$/, '').toLowerCase();
}

// ── where a page was reached ──
// Reached at a World's place (a served or hosted World's /<org>/<world>/x/…, its content plane), a page of x.com is
// written onto the twin's own base, by path: its links, moves and forms stay on the origin that served it, and its media
// on X's content hosts are named `<base>/@<host>/…`, which the kernel answers as routed from that host (twin-world's
// architecture, "A page at a World's place"). A place whose prefix is `/` has an empty base path, and is a place still.

/** The kernel's mount of a declared screen, the frame a World's board shows it in: `<place>/_screen/<host>`. */
const SCREEN_MOUNT = /\/_screen\/[A-Za-z0-9.-]+$/;

/** The twin's base path at a World's place ('' for a prefix of `/`), or undefined on X's own host. */
export function placeOf(ctx: HandlerContext): string | undefined {
  // the prefix the kernel takes for the twin's base (twinPublicBase): a path of URL-safe characters, else no place. A
  // browser's request for one of X's own hosts that the injector's proxy forwarded to a hosted World carries the prefix
  // too, with the host it was made to named: that browser is on x.com, not at the World's place. The board's frame of a
  // declared screen (`<place>/_screen/<host>`) names the host too, as the World keeps a screen's hostname for routing,
  // and is a place: its media and links are on that mount, never on x.com's own hosts out on the internet
  const prefix = ctx.call.request.headers.get('x-forwarded-prefix');
  if (!prefix || !/^\/[A-Za-z0-9._~\/-]*$/.test(prefix) || (xHostOf(ctx.call.request) && !SCREEN_MOUNT.test(prefix))) return undefined;
  return new URL(ctx.publicBase).pathname.replace(/\/+$/, '');
}

/** A location on x.com, or the same on the twin's base where the page was reached at a World's place. */
export function onBase(location: string, placed: string | undefined): string {
  return placed === undefined ? location : location.replace(/^https:\/\/x\.com(?=\/|$)/, placed) || '/';
}

/** A page's HTML for a World's place: its root-relative links and forms on the twin's base, and its media on X's
 *  content hosts at `<base>/@<host>/…`. */
export function placedHtml(html: string, placed: string | undefined, request?: Request): string {
  // Rewrite just the origin before placement: the rest of each escaped URL (its query and fragment too) stays intact.
  const media = request ? html.replace(/(src|data-src|poster)="https:\/\/((?:pbs|video|abs)\.twimg\.com)\//g,
    (_match, attr: string, host: string) => `${attr}="${esc(twinVendorUrl(request, `https://${host}/`))}`) : html;
  return placed === undefined ? media : onPlace(media, placed);
}

/** The page's links and forms on the twin's base, its media at `<base>/@<host>/…`. */
function onPlace(html: string, placed: string): string {
  return html
    .replace(/(href|action)="\/(?!\/)/g, `$1="${placed}/`)
    .replace(/(src|data-src|poster)="https:\/\/((?:pbs|video|abs)\.twimg\.com)\//g, `$1="${placed}/@$2/`);
}

/** A page of x.com answered: its HTML placed, with its status and headers. */
export function htmlPage(html: string, placed: string | undefined, status = 200, headers: Record<string, string> = {}, request?: Request): Response {
  return new Response(placedHtml(html, placed, request), { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

/** A move to a path of x.com, on the twin's base at a World's place. */
export function moveTo(path: string, placed: string | undefined, status = 302, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { location: `${placed ?? ''}${onePath(path)}`, ...headers } });
}

/** A path of this site as one path: its dot segments resolved and its leading slashes one, so it can neither name
 *  another site (`//host/…`) nor climb out of the twin's base at a World's place (`/../…`). */
export function onePath(path: string): string {
  const url = new URL(path, 'https://x.com');
  return `/${url.pathname.replace(/^\/+/, '')}${url.search}${url.hash}`;
}

// ── who is signed in ──
// A person on x.com is who signed in there (twin-world's architecture, "Who is on a screen"): the sign-in page
// (./login.tsx) checks the password the World gave their account (POST /_twin/accounts `password`, the kernel's person
// with the account's id beside it) and X's session cookie, `auth_token`, names them to every page after.

export const SESSION_COOKIE = 'auth_token';

/** The X account the request's session names, or undefined when nobody is signed in. */
export function signedInAccount(ctx: HandlerContext): Row | undefined {
  const person = signedIn(ctx, SESSION_COOKIE);
  const id = person && typeof person.account_id === 'string' ? person.account_id : undefined;
  return id ? ctx.rowsRaw('account').find((a) => a.id === id && a.deleted !== true) as Row | undefined : undefined;
}

// ── an operation, made by the person on the page ──
// x.com's own client makes every write through X's API: the composer uploads its media in chunks and posts through
// POST /2/tweets. A page here does the same, calling the operation's handler with the call the client would send (the
// operation's own path, query and JSON body), as the account the person signed in to, with the operation's scopes:
// X's own client acts with the whole of the account's authority.

type SurfaceOperation = { id: string; method: string; path: string; scopes?: string[] };

/** The context an operation's handler is called with when the person on a page makes it. */
export function asOperation(ctx: HandlerContext, operationId: string, accountId: string, call: { params?: Record<string, string>; query?: Record<string, string>; body?: Record<string, unknown> } = {}): HandlerContext {
  const operation = (surface as unknown as { operations: SurfaceOperation[] }).operations.find((o) => o.id === operationId);
  if (!operation) throw new Error(`x: the surface has no operation ${operationId}`);
  const params = call.params ?? {};
  const url = new URL(`https://api.x.com${operation.path.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(params[name] ?? ''))}`);
  for (const [name, value] of Object.entries(call.query ?? {})) url.searchParams.set(name, value);
  // X's own client: first party, never a self-serve App
  const headers = new Headers({ [CALLER_HEADER]: JSON.stringify({ accountId, scopes: operation.scopes ?? [], firstParty: true }) });
  if (isReadOnlyRequest(ctx.call.request)) headers.set(READ_ONLY_REQUEST_HEADER, '1');
  const text = call.body ? JSON.stringify(call.body) : '';
  if (call.body) headers.set('content-type', 'application/json');
  const request = new Request(url, { method: operation.method.toUpperCase(), headers, ...(call.body ? { body: text } : {}) });
  return { ...ctx, call: { ...ctx.call, request, operation: operation as never, params }, params: { ...params, ...(call.query ?? {}) }, id: Object.values(params).at(-1), body: call.body, text };
}

/** What an operation's refusal says, in X's words (a problem's detail, or its first error's message). */
export function refusalText(body: unknown): string {
  const b = (body ?? {}) as { detail?: unknown; errors?: Array<{ message?: unknown; detail?: unknown }> };
  const first = Array.isArray(b.errors) ? b.errors[0] : undefined;
  return String(first?.message ?? first?.detail ?? b.detail ?? 'Something went wrong. Try again.');
}

// ── the pieces ─────────────────────────────────────────────────────────────────────────────────────

export const X_LOGO_SVG = '<svg viewBox="0 0 24 24" width="30" height="30" aria-label="X"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
export const VERIFIED_SVG = '<svg class="badge" viewBox="0 0 24 24" width="18" height="18" aria-label="Verified account"><path fill="currentColor" d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/></svg>';
export const ICON = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

export function header(title: string, back: boolean, sub = ''): string {
  return `<div class="col-header">${back ? '<button type="button" class="back" onclick="history.back()" aria-label="Back" data-testid="app-bar-back">←</button>' : ''}<div><div class="col-title">${esc(title)}</div>${sub ? `<div class="muted col-sub">${esc(sub)}</div>` : ''}</div></div>`;
}

/** X's default avatar as x.com draws it for an account without a photo — the image at
 *  `X_DEFAULT_PROFILE_IMAGE_URL`, redrawn inline so the page needs no second fetch (the twin also serves
 *  that URL as a PNG on abs.twimg.com, ../x-default-avatar.ts): a #657786
 *  head and shoulders on #ccd6dd (its colours and shape read off that PNG, 2026-09-28: the palette's
 *  background entry and the silhouette's pixels, head 124–276 × 88–256 and a shoulder circle centred
 *  at 200,409 radius 131 in its 400×400 rendition). */
export const DEFAULT_AVATAR_SVG = '<svg viewBox="0 0 400 400" width="100%" height="100%" aria-hidden="true"><rect width="400" height="400" fill="#ccd6dd"/>'
  + '<path fill="#657786" d="M200 88C240 88 276 120 276 176C276 234 240 256 200 256C160 256 124 234 124 176C124 120 160 88 200 88Z"/>'
  + '<circle cx="200" cy="409" r="131" fill="#657786"/></svg>';

/** An account's picture: X's default avatar when it has none (its `profile_image_url` is the default,
 *  as the API answers it). A photo the account set is not drawn: the twin serves no profile photos
 *  (x.web.profile_photo, todo), so it keeps the initial on its hue. */
export function avatar(user: XRow | undefined, size: number): string {
  return user?.profile_image_url === X_DEFAULT_PROFILE_IMAGE_URL
    ? `<div class="avatar avatar-default" style="width:${size}px;height:${size}px" data-src="${esc(X_DEFAULT_PROFILE_IMAGE_URL)}" aria-hidden="true">${DEFAULT_AVATAR_SVG}</div>` : placeholderAvatar(user, size);
}

export function nameLine(user: XRow | undefined, tail: string): string {
  return `<div class="name-line"><a class="display-name" href="/${esc(user?.username ?? 'i')}">${esc(user?.name ?? 'Unknown')}</a>${user?.verified === true ? VERIFIED_SVG : ''}<span class="muted handle">@${esc(user?.username ?? 'unknown')}</span>${tail}</div>`;
}

export function postText(text: unknown, big: boolean): string {
  const parts = textSegments(text).map((s) => {
    return s.kind === 'text' ? esc(s.value) : entityText(s);
  });
  return `<div class="${big ? 'post-text post-text-big' : 'post-text'}">${parts.join('')}</div>`;
}

export function mediaBlock(media: XRow[], big: boolean): string {
  return media.length === 0 ? '' : nonemptyMediaBlock(media, big);
}

export function quoteCard(quoted: XRow, users: Map<string, XRow>, nowMs: number): string {
  const author = users.get(String(quoted.author_id));
  return `<a class="quote" href="/${esc(author?.username ?? 'i')}/status/${esc(quoted.id)}"><div class="quote-head">${avatar(author, 20)}${nameLine(author, `<span class="muted">·</span><span class="muted">${esc(relativeTime(quoted.created_at, nowMs, 'UTC'))}</span>`)}</div>${postText(quoted.text, false)}</a>`;
}

/** The engagement row, x.com's controls under a post by its own names (`reply`, `retweet`, `like`, `bookmark`): Reply
 *  opens the reply composer on the post's page; Repost, Like and Bookmark post the page's form, which makes the API's
 *  operation as the person signed in (`engage`). The twin models no public_metrics, so the row carries no counts, never
 *  an invented zero. A row with no post (a post nobody can act on from here) is drawn as icons alone. */
export function actions(big: boolean, on?: { id: string; handle: string }): string {
  const icons = ['M7.9 20A9 9 0 1 0 4 16.1L2 22Z', 'M2 9l3-3 3 3M13 18H7a2 2 0 0 1-2-2V6M22 15l-3 3-3-3M11 6h6a2 2 0 0 1 2 2v10', 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z', 'M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12'];
  if (!on) return `<div class="${big ? 'actions actions-big' : 'actions'}">${icons.map((d) => `<span class="action">${ICON(d)}</span>`).join('')}</div>`;
  const page = `/${esc(on.handle)}/status/${esc(on.id)}`;
  const button = (intent: string, label: string, icon: string): string => `<button type="submit" class="action" name="intent" value="${intent}" data-testid="${intent}" aria-label="${label}">${ICON(icon)}</button>`;
  return `<form method="post" action="${page}" class="${big ? 'actions actions-big' : 'actions'}">`
    + `<a class="action" href="${page}?compose=reply" data-testid="reply" aria-label="Reply">${ICON(icons[0]!)}</a>`
    + button('retweet', 'Repost', icons[1]!) + button('like', 'Like', icons[2]!) + button('bookmark', 'Bookmark', icons[3]!)
    + `<span class="action">${ICON(icons[4]!)}</span></form>`;
}

/** What a press on a post or a profile does (x.com's Repost, Like, Bookmark and Follow): the API's operation, made as the
 *  person signed in. An operation this pack serves is its handler's; one it does not is the gap, answered as X answers
 *  a request nothing models (the manifest's `gap`), so the page shows that answer and never a press that did nothing. */
export const ENGAGE: Record<string, string> = { retweet: 'repostPost', like: 'likePost', bookmark: 'createUsersBookmark', follow: 'followUser' };
export async function engage(ctx: HandlerContext, handlers: Record<string, (c: HandlerContext) => Promise<Response>>, intent: string, person: XRow, body: Record<string, unknown>): Promise<string> {
  const operation = ENGAGE[intent]!;
  const handler = handlers[operation];
  const answer = handler ? await handler(asOperation(ctx, operation, String(person.id), { params: { id: String(person.id) }, body })) : ctx.gap();
  if (answer.status < 300) return '';
  return refusalText(await answer.json().catch(() => ({})));
}

/** A link's card under a post's text (../semantics/shared.ts, a link's card): the linked page's domain, title and
 *  description. Its image is not drawn: X shows a card's image from its own host (pbs.twimg.com/card_img/…, re-hosted
 *  when the link is crawled), and a page here that loaded the image from the linked site would send the reader's browser
 *  to a third party X never sends it to. Where the twin stops: card images are not re-hosted, so a card is drawn as
 *  text, whatever `twitter:card` the page names. */
export function cardBlock(card: LinkCard | undefined): string {
  if (!card) return '';
  const href = `href="${esc(card.url)}" target="_blank" rel="noopener noreferrer nofollow"`;
  return `<div class="card-wrap" data-testid="card.wrapper"><a class="card card-small" ${href}><div class="card-text"><div class="muted">${esc(card.domain)}</div><div>${esc(card.title)}</div>${card.description ? `<div class="muted card-desc">${esc(card.description)}</div>` : ''}</div></a></div>`;
}

export function postRow(post: XRow, users: Map<string, XRow>, tweets: Map<string, XRow>, media: Map<string, XRow>, nowMs: number, card?: LinkCard): string {
  const author = users.get(String(post.author_id));
  const quotedId = referencedId(post, 'quoted');
  const quoted = quotedId ? tweets.get(quotedId) : undefined;
  const href = `/${esc(author?.username ?? 'i')}/status/${esc(post.id)}`;
  return `<article class="post-row" data-post-id="${esc(post.id)}">${avatar(author, 40)}<div class="post-body">`
    + nameLine(author, `<span class="muted">·</span><a class="muted" href="${href}"><time datetime="${esc(post.created_at)}" title="${esc(fullTimestamp(post.created_at, 'UTC'))}">${esc(relativeTime(post.created_at, nowMs, 'UTC'))}</time></a>`)
    + (post.text ? postText(post.text, false) : '')
    + mediaBlock(postMedia(post, media), false)
    + cardBlock(card)
    + (quoted ? quoteCard(quoted, users, nowMs) : '')
    + actions(false, author?.username ? { id: String(post.id), handle: String(author.username) } : undefined)
    + '</div></article>';
}

/** Posts as a timeline draws them, each with its link's card. */
export function timeline(read: { posts: Record<string, unknown>[]; includes: Record<string, unknown> }, cardFor: (post: XRow) => LinkCard | undefined, nowMs: number, users: Map<string, XRow> = usersById(read.includes)): string {
  const tweets = tweetsById(read.includes);
  const media = mediaByKey(read.includes);
  return `<div class="timeline">${read.posts.map((p) => postRow(p as XRow, users, tweets, media, nowMs, cardFor(p as XRow))).join('')}</div>`;
}

/** A page of x.com: the side navigation (for a signed-in person, Home, Profile and their account; for a visitor, X's
 *  mark alone), the column and the rail. */
export function shell(title: string, column: string, person?: XRow): string {
  const nav = person
    ? `<a class="nav-logo" href="/home" aria-label="X">${X_LOGO_SVG}</a><nav class="nav-links" aria-label="Primary"><a class="nav-link" href="/home" data-testid="AppTabBar_Home_Link">Home</a><a class="nav-link" href="/${esc(person.username)}" data-testid="AppTabBar_Profile_Link">Profile</a><a class="nav-post" href="/home#composer" data-testid="SideNav_NewTweet_Button">Post</a></nav><div class="nav-account" data-testid="SideNav_AccountSwitcher_Button">${avatar(person, 40)}<div><div class="display-name">${esc(person.name)}</div><div class="muted">@${esc(person.username)}</div></div></div>`
    : `<a class="nav-logo" href="/home" aria-label="X">${X_LOGO_SVG}</a>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLES}</style></head>
<body><div class="layout"><header class="sidenav">${nav}</header><main class="column">${column}</main><aside class="rail"></aside></div></body></html>`;
}

// x.com's own look ("Lights out"), as the mirror's stylesheet draws it; exempt from the Volter brand.
export const STYLES = `
:root{--bg:#000;--text:#e7e9ea;--muted:#71767b;--line:#2f3336;--blue:#1d9bf0;--banner:#333639}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font-family:"TwitterChirp",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:20px}
a{color:inherit;text-decoration:none}
.muted{color:var(--muted)}.entity{color:var(--blue)}a.entity:hover{text-decoration:underline}
.layout{display:grid;grid-template-columns:1fr minmax(0,600px) 1fr;min-height:100vh}
.sidenav{justify-self:end;padding:4px 12px}.nav-logo{display:flex;align-items:center;justify-content:center;width:52px;height:52px}
.column{border-left:1px solid var(--line);border-right:1px solid var(--line);min-height:100vh;min-width:0}
.col-header{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:24px;min-height:53px;padding:0 16px;background:rgba(0,0,0,.65);backdrop-filter:blur(12px)}
.col-title{font-size:20px;line-height:24px;font-weight:700}.col-sub{font-size:13px;line-height:16px}.back{font-size:20px;border:0;background:none;color:inherit;cursor:pointer;padding:0}
.avatar{flex:none;border-radius:9999px;overflow:hidden;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700}
.name-line{display:flex;align-items:center;gap:4px;min-width:0;white-space:nowrap}.display-name{font-weight:700;overflow:hidden;text-overflow:ellipsis}.badge{color:var(--blue);flex:none}
.post-row{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line)}.post-body{flex:1;min-width:0}
.post-text{white-space:pre-wrap;overflow-wrap:anywhere}.post-text-big{font-size:17px;line-height:24px;margin-top:12px}
.post-detail{padding:12px 16px 0;border-bottom:1px solid var(--line)}.detail-head{display:flex;gap:8px;align-items:center}.detail-names .name-line{flex-direction:row}
.detail-time{padding:16px 0;border-bottom:1px solid var(--line)}.detail-time a:hover{text-decoration:underline}
.replying{margin-top:4px}
.media{margin-top:12px;border:1px solid var(--line);border-radius:16px;overflow:hidden;position:relative;display:grid;gap:2px}
.media-2,.media-3,.media-4{grid-template-columns:1fr 1fr}.media-img{width:100%;display:block;object-fit:cover;max-height:510px}.media-video{width:100%;display:block;background:#000}
.media-badge{position:absolute;left:12px;bottom:12px;background:rgba(0,0,0,.77);border-radius:4px;padding:0 4px;font-size:13px}
.quote{display:block;margin-top:12px;border:1px solid var(--line);border-radius:16px;padding:12px}.quote-head{display:flex;gap:4px;align-items:center;margin-bottom:4px}
.actions{display:flex;justify-content:space-between;max-width:425px;margin-top:12px;color:var(--muted)}.actions-big{max-width:none;padding:4px 0 12px;margin-top:12px}.action{display:inline-flex;background:none;border:0;padding:0;color:inherit;cursor:pointer}
.banner{height:200px;background:var(--banner)}.profile-top{position:relative;height:72px;display:flex;justify-content:flex-end;align-items:flex-start;padding:12px 16px 0}.follow{padding:8px 16px;border-radius:9999px;border:0;background:var(--text);color:var(--bg);font:inherit;font-weight:700;cursor:pointer}.profile-avatar{position:absolute;left:16px;top:-72px;border:4px solid var(--bg);border-radius:9999px}
.profile-info{padding:4px 16px 16px}.profile-name{display:flex;align-items:center;gap:4px;font-size:20px;line-height:24px;font-weight:800}.profile-bio{margin-top:12px}
.profile-meta{display:flex;flex-wrap:wrap;column-gap:12px;row-gap:4px;margin-top:12px}
.tabs{display:flex;border-bottom:1px solid var(--line)}.tab{flex:1;text-align:center;padding:16px 0;color:var(--muted);font-weight:500}.tab.active{color:var(--text);font-weight:700;box-shadow:inset 0 -4px 0 var(--blue)}
.notice{padding:32px;max-width:400px;margin:0 auto}.notice-title{font-size:31px;line-height:36px;font-weight:800;margin-bottom:8px}
.sidenav{display:flex;flex-direction:column;gap:4px;min-width:72px}.nav-links{display:flex;flex-direction:column;gap:4px}
.nav-link{font-size:20px;line-height:24px;padding:12px;border-radius:9999px}.nav-link:hover{background:#181818}
.nav-post{display:block;margin-top:12px;padding:14px 32px;border-radius:9999px;background:var(--text);color:#0f1419;font-weight:700;font-size:17px;text-align:center}
.nav-account{display:flex;gap:12px;align-items:center;margin-top:24px;padding:12px;border-radius:9999px}
.home-tabs{position:sticky;top:0;z-index:2;display:flex;border-bottom:1px solid var(--line);background:rgba(0,0,0,.65);backdrop-filter:blur(12px)}
.composer{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line)}.composer-body{flex:1;min-width:0}
.composer textarea{width:100%;min-height:56px;background:none;border:0;color:var(--text);font:inherit;font-size:20px;line-height:24px;resize:vertical;outline:none;padding:12px 0}
.composer textarea::placeholder{color:var(--muted)}
.attachments{display:grid;gap:8px;grid-template-columns:1fr 1fr}.attachments-1{grid-template-columns:1fr}
.attachment{position:relative;border-radius:16px;overflow:hidden;border:1px solid var(--line)}.attachment img,.attachment video{display:block;width:100%;max-height:420px;object-fit:cover;background:#000}
.remove-media{position:absolute;top:4px;right:4px;width:32px;height:32px;border-radius:9999px;border:0;background:rgba(15,20,25,.75);color:#fff;font-size:18px;cursor:pointer}
.composer-bar{display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--line);margin-top:12px;padding-top:8px}
.media-button{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9999px;color:var(--blue);cursor:pointer}.media-button:hover{background:rgba(29,155,240,.1)}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.post-button{padding:8px 16px;border-radius:9999px;border:0;background:var(--text);color:#0f1419;font:inherit;font-weight:700;cursor:pointer}
.composer-error{margin-top:8px;color:#f4212e}
.char-count.over{color:#f4212e;margin-left:auto;margin-right:12px}
.toast{margin:12px 16px;padding:12px 16px;border-radius:4px;background:var(--blue);color:#fff;display:flex;justify-content:space-between}.toast a{font-weight:700;text-decoration:underline}
.card-wrap{margin-top:12px}.card{display:block;border:1px solid var(--line);border-radius:16px;overflow:hidden}
.card-small{display:flex}
.card-text{padding:12px;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0}.card-desc{overflow:hidden;text-overflow:ellipsis}
`;


// ── the pages' pure helpers ─────────────────────────────────────────────────────────────────────

export type XRow = Record<string, any>;

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export type Parts = { year: number; month: number; day: number; hour: number; minute: number };

/** A wall-clock reading of an instant in a time zone. x.com shows the VIEWER'S local time, so the
 *  browser passes none (its own zone); a verify passes 'UTC' so the output is a pure function. */
export function wallClock(ms: number, timeZone?: string): Parts {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...(timeZone ? { timeZone } : {}), year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month') - 1, day: get('day'), hour: get('hour') % 24, minute: get('minute') };
}

/** x.com's timeline timestamp: "now"/"42s", "5m", "3h" inside a day, "Sep 26" inside the year,
 *  "Sep 26, 2025" before it. `nowMs` is passed in, never read. */
export function relativeTime(iso: unknown, nowMs: number, timeZone?: string): string {
  if (typeof iso !== 'string') return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.floor((nowMs - t) / 1000));
  return s < 60 ? (s < 5 ? 'now' : `${s}s`) : olderRelativeTime(s, t, nowMs, timeZone);
}

/** The single-post page stamp in the viewer's zone. */
export function fullTimestamp(iso: unknown, timeZone?: string): string {
  if (typeof iso !== 'string') return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = wallClock(t, timeZone);
  const hour12 = d.hour % 12 === 0 ? 12 : d.hour % 12;
  return `${hour12}:${String(d.minute).padStart(2, '0')} ${d.hour < 12 ? 'AM' : 'PM'} · ${MONTHS[d.month]} ${d.day}, ${d.year}`;
}

/** The profile header's "Joined September 2026". */
export function joinedLabel(iso: unknown, timeZone?: string): string {
  if (typeof iso !== 'string') return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = wallClock(t, timeZone);
  return `Joined ${LONG_MONTHS[d.month]} ${d.year}`;
}


export type TextSegment = { kind: 'text' | 'mention' | 'hashtag' | 'url'; value: string };

/** A post's text split the way x.com colours it: @mentions, #hashtags and links are entities,
 *  everything else is plain text. Pure; the twin does not model `entities`, so the mirror reads
 *  them out of the text exactly as the twin's own mentions timeline does. */
export function textSegments(text: unknown): TextSegment[] {
  const source = typeof text === 'string' ? text : '';
  const out: TextSegment[] = [];
  // x.com links a bare domain too (`volter.ai/changelog`): a generic TLD always, a country code only with
  // `www.` or a path (so `install.sh` stays text); an @ inside a URL stays part of it. The TLDs are the
  // common ones, not X's full list.
  const re = /(https?:\/\/[^\s]+|\b(?:www\.)?(?:[A-Za-z0-9-]+\.)+(?:com|org|net|dev|app|xyz)\b(?:\/[^\s]*)?|\b(?:www\.(?:[A-Za-z0-9-]+\.)+(?:ai|io|co|sh|me|so|gg|tv)\b(?:\/[^\s]*)?|(?:[A-Za-z0-9-]+\.)+(?:ai|io|co|sh|me|so|gg|tv)\/[^\s]*))|(@[A-Za-z0-9_]{1,15})|(#[\p{L}\p{N}_]+)/gu;
  let last = 0;
  for (const m of source.matchAll(re)) last = appendTextEntity(m, source, out, last);
  if (last < source.length) out.push({ kind: 'text', value: source.slice(last) });
  return out;
}

/** A link's target: a bare domain is https. */
export function linkHref(url: string): string { return /^https?:\/\//i.test(url) ? url : `https://${url}`; }

/** The link text x.com shows for a URL: scheme stripped, long paths cut with an ellipsis. */
export function displayUrl(url: string): string {
  const bare = url.replace(/^https?:\/\/(www\.)?/, '');
  return bare.length > 30 ? `${bare.slice(0, 29)}…` : bare;
}

/** The avatar placeholder's colour, a pure function of the handle (the twin serves no image). */
export function avatarHue(handle: unknown): number {
  const s = String(handle ?? '').toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/** The placeholder's letter: the display name's first character, else the handle's. */
export function avatarInitial(user: XRow | undefined): string {
  const source = String(user?.name ?? user?.username ?? '?').trim();
  return (Array.from(source)[0] ?? '?').toUpperCase();
}

/** Users from a response's `includes`, by id. */
export function usersById(includes: unknown): Map<string, XRow> {
  const out = new Map<string, XRow>();
  const users = (includes as XRow | undefined)?.users;
  if (Array.isArray(users)) for (const u of users) out.set(String(u.id), u);
  return out;
}

/** Posts from a response's `includes`, by id (the quoted / replied-to posts). */
export function tweetsById(includes: unknown): Map<string, XRow> {
  const out = new Map<string, XRow>();
  const tweets = (includes as XRow | undefined)?.tweets;
  if (Array.isArray(tweets)) for (const t of tweets) out.set(String(t.id), t);
  return out;
}

/** The id a post references with the given type ('replied_to' | 'quoted'), if any. */
export function referencedId(post: XRow, type: 'replied_to' | 'quoted'): string | undefined {
  const refs = post.referenced_tweets;
  return Array.isArray(refs) ? referenceFromList(refs, type) : undefined;
}

/** Media from a response's `includes`, by media key. */
export function mediaByKey(includes: unknown): Map<string, XRow> {
  const out = new Map<string, XRow>();
  const media = (includes as XRow | undefined)?.media;
  if (Array.isArray(media)) for (const m of media) out.set(String(m.media_key), m);
  return out;
}

/** The media a post carries, in its own `attachments.media_keys` order, as the read expanded them. */
export function postMedia(post: XRow, media: Map<string, XRow>): XRow[] {
  const keys = post.attachments?.media_keys;
  return Array.isArray(keys) ? mediaFromKeys(keys, media) : [];
}

/** The playable file of a video: its MP4 variant with the highest bit rate. */
export function videoSource(media: XRow): string | undefined {
  const variants = Array.isArray(media.variants) ? (media.variants as XRow[]) : [];
  const mp4 = variants.filter((v) => v.content_type === 'video/mp4' && typeof v.url === 'string');
  mp4.sort((a, b) => Number(b.bit_rate ?? 0) - Number(a.bit_rate ?? 0));
  return mp4[0]?.url as string | undefined;
}

/** "0:03" — the duration badge x.com prints on a video. */
export function durationLabel(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}



export function placeholderAvatar(user: XRow | undefined, size: number): string {
  return `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px;background:hsl(${avatarHue(user?.username)} 45% 38%)" aria-hidden="true">${esc(avatarInitial(user))}</div>`;
}

export function entityText(s: TextSegment): string {
  return s.kind === 'url' ? `<a class="entity" href="${esc(linkHref(s.value))}" target="_blank" rel="noreferrer">${esc(displayUrl(s.value))}</a>` : namedEntity(s);
}

/** An @mention, linked to its profile, or a #hashtag. */
function namedEntity(s: TextSegment): string {
  if (s.kind === 'mention') return `<a class="entity" href="/${esc(s.value.slice(1))}">${esc(s.value)}</a>`;
  return `<span class="entity">${esc(s.value)}</span>`;
}

export function nonemptyMediaBlock(media: XRow[], big: boolean): string {
  const cls = big ? 'media media-big' : 'media';
  const video = media.find((m) => m.type === 'video');
  if (video) {
    const src = videoSource(video);
    const ratio = Number(video.width) > 0 && Number(video.height) > 0 ? `${video.width} / ${video.height}` : '16 / 9';
    const badge = durationLabel(video.duration_ms);
    // the frame shown before it plays: X's `preview_image_url`, on pbs.twimg.com as x.com's player names it
    const poster = typeof video.preview_image_url === 'string' ? ` poster="${esc(video.preview_image_url)}"` : '';
    return `<div class="${cls}" data-media-key="${esc(video.media_key)}">${src ? `<video class="media-video" style="aspect-ratio:${ratio}" src="${esc(src)}#t=0.001"${poster} controls playsinline preload="metadata"></video>` : ''}${badge ? `<span class="media-badge">${esc(badge)}</span>` : ''}</div>`;
  }
  const photos = media.filter((m) => m.type === 'photo' && typeof m.url === 'string').slice(0, 4);
  if (photos.length === 0) return '';
  return `<div class="${cls} media-${photos.length}">${photos.map((m) => {
    const ratio = photos.length === 1 && Number(m.width) > 0 && Number(m.height) > 0 ? ` style="aspect-ratio:${m.width} / ${m.height}"` : '';
    return `<img class="media-img" src="${esc(m.url)}" alt="Image"${ratio}>`;
  }).join('')}</div>`;
}

export function olderRelativeTime(s: number, t: number, nowMs: number, timeZone?: string): string {
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  const d = wallClock(t, timeZone);
  const day = `${MONTHS[d.month]} ${d.day}`;
  return d.year === wallClock(nowMs, timeZone).year ? day : `${day}, ${d.year}`;
}

export function appendTextEntity(m: RegExpMatchArray, source: string, out: TextSegment[], last: number): number {
  const at = m.index ?? 0;
  // an @ or # glued to a preceding word character is not an entity at X (e.g. an email address)
  if ((m[2] || m[3]) && at > 0 && /[A-Za-z0-9_]/.test(source[at - 1]!)) return last;
  if (at > last) out.push({ kind: 'text', value: source.slice(last, at) });
  // closing punctuation after a URL is the sentence's, not the link's
  let value = m[1] ? m[0].replace(/[.,;:!?\]'"]+$/, '') : m[0];
  // a `)` closes the URL's own `(` (wiki/Foo_(bar)) or else the sentence's
  while (m[1] && value.endsWith(')') && (value.match(/\(/g)?.length ?? 0) < (value.match(/\)/g)?.length ?? 0)) value = value.slice(0, -1).replace(/[.,;:!?\]'"]+$/, '');
  out.push({ kind: m[1] ? 'url' : m[2] ? 'mention' : 'hashtag', value });
  return at + value.length;
}

export function referenceFromList(refs: XRow[], type: string): string | undefined {
  const hit = refs.find((r: XRow) => r?.type === type);
  return hit ? String(hit.id) : undefined;
}

export function mediaFromKeys(keys: unknown[], media: Map<string, XRow>): XRow[] {
  return keys.map((k: unknown) => media.get(String(k))).filter((m): m is XRow => m !== undefined);
}

// ── x.com's post and profile pages (./post.tsx, ./profile.tsx) ─────────────────────────────────────

/** What a page reads: the pack's tree as the request finds it (read once, when a page is asked for), the World's instant
 *  (a profile's "5m" is drawn against it), the person signed in, and where the page was reached. */
/** `notice`: what the page's last press was answered (an operation's refusal, in X's words); `compose`: the reply
 *  composer open under the post (its Reply). */
export type PageOptions = { read: () => Resource[]; nowMs: number; person: XRow | undefined; placed: string | undefined; notice?: string; compose?: boolean; draft?: string };

export function pageOptions(ctx: HandlerContext): PageOptions {
  let held: Resource[] | undefined;
  return { read: () => (held ??= tree(ctx)), nowMs: Date.parse(ctx.occurredAt), person: signedInAccount(ctx), placed: placeOf(ctx) };
}

/** A page answered: its move (on the base at a World's place), its head, or its HTML. A path with a trailing slash moves
 *  to the path without it, as x.com does (observed: /jack/status/20/ and /XDevelopers/ answer 307). */
export function answerPage(request: Request, options: PageOptions, draw: () => Page): Response {
  const url = new URL(request.url);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) return new Response(null, { status: 307, headers: { location: onBase(`https://x.com${url.pathname.replace(/\/+$/, '')}${url.search}`, options.placed) } });
  const page = draw();
  if (page.location) return new Response(null, { status: page.status, headers: { location: onBase(page.location, options.placed) } });
  return request.method === 'HEAD' ? new Response(null, { status: page.status, headers: { 'content-type': 'text/html; charset=utf-8' } }) : htmlPage(page.html, options.placed, page.status, {}, request);
}

/** X's plain 404 for a request no page of the screen answers (a method other than GET or HEAD, a path not its shape). */
export const plainNotFound = (): Response => new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

// ── the pages ──────────────────────────────────────────────────────────────────────────────────

// STATUS CODES, as observed at x.com (2026-09-28, logged out, the curl above): a live post under its
// author's handle 200 (/jack/status/20); the same post under another handle or another case 307 to its
// author's (/JACK/status/20 and /nosuchaccountzzq9/status/20 → /jack/status/20); an id no post has 404
// (/XDevelopers/status/404404404404404404); a profile 200 in any case (/xdevelopers); a handle no
// account has 404 (/nosuchaccountzzq9). X is an SPA and draws the page's words client-side; the words
// here are the ones its page shows, the codes the ones its server sends.
export type Page = { status: number; html: string; location?: string };

export function postPage(handle: string, id: string, options: PageOptions): Page {
  const all = options.read();
  const read = webPost(all, id);
  if (!read) return notFoundPage("Hmm...this page doesn’t exist. Try searching for something else.", '', options.person);
  const post = read.post as XRow;
  const users = usersById(read.includes);
  const tweets = tweetsById(read.includes);
  const media = mediaByKey(read.includes);
  const author = users.get(String(post.author_id));
  if (author && String(author.username) !== handle) return { status: 307, html: '', location: `https://x.com/${String(author.username)}/status/${String(post.id)}` };
  if (author?.protected === true) return protectedPostPage(author, options.person);
  const repliedTo = post.in_reply_to_user_id ? users.get(String(post.in_reply_to_user_id)) : undefined;
  const quotedId = referencedId(post, 'quoted');
  const quoted = quotedId ? tweets.get(quotedId) : undefined;
  const body = header('Post', true)
    + `<article class="post-detail" data-post-id="${esc(post.id)}">`
    + `<div class="detail-head">${avatar(author, 40)}<div class="detail-names">${nameLine(author, '')}</div></div>`
    + (repliedTo ? `<div class="muted replying">Replying to <a class="entity" href="/${esc(repliedTo.username)}">@${esc(repliedTo.username)}</a></div>` : '')
    + (post.text ? postText(post.text, true) : '')
    + mediaBlock(postMedia(post, media), true)
    + cardBlock(cardOf(all, post))
    + (quoted ? quoteCard(quoted, users, options.nowMs) : '')
    + `<div class="detail-time muted"><a href="/${esc(author?.username ?? 'i')}/status/${esc(post.id)}"><time datetime="${esc(post.created_at)}">${esc(fullTimestamp(post.created_at, 'UTC'))}</time></a></div>`
    + actions(true, author?.username ? { id: String(post.id), handle: String(author.username) } : undefined)
    + '</article>'
    + notice(options.notice)
    + (options.compose && options.person && author?.username ? replyComposer(String(author.username), String(post.id), options.draft ?? '') : '');
  const title = `${String(author?.name ?? author?.username ?? 'X')} on X: "${String(post.text ?? '')}" / X`;
  return { status: 200, html: shell(title, body, options.person) };
}

export function profilePage(handle: string, options: PageOptions): Page {
  const all = options.read();
  const read = webProfile(all, handle);
  if (!read) return notFoundPage('This account doesn’t exist', 'Try searching for another.', options.person);
  const user = read.user as XRow;
  const users = usersById(read.includes);
  users.set(String(user.id), { ...users.get(String(user.id)), ...user });
  const count = read.posts.length;
  const meta = [
    typeof user.location === 'string' && user.location ? `<span>${esc(user.location)}</span>` : '',
    typeof user.url === 'string' && user.url ? `<span><a class="entity" href="${esc(linkHref(user.url))}" rel="noreferrer">${esc(displayUrl(user.url))}</a></span>` : '',
    joinedLabel(user.created_at, 'UTC') ? `<span>${esc(joinedLabel(user.created_at, 'UTC'))}</span>` : '',
  ].join('');
  const posts = user.protected === true
    ? `<div class="notice"><div class="notice-title">These posts are protected</div><div class="muted">Only approved followers can see @${esc(user.username)}’s posts.</div></div>`
    : count === 0
      ? `<div class="notice"><div class="notice-title">@${esc(user.username)} hasn’t posted</div><div class="muted">When they do, their posts will show up here.</div></div>`
      : timeline(read, (p) => cardOf(all, p), options.nowMs, users);
  const body = header(String(user.name ?? user.username), true, `${count} post${count === 1 ? '' : 's'}`)
    + '<div class="profile"><div class="banner"></div>'
    + `<div class="profile-top"><div class="profile-avatar">${avatar(user, 134)}</div>${options.person && String(options.person.id) !== String(user.id) ? `<form method="post" action="/${esc(user.username)}"><button type="submit" class="follow" name="intent" value="follow" data-testid="${esc(user.id)}-follow" aria-label="Follow @${esc(user.username)}">Follow</button></form>` : ''}</div>`
    + notice(options.notice)
    + '<div class="profile-info">'
    + `<div class="profile-name"><span>${esc(user.name)}</span>${user.verified === true ? VERIFIED_SVG : ''}${user.protected === true ? '<span class="lock">🔒</span>' : ''}</div>`
    + `<div class="muted profile-handle">@${esc(user.username)}</div>`
    + (typeof user.description === 'string' && user.description ? `<div class="profile-bio">${postText(user.description, false)}</div>` : '')
    + (meta ? `<div class="muted profile-meta">${meta}</div>` : '')
    + '</div></div>'
    + '<div class="tabs"><span class="tab active">Posts</span><span class="tab">Replies</span><span class="tab">Media</span></div>'
    + posts;
  return { status: 200, html: shell(`${String(user.name ?? user.username)} (@${String(user.username)}) / X`, body, options.person) };
}

/** The answer to the page's last press, when it was refused (X's own words for it). */
const notice = (text: string | undefined): string => (text ? `<div class="toast" role="status"><span>${esc(text)}</span></div>` : '');

/** The reply composer under a post, as x.com opens it from Reply: the person's text and its Reply button
 *  (`tweetButton`), which posts it as a reply (createPosts with `reply.in_reply_to_tweet_id`). */
function replyComposer(handle: string, id: string, draft: string): string {
  return `<form method="post" action="/${esc(handle)}/status/${esc(id)}" class="composer reply-composer">`
    + `<textarea name="text" aria-label="Post text" data-testid="tweetTextarea_0" placeholder="Post your reply">${esc(draft)}</textarea>`
    + `<div class="composer-bar"><button type="submit" class="post-button" name="intent" value="reply" data-testid="tweetButton">Reply</button></div></form>`;
}

function notFoundPage(title: string, sub: string, person: XRow | undefined): Page {
  return { status: 404, html: shell('Page not found / X', header('', true) + `<div class="notice"><div class="notice-title">${esc(title)}</div>${sub ? `<div class="muted">${esc(sub)}</div>` : ''}</div>`, person) };
}

function protectedPostPage(author: XRow, person: XRow | undefined): Page {
  return { status: 200, html: shell('Post / X', header('Post', true) + `<div class="notice"><div class="notice-title">These posts are protected</div><div class="muted">Only approved followers can see @${esc(author.username)}’s posts.</div></div>`, person) };
}

function invalidConsentRequest(): XResponse {
  return oauthError('invalid_request', 'Unknown, expired, or already settled authorization request.', 400);
}
