// Better Auth's own sign-in routes this service offers (auth.ts socialProviders): a social sign-in, begun (GitHub,
// Google) or made at once with the provider's own ID token (Apple in RH2's iOS app), and the provider's callback, which trades the code at the provider (the World's twin of it, through `ctx.vendorFetch`), finds
// or links the person (ADR-0001 section 2: "a provider joins an existing identity implicitly only when it vouches for the
// email"; `accountLinking.trustedProviders: ["github", "google"]`), signs the browser in and returns it where it began.
import type { HandlerContext } from '@volter/world-core';
import { ACCOUNT, apiError, beginSocial, callbackUrl, ID_TOKEN_PROVIDERS, issuerOf, live, nowSeconds, OAUTH_STATE, PROVIDERS, type Row, SESSION, SESSION_COOKIE, signIn, SOCIAL, USER, userByEmail, serial } from './shared.ts';

const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' ? ctx.body as Row : {});
/** A failed sign-in lands on the service's own error page (auth.ts: `onAPIError: { errorURL: \`${issuer}/error\` }`). */
const failed = (ctx: HandlerContext, error: string): Response => new Response(null, { status: 302, headers: { location: `${issuerOf(ctx)}/error?error=${encodeURIComponent(error)}` } });


/** The person a provider's code names: GitHub's user (its numeric id, login, name, verified primary email) or Google's
 *  ID token (its sub, email, name, picture). */
async function personFrom(ctx: HandlerContext, provider: string, code: string): Promise<{ accountId: string; email: string; emailVerified: boolean; name: string | null; image: string | null; login?: string } | string> {
  const config = live(ctx.row(SOCIAL, provider))!;
  const p = PROVIDERS[provider]!;
  const form = new URLSearchParams({ client_id: String(config.client_id), client_secret: String(config.client_secret), code, redirect_uri: callbackUrl(ctx, provider), ...(provider === 'google' ? { grant_type: 'authorization_code' } : {}) });
  let tokens: Row;
  try {
    const res = await ctx.vendorFetch(p.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: form.toString() });
    tokens = (await res.json().catch(() => ({}))) as Row;
    if (!res.ok) return `the provider refused the code (${res.status})`;
  } catch (error) { return (error as Error).message; }
  if (provider === 'google') {
    if (typeof tokens.id_token !== 'string') return 'the provider answered no ID token';
    const claims = await idTokenPerson(ctx, provider, config, tokens.id_token, undefined);
    if (!claims) return 'the provider answered an invalid ID token';
    if (typeof claims.email !== 'string') return 'the provider named no email';
    return { accountId: String(claims.sub), email: claims.email.toLowerCase(), emailVerified: claims.email_verified === true || claims.email_verified === 'true', name: typeof claims.name === 'string' ? claims.name : null, image: typeof claims.picture === 'string' ? claims.picture : null };
  }
  const token = String(tokens.access_token ?? '');
  if (!token) return 'the provider answered no access token';
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' };
  const user = (await (await ctx.vendorFetch('https://api.github.com/user', { headers })).json()) as Row;
  const emails = (await (await ctx.vendorFetch('https://api.github.com/user/emails', { headers })).json().catch(() => [])) as Row[];
  const primary = (Array.isArray(emails) ? emails : []).find((e) => e.primary === true && e.verified === true)?.email;
  if (typeof primary !== 'string') return 'the provider named no verified email';
  return { accountId: String(user.id), email: primary.toLowerCase(), emailVerified: true, name: typeof user.name === 'string' ? user.name : null, image: typeof user.avatar_url === 'string' ? user.avatar_url : null, login: typeof user.login === 'string' ? user.login : undefined };
}

