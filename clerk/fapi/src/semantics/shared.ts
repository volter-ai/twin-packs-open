// What every Frontend API handler shares (docs/contributing/architecture.md, "What an author writes, and how": a family's
// shared helpers): the request's form and the browser's client (the `__client` cookie), Clerk's error body, the root's
// context over the stored types the two APIs share, the Frontend API's views of users, memberships, sessions and the
// client, and the flows several families finish (a session made, a user made by a sign-up, a ticket read and an
// invitation accepted). Signing, hashing and the instance's settings are the Backend API's (../../../src/semantics/shared.ts).
import type { HandlerContext } from '@volter/world-core';
import { manifest as rootManifest } from '../../../src/manifest.ts';
import {
  buildJwks, CLERK_TRACE_ID, decodeJwt, emailAddress, issuerOf, signJwt, instanceRow, membershipUserId, membershipsOf, organizationSettings, newUserFields, permissionKeysOf, primaryEmail,
  publicUserData, roleByKey, SESSION_LIFETIME_MS, sessionToken, sha256, verifyJwtWithJwks,
} from '../../../src/semantics/shared.ts';

export {
  buildJwks, CLERK_EVENTS, instanceEnvironment, publishableKey, membershipsOf, organizationSettings, SESSION_LIFETIME_MS, passwordDigest, passwordMatches, primaryEmail, sessionToken, sha256, signJwt, templateToken, tokenOrganization, userByEmail,
} from '../../../src/semantics/shared.ts';

export type Row = Record<string, unknown>;

// ── the wire ──────────────────────────────────────────────────────────────────────────────────

/** The cookie the Frontend API names the browser's client by: `HttpOnly` (no page script reads it; clerk-js reads the
 *  client from the API's answers), lasting as long as the client says it does (`cookie_expires_at`, 400 days on Clerk's
 *  own instance: COOKIE_LIFETIME_MS below), and `SameSite=Lax; Secure`, as Clerk configures its authentication cookies. */
export const CLIENT_COOKIE = '__client';
// source: https://clerk.com/docs/guides/secure/best-practices/csrf-protection "Clerk sets the SameSite flag for all of its session cookies to Lax, which is the default in modern browsers."
export const clientCookie = (token: string): string => `${CLIENT_COOKIE}=${token}; Path=/; Max-Age=${COOKIE_LIFETIME_MS / 1000}; HttpOnly; SameSite=Lax; Secure`;

/** The client's token, what the cookie and a native client's Authorization header carry: a JWT signed with the
 *  instance's key naming the client (`id`), lasting as the cookie does, never the bare id a caller could guess. Clerk's
 *  own `__client` is a signed token the Frontend API reads the client from; the twin's claims are its reading. */
export const clientToken = (ctx: HandlerContext, clientId: string): string =>
  signJwt(ctx, { id: clientId }, { now: Math.floor(ms(ctx) / 1000), expiresInSeconds: COOKIE_LIFETIME_MS / 1000 });

/** The client a token names, when the instance signed it and it has not expired. */
function clientOfToken(ctx: HandlerContext, token: string | undefined): string | undefined {
  if (!token) return undefined;
  const verdict = verifyJwtWithJwks(token, buildJwks(ctx), { now: Math.floor(ms(ctx) / 1000) });
  const id = verdict.valid ? verdict.payload?.id : undefined;
  return typeof id === 'string' && id.startsWith('client_') ? id : undefined;
}

/** Every instant the Frontend API writes is Unix milliseconds (spec:/components/schemas/Client.SignUp/properties/abandon_at). */
export const ms = (ctx: HandlerContext): number => Date.parse(ctx.occurredAt);

/** Clerk's error body (spec:/components/schemas/ClerkErrors). */
export function fapiError(status: number, code: string, message: string, longMessage = message, meta?: Row): Response {
  return Response.json({ errors: [{ message, long_message: longMessage, code, ...(meta ? { meta } : {}) }], clerk_trace_id: CLERK_TRACE_ID }, { status });
}

/** The short message of each refusal a machine gives (./states.ts, the root's ../../../src/semantics/states.ts), as
 *  https://clerk.com/docs/guides/development/errors/frontend-api gives it; the machine's message is the long one. */
const MACHINE_SHORT: Record<string, string> = {
  invalid_action_for_session: 'Invalid action for user session',
  verification_already_verified: 'already verified',
  organization_invitation_not_pending: 'not pending',
  sign_in_token_cannot_be_revoked_code: 'cannot revoke',
};
export const machineRefusal = (r: { status: number; code?: string | number; message: string }): Response =>
  fapiError(r.status, String(r.code ?? 'client_state_invalid'), MACHINE_SHORT[String(r.code ?? '')] ?? r.message, r.message);

/** No client, or no session on it: recorded from Clerk's own instance (../../spec/recordings/2026-09-28-clerk-clerk-com-signed-out.json). */
export const signedOut = (): Response => fapiError(401, 'signed_out', 'Signed out', 'You are signed out');
export const notFound = (what: string): Response => fapiError(404, 'resource_not_found', 'not found', `${what} not found`);
export const missingParam = (param: string): Response => fapiError(422, 'form_param_missing', 'is missing', `${param} must be included.`, { param_name: param });
export const invalidParam = (param: string, longMessage: string): Response => fapiError(422, 'form_param_format_invalid', 'is invalid', longMessage, { param_name: param });

/** A field of the request, its query or its form body as the kernel parsed them (spec: every body is a form). */
export const text = (ctx: HandlerContext, key: string): string | undefined => {
  const v = ctx.params[key];
  return typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : undefined;
};

/** A native client's request (an iOS or Android app, not a browser): "If sent and the value is true, it instructs the
 *  server to parse the API token from the `Authorization` header. It should always be set to true when using the
 *  `Authorization` header authentication strategy." (spec:/components/securitySchemes/ProductionNativeFlag, `_is_native`) */
// source: spec:/components/securitySchemes/ProductionNativeFlag "It should always be set to true when using the"
export const isNative = (ctx: HandlerContext): boolean => new URL(ctx.call.request.url).searchParams.get('_is_native') === 'true';

