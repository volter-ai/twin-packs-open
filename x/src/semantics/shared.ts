// What every X operation, door and screen shares (docs/contributing/architecture.md, "Pack layout"): X's answers in their
// error families (the OAuth endpoints' and the /2 surface's problems), the scopes, PKCE, the state the twin keeps and its
// credential mints, OAuth 1.0a's signature as X checks it (the kernel's RFC 5849 library, X's own rules around it), who a
// request acts for, the read projection, and the media an upload holds. X is one API and one store: the authorization
// server that issues a credential and the surface that honours it read and write the same rows.
//
// Credential decisions read, check and then record: this does not claim them under one lock. The public record seam
// preserves the checked operation without journaling the incoming code, verifier, refresh token or secret.
import { digest, equalSecrets, type HandlerContext, oauth1BaseString, oauth1Header, oauth1Signature, readImageHeader, readMp4Header, sha256 } from '@volter/world-core';

/** An X answer: its status, body (a page or a form-encoded leg as text; anything else JSON) and headers. */
// X API v2 error envelopes — the vendor's THREE distinct error families, kept distinct because an
// integration can (and X's own SDKs do) branch on them:
//
//   1. OAuth token-endpoint errors: the RFC 6749 §5.2 flat body `{ error, error_description }`.
//      The docs show no error examples (user-access-token guide, fetched 2026-08-21), so the
//      `error` codes here are RFC 6749's and the descriptions are the widely-reported X wire
//      strings — the EVIDENCE BOUNDARY is marked at each call site and the exact texts are filed
//      as `x.token.error_wording` (todo) rather than claimed pinned.
//
//   2. v2 problem envelopes (`application/problem+json` shapes): the OpenAPI 2.167 `Problem`
//      family, discriminated by a `type` URL (`https://api.x.com/2/problems/…`). The generic
//      auth failure is the `about:blank` form (`{title, type: "about:blank", status, detail}`) —
//      observed wire behaviour for a bad bearer, marked extrapolated where the doc trail stops.
//
//   3. The request-level invalid-parameter envelope: `{errors: [{parameters, message}], title:
//      "Invalid Request", detail: "One or more parameters to your request was invalid.", type:
//      …/invalid-request}` — the OpenAPI's InvalidRequestProblem, with the per-parameter `errors`
//      array the wire carries.
//
//   4. The 15-minute-window rate refusal: HTTP 429 with legacy error code 88 — docs.x.com
//      fundamentals/rate-limits (fetched 2026-08-21) documents "a 429 error with error code 88:
//      Rate limit exceeded" verbatim, hence the v1.1-style `{errors: [{code, message}]}` body.

export type XResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  /** a screen's rendered page, answered as it is */
  page?: Response;
};

export const NOSTORE = { 'cache-control': 'no-cache, no-store, max-age=0' };

// ── family 1: OAuth token endpoint (RFC 6749 flat body) ─────────────────────────────────────────

export function oauthError(error: string, description: string, status: number): XResponse {
  return { status, body: { error, error_description: description }, headers: { ...NOSTORE } };
}

/**
 * The ONE answer an unusable authorization code gets — unknown, already-redeemed, expired, minted
 * for another client, wrong redirect_uri pairing or failed PKCE are deliberately indistinguishable
 * (telling them apart would leak which codes exist). The description is the widely-reported X wire
 * string for this case; the `error` code X pairs with it is reported as `invalid_request` (where
 * RFC 6749 would say `invalid_grant`) and the twin follows the REPORTED WIRE, marked extrapolated.
 */
export function badAuthorizationCode(): XResponse {
  return oauthError('invalid_request', 'Value passed for the authorization code was invalid.', 400);
}

/** The refresh-token twin of the above — same reported-wire caveat. */
export function badRefreshToken(): XResponse {
  return oauthError('invalid_request', 'Value passed for the token was invalid.', 400);
}

/** Client authentication failed at the token/revoke endpoint (RFC 6749 §5.2: 401 invalid_client). */
export function invalidClient(): XResponse {
  return oauthError('invalid_client', 'Client authentication failed.', 401);
}

// ── family 2: v2 problem envelopes ──────────────────────────────────────────────────────────────

/** The generic auth problem X answers a bad/absent/expired bearer with on /2 resources. */
export function unauthorizedProblem(): XResponse {
  return {
    status: 401,
    body: { title: 'Unauthorized', type: 'about:blank', status: 401, detail: 'Unauthorized' },
    headers: { ...NOSTORE, 'content-type': 'application/problem+json' },
  };
}

/**
 * A user token whose scope set does not cover the endpoint. The 403 + problem SHAPE follows the
 * OpenAPI's default-error contract; X's exact wording for the insufficient-scope case was not
 * captured from an official artefact, so the twin states the refusal plainly rather than inventing
 * vendor prose — pinning the live body is `x.users_me.insufficient_scope_wording` (todo).
 */
export function forbiddenProblem(detail: string): XResponse {
  return {
    status: 403,
    body: { title: 'Forbidden', type: 'about:blank', status: 403, detail },
    headers: { ...NOSTORE, 'content-type': 'application/problem+json' },
  };
}

/** A contained unexpected failure on the v2 resource surface. Never exposes local exception text. */
export function internalServerProblem(): XResponse {
  return {
    status: 500,
    body: { title: 'Internal Server Error', type: 'about:blank', status: 500, detail: 'Internal Server Error' },
    headers: { ...NOSTORE, 'content-type': 'application/problem+json' },
  };
}

/**
 * The invalid-parameter envelope (OpenAPI InvalidRequestProblem + the wire's per-parameter
 * `errors` array). `parameters` maps the offending query parameter to the values it arrived with.
 */
export function invalidRequestProblem(parameters: Record<string, string[]>, message: string): XResponse {
  return {
    status: 400,
    body: {
      errors: [{ parameters, message }],
      title: 'Invalid Request',
      detail: 'One or more parameters to your request was invalid.',
      type: 'https://api.x.com/2/problems/invalid-request',
    },
    headers: { ...NOSTORE, 'content-type': 'application/json' },
  };
}

// ── family 4: the rate refusal ──────────────────────────────────────────────────────────────────

/** HTTP 429, legacy code 88 — the documented pair (docs.x.com fundamentals/rate-limits). */
// source: https://docs.x.com/x-api/fundamentals/rate-limits "Exceeding limits results in a 429 error until the window resets."
export function rateLimitExceeded(headers: Record<string, string>): XResponse {
  return {
    status: 429,
    body: { errors: [{ code: 88, message: 'Rate limit exceeded' }] },
    headers: { ...NOSTORE, ...headers, 'content-type': 'application/json' },
  };
}

// ── scopes ──────────────────────────────────────────────────────────────────────────────────
// X OAuth 2.0 scopes — the vendor's own catalog, transcribed VERBATIM from the X API v2 OpenAPI
// document's `OAuth2UserToken` security scheme (../spec/openapi.json.gz, version 2.168; first
// transcribed from 2.167, fetched 2026-08-21, which lacked developer.read and developer.write).
// the catalog is held equal to the vendored document's. The description
// strings are X's own consent-screen wording, so the authorize page the twin serves shows exactly
// what the vendor's shows for each scope.
//
// The screen model: X's authorize page is ALL-OR-NOTHING. It lists what the app will be able to
// view and do, with exactly two buttons — "Authorize app" and "Cancel" — and no per-scope
// checkboxes (unlike Google's granular consent). The grant is the full requested scope set or
// nothing.

export type ScopeInfo = {
  scope: string;
  /** X's own consent wording for the scope (OpenAPI securityScheme description). */
  label: string;
  /** How the authorize screen groups it: things the app can VIEW vs DO vs the session promise. */
  group: 'view' | 'do' | 'session';
  /** In the vendor catalog? An unknown scope is still displayed, flagged, so a typo is visible. */
  known: boolean;
};

/** The 26 scopes X's OpenAPI declares, plus the announcement-grounded `users.email` (see its
 *  in-line note), keyed by scope id. */
export const SCOPE_CATALOG: Record<string, { label: string; group: 'view' | 'do' | 'session' }> = {
  'block.read': { label: 'View accounts you have blocked.', group: 'view' },
  'block.write': { label: 'Block and unblock accounts on your behalf.', group: 'do' },
  'bookmark.read': { label: 'Read your bookmarked Posts.', group: 'view' },
  'bookmark.write': { label: 'Create and delete your bookmarks.', group: 'do' },
  'broadcast.read': { label: 'View your live broadcasts and their chat.', group: 'view' },
  'broadcast.write': { label: 'Manage your live broadcasts and send chat messages on your behalf.', group: 'do' },
  'developer.read': { label: 'View your developer accounts, apps, and settings.', group: 'view' },
  'developer.write': { label: 'Create and manage your X Developer Platform account.', group: 'do' },
  'dm.read': { label: 'Read all your Direct Messages.', group: 'view' },
  'dm.write': { label: 'Send and manage your Direct Messages.', group: 'do' },
  'follows.read': { label: 'View accounts you follow and accounts following you.', group: 'view' },
  'follows.write': { label: 'Follow and unfollow accounts on your behalf.', group: 'do' },
  'like.read': { label: 'View Posts you have liked and likes you can see.', group: 'view' },
  'like.write': { label: 'Like and unlike Posts on your behalf.', group: 'do' },
  'list.read': { label: 'View Lists, members, and followers of Lists you created or are a member of, including private Lists.', group: 'view' },
  'list.write': { label: 'Create and manage Lists on your behalf.', group: 'do' },
  'media.write': { label: 'Upload media, such as photos and videos, on your behalf.', group: 'do' },
  'mute.read': { label: 'View accounts you have muted.', group: 'view' },
  'mute.write': { label: 'Mute and unmute accounts on your behalf.', group: 'do' },
  'offline.access': { label: 'Stay connected to your account until you revoke access.', group: 'session' },
  'space.read': { label: 'View all Spaces you have access to.', group: 'view' },
  'timeline.read': { label: 'View all Custom Timelines you can see.', group: 'view' },
  'tweet.moderate.write': { label: 'Hide and unhide replies to your posts.', group: 'do' },
  'tweet.read': { label: 'View all posts you can see, including those from protected accounts.', group: 'view' },
  'tweet.write': { label: 'Create and repost on your behalf.', group: 'do' },
  'users.read': { label: 'View any account you can see, including protected accounts.', group: 'view' },
  // NOT in the OpenAPI securityScheme catalog (2.167 or 2.168; a recorded intra-vendor discrepancy): X's own
  // April-2025 announcement ("Announcing support for email address retrieval with OAuth 2.0 in the
  // X API v2", devcommunity.x.com/t/240555, re-fetched 2026-08-21) adds `users.email` as the scope
  // gating the `confirmed_email` field on /2/users/me. The label is NOT vendor wording —
  // EXTRAPOLATION, pinned by `x.scopes.users_email_wording` (todo).
  'users.email': { label: 'Access your email address.', group: 'view' },
};
// EVIDENCE BOUNDARY: every label above is the OpenAPI description verbatim EXCEPT `offline.access`,
// whose OpenAPI description ("Request a refresh token for the app.") is developer-facing, not the
// consent-screen line. The consent-screen wording used here is the widely-reported "Stay connected
// …" line; it is not from a fetched official artefact and is marked as such in the manifest
// (`x.consent.offline_access_wording`, todo).

