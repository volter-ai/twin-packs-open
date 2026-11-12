// What every family of Google OAuth shares: the issuer and its key, the World's Google accounts and OAuth clients, and
// the credentials it issues, kept as other packs read them.
//
// THE CONTRACT OTHER PACKS READ (architecture A3: Google's credentials authorize the Google API packs, which read these
// rows through the kernel's `ctx.ownerRow('googleoauth', resource, id)` over their manifest's `ownerReads`; webrisk reads
// `access_token`, youtube `access_token` and `api_key`):
//   access_token  id = the token itself   { clientId, sub, scope (space-separated), expiresAt (epoch seconds), revoked,
//                                           serviceAccountEmail (a JWT-bearer grant's token: no account row) }
//   account       id = the account's sub  { email, name, given_name, family_name, picture }
//   api_key       id = the key's SHA-256 (hex) { project, name, created }: a Cloud project's API key, as the console's
//                                           Credentials page creates it; the key itself is answered once, never kept
//   _person       id = person:<email>       { email, password_sha256, sub }: the person a Google sign-up made (world-core's
//                                           recordPerson), whose account is `account` <sub>; gmail's mailboxes are these
//   _web_session  id = websession:<token>   { token, email }: a signed-in browser, whose token is the `SID` cookie Google
//                                           sets on .google.com (world-core's startBrowserSession); gmail's webmail reads it
import { startBrowserSession, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
type Reader = Pick<HandlerContext, 'row'>;

const ISSUER = 'https://accounts.google.com';
export const ACCESS_TOKEN = 'access_token';
export const ACCOUNT = 'account';
export const CLIENT = 'client';
export const SERVICE_ACCOUNT = '_service_account';
export const SERVICE_ACCOUNT_KEY = '_service_account_key';
export const API_KEY = 'api_key';
export const CODE = '_authorization_code';
export const REFRESH = '_refresh_token';

/** Google's signing key for ID tokens, in a World the World's own, made once at random (ctx.signingKey), so an ID token
 *  verifies against this World's certs and no one forges one from the pack. */
const idTokenKey = async (ctx: Pick<HandlerContext, 'signingKey'>) => ({ alg: 'RS256' as const, ...(await ctx.signingKey('google-id-token')) });
export const jwksOf = async (ctx: Pick<HandlerContext, 'crypto' | 'signingKey'>): Promise<unknown> => ctx.crypto.jwks((await idTokenKey(ctx)).publicPem, '');
export const nowSeconds = (ctx: Pick<HandlerContext, 'occurredAt'>): number => Math.floor(Date.parse(ctx.occurredAt) / 1000);

/** An OAuth error as Google's token endpoint answers it (RFC 6749 section 5.2). */
export const oauthError = (status: number, error: string, description: string): Response =>
  Response.json({ error, error_description: description }, { status, headers: { 'cache-control': 'no-store' } });

export const live = (r: Row | undefined): Row | undefined => (r && r.deleted !== true ? r : undefined);
export const accountBySub = (ctx: Reader, sub: string): Row | undefined => live(ctx.row(ACCOUNT, sub));
export const clientById = (ctx: Reader, id: string): Row | undefined => live(ctx.row(CLIENT, id));

/** The client a token request authenticates as: in the body (client_secret_post) or Basic. */
export function clientOf(ctx: Reader & { call: HandlerContext['call'] }, params: Row): Row | undefined {
  let id = typeof params.client_id === 'string' ? params.client_id : undefined;
  let secret = typeof params.client_secret === 'string' ? params.client_secret : undefined;
  const basic = /^Basic\s+(.+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  if (basic) {
    try { const pair = atob(basic); const at = pair.indexOf(':'); id = decodeURIComponent(pair.slice(0, at)); secret = decodeURIComponent(pair.slice(at + 1)); } catch { return undefined; }
  }
  const client = id ? clientById(ctx, id) : undefined;
  return client && (client.secret === undefined || client.secret === secret) ? client : undefined;
}

/** A credential of Google's shapes (`ya29.` access tokens, `1//0` refresh tokens, `4/0A` codes), drawn from secrets the
 *  World holds for its seed (ctx.secret), so no one computes it from the client, the account and the moment. */
/** The shapes the World's issuance door gives the credential door's values (world-core `KeyFormat`), as `credential`
 *  draws them: an API key (`AIza`, 35 more), an OAuth client's secret (`GOCSPX-`, 28 more) and its id's two parts (12
 *  digits, then 32 lowercase letters and digits, before `.apps.googleusercontent.com`). */
export const API_KEY_FORMAT = { prefix: 'AIza', length: 39, alphabet: 'base64url' } as const;
export const CLIENT_SECRET_FORMAT = { prefix: 'GOCSPX-', length: 35, alphabet: 'base64url' } as const;
export const CLIENT_NUMBER_FORMAT = { length: 12, alphabet: 'digits' } as const;
export const CLIENT_NAME_FORMAT = { length: 32, alphabet: '0123456789abcdefghijklmnopqrstuvwxyz' } as const;
/** The id a service-account key's signing pair is drawn under (its label), from the same door: 40 hex. */
export const KEY_LABEL_FORMAT = { length: 40, alphabet: 'hex' } as const;

export async function credential(ctx: Pick<HandlerContext, 'secret'>, prefix: string, seed: string, length: number): Promise<string> {
  let out = '';
  for (let i = 0; out.length < length; i++) out += (await ctx.secret(`googleoauth:${seed}:${i}`)).replace(/[^A-Za-z0-9_-]/g, '');
  return `${prefix}${out.slice(0, length)}`;
}

/** An account's OpenID claims for the scopes granted. */
export function accountClaims(a: Row, scopes: string[]): Row {
  const email = scopes.some((s) => s === 'email' || s.endsWith('/userinfo.email'));
  const profile = scopes.some((s) => s === 'profile' || s.endsWith('/userinfo.profile'));
  return {
    ...(email ? { email: a.email, email_verified: true } : {}),
    ...(profile ? { name: a.name ?? null, given_name: a.given_name ?? null, family_name: a.family_name ?? null, picture: a.picture ?? null } : {}),
  };
}

/** The tokens an authorization answers: a `ya29.` access token (kept as the contract row), an ID token when `openid` was
 *  granted, and a refresh token for `access_type=offline`. */
export async function issue(ctx: HandlerContext, client: Row, account: Row, scopes: string[], offline: boolean, nonce?: string): Promise<Row> {
  const clientId = String(client.client_id);
  const sub = String(account.id);
  const n = await serial(ctx);
  const access = await credential(ctx, 'ya29.a0', `access:${clientId}:${sub}:${ctx.occurredAt}:${n}`, 180);
  const expiresAt = nowSeconds(ctx) + 3599;
  await ctx.write(ACCESS_TOKEN, access, { clientId, sub, scope: scopes.join(' '), expiresAt, revoked: false }, 'access_token.create');
  const out: Row = { access_token: access, expires_in: 3599, scope: scopes.join(' '), token_type: 'Bearer' };
  if (scopes.includes('openid')) {
    out.id_token = ctx.crypto.jwtSign({ iss: ISSUER, azp: clientId, aud: clientId, sub, ...(nonce ? { nonce } : {}), ...accountClaims(account, scopes) }, await idTokenKey(ctx), { expiresInSeconds: 3599, kidPrefix: '' });
  }
  if (offline) {
    const refresh = await credential(ctx, '1//0', `refresh:${clientId}:${sub}:${ctx.occurredAt}:${n}`, 100);
    await ctx.record(REFRESH, { clientId, sub, scopes, created: ctx.occurredAt }, ctx.crypto.digest('sha256', refresh, 'hex'));
    out.refresh_token = refresh;
  }
  return out;
}

/** The access token a request bears, when current: its row. */
export function bearer(ctx: Reader & { call: HandlerContext['call']; occurredAt: string }): Row | undefined {
  const t = /^Bearer\s+(\S+)$/i.exec(ctx.call.request.headers.get('authorization') ?? '')?.[1];
  const row = t ? live(ctx.row(ACCESS_TOKEN, t)) : undefined;
  return row && row.revoked !== true && Number(row.expiresAt) > Math.floor(Date.parse(ctx.occurredAt) / 1000) ? row : undefined;
}

/** The World's next number (a nonce in a secret's label, a numeric id), issued from the tree over `_serial` (ctx.issue),
 *  never a row count. */
export const serial = async (ctx: Pick<HandlerContext, 'issue'>): Promise<number> => Number(await ctx.issue('_serial'));

/** Google's session cookie, on `.google.com` so every Google property (mail.google.com) reads the sign-in; the name is the
 *  contract gmail reads (above). */
const SESSION_COOKIE = 'SID';

export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A Google Accounts page: the card its sign-in and sign-up draw. */
export function accountsPage(title: string, body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:15px/1.5 Roboto,system-ui,sans-serif;margin:0;background:#f0f4f9}main{max-width:440px;margin:48px auto;background:#fff;border-radius:28px;padding:36px 40px}h1{font-size:28px;font-weight:400;margin:0 0 8px}label{display:block;margin:16px 0 4px;color:#444746;font-size:14px}input[type=text],input[type=email],input[type=password]{box-sizing:border-box;width:100%;font:inherit;padding:13px 15px;border:1px solid #747775;border-radius:4px}button{margin-top:24px;background:#0b57d0;color:#fff;border:0;border-radius:20px;padding:10px 24px;font:inherit;font-weight:500;cursor:pointer}[role=alert]{color:#b3261e;margin:12px 0 0}</style></head><body><main><div aria-hidden="true">Google</div>${body}</main></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

/** Where a Google page returns a person (`continue`): an https address on a Google host, else undefined. */
export function continueTo(value: string | null | undefined): string | undefined {
  if (!value || /[\\\x00-\x1f\x7f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'google.com' || url.hostname.endsWith('.google.com')) ? url.toString() : undefined;
  } catch { return undefined; }
}

/** A person signed in to Google: a session recorded and its `SID` cookie, on .google.com when the request came to a
 *  Google host (at the twin's own address every page is one origin, and the cookie stays as the kernel scopes it). */
export async function googleSession(ctx: HandlerContext, email: string): Promise<string> {
  const cookie = await startBrowserSession(ctx, email, SESSION_COOKIE);
  const host = (ctx.call.request.headers.get('x-volter-twin-original-host') ?? new URL(ctx.call.request.url).host).split(':')[0]!.toLowerCase();
  return host === 'google.com' || host.endsWith('.google.com') ? `${cookie}; Domain=.google.com` : cookie;
}

/** A Google account's `sub`, 21 digits, drawn from a secret the World holds for its address (ctx.secret), so no one
 *  computes it from the address. Where the documentation stops: Google documents only that the sub is unique and never
 *  reused; the 21 digits are the form its ID tokens show. */
export async function accountSub(ctx: Pick<HandlerContext, 'secret' | 'crypto'>, email: string): Promise<string> {
  const hex = ctx.crypto.digest('sha256', await ctx.secret(`googleoauth:sub:${email.toLowerCase()}`), 'hex');
  return `1${BigInt(`0x${hex.slice(0, 24)}`).toString().padStart(20, '0').slice(-20)}`;
}