/** The client the request names: a browser's by its cookie; a native client's by "The Client API token sent in the
 *  `Authorization` header" (spec:/components/securitySchemes/ProductionNativeApp, http bearer). */
export function cookieClient(ctx: HandlerContext): string | undefined {
  if (isNative(ctx)) {
    const raw = ctx.call.request.headers.get('authorization')?.trim();
    return clientOfToken(ctx, raw ? raw.replace(/^bearer\s+/i, '').trim() : undefined);
  }
  const header = ctx.call.request.headers.get('cookie');
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq > 0 && pair.slice(0, eq).trim() === CLIENT_COOKIE) return clientOfToken(ctx, pair.slice(eq + 1).trim());
  }
  return undefined;
}

/** Where an answer hands a client its token: "in the response cookies or the response authorization header"
 *  (spec: putClient), the header for a native client. */
// source: spec:putClient "sets it either in the response cookies or the response authorization header"
export function clientTokenHeader(ctx: HandlerContext, clientId: string): [string, string] {
  const token = clientToken(ctx, clientId);
  return isNative(ctx) ? ['authorization', token] : ['set-cookie', clientCookie(token)];
}

/** The request's Origin, which a session token carries as `azp` (https://clerk.com/docs/guides/sessions/session-tokens:
 *  "The `Origin` header that was included in the original Frontend API request"). */
export const originOf = (ctx: HandlerContext): string | undefined => ctx.call.request.headers.get('origin') ?? undefined;

/** The root's context over the same call: users, organizations, memberships, invitations, roles and JWT templates are the
 *  Backend API's stored types, read and written under its manifest, whose machines rule them. Only the events
 *  declared on that manifest are delivered; sharing a store does not inherit event declarations. */
export const rootOf = (ctx: HandlerContext): Promise<HandlerContext> => ctx.over(rootManifest);

/** A stored row's own fields as the vendor's object: the subject's id, no bookkeeping. */
export function own(ctx: HandlerContext, row: Row): Row {
  return { id: row.id, ...Object.fromEntries(Object.entries(ctx.own(row)).filter(([k]) => !k.startsWith('_') && k !== 'id')) };
}

/** A one-time code, six digits, derived from what it is for (an attempt and the instant it was asked for): the same World
 *  sends the same code every run. */
/** A six-digit code from a seed: the callers seed it with a secret the World holds (ctx.secret), so it cannot be
 *  computed from the sign-in's id and time. */
export const oneTimeCode = (seed: string): string => String(Number.parseInt(sha256(`code:${seed}`).slice(0, 12), 16) % 1_000_000).padStart(6, '0');

/** How long a one-time code holds. Clerk's pages give no figure; the twin's is ten minutes. */
export const CODE_LIFETIME_MS = 600_000;
/** How many wrong codes a verification takes before it is `failed` (spec:/components/schemas/Stubs.Verification.OTP
 *  status `failed`; "Too many failed attempts. You have to try again with the same or another method.",
 *  https://clerk.com/docs/guides/development/errors/frontend-api, VerificationFailed). Clerk's pages give no count; the
 *  twin's is five. */
// source: https://clerk.com/docs/guides/development/errors/frontend-api "Too many failed attempts."
export const MAX_CODE_ATTEMPTS = 5;

/** Test mode (on on every development instance): "Any email with the `+clerk_test` subaddress is a test email address";
 *  "no email with the verification code will be sent. Instead you can use the code `424242`."
 *  (https://clerk.com/docs/guides/development/testing/test-emails-and-phones) */
// source: https://clerk.com/docs/guides/development/testing/test-emails-and-phones "Instead you can use the code 424242."
export const TEST_CODE = '424242';
// source: https://clerk.com/docs/guides/development/testing/test-emails-and-phones "Any email with the +clerk_test subaddress is a test email address."
export const isTestEmail = (address: unknown): boolean => typeof address === 'string' && /\+clerk_test@/i.test(address);

/** Clerk's refusals of a code verification (https://clerk.com/docs/guides/development/errors/frontend-api, by name). */
export const codeRefusal = {
  // VerificationNotSent
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "You need to send a verification code before attempting to verify."
  notSent: (): Response => fapiError(400, 'verification_not_sent', 'not sent', 'You need to send a verification code before attempting to verify.'),
  // VerificationAlreadyVerified
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "This verification has already been verified."
  alreadyVerified: (): Response => fapiError(400, 'verification_already_verified', 'already verified', 'This verification has already been verified.'),
  // VerificationExpired
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "This verification has expired. You must create a new one."
  expired: (): Response => fapiError(400, 'verification_expired', 'expired', 'This verification has expired. You must create a new one.'),
  // VerificationFailed
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "Too many failed attempts. You have to try again with the same or another method."
  failed: (): Response => fapiError(400, 'verification_failed', 'failed', 'Too many failed attempts. You have to try again with the same or another method.'),
  // FormIncorrectCode
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "Incorrect code"
  incorrect: (): Response => fapiError(422, 'form_code_incorrect', 'is incorrect', 'Incorrect code', { param_name: 'code' }),
};
/** When an unfinished attempt is abandoned. Clerk's pages give no figure; the twin's is an hour. */
export const ATTEMPT_LIFETIME_MS = 3_600_000;
/** "Passwords must be 8 characters or more." — Clerk's default password policy. */
export const PASSWORD_MIN_LENGTH = 8;

// ── the instance's sign-in settings ─────────────────────────────────────────────────────────────

/** The instance's sign-in settings, as its dashboard's "User & authentication" page sets them (`_auth` on the instance,
 *  through the twin's `/_twin/instance` door): a password on or off (on by default), whether sign-up asks people to accept
 *  the application's legal terms (off by default; https://clerk.com/docs/guides/secure/legal-compliance), and the
 *  membership model ("Membership required (default for new apps)": https://clerk.com/docs/guides/organizations/configure). */
export function authSettings(root: HandlerContext): { password: boolean; legalConsent: boolean; membershipRequired: boolean; social: Record<string, { client_id: string; client_secret: string }>; applicationName: string } {
  const a = (instanceRow(root)?._auth ?? {}) as Row;
  return { password: a.password !== 'off', legalConsent: a.legal_consent === true, membershipRequired: a.organization_membership !== 'optional', social: (a.social ?? {}) as Record<string, { client_id: string; client_secret: string }>, applicationName: typeof a.application_name === 'string' ? a.application_name : 'twin' };
}

