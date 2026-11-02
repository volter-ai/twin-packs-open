// What every family of Volter Identity shares: the issuer, its signing key, the World's people, registered product clients,
// browser sessions, and the tokens it issues. The live discovery document (spec/recordings/2026-09-29-openid-configuration.json)
// is what the twin answers. Tokens are signed EdDSA (Ed25519), as the service's Better Auth signs them.
import type { HandlerContext, WriteHookContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
type Reader = Pick<HandlerContext, 'row' | 'rowsRaw' | 'crypto' | 'occurredAt'> | Pick<WriteHookContext, 'row' | 'rowsRaw' | 'crypto' | 'occurredAt'> ;

/** The permanent issuer (worker/src/auth.ts: "The permanent issuer, `https://id.volter.ai` in production"). */
export const ISSUER = 'https://id.volter.ai';
// source: recording:auth-source.txt "const issuer = env.ISSUER.replace(/\/$/u, \"\");"
// source: recording:auth-source.txt "baseURL: issuer,"
// ISSUER is an installation setting, shared by every route into the service. Its default is the descriptor's
// id.volter.ai host; the operator sets a local installation before registering clients or issuing tokens.
export function issuerOf(ctx: Pick<HandlerContext, 'row'>): string {
  const setting = ctx.row('_settings', 'service')?.ISSUER;
  return (typeof setting === 'string' ? setting : ISSUER).replace(/\/$/u, '');
}
export const authOf = (ctx: Pick<HandlerContext, 'row'>): string => `${issuerOf(ctx)}/api/auth`;
/** The organizations resource a product's client_credentials token is for (worker/src/product.ts). */
export const organizationsOf = (ctx: Pick<HandlerContext, 'row'>): string => `${issuerOf(ctx)}/organizations`;
export const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'organizations'];
/** The browser session's cookie (auth.ts: `cookiePrefix: "volter-id"`, Better Auth's `session_token`). */
export const SESSION_COOKIE = 'volter-id.session_token';

export const USER = 'user';
export const CLIENT = 'oauth_client';
export const ORGANIZATION = 'organization';
export const MEMBER = 'member';
export const INVITATION = 'invitation';
export const SESSION = '_session';
export const CODE = '_authorization_code';
export const REFRESH = '_refresh_token';
export const DEVICE = '_device_code';
/** A resource access tokens may name as their audience (RFC 8707), registered by the operator (`/admin/resources`). */
export const RESOURCE = '_oauth_resource';
/** The shared client every Volter tool on a machine signs in with (@volter/identity 0.4.1 `SHARED_CLIENTS`). */
export const SHARED_CLIENT_ID = 'tNHCzlsPsYnAhEKyiuheNqqwPSfgEWQG';

// ── the operator ───────────────────────────────────────────────────────────────────────────────

/** The service's admin token (IDENTITY_ADMIN_TOKEN): the operator's setting, which no API reads; in a World drawn from
 *  the World's secrets, the same at every boot, and handed to the World's application by the credential door. */
export const adminToken = async (ctx: Pick<HandlerContext, 'secret' | 'crypto'>): Promise<string> =>
  ctx.crypto.lettersFrom(await ctx.secret('volteridentity:identity-admin-token'), 40);

/** Whether a client may name `resource` (RFC 8707): the resources the operator linked to it (index.ts: "the token
 *  endpoint refuses a resource the client is not linked to"). */
export const linked = (client: Row, resource: string): boolean => ((client.resources as string[] | undefined) ?? []).includes(resource);
/** Whether a client was registered for a grant (its `grant_types`). */
export const grants = (client: Row, grant: string): boolean => ((client.grant_types as string[] | undefined) ?? []).includes(grant);

/** A client as Better Auth keeps it (its secret by its SHA-256), from registration metadata with Better Auth's defaults
 *  applied (`client_secret_basic`, `web`, `authorization_code`, the `code` response type). */