/** Space-separated scope param → ordered unique scope list (X formats scope space-separated). */
export function parseScopeParam(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of raw.split(/[\s+]+/)) {
    // `+` appears when a caller form-encodes spaces as plus signs and a layer decodes only %XX.
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function formatScopeParam(scopes: readonly string[]): string {
  return scopes.join(' ');
}

export function describeScope(scope: string): ScopeInfo {
  const known = SCOPE_CATALOG[scope];
  return known
    ? { scope, label: known.label, group: known.group, known: true }
    : { scope, label: scope, group: 'view', known: false };
}

export function describeScopes(scopes: readonly string[]): ScopeInfo[] {
  return scopes.map(describeScope);
}

/** Screen order: what the app can view, then what it can do, then the offline promise. */
export function sortScopesForConsent(scopes: readonly string[]): string[] {
  const order: Record<'view' | 'do' | 'session', number> = { view: 0, do: 1, session: 2 };
  return [...scopes].sort((a, b) => order[describeScope(a).group] - order[describeScope(b).group]);
}

// ── PKCE ────────────────────────────────────────────────────────────────────────────────────
// PKCE (RFC 7636) — real SHA-256, no stubs. X's documented code_challenge_method values are
// `S256` and `plain` (docs.x.com authorization-code guide, fetched 2026-08-21).
//
// CASE: the docs write `S256`; X's LEGACY official SDK (twitter-api-typescript-sdk, OAuth2User.
// generateAuthURL) emits the lowercase `s256` in its authorize URLs, so a twin that refused the
// lowercase form would refuse the vendor's own client. Both spellings are accepted and normalised
// here; the exact live tolerance is pinned as a manifest todo rather than asserted
// (`x.authorize.challenge_method_case`).

/** base64url(SHA-256(verifier)) — the S256 code_challenge for a code_verifier. */
export function pkceS256(verifier: string): string {
  return digest('sha256', verifier, 'base64url');
}

export type ChallengeMethod = 'S256' | 'plain';

/** Normalise a caller-supplied code_challenge_method, or null when it isn't a documented value. */
export function normalizeChallengeMethod(raw: string | null): ChallengeMethod | null {
  if (raw === null) return null;
  if (raw === 'plain') return 'plain';
  if (raw.toUpperCase() === 'S256') return 'S256';
  return null;
}

/** Does `verifier` satisfy the challenge the code was minted against? */
export function pkceVerifies(method: ChallengeMethod, challenge: string, verifier: string): boolean {
  return method === 'S256' ? pkceS256(verifier) === challenge : verifier === challenge;
}

// ── the state ───────────────────────────────────────────────────────────────────────────────
// Everything the twin knows lives in the kernel's log and tree: OAuth clients, X accounts, the browser session (which
// account is "logged in" at x.com), pending authorization requests, the per-(client, user) grant (`_grant`) and the
// per-user rate window (`_rate_window`); OAuth 1.0a Apps, access tokens and approvals (`_oauth1_grant`).
//
// A CREDENTIAL IS BOOKKEEPING, KEPT BY ITS SHA-256 (docs/contributing/adding-a-twin.md, "A token never rides a
// deployable entry"): an authorization code, an access token, a refresh token, an OAuth 1.0a request token and an
// OAuth 2.0 App's client secret live under `_` types (never deployed, never in a changeset), each subject named by the
// SHA-256 of the credential, so the credential itself is in no entry's fields and no subject id. Two rows keep a secret, by contract: the OAuth 1.0a App
// (`oauth1_app`, its consumer secret) and access token (`_oauth1_token`, named by the token, with its secret), which the
// x pack reads through the kernel's owner read (OAuth 1.0a, below, states that contract).
//
// ID MINTING (docs/contributing/adding-a-twin.md §5): every id is the vendor's own natural key (an account id) or
// minted here, and every minted one is SERVED (the `ar_` authorize handle is rendered into the screen, the `…:ac:1` code
// rides the callback redirect, the `…:at:1`/`…:rt:1` tokens ride the /2/oauth2/token reply, a minted client id rides
// the door's reply). Runtime contract R9 (a served response is a pure function of (request, stored state)) therefore
// governs all of them: a stable hash of the world instant + the number of credentials of that kind the store already
// holds (soft-deleted rows counted, so a value can never recur) + the subject it is issued for.
//
// The `ar_` handle carries one extra rule the credentials do not: an authorize request whose parameters already name
// an UNSETTLED pending row reuses that row's id, so re-serving the same authorize screen is byte-identical (and a
// reload does not pile up a second pending request).
//
// The mutable-in-place rows (a code being consumed, a token being revoked, a grant re-granted, a rate window
// advancing) carry a per-subject `rev` ordinal (the upstash precedent), so each rewrite of a subject is told apart.

export type Row = { id: string; type: string } & Record<string, any>;

/** The next revision from a snapshot already held (under the kernel's projection lock, or a request's read). */
export function nextRevIn(resources: readonly Row[], type: string, id: string): number {
  const existing = resources.find((r) => r.type === type && r.id === id);
  return (typeof existing?.rev === 'number' ? existing.rev : 0) + 1;
}

// ── credentials, by their SHA-256 ───────────────────────────────────────────────────────────────


/** A credential's bookkeeping type. */
export const CREDENTIAL = {
  code: { type: '_authorization_code' },
  access: { type: '_access_token' },
  refresh: { type: '_refresh_token' },
  requestToken: { type: '_oauth1_request_token' },
} as const;
export type CredentialKind = keyof typeof CREDENTIAL;

/** Rows of one type, from whatever the caller holds: a request's tree, or the rows inside an atomic decision. */
export type Rows = (type: string) => readonly Row[];

/** A credential's row, by the credential's SHA-256; `key` is the subject a move on it writes. */
export function credentialRow(rows: Rows, kind: CredentialKind, credential: string): { row: Row; key: string } | undefined {
  if (!credential) return undefined;
  const key = sha256(credential);
  const own = rows(CREDENTIAL[kind].type).find((r) => r.id === key);
  return own ? { row: own, key } : undefined;
}

/** Every credential of a kind, each with the subject a move on it writes. */
export function credentialRows(rows: Rows, kind: CredentialKind): Array<{ row: Row; key: string }> {
  return rows(CREDENTIAL[kind].type).map((row) => ({ row, key: row.id }));
}

/** A credential row's own fields, for a move that rewrites it. */
export function credentialFields(row: Row): Record<string, unknown> {
  const { id: _id, type: _type, updatedAt: _updated, deleted: _deleted, ...fields } = row;
  void _id; void _type; void _updated; void _deleted;
  return fields;
}

/** How many credentials of a kind the store has held (a mint's seed). */
function heldCount(rows: Rows, kind: CredentialKind): number {
  return rows(CREDENTIAL[kind].type).length;
}

/** An authorize request's PKCE challenge, by the request's handle. It is bookkeeping because with `plain` (X's own docs'
 *  example uses it) the challenge IS the verifier; the `auth_request` row keeps only its SHA-256, which is what tells
 *  two authorize requests apart. */
export const CODE_CHALLENGE = '_code_challenge';

/** The OAuth 2.0 client secret's bookkeeping type: its SHA-256, by the client id. */
export const CLIENT_SECRET = '_client_secret';

/** Does `secret` authenticate `client`? Its bookkeeping hash; a public client has none and authenticates nothing by
 *  secret. */
export function clientSecretMatches(rows: Rows, client: Row, secret: string): boolean {
  const kept = rows(CLIENT_SECRET).find((r) => r.id === client.id);
  return !!kept && typeof kept.sha256 === 'string' && kept.sha256 === sha256(secret);
}

// ── vendor-shaped id minting ────────────────────────────────────────────────────────────────────
// X's OAuth 2.0 artefacts are base64url blobs with an internal structure the vendor's own docs examples expose when
// decoded (docs.x.com user-access-token guide, fetched 2026-08-21):
//
//   client_id     M1M5R3BMVy13QmpScXkzTUt5OE46MTpjaQ                → "<21 alnum>:1:ci"
//   auth code     VGNibzFWSWRE…RchOXlMd2dxOjE2MjIxNjA4MjU4MjU6MToxOmFjOjE
//                                                                   → "<opaque>:<unix ms>:1:1:ac:1"
//   access token  Q0Mzb0VhZ0V5…U3NZQnZQYjoxNjIyMTQ3NzQzOTE0OjE6MTphdDox
//                                                                   → "<opaque>:<unix ms>:1:1:at:1"
//   refresh token bWRWa3gzdnk3…QVdxbm06MTYyMjE0Nzc0MzkxNDoxOjE6cnQ6MQ
//                                                                   → "<opaque>:<unix ms>:1:1:rt:1"
//
// The twin reproduces the SHAPE (an integrator's code may key on it); the bytes are not the vendor's. Every credential's
// seed begins with the World's credential salt (`credentialSalt`, ctx.secret: made once at random by the World), so a
// World replays the same credentials while no one computes one from what the World shows. UNIQUENESS is the seed's too, and the seed carries it: the count advances on every mint, so two
// credentials of one kind at one instant differ even when the subject is identical, and the SUBJECT is the credential
// being exchanged — the consent screen for a code, the code or spent refresh token for a token — so concurrent
// exchanges never meet. `x.refresh.rotation` (a rotation must hand back a refresh token the caller did not send)
// holds by construction: the spent row is already in the store when the replacement is seeded.

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
/** The World's credential salt: every issued credential's seed begins with it. */
export const credentialSalt = (ctx: Pick<HandlerContext, 'secret'>): Promise<string> => ctx.secret('x-credential-salt');

/** The seed every credential is minted from. */
function credentialSeed(label: string, count: number, instant: string | number, subject: string, salt: string): string {
  return `${salt}:${label}:${instant}:${count}:${subject}`;
}

/** An X OAuth 2.0 client id: base64url of `<opaque>:1:ci`. */
export const mintClientId = (seed: string): string => b64url(`${stableHex(seed, 21)}:1:ci`);
/** An X OAuth 2.0 authorization code (`…:ac:1`). `subject` is the authorize screen it settles. */
export const mintAuthorizationCode = (rows: Rows, at: number, subject: string, salt: string): string =>
  b64url(`${stableHex(credentialSeed('authorization_code', heldCount(rows, 'code'), at, subject, salt), 45)}:${at}:1:1:ac:1`);
/** An X OAuth 2.0 user access token (`…:at:1`). `subject` is the credential exchanged for it. */
export const mintAccessToken = (rows: Rows, at: number, subject: string, salt: string): string =>
  b64url(`${stableHex(credentialSeed('access_token', heldCount(rows, 'access'), at, subject, salt), 45)}:${at}:1:1:at:1`);
/** An X OAuth 2.0 refresh token (`…:rt:1`). `subject` is the credential exchanged for it. */
export const mintRefreshToken = (rows: Rows, at: number, subject: string, salt: string): string =>
  b64url(`${stableHex(credentialSeed('refresh_token', heldCount(rows, 'refresh'), at, subject, salt), 45)}:${at}:1:1:rt:1`);
/** How many OAuth 1.0a request tokens the store has held (the request-token leg mints from it). */
export const requestTokensHeld = (rows: Rows): number => heldCount(rows, 'requestToken');

// ── the authorize screen's handle: DETERMINISTIC, because it is SERVED (R9) ─────────────────────
/** FNV-1a over the seed, widened by re-hashing with a round counter until `n` hex chars exist (the resend exemplar's
 *  `stableHex`). Pure: no clock, no entropy, no host state. */
export function stableHex(seed: string, n: number): string {
  let out = '';
  for (let round = 0; out.length < n; round += 1) {
    let h = 0x811c9dc5;
    const s = `${round}:${seed}`;
    for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    out += h.toString(16).padStart(8, '0');
  }
  return out.slice(0, n);
}

/** Every authorize parameter an `auth_request` row holds — its stable identity. Read off the fields being written OR
 *  off a projected row (the key set is the same on both). */
const AUTH_REQUEST_SIG_KEYS = [
  'clientId', 'redirectUri', 'scope', 'state', 'codeChallengeSha256', 'codeChallengeMethod', 'accountId',
] as const;
function authRequestSignature(fields: Record<string, unknown>): string {
  return AUTH_REQUEST_SIG_KEYS.map((k) => `${k}=${String(fields[k] ?? '')}`).join('\u0001');
}

/**
 * Twin-internal handle for an authorize screen in flight (never leaves the twin's own pages) — `ar_` + 32 hex, the
 * shape `randomUUID()` once gave it, a pure function of (request, stored state).
 *
 * An authorize request whose parameters ALREADY name an unsettled pending row reuses that row's id: pressing reload on
 * the authorize screen is the same screen, not a new one. Otherwise the id is `stableHex(auth_request:<world
 * instant>:<rows already held>)` — two authorize requests at one instant differ by the count, and two identical worlds
 * mint identical ids.
 */
export function authRequestIdFor(prior: readonly Row[], occurredAt: string, fields: Record<string, unknown>): string {
  const signature = authRequestSignature(fields);
  const reusable = prior.find((r) => r.settled !== true && authRequestSignature(r) === signature);
  if (reusable) return String(reusable.id);
  return `ar_${stableHex(`auth_request:${occurredAt}:${prior.length}`, 32)}`;
}

// ── seeded world ────────────────────────────────────────────────────────────────────────────────
// The authorize screens consent as the person signed in at x.com (../screens/login.tsx, X's auth_token cookie); a visitor
// nobody signed in is sent to sign in first, as X's pages put the person's sign-in before consent. The default clients mirror the two shapes the X developer portal hands out: a CONFIDENTIAL client (Web App — has a
// secret, authenticates with HTTP Basic) and a PUBLIC client (Native/SPA — no secret, client_id travels in the body).

/** NextAuth's callback path for the X provider — the one every X integration guide walks through. */
const CALLBACK_PATH = '/api/auth/callback/x';

/**
 * Every spelling of the ORIGIN this twin was reached on that a browser could hand back.
 *
 * X matches redirect URIs EXACTLY and documents NO loopback-port exception (see `redirectUriAllowed` below), so
 * `localhost` and the loopback IP are two different registrations — while a local app is reachable as both on the
 * same port. A demo registration naming only one of them would fail half the time for a reason the developer cannot
 * see.
 */
function originSpellings(origin?: string): string[] {
  const base = (origin ?? '').trim().replace(/\/+$/, '');
  if (!base) return [];
  let u: URL;
  try { u = new URL(base); } catch { return [base]; }
  if (u.protocol !== 'http:') return [base];
  const port = u.port ? `:${u.port}` : '';
  if (u.hostname === 'localhost') return [base, `http://127.0.0.1${port}`];
  if (u.hostname === '127.0.0.1') return [base, `http://localhost${port}`];
  return [base];
}

/**
 * The redirect URIs the seeded demo clients register.
 *
 * Runtime contract R7: a twin NEVER bakes a port into served content or config. The callbacks are DERIVED from the
 * origin the twin was actually reached on (the request's own origin, ../server.ts). A caller that declares
 * no origin — an in-process call on X's own host — seeds no callbacks at all and registers its own through the twin
 * door.
 */
export function defaultRedirectUris(origin?: string): string[] {
  return originSpellings(origin).map((base) => `${base}${CALLBACK_PATH}`);
}


/**
 * Is `candidate` an EXACT registered callback URI for this client? X documents exact-match validation for OAuth 2.0
 * callback URLs ("This value must correspond to one of the Callback URLs defined in your App's settings" — and the
 * legacy official SDK's own docblock spells out "exact match validation"). No loopback-port exception is documented
 * for X, so none is modelled — a loosely-matching twin would hide the single most common integration bug.
 */
export function redirectUriAllowed(client: Row, candidate: string): boolean {
  const registered: string[] = Array.isArray(client.redirectUris) ? client.redirectUris : [];
  // A fragment never legitimately appears in a redirect_uri (RFC 6749 §3.1.2) and exact string membership would still
  // admit one only if it had been REGISTERED with a fragment — refuse the candidate outright before comparing.
  if (candidate.includes('#')) return false;
  return registered.includes(candidate);
}

// ── OAuth 1.0a ──────────────────────────────────────────────────────────────────────────────
// X's OAuth 1.0a — the mechanics of the three-legged flow and of the user-context signature that authorizes the
// API: RFC 5849's signature, X's v1.1 error bodies, the Apps a request can name, and the verification of a signed
// request. The legs themselves are handlers (./oauth.ts) and the authorize screens are screens
// (../screens/oauth1-authorize.ts):
//
//   api.x.com  POST /oauth/request_token        → step 1: a request token for a registered App
//              GET  /oauth/authorize            → step 2: the authorize screen, always shown
//              GET  /oauth/authenticate         → step 2 (Sign in with X): skipped once approved
//              POST /oauth/access_token         → step 3: the request token + verifier → access token
//              POST /1.1/oauth/invalidate_token → an App revokes an access token it holds
//
// GROUNDING (docs.x.com, fetched 2026-09-27): resources/fundamentals/authentication/api-reference
// (the five endpoints, their parameters and the request/response examples quoted at each site),
// .../oauth-1-0a/obtaining-user-access-tokens (the walkthrough: oauth_callback_confirmed, the
// callback carrying oauth_token + oauth_verifier, tokens that "do not expire but can be revoked"),
// .../oauth-1-0a/creating-a-signature (the HMAC-SHA1 base string: method, base URL, the sorted
// percent-encoded parameter string; the signing key `consumer_secret&token_secret`), and
// fundamentals/developer-apps (the Read / Read and write permission levels; the 415 "Callback URL
// not approved" body verbatim). Legacy error codes 32/89/135/215 are X's v1.1 error table
// (developer.x.com error-troubleshooting, whose codes the consumer library also enumerates:
// twitter-api-v2@1.29.1 EApiV1ErrorCode); where a wording or status is not in a fetched page the
// site says EXTRAPOLATION and a manifest todo pins it.
//
// THE CONSUMER this serves is twitter-api-v2's OAuth 1.0a flow: `generateAuthLink(callback,
// {authAccessType:'write', linkMode:'authenticate'})`, `login(oauth_verifier)`, then `v2.me()`,
// v2 media upload and `POST /2/tweets`, every one signed with OAuth 1.0a HMAC-SHA1.
//
// ONE VENDOR, TWO PACKS. The access tokens minted here authorize X's posting surface too, which
// the `x` pack serves. X has one credential store; this pack is it. The `x` pack READS the
// `_oauth1_token` and `oauth1_app` rows below through the kernel projection (never writes them) and
// verifies the signature with its own transcription of `oauth1Params`/`signatureMatches` (A3
// forbids the import). The row shapes are that contract:
//   oauth1_app   id=consumer key  { secret, name, callbackUrls: string[], accessLevel: 'read'|'read-write', deleted? }
//   _oauth1_token id=access token  { consumerKey, secret, userId, screenName, accessLevel, revoked }
// and the World's own App is the pair its env names (worldOAuth1App below, transcribed there too).
//
// NOT MODELLED (manifest todos): the ±5-minute timestamp window and nonce replay (code 135) — the
// twin has no clock but the World's, and an app signs with its host's; request-token expiry; the
// login screen force_login/screen_name would show (the twin authenticates nobody: the signed-in
// session is the one the person signed in to at x.com, as for OAuth 2.0); the v1.1 API the tokens also authorize.

const HTML = { 'content-type': 'text/html; charset=utf-8' };
const JSON_TYPE = { 'content-type': 'application/json; charset=utf-8' };

// ── RFC 5849 mechanics, as X's creating-a-signature guide states them ───────────────────────────

export type SignedRequest = {
  method: string;
  /** The URL the client signed, without its query: scheme://host[:non-default port]/path. */
  baseUrl: string;
  /** Header pairs (realm excluded later), query pairs and — for a form-encoded body — body pairs. */
  header: Array<[string, string]>;
  query: Array<[string, string]>;
  body: Array<[string, string]>;
};

/** Every oauth_* protocol parameter the request carries, header first (RFC 5849 §3.5 order). */
export function oauth1Params(req: SignedRequest): Map<string, string> {
  const out = new Map<string, string>();
  for (const list of [req.header, req.body, req.query]) {
    for (const [k, v] of list) if (k.startsWith('oauth_') && !out.has(k)) out.set(k, v);
  }
  return out;
}

/**
 * The base strings a correct signer may have signed. The guide's rule collects every parameter
 * once per occurrence (header, query, body) except `oauth_signature`, and RFC 5849 §3.4.1.3.1
 * excludes the Authorization header's `realm` — only that one: a `realm` in the query or body is
 * an ordinary, signed parameter. ONE leniency, and only it: twitter-api-v2 sends `oauth_token` in BOTH the header and the body of `POST oauth/access_token`
 * and signs it ONCE (its OAuth1Helper merges the two into one object); X completes that login in
 * production, so the twin also accepts an `oauth_*`
 * parameter the HEADER carries and the body or query repeats with the same value, counted once.
 * Any other repetition is signed per occurrence (X "does not accept duplicate keys in API
 * requests", creating-a-signature footnote 2 — a request that repeats a key is refused below).
 */
function candidateBaseStrings(req: SignedRequest): string[] {
  const header = req.header.filter(([k]) => k !== 'oauth_signature' && k !== 'realm');
  const rest = [...req.query, ...req.body].filter(([k]) => k !== 'oauth_signature');
  const strict = oauth1BaseString(req.method, req.baseUrl, [...header, ...rest]);
  const inHeader = new Set(header.map(([k, v]) => `${k}\u0000${v}`));
  const echoed = rest.filter(([k, v]) => !(k.startsWith('oauth_') && inHeader.has(`${k}\u0000${v}`)));
  if (echoed.length === rest.length) return [strict];
  return [strict, oauth1BaseString(req.method, req.baseUrl, [...header, ...echoed])];
}

/** A key repeated within the query or within the body (X accepts no duplicate keys — the guide). */
function repeatsAKey(req: SignedRequest): boolean {
  for (const list of [req.query, req.body]) {
    const keys = list.map(([k]) => k);
    if (new Set(keys).size !== keys.length) return true;
  }
  return false;
}

/** HMAC-SHA1 over the base string, keyed by the consumer secret and the token secret — the guide's key. */
export function signatureMatches(req: SignedRequest, consumerSecret: string, tokenSecret: string): boolean {
  const presented = oauth1Params(req).get('oauth_signature');
  if (!presented || repeatsAKey(req)) return false;
  return candidateBaseStrings(req).some((base) => equalSecrets(oauth1Signature(base, consumerSecret, tokenSecret), presented));
}

/** The protocol parameters every signed X request carries. X signs with HMAC-SHA1 only (the guide). */
export function wellFormed(params: Map<string, string>): boolean {
  return ['oauth_consumer_key', 'oauth_nonce', 'oauth_signature', 'oauth_timestamp'].every((k) => (params.get(k) ?? '') !== '')
    && params.get('oauth_signature_method') === 'HMAC-SHA1'
    && (!params.has('oauth_version') || params.get('oauth_version') === '1.0');
}

const X_HOSTS = new Set(['api.x.com', 'api.twitter.com', 'x.com', 'twitter.com']);

/**
 * The URL the client signed. Reached through the injector the request still names X's host (the
 * Node path keeps Host; the fetch path names it in `x-volter-twin-original-host`) and the client
 * signed `https://<that host><path>`. Reached directly, it signed where it sent: `origin` (the
 * twin's public base, a World mount included). A direct in-process call with neither is X's own
 * API origin.
 */
export function signedBaseUrl(headers: Record<string, string> | undefined, origin: string | undefined, path: string): string {
  const named = (headers?.['x-volter-twin-original-host'] ?? headers?.['host'] ?? '').toLowerCase().replace(/:443$/, '');
  if (X_HOSTS.has(named.replace(/:\d+$/, ''))) return `https://${named.replace(/:\d+$/, '')}${path}`;
  const base = origin ?? 'https://api.x.com';
  let u: URL;
  try { u = new URL(base); } catch { return `https://api.x.com${path}`; }
  const port = u.port && !((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) ? `:${u.port}` : '';
  return `${u.protocol}//${u.hostname.toLowerCase()}${port}${u.pathname.replace(/\/+$/, '')}${path}`;
}

/** Split a request into the signed pieces. Body pairs count only for a form-encoded body (the guide). */
export function signedRequestOf(req: { method: string; path: string; body?: string; headers?: Record<string, string>; origin?: string }): SignedRequest {
  const [p, q = ''] = req.path.split('?');
  const pairs = (s: string): Array<[string, string]> => [...new URLSearchParams(s).entries()];
  const type = (req.headers?.['content-type'] ?? '').toLowerCase();
  const formBody = type.startsWith('application/x-www-form-urlencoded') && req.method.toUpperCase() !== 'GET';
  return {
    method: req.method,
    baseUrl: signedBaseUrl(req.headers, req.origin, p ?? '/'),
    header: oauth1Header(req.headers?.['authorization']) ?? [],
    query: pairs(q),
    body: formBody ? pairs(req.body ?? '') : [],
  };
}

// ── X's v1.1 error family for the OAuth endpoints ───────────────────────────────────────────────

export const v1Error = (status: number, code: number, message: string): XResponse => ({ status, body: { errors: [{ code, message }] }, headers: { ...JSON_TYPE, ...NOSTORE } });
/** 215 "Bad Authentication data." — no usable OAuth header at all; X's table pairs it with HTTP 400. */
export const badAuthenticationData = (): XResponse => v1Error(400, 215, 'Bad Authentication data.');
/** 32 "Could not authenticate you." — an unknown consumer key or a signature that does not verify (401). */
export const couldNotAuthenticate = (): XResponse => v1Error(401, 32, 'Could not authenticate you.');
/** 89 "Invalid or expired token." — verbatim from the invalidate_token example (api-reference). */
export const invalidOrExpiredToken = (): XResponse => v1Error(401, 89, 'Invalid or expired token.');
/** 415, the body verbatim from developer-apps' troubleshooting. HTTP 403 is EXTRAPOLATION
 *  (the page shows the body only) — `x.oauth1.callback_refusal_status` pins it. */
export const callbackNotApproved = (): XResponse => v1Error(403, 415, 'Callback URL not approved for this client application.');

// ── the Apps an OAuth 1.0a request can name ─────────────────────────────────────────────────────

export type OAuth1App = { consumerKey: string; secret: string; name: string; callbackUrls: string[]; accessLevel: 'read' | 'read-write' };

/** The App a consumer key names: one registered through the twin door. An application that brings its own consumer keys
 *  registers them there (`POST /_twin/oauth1_apps`): a handler reads no environment, so the World's
 *  own keys are not an App until they are registered (a gap). */
export function oauth1AppOf(resources: readonly Row[], consumerKey: string | undefined): OAuth1App | undefined {
  if (!consumerKey) return undefined;
  const row = resources.find((r) => r.type === 'oauth1_app' && r.id === consumerKey) as Row | undefined;
  if (!row || row.deleted === true) return undefined;
  return {
    consumerKey,
    secret: String(row.secret),
    name: String(row.name ?? consumerKey),
    callbackUrls: Array.isArray(row.callbackUrls) ? row.callbackUrls.map(String) : [],
    accessLevel: row.accessLevel === 'read' ? 'read' : 'read-write',
  };
}

// ── minting (the store's R9 rule: a stable hash of instant + rows held + subject) ───────────────

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** `n` characters of X's mixed-case alphanumeric token alphabet, from the store's stable hash. */
export function alnum(seed: string, n: number): string {
  const hex = stableHex(seed, n * 2);
  let out = '';
  for (let i = 0; i < n; i += 1) out += ALNUM[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % ALNUM.length];
  return out;
}

/** A request as its signature is checked: the method, the path with its query, a form body's text, the headers, and
 *  where the twin was reached (the URL a direct client signed). */
export type SignedCall = { method: string; path: string; body?: string; headers?: Record<string, string>; origin?: string };

/** A request's form body (a GET has none). */
export function formBody(req: SignedCall): URLSearchParams {
  return new URLSearchParams(req.method.toUpperCase() === 'GET' ? '' : (req.body ?? ''));
}

/** A consumer-signed request, checked: the App it names and the signature it carries. */
export function verifyConsumer(req: SignedCall, resources: readonly Row[], tokenSecret: (params: Map<string, string>) => string | null):
  { app: OAuth1App; params: Map<string, string> } | { fail: XResponse } {
  const signed = signedRequestOf(req);
  const params = oauth1Params(signed);
  // No credentials at all (no consumer key, no signature, wherever they might travel): 215.
  if (!params.has('oauth_consumer_key') && !params.has('oauth_signature')) return { fail: badAuthenticationData() };
  if (!wellFormed(params)) return { fail: couldNotAuthenticate() };
  const app = oauth1AppOf(resources, params.get('oauth_consumer_key'));
  if (!app) return { fail: couldNotAuthenticate() };
  const secret = tokenSecret(params);
  if (secret === null) return { fail: invalidOrExpiredToken() };
  if (!signatureMatches(signed, app.secret, secret)) return { fail: couldNotAuthenticate() };
  return { app, params };
}

export const formReply = (pairs: Record<string, string>): XResponse => ({
  status: 200,
  body: new URLSearchParams(pairs).toString(),
  // X answers these legs with a form-encoded body served as text/html (the api-reference examples
  // show the body; the type is the widely-reported wire one — EXTRAPOLATION, and twitter-api-v2
  // parses the OAuth endpoints as form-encoded whatever the type says).
  headers: { ...HTML, ...NOSTORE },
});

// ── the access token at work: a user-context request, verified ─────────────────────────────────

export type OAuth1Principal = { token: Row; app: OAuth1App };

/** A request signed with an access token this pack issued and has not revoked; null otherwise. */
export function verifyUserContext(req: SignedCall, resources: readonly Row[]): OAuth1Principal | null {
  const signed = signedRequestOf(req);
  if (signed.header.length === 0) return null;
  const params = oauth1Params(signed);
  if (!wellFormed(params)) return null;
  const token = resources.find((r) => r.type === '_oauth1_token' && r.id === params.get('oauth_token')) as Row | undefined;
  if (!token || token.revoked === true || token.consumerKey !== params.get('oauth_consumer_key')) return null;
  const app = oauth1AppOf(resources, String(token.consumerKey));
  if (!app) return null;
  return signatureMatches(signed, app.secret, String(token.secret)) ? { token, app } : null;
}

/** The OAuth 2.0 scopes an OAuth 1.0a token's permission level stands for on a v2 endpoint that
 *  declares both schemes (the OpenAPI's `security` lists OAuth2UserToken scopes OR UserToken). */
export function scopesOfAccessLevel(level: unknown): string[] {
  // a Read App reads what an account's public surface shows, who liked a post included (an auto-repost rule reads
  // its likers with a read-write App's token); a read-write App also writes. Where the documentation stops: X documents
  // the permission levels in words, not as OAuth 2.0 scopes, so the reads are tweet, users and like, the writes tweet,
  // media and like
  return level === 'read' ? ['tweet.read', 'users.read', 'like.read'] : ['tweet.read', 'users.read', 'like.read', 'tweet.write', 'media.write', 'like.write'];
}

// ── the request as a handler reads it ─────────────────────────────────────────────────────────

/** An X answer as a Response: a string body (a page, a form-encoded OAuth 1.0a leg, a redirect's empty body) as it is,
 *  served as HTML unless it names its type; anything else as JSON. */
export function send(x: XResponse): Response {
  if (x.page) return x.page;
  const headers: Record<string, string> = { ...(x.headers ?? {}) };
  if (typeof x.body === 'string') {
    if (!headers['content-type'] && x.body) headers['content-type'] = 'text/html; charset=utf-8';
    return new Response(x.body, { status: x.status, headers });
  }
  headers['content-type'] ??= 'application/json; charset=utf-8';
  return new Response(JSON.stringify(x.body), { status: x.status, headers });
}

/** Rows of one type as the store holds them, the deleted included (a mint counts every row ever held). */
export const rowsFor = (ctx: HandlerContext): Rows => (type) => ctx.rowsRaw(type, { withDeleted: true }) as Row[];

/** The World clock's reading for this request, in seconds (X's `expires_in`, a rate window's reset). */
export const nowSeconds = (ctx: HandlerContext): number => Math.floor(Date.parse(ctx.occurredAt) / 1000);

/** X's own hosts: a request that names one is a call as a client makes it, answered with X's own URLs. */
const X_OWN_HOSTS = new Set(['x.com', 'twitter.com', 'api.x.com', 'api.twitter.com', 'www.x.com', 'www.twitter.com']);

/** The X host a request was made to, when it was: the host the World's proxy names (x-volter-twin-original-host, kept
 *  when the injector's proxy forwards a browser's request for x.com) or the request's own; undefined for the twin's own
 *  address and a World's place (whose front names no vendor host). */
export function xHostOf(request: Request): string | undefined {
  const host = (request.headers.get('x-volter-twin-original-host') ?? new URL(request.url).hostname).toLowerCase().replace(/:\d+$/, '');
  return X_OWN_HOSTS.has(host) ? host : undefined;
}

/** Where a request reached the twin (its public base, a World mount included), or undefined on X's own hosts. */
export const originOf = (ctx: Pick<HandlerContext, 'call' | 'publicBase'>): string | undefined => (xHostOf(ctx.call.request) ? undefined : ctx.publicBase.replace(/\/+$/, ''));

/** The request as a signature check reads it. */
export function signedCall(ctx: HandlerContext): SignedCall {
  const url = new URL(ctx.call.request.url);
  const origin = originOf(ctx);
  return { method: ctx.call.request.method, path: url.pathname + url.search, body: ctx.text, headers: headersOf(ctx.call.request), ...(origin !== undefined ? { origin } : {}) };
}

/** A request's headers, lower-cased. */
export function headersOf(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  request.headers.forEach((value, key) => { out[key.toLowerCase()] = value; });
  return out;
}

export type Write = { resource: string; id: string; fields: Record<string, unknown>; operation: string };

/** One subject written: bookkeeping (`_`) through `ctx.record`, which journals no request, anything else through
 *  `ctx.write`. */
export async function put(ctx: HandlerContext, resource: string, id: string, fields: Record<string, unknown>, operation: string): Promise<void> {
  if (resource.startsWith('_')) await ctx.record(resource, fields, id, operation);
  else await ctx.write(resource, id, fields, operation);
}

/** `put`, with the subject's next `rev`. */
export function putRev(ctx: HandlerContext, resource: string, id: string, fields: Record<string, unknown>, operation: string): Promise<void> {
  return put(ctx, resource, id, { ...fields, rev: nextRevIn(rowsFor(ctx)(resource), resource, id) }, operation);
}

/** Check the credential decision, then persist its named move without the secret-bearing request. */
export async function decide<T>(ctx: HandlerContext, decision: (rows: Rows) => { value: T; write?: Write }): Promise<T> {
  const d = decision(rowsFor(ctx));
  if (d.write) await put(ctx, d.write.resource, d.write.id, d.write.fields, d.write.operation);
  return d.value;
}

/** Whether the (client, user) grant still stands: revoked, it holds no scope; a credential with no grant row stands
 *  alone. */
export function grantStands(rows: Rows, clientId: string, sub: string): boolean {
  const grant = rows('_grant').find((r) => r.id === `${clientId}:${sub}`);
  return !grant || (Array.isArray(grant.scopes) && grant.scopes.length > 0);
}

const PROBLEM = { ...NOSTORE, 'content-type': 'application/problem+json' };





/**
 * An OAuth 1.0a token whose App permission does not reach the endpoint (a Read-only token posting).
 * X's v2 answers this with its own problem type rather than the scope wording. The vendored document
 * does not list it, and names every problem type it does list under https://api.x.com/2/problems/
 * (resource-not-found and invalid-request among them), so this one takes the same prefix: one
 * vendor, one problem namespace, over the older api.twitter.com form the reports quote. The name and
 * the detail are the widely-reported wire strings, not a fetched page — EXTRAPOLATION, pinned by
 * `x.auth.oauth1_permissions_wording`.
 */
export function oauth1PermissionsProblem(): XResponse {
  return {
    status: 403,
    body: {
      title: 'Forbidden',
      type: 'https://api.x.com/2/problems/oauth1-permissions',
      status: 403,
      detail: 'Your client app is not configured with the appropriate oauth1 app permissions for this endpoint.',
    },
    headers: { ...PROBLEM },
  };
}



/**
 * A named resource the request addressed does not exist — X's `resource-not-found` problem,
 * which carries the offending value/resource_type rather than the bare about:blank form. Its
 * `type` is the spec's (spec:/components/schemas/ResourceNotFoundProblem/properties/type, whose
 * one value is https://api.x.com/2/problems/resource-not-found). Wording pinned by
 * `x.errors.resource_not_found_wording`.
 */
export function resourceNotFoundError(value: string, resourceType: 'tweet' | 'user', parameter: string): Record<string, unknown> {
  return {
    parameter,
    resource_id: value,
    value,
    detail: `Could not find ${resourceType} with ${parameter}: [${value}].`,
    title: 'Not Found Error',
    resource_type: resourceType,
    type: 'https://api.x.com/2/problems/resource-not-found',
  };
}

export function resourceNotFoundProblem(value: string, resourceType: 'tweet' | 'user', parameter: string): XResponse {
  return {
    status: 404,
    body: { errors: [resourceNotFoundError(value, resourceType, parameter)] },
    headers: { ...NOSTORE, 'content-type': 'application/json' },
  };
}

/**
 * THE LOOKUP ENVELOPE, and why its status differs from the refusal above. X's *lookup* endpoints
 * (`GET /2/tweets`, `GET /2/tweets/:id`) answer PARTIALLY: a request for five ids where two are
 * missing has to return the three that exist AND say what happened to the other two, so the
 * missing ones ride in a sibling `errors` array under HTTP 200 rather than turning the whole
 * request into a 404. The bulk route FORCES that model — there is no other way to express a
 * partial result — and X applies the same envelope to the single-id route. What matters for this
 * twin, and what its verifies assert, is the half that is not a status: a `data` entry is NEVER
 * fabricated for an id nobody created; the id comes back inside `errors`, by name.
 *
 * The exact `detail`/`title` WORDING is unpinned by this build, same boundary as every other
 * envelope here (`x.errors.resource_not_found_wording`).
 */
export function lookupResult(data: unknown, errors: Array<Record<string, unknown>>, includes?: Record<string, unknown>): XResponse {
  const body: Record<string, unknown> = {};
  if (data !== undefined) body.data = data;
  if (includes !== undefined && Object.keys(includes).length > 0) body.includes = includes;
  if (errors.length > 0) body.errors = errors;
  return { status: 200, body, headers: { ...NOSTORE, 'content-type': 'application/json' } };
}





// ── the scopes an operation needs ────────────────────────────────────────────────────────────────────
// Not listed here: they are the spec's own per-operation `security` (../spec/openapi.json.gz, read onto each operation of
// ./generated/surface.gen.json), which the handlers ask (scopeRefusal, below), against X's one catalog (SCOPE_CATALOG,
// above).

export function missingScopes(held: readonly string[], required: readonly string[]): string[] {
  return required.filter((scope) => !held.includes(scope));
}

// ── the state and the request ───────────────────────────────────────────────────────────────────────────
// What every X operation shares: the store as the handlers read it, X's answers in their wire form, the query a
// request may carry, and where a request is reached from (the base its media URLs are minted on).

export type Resource = Record<string, any>;



/** A 200 with X's JSON body. */
export function ok(body: unknown, headers: Record<string, string> = {}): XResponse {
  return { status: 200, body, headers: { 'content-type': 'application/json', ...headers } };
}

export const isAnswer = (value: unknown): value is XResponse => typeof value === 'object' && value !== null && 'status' in value && 'body' in value && typeof (value as XResponse).status === 'number';

// ── the store ────────────────────────────────────────────────────────────────────────────────
// A handler reads the pack's whole tree once per request (every type: X draws accounts and posts from one id space),
// through its context.

export const ofType = (all: Resource[], type: string): Resource[] => all.filter((r) => r.type === type);
export const livePosts = (all: Resource[]): Resource[] => ofType(all, 'post').filter((p) => p.deleted !== true);
export const findPost = (all: Resource[], id: string): Resource | undefined => livePosts(all).find((p) => String(p.id) === id);
export const findAccount = (all: Resource[], id: string): Resource | undefined => ofType(all, 'account').find((a) => String(a.id) === id);

/** The subject types a handler reads, from one id space (accounts, posts and the follow graph; the armed rate refusal
 *  the front reads). */
const TYPES = ['account', 'post', 'poll', 'rate_limit', 'article', 'like', 'repost', 'bookmark', '_impressions', '_card'] as const;

/** The pack's state as the request finds it, every type a handler reads, each row carrying its type. */
export function tree(ctx: HandlerContext): Resource[] {
  return TYPES.flatMap((type) => ctx.rowsRaw(type, { withDeleted: true }).map((r) => ({ ...ctx.own(r), id: String(ctx.own(r).id ?? r.id), type, ...(r.deleted === true ? { deleted: true } : {}) })));
}

/** Newest first, by snowflake id — X orders every timeline by id, not by a parsed timestamp. */
export function newestFirst(posts: Resource[]): Resource[] {
  return [...posts].sort((a, b) => (BigInt(String(b.id)) > BigInt(String(a.id)) ? 1 : -1));
}

/** X's object ids are snowflakes from ONE space (an account, a post, a poll, an Article and an upload never share an
 *  id): the kernel's mint under the manifest's `{snowflake:<X's epoch>}` rule, the World's instant shifted past every id
 *  of those types already held, so a minted id never meets one pulled from X or seeded with its own id. */
export function mintSnowflakeId(ctx: HandlerContext, resource = 'Post'): string {
  return ctx.mint(resource);
}

// ── the request ──────────────────────────────────────────────────────────────────────────────

export function csv(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined) return [];
  return raw.split(',').map((v) => v.trim()).filter((v) => v !== '');
}

/** The request's URL. */
export const urlOf = (ctx: HandlerContext): URL => new URL(ctx.call.request.url);

/** The descriptor's gap answer for the unserved PIN flow. */
// Where the documentation stops: this is the descriptor's documented not-found class for an unserved flow; the detail is the twin's.
export const GAP: XResponse = { status: 404, body: { title: 'Not Found Error', type: 'about:blank', status: 404, detail: 'Not Found' }, headers: { ...NOSTORE, 'content-type': 'application/problem+json' } };


/** A query parameter the operation's spec does not have is X's invalid request, naming the parameters it does have
 *  (a lenient twin hides a stale or wrong call: docs/contributing/architecture.md, "Rules the lives have taught the
 *  twins"). Where the documentation stops: X's words for it are the twin's, in X's invalid-request form. */
export function unknownQuery(ctx: HandlerContext): XResponse | undefined {
  const op = ctx.call.operation as { query?: Array<{ name: string }>; pathParams?: string[] };
  const declared = (op.query ?? []).map((q) => q.name);
  for (const [name, value] of urlOf(ctx).searchParams) {
    if (!declared.includes(name)) return undeclaredParameter(op, declared, name, value);
  }
  return undefined;
}

/** A query parameter the operation does not have, refused naming those it does: its path parameters and its query
 *  parameters by the wire's names (`tweet.fields`, never the document's `post.fields` beside it, which the read
 *  projection reads too). */
function undeclaredParameter(op: { pathParams?: string[] }, declared: string[], name: string, value: string): XResponse {
  const named = [...(op.pathParams ?? []), ...declared.filter((q) => q !== 'post.fields')];
  return invalidRequestProblem({ [name]: [value] }, `The query parameter [${name}] is not one of [${named.join(',')}]`);
}

/** The JSON object a request's body is (an absent body is `{}`); the refusal of one that is not a JSON object is
 *  answered before dispatch (../fetch.ts). */
export function payloadOf(ctx: HandlerContext): Record<string, any> {
  return ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Record<string, any>) : {};
}