/** The fields a sign-up must give ("These fields are mandatory in order for the sign-up to satisfy the attached
 *  registration policy": spec:/components/schemas/Client.SignUp/properties/required_fields). */
export function requiredSignUpFields(root: HandlerContext): string[] {
  const s = authSettings(root);
  return ['email_address', ...(s.password ? ['password'] : []), ...(s.legalConsent ? ['legal_accepted'] : [])];
}

// ── users, as the Frontend API answers them ─────────────────────────────────────────────────────

/** The fields of spec:/components/schemas/Client.User, in its order; never a user's private metadata. */
const USER_FIELDS = [
  'id', 'object', 'username', 'first_name', 'last_name', 'image_url', 'has_image', 'primary_email_address_id', 'primary_phone_number_id',
  'primary_web3_wallet_id', 'password_enabled', 'two_factor_enabled', 'totp_enabled', 'backup_code_enabled', 'email_addresses', 'phone_numbers',
  'web3_wallets', 'passkeys', 'organization_memberships', 'external_accounts', 'saml_accounts', 'password_last_updated_at', 'public_metadata',
  'unsafe_metadata', 'external_id', 'last_sign_in_at', 'banned', 'locked', 'lockout_expires_in_seconds', 'verification_attempts_remaining',
  'created_at', 'updated_at', 'delete_self_enabled', 'create_organization_enabled', 'last_active_at', 'mfa_enabled_at', 'mfa_disabled_at',
  'legal_accepted_at', 'profile_image_url',
];
const USER_DEFAULTS: Row = {
  object: 'user', username: null, first_name: null, last_name: null, image_url: '', has_image: false, primary_email_address_id: null,
  primary_phone_number_id: null, primary_web3_wallet_id: null, password_enabled: false, two_factor_enabled: false, totp_enabled: false,
  backup_code_enabled: false, email_addresses: [], phone_numbers: [], web3_wallets: [], passkeys: [], external_accounts: [], saml_accounts: [],
  public_metadata: {}, unsafe_metadata: {}, external_id: null, last_sign_in_at: null, banned: false, locked: false,
  lockout_expires_in_seconds: null, verification_attempts_remaining: null, delete_self_enabled: false, create_organization_enabled: true,
  last_active_at: null, mfa_enabled_at: null, mfa_disabled_at: null, legal_accepted_at: null,
};

/** A user as the Frontend API answers it, with its organization memberships (what clerk-js's `useOrganizationList` and
 *  `has()` read). */
export function userView(root: HandlerContext, user: Row): Row {
  const stored = { ...USER_DEFAULTS, ...own(root, user) };
  const out: Row = {};
  for (const k of USER_FIELDS) if (k in stored) out[k] = stored[k];
  out.organization_memberships = membershipsOf(root, String(user.id)).map((m) => membershipView(root, m));
  return out;
}

/** An organization as the Frontend API answers it (spec:/components/schemas/Client.Organization): no private metadata. */
function organizationView(root: HandlerContext, org: Row): Row {
  const o = own(root, org);
  return {
    id: o.id, object: 'organization', name: o.name, slug: o.slug, image_url: o.image_url ?? '', has_image: o.has_image === true,
    max_allowed_memberships: o.max_allowed_memberships ?? 0, admin_delete_enabled: o.admin_delete_enabled !== false,
    ...(o.self_serve_sso_enabled !== undefined && o.self_serve_sso_enabled !== null ? { self_serve_sso_enabled: o.self_serve_sso_enabled } : {}),
    public_metadata: o.public_metadata ?? {}, created_at: o.created_at, updated_at: o.updated_at,
  };
}

/** A membership as the Frontend API answers it (spec:/components/schemas/Client.OrganizationMembership). */
export function membershipView(root: HandlerContext, m: Row): Row {
  const role = String(m.role);
  const org = root.get('Organization', String(m.organization_id));
  return {
    id: m.id, object: 'organization_membership', public_metadata: m.public_metadata ?? {}, role,
    role_name: String(roleByKey(root, role)?.name ?? role), permissions: permissionKeysOf(root, role),
    created_at: m.created_at, updated_at: m.updated_at,
    organization: org ? organizationView(root, org) : null,
    public_user_data: publicUserData(root, membershipUserId(m)),
  };
}

/** The part of a user a session shows (spec:/components/schemas/Client.PublicUserData). */
function sessionUserData(user: Row | undefined): Row | null {
  if (!user) return null;
  return {
    first_name: user.first_name ?? null, last_name: user.last_name ?? null, image_url: user.image_url ?? '', has_image: user.has_image === true,
    identifier: String(primaryEmail(user)?.email_address ?? user.id), profile_image_url: user.profile_image_url ?? user.image_url ?? '', user_id: user.id,
  };
}

/** The user a completed sign-up makes, in the Backend API's `User` shape (Clerk reports `user.created`). */
export async function createUser(root: HandlerContext, u: { email: string; verifiedBy: 'email_code' | 'ticket' | `from_oauth_${string}`; passwordDigest?: string; firstName?: unknown; lastName?: unknown; username?: unknown; unsafeMetadata?: unknown; legalAcceptedAt?: number | null }): Promise<Row> {
  const id = root.mint('User');
  const at = ms(root);
  const email = emailAddress(id, u.email, at, { status: 'verified', strategy: u.verifiedBy, attempts: u.verifiedBy === 'email_code' ? 1 : null, expire_at: null });
  await root.write('User', id, { ...newUserFields(id, at, { emails: [email], firstName: u.firstName, lastName: u.lastName, username: u.username, unsafeMetadata: u.unsafeMetadata, legalAcceptedAt: u.legalAcceptedAt ?? null, ...(u.passwordDigest !== undefined ? { passwordDigest: u.passwordDigest } : {}) }), last_active_at: at }, 'user.create');
  return root.row('User', id)!;
}

// ── the browser's client and its sessions ───────────────────────────────────────────────────────

/** How long the client's cookie holds: Clerk's own instance set a new client's `cookie_expires_at` 400 days after its
 *  `created_at` (../../spec/recordings/2026-09-28-clerk-clerk-com-signed-out.json: 1825178324255 − 1790618324255 ms). */