export async function registerClient(ctx: HandlerContext, clientId: string, secret: string | undefined, b: Row, owner: string | null): Promise<Row> {
  const grantTypes = Array.isArray(b.grant_types) ? b.grant_types.map(String) : ['authorization_code'];
  const row: Row = {
    client_id: clientId, secret_sha256: secret ? ctx.crypto.digest('sha256', secret, 'hex') : null,
    token_endpoint_auth_method: typeof b.token_endpoint_auth_method === 'string' ? b.token_endpoint_auth_method : 'client_secret_basic',
    redirect_uris: Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [], client_name: typeof b.client_name === 'string' ? b.client_name : null,
    logo_uri: typeof b.logo_uri === 'string' ? b.logo_uri : null, scope: typeof b.scope === 'string' ? b.scope : null, grant_types: grantTypes,
    response_types: Array.isArray(b.response_types) ? b.response_types.map(String) : grantTypes.includes('authorization_code') ? ['code'] : [],
    application_type: typeof b.application_type === 'string' ? b.application_type : 'web', skip_consent: b.skip_consent === true, require_pkce: b.require_pkce !== false,
    client_credentials_scopes: Array.isArray(b.client_credentials_scopes) ? b.client_credentials_scopes.map(String) : [], resources: [],
    user_id: owner, client_id_issued_at: nowSeconds(ctx), createdAt: ctx.occurredAt,
  };
  await ctx.write(CLIENT, clientId, row, 'oauth_client.create');
  return row;
}

/** The issuer's signing key: the World's Ed25519 key, made once at random (ctx.signingKey), so a token verifies against
 *  this World's JWKS and no one forges one from the pack; EdDSA, as the live discovery document's
 *  id_token_signing_alg_values_supported says. */
const issuerKey = async (ctx: Pick<HandlerContext, 'signingKey'>) => ({ alg: 'EdDSA' as const, ...(await ctx.signingKey('volteridentity-issuer-ed25519', 'Ed25519')) });
export const jwksOf = async (ctx: Pick<HandlerContext, 'crypto' | 'signingKey'>): Promise<unknown> => ctx.crypto.jwks((await issuerKey(ctx)).publicPem, '');

export const nowSeconds = (ctx: Pick<HandlerContext, 'occurredAt'>): number => Math.floor(Date.parse(ctx.occurredAt) / 1000);

/** A signed JWT from the issuer, valid for `ttl` seconds from the World clock. */
// The provider's payload has iat/exp and no nbf; the JWT plugin sets not-before only for an explicit claim.
// source: recording:provider-signing-source.txt "const iat = overrides?.iat ?? Math.floor(Date.now() / 1e3);"
// source: recording:provider-signing-source.txt "if (payload.nbf) jwt.setNotBefore(payload.nbf);"
export const sign = async (ctx: Pick<HandlerContext, 'crypto' | 'occurredAt' | 'signingKey' | 'row'>, claims: Row, ttl: number): Promise<string> =>
  ctx.crypto.jwtSign({ nbf: undefined, iss: issuerOf(ctx), ...claims }, await issuerKey(ctx), { now: nowSeconds(ctx), expiresInSeconds: ttl, kidPrefix: '' });

/** A token's claims when it is the issuer's and current, else undefined. */
export async function verified(ctx: Pick<HandlerContext, 'crypto' | 'occurredAt' | 'signingKey' | 'row'>, token: string): Promise<Row | undefined> {
  const verdict = ctx.crypto.jwtVerify(token, (await jwksOf(ctx)) as never, { now: nowSeconds(ctx) }) as { valid: boolean; payload?: Row };
  return verdict.valid && verdict.payload?.iss === issuerOf(ctx) ? verdict.payload : undefined;
}

/** Better Auth's error body (its `APIError`): the code and its message. */
export const apiError = (status: number, code: string, message: string): Response =>
  Response.json({ code, message }, { status, headers: { 'cache-control': 'no-store' } });