/** The hosts X serves media from — what a request that names X's own API host is answered with: images and video
 *  thumbnails on pbs.twimg.com, video files on video.twimg.com. Served over HTTP otherwise, every one is where this
 *  twin is reached instead (../server.ts serves the same paths). */
export const PBS_BASE = 'https://pbs.twimg.com';
export const VIDEO_BASE = 'https://video.twimg.com';
const X_API_HOSTS = new Set(['api.x.com', 'api.twitter.com']);

/** Where the request reached this twin (the context's `publicBase`), for the URLs it mints; undefined for a request that
 *  names X's own API host in its URL (an in-process call as a client makes it), which is answered with X's own media
 *  hosts. */
export function publicBaseOf(ctx: HandlerContext): string | undefined {
  const url = new URL(ctx.call.request.url);
  return X_API_HOSTS.has(url.hostname.toLowerCase()) ? undefined : ctx.publicBase.replace(/\/+$/, '');
}

// ── who is calling ──────────────────────────────────────────────────────────────────────────────────────
// Who a request acts for, and whether its grant reaches the operation.
//
// X takes two credentials on the /2 surface (the spec's security: `OAuth2UserToken` with the operation's scopes, or
// `UserToken`, OAuth 1.0a User Context), both issued by X's own authorization server, which is this pack:
//   - a bearer: an OAuth 2.0 access token the authorization server issued (the token endpoint, ./oauth2.ts), or one a
//     World recorded for an account at its door (`POST /_twin/tokens`, ./doors.ts) — the same `_access_token` row,
//     kept by its SHA-256, never as itself;
//   - an OAuth 1.0a signature over an access token the three legs issued (./oauth.ts). OAuth 1.0a has no scopes: the
//     App's permission level stands for them.
// The front (./around.ts) resolves the caller and names it to the handler in CALLER_HEADER; a handler checks the
// operation's scopes and the query (`opening`). An absent, malformed or unknown credential is X's about:blank 401. A
// grant that does not hold every scope the operation's spec names (the spec's `security`, read onto each operation of
// the surface) is X's 403: the scope problem for a bearer, the oauth1-permissions problem for a signed request.