export const COOKIE_LIFETIME_MS = 400 * 86_400_000;

export type ClientRef = { id: string; minted?: string };

/** The client a write works on: the cookie's, or a new one the answer sets (the Frontend API mints the browser's client
 *  on first need). A cookie naming a client the twin holds no row for gets its row now. */
export async function ensureClient(ctx: HandlerContext): Promise<ClientRef> {
  const named = cookieClient(ctx);
  const at = ms(ctx);
  if (named) {
    return { id: named };
  }
  const id = ctx.mint('Client.Client');
  await ctx.write('Client.Client', id, { object: 'client', created_at: at, updated_at: at, last_authentication_strategy: null }, 'client.create');
  return { id, minted: id };
}

/** Remember which sign-in and sign-up the client is part-way through, and how it last authenticated. */
export async function remember(ctx: HandlerContext, clientId: string, patch: { sign_in?: string | null; sign_up?: string | null; strategy?: string }): Promise<void> {
  await ctx.write('Client.Client', clientId, {
    ...(patch.sign_in !== undefined ? { _sign_in_id: patch.sign_in } : {}),
    ...(patch.sign_up !== undefined ? { _sign_up_id: patch.sign_up } : {}),
    ...(patch.strategy !== undefined ? { last_authentication_strategy: patch.strategy } : {}),
    updated_at: ms(ctx),
  }, 'client.update');
}

/** The sessions signed in on a client: its active ones, oldest first. */
export const activeSessions = (ctx: HandlerContext, clientId: string): Row[] =>
  ctx.rows('Client.Session-2').filter((s) => s.client_id === clientId && (s.status ?? 'active') === 'active')
    .sort((a, b) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0));

/** A session as the Frontend API answers it (spec:/components/schemas/Client.Session): its user, what others see of the
 *  user, and a token minted now (clerk-js reads the session's claims from `last_active_token` on its first render). */
export function sessionView(ctx: HandlerContext, root: HandlerContext, session: Row, opts: { withUser?: boolean; withToken?: boolean } = {}): Row {
  const s = own(ctx, session);
  const user = root.get('User', String(s.user_id));
  const at = ms(ctx);
  const created = Number(s.created_at ?? at);
  const token = opts.withToken !== false && (s.status ?? 'active') === 'active' && user
    ? sessionToken(root, session, { orgId: typeof s.last_active_organization_id === 'string' ? s.last_active_organization_id : null, ...(originOf(ctx) ? { origin: originOf(ctx)! } : {}) })
    : undefined;
  return {
    id: s.id, object: 'session', status: s.status ?? 'active',
    expire_at: s.expire_at ?? created + SESSION_LIFETIME_MS, abandon_at: s.abandon_at ?? created + SESSION_LIFETIME_MS,
    last_active_at: s.last_active_at ?? created,
    ...(token ? { last_active_token: { object: 'token', jwt: token } } : {}),
    actor: s.actor ?? null, tasks: [],
    last_active_organization_id: s.last_active_organization_id ?? null,
    ...(opts.withUser !== false && user ? { user: userView(root, user) } : {}),
    public_user_data: sessionUserData(user),
    factor_verification_age: [Math.max(0, Math.floor((at - created) / 60_000)), -1],
    created_at: created, updated_at: s.updated_at ?? created,
  };
}

/** The client as the Frontend API answers it. */
export function clientView(ctx: HandlerContext, root: HandlerContext, clientId: string): Row {
  const row = ctx.row('Client.Client', clientId);
  const at = ms(ctx);
  const created = Number(row?.created_at ?? at);
  const sessions = activeSessions(ctx, clientId);
  const last = [...sessions].sort((a, b) => Number(a.last_active_at ?? a.created_at ?? 0) - Number(b.last_active_at ?? b.created_at ?? 0)).at(-1);
  const si = typeof row?._sign_in_id === 'string' ? ctx.get('Client.SignIn', row._sign_in_id) : undefined;
  const su = typeof row?._sign_up_id === 'string' ? ctx.get('Client.SignUp', row._sign_up_id) : undefined;
  return {
    object: 'client', id: clientId, sessions: sessions.map((s) => sessionView(ctx, root, s)), sign_in: si ? own(ctx, si) : null, sign_up: su ? own(ctx, su) : null,
    last_active_session_id: last ? String(last.id) : null,
    last_authentication_strategy: row?.last_authentication_strategy ?? null,
    cookie_expires_at: created + COOKIE_LIFETIME_MS, captcha_bypass: false,
    created_at: created, updated_at: Number(row?.updated_at ?? created),
  };
}

/** `{ response, client }`: an answer and the client it changed, with the cookie when the request minted the client. */
export function wrapped(ctx: HandlerContext, root: HandlerContext, client: ClientRef, response: unknown, status = 200): Response {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (client.minted) headers.append(...clientTokenHeader(ctx, client.minted));
  return new Response(JSON.stringify({ response, client: clientView(ctx, root, client.id) }), { status, headers });
}

/** The client a read or a session operation needs: the cookie's, or Clerk's `signed_out`. */
export function requireClient(ctx: HandlerContext): { id: string } | Response {
  const named = cookieClient(ctx);
  return named ? { id: named } : signedOut();
}

/** The activity a session was made from: the device and browser the request names (spec:/components/schemas/
 *  SessionActivityResponse in the Backend API). The twin reads only what the request says; no location is invented. */
function activity(ctx: HandlerContext, id: string): Row {
  const ua = ctx.call.request.headers.get('user-agent') ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : undefined;
  return { object: 'session_activity', id: `sess_activity_${id}`, is_mobile: /Mobile/.test(ua), ...(browser ? { browser_name: browser } : {}) };
}