async function callback(ctx: HandlerContext): Promise<Response> {
  const provider = String(ctx.call.params.id ?? '');
  const state = live(ctx.row(OAUTH_STATE, String(ctx.params.state ?? '')));
  if (!state || state.provider !== provider) return failed(ctx, 'state_mismatch');
  await ctx.remove(OAUTH_STATE, String(ctx.params.state), 'oauth_state.consume');
  if (typeof ctx.params.error === 'string') return failed(ctx, ctx.params.error);
  const person = await personFrom(ctx, provider, String(ctx.params.code ?? ''));
  if (typeof person === 'string') return failed(ctx, person);
  // the person: the one this provider account already belongs to, else the one with its email (a trusted provider links
  // implicitly), else a new identity
  const linked = ctx.rowsRaw(ACCOUNT).find((a) => a.deleted !== true && a.providerId === provider && a.accountId === person.accountId);
  let user = linked ? live(ctx.row(USER, String(linked.userId))) : userByEmail(ctx, person.email);
  if (user && !linked && (!person.emailVerified || user.emailVerified !== true)) return failed(ctx, 'account_not_linked');
  if (!user) {
    const id = ctx.mint(USER);
    await ctx.write(USER, id, { id, email: person.email, emailVerified: person.emailVerified, name: person.name, image: person.image, githubLogin: person.login ?? null, createdAt: ctx.occurredAt }, 'user.create');
    user = ctx.row(USER, id)!;
  } else if (provider === 'github' && person.login && user.githubLogin !== person.login) {
    // auth.ts: GitHub's `mapProfileToUser: (profile) => ({ githubLogin: profile.login })`, on every sign-in
    await ctx.write(USER, String(user.id), { githubLogin: person.login }, 'user.update');
  }
  if (!linked) {
    const aid = ctx.mint(ACCOUNT);
    await ctx.write(ACCOUNT, aid, { id: aid, userId: user.id, providerId: provider, accountId: person.accountId, createdAt: ctx.occurredAt }, 'account.create');
  }
  // drawn from a secret the World holds (ctx.secret): the session cookie signs a person in
  const token = ctx.crypto.uuidFrom(await ctx.secret(`volteridentity:session:${String(user.id)}:${ctx.occurredAt}:${await serial(ctx, 'session')}`));
  await ctx.record(SESSION, { user: user.id, created: ctx.occurredAt, expires: nowSeconds(ctx) + 30 * 86400 }, ctx.crypto.digest('sha256', token, 'hex'));
  return new Response(null, { status: 302, headers: { location: String(state.returnTo), 'set-cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` } });
}

// source: https://www.better-auth.com/docs/authentication/github "Make sure to set the redirect URL to"
// source: spec:/paths/~1api~1auth~1callback~1{id}/get "Bad Request. Usually due to missing parameters, or invalid parameters."
export async function get_api_auth_callback_id(ctx: HandlerContext): Promise<Response> { return callback(ctx); }

/** The person a provider's ID token names, when it holds: signed by the provider's published keys (fetched from the
 *  World's twin of the provider), its issuer, an audience the service accepts, at most an hour old, and the nonce. */
async function idTokenPerson(ctx: HandlerContext, provider: string, config: Row, token: string, nonce: string | undefined): Promise<Row | undefined> {
  const p = ID_TOKEN_PROVIDERS[provider]!;
  let keys: unknown;
  // source: https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/core/src/oauth2/verify-id-token.ts "return false;"
  // A provider's keys fetch failing is a verification failure, as the provider verifier's catch states.
  try { keys = await (await ctx.vendorFetch(p.keys)).json(); } catch { return undefined; }
  const verdict = ctx.crypto.jwtVerify(token, keys as never, { now: nowSeconds(ctx) }) as { valid: boolean; payload?: Row };
  const claims = verdict.valid ? verdict.payload : undefined;
  if (!claims || !p.issuers.includes(String(claims.iss))) return undefined;
  const audiences = String(config.client_id).split(',').map((a) => a.trim()).filter(Boolean);
  const aud = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud)];
  if (!aud.some((a) => audiences.includes(a))) return undefined;
  if (typeof claims.iat === 'number' && nowSeconds(ctx) - claims.iat > 3600) return undefined;
  // Apple's nonce is the raw one or its SHA-256 hex digest (Better Auth's nonceComparison "exact-or-sha256")
  if (nonce !== undefined && claims.nonce !== nonce && !(p.sha256Nonce && claims.nonce === ctx.crypto.digest('sha256', nonce, 'hex'))) return undefined;
  return claims;
}

/** `POST /api/auth/sign-in/social`: with the provider's ID token, the person signed in at once (a session cookie and its
 *  token); without one, the provider's authorize URL to send the browser to. */
// source: spec:socialSignIn "Sign in with a social provider"
export async function socialSignIn(ctx: HandlerContext): Promise<Response> {
  const b = bodyOf(ctx);
  const provider = String(b.provider ?? '');
  const config = live(ctx.row(SOCIAL, provider));
  // source: spec:/paths/~1api~1auth~1sign-in~1social/post/responses/404/description "Not Found. The requested resource was not found."
  return !config ? apiError(404, 'PROVIDER_NOT_FOUND', 'Provider not found') : configuredSignIn(ctx, b, provider, config);
}

/** The social request uses the provider credentials configured for this World. */
async function configuredSignIn(ctx: HandlerContext, b: Row, provider: string, config: Row): Promise<Response> {
  const given = b.idToken && typeof b.idToken === 'object' ? b.idToken as Row : undefined;
  if (!given) {
    const url = PROVIDERS[provider] ? await beginSocial(ctx, provider, typeof b.callbackURL === 'string' ? b.callbackURL : issuerOf(ctx)) : undefined;
    if (!url) return apiError(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
    const redirect = b.disableRedirect !== true;
    return Response.json({ url, redirect }, redirect ? { headers: { location: url } } : {});
  }
  if (!ID_TOKEN_PROVIDERS[provider]) return apiError(404, 'ID_TOKEN_NOT_SUPPORTED', 'id_token not supported');
  // source: spec:/paths/~1api~1auth~1sign-in~1social/post/responses/401/description "Unauthorized. Due to missing or invalid authentication."
  const claims = await idTokenPerson(ctx, provider, config, String(given.token ?? ''), typeof given.nonce === 'string' ? given.nonce : undefined);
  // source: https://raw.githubusercontent.com/better-auth/better-auth/v1.7.5/packages/better-auth/src/api/routes/sign-in.ts "BASE_ERROR_CODES.INVALID_TOKEN"
  return !claims ? apiError(401, 'INVALID_TOKEN', 'Invalid token') : verifiedIdTokenSignIn(ctx, given, provider, claims);
}

/** Sign-in after the provider's keys have verified the client-submitted ID token. */
// source: spec:socialSignIn "Sign in with a social provider"
async function verifiedIdTokenSignIn(ctx: HandlerContext, given: Row, provider: string, claims: Row): Promise<Response> {
  if (typeof claims.email !== 'string') return apiError(401, 'USER_EMAIL_NOT_FOUND', 'User email not found');
  const email = claims.email.toLowerCase();
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  // Apple sends the name only the first time, in the app's own `user` (Better Auth's getUserInfo)
  const named = (given.user as { name?: { firstName?: string; lastName?: string } } | undefined)?.name;
  const name = named ? `${named.firstName ?? ''} ${named.lastName ?? ''}`.trim() : typeof claims.name === 'string' ? claims.name : '';
  const accountId = String(claims.sub);
  const held = ctx.rowsRaw(ACCOUNT).find((a) => a.deleted !== true && a.providerId === provider && a.accountId === accountId);
  let user = held ? live(ctx.row(USER, String(held.userId))) : userByEmail(ctx, email);
  // an existing identity is joined implicitly only by a trusted provider (GitHub, Google) or one that vouches for the
  // email (auth.ts accountLinking; Apple is not on the trusted list)
  if (user && !held && (!verified || user.emailVerified !== true)) return apiError(401, 'OAUTH_LINK_ERROR', 'account not linked');
  if (!user) {
    const id = ctx.mint(USER);
    await ctx.write(USER, id, { id, email, emailVerified: verified, name: name || null, image: null, githubLogin: null, createdAt: ctx.occurredAt, updatedAt: ctx.occurredAt }, 'user.create');
    user = ctx.row(USER, id)!;
  }
  if (!held) {
    const aid = ctx.mint(ACCOUNT);
    await ctx.write(ACCOUNT, aid, { id: aid, userId: user.id, providerId: provider, accountId, createdAt: ctx.occurredAt }, 'account.create');
  }
  const cookie = await signIn(ctx, user);
  const token = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';')));
  // source: spec:/components/schemas/User/required "updatedAt"
  const own = ctx.own(user);
  return Response.json({ redirect: false, token, user: { id: user.id, email: user.email, name: user.name ?? '', image: user.image ?? null, emailVerified: user.emailVerified === true, createdAt: own.createdAt, updatedAt: own.updatedAt } }, { headers: { 'set-cookie': cookie } });
}