/** `plan` is the developer plan of the App the grant was issued to (`self-serve` unless the App was registered on X's
 *  Enterprise plan, ./doors.ts); x.com's own client is `firstParty`, no App at all. */
export type Caller = { accountId: string; scopes: string[]; oauth1?: true; firstParty?: true; plan?: string };

/** The header the front (./around.ts) names the caller it resolved in; it strips the header from every request it is
 *  sent, so only its own resolution reaches a handler. */
export const CALLER_HEADER = 'x-volter-x-caller';

/** Who a request acts for and the scopes its grant holds, over the rows it is resolved in (a request's tree, or the rows
 *  inside an atomic decision); X's 401 when its credential names nobody. */
export function callerOf(ctx: HandlerContext, rows: Rows = rowsFor(ctx)): Caller | XResponse {
  const header = ctx.call.request.headers.get('authorization') ?? '';
  if (/^oauth\s/i.test(header)) {
    const who = verifyUserContext(signedCall(ctx), [...rows('_oauth1_token'), ...rows('oauth1_app')]);
    return who ? { accountId: String(who.token.userId), scopes: scopesOfAccessLevel(who.token.accessLevel), oauth1: true, plan: String(rows('oauth1_app').find((row) => row.id === who.token.consumerKey)?.plan ?? 'self-serve') } : unauthorizedProblem();
  }
  const bearer = /^bearer\s+(.+)$/i.exec(header.trim())?.[1]?.trim();
  const token = bearer ? credentialRow(rows, 'access', bearer)?.row : undefined;
  if (!token || token.revoked === true || (typeof token.expiresAt === 'number' && nowSeconds(ctx) >= token.expiresAt)) return unauthorizedProblem();
  return { accountId: String(token.sub), scopes: parseScopeParam(String(token.scope ?? '')), plan: String(rows('oauth_client').find((row) => row.id === token.clientId)?.plan ?? 'self-serve') };
}

/** The operation's refusal of a grant that does not hold every scope its spec names, or nothing. */
export function scopeRefusal(ctx: HandlerContext, caller: Caller): XResponse | undefined {
  const required = (ctx.call.operation as { scopes?: string[] }).scopes ?? [];
  const missing = missingScopes(caller.scopes, required);
  if (missing.length === 0) return undefined;
  return caller.oauth1 ? oauth1PermissionsProblem() : forbiddenProblem(`This request requires the ${missing.join(', ')} scope(s), which this token does not hold.`);
}

/** What every handler starts from: the state, who is calling (the front's verification; X's 401 otherwise), that the
 *  grant holds the operation's scopes (X's 403 otherwise), and that the query names only the operation's parameters. */
export function opening(ctx: HandlerContext): { all: Resource[]; caller: Caller; publicBase: string | undefined } | XResponse {
  let caller: Caller | undefined;
  try { caller = JSON.parse(ctx.call.request.headers.get(CALLER_HEADER) ?? 'null') as Caller | undefined; } catch { caller = undefined; }
  if (!caller || typeof caller.accountId !== 'string') return unauthorizedProblem();
  const refusal = scopeRefusal(ctx, caller) ?? unknownQuery(ctx);
  if (refusal) return refusal;
  return { all: tree(ctx), caller, publicBase: publicBaseOf(ctx) };
}

// ── the read projection ─────────────────────────────────────────────────────────────────────────────────
// How a stored post, account and media object become X's answer: the fields a read asks for, the `includes` sidecar
// its expansions fill, the window and page a timeline read selects, and the search grammar the twin models.
//
// FIELD PROJECTION IS NOT DECORATION. X returns `id`, `text` and `edit_history_tweet_ids` and NOTHING ELSE unless the
// caller asks: `author_id`, `created_at`, `conversation_id`, `referenced_tweets` and the rest arrive only under
// `tweet.fields`, and related objects only under `expansions`. A twin that returns everything always is not more
// generous, it is wrong: an integrator whose client forgets `tweet.fields` passes here and breaks in production. So the
// default projection is the vendor's three fields, and `projectPost` is the ONE place a stored post becomes a body.
//
// THE SHAPED SETS below are the values of X's documented lists (spec/openapi.json.gz after spec/patches.json:
// PostFieldsParameter, PostExpansionsParameter, UserFieldsParameter, MediaFieldsParameter, UserExpansionsParameter,
// PlaceFieldsParameter) that the twin holds state for. Every other documented value is the manifest's variant
// (../manifest.ts, each list cited to its enum), answered the gap before a handler runs, never silently omitted: a
// caller that asked for `geo` and got a post without it cannot tell "this twin does not model places" from "this post
// has none". So a value a handler sees outside its shaped set is one X does not document: X's invalid request.
//
// THE PARAMETER'S NAME. The vendor documents a Post's fields as `tweet.fields`, the name its clients send
// (twitter-api-v2); the vendored document names the same parameter `post.fields`, which X's own
// @xdevplatform/xdk sends. A read takes either, and both at once as one list.
//
// DETERMINISM. Every read is a pure function of (request, stored state): `created_at` is what the write stored, and the
// `next_token` a page hands back is derived from the id of its last row, never from entropy or time.

/** The Post fields the twin holds state for. `id`, `text` and `edit_history_tweet_ids` are in X's DEFAULT projection and
 *  are served whether or not they are asked for, exactly as at the vendor. */
const TWEET_FIELDS_MODELLED = new Set([
  'attachments', 'author_id', 'conversation_id', 'created_at', 'edit_history_tweet_ids', 'id', 'in_reply_to_user_id', 'paid_partnership', 'public_metrics', 'referenced_tweets', 'text',
]);

const EXPANSIONS_MODELLED = new Set(['attachments.media_keys', 'attachments.poll_ids', 'author_id', 'in_reply_to_user_id', 'referenced_tweets.id', 'referenced_tweets.id.author_id']);

/** An expansion RETURNS its source field on the post as well as the expanded object in `includes`: asking to expand
 *  `author_id` and getting back a post with no `author_id` would leave the sidecar unjoinable. */
const EXPANSION_IMPLIES_FIELD: Record<string, string> = {
  'attachments.media_keys': 'attachments',
  'attachments.poll_ids': 'attachments',
  author_id: 'author_id',
  in_reply_to_user_id: 'in_reply_to_user_id',
  'referenced_tweets.id': 'referenced_tweets',
  'referenced_tweets.id.author_id': 'referenced_tweets',
};

/** What an uploaded image or video has state for: a photo's `url`, `width`, `height`; a video's `duration_ms`,
 *  `preview_image_url` and `variants` (whose answer for a photo is X's own: absent). `alt_text` (the metadata
 *  endpoint) and every metrics field have no state here: the manifest's variants. */
const MEDIA_FIELDS_MODELLED = new Set(['duration_ms', 'height', 'media_key', 'preview_image_url', 'type', 'url', 'variants', 'width']);

/** The User fields the twin holds state for: what `/_twin/accounts` seeds (`confirmed_email` answered only to a grant
 *  holding `users.email`). `public_metrics` is NOT here: two of its counts (listed, like) have no state behind them, and a
 *  zero the twin cannot know is a fabrication. */
const USER_FIELDS_MODELLED = new Set([
  'confirmed_email', 'created_at', 'description', 'id', 'location', 'name', 'profile_image_url', 'protected', 'url', 'username', 'verified',
  'verified_type',
]);

/** The picture X shows for an account that never uploaded one: every X account has a `profile_image_url`, and this is
 *  its value until the person sets a photo. The twin answers this URL and its other sizes on abs.twimg.com with a PNG of
 *  X's silhouette (../server.ts); a photo a person set is not served (x.web.profile_photo). */
export const X_DEFAULT_PROFILE_IMAGE_URL = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';

export type ReadShape = { fields: Set<string>; expansions: Set<string>; userFields: Set<string>; mediaFields: Set<string>; pollFields?: Set<string>; publicBase: string };

export const isFieldSet = (value: Set<string> | XResponse): value is Set<string> => value instanceof Set;

/** `user.fields` off the query string, refused the way `tweet.fields` is. */
export function parseUserFields(url: URL): Set<string> | XResponse {
  const userFields = new Set<string>();
  for (const value of csv(url.searchParams.get('user.fields'))) {
    if (!USER_FIELDS_MODELLED.has(value)) return undocumentedValue('user.fields', value, 'User fields');
    userFields.add(value);
  }
  return userFields;
}

/** The list parameters a read takes: each an array of at least one of its enum's values (the spec's schema of each,
 *  UserFieldsParameter's for one, says minItems 1), so an empty one is invalid. */
// source: spec:/components/parameters/UserFieldsParameter "A comma separated list of User fields to display."
const FIELD_LISTS = ['tweet.fields', 'post.fields', 'expansions', 'user.fields', 'media.fields', 'poll.fields', 'place.fields'];

/** A list parameter sent empty (`user.fields=`): X's invalid request, as for any value outside the parameter's enum. */
function emptyFieldList(name: string): XResponse {
  return invalidRequestProblem({ [name]: [''] }, `The \`${name}\` query parameter value [] is not one of the documented values: it must name at least one`);
}

/** A Post's fields, sent as `tweet.fields` or `post.fields` (above). */
function postFieldValues(url: URL): Array<[string, string]> {
  return [...csv(url.searchParams.get('tweet.fields')).map((v) => ['tweet.fields', v] as [string, string]), ...csv(url.searchParams.get('post.fields')).map((v) => ['post.fields', v] as [string, string])];
}

/** `tweet.fields`, `expansions`, `user.fields` and `media.fields` off the query string, or X's refusal. */
export function parseReadShape(url: URL, publicBase: string): ReadShape | XResponse {
  const empty = FIELD_LISTS.find((name) => url.searchParams.has(name) && url.searchParams.get(name)!.trim() === '');
  if (empty !== undefined) return emptyFieldList(empty);
  const fields = new Set<string>();
  for (const [parameter, value] of postFieldValues(url)) {
    if (!TWEET_FIELDS_MODELLED.has(value)) return undocumentedValue(parameter, value, 'Post fields');
    fields.add(value);
  }
  const expansions = new Set<string>();
  for (const value of csv(url.searchParams.get('expansions'))) {
    if (!EXPANSIONS_MODELLED.has(value)) return undocumentedValue('expansions', value, 'Post expansions');
    expansions.add(value);
    const implied = EXPANSION_IMPLIES_FIELD[value];
    if (implied !== undefined) fields.add(implied);
  }
  // `user.fields` shapes the users in `includes`, with the same closed-set refusal as the user lookups: one parser, so
  // the two can never disagree about a field
  const userFields = parseUserFields(url);
  if (!isFieldSet(userFields)) return userFields;
  const mediaFields = new Set<string>();
  for (const value of csv(url.searchParams.get('media.fields'))) {
    if (!MEDIA_FIELDS_MODELLED.has(value)) return undocumentedValue('media.fields', value, 'Media fields');
    mediaFields.add(value);
  }
  const pollFields = new Set(csv(url.searchParams.get('poll.fields')));
  for (const field of pollFields) if (!POLL_FIELDS.has(field)) return undocumentedValue('poll.fields', field, 'Poll fields');
  // no post carries a place: every Place field X documents is the manifest's variant
  for (const value of csv(url.searchParams.get('place.fields'))) return undocumentedValue('place.fields', value, 'Place fields');
  return { fields, expansions, userFields, mediaFields, pollFields, publicBase };
}