/** A new active session for a user on a client (the machine's initial state); no Frontend events are declared. */
export async function createSession(ctx: HandlerContext, root: HandlerContext, userId: string, clientId: string, activeOrg: string | null = null): Promise<Row> {
  const id = ctx.mint('Client.Session-2');
  const at = ms(ctx);
  await ctx.write('Client.Session-2', id, {
    object: 'session', user_id: userId, client_id: clientId, status: 'active', last_active_organization_id: activeOrg, actor: null,
    last_active_at: at, latest_activity: activity(ctx, id), expire_at: at + SESSION_LIFETIME_MS, abandon_at: at + SESSION_LIFETIME_MS,
    created_at: at, updated_at: at,
  }, 'session.create');
  await root.write('User', userId, { last_sign_in_at: at, last_active_at: at, updated_at: at }, 'user.sign_in');
  return ctx.row('Client.Session-2', id)!;
}

/** The signed-in user: the one the client's last active session names; Clerk's `signed_out` when there is none. */
export async function signedIn(ctx: HandlerContext): Promise<{ root: HandlerContext; clientId: string; session: Row; user: Row } | Response> {
  const clientId = cookieClient(ctx);
  if (!clientId) return signedOut();
  const session = [...activeSessions(ctx, clientId)].sort((a, b) => Number(a.last_active_at ?? 0) - Number(b.last_active_at ?? 0)).at(-1);
  if (!session) return signedOut();
  const root = await rootOf(ctx);
  const user = root.row('User', String(session.user_id));
  return user ? { root, clientId, session, user } : signedOut();
}

// ── tickets: what the Backend API hands one person to sign up or in with ────────────────────────

export type Ticket = { kind: 'invitation'; invitation: Row; email: string } | { kind: 'sign_in_token'; token: Row; userId: string; orgId: string | null };

/** A ticket Clerk will not take, with Clerk's own refusal for why (https://clerk.com/docs/guides/development/errors/frontend-api,
 *  by name: TicketInvalid, TicketExpired, OrganizationInvitationRevoked, OrganizationInvitationAlreadyAccepted,
 *  OrganizationInvitationToDeletedOrganization, SignInTokenRevoked, SignInTokenAlreadyUsed). */
const TICKET_REFUSALS = {
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "This ticket is invalid. Make sure you're using a valid ticket generated by Clerk."
  invalid: ['ticket_invalid_code', 'ticket is invalid', "This ticket is invalid. Make sure you're using a valid ticket generated by Clerk."],
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "This ticket has expired and cannot be used anymore."
  expired: ['ticket_expired_code', 'ticket has expired', 'This ticket has expired and cannot be used anymore.'],
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "This invitation has been revoked and cannot be used anymore."
  invitation_revoked: ['organization_invitation_revoked_code', 'invitation has been revoked', 'This invitation has been revoked and cannot be used anymore.'],
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "This invitation has already been accepted. Sign in instead."
  invitation_accepted: ['organization_invitation_already_accepted', 'invitation has already been accepted', 'This invitation has already been accepted. Sign in instead.'],
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "This invitation refers to an organization that has been deleted."
  organization_deleted: ['organization_invitation_to_deleted_organization', 'organization invitation to deleted organization', 'This invitation refers to an organization that has been deleted.'],
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "This sign in token has been revoked and cannot be used anymore."
  token_revoked: ['sign_in_token_revoked_code', 'sign in token has been revoked', 'This sign in token has been revoked and cannot be used anymore.'],
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "This sign in token has already been used. Each token can only be used once."
  token_used: ['sign_in_token_already_used_code', 'sign in token has already been used', 'This sign in token has already been used. Each token can only be used once.'],
  // source: https://clerk.com/docs/guides/development/errors/frontend-api "Sign in tokens can only be used during sign in."
  token_not_in_sign_in: ['sign_in_token_not_in_sign_in_code', 'not in sign in', 'Sign in tokens can only be used during sign in.'],
} as const;
export const ticketRefused = (why: keyof typeof TICKET_REFUSALS): Response => {
  const [code, message, long] = TICKET_REFUSALS[why];
  return fapiError(400, code, message, long, { param_name: 'ticket' });
};

/** A ticket read: signed by the instance's key and not expired on the World clock, naming an invitation still pending
 *  (`st: 'organization_invitation'`, made by the Backend API's invitations) or a sign-in token still pending
 *  (`st: 'sign_in_token'`, made by `POST /sign_in_tokens`). Any other token the instance signed (a session token names a
 *  user too) is no ticket. */
export function readTicket(root: HandlerContext, ticket: string | undefined): Ticket | Response {
  if (!ticket) return missingParam('ticket');
  const verdict = verifyJwtWithJwks(ticket, buildJwks(root), { now: Math.floor(ms(root) / 1000) });
  if (!verdict.valid) return ticketRefused(verdict.reason === 'expired' ? 'expired' : 'invalid');
  const claims = decodeJwt(ticket).payload;
  if (claims.st === 'organization_invitation') {
    const invitation = root.row('OrganizationInvitation', String(claims.sid), { withDeleted: true });
    // the ticket must be the one the invitation was made with, byte for byte, as a sign-in token's is
    if (!invitation || invitation.organization_id !== claims.oid || invitation._ticket !== ticket) return ticketRefused('invalid');
    if (invitation.deleted === true || !root.get('Organization', String(invitation.organization_id))) return ticketRefused('organization_deleted');
    // "New organization invitations get a "pending" status until they are revoked by an organization administrator or
    // accepted by the invitee." (the root's machine): only a pending one is taken
    if (invitation.status === 'revoked') return ticketRefused('invitation_revoked');
    if (invitation.status === 'accepted') return ticketRefused('invitation_accepted');
    return { kind: 'invitation', invitation, email: String(invitation.email_address) };
  }
  {
    const token = root.row('SignInToken', String(claims.sid));
    // the ticket must be the token the Backend API made and answered, byte for byte
    if (claims.st !== 'sign_in_token' || !token || token.token !== ticket) return ticketRefused('invalid');
    if (token.status === 'revoked') return ticketRefused('token_revoked');
    if (token.status === 'accepted') return ticketRefused('token_used');
    if (!root.get('User', String(token.user_id))) return ticketRefused('invalid');
    return { kind: 'sign_in_token', token, userId: String(token.user_id), orgId: typeof token._org_id === 'string' ? token._org_id : null };
  }
}

