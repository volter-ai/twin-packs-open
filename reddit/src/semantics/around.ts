// What Reddit does around every request to its API (twin-world's architecture, around.ts): it names the caller, keeps
// the client's rate window, and encodes its JSON the legacy way unless asked not to.
//
// THE CALLER. On oauth.reddit.com a call carries `Authorization: bearer <token>`: a token the World issued and still
// holds, unexpired, names its account and its scopes, and anything else is 401 `invalid_token`; an operation whose
// scope the token lacks is 403 `insufficient_scope` (r2's authenticate_with_token). On www.reddit.com reddit.com's own
// pages call the same API with the person's session cookie and the page's modhash. The token endpoint authenticates
// its client itself (HTTP Basic), and a read of a public listing needs no one.
//
// THE RATE WINDOW. Every OAuth call counts against its client's window: 1,000 requests a ten-minute window, the window
// turning at each tenth minute of the clock, as Reddit's answers count it (x-ratelimit-used and -remaining summing to
// 1,000, -reset the seconds to the next ten-minute mark, recorded on 2025-05-07 and 2025-06-19); a call past it is 429.
import { isReadOnlyRequest, type HandlerContext } from '@volter/world-core';
import { accountOfPerson, CALLER_HEADER, err, hasScope, hostOf, httpError, jsonAnswer, legacyEncoded, modhashFor, nowSeconds, personSignedIn, RATE_WINDOW, sessionCookie, TOKEN, type Caller } from './shared.ts';

/** The calls a person may make on www.reddit.com with no one signed in: reads of what anyone may read. */
const PUBLIC_READS = new Set(['GET_r_subreddit_hot', 'GET_r_subreddit_new', 'GET_r_subreddit_about', 'GET_comments_article', 'GET_r_subreddit_comments_article', 'GET_user_username_where']);
/** The token endpoint, which authenticates its client by HTTP Basic itself. */
const OWN_AUTH = new Set(['POST_api_v1_access_token']);

// source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_submit_image__selftext.json "x-ratelimit-remaining"
const WINDOW_SECONDS = 600;
const WINDOW_REQUESTS = 1000;

/** A bearer token's caller, or why it is refused. */
function bearerCaller(ctx: HandlerContext, token: string): Caller | 'invalid' {
  const digest = ctx.crypto.sha256(token);
  const held = ctx.rowsRaw(TOKEN).find((t) => t.sha256 === digest);
  if (!held || held.revoked === true) return 'invalid';
  // source: https://github.com/reddit-archive/reddit/wiki/OAuth2 "All bearer tokens expire after 1 hour."
  // Reddit's tokens now answer expires_in 86400 (recorded on 2026-04-13); a token is held to the expiry it was issued with
  if (typeof held.expires_at === 'number' && nowSeconds(ctx) >= held.expires_at) return 'invalid';
  const account = ctx.row('account', String(held.account));
  if (!account) return 'invalid';
  return { account: String(account.id), name: String(account.name), scopes: String(held.scope).split(/[\s,]+/).filter(Boolean), client: String(held.client), via: 'bearer' };
}

/** A person signed in on reddit.com, with the modhash their page sends back on a write. */
async function sessionCaller(ctx: HandlerContext): Promise<{ caller: Caller; modhashOk: boolean } | undefined> {
  const cookie = sessionCookie(ctx);
  const email = cookie ? personSignedIn(ctx, cookie) : undefined;
  const account = email ? accountOfPerson(ctx, email) : undefined;
  if (!account) return undefined;
  const sent = ctx.call.request.headers.get('x-modhash') ?? String(ctx.params.uh ?? '');
  const modhashOk = sent !== '' && sent === (await modhashFor(ctx, cookie));
  return { caller: { account: String(account.id), name: String(account.name), scopes: ['*'], client: `session:${String(account.id)}`, via: 'session' }, modhashOk };
}

/** The client's window: counted, and the headers every answer carries. */
async function rateWindow(ctx: HandlerContext, client: string): Promise<{ over: boolean; headers: Record<string, string> }> {
  const now = nowSeconds(ctx);
  const start = Math.floor(now / WINDOW_SECONDS) * WINDOW_SECONDS;
  const id = `${client}:${start}`;
  const reset = start + WINDOW_SECONDS - now;
  const used = Number(ctx.row(RATE_WINDOW, id)?.used ?? 0);
  if (used >= WINDOW_REQUESTS) return spent(used, reset);
  // a World started read-only keeps no count: it answers the window as it stands
  if (isReadOnlyRequest(ctx.call.request)) return { over: false, headers: { 'x-ratelimit-used': String(used), 'x-ratelimit-remaining': `${WINDOW_REQUESTS - used}.0`, 'x-ratelimit-reset': String(reset) } };
  if (!ctx.row(RATE_WINDOW, id)) await ctx.record(RATE_WINDOW, { client, window_start: start, used: 0 }, id);
  await ctx.accumulate(RATE_WINDOW, id, { used: 1 }, 'rate_window.count');
  return { over: false, headers: { 'x-ratelimit-used': String(used + 1), 'x-ratelimit-remaining': `${WINDOW_REQUESTS - used - 1}.0`, 'x-ratelimit-reset': String(reset) } };
}

/** A window the client has spent: the 429 Reddit answers until it turns, with the window's headers. */
function spent(used: number, reset: number): { over: boolean; headers: Record<string, string> } {
  return { over: true, headers: { 'x-ratelimit-used': String(used), 'x-ratelimit-remaining': '0.0', 'x-ratelimit-reset': String(reset) } };
}

/** The refusal of a call past the client's window: Reddit's error form for 429, with the window's headers. Where the
 *  documentation stops: the API wiki states the limit and the headers; the body is Reddit's error form for any HTTP
 *  error (recorded for 401 and 403). */