// source: spec:/components/parameters/PollFieldsParameter "A comma separated list of Poll fields to display."
const POLL_FIELDS = new Set(['duration_minutes', 'end_datetime', 'id', 'options', 'voting_status']);

/** A poll as `includes.polls` carries it: the fields asked for, or every one. */
function projectPoll(row: Resource, fields?: Set<string>): Record<string, unknown> {
  const selected = fields?.size ? [...fields] : [...POLL_FIELDS];
  return Object.fromEntries(selected.map((field) => [field, row[field]]));
}

/** A value no list of X's documents for a field-selection parameter (`tweet.fields`, `expansions`, …). */
function undocumentedValue(parameter: string, value: string, list: string): XResponse {
  return invalidRequestProblem({ [parameter]: [value] }, `The \`${parameter}\` query parameter value [${value}] is not one of the documented ${list}`);
}

export const isShape = (value: ReadShape | XResponse): value is ReadShape => !('status' in value);

/** A user lookup's `expansions` and `tweet.fields`: X documents three user expansions (a pinned post, the most recent
 *  post, an affiliation), none modelled, and with none there is no expanded post for `tweet.fields` to shape, so every
 *  documented value of either is the manifest's variant; a value that reaches here is none of X's. */
export function parseUserLookup(url: URL): Set<string> | XResponse {
  for (const value of csv(url.searchParams.get('expansions'))) return undocumentedValue('expansions', value, 'User expansions');
  for (const parameter of ['tweet.fields', 'post.fields']) {
    for (const value of csv(url.searchParams.get(parameter))) return undocumentedValue(parameter, value, 'Post fields');
  }
  return parseUserFields(url);
}

export const isUserFields = isFieldSet;

/** THE ONE PLACE a stored post becomes a response body. Default projection = X's three fields. */
export function projectPost(post: Resource, fields: Set<string>, all: Resource[]): Record<string, unknown> {
  void all;
  const out: Record<string, unknown> = { id: String(post.id), text: String(post.text), edit_history_tweet_ids: post.edit_history_tweet_ids ?? [String(post.id)] };
  if (fields.has('public_metrics')) out.public_metrics = { ...emptyPublicMetrics(), ...(post.public_metrics as Record<string, number> | undefined) };
  if (fields.has('author_id') && post.author_id !== undefined) out.author_id = String(post.author_id);
  if (fields.has('created_at') && post.created_at !== undefined) out.created_at = String(post.created_at);
  if (fields.has('conversation_id') && post.conversation_id !== undefined) out.conversation_id = String(post.conversation_id);
  if (fields.has('in_reply_to_user_id') && post.in_reply_to_user_id !== undefined) out.in_reply_to_user_id = String(post.in_reply_to_user_id);
  if (fields.has('referenced_tweets') && Array.isArray(post.referenced_tweets) && post.referenced_tweets.length > 0) out.referenced_tweets = post.referenced_tweets;
  if (fields.has('paid_partnership') && post.paid_partnership !== undefined) out.paid_partnership = post.paid_partnership;
  // X serves `attachments` only on a post that has some: a text-only post carries no empty object
  const mediaKeys = (post.attachments as { media_keys?: string[] } | undefined)?.media_keys ?? attachedMedia(post).map((m) => m.media_key);
  const pollIds = (post.attachments as { poll_ids?: string[] } | undefined)?.poll_ids;
  if (fields.has('attachments') && (mediaKeys.length > 0 || pollIds?.length)) out.attachments = { ...(mediaKeys.length ? { media_keys: mediaKeys } : {}), ...(pollIds?.length ? { poll_ids: pollIds } : {}) };
  return out;
}

/** A post's public metrics are stored on it, moved by the write that changes each (a reply, a quote, a repost, the
 *  audience's like, bookmark or views at the engagement door, ./doors.ts), so a post observed from X keeps the counts X
 *  answered and a World's own engagement adds to them. The wire's names (https://docs.x.com/x-api/fundamentals/metrics,
 *  spec/patches.json: `retweet_count`, not the document's `repost_count`). */
// source: spec:/components/schemas/PostPublicMetrics "Engagement metrics for the Post at the time of the request."
export function emptyPublicMetrics(): Record<string, number> {
  return { retweet_count: 0, reply_count: 0, like_count: 0, quote_count: 0, bookmark_count: 0, impression_count: 0 };
}

/** The counters a World's move changes, written on the post it moves. */
export async function adjustPostMetrics(ctx: HandlerContext, postId: string, deltas: Record<string, number>): Promise<void> {
  const id = ctx.resolve('post', postId);
  const post = ctx.get('post', id);
  if (!post) return;
  const metrics = { ...emptyPublicMetrics(), ...(post.public_metrics as Record<string, number> | undefined) };
  for (const [field, delta] of Object.entries(deltas)) metrics[field] = (metrics[field] ?? 0) + delta;
  await ctx.write('post', id, { public_metrics: metrics }, 'x.post.metrics');
}

/** One image or video a post carries, as its entry recorded it when it was made (./posts.ts). */
export type AttachedMedia = {
  media_key: string; media_id: string; type: 'photo' | 'video'; media_type: string; media_category: string; sha256: string; size: number;
  width?: number; height?: number; duration_ms?: number;
};

export function attachedMedia(post: Resource): AttachedMedia[] {
  return Array.isArray(post.media) ? (post.media as AttachedMedia[]).filter((m) => m && typeof m.media_key === 'string') : [];
}

/** THE ONE PLACE an attached image or video becomes an `includes.media` object. Default = X's two fields. */
function projectMedia(media: AttachedMedia, mediaFields: Set<string>, publicBase: string): Record<string, unknown> {
  const out: Record<string, unknown> = { media_key: media.media_key, type: media.type };
  // `url` is a photo's; a video answers with `preview_image_url` instead. The path is pbs.twimg.com's
  // `/media/<name>.<ext>`, served by this twin (../server.ts) from the context's blobs.
  if (mediaFields.has('url') && media.type === 'photo') out.url = `${publicBase}/media/${media.sha256}.${mediaExtension(media.media_type)}`;
  if (mediaFields.has('width') && typeof media.width === 'number') out.width = media.width;
  if (mediaFields.has('height') && typeof media.height === 'number') out.height = media.height;
  if (media.type === 'video') {
    // video.twimg.com's `/ext_tw_video/<id>/pu/vid/avc1/<w>x<h>/<name>.mp4` and pbs's `/ext_tw_video_thumb/<id>/pu/img/<name>.<ext>`
    const videoBase = publicBase === PBS_BASE ? VIDEO_BASE : publicBase;
    const file = `${videoBase}/ext_tw_video/${media.media_id}/pu/vid/avc1/${media.width ?? 0}x${media.height ?? 0}/${media.sha256}.mp4`;
    if (mediaFields.has('duration_ms') && typeof media.duration_ms === 'number') out.duration_ms = media.duration_ms;
    if (mediaFields.has('preview_image_url')) out.preview_image_url = `${publicBase}/ext_tw_video_thumb/${media.media_id}/pu/img/${media.sha256}.svg`;
    if (mediaFields.has('variants')) {
      // ONE variant: the file as uploaded. X transcodes to an HLS playlist and several MP4 bit rates; the twin
      // transcodes nothing, so it lists the one rendition it holds, with the bit rate that file actually has (bytes
      // over duration), never an invented ladder.
      const bitRate = typeof media.duration_ms === 'number' && media.duration_ms > 0 ? Math.round((media.size * 8 * 1000) / media.duration_ms) : undefined;
      out.variants = [{ ...(bitRate !== undefined ? { bit_rate: bitRate } : {}), content_type: 'video/mp4', url: file }];
    }
  }
  return out;
}

/** THE ONE PLACE a stored account becomes a user object. Default projection = X's three fields; every other field
 *  only when asked for, and only when the twin holds state for it. */
export function projectUser(account: Resource, userFields: Set<string>, all: Resource[], heldScopes: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = { id: String(account.id), name: String(account.name ?? account.username), username: String(account.username) };
  if (userFields.has('created_at') && typeof account.created_at === 'string') out.created_at = account.created_at;
  if (userFields.has('description')) out.description = typeof account.description === 'string' ? account.description : '';
  if (userFields.has('location') && typeof account.location === 'string' && account.location !== '') out.location = account.location;
  if (userFields.has('url')) out.url = typeof account.url === 'string' ? account.url : '';
  if (userFields.has('profile_image_url')) {
    out.profile_image_url = typeof account.profile_image_url === 'string' && account.profile_image_url !== '' ? account.profile_image_url : X_DEFAULT_PROFILE_IMAGE_URL;
  }
  if (userFields.has('protected')) out.protected = account.protected === true;
  if (userFields.has('verified')) out.verified = account.verified === true;
  if (userFields.has('verified_type') && typeof account.verified_type === 'string') out.verified_type = account.verified_type;
  // X serves `confirmed_email` only to a grant holding `users.email` (X's April-2025 announcement; the scopes above).
  // Omitting it otherwise is the twin's reading, where the documentation stops
  if (userFields.has('confirmed_email') && typeof account.confirmed_email === 'string' && heldScopes.includes('users.email')) out.confirmed_email = account.confirmed_email;
  return out;
}

/** The `includes` sidecar for a page of posts. Ordering is FIXED (users by id ascending, tweets by id descending, the
 *  same order the page itself uses) so two identical requests over identical state serve identical bytes. */
export function buildIncludes(rows: Resource[], all: Resource[], shape: ReadShape): Record<string, unknown> {
  const includes: Record<string, unknown> = {};
  const userIds = new Set<string>();
  const tweetIds = new Set<string>();
  for (const post of rows) {
    if (shape.expansions.has('author_id') && post.author_id !== undefined) userIds.add(String(post.author_id));
    if (shape.expansions.has('in_reply_to_user_id') && post.in_reply_to_user_id !== undefined) userIds.add(String(post.in_reply_to_user_id));
    if (!Array.isArray(post.referenced_tweets)) continue;
    for (const reference of post.referenced_tweets) {
      const referencedId = String((reference as Record<string, unknown>)?.id ?? '');
      if (referencedId === '') continue;
      if (shape.expansions.has('referenced_tweets.id')) tweetIds.add(referencedId);
      if (shape.expansions.has('referenced_tweets.id.author_id')) {
        const referenced = findPost(all, referencedId);
        if (referenced?.author_id !== undefined) userIds.add(String(referenced.author_id));
      }
    }
  }
  const tweets = [...tweetIds]
    .map((id) => findPost(all, id))
    .filter((p): p is Resource => p !== undefined)
    .sort((a, b) => (BigInt(String(b.id)) > BigInt(String(a.id)) ? 1 : -1))
    .map((p) => projectPost(p, shape.fields, all));
  const users = [...userIds]
    .map((id) => findAccount(all, id))
    .filter((a): a is Resource => a !== undefined)
    .sort((a, b) => (BigInt(String(a.id)) > BigInt(String(b.id)) ? 1 : -1))
    .map((a) => projectUser(a, shape.userFields, all));
  if (tweets.length > 0) includes.tweets = tweets;
  if (users.length > 0) includes.users = users;
  // media in the order the page first mentions it, each key once
  if (shape.expansions.has('attachments.media_keys')) {
    const seen = new Set<string>();
    const media: Array<Record<string, unknown>> = [];
    for (const post of rows) {
      for (const m of attachedMedia(post)) {
        if (seen.has(m.media_key)) continue;
        seen.add(m.media_key);
        media.push(projectMedia(m, shape.mediaFields, shape.publicBase));
      }
    }
    if (media.length > 0) includes.media = media;
  }
  if (shape.expansions.has('attachments.poll_ids')) {
    const ids = new Set(rows.flatMap((post) => (post.attachments as { poll_ids?: string[] } | undefined)?.poll_ids ?? []));
    const polls = all.filter((row) => row.type === 'poll' && ids.has(String(row.id))).map((row) => projectPoll(row, shape.pollFields));
    if (polls.length) includes.polls = polls;
  }
  return includes;
}

// ── timeline windowing and paging ────────────────────────────────────────────────────────────

type Window = { startTime?: string; endTime?: string };

// an RFC 3339 date-time, its offset Z or numeric (dayjs sends +00:00)
// source: spec:/paths/~12~1users~1{id}~1tweets/get/parameters/3/schema/format "date-time"
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

// source: spec:/paths/~12~1users~1{id}~1tweets/get/parameters/3/description "Must be on or after 2010-11-06."
const EARLIEST_WINDOW = Date.parse('2010-11-06T00:00:00Z');

/** start_time / end_time. since_id and until_id, which no demand, life step or refresh asks, are the manifest's
 *  variants: the kernel answers them with the gap before the handler runs. */
function parseWindow(url: URL): Window | XResponse {
  const window: Window = {};
  for (const name of ['start_time', 'end_time'] as const) {
    const raw = url.searchParams.get(name);
    if (raw === null) continue;
    if (!ISO_8601.test(raw) || Number.isNaN(Date.parse(raw))) return malformedQuery(name, raw, 'is not a valid ISO 8601 date (YYYY-MM-DDTHH:mm:ssZ)');
    if (Date.parse(raw) < EARLIEST_WINDOW) return malformedQuery(name, raw, 'must be on or after 2010-11-06T00:00:00Z');
    window[name === 'start_time' ? 'startTime' : 'endTime'] = raw;
  }
  return window.startTime !== undefined && window.endTime !== undefined && Date.parse(window.startTime) >= Date.parse(window.endTime) ? windowReversed(window.startTime, window.endTime) : window;
}

/** A start_time no earlier than its end_time. Where the documentation stops: the rule is the spec's, the words of its
 *  refusal the twin's, in X's invalid-request form. */
// source: spec:getUsersPosts "must be earlier than"
function windowReversed(start: string, end: string): XResponse {
  return invalidRequestProblem({ start_time: [start], end_time: [end] }, `The \`start_time\` query parameter value [${start}] must be earlier than the \`end_time\` query parameter value [${end}]`);
}

/** A query value of a malformed shape (a time that is no date, a token the twin never issued, a size out of range, a
 *  value outside a parameter's list): X's invalid-request problem naming it. */
function malformedQuery(name: string, raw: string, says: string): XResponse {
  return invalidRequestProblem({ [name]: [raw] }, `The \`${name}\` query parameter value [${raw}] ${says}`);
}

const isWindow = (value: Window | XResponse): value is Window => !('status' in value);

export function applyWindow(posts: Resource[], window: Window): Resource[] {
  return posts.filter((post) => {
    const createdAt = typeof post.created_at === 'string' ? Date.parse(post.created_at) : Number.NaN;
    if (window.startTime !== undefined && !(createdAt >= Date.parse(window.startTime))) return false;
    if (window.endTime !== undefined && !(createdAt < Date.parse(window.endTime))) return false;
    return true;
  });
}

/** Where a page starts: past the post it names, toward the older (`before`, a `next_token`'s) or the newer (`after`, a
 *  `previous_token`'s). */
type Cursor = { before?: string; after?: string };

/** A pagination token that is a PURE FUNCTION OF STORED STATE: the id of the row at the page's edge and the direction
 *  away from it, opaque on the wire as X's is, carrying no clock and no entropy. */
// source: https://docs.x.com/x-api/fundamentals/pagination "Use to go back a page."
function encodeCursor(edgeId: string, direction: 'before' | 'after'): string {
  return Buffer.from(direction === 'before' ? `x:${edgeId}` : `x:after:${edgeId}`, 'utf8').toString('base64url');
}

/** `pagination_token`, or recent search's `next_token` (the same token: "The value used with the parameter is pulled
 *  directly from the response provided by the API", spec:searchPostsRecent). */
function parseCursor(url: URL): Cursor | XResponse {
  const name = url.searchParams.get('pagination_token') !== null ? 'pagination_token' : 'next_token';
  const raw = url.searchParams.get(name);
  if (raw === null || raw === '') return {};
  const match = /^x:(after:)?(\d+)$/.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!match) return malformedQuery(name, raw, 'is not a valid pagination token');
  return match[1] ? { after: match[2]! } : { before: match[2]! };
}

const isCursor = (value: Cursor | XResponse): value is Cursor => !('status' in value);

/** Page size. The timeline endpoints bound it 5..100; recent SEARCH bounds it 10..100. Both default to 10. Out of range
 *  is the invalid-request envelope, never a silent clamp. */
function parsePageSize(url: URL, min: number, max: number): number | XResponse {
  const raw = url.searchParams.get('max_results');
  if (raw === null) return 10;
  const parsed = Number(raw);
  return !Number.isInteger(parsed) || parsed < min || parsed > max ? malformedQuery('max_results', raw, `is not between ${min} and ${max}`) : parsed;
}

const isSize = (value: number | XResponse): value is number => typeof value === 'number';

/** A matched post set as the vendor's timeline envelope: the page, its `includes`, and the `meta` X serves. X OMITS
 *  `data` entirely on an empty page and answers with `meta` alone: a client that reads `response.data.length` breaks
 *  against the real vendor if the twin invents `[]`, so faithfulness here is the ABSENCE. */