/** A sign-in token is used: `pending → accepted` (the root's `external` move, asked of its machine), once. */
export async function consumeSignInToken(root: HandlerContext, token: Row): Promise<Response | undefined> {
  const id = String(token.id);
  const refusal = root.legal('SignInToken', 'status', root.call.operation.id, token.status ?? 'pending', 'accepted', id, 'external');
  if (refusal) return ticketRefused('token_used');
  await root.write('SignInToken', id, { status: 'accepted', updated_at: ms(root) }, 'sign_in_token.accept');
  return undefined;
}

/** The invitee accepts: the invitation moves `pending → accepted` (the root's `external` move, asked of its machine), and
 *  its email's user becomes a member with the invitation's role. */
export async function acceptInvitation(root: HandlerContext, invitation: Row, userId: string): Promise<Response | undefined> {
  const id = String(invitation.id);
  const refusal = root.legal('OrganizationInvitation', 'status', root.call.operation.id, invitation.status ?? 'pending', 'accepted', id, 'external');
  if (refusal) return machineRefusal(refusal);
  const at = ms(root);
  await root.write('OrganizationInvitation', id, { status: 'accepted', _user_id: userId, updated_at: at }, 'organization_invitation.accept');
  const orgId = String(invitation.organization_id);
  if (membershipsOf(root, userId).some((m) => m.organization_id === orgId)) return undefined;
  await root.write('OrganizationMembership', root.mint('OrganizationMembership'), {
    // the invitation's public metadata becomes the membership's (its private metadata the pages do not carry over)
    // source: https://clerk.com/docs/guides/organizations/add-members/invitations "Once the invited user signs up using the invitation link, Clerk stores the invitation metadata (OrganizationInvitation.publicMetadata) in the Organization membership's metadata (OrganizationMembership.publicMetadata)"
    object: 'organization_membership', organization_id: orgId, user_id: userId, role: invitation.role, public_metadata: (invitation.public_metadata as Row | undefined) ?? {}, private_metadata: {}, created_at: at, updated_at: at,
  }, 'organization_membership.create');
  return undefined;
}

// ── the handshake ─────────────────────────────────────────────────────────────────────────────

/** A development instance's dev browser token: the one the request carries (`__clerk_db_jwt`), else a new one derived
 *  from the instant, never drawn (as `POST /v1/dev_browser` makes one). */
export async function devBrowserToken(ctx: HandlerContext): Promise<string> {
  const given = new URL(ctx.call.request.url).searchParams.get('__clerk_db_jwt');
  return given !== null && given !== '' ? given : `dvb_${sha256(await ctx.secret(`dev_browser:${ctx.occurredAt}`)).slice(0, 27)}`;
}

/** How long a handshake's cookies last: `__client_uat` and the dev browser as long as the client does. */
const HANDSHAKE_COOKIE_MAX_AGE = Math.floor(COOKIE_LIFETIME_MS / 1000);

/** The cookies a handshake hands the application to set on its own domain (@clerk/backend's `resolveHandshake` sets each
 *  directive as a `Set-Cookie`): the browser's session token and when its client last changed, or, signed out, a
 *  `__client_uat` of 0 and no session; and, on a development instance, the dev browser. */
export function handshakeDirectives(root: HandlerContext, session: Row | undefined, devBrowser: string, origin: string | undefined): string[] {
  const out: string[] = [];
  if (session !== undefined) {
    const jwt = sessionToken(root, session, { orgId: (session.last_active_organization_id as string | null | undefined) ?? null, ...(origin ? { origin } : {}) });
    const uat = Math.floor(Number(session.updated_at ?? session.created_at ?? ms(root)) / 1000);
    out.push(`__session=${jwt}; Path=/; SameSite=Lax`, `__client_uat=${uat}; Path=/; Max-Age=${HANDSHAKE_COOKIE_MAX_AGE}; SameSite=Lax`);
  } else {
    out.push('__session=; Path=/; Max-Age=0; SameSite=Lax', `__client_uat=0; Path=/; Max-Age=${HANDSHAKE_COOKIE_MAX_AGE}; SameSite=Lax`);
  }
  out.push(`__clerk_db_jwt=${devBrowser}; Path=/; Max-Age=${HANDSHAKE_COOKIE_MAX_AGE}; SameSite=Lax`);
  return out;
}

/** Where a handshake's payload waits for the application's Backend API call (`GET /v1/clients/handshake_payload`),
 *  named by its nonce. */
export const HANDSHAKE = '_handshake';

/** The providers a social connection signs in through, each reached at the World's own twin of it: its authorize page
 *  (the browser's), its token endpoint (the instance's own call, `ctx.vendorFetch`), the scopes a Clerk sign-in asks for,
 *  and its name as clerk-js shows it. */