/** An OAuth error body (RFC 6749 section 5.2). */
export const oauthError = (status: number, error: string, description: string): Response =>
  Response.json({ error, error_description: description }, { status, headers: { 'cache-control': 'no-store' } });

// ── people, clients, sessions ──────────────────────────────────────────────────────────────────

export const live = (r: Row | undefined): Row | undefined => (r && r.deleted !== true ? r : undefined);
export const userById = (ctx: Reader, id: string): Row | undefined => live(ctx.row(USER, id));
export const userByEmail = (ctx: Reader, email: string): Row | undefined =>
  ctx.rowsRaw(USER).find((u) => u.deleted !== true && String(u.email).toLowerCase() === email.toLowerCase());
export const clientById = (ctx: Reader, id: string): Row | undefined => live(ctx.row(CLIENT, id));

/** Whether a client is public: registered with no secret (`token_endpoint_auth_method: none`), as the shared client
 *  every Volter tool on a machine signs in with is (@volter/identity 0.4.1 `SHARED_CLIENTS`, which sends no secret). */
export const isPublic = (client: Row): boolean => client.secret_sha256 === null || client.secret_sha256 === undefined;

/** The client a request authenticates as: `client_secret_basic` or `client_secret_post`, its secret checked by its
 *  SHA-256, or a public client by its id alone with no secret sent (`none`; the discovery document's
 *  `token_endpoint_auth_methods_supported`). */