export function timelinePage(matched: Resource[], all: Resource[], shape: ReadShape, size: number, cursor: Cursor): XResponse {
  const ordered = newestFirst(matched);
  const id = (p: Resource): bigint => BigInt(String(p.id));
  // a previous_token's page is the `size` posts just newer than its edge, newest first as every page is
  const page = cursor.after !== undefined
    ? ordered.filter((p) => id(p) > BigInt(cursor.after!)).slice(-size)
    : (cursor.before === undefined ? ordered : ordered.filter((p) => id(p) < BigInt(cursor.before!))).slice(0, size);
  if (page.length === 0) return ok({ meta: { result_count: 0 } });
  const rows = page.map((p) => projectPost(p, shape.fields, all));
  const includes = buildIncludes(page, all, shape);
  const meta: Record<string, unknown> = {
    result_count: rows.length,
    newest_id: String(page[0]!.id),
    oldest_id: String(page[page.length - 1]!.id),
  };
  // a next_token only when an older row exists, a previous_token only when a newer one does: an unconditional token
  // walks a client into an empty page forever
  if (ordered.some((p) => id(p) < id(page[page.length - 1]!))) meta.next_token = encodeCursor(String(page[page.length - 1]!.id), 'before');
  if (ordered.some((p) => id(p) > id(page[0]!))) meta.previous_token = encodeCursor(String(page[0]!.id), 'after');
  return ok({ data: rows, ...(Object.keys(includes).length > 0 ? { includes } : {}), meta });
}

/** Everything a timeline or search read needs off the query string, refused as one. */
export type ReadRequest = { shape: ReadShape; window: Window; size: number; cursor: Cursor };

export function parseReadRequest(url: URL, minSize: number, publicBase: string): ReadRequest | XResponse {
  const shape = parseReadShape(url, publicBase);
  if (!isShape(shape)) return shape;
  const window = parseWindow(url);
  if (!isWindow(window)) return window;
  const size = parsePageSize(url, minSize, 100);
  if (!isSize(size)) return size;
  const cursor = parseCursor(url);
  if (!isCursor(cursor)) return cursor;
  return { shape, window, size, cursor };
}

export const isReadRequest = (value: ReadRequest | XResponse): value is ReadRequest => !('status' in value);

/** `exclude` on a user's own and home timelines: "retweets" and "replies" (spec:getUsersPosts's `exclude` enum). The
 *  twin holds no reposts (repostPost is the gap), so excluding them leaves every post; excluding replies leaves the
 *  posts that answer no one. */
export function parseExclude(url: URL): Set<string> | XResponse {
  const out = new Set<string>();
  for (const value of csv(url.searchParams.get('exclude'))) {
    if (value !== 'retweets' && value !== 'replies') return malformedQuery('exclude', value, 'is not one of [replies,retweets]');
    out.add(value);
  }
  return out;
}

export const isReply = (post: Resource): boolean => Array.isArray(post.referenced_tweets) && post.referenced_tweets.some((r: Resource) => r?.type === 'replied_to');

// ── the public web read: what x.com shows a visitor (../screens/x-web.ts renders it) ────────────
// x.com's post page and profile page read the SAME posts and accounts the API serves, through the SAME projections,
// with a fixed shape instead of a caller's query. No credential: X shows a public post and profile to anyone. A deleted
// post is gone here as from every read.

/** The fields and expansions the web pages draw (the mirror's POST_READ_QUERY, and the profile's user fields). */
const WEB_READ_SHAPE = 'tweet.fields=created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets'
  + '&expansions=author_id,in_reply_to_user_id,referenced_tweets.id,referenced_tweets.id.author_id,attachments.media_keys'
  + '&user.fields=created_at,description,location,url,verified,protected,profile_image_url'
  + '&media.fields=url,type,width,height,duration_ms,preview_image_url,variants';

function webShape(publicBase?: string): ReadShape {
  const shape = parseReadShape(new URL(`http://twin.local/?${WEB_READ_SHAPE}`), (publicBase ?? PBS_BASE).replace(/\/+$/, ''));
  if (!isShape(shape)) throw new Error('x: the web read shape is not one the read parser accepts');
  return shape;
}

export type XWebPost = { post: Record<string, unknown>; includes: Record<string, unknown> };
export type XWebProfile = { user: Record<string, unknown>; posts: Record<string, unknown>[]; includes: Record<string, unknown> };

/** One live post as its page shows it, or undefined when no live post has that id. Media URLs are X's own hosts
 *  (pbs.twimg.com, video.twimg.com) unless a served base is given. */
export function webPost(all: Resource[], id: string, publicBase?: string): XWebPost | undefined {
  if (!/^\d{1,19}$/.test(id)) return undefined;
  const post = findPost(all, id);
  if (!post) return undefined;
  const shape = webShape(publicBase);
  return { post: projectPost(post, shape.fields, all), includes: buildIncludes([post], all, shape) };
}

/** An account's profile and its posts (not its replies), newest first, at most `limit`; undefined when no account has
 *  that handle (case-insensitive, as X's are). */
export function webProfile(all: Resource[], username: string, publicBase?: string, limit = 100): XWebProfile | undefined {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) return undefined;
  const account = ofType(all, 'account').find((a) => String(a.username).toLowerCase() === username.toLowerCase());
  if (!account) return undefined;
  const shape = webShape(publicBase);
  const own = newestFirst(livePosts(all).filter((p) => String(p.author_id) === String(account.id) && p.in_reply_to_user_id === undefined && !isReply(p))).slice(0, limit);
  return { user: projectUser(account, shape.userFields, all), posts: own.map((p) => projectPost(p, shape.fields, all)), includes: buildIncludes(own, all, shape) };
}

/** x.com's home timeline as the twin draws its "For you" tab: every live post that is not a reply, newest first, at most
 *  `limit`. Where the evidence stops: X ranks For you by its own recommendation, which no document describes; a World
 *  holds few enough posts that all of them, newest first, is the page a person reads. */
export function webHome(all: Resource[], publicBase?: string, limit = 100): { posts: Record<string, unknown>[]; includes: Record<string, unknown> } {
  const shape = webShape(publicBase);
  const posts = newestFirst(livePosts(all).filter((p) => p.in_reply_to_user_id === undefined && !isReply(p))).slice(0, limit);
  return { posts: posts.map((p) => projectPost(p, shape.fields, all)), includes: buildIncludes(posts, all, shape) };
}

// ── a link's card ───────────────────────────────────────────────────────────────────────────────────────
// A post that carries a link and no media shows the linked page's card under its text: its image, title and domain, as
// the page's own markup describes it, read by X's crawler (Twitterbot) when the link is posted. Where the documentation
// stops: X's card documentation is no longer published (developer.x.com's cards pages answer a redirect to docs.x.com's
// home, which has none, checked 2026-10-02), so the crawl reads the page's Open Graph tags, with the `twitter:` tags of
// the same names first, and the card is `summary_large_image` when the page names one and an image, else `summary`. X
// re-hosts a card's image; the twin keeps the image the page names and draws the card without it (../screens/shared.tsx cardBlock). The crawl is X's own move, recorded as `_card`
// bookkeeping by the link's SHA-256, and a link whose page did not answer is crawled again the next time it is posted.

/** A link's card, as the crawl read it. */
export type LinkCard = { url: string; card: 'summary' | 'summary_large_image'; title: string; description?: string; image?: string; domain: string };

export const CARD = '_card';

/** The link a post's card is drawn for: the last http(s) link of its text, closing punctuation the sentence's. */
export function cardLink(text: unknown): string | undefined {
  const links = [...String(text ?? '').matchAll(/https?:\/\/[^\s]+/g)].map((m) => m[0].replace(/[.,;:!?)\]'"]+$/, ''));
  const last = links.at(-1);
  try { return last ? new URL(last).toString() : undefined; } catch { return undefined; }
}

/** A meta tag's content, by its `property` or `name`, from a page's HTML. */
function metaContent(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const named = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (named?.toLowerCase() !== key) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    const value = (content?.[1] ?? content?.[2] ?? '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (value) return value;
  }
  return undefined;
}

/** The card a page's markup describes, or undefined when it names no title. */
function cardOfPage(url: string, html: string): LinkCard | undefined {
  const read = (key: string): string | undefined => metaContent(html, `twitter:${key}`) ?? metaContent(html, `og:${key}`);
  // source: https://ogp.me/ "The title of your object as it should appear within the graph"
  const title = read('title');
  if (!title) return undefined;
  // source: https://ogp.me/ "A one to two sentence description of your object."
  const description = read('description');
  // source: https://ogp.me/ "An image URL which should represent your object within the graph."
  const named = read('image');
  let image: string | undefined;
  try { image = named ? new URL(named, url).toString() : undefined; } catch { image = undefined; }
  const large = metaContent(html, 'twitter:card') === 'summary_large_image' && image !== undefined;
  return { url, card: large ? 'summary_large_image' : 'summary', title, ...(description ? { description } : {}), ...(image ? { image } : {}), domain: new URL(url).hostname };
}

/** A crawl whose request could not be made at all (a runtime with no route out for it): no page, so no card. */
function uncrawled(): { status: number; body: string } {
  return { status: 0, body: '' };
}

/** X's crawl of the link a post carries: the page fetched as Twitterbot through the World's route (the application's
 *  own host inside the World, else the World's egress rule), its card recorded once it has read one. */
export async function crawlCard(ctx: HandlerContext, text: unknown): Promise<void> {
  const url = cardLink(text);
  if (!url || ctx.row(CARD, sha256(url))?.status === 'read') return;
  // a page the crawl cannot reach, on any host the World runs on, leaves the post without a card, as X's does
  const page = await ctx.ask(url, { method: 'GET', headers: { 'user-agent': 'Twitterbot/1.0', accept: 'text/html' } }, 5000).catch(uncrawled);
  const card = page.status >= 200 && page.status < 300 ? cardOfPage(url, page.body) : undefined;
  await ctx.asVendor(() => ctx.record(CARD, card ? { ...card, status: 'read' } : { url, status: 'unread' }, sha256(url)));
}

/** The card a post shows: its link's, when the crawl read one and the post carries no media. */
export function cardOf(all: Resource[], post: Record<string, unknown>): LinkCard | undefined {
  const media = (post.attachments as { media_keys?: unknown[] } | undefined)?.media_keys;
  if (Array.isArray(media) && media.length > 0) return undefined;
  const url = cardLink(post.text);
  if (!url) return undefined;
  const row = ofType(all, CARD).find((r) => r.id === sha256(url));
  return row?.status === 'read' ? row as unknown as LinkCard : undefined;
}

// ── x.com's pages and X's media hosts (the paths the descriptor claims) ─────────────────────────────

/** x.com's top-level routes that are not accounts (and the twin's own doors): never a profile. Each was
 *  observed as a route of its own at x.com (2026-09-28, logged out, `curl -A 'Mozilla/5.0' -o /dev/null
 *  -w '%{http_code} %{redirect_url}' https://x.com/<name>`): home, explore, notifications, settings,
 *  search, login, signup answer 307 to the login flow; messages 307 to /i/chat; i 301 to /; premium 301;
 *  tos and privacy 302 to /en/…; about 301 to about.twitter.com; grok, jobs, communities, lists,
 *  bookmarks, compose, account, share, hashtag, download and creators 200 with a page of their own.
 *  `intent` and `twin`/`_twin` are held back for X's intent URLs and the twin's doors. */
const RESERVED = 'i|en|home|explore|notifications|messages|settings|search|compose|login|logout|signup|tos|privacy|about|account|intent|share|hashtag|lists|bookmarks|jobs|download|grok|premium|communities|creators|twin|_twin';
export const PROFILE_PATH = `^/(?!(?:${RESERVED})/?$)[A-Za-z0-9_]{1,15}/?$`;
export const STATUS_PATH = '^/(?!_twin/)[A-Za-z0-9_]{1,15}/status/[0-9]{1,19}/?$';

/** x.com's home, where a signed-in person reads the timeline and writes a post (../screens/home.tsx), and its sign-in
 *  flow (../screens/login.tsx). */
export const HOME_PATH = '^/home/?$';
export const LOGIN_PATH = '^/i/flow/login/?$';

/** X's pages on x.com and twitter.com, as a RegExp SOURCE for the descriptor's `hosts` rule: a post page, a profile
 *  page, the home timeline and the sign-in flow. ANCHORED, and never the consent screen's `/i/oauth2/authorize` or the
 *  World's `/_twin/` (`i`, `home` and `_twin` are never a handle here). */
/** x.com's root, where a person is sent home or to sign in (../screens/web.ts). */
export const ROOT_PATH = '^/$';
export const X_WEB_PATHS = `${STATUS_PATH}|${PROFILE_PATH}|${HOME_PATH}|${LOGIN_PATH}|${ROOT_PATH}`;

/** X's image and video-thumbnail paths on pbs.twimg.com, and its video file path on video.twimg.com —
 *  the shapes ../server.ts serves from the context's blobs. */
export const X_PBS_PATHS = '^/media/[0-9a-f]{64}\\.(?:jpg|png|gif|webp)$|^/ext_tw_video_thumb/[0-9]{1,19}/pu/img/[0-9a-f]{64}\\.svg$';
export const X_VIDEO_PATHS = '^/ext_tw_video/[0-9]{1,19}/pu/vid/avc1/[0-9]+x[0-9]+/[0-9a-f]{64}\\.mp4$';

/** X's web hosts and what each answers a page path with, as observed (2026-09-28, the curl above over
 *  `/jack/status/20`): x.com serves it; twitter.com 301s to x.com; www.x.com and www.twitter.com 301 to
 *  twitter.com (which then moves to x.com); mobile.twitter.com 302s to twitter.com and mobile.x.com to x.com. */
export const X_WEB_HOSTS = ['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com', 'mobile.twitter.com', 'mobile.x.com'] as const;

/** abs.twimg.com's default profile image paths (../server.ts draws them). */
export const X_ABS_PATHS = '^/sticky/default_profile_images/default_profile_(?:normal|bigger|200x200|400x400)\\.png$';

// ── media ───────────────────────────────────────────────────────────────────────────────────────────────
// Media bytes and upload sessions — what the
// chunked initialize / append / finalize protocol hold before a post attaches the media.
//
// Bytes ride the context's blobs (`ctx.blobs`, content-addressed by sha256: a World branch sees media its parent
// uploaded). The upload SESSION (who uploaded it, its category, its segments, its finished digest) is `upload`,
// a subject of its own that no read serves: at X, uploading media publishes nothing — a media id is a
// private, expiring handle that only a later `POST /2/tweets` makes public. What becomes state is the post: its own
// entry names each attached media by key, id and digest.
/** The stored upload session / finished media object, keyed by the media id X hands back. */
export type XMediaRecord = {
  id: string;
  media_key: string;
  account_id: string;
  media_category: string;
  /** The declared (initialize) or sniffed MIME type. */
  media_type: string;
  /** `initialized` while segments arrive; an image is `succeeded` once its bytes are whole; a video
   *  is `processing` (X's pending → in_progress) until STATUS reads walk it to `succeeded`, or
   *  `failed` when the bytes are not a video X would take. */
  state: 'initialized' | 'processing' | 'succeeded' | 'failed';
  /** A video's processing step counted in STATUS reads (0 = pending, 1 = in_progress, 2 = done). */
  processing_step?: number;
  /** World-clock epoch seconds of FINALIZE: processing also advances one step per
   *  `check_after_secs` elapsed since, so a client that sleeps and then posts is not held back. */
  finalized_at?: number;
  /** Why processing failed, in X's words (served as a problem in the response's `errors`). */
  error?: string;
  duration_ms?: number;
  total_bytes?: number;
  sha256?: string;
  size?: number;
  width?: number;
  height?: number;
  additional_owners?: string[];
  created_at: string;
  /** Epoch seconds after which X no longer accepts the id on a post. */
  expires_at: number;
  /** The APPEND segments received, by index (a chunked upload's bytes are its blobs). */
  segments?: number[];
};

/** X keeps an uploaded media id usable for a day (`expires_after_secs: 86400` on its answers). */
export const MEDIA_EXPIRES_AFTER_SECS = 86_400;
/** X's image ceiling: 5 MB. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** X's ceilings for a post's video (`tweet_video`, `amplify_video`): 8 GB uploaded and 20 minutes posted on an account
 *  without X Premium, 125 minutes with it, and at least half a second. Upload and posting are enforced apart: the
 *  duration a post may carry is checked when the post is created (`videoMinutesAllowed`), not when the video uploads.
 *  Where the twin stops: X Premium's 16 GB upload ceiling is not modelled. */
// source: https://docs.x.com/x-api/media/introduction "Default (no Premium) tweet_video, amplify_video 20 minutes 8 GB"
export const MAX_VIDEO_BYTES = 8 * 1024 * 1024 * 1024;
// source: https://docs.x.com/x-api/media/introduction "Upload and posting are separately enforced."
// source: https://docs.x.com/x-api/media/introduction "X Premium / verified tweet_video, amplify_video 125 minutes 16 GB"
export function videoMinutesAllowed(account: Resource | undefined): number {
  return account?.verified === true || postCharacterLimit(account) > DEFAULT_POST_CHARACTER_LIMIT ? 125 : 20;
}
// source: https://docs.x.com/x-api/media/introduction "Minimum video duration is 0.5 seconds in all cases."
export const MIN_VIDEO_MS = 500;

/** The upload session's type (the manifest's `upload.state` machine): written as a subject, so its media id is held in
 *  the one snowflake space the kernel mints from. */
export const UPLOAD = 'upload';
const blobKey = (sha: string): string => `media/${sha}`;
const segmentKey = (id: string, index: number): string => `media-segments/${id}/${String(index).padStart(4, '0')}`;

/** Store bytes content-addressed; a re-upload of identical content is a no-op write. */
export async function putXBlob(ctx: HandlerContext, bytes: Uint8Array): Promise<{ sha256: string; size: number }> {
  const sha = ctx.crypto.digest('sha256', bytes, 'hex');
  await ctx.blobs.put(blobKey(sha), bytes);
  return { sha256: sha, size: bytes.length };
}

/** Stored bytes by digest (the media routes read them). */
export const readXBlob = (blobs: { get(key: string): Promise<Uint8Array | null> }, sha: string): Promise<Uint8Array | null> => blobs.get(blobKey(sha));

/** Where X serves an upload's finished bytes: an image on pbs.twimg.com, a video file on video.twimg.com (the paths
 *  `projectMedia` answers and ../screens/media.ts serves); undefined before its bytes are whole. */
export function uploadedMediaUrl(record: XMediaRecord): string | undefined {
  if (!record.sha256) return undefined;
  return isVideoCategory(record.media_category)
    ? `${VIDEO_BASE}/ext_tw_video/${record.id}/pu/vid/avc1/${record.width ?? 0}x${record.height ?? 0}/${record.sha256}.mp4`
    : `${PBS_BASE}/media/${record.sha256}.${mediaExtension(record.media_type)}`;
}

export async function writeMediaRecord(ctx: HandlerContext, record: XMediaRecord): Promise<void> {
  await ctx.write(UPLOAD, record.id, record as unknown as Record<string, unknown>, `x.media.${ctx.call.operation.id}`);
}

export function readMediaRecord(ctx: Pick<HandlerContext, 'get' | 'resolve'>, id: string): XMediaRecord | undefined {
  if (!/^\d{1,19}$/.test(id)) return undefined;
  const row = ctx.get(UPLOAD, ctx.resolve(UPLOAD, id));
  return row && typeof row.id === 'string' ? row as unknown as XMediaRecord : undefined;
}

/** Every media id minted, so a new media id (and a new post id) steps past them all. */
export const listMediaIds = (ctx: HandlerContext): string[] => ctx.rowsRaw(UPLOAD, { withDeleted: true }).map((r) => String(r.id)).filter((id) => /^\d+$/.test(id));

/** One APPEND segment, stored under its index (a retried index overwrites, as at X), and the index on the session. */
export async function putSegment(ctx: HandlerContext, record: XMediaRecord, index: number, bytes: Uint8Array): Promise<void> {
  await ctx.blobs.put(segmentKey(record.id, index), bytes);
  await writeMediaRecord(ctx, { ...record, segments: [...new Set([...(record.segments ?? []), index])].sort((a, b) => a - b) });
}

/** Every segment of an upload, in index order. */
export async function readSegments(ctx: HandlerContext, record: XMediaRecord): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const index of record.segments ?? []) {
    const bytes = await ctx.blobs.get(segmentKey(record.id, index));
    if (bytes !== null) out.push(bytes);
  }
  return out;
}