export const PROVIDERS: Record<string, { name: string; authorize: string; token: string; scope: string }> = {
  // https://developers.google.com/identity/protocols/oauth2/web-server: the authorization and token endpoints
  oauth_google: { name: 'Google', authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', scope: 'openid email profile' },
};

/** Where a provider sends the browser back: the instance's Frontend API, "The endpoint where the OAuth providers redirect
 *  to after a successful authentication attempt" (spec: getOauthCallback). */
export const oauthCallbackUrl = (root: HandlerContext): string => `${issuerOf(root)}/v1/oauth_callback`;

/** How long an OAuth sign-in waits for its provider. */
export const OAUTH_LIFETIME_MS = 600_000;

// OAuth as an identity provider for the public account worker.
export { frontendApiHost, issuerOf } from '../../../src/semantics/shared.ts';
export const oauthDoc = 'https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth';
export const htmlEscape = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const oauthPage = (title: string, content: string): Response => new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${htmlEscape(title)}</title></head><body><main>${content}</main></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
export const oauthError = (status: number, error: string, error_description: string): Response => Response.json({ error, error_description }, { status, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
// source: https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi "Clerk-Secret-Key : Your Clerk Secret Key"
// The guide gives no proxy refusal wording; use Clerk's documented invalid-key envelope for this class.
export function oauthProxyError(ctx: HandlerContext): Response | undefined {
  const request = ctx.call.request;
  if (oauthRequestHost(ctx) !== 'frontend-api.clerk.dev') return undefined;
  const key = request.headers.get('Clerk-Secret-Key');
  const proxy = request.headers.get('Clerk-Proxy-Url');
  if (!key || !ctx.rowsRaw('_secret_key').some((k) => k.sha256 === sha256(key)) || !proxy || !URL.canParse(proxy) || !request.headers.has('X-Forwarded-For')) return fapiError(401, 'clerk_key_invalid', 'Invalid proxy credential', 'The Clerk Frontend API proxy requires a valid instance secret key and proxy headers.');
  return undefined;
}
// source: https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi "Clerk-Proxy-Url : Needs to have the full proxy URL."
// The World preserves the vendor host on routed requests; the socket URL is only transport.
export const oauthRequestHost = (ctx: HandlerContext): string => (ctx.call.request.headers.get('x-volter-twin-original-host') ?? ctx.call.request.headers.get('host') ?? new URL(ctx.call.request.url).host).split(':')[0]!.toLowerCase();
export const oauthPublicBase = async (ctx: HandlerContext): Promise<string> => oauthRequestHost(ctx) === 'frontend-api.clerk.dev' ? ctx.call.request.headers.get('Clerk-Proxy-Url')!.replace(/\/$/, '') : issuerOf(await rootOf(ctx));
export const oauthApplication = async (ctx: HandlerContext, clientId: string): Promise<Row | undefined> => (await rootOf(ctx)).rows('OAuthApplication').find((a) => a.client_id === clientId);
export const oauthParams = (ctx: HandlerContext): URLSearchParams => ctx.call.request.method === 'POST' ? new URLSearchParams(ctx.text) : new URL(ctx.call.request.url).searchParams;

// source: spec:requestOAuthAuthorize "The redirect preserves a supplied `state` and includes `iss`."
export async function oauthReturn(ctx: HandlerContext, q: URLSearchParams, result: Record<string, string>): Promise<Response> {
  const values = { ...result, ...(q.has('state') ? { state: q.get('state')! } : {}), iss: issuerOf(await rootOf(ctx)) };
  const redirect = q.get('redirect_uri')!;
  // source: spec:requestOAuthAuthorize "form_post"
  if (q.get('response_mode') === 'form_post') return oauthPage('Continue', `<form method="post" action="${htmlEscape(redirect)}">${Object.entries(values).map(([k, v]) => `<input type="hidden" name="${htmlEscape(k)}" value="${htmlEscape(v)}">`).join('')}<button type="submit">Continue</button></form><script>document.forms[0].submit()</script>`);
  const back = new URL(redirect);
  for (const [k, v] of Object.entries(values)) back.searchParams.set(k, v);
  return new Response(null, { status: 303, headers: { location: back.toString(), 'cache-control': 'no-store' } });
}

/** Validate before sign-in, consent, or returning anything to a caller-controlled redirect. */
export async function oauthRequest(ctx: HandlerContext, q: URLSearchParams): Promise<Row | Response> {
  const app = await oauthApplication(ctx, q.get('client_id') ?? '');
  // source: spec:requestOAuthAuthorize "Unauthorized error, for example the provided client is invalid."
  if (!app) return oauthError(401, 'invalid_client', 'Unknown OAuth application.');
  // source: spec:requestOAuthAuthorize "Must be registered for the OAuth application."
  const redirects = app.redirect_uris as string[];
  if (!q.has('redirect_uri') && redirects.length === 1) q.set('redirect_uri', redirects[0]!);
  if (!redirects.includes(q.get('redirect_uri') ?? '')) return oauthError(400, 'invalid_request', 'The redirect URI is not registered.');
  // source: spec:requestOAuthAuthorize "Must be `code` for authorization code flow."
  if (q.get('response_type') !== 'code') return oauthReturn(ctx, q, { error: 'unsupported_response_type' });
  // source: spec:requestOAuthAuthorize "Falls back to the OAuth application's registered scopes if not provided."
  if (!q.has('scope')) q.set('scope', String(app.scopes));
  const scopes = (q.get('scope') ?? '').split(/\s+/).filter(Boolean);
  if (scopes.some((s) => !String(app.scopes).split(/\s+/).includes(s))) return oauthReturn(ctx, q, { error: 'invalid_scope' });
  // source: spec:requestOAuthAuthorize "Required for public clients."
  // source: spec:requestOAuthAuthorize "Must be `S256`."
  const challenge = q.get('code_challenge');
  if (((app.public || app.pkce_required) && !challenge) || (challenge !== null && (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || q.get('code_challenge_method') !== 'S256'))) return oauthReturn(ctx, q, { error: 'invalid_request' });
  // source: spec:requestOAuthAuthorize "minimum 8 characters"
  if ((!challenge && !q.has('state')) || (q.has('state') && q.get('state')!.length < 8)) return oauthReturn(ctx, q, { error: 'invalid_request' });
  if (q.has('response_mode') && !['query', 'form_post'].includes(q.get('response_mode')!)) return oauthReturn(ctx, q, { error: 'invalid_request' });
  const prompts = (q.get('prompt') ?? '').split(/\s+/).filter(Boolean);
  // source: spec:requestOAuthAuthorize "Supported values are `none` (no user interaction), `login` (force re-authentication), and `consent` (force consent screen)."
  if (prompts.some((v) => !['none', 'login', 'consent'].includes(v)) || (prompts.includes('none') && prompts.length > 1)) return oauthReturn(ctx, q, { error: 'invalid_request' });
  // source: spec:requestOAuthAuthorize "The URI must not contain a fragment. Only one `resource` value is supported."
  const resource = q.get('resource');
  if (resource !== null && (q.getAll('resource').length !== 1 || !URL.canParse(resource) || new URL(resource).hash)) return oauthReturn(ctx, q, { error: 'invalid_target' });
  if (scopes.includes('user:org:read') && organizationSettings(await rootOf(ctx)).enabled !== true) return oauthReturn(ctx, q, { error: 'invalid_scope' });
  return app;
}

/** Same authorize flow for GET, POST and the consent decision. */
export async function oauthAuthorize(ctx: HandlerContext, q: URLSearchParams, consent?: boolean): Promise<Response> {
  const app = await oauthRequest(ctx, q);
  if (app instanceof Response) return app;
  const who = await signedIn(ctx);
  const prompts = (q.get('prompt') ?? '').split(/\s+/);
  if (who instanceof Response || (consent === undefined && prompts.includes('login'))) {
    if (prompts.includes('none')) return oauthReturn(ctx, q, { error: 'login_required' });
    const returnTo = `${await oauthPublicBase(ctx)}/oauth/authorize?${q}`;
    return new Response(null, { status: 302, headers: { location: `${await oauthPublicBase(ctx)}/sign-in?redirect_url=${encodeURIComponent(returnTo)}`, 'cache-control': 'no-store' } });
  }
  // source: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth "The consent screen is enabled by default for all OAuth apps."
  const grantId = ctx.crypto.sha256(`${who.user.id}:${app.client_id}`);
  const prior = ctx.get('_oauth_consent', grantId);
  const scope = q.get('scope')!;
  if (consent === undefined && (app.consent_screen_enabled === true || prompts.includes('consent')) && (prompts.includes('consent') || scope.split(/\s+/).some((s) => !String(prior?.scope ?? '').split(/\s+/).includes(s)))) {
    if (prompts.includes('none')) return oauthReturn(ctx, q, { error: 'consent_required' });
    return new Response(null, { status: 302, headers: { location: `${await oauthPublicBase(ctx)}/oauth/consent?${q}`, 'cache-control': 'no-store' } });
  }
  // source: spec:submitOAuthConsent "any other value is treated as a denial and returns an `access_denied` error"
  if (consent === false) return oauthReturn(ctx, q, { error: 'access_denied' });
  let orgId: string | null = null;
  // source: spec:submitOAuthConsent "The authenticated user must be a member of this organization."
  if (scope.split(/\s+/).includes('user:org:read')) {
    orgId = q.get('organization_id') ?? (who.session.last_active_organization_id as string | null) ?? null;
    if (orgId && !membershipsOf(who.root, String(who.user.id)).some((m) => m.organization_id === orgId)) return oauthReturn(ctx, q, { error: 'invalid_request' });
  }
  if (consent) await ctx.record('_oauth_consent', { scope }, grantId);
  const id = ctx.mint('_oauth_code');
  const code = `clk_code_${ctx.crypto.base62From(await ctx.secret(`oauth-code:${id}`), 48)}`;
  // source: spec:getOAuthToken "Authorization code**: 10 minutes"
  await ctx.record('_oauth_code', { status: 'active', client_id: app.client_id, user_id: who.user.id, redirect_uri: q.get('redirect_uri'), scope, nonce: q.get('nonce'), challenge: q.get('code_challenge'), org_id: orgId, resource: q.get('resource'), expires_at: ms(ctx) + 600_000 }, sha256(code));
  return oauthReturn(ctx, q, { code });
}

/** Mint both token views from the same grant, using the World's instance key and clock. */
export async function oauthTokens(ctx: HandlerContext, grant: Row, refresh?: string): Promise<Response> {
  const root = await rootOf(ctx);
  const user = root.get('User', String(grant.user_id));
  if (!user) return oauthError(401, 'invalid_grant', 'The user no longer exists.');
  const scope = String(grant.scope);
  const iat = Math.floor(ms(ctx) / 1000);
  // source: spec:getOAuthToken "Access token**: 1 day (86400 seconds)"
  const claims: Row = { iss: issuerOf(root), sub: user.id, aud: grant.resource ? [grant.resource] : [grant.client_id], client_id: grant.client_id, scope, ...(grant.org_id ? { org_id: grant.org_id } : {}) };
  // source: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth "Clerk issues OAuth access tokens as JSON Web Tokens (JWTs) by default."
  // source: archive:https://registry.npmjs.org/@clerk/backend/-/backend-3.11.6.tgz#sha256=79e3c0215243ddfb955d0e6c4296c575e38d849dc43ba847cf8f6b6590b34454!/package/dist/internal.js "OAUTH_ACCESS_TOKEN_TYPES"
  const access = signJwt(root, { ...claims, jti: ctx.mint('_oauth_access') }, { now: iat, expiresInSeconds: 86400, typ: 'at+jwt' });
  if (!refresh) {
    const id = ctx.mint('_oauth_refresh');
    refresh = `clk_refresh_${ctx.crypto.base62From(await ctx.secret(`oauth-refresh:${id}`), 48)}`;
    // The guide says never expires; the pinned wire spec states ten years. Follow this pack's pinned spec.
    // source: spec:getOAuthToken "Refresh token**: 10 years"
    await ctx.record('_oauth_refresh', { client_id: grant.client_id, user_id: grant.user_id, scope: grant.scope, nonce: grant.nonce, org_id: grant.org_id, resource: grant.resource, expires_at: ms(ctx) + 315_360_000_000 }, sha256(refresh));
  }
  const out: Row = { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 86400, scope };
  // source: spec:getOAuthToken "When the `openid` scope is included"
  if (scope.split(/\s+/).includes('openid')) {
    const idClaims: Row = { iss: claims.iss, sub: user.id, aud: grant.client_id, ...(grant.nonce ? { nonce: grant.nonce } : {}), ...(grant.org_id ? { org_id: grant.org_id } : {}) };
    if (scope.split(/\s+/).includes('email')) { const email = primaryEmail(user); idClaims.email = email?.email_address ?? null; idClaims.email_verified = (email?.verification as Row | undefined)?.status === 'verified'; }
    if (scope.split(/\s+/).includes('profile')) Object.assign(idClaims, { name: [user.first_name, user.last_name].filter(Boolean).join(' '), given_name: user.first_name, family_name: user.last_name, picture: user.image_url });
    out.id_token = signJwt(root, idClaims, { now: iat, expiresInSeconds: 86400 });
  }
  return Response.json(out, { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
}

/** The one Frontend API gap answer, including the recorded signed-out refusal. */
export async function frontendGap(ctx: HandlerContext, authenticatedFlow = false): Promise<Response> {
  const client = cookieClient(ctx);
  const needsSession = new URL(ctx.call.request.url).pathname.startsWith('/v1/me');
  const signedIn = client !== undefined && (!needsSession || activeSessions(ctx, client).length > 0);
  return !authenticatedFlow && ctx.call.operation.id !== 'unmatched' && !signedIn ? ctx.refuse({ status: 401, code: 'signed_out', kind: 'Signed out', message: 'You are signed out' }) : new Response('404 page not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