export function clientOf(ctx: Reader & { call: HandlerContext['call'] }, params: Row): Row | undefined {
  let id = typeof params.client_id === 'string' ? params.client_id : undefined;
  let secret = typeof params.client_secret === 'string' ? params.client_secret : undefined;
  const basic = /^Basic\s+(.+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (basic) { const pair = basicCredentials(basic); if (!pair) return undefined; [id, secret] = pair; }
  const client = id ? clientById(ctx, id) : undefined;
  if (client && isPublic(client)) return secret === undefined ? client : undefined;
  return client && secret !== undefined && client.secret_sha256 === ctx.crypto.digest('sha256', secret, 'hex') ? client : undefined;
}

/** A confidential OAuth client encodes its issued credentials in the Basic header. */
// source: https://www.better-auth.com/docs/plugins/oauth-provider "Client credentials sent via HTTP Basic Auth header"
function basicCredentials(basic: string): [string, string] | undefined {
  try { const pair = atob(basic); const at = pair.indexOf(':'); return at < 0 ? undefined : [decodeURIComponent(pair.slice(0, at)), decodeURIComponent(pair.slice(at + 1))]; } catch { return undefined; }
}

/** Whether a redirect_uri is one registered for the client. A loopback redirect (`http://127.0.0.1` or `[::1]`) matches
 *  on any port: "The authorization server MUST allow any port to be specified at the time of the request for loopback IP
 *  redirect URIs" (RFC 8252 7.3), which @volter/identity's sign-in relies on, listening on a port the system picks. */
export function redirectAllowed(client: Row, redirect: string): boolean {
  const registered = (client.redirect_uris as string[] | undefined) ?? [];
  if (registered.includes(redirect)) return true;
  let asked: URL;
  try { asked = new URL(redirect); } catch { return false; }
  if (asked.protocol !== 'http:' || (asked.hostname !== '127.0.0.1' && asked.hostname !== '[::1]')) return false;
  return registered.some((r) => {
    try { const u = new URL(r); return u.protocol === 'http:' && u.hostname === asked.hostname && u.pathname === asked.pathname && u.search === asked.search; } catch { return false; }
  });
}

/** The person a browser's session cookie names. */
export function sessionUser(ctx: Reader & { call: HandlerContext['call'] }): Row | undefined {
  const session = sessionOf(ctx);
  return session ? userById(ctx, String(session.user)) : undefined;
}

/** The session's original creation instant is the authentication time on authorization and refresh. */
export function sessionOf(ctx: Reader & { call: HandlerContext['call'] }): Row | undefined {
  const cookie = ctx.call.request.headers.get('cookie') ?? '';
  const token = cookie.split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const session = token ? live(ctx.row(SESSION, ctx.crypto.digest('sha256', decodeURIComponent(token), 'hex'))) : undefined;
  return session && Number(session.expires) > nowSeconds(ctx) ? session : undefined;
}

export const ACCOUNT = 'account';
export const SOCIAL = '_social_provider';
export const OAUTH_STATE = '_oauth_state';

/** The accounts a product may recognise a person by (auth.ts `linkedClaims`, ADR-0001 section 3): the linked GitHub
 *  account's numeric id and its login, on every token and on userinfo. */
export function linkedClaims(ctx: Reader, user: Row): Row {
  const github = ctx.rowsRaw(ACCOUNT).find((a) => a.deleted !== true && a.userId === user.id && a.providerId === 'github');
  return {
    ...(github ? { 'https://volter.ai/github_id': String(github.accountId) } : {}),
    ...(user.githubLogin ? { 'https://volter.ai/github_login': user.githubLogin } : {}),
  };
}

/** A person's claims for the scopes granted, as userinfo answers them: the email when `email` was granted, the name and
 *  picture for `profile`. */
// source: recording:auth-source.txt "email_verified: user.emailVerified"
export function claimsOf(user: Row, scopes: string[]): Row {
  return {
    ...(scopes.includes('email') ? { email: user.email, email_verified: user.emailVerified === true } : {}),
    ...(scopes.includes('profile') ? { name: user.name ?? null, picture: user.image ?? null } : {}),
  };
}

/** An access token's claims about its person (auth.ts `customAccessTokenClaims`, RFC 9068 2.2.1): the email when `email`
 *  was granted, the name when `profile` was and the person has one. */
// source: recording:auth-source.txt "email_verified: user.emailVerified"
const accessClaims = (user: Row, scopes: string[]): Row => ({
  ...(scopes.includes('email') ? { email: user.email, email_verified: user.emailVerified === true } : {}),
  ...(scopes.includes('profile') && user.name ? { name: user.name } : {}),
});

/** The tokens a grant answers: an access token for its audience (the resource asked, else the client), an ID token when
 *  `openid` was granted to a person, and a refresh token when `offline_access` is in the requested or existing refresh
 *  grant's scopes. The ID token names the person and
 *  their linked accounts only (auth.ts `customIdTokenClaims`); their email and name are userinfo's. */
// source: recording:provider-source.txt "const isJwtAccessToken = audienceClaim && !opts.disableJwtPlugin;"
// source: recording:provider-source.txt "acr: \"0\""
// source: recording:provider-source.txt "if (signingAlg === \"EdDSA\") hashAlg = \"SHA-512\";"
export async function tokensFor(ctx: HandlerContext, client: Row, user: Row | undefined, scopes: string[], resource: string | undefined, nonce?: string, authTime?: number, existingRefresh?: Row): Promise<Response> {
  const clientId = String(client.client_id);
  const subject = user ? String(user.id) : clientId;
  const links = user ? linkedClaims(ctx, user) : {};
  // A narrowed refresh still issues its successor when its existing grant had offline_access.
  // source: recording:provider-refresh-source.txt "existingRefreshToken?.scopes?.includes(\"offline_access\") || scopes.includes(\"offline_access\")"
  const existingRefreshScopes = existingRefresh?.scopes as string[] | undefined;
  const refresh = user && (existingRefreshScopes?.includes('offline_access') || scopes.includes('offline_access'))
    ? ctx.crypto.uuidFrom(await ctx.secret(`volteridentity:refresh:${clientId}:${subject}:${ctx.occurredAt}:${await serial(ctx, 'refresh')}`)) : undefined;
  const refreshId = refresh ? ctx.crypto.digest('sha256', refresh, 'hex') : null;
  if (refreshId) {
    // Only actual successor issuance revokes its predecessor. A grant with no
    // offline scope on either side remains reusable without invalidating its family.
    // source: recording:provider-refresh-source.txt "revoked: rotatedAt"
    if (existingRefresh) {
      const key = String(existingRefresh.id);
      const refusal = ctx.legal(REFRESH, 'status', 'post_api_auth_oauth2_token', existingRefresh.status ?? 'active', 'rotated', key);
      if (refusal) return ctx.refuse(refusal);
      await ctx.record(REFRESH, { ...ctx.own(existingRefresh), status: 'rotated', revoked: ctx.occurredAt }, key);
    }
    await ctx.record(REFRESH, { client: clientId, user: subject, scopes, status: 'active', auth_time: authTime ?? null, resource: resource ?? null, created: ctx.occurredAt, expires: nowSeconds(ctx) + 30 * 86400 }, refreshId);
  }
  const access = resource ? await sign(ctx, { sub: subject, aud: resource, azp: clientId, client_id: clientId, scope: scopes.join(' '), ...links, ...(user ? accessClaims(user, scopes) : {}) }, 3600) : ctx.crypto.lettersFrom(await ctx.secret(`volteridentity:access:${clientId}:${subject}:${ctx.occurredAt}:${await serial(ctx, 'access')}`), 32);
  if (!resource) await ctx.record('_access_token', { client: clientId, user: user?.id ?? null, scopes, refreshId, expires: nowSeconds(ctx) + 3600 }, ctx.crypto.digest('sha256', access, 'hex'));
  const out: Row = { access_token: access, token_type: 'Bearer', expires_in: 3600, scope: scopes.join(' ') };
  if (user && scopes.includes('openid')) {
    const half = ctx.crypto.digest('sha512', access, 'hex').slice(0, 64);
    const atHash = btoa(String.fromCharCode(...half.match(/../g)!.map((pair) => parseInt(pair, 16)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    out.id_token = await sign(ctx, { sub: subject, aud: clientId, acr: '0', at_hash: atHash, ...(authTime !== undefined ? { auth_time: authTime } : {}), ...(nonce ? { nonce } : {}), ...links }, 3600);
  }
  if (refresh) out.refresh_token = refresh;
  return Response.json(out, { headers: { 'cache-control': 'no-store' } });
}

// ── social sign-in (auth.ts socialProviders: GitHub, Google) ────────────────────────────────────

/** Each provider's endpoints and Better Auth's default scopes for it; Google with `prompt: "select_account"` (auth.ts). */
export const PROVIDERS: Record<string, { authorize: string; token: string; scope: string; extra: Record<string, string> }> = {
  github: { authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', scope: 'read:user user:email', extra: {} },
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'email profile openid', extra: { response_type: 'code', prompt: 'select_account' } },
};
/** The providers whose own ID token signs a person in (Better Auth's `idToken` sign-in): where each publishes its keys,
 *  its issuer, and how a nonce is matched (Apple's: the raw nonce or its SHA-256 hex digest). Apple is offered to the
 *  apps the operator names (auth.ts `APPLE_APP_IDS`), its audience those apps; Google's audience is the service's client. */
export const ID_TOKEN_PROVIDERS: Record<string, { keys: string; issuers: string[]; sha256Nonce: boolean }> = {
  apple: { keys: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'], sha256Nonce: true },
  google: { keys: 'https://www.googleapis.com/oauth2/v3/certs', issuers: ['https://accounts.google.com', 'accounts.google.com'], sha256Nonce: false },
};
export const callbackUrl = (ctx: Pick<HandlerContext, 'row'>, provider: string): string => `${authOf(ctx)}/callback/${provider}`;

/** The providers the World's identity service has an OAuth app with (the doors' `/_twin/social`). */
export const socialProviders = (ctx: Reader): string[] => ctx.rowsRaw(SOCIAL).filter((r) => r.deleted !== true && PROVIDERS[String(r.id)]).map((r) => String(r.id)).sort();

/** A social sign-in begun: its state kept with where to return, and the provider's authorize URL. */
export async function beginSocial(ctx: Pick<HandlerContext, 'row' | 'rowsRaw' | 'crypto' | 'record' | 'occurredAt' | 'secret' | 'issue'>, provider: string, returnTo: string): Promise<string | undefined> {
  const config = live(ctx.row(SOCIAL, provider));
  const p = PROVIDERS[provider];
  if (!config || !p) return undefined;
  return configuredSocial(ctx, provider, returnTo, config, p);
}

async function configuredSocial(ctx: Pick<HandlerContext, 'crypto' | 'record' | 'occurredAt' | 'secret' | 'issue' | 'row'>, provider: string, returnTo: string, config: Row, p: (typeof PROVIDERS)[string]): Promise<string> {
  const state = ctx.crypto.uuidFrom(await ctx.secret(`volteridentity:state:${provider}:${ctx.occurredAt}:${await serial(ctx, 'oauth_state')}`));
  await ctx.record(OAUTH_STATE, { provider, returnTo, created: ctx.occurredAt }, state);
  const url = new URL(p.authorize);
  for (const [k, v] of Object.entries({ client_id: String(config.client_id), redirect_uri: callbackUrl(ctx, provider), scope: p.scope, state, ...p.extra })) url.searchParams.set(k, v);
  return url.toString();
}

// ── the service's own pages (screens/login.ts, device.ts, error.ts share them) ─────────────────

export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const page = (title: string, body: string, headers: Record<string, string> = {}): Response =>
  new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Volter</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#f5f4ef;margin:0}main{max-width:420px;margin:56px auto;background:#fff;border:1px solid #ddd;border-radius:10px;padding:28px}h1{font-size:20px}button{display:block;width:100%;margin:8px 0;padding:10px;border:1px solid #111;border-radius:8px;background:#111;color:#fff;font:inherit;cursor:pointer}input{width:100%;box-sizing:border-box;padding:9px;border:1px solid #bbb;border-radius:8px;font:inherit}small{color:#666}</style></head><body><main>${body}</main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

/** The World's people, each a button that signs in as them. */
export const people = (ctx: HandlerContext, action: string, hidden: Record<string, string>): string => {
  const rows = ctx.rowsRaw('user').filter((u) => u.deleted !== true).sort((a, b) => String(a.email).localeCompare(String(b.email)));
  const fields = Object.entries(hidden).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return rows.length === 0
    ? '<p>No one can sign in yet: the World holds no Volter identity.</p>'
    : rows.map((u: Row) => `<form method="post" action="${esc(action)}">${fields}<input type="hidden" name="email" value="${esc(u.email)}"><button type="submit">Continue as ${esc(u.name ?? u.email)} <small>${esc(u.email)}</small></button></form>`).join('');
};

/** A session for a person: its token in the cookie, kept by its SHA-256. */
export async function signIn(ctx: HandlerContext, user: Row): Promise<string> {
  // drawn from a secret the World holds (ctx.secret): the session cookie signs a person in
  const token = ctx.crypto.uuidFrom(await ctx.secret(`volteridentity:session:${String(user.id)}:${ctx.occurredAt}:${await serial(ctx, 'session')}`));
  await ctx.record(SESSION, { user: user.id, created: ctx.occurredAt, expires: nowSeconds(ctx) + 30 * 86400 }, ctx.crypto.digest('sha256', token, 'hex'));
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`;
}

/** The World's next number (a nonce in a secret's label, a numeric id), issued from the tree over `_serial` (ctx.issue),
 *  never a row count; `what` names what it is for where it is called. */
export const serial = async (ctx: Pick<HandlerContext, 'issue'>, _what: string): Promise<number> => Number(await ctx.issue('_serial'));