export async function clearSegments(ctx: HandlerContext, record: XMediaRecord): Promise<void> {
  for (const index of record.segments ?? []) await ctx.blobs.remove(segmentKey(record.id, index));
}

// ── what the bytes are ──────────────────────────────────────────────────────────────────────
// X decides an image's type and size from the bytes it received, not from what the client said.
// The twin does the same: the four still-image formats X accepts, read from their headers.

export type ImageInfo = { mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; width: number; height: number };

export function sniffImage(bytes: Uint8Array): ImageInfo | undefined {
  const image = readImageHeader(bytes);
  if (!image || (image.type === 'image/gif' && bytes[3] !== 0x38)) return undefined;
  // X keeps its three-byte JPEG signature and the byte after the frame dimensions; fill markers are not accepted.
  if (image.type === 'image/jpeg' && (bytes[2] !== 0xff || !image.jpeg || image.jpeg.frameEnd >= bytes.length || image.jpeg.fillBytes)) return undefined;
  return { mediaType: image.type, width: image.width, height: image.height };
}

export type VideoInfo = { mediaType: 'video/mp4'; width: number; height: number; durationMs: number };

/**
 * An MP4 (ISO BMFF) read from its boxes: `ftyp` first, then `moov` (anywhere — ffmpeg writes it
 * after `mdat` unless told to fast-start) holding `mvhd` (timescale + duration) and one `trak` per
 * stream whose `tkhd` carries the presented width/height (16.16 fixed point); the video track is
 * the one with a non-zero size. Nothing is decoded — the codec is the browser's business.
 */
export function sniffVideo(bytes: Uint8Array): VideoInfo | undefined {
  const file = readMp4Header(bytes);
  const movie = file.movies[0];
  if (!file.fileType || !file.hasMediaData || !movie) return undefined;
  // X uses its first movie, last positive-scale header of at least 32 bytes, and first positive integer-size track.
  // The shared reader bounds each header to its box and omits truncated or unknown-version movie/track facts.
  const header = movie.headers.filter((h) => h.payloadSize >= 32 && h.timescale > 0).at(-1);
  const track = movie.tracks.map(({ width, height }) => ({ width: Math.floor(width), height: Math.floor(height) })).find(({ width, height }) => width > 0 && height > 0);
  if (!header || !track) return undefined;
  return { mediaType: 'video/mp4', ...track, durationMs: Math.round((header.duration * 1000) / header.timescale) };
}

/**
 * The video's preview image. X's is a frame its transcoder cut; the twin decodes nothing (the codec
 * is the browser's), so it serves a STAND-IN at the video's own size and aspect — a dark frame with
 * X's play glyph — and says so here. `x.media.video_poster_frame` is the todo for a real frame.
 */
export function videoPosterSvg(width: number, height: number): string {
  const w = width > 0 ? width : 1280;
  const h = height > 0 ? height : 720;
  const r = Math.round(Math.min(w, h) * 0.09);
  const cx = w / 2;
  const cy = h / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#16181c"/>`
    + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#1d9bf0"/><path d="M${cx - r * 0.3} ${cy - r * 0.45}L${cx + r * 0.5} ${cy}L${cx - r * 0.3} ${cy + r * 0.45}Z" fill="#fff"/></svg>`;
}

/** The file extension pbs.twimg.com serves an image under. */
const EXTENSIONS: Readonly<Record<string, string>> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
export function mediaExtension(mediaType: string): string {
  return EXTENSIONS[mediaType] ?? 'bin';
}

export const INVALID_MEDIA_IDS = 'Your media IDs are invalid.';

/** How long X tells a client to wait between STATUS reads while a video processes. */
export const CHECK_AFTER_SECS = 1;

export const isVideoCategory = (category: string): boolean => VIDEO_CATEGORIES.has(category);



export const VIDEO_CATEGORIES = new Set(['tweet_video', 'amplify_video']);

/** The machine's word on a move of an upload session's state (the manifest's `upload.state`): nothing, or X's
 *  invalid request with the refusal's words. */
export function moveRefused(ctx: HandlerContext, operation: string, record: XMediaRecord, to: string | undefined, actor?: 'time'): XResponse | undefined {
  const refused = ctx.legal(UPLOAD, 'state', operation, record.state, to, record.id, actor);
  return refused ? invalidRequestProblem({ media_id: [record.id] }, refused.message) : undefined;
}

/** The step a processing video has reached: counted STATUS reads, or elapsed World-clock time since FINALIZE in
 *  `check_after_secs` steps, whichever is further along. */
export function processingStep(record: XMediaRecord, ctx: HandlerContext): number {
  const byReads = record.processing_step ?? 0;
  const byTime = record.finalized_at === undefined ? 0 : Math.floor((nowSeconds(ctx) - record.finalized_at) / CHECK_AFTER_SECS);
  return Math.max(byReads, byTime);
}

/** A record as it stands NOW by the World clock: a processing video two steps along has succeeded (time's move, which
 *  asks the machine). */
export function settled(record: XMediaRecord, ctx: HandlerContext): XMediaRecord {
  if (record.state !== 'processing') return record;
  const step = processingStep(record, ctx);
  return step === (record.processing_step ?? 0) ? record : movedByTime(ctx, record, step);
}

/** A processing video the World clock has walked further than its STATUS reads (time's move, which asks the machine). */
function movedByTime(ctx: HandlerContext, record: XMediaRecord, step: number): XMediaRecord {
  const to = step >= 2 ? 'succeeded' : 'processing';
  if (moveRefused(ctx, 'time', record, to, 'time')) return record;
  return step >= 2 ? { ...record, state: 'succeeded', processing_step: step } : { ...record, processing_step: step };
}

/** Whether the account may use a media object: its uploader, or an owner it named. */
export function canUse(record: XMediaRecord, caller: Caller): boolean {
  return record.account_id === caller.accountId || (record.additional_owners ?? []).includes(caller.accountId);
}

/** `media.media_ids` on a create, resolved to what the post will carry, or X's refusal. A post carries up to four
 *  images or one video; a video still processing (or failed) is not usable. */
export async function resolveAttachedMedia(ctx: HandlerContext, caller: Caller, media: unknown): Promise<{ media: AttachedMedia[] } | XResponse> {
  if (media === undefined || media === null) return { media: [] };
  if (typeof media !== 'object' || Array.isArray(media)) return invalidRequestProblem({ media: [JSON.stringify(media)] }, 'The `media` field must be an object with `media_ids`.');
  const body = media as Record<string, unknown>;
  const other = Object.keys(body).find((key) => key !== 'media_ids');
  if (other !== undefined) return mediaFieldRefused(other, body[other]);
  const ids = body.media_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4) return mediaIdsCountRefused(ids);
  const out: AttachedMedia[] = [];
  for (const raw of ids) {
    // the schema's items are STRINGS matching ^[0-9]{1,19}$: a JSON number is refused, not coerced
    if (typeof raw !== 'string' || !/^\d{1,19}$/.test(raw)) return mediaIdShapeRefused(raw);
    const stored = readMediaRecord(ctx, raw);
    const record = stored ? settled(stored, ctx) : undefined;
    // a DM category is a Direct Message's, never a post's
    if (!record || record.state !== 'succeeded' || !canUse(record, caller) || record.expires_at <= nowSeconds(ctx) || !record.sha256 || record.media_category.startsWith('dm_')) return invalidMediaIds(raw);
    out.push({
      media_key: record.media_key, media_id: record.id, type: isVideoCategory(record.media_category) ? 'video' : 'photo',
      media_type: record.media_type, media_category: record.media_category, sha256: record.sha256, size: record.size ?? 0,
      ...(typeof record.width === 'number' ? { width: record.width } : {}), ...(typeof record.height === 'number' ? { height: record.height } : {}),
      ...(typeof record.duration_ms === 'number' ? { duration_ms: record.duration_ms } : {}),
    });
  }
  return out.some((m) => m.type === 'video') && out.length > 1 ? videoWithOthers(ids) : { media: out };
}

/** A field of `media` other than `media_ids` none of X's (spec:createPosts' CreatePostsMedia: `tagged_user_ids` and the
 *  Amplify fields are the manifest's variants, answered the gap before the handler runs). */
function mediaFieldRefused(key: string, value: unknown): XResponse {
  return invalidRequestProblem({ [`media.${key}`]: [JSON.stringify(value)] }, `The \`media.${key}\` field is not a parameter of this request.`);
}

/** `media_ids` that list none, or more than four. */
function mediaIdsCountRefused(ids: unknown): XResponse {
  return invalidRequestProblem({ 'media.media_ids': [JSON.stringify(ids ?? null)] }, 'The `media.media_ids` field must list between 1 and 4 media ids.');
}

/** A media id that is not a string of digits (the schema's items are strings matching ^[0-9]{1,19}$). */
function mediaIdShapeRefused(raw: unknown): XResponse {
  return invalidRequestProblem({ 'media.media_ids': [String(raw)] }, `The \`media.media_ids\` value [${String(raw)}] is not a string matching ^[0-9]{1,19}$`);
}

/** A media id this account may not attach: unknown, not finished processing, failed, expired, another's, or a DM's. */
function invalidMediaIds(raw: string): XResponse {
  return invalidRequestProblem({ 'media.media_ids': [raw] }, INVALID_MEDIA_IDS);
}

/** A video with other media: a post carries up to four images or one video. */
function videoWithOthers(ids: unknown[]): XResponse {
  return invalidRequestProblem({ 'media.media_ids': ids.map(String) }, 'A Post may carry up to four images or one video, not both.');
}


/** X's default post length. An account on X Premium may exceed it, so the twin carries that entitlement as a seeded
 *  per-account number (the doors set it). */
export const DEFAULT_POST_CHARACTER_LIMIT = 280;
export const MAX_POST_CHARACTER_LIMIT = 25_000;

/** A post's length as X counts it (twitter-text v3's parseTweet): its text in Unicode NFC; each link 23 whatever its
 *  length; each emoji 2, a grapheme cluster counted once (a flag's two regional indicators, a keycap, a ZWJ sequence,
 *  a skin-tone modifier); any other code point 1 in twitter-text's weight-1 ranges and 2 outside them. */
// source: https://docs.x.com/fundamentals/counting-characters "All URLs are wrapped with t.co shortener and count as 23 characters, regardless of the original length"
// source: https://docs.x.com/fundamentals/counting-characters "All emojis count as 2 characters, regardless of complexity"
// source: https://raw.githubusercontent.com/twitter/twitter-text/master/config/v3.json "transformedURLLength"
export function weightedLength(text: string): number {
  const normal = text.normalize('NFC');
  let length = 0;
  let at = 0;
  for (const [start, end] of linkSpans(normal)) {
    length += unlinkedLength(normal.slice(at, start)) + 23;
    at = end;
  }
  return length + unlinkedLength(normal.slice(at));
}

/** Text with no link in it, by grapheme cluster: an emoji 2, else each code point by its range. */
function unlinkedLength(text: string): number {
  let length = 0;
  for (const { segment } of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)) {
    // an emoji as twemoji-parser (twitter-text's) finds one: a pictograph drawn as an emoji, or one asked for (U+FE0F),
    // a flag's regional indicators, a keycap; a text-style symbol (©, ®) counts as the character it is
    if (/\p{Emoji_Presentation}|\uFE0F|\p{Regional_Indicator}|\u20e3/u.test(segment)) length += 2;
    else for (const ch of segment) length += codePointWeight(ch.codePointAt(0)!);
  }
  return length;
}

/** The links of a post's text, as twitter-text 3.1.0's extractor finds them (its regexp/ modules, ported): an
 *  optional http(s) scheme; a domain of letters, digits and marks whose last label is one of twitter-text's generic or
 *  country top-level domains or punycode; a port only after a scheme; a path of twitter-text's path characters with
 *  balanced parentheses, ending on a path's ending character (so a sentence's closing period, comma or parenthesis is
 *  not part of it, and nor is a character outside its Latin and Cyrillic ranges); a query ending on a query's ending
 *  character. A link is not preceded by a letter, a digit, @, $ or #, and one without a scheme not by - _ . /; one
 *  without a scheme that has no path ends with its domain. */