function overLimit(headers: Record<string, string>): Response {
  return httpError(429, headers);
}

/** A call to an OAuth-only endpoint (GET /api/v1/me) with no bearer token: Reddit authenticates every call there by its
 *  token, and one with none is invalid_token, whatever cookie it carries (r2's OAuth2OnlyController authenticates every
 *  request with the token; a missing one fails require(access_token)).
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/reddit_base.py "class OAuth2OnlyController(OAuth2ResourceController):" */
function oauthOnly(): Response {
  return httpError(401, { 'www-authenticate': 'Bearer realm="reddit", error="invalid_token"' });
}

/** A write on reddit.com with nobody signed in: Reddit's validated actions answer USER_REQUIRED (r2's api_validate:
 *  "except UserRequiredException: responder.send_failure(errors.USER_REQUIRED)"), in the api_type=json form.
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/lib/validator/validator.py "responder.send_failure(errors.USER_REQUIRED)" */
function signedOutWrite(): Response {
  return jsonAnswer([err('USER_REQUIRED', null)]);
}

/** A read on reddit.com's own host without `.json`: there Reddit answers its HTML page, not the API's JSON (dev/api's
 *  listings are read as /r/<name>/new.json on www.reddit.com); the pages the twin draws are its screens, which answer
 *  before this, so any other is a page the twin does not draw. */
function pageNotDrawn(): Response {
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>reddit.com: page not found</title></head><body><h1>Page not found</h1></body></html>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** The host a request was made to: the World's proxy keeps it in Host, or names it when it rewrote Host. */

/** An answer with headers added, and its JSON encoded the legacy way where the call did not ask raw_json=1. */
async function finished(res: Response, headers: Record<string, string>, raw: boolean): Promise<Response> {
  const out = new Headers(res.headers);
  for (const [k, v] of Object.entries(headers)) out.set(k, v);
  if (raw || !(res.headers.get('content-type') ?? '').includes('json')) return new Response(res.body, { status: res.status, headers: out });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { return new Response(text, { status: res.status, headers: out }); }
  out.delete('content-length');
  return new Response(JSON.stringify(legacyEncoded(body)), { status: res.status, headers: out });
}

/** A write from a session whose page's modhash it does not carry: refused as Reddit refuses a request it cannot trust. */
function badModhash(): Response {
  return httpError(403);
}

/** A call with no credential at all. Where the documentation stops: Reddit answers one as unauthorized; the twin answers
 *  401 in Reddit's error form, without naming a token error. */
function noCredential(): Response {
  return httpError(401);
}

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  const op = ctx.call.operation;
  const url = new URL(ctx.call.request.url);
  const raw = url.searchParams.get('raw_json') === '1';
  const headers = new Headers(ctx.call.request.headers);
  // only this front names a caller
  headers.delete(CALLER_HEADER);
  if (OWN_AUTH.has(op.id) || op.id === 'unmatched') return next(new Request(ctx.call.request, { headers }));
  const auth = ctx.call.request.headers.get('authorization') ?? '';
  const bearer = /^bearer\s+(\S+)$/i.exec(auth.trim())?.[1];
  let caller: Caller | undefined;
  let rate: Record<string, string> = {};
  if (bearer) {
    const found = bearerCaller(ctx, bearer);
    // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/reddit_base.py "self._auth_error(401, \"invalid_token\")"
    if (found === 'invalid') return httpError(401, { 'www-authenticate': 'Bearer realm="reddit", error="invalid_token"' });
    caller = found;
    // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/controllers/reddit_base.py "self._auth_error(403, \"insufficient_scope\")"
    const scopes = (op.scopes ?? []).filter((s) => s !== 'any');
    if (scopes.length && !scopes.some((s) => hasScope(found, s))) return httpError(403, { 'www-authenticate': 'Bearer realm="reddit", error="insufficient_scope"' });
    const window = await rateWindow(ctx, found.client);
    if (window.over) return overLimit(window.headers);
    rate = window.headers;
  } else {
    if (op.id === 'GET_api_v1_me') return oauthOnly();
    // reddit.com's pages call the API on their own origin (www.reddit.com, or the World's place for the twin) with the
    // person's cookie; oauth.reddit.com takes bearer tokens alone (the OAuth2 wiki: "API requests with a bearer token
    // should be made to https://oauth.reddit.com, NOT www.reddit.com"), so a cookie there names nobody
    // source: https://github.com/reddit-archive/reddit/wiki/OAuth2 "API requests with a bearer token should be made to https://oauth.reddit.com, NOT www.reddit.com."
    const onPages = ctx.call.request.headers.has('x-forwarded-prefix') || hostOf(ctx.call.request) !== 'oauth.reddit.com';
    if (onPages && ctx.call.request.method === 'GET' && !url.pathname.endsWith('.json')) return pageNotDrawn();
    const session = onPages ? await sessionCaller(ctx) : undefined;
    if (!session && onPages && ctx.call.request.method !== 'GET') return signedOutWrite();
    if (session) {
      // a write from a page carries the page's modhash (dev/api: "The preferred way to send a modhash is to include an
      // X-Modhash custom HTTP header with your requests.")
      // source: https://www.reddit.com/dev/api "The preferred way to send a modhash is to include an X-Modhash custom HTTP header with your requests."
      if (ctx.call.request.method !== 'GET' && !session.modhashOk) return badModhash();
      caller = session.caller;
    } else if (!PUBLIC_READS.has(op.id)) return noCredential();
  }
  if (caller) headers.set(CALLER_HEADER, JSON.stringify(caller));
  return finished(await next(new Request(ctx.call.request, { headers })), rate, raw);
}