// source: https://raw.githubusercontent.com/twitter/twitter-text/v3.1.0/js/src/regexp/extractUrl.js "Protocol (optional)"
// source: https://raw.githubusercontent.com/twitter/twitter-text/v3.1.0/js/src/regexp/validUrlPathEndingChars.js "Valid end-of-path chracters (so /foo. does not gobble the period)"
// source: https://raw.githubusercontent.com/twitter/twitter-text/v3.1.0/js/src/regexp/invalidUrlWithoutProtocolPrecedingChars.js "invalidUrlWithoutProtocolPrecedingChars"
// source: https://raw.githubusercontent.com/twitter/twitter-text/v3.1.0/js/src/regexp/validGTLD.js "validGTLD"
// source: https://raw.githubusercontent.com/twitter/twitter-text/v3.1.0/js/src/regexp/validCCTLD.js "validCCTLD"
const GENERIC_TLDS = '삼성|닷컴|닷넷|香格里拉|餐厅|食品|飞利浦|電訊盈科|集团|通販|购物|谷歌|诺基亚|联通|网络|网站|网店|网址|组织机构|移动|珠宝|点看|游戏|淡马锡|机构|書籍|时尚|新闻|政府|政务|招聘|手表|手机|我爱你|慈善|微博|广东|工行|家電|娱乐|天主教|大拿|大众汽车|在线|嘉里大酒店|嘉里|商标|商店|商城|公益|公司|八卦|健康|信息|佛山|企业|中文网|中信|世界|ポイント|ファッション|セール|ストア|コム|グーグル|クラウド|みんな|คอม|संगठन|नेट|कॉम|همراه|موقع|موبايلي|كوم|كاثوليك|عرب|شبكة|بيتك|بازار|العليان|ارامكو|اتصالات|ابوظبي|קום|сайт|рус|орг|онлайн|москва|ком|католик|дети|zuerich|zone|zippo|zip|zero|zara|zappos|yun|youtube|you|yokohama|yoga|yodobashi|yandex|yamaxun|yahoo|yachts|xyz|xxx|xperia|xin|xihuan|xfinity|xerox|xbox|wtf|wtc|wow|world|works|work|woodside|wolterskluwer|wme|winners|wine|windows|win|williamhill|wiki|wien|whoswho|weir|weibo|wedding|wed|website|weber|webcam|weatherchannel|weather|watches|watch|warman|wanggou|wang|walter|walmart|wales|vuelos|voyage|voto|voting|vote|volvo|volkswagen|vodka|vlaanderen|vivo|viva|vistaprint|vista|vision|visa|virgin|vip|vin|villas|viking|vig|video|viajes|vet|versicherung|vermögensberatung|vermögensberater|verisign|ventures|vegas|vanguard|vana|vacations|ups|uol|uno|university|unicom|uconnect|ubs|ubank|tvs|tushu|tunes|tui|tube|trv|trust|travelersinsurance|travelers|travelchannel|travel|training|trading|trade|toys|toyota|town|tours|total|toshiba|toray|top|tools|tokyo|today|tmall|tkmaxx|tjx|tjmaxx|tirol|tires|tips|tiffany|tienda|tickets|tiaa|theatre|theater|thd|teva|tennis|temasek|telefonica|telecity|tel|technology|tech|team|tdk|tci|taxi|tax|tattoo|tatar|tatamotors|target|taobao|talk|taipei|tab|systems|symantec|sydney|swiss|swiftcover|swatch|suzuki|surgery|surf|support|supply|supplies|sucks|style|study|studio|stream|store|storage|stockholm|stcgroup|stc|statoil|statefarm|statebank|starhub|star|staples|stada|srt|srl|spreadbetting|spot|sport|spiegel|space|soy|sony|song|solutions|solar|sohu|software|softbank|social|soccer|sncf|smile|smart|sling|skype|sky|skin|ski|site|singles|sina|silk|shriram|showtime|show|shouji|shopping|shop|shoes|shiksha|shia|shell|shaw|sharp|shangrila|sfr|sexy|sex|sew|seven|ses|services|sener|select|seek|security|secure|seat|search|scot|scor|scjohnson|science|schwarz|schule|school|scholarships|schmidt|schaeffler|scb|sca|sbs|sbi|saxo|save|sas|sarl|sapo|sap|sanofi|sandvikcoromant|sandvik|samsung|samsclub|salon|sale|sakura|safety|safe|saarland|ryukyu|rwe|run|ruhr|rugby|rsvp|room|rogers|rodeo|rocks|rocher|rmit|rip|rio|ril|rightathome|ricoh|richardli|rich|rexroth|reviews|review|restaurant|rest|republican|report|repair|rentals|rent|ren|reliance|reit|reisen|reise|rehab|redumbrella|redstone|red|recipes|realty|realtor|realestate|read|raid|radio|racing|qvc|quest|quebec|qpon|pwc|pub|prudential|pru|protection|property|properties|promo|progressive|prof|productions|prod|pro|prime|press|praxi|pramerica|post|porn|politie|poker|pohl|pnc|plus|plumbing|playstation|play|place|pizza|pioneer|pink|ping|pin|pid|pictures|pictet|pics|piaget|physio|photos|photography|photo|phone|philips|phd|pharmacy|pfizer|pet|pccw|pay|passagens|party|parts|partners|pars|paris|panerai|panasonic|pamperedchef|page|ovh|ott|otsuka|osaka|origins|orientexpress|organic|org|orange|oracle|open|ooo|onyourside|online|onl|ong|one|omega|ollo|oldnavy|olayangroup|olayan|okinawa|office|off|observer|obi|nyc|ntt|nrw|nra|nowtv|nowruz|now|norton|northwesternmutual|nokia|nissay|nissan|ninja|nikon|nike|nico|nhk|ngo|nfl|nexus|nextdirect|next|news|newholland|new|neustar|network|netflix|netbank|net|nec|nba|navy|natura|nationwide|name|nagoya|nadex|nab|mutuelle|mutual|museum|mtr|mtpc|mtn|msd|movistar|movie|mov|motorcycles|moto|moscow|mortgage|mormon|mopar|montblanc|monster|money|monash|mom|moi|moe|moda|mobily|mobile|mobi|mma|mls|mlb|mitsubishi|mit|mint|mini|mil|microsoft|miami|metlife|merckmsd|meo|menu|men|memorial|meme|melbourne|meet|media|med|mckinsey|mcdonalds|mcd|mba|mattel|maserati|marshalls|marriott|markets|marketing|market|map|mango|management|man|makeup|maison|maif|madrid|macys|luxury|luxe|lupin|lundbeck|ltda|ltd|lplfinancial|lpl|love|lotto|lotte|london|lol|loft|locus|locker|loans|loan|llp|llc|lixil|living|live|lipsy|link|linde|lincoln|limo|limited|lilly|like|lighting|lifestyle|lifeinsurance|life|lidl|liaison|lgbt|lexus|lego|legal|lefrak|leclerc|lease|lds|lawyer|law|latrobe|latino|lat|lasalle|lanxess|landrover|land|lancome|lancia|lancaster|lamer|lamborghini|ladbrokes|lacaixa|kyoto|kuokgroup|kred|krd|kpn|kpmg|kosher|komatsu|koeln|kiwi|kitchen|kindle|kinder|kim|kia|kfh|kerryproperties|kerrylogistics|kerryhotels|kddi|kaufen|juniper|juegos|jprs|jpmorgan|joy|jot|joburg|jobs|jnj|jmp|jll|jlc|jio|jewelry|jetzt|jeep|jcp|jcb|java|jaguar|iwc|iveco|itv|itau|istanbul|ist|ismaili|iselect|irish|ipiranga|investments|intuit|international|intel|int|insure|insurance|institute|ink|ing|info|infiniti|industries|inc|immobilien|immo|imdb|imamat|ikano|iinet|ifm|ieee|icu|ice|icbc|ibm|hyundai|hyatt|hughes|htc|hsbc|how|house|hotmail|hotels|hoteles|hot|hosting|host|hospital|horse|honeywell|honda|homesense|homes|homegoods|homedepot|holiday|holdings|hockey|hkt|hiv|hitachi|hisamitsu|hiphop|hgtv|hermes|here|helsinki|help|healthcare|health|hdfcbank|hdfc|hbo|haus|hangout|hamburg|hair|guru|guitars|guide|guge|gucci|guardian|group|grocery|gripe|green|gratis|graphics|grainger|gov|got|gop|google|goog|goodyear|goodhands|goo|golf|goldpoint|gold|godaddy|gmx|gmo|gmbh|gmail|globo|global|gle|glass|glade|giving|gives|gifts|gift|ggee|george|genting|gent|gea|gdn|gbiz|gay|garden|gap|games|game|gallup|gallo|gallery|gal|fyi|futbol|furniture|fund|fun|fujixerox|fujitsu|ftr|frontier|frontdoor|frogans|frl|fresenius|free|fox|foundation|forum|forsale|forex|ford|football|foodnetwork|food|foo|fly|flsmidth|flowers|florist|flir|flights|flickr|fitness|fit|fishing|fish|firmdale|firestone|fire|financial|finance|final|film|fido|fidelity|fiat|ferrero|ferrari|feedback|fedex|fast|fashion|farmers|farm|fans|fan|family|faith|fairwinds|fail|fage|extraspace|express|exposed|expert|exchange|everbank|events|eus|eurovision|etisalat|esurance|estate|esq|erni|ericsson|equipment|epson|epost|enterprises|engineering|engineer|energy|emerck|email|education|edu|edeka|eco|eat|earth|dvr|dvag|durban|dupont|duns|dunlop|duck|dubai|dtv|drive|download|dot|doosan|domains|doha|dog|dodge|doctor|docs|dnp|diy|dish|discover|discount|directory|direct|digital|diet|diamonds|dhl|dev|design|desi|dentist|dental|democrat|delta|deloitte|dell|delivery|degree|deals|dealer|deal|dds|dclk|day|datsun|dating|date|data|dance|dad|dabur|cyou|cymru|cuisinella|csc|cruises|cruise|crs|crown|cricket|creditunion|creditcard|credit|cpa|courses|coupons|coupon|country|corsica|coop|cool|cookingchannel|cooking|contractors|contact|consulting|construction|condos|comsec|computer|compare|company|community|commbank|comcast|com|cologne|college|coffee|codes|coach|clubmed|club|cloud|clothing|clinique|clinic|click|cleaning|claims|cityeats|city|citic|citi|citadel|cisco|circle|cipriani|church|chrysler|chrome|christmas|chloe|chintai|cheap|chat|chase|charity|channel|chanel|cfd|cfa|cern|ceo|center|ceb|cbs|cbre|cbn|cba|catholic|catering|cat|casino|cash|caseih|case|casa|cartier|cars|careers|career|care|cards|caravan|car|capitalone|capital|capetown|canon|cancerresearch|camp|camera|cam|calvinklein|call|cal|cafe|cab|bzh|buzz|buy|business|builders|build|bugatti|budapest|brussels|brother|broker|broadway|bridgestone|bradesco|box|boutique|bot|boston|bostik|bosch|boots|booking|book|boo|bond|bom|bofa|boehringer|boats|bnpparibas|bnl|bmw|bms|blue|bloomberg|blog|blockbuster|blanco|blackfriday|black|biz|bio|bingo|bing|bike|bid|bible|bharti|bet|bestbuy|best|berlin|bentley|beer|beauty|beats|bcn|bcg|bbva|bbt|bbc|bayern|bauhaus|basketball|baseball|bargains|barefoot|barclays|barclaycard|barcelona|bar|bank|band|bananarepublic|banamex|baidu|baby|azure|axa|aws|avianca|autos|auto|author|auspost|audio|audible|audi|auction|attorney|athleta|associates|asia|asda|arte|art|arpa|army|archi|aramco|arab|aquarelle|apple|app|apartments|aol|anz|anquan|android|analytics|amsterdam|amica|amfam|amex|americanfamily|americanexpress|alstom|alsace|ally|allstate|allfinanz|alipay|alibaba|alfaromeo|akdn|airtel|airforce|airbus|aigo|aig|agency|agakhan|africa|afl|afamilycompany|aetna|aero|aeg|adult|ads|adac|actor|active|aco|accountants|accountant|accenture|academy|abudhabi|abogado|able|abc|abbvie|abbott|abb|abarth|aarp|aaa|onion';
const COUNTRY_TLDS = '한국|香港|澳門|新加坡|台灣|台湾|中國|中国|გე|ລາວ|ไทย|ලංකා|ഭാരതം|ಭಾರತ|భారత్|சிங்கப்பூர்|இலங்கை|இந்தியா|ଭାରତ|ભારત|ਭਾਰਤ|ভাৰত|ভারত|বাংলা|भारोत|भारतम्|भारत|ڀارت|پاکستان|موريتانيا|مليسيا|مصر|قطر|فلسطين|عمان|عراق|سورية|سودان|تونس|بھارت|بارت|ایران|امارات|المغرب|السعودية|الجزائر|البحرين|الاردن|հայ|қаз|укр|срб|рф|мон|мкд|ею|бел|бг|ευ|ελ|zw|zm|za|yt|ye|ws|wf|vu|vn|vi|vg|ve|vc|va|uz|uy|us|um|uk|ug|ua|tz|tw|tv|tt|tr|tp|to|tn|tm|tl|tk|tj|th|tg|tf|td|tc|sz|sy|sx|sv|su|st|ss|sr|so|sn|sm|sl|sk|sj|si|sh|sg|se|sd|sc|sb|sa|rw|ru|rs|ro|re|qa|py|pw|pt|ps|pr|pn|pm|pl|pk|ph|pg|pf|pe|pa|om|nz|nu|nr|np|no|nl|ni|ng|nf|ne|nc|na|mz|my|mx|mw|mv|mu|mt|ms|mr|mq|mp|mo|mn|mm|ml|mk|mh|mg|mf|me|md|mc|ma|ly|lv|lu|lt|ls|lr|lk|li|lc|lb|la|kz|ky|kw|kr|kp|kn|km|ki|kh|kg|ke|jp|jo|jm|je|it|is|ir|iq|io|in|im|il|ie|id|hu|ht|hr|hn|hm|hk|gy|gw|gu|gt|gs|gr|gq|gp|gn|gm|gl|gi|gh|gg|gf|ge|gd|gb|ga|fr|fo|fm|fk|fj|fi|eu|et|es|er|eh|eg|ee|ec|dz|do|dm|dk|dj|de|cz|cy|cx|cw|cv|cu|cr|co|cn|cm|cl|ck|ci|ch|cg|cf|cd|cc|ca|bz|by|bw|bv|bt|bs|br|bq|bo|bn|bm|bl|bj|bi|bh|bg|bf|be|bd|bb|ba|az|ax|aw|au|at|as|ar|aq|ao|an|am|al|ai|ag|af|ae|ad|ac';
const LATIN = '\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u00FF\\u0100-\\u024F\\u0253\\u0254\\u0256\\u0257\\u0259\\u025B\\u0263\\u0268\\u026F\\u0272\\u0289\\u028B\\u02BB\\u0300-\\u036F\\u1E00-\\u1EFF';
const PATH_CHAR = `[a-z\\u0400-\\u04FF0-9!*';:=+,.$/%#\\[\\]\\-\\u2013_~@|&${LATIN}]`;
const BALANCED = `\\((?:${PATH_CHAR}+|(?:${PATH_CHAR}*\\(${PATH_CHAR}+\\)${PATH_CHAR}*))\\)`;
const PATH_END = `(?:[+\\-a-z\\u0400-\\u04FF0-9=_#/${LATIN}]|${BALANCED})`;
const PATH = `(?:(?:${PATH_CHAR}*(?:${BALANCED}${PATH_CHAR}*)*${PATH_END})|(?:@${PATH_CHAR}+/))`;
const QUERY = "\\?[a-z0-9!?*'@();:&=+$/%#\\[\\]\\-_.,~|]*[a-z0-9\\-_&=#/]";
const DOMAIN_CHAR = '[\\p{L}\\p{N}\\p{M}]';
const DOMAIN = `(?:(?:${DOMAIN_CHAR}(?:[_-]|${DOMAIN_CHAR})*)?${DOMAIN_CHAR}\\.)*(?:(?:${DOMAIN_CHAR}(?:-|${DOMAIN_CHAR})*)?${DOMAIN_CHAR}\\.)(?:${GENERIC_TLDS}|${COUNTRY_TLDS}|xn--[\\-0-9a-z]+)(?=[^\\p{L}\\p{N}@+-]|$)`;
const LINK = new RegExp(`(?<![A-Za-z0-9@\\uFF20$#\\uFF03])(https?:\\/\\/)?(${DOMAIN})(?::(\\d{1,5}))?((?:\\/${PATH}*)?)((?:${QUERY})?)`, 'giu');
function linkSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(LINK)) {
    const [whole, scheme, domain, , path, query] = m;
    const span: [number, number] | undefined = scheme ? [m.index!, m.index! + whole.length] : bareLink(text, m.index!, whole, domain!, Boolean(path || query));
    if (span) spans.push(span);
  }
  return spans;
}

/** A link written without its scheme: none after - _ . / , and without a path or query its domain alone. */
function bareLink(text: string, start: number, whole: string, domain: string, pathed: boolean): [number, number] | undefined {
  if (start > 0 && /[-_./]/.test(text[start - 1]!)) return undefined;
  return [start, pathed ? start + whole.length : start + domain.length];
}

/** twitter-text's v3 ranges of weight 1 (in its units of 100): Latin through Hangul Jamo, and the general punctuation
 *  spaces, dashes, quotes and primes; every other code point weighs 2 (its defaultWeight 200). */
// source: https://raw.githubusercontent.com/twitter/twitter-text/master/config/v3.json "defaultWeight"
function codePointWeight(cp: number): number {
  return (cp <= 4351 || (cp >= 8192 && cp <= 8205) || (cp >= 8208 && cp <= 8223) || (cp >= 8242 && cp <= 8247)) ? 1 : 2;
}

/** The account's post length, in X's weighted count: X's 280, or the X Premium entitlement seeded on it. */
export function postCharacterLimit(account: Resource | undefined): number {
  const declared = account?.post_character_limit;
  return typeof declared === 'number' && Number.isInteger(declared) && declared >= DEFAULT_POST_CHARACTER_LIMIT && declared <= MAX_POST_CHARACTER_LIMIT
    ? declared
    : DEFAULT_POST_CHARACTER_LIMIT;
}

/** A post id in a request body: a STRING matching ^[0-9]{1,19}$, as the spec types it. */
export function postIdField(value: unknown, parameter: string): string | XResponse {
  return typeof value === 'string' && /^\d{1,19}$/.test(value) ? value : postIdRefused(value, parameter);
}

/** A post id that is not a string of digits. */
function postIdRefused(value: unknown, parameter: string): XResponse {
  return invalidRequestProblem({ [parameter]: [String(value)] }, `The \`${parameter}\` value [${String(value)}] is not a string matching ^[0-9]{1,19}$`);
}
