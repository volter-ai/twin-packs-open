// What LinkedIn's families share: the stored shapes, who a token is and what it may do, the API version a request
// names, the daily limits an application meets, the uploads' tokens and bytes, and the media a file holds.
import { isReadOnlyRequest, recordPerson, personOf, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };

// ── the pages this pack reads ────────────────────────────────────────────────────────────────

export const POSTS_API = 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09';
export const IMAGES_API = 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09';
export const VIDEOS_API = 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09';

// ── stored types ─────────────────────────────────────────────────────────────────────────────

export const POST = 'Post';
export const IMAGE = 'Image';
export const VIDEO = 'Video';
export const ORGANIZATION = 'Organization';
export const MEMBER = 'member';
export const ACL = 'organization_acl';
export const APP = 'developer_app';
export const TOKEN = '_access_token';
export const USAGE = '_usage';
export const UPLOAD = '_upload';

/** A stored row as LinkedIn answers it: its own fields, without the kernel's and the pack's bookkeeping. */
export function view(ctx: HandlerContext, row: Row): Row {
  const own = ctx.own(row);
  const out: Row = {};
  for (const [k, v] of Object.entries(own)) if (!k.startsWith('_') && k !== 'deleted') out[k] = v;
  return out;
}

/** The World clock, in LinkedIn's milliseconds since the epoch. */
export const nowMs = (ctx: HandlerContext): number => Date.parse(ctx.occurredAt);

/** A body's object, or an empty one. */
export const bodyOf = (ctx: HandlerContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});

/** A query parameter as the request sent it. */
export const queryOf = (ctx: HandlerContext, name: string): string | null => new URL(ctx.call.request.url).searchParams.get(name);

// ── refusals ─────────────────────────────────────────────────────────────────────────────────

/** LinkedIn's error body: "message - A description of the error. serviceErrorCode - A subcode that further classifies
 *  the error. status - The type of error (status code)", and `code` where the Posts API page's error table names the
 *  error. Where the documentation stops: the pages publish one serviceErrorCode (401 for an empty token, its sample);
 *  for every other error the twin's subcode is the status, as that sample's is. */
// source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling "Error responses have the following details:"
export function refuse(status: number, message: string, code?: string): Response {
  return Response.json({ message, serviceErrorCode: status, status, ...(code ? { code } : {}) }, { status });
}

/** The answer to a request's version, as the error responses page publishes it: status, code and message. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/error-responses?view=li-lms-2026-09 "This is the error response returned when the version header is missing in the request."
const versionError = (status: number, message: string, code: string): Response => Response.json({ status, code, message }, { status });

// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "A required field is missing. Ensure all required fields such as author, visibility, distribution, and lifecycleState are present."
export const missingField = (field: string): Response => refuse(400, `${field} is required but missing`, 'MISSING_FIELD');
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "{field} value {value} must be a {urnType} URN. Verify the URN type used for fields such as author or content.media.id."
export const wrongUrnType = (field: string, value: unknown, urnType: string): Response => refuse(400, `${field} value ${String(value)} must be a ${urnType} URN`, 'INVALID_URN_TYPE');
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "The URN ID provided is invalid. Check the format of any URNs in the request."
export const invalidUrnId = (field: string, value: unknown): Response => refuse(400, `${field} value ${String(value)} is not a valid URN ID`, 'INVALID_URN_ID');
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "{field} cannot be set to {value}. Verify that enum values for fields such as visibility, feedDistribution, and lifecycleState are valid."
export const invalidValue = (field: string, value: unknown): Response => refuse(400, `${field} cannot be set to ${String(value)}`, 'INVALID_VALUE_FOR_FIELD');
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "The request was well-formed but could not be processed due to semantic errors. Review field values for logical consistency."
export const unprocessable = (message: string): Response => refuse(422, message, 'UNPROCESSABLE_ENTITY');
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "The requested post was not found. Verify that the URN provided in the request is correct."
export const notFound = (what: string): Response => refuse(404, `${what} was not found`, 'NOT_FOUND');
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "Insufficient permissions to perform the requested action. Ensure the required OAuth scope (w_organization_social, w_member_social, r_organization_social, or r_member_social) is granted and that the authenticated member has the necessary company page role."
export const accessDenied = (needed: string): Response => refuse(403, `Not enough permissions to access: ${needed}`, 'ACCESS_DENIED');

// ── the credential ───────────────────────────────────────────────────────────────────────────

/** Who a request's token is: the member it was issued to, the developer application it was issued for, its scopes. */
export type Caller = { member: Row; person: string; app: string; scopes: string[]; token: Row };

export const tokenKey = (ctx: HandlerContext, token: string): string => ctx.crypto.sha256(`linkedin-access-token:${token}`);

/** The member and scopes the request's bearer token names, or LinkedIn's 401. */
export function callerOf(ctx: HandlerContext): Caller | Response {
  const header = ctx.call.request.headers.get('authorization');
  // source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling "Empty OAuth2 access token The authentication header is missing or empty."
  // source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling "Empty oauth2_access_token"
  if (!header || !header.trim()) return refuse(401, 'Empty oauth2_access_token');
  const bearer = /^Bearer\s+(.+)$/i.exec(header.trim());
  // source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling "Unknown authentication schema Unrecognized authentication header schema."
  if (!bearer) return refuse(401, 'Unknown authentication schema');
  const token = ctx.row(TOKEN, tokenKey(ctx, bearer[1]!.trim()));
  // source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling "Invalid access token Incorrect access token, make sure you follow the authentication procedure to get a correct access token."
  if (!token || token.invalidated === true) return refuse(401, 'Invalid access token');
  // source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling "Expired access token The access token has expired"
  if (Number(token.expires_at) <= nowMs(ctx)) return refuse(401, 'Expired access token');
  const member = ctx.row(MEMBER, String(token.member));
  if (!member) return refuse(401, 'Invalid access token');
  return { member, person: `urn:li:person:${String(member.sub)}`, app: String(token.client_id), scopes: (token.scopes as string[]) ?? [], token };
}

/** Whether a caller holds any of these scopes. */
export const holds = (who: Caller, scopes: string[]): boolean => who.scopes.includes(FIRST_PARTY) || scopes.some((s) => who.scopes.includes(s));

/** What a member signed in at linkedin.com holds: LinkedIn's own pages act for them in full, a page's roles still
 *  deciding what they may do as the page. */
export const FIRST_PARTY = 'linkedin.com';

/** The member signed in at linkedin.com, as a caller of LinkedIn's own operations. */
export const memberCaller = (member: Row): Caller => ({ member, person: `urn:li:person:${String(member.sub)}`, app: FIRST_PARTY, scopes: [FIRST_PARTY], token: {} });

/** The page roles a member holds on an organization, approved. */
export function rolesOn(ctx: HandlerContext, person: string, organization: string): string[] {
  return ctx.rowsRaw(ACL).filter((a) => a.roleAssignee === person && a.organization === organization && a.state === 'APPROVED').map((a) => String(a.role));
}

// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "Restricted to organizations where the authenticated member has one of the following company page roles"
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-09 "CONTENT_ADMINISTRATOR Access to create and manage Page content"
export const POSTING_ROLES = ['ADMINISTRATOR', 'DIRECT_SPONSORED_CONTENT_POSTER', 'CONTENT_ADMINISTRATOR'];
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "For videos with company URN owners, the caller needs to have ADMIN or DSC permissions for the company page."
export const MEDIA_ROLES = ['ADMINISTRATOR', 'DIRECT_SPONSORED_CONTENT_POSTER'];

/** Whether a caller may act as `owner` (a person or an organization URN), given the scopes that let it and the page
 *  roles an organization asks for. */
export function mayActAs(ctx: HandlerContext, who: Caller, owner: string, scopes: { organization: string[]; member: string[] }, roles: string[]): boolean {
  if (owner.startsWith('urn:li:organization:')) return holds(who, scopes.organization) && rolesOn(ctx, who.person, owner).some((r) => roles.includes(r));
  return owner === who.person && holds(who, scopes.member);
}

// ── the API version ──────────────────────────────────────────────────────────────────────────

// source: https://learn.microsoft.com/en-us/linkedin/marketing/versioning?view=li-lms-2026-09 "September 2026 202609"
export const LATEST_VERSION = 202609;

/** LinkedIn's refusal of a request's Linkedin-Version, or nothing: the header is required on every versioned call, and
 *  a version is answered from its release until it is sunset. Where the documentation stops: one sunset is published
 *  (202510's on 15 October 2026, a year after its month), so each version is taken to be answered from the first of its
 *  month until the 15th of the month a year after it, the latest is the one this pack serves, and a value that is no
 *  YYYYMM month is a version that does not exist. */
export function versionRefusal(ctx: HandlerContext): Response | undefined {
  const raw = ctx.call.request.headers.get('linkedin-version');
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/versioning?view=li-lms-2026-09 "LinkedIn expects every versioned API call to specify a version; the latest version is not applied by default."
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/error-responses?view=li-lms-2026-09 "A version must be present. Please specify a version by adding the Linkedin-Version header."
  if (!raw || !raw.trim()) return versionError(400, 'A version must be present. Please specify a version by adding the Linkedin-Version header.', 'VERSION_MISSING');
  const value = raw.trim();
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/error-responses?view=li-lms-2026-09 "Requested version yyyymmdd is not active"
  const inactive = (): Response => versionError(426, `Requested version ${value} is not active`, 'NONEXISTENT_VERSION');
  const m = /^(\d{4})(\d{2})$/.exec(value);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12 || Number(value) > LATEST_VERSION) return inactive();
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/versioning?view=li-lms-2026-09 "Our versioned API releases follow a monthly cycle."
  const released = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/versioning?view=li-lms-2026-09 "The Marketing Version 202510 (Marketing October 2025) will be sunset on October 15, 2026."
  const sunset = Date.UTC(Number(m[1]) + 1, Number(m[2]) - 1, 15);
  return nowMs(ctx) < released || nowMs(ctx) >= sunset ? inactive() : undefined;
}

// ── the application's daily limits ───────────────────────────────────────────────────────────

/** The resource a request's daily limit counts against: the first segment of its path after /rest or /v2. */
export const limitedResource = (path: string): string => path.replace(/^\/(rest|v2)\//, '').split(/[/?]/)[0] ?? '';

/** A call counted against its application's daily limits for the resource, or LinkedIn's 429 when either limit is
 *  spent. "Rate limits specify the maximum number of API calls that can be made in a 24 hour period. These limits
 *  reset at midnight UTC every day", an application's and a member's alike; "Standard rate limits are not published in
 *  documentation", so an application's limits are those its Developer Portal page shows (the World's limits door). A
 *  read-only request is answered from what it finds and spends nothing. */
// source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits "These limits reset at midnight UTC every day."
export async function spend(ctx: HandlerContext, who: Caller, resource: string): Promise<Response | undefined> {
  const app = ctx.row(APP, who.app);
  const day = ctx.occurredAt.slice(0, 10);
  const used = (key: string): number => Number(ctx.row(USAGE, key)?.count ?? 0);
  // the limits the call counts against: the endpoint's, where the Analytics tab shows one, and, for a Community
  // Management API application (which every application of that product starts at, and stays at in this World), the
  // Development tier's on all its APIs together
  const limits: Array<{ resource: string; member?: number; application?: number }> = [];
  const shown = ((app?.limits as Row | undefined)?.[resource] ?? undefined) as { member?: number; application?: number } | undefined;
  if (shown) limits.push({ resource, ...shown });
  if (((app?.products as string[] | undefined) ?? []).includes('Community Management API')) limits.push({ resource: '*', ...DEVELOPMENT_TIER });
  const keys = limits.map((l) => ({ l, member: `${day}:${who.app}:${String(who.member.sub)}:${l.resource}`, app: `${day}:${who.app}:*:${l.resource}` }));
  if (keys.some(({ l, member, app: all }) => (l.member !== undefined && used(member) >= l.member) || (l.application !== undefined && used(all) >= l.application))) {
    // source: https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/error-handling "Resource level throttle limit for calls to this resource is reached."
    return refuse(429, 'Resource level throttle limit for calls to this resource is reached.', 'TOO_MANY_REQUESTS');
  }
  if (isReadOnlyRequest(ctx.call.request)) return undefined;
  for (const { member, app: all } of keys) for (const key of [member, all]) await countCall(ctx, key);
  return undefined;
}

/** A Community Management API application's Development tier: its calls a day on all its APIs, the application's and
 *  each member's. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-09 "All applications start with Development tier."
// source: https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-09 "All APIs: 500 API calls for an app for 24 hrs 100 API calls per member of an App for 24 hrs"
export const DEVELOPMENT_TIER = { application: 500, member: 100 };

/** One more call on a day's count. */
async function countCall(ctx: HandlerContext, key: string): Promise<void> {
  if (!ctx.row(USAGE, key)) await ctx.record(USAGE, { count: 0 }, key);
  await ctx.accumulate(USAGE, key, { count: 1 }, 'usage.count');
}

// ── URNs ─────────────────────────────────────────────────────────────────────────────────────

/** A URN's type and id (`urn:li:share:123` is share, 123), or undefined for what is not a LinkedIn URN. */
export function urnOf(value: unknown): { type: string; id: string } | undefined {
  const m = /^urn:li:([A-Za-z]+):(.+)$/.exec(String(value ?? ''));
  return m ? { type: m[1]!, id: m[2]! } : undefined;
}

/** A post's stored id (its number) from its URN, when the URN is a share's or a UGC post's. */
export function postKey(urn: string): string | undefined {
  const u = urnOf(urn);
  return u && (u.type === 'share' || u.type === 'ugcPost') && /^\d+$/.test(u.id) ? u.id : undefined;
}

/** A post by its URN, live, as stored. */
export function postByUrn(ctx: HandlerContext, urn: string): Row | undefined {
  const key = postKey(urn);
  const row = key ? ctx.row(POST, key) : undefined;
  return row && ctx.own(row).id === urn ? row : undefined;
}

// ── tokens the World issues ──────────────────────────────────────────────────────────────────

/** An opaque value LinkedIn issues (an access token, an upload URL's signature), from the World's secret for its label. */
export async function issued(ctx: HandlerContext, label: string, length = 64): Promise<string> {
  const secret = await ctx.secret(label);
  let out = '';
  for (let round = 0; out.length < length; round += 1) out += ctx.crypto.digest('sha512', `${secret}:${round}`, 'base64url');
  return out.slice(0, length);
}

/** An access token's lifetime, sixty days in seconds. */
// source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow "Currently, all access tokens are issued with a 60-day lifespan."
export const TOKEN_LIFETIME_S = 5_184_000;

/** A token the Developer Portal's generator issues a member for an application: the scopes, which the application's
 *  products must grant, and every earlier token of the same member and application whose scopes were others,
 *  invalidated. */
export async function issueToken(ctx: HandlerContext, app: Row, member: Row, scopes: string[]): Promise<{ access_token: string; expires_in: number; scope: string }> {
  const wanted = [...new Set(scopes)].sort();
  for (const t of ctx.rowsRaw(TOKEN).filter((t) => t.client_id === app.client_id && t.member === member.sub && t.invalidated !== true)) {
    if (JSON.stringify([...((t.scopes as string[]) ?? [])].sort()) === JSON.stringify(wanted)) continue;
    // source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow "If you request a different scope than the previously granted scope, all the previous access tokens are invalidated."
    const refused = ctx.legal(TOKEN, 'invalidated', 'tokens', false, 'true', String(t.id), 'external');
    if (refused) continue;
    await ctx.write(TOKEN, String(t.id), { invalidated: true }, 'access_token.invalidate');
  }
  const label = await ctx.issue(TOKEN);
  const token = await tokenValue(ctx, String(app.client_id), label);
  // kept by its digest, never as issued: the label it was drawn from is what lets the World answer it again
  await ctx.record(TOKEN, { client_id: app.client_id, member: member.sub, scopes: wanted, issued_at: nowMs(ctx), expires_at: nowMs(ctx) + TOKEN_LIFETIME_S * 1000, invalidated: false, _label: label }, tokenKey(ctx, token));
  // source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow "URL-encoded, space-delimited list of member permissions your application has requested on behalf of the user."
  return { access_token: token, expires_in: TOKEN_LIFETIME_S, scope: wanted.join(' ') };
}

/** The value of an application's token, drawn again from the World's secret for its label. */
export async function tokenValue(ctx: HandlerContext, clientId: string, n: string): Promise<string> {
  // source: https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow "The length of access tokens is ~500 characters."
  return `AQ${await issued(ctx, `access-token:${clientId}:${n}`, 498)}`;
}

// ── the World's accounts ─────────────────────────────────────────────────────────────────────

/** The scopes a developer application's products grant (the Developer Portal's Products tab); r_member_social is
 *  granted to none. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "Post, comment, and like posts on behalf of an organization."
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview?view=li-lms-2026-09 "r_member_social is a closed permission."
export const PRODUCT_SCOPES: Record<string, string[]> = {
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-09 "the OAuth permissions granted upon approval"
  'Community Management API': ['r_1st_connections_size', 'r_basicprofile', 'r_organization_followers', 'r_organization_social', 'r_organization_social_feed', 'rw_organization_admin', 'w_member_social', 'w_member_social_feed', 'w_organization_social', 'w_organization_social_feed', 'r_member_profileAnalytics', 'r_member_postAnalytics'],
  'Sign In with LinkedIn using OpenID Connect': ['openid', 'profile', 'email'],
  'Share on LinkedIn': ['w_member_social'],
};

/** Why LinkedIn's join form would not make a member of what it was sent, or undefined: a first or last name left blank,
 *  an address that is no email address, a password under six characters, or an email already joined. Where the
 *  documentation stops: no LinkedIn page documents the join's rules; the rule and the words are linkedin.com's join page's
 *  own (https://www.linkedin.com/signup/cold-join, read with GET on 2026-10-03: its strings i18n_tooShort_password
 *  "Password must be 6 characters or more.", i18n_required_first-name and the rest, kept in HTML comments its script
 *  shows, which the citation check cannot read); that an email joins once, and the words for it, are the twin's. */
export function joinRefusal(ctx: HandlerContext, b: { email: string; password: string; given_name: string; family_name: string }): 'first' | 'last' | 'email' | 'no-password' | 'password' | 'taken' | undefined {
  if (!b.given_name.trim()) return 'first';
  if (!b.family_name.trim()) return 'last';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())) return 'email';
  if (!b.password.trim()) return 'no-password';
  if (b.password.length < 6) return 'password';
  return memberOfEmail(ctx, b.email) ? 'taken' : undefined;
}

/** The join page's words for each refusal (joinRefusal): its own, but for an email already joined. */
export const JOIN_REFUSALS: Record<string, string> = {
  first: 'Please enter your first name.',
  last: 'Please enter your last name.',
  email: 'Please enter a valid email address.',
  'no-password': 'Please enter your password.',
  password: 'Password must be 6 characters or more.',
  taken: 'Someone’s already using that email.',
};

/** A member (LinkedIn's sign-up: an email, a password and a name), made once per email. */
export async function ensureMember(ctx: HandlerContext, b: { email: string; password: string; given_name: string; family_name: string; locale?: string; headline?: string }): Promise<Row> {
  const email = b.email.trim().toLowerCase();
  const held = ctx.rowsRaw(MEMBER).find((m) => m._email === email);
  if (held) return held;
  const sub = ctx.mint(MEMBER);
  await recordPerson(ctx, email, b.password, { sub });
  return ctx.write(MEMBER, sub, {
    sub, name: `${b.given_name} ${b.family_name}`.trim(), given_name: b.given_name, family_name: b.family_name, locale: b.locale ?? 'en-US',
    email, email_verified: true, _email: email, ...(b.headline ? { _headline: b.headline } : {}),
  }, 'member.create');
}

/** The member a signed-in person is. */
export function memberOfEmail(ctx: HandlerContext, email: string): Row | undefined {
  const normalized = email.trim().toLowerCase();
  const held = ctx.rowsRaw(MEMBER).find((row) => row._email === normalized);
  if (held) return held;
  const person = personOf(ctx, normalized);
  return person ? ctx.row(MEMBER, String(person.sub)) : undefined;
}

/** A company page (LinkedIn's Create a Page), made once per vanity name, with its creator its administrator. */
export async function ensureOrganization(ctx: HandlerContext, b: { name: string; vanityName: string; admin: Row; website?: string; description?: string; tagline?: string; industry?: string; staffCountRange?: string; organizationType?: string }): Promise<Row> {
  const vanity = b.vanityName.toLowerCase();
  const held = ctx.rowsRaw(ORGANIZATION).find((o) => String(o.vanityName).toLowerCase() === vanity);
  if (held) return held;
  const id = ctx.mint(ORGANIZATION);
  const urn = `urn:li:organization:${id}`;
  const locale = { country: 'US', language: 'en' };
  await ctx.write(ORGANIZATION, id, {
    id: Number(id), $URN: urn, vanityName: b.vanityName, localizedName: b.name, name: { localized: { en_US: b.name }, preferredLocale: locale },
    ...(b.website ? { localizedWebsite: b.website, website: { localized: { en_US: b.website }, preferredLocale: locale } } : {}),
    ...(b.description ? { localizedDescription: b.description, description: { localized: { en_US: b.description }, preferredLocale: locale } } : {}),
    primaryOrganizationType: 'NONE', organizationType: b.organizationType ?? 'PRIVATELY_HELD', staffCountRange: b.staffCountRange ?? 'SIZE_2_TO_10',
    industries: [b.industry ?? 'urn:li:industry:4'], groups: [], locations: [], alternativeNames: [], specialties: [], localizedSpecialties: [],
    defaultLocale: locale, versionTag: '1', ...(b.tagline ? { _tagline: b.tagline } : {}),
  }, 'organization.create');
  const assignee = `urn:li:person:${String(b.admin.sub)}`;
  // the Organization Access Control page's samples name the page as `organization` and, in others, `organizationTarget`:
  // a role answers both
  await ctx.write(ACL, `${id}:${String(b.admin.sub)}:ADMINISTRATOR`, { role: 'ADMINISTRATOR', organization: urn, organizationTarget: urn, roleAssignee: assignee, state: 'APPROVED' }, 'organization_acl.create');
  return ctx.row(ORGANIZATION, id)!;
}

/** Whether a set of products is one an application may hold: the Community Management API alone. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview?view=li-lms-2026-09 "Only request Community Management API Development Tier access with new developer applications that don't have access to other API products."
export const productsAllowed = (products: string[]): boolean => !products.includes('Community Management API') || products.length === 1;

/** A developer application (the Developer Portal's Create app, with its products), made once per name. */
export async function ensureApp(ctx: HandlerContext, name: string, products: string[]): Promise<{ app: Row; secret: string }> {
  const held = ctx.rowsRaw(APP).find((a) => a.name === name);
  if (held) return { app: held, secret: await issued(ctx, `client-secret:${String(held.client_id)}`, 16) };
  const app = await makeApp(ctx, name, products);
  return { app, secret: await issued(ctx, `client-secret:${app.client_id}`, 16) };
}

/** A new developer application, without adopting another app's name. */
export function makeApp(ctx: HandlerContext, name: string, products: string[], owner?: string): Promise<Row> {
  const scopes = [...new Set(products.flatMap((p) => PRODUCT_SCOPES[p] ?? []))].sort();
  return ctx.create(APP, (id) => ({ client_id: id, name, products, scopes, limits: {}, ...(owner ? { _owner: owner } : {}) }), 'developer_app.create');
}

// ── uploads ──────────────────────────────────────────────────────────────────────────────────

// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "Typically URLs expire 30 days from the time an upload is initialized."
export const UPLOAD_URL_LIFETIME_MS = 30 * 86_400_000;

/** An upload URL's token, kept by its digest with what it uploads: the asset, the part and its byte range. */
export async function uploadToken(ctx: HandlerContext, label: string, fields: Row): Promise<string> {
  const token = await issued(ctx, `upload:${label}`, 40);
  await ctx.record(UPLOAD, { ...fields, expires_at: nowMs(ctx) + UPLOAD_URL_LIFETIME_MS }, `upload:${ctx.crypto.sha256(token)}`);
  return token;
}

/** The upload a URL's token names, for this asset and kind, or the reason it is refused: "Trying to upload to expired
 *  URLs would throw a 401 error." Where the documentation stops: a token LinkedIn never issued is answered the same. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "Trying to upload to expired URLs would throw a 401 error."
export function uploadOf(ctx: HandlerContext, token: string | null, asset: string, kind: string): Row | Response {
  const row = token ? ctx.row(UPLOAD, `upload:${ctx.crypto.sha256(token)}`) : undefined;
  if (!row || row.asset !== asset || row.kind !== kind) return refuse(401, 'The upload URL is not valid');
  if (Number(row.expires_at) <= nowMs(ctx)) return refuse(401, 'The upload URL has expired');
  return row;
}

/** A request's bytes. */
export async function bytesOf(ctx: HandlerContext): Promise<Uint8Array> {
  return new Uint8Array(await ctx.call.request.clone().arrayBuffer());
}

/** The bytes kept as the pack's blob, by their digest; the digest. */
export async function keep(ctx: HandlerContext, bytes: Uint8Array): Promise<string> {
  const digest = ctx.crypto.digest('sha256', bytes, 'hex');
  await ctx.blobs.put(`media/${digest}`, bytes);
  return digest;
}

/** An asset's id, as LinkedIn's look: its kind's prefix and twelve letters. */
export const assetUrn = (kind: 'image' | 'video', asset: string): string => `urn:li:${kind}:${asset}`;

/** The asset an image or video URN names, or the refusal of a URN of another type. */
export function assetOf(field: string, value: unknown, kind: 'image' | 'video'): string | Response {
  const u = urnOf(value);
  if (!u) return invalidUrnId(field, value);
  if (u.type !== kind) return wrongUrnType(field, value, kind);
  return u.id;
}

// ── what a file is ───────────────────────────────────────────────────────────────────────────

/** An image's format and size, for the formats LinkedIn takes ("JPG, GIF, and PNG formats"), or undefined. */
export function sniffImage(b: Uint8Array): { type: string; width: number; height: number } | undefined {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: 'image/png', width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { type: 'image/gif', width: b[6]! | (b[7]! << 8), height: b[8]! | (b[9]! << 8) };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return jpegSize(b);
  return undefined;
}

/** What a file a person attaches in linkedin.com's share box on a desktop is, by its bytes, or undefined for one the
 *  share box does not take: a video (MP4, and MOV, an MP4's QuickTime kin, which the twin reads alike), or an image (JPEG,
 *  GIF, PNG, WEBP), as LinkedIn Help's table of files a person can post ticks them for Desktop. Where the documentation
 *  stops: HEIF/HEIC is ticked for iOS alone, so a desktop's is not taken; WEBM and MKV are ticked for Desktop, and the
 *  twin, which reads no Matroska file, does not take them (a gap); that a file not taken is refused before anything is
 *  posted, and in what words, is the twin's. */
// source: https://www.linkedin.com/help/linkedin/answer/a564109 "WEBP"
export function shareBoxKind(bytes: Uint8Array): 'video' | 'image' | undefined {
  if (sniffMp4(bytes)) return 'video';
  return sniffImage(bytes) ?? sniffWebp(bytes) ? 'image' : undefined;
}

/** A WebP's size, from its first chunk: VP8X's canvas, VP8L's header or VP8's frame. */
export function sniffWebp(b: Uint8Array): { type: string; width: number; height: number } | undefined {
  const tag = (at: number): string => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
  if (b.length < 30 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return undefined;
  const chunk = tag(12);
  const u24 = (at: number): number => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
  if (chunk === 'VP8X') return { type: 'image/webp', width: 1 + u24(24), height: 1 + u24(27) };
  if (chunk === 'VP8L') {
    const bits = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
    return { type: 'image/webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ') return { type: 'image/webp', width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
  return undefined;
}

/** A JPEG's size, from its first start-of-frame marker (SOF0 to SOF15, but DHT, JPG and DAC). */
function jpegSize(b: Uint8Array): { type: string; width: number; height: number } | undefined {
  let at = 2;
  let found: number | undefined;
  while (found === undefined && at + 9 < b.length) {
    const marker = b[at + 1]!;
    if (b[at] === 0xff && marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) found = at;
    else at += b[at] === 0xff ? 2 + ((b[at + 2]! << 8) | b[at + 3]!) : 1;
  }
  return found === undefined ? undefined : { type: 'image/jpeg', height: (b[found + 5]! << 8) | b[found + 6]!, width: (b[found + 7]! << 8) | b[found + 8]! };
}

/** An MP4's length and picture size, read from its boxes (ftyp, then moov's mvhd and the video track's tkhd), or
 *  undefined when the bytes are not an MP4. */
export function sniffMp4(b: Uint8Array): { durationMs: number; width: number; height: number } | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = (at: number): string => String.fromCharCode(b[at + 4]!, b[at + 5]!, b[at + 6]!, b[at + 7]!);
  if (b.length < 16 || type(0) !== 'ftyp') return undefined;
  let durationMs = -1;
  let width = 0;
  let height = 0;
  const walk = (from: number, to: number): void => {
    let at = from;
    while (at + 8 <= to) {
      let size = v.getUint32(at);
      const name = type(at);
      let header = 8;
      if (size === 1 && at + 16 <= to) { size = Number(v.getBigUint64(at + 8)); header = 16; }
      if (size < header || at + size > to) return;
      if (name === 'moov' || name === 'trak') walk(at + header, at + size);
      if (name === 'mvhd') durationMs = mvhdMs(v, at + header);
      if (name === 'tkhd') {
        const tk = tkhdSize(v, at + header, size - header);
        if (tk.width > 0 && tk.height > 0) { width = tk.width; height = tk.height; }
      }
      at += size;
    }
  };
  walk(0, b.length);
  return durationMs < 0 ? undefined : { durationMs, width, height };
}

/** A movie header's length in milliseconds. */
function mvhdMs(v: DataView, at: number): number {
  const version = v.getUint8(at);
  const scale = version === 1 ? v.getUint32(at + 20) : v.getUint32(at + 12);
  const duration = version === 1 ? Number(v.getBigUint64(at + 24)) : v.getUint32(at + 16);
  return scale > 0 ? Math.round((duration * 1000) / scale) : 0;
}

/** A track header's picture size (16.16 fixed point at its end). */
function tkhdSize(v: DataView, at: number, length: number): { width: number; height: number } {
  return length >= 8 ? { width: v.getUint32(at + length - 8) >>> 16, height: v.getUint32(at + length - 4) >>> 16 } : { width: 0, height: 0 };
}

/** The smallest whole ratio of a picture's sides (1920×1080 is 16:9). */
export function aspect(width: number, height: number): { aspectRatioWidth: number; aspectRatioHeight: number } | undefined {
  if (width <= 0 || height <= 0) return undefined;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(width, height);
  return { aspectRatioWidth: width / g, aspectRatioHeight: height / g };
}

// ── where media is served ────────────────────────────────────────────────────────────────────

/** An image's download URL on LinkedIn's media host. */
export const imageDownloadUrl = (asset: string, at: number): string => `https://media.licdn.com/dms/image/v2/${asset}/image-shrink_1280/0/${at}?e=${Math.floor(at / 1000) + 2_592_000}&v=beta`;
/** A video's download URL on LinkedIn's playlist host. */
export const videoDownloadUrl = (asset: string, at: number): string => `https://dms.licdn.com/playlist/vid/v2/${asset}/mp4-720p-30fp-crf28/0/${at}?e=${Math.floor(at / 1000) + 2_592_000}&v=beta`;
/** A video's cover image URL on LinkedIn's media host. */
export const videoThumbnailUrl = (asset: string, at: number): string => `https://media.licdn.com/dms/image/v2/${asset}/videocover-high/0/${at}?e=${Math.floor(at / 1000) + 2_592_000}&v=beta`;
/** How long a download URL is good for, in the twin: thirty days. Where the documentation stops: "all URLs have an
 *  expiration time" names none. */
export const DOWNLOAD_URL_LIFETIME_MS = 30 * 86_400_000;

/** A media URL as LinkedIn hands it to a reader (an API's downloadUrl and thumbnail, a page's image and video): good for
 *  DOWNLOAD_URL_LIFETIME_MS from the moment it is handed out, its expiry (`e`, seconds) signed (`t`) under the World's
 *  secret, so a reader can neither extend it nor make one for media it was not handed. Who is handed one is who may see
 *  the media: the owner's token through the API, a post's viewers on its pages. Where the documentation stops: the pages
 *  name the expiry and the signing (downloadUrlExpiresAt), not how LinkedIn's media hosts answer a URL past either; the
 *  URL's form (`?e=…&v=beta&t=…`) is the pages' own samples'. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09 "Unless the use case has a security+legal exception, all URLs have an expiration time. If they don't, they can still expire because URLs are signed"
export async function mediaSigner(ctx: HandlerContext): Promise<(url: string) => { url: string; expiresAt: number }> {
  const key = await ctx.secret('media-urls');
  const e = String(Math.floor((nowMs(ctx) + DOWNLOAD_URL_LIFETIME_MS) / 1000));
  return (raw) => {
    const u = new URL(raw);
    u.search = `?e=${e}&v=beta&t=${mediaSignature(ctx, key, u.pathname, e)}`;
    return { url: u.toString(), expiresAt: Number(e) * 1000 };
  };
}

const mediaSignature = (ctx: HandlerContext, key: string, path: string, e: string): string => ctx.crypto.digest('sha256', `${key}:${path}:${e}`, 'base64url');

/** Whether a media URL a reader brings is one LinkedIn handed out, and still within its time. */
export async function mediaUrlHolds(ctx: HandlerContext, url: URL): Promise<boolean> {
  const e = url.searchParams.get('e') ?? '';
  const t = url.searchParams.get('t') ?? '';
  return /^\d+$/.test(e) && t === mediaSignature(ctx, await ctx.secret('media-urls'), url.pathname, e) && Number(e) * 1000 > nowMs(ctx);
}

/** An image or a video as the API answers it: its download URL (and a video's cover) handed out now. */
export async function mediaView(ctx: HandlerContext, row: Row): Promise<Row> {
  const out = view(ctx, row);
  if (typeof out.downloadUrl !== 'string') return out;
  const sign = await mediaSigner(ctx);
  const download = sign(out.downloadUrl);
  out.downloadUrl = download.url;
  out.downloadUrlExpiresAt = download.expiresAt;
  if (typeof out.thumbnail === 'string') out.thumbnail = sign(out.thumbnail).url;
  return out;
}

// ── processing ───────────────────────────────────────────────────────────────────────────────

/** How long LinkedIn takes over an image and a video, in the twin. Where the documentation stops: the pages give no
 *  time; an image's is a second and a video's three. */
export const IMAGE_PROCESSING_MS = 1_000;
export const VIDEO_PROCESSING_MS = 3_000;

/** A video file's verdict: AVAILABLE with its length and picture, or PROCESSING_FAILED with why. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "Length: Three seconds to 30 minutes."
export function videoVerdict(bytes: Uint8Array): Row {
  const mp4 = sniffMp4(bytes);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "File format: MP4."
  if (!mp4) return { _outcome: 'PROCESSING_FAILED', _reason: 'Unsupported file format: the uploaded file is not an MP4 video' };
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "File size: Between 75kb and 500MB."
  if (bytes.length < 75 * 1024 || bytes.length > 500 * 1024 * 1024) return { _outcome: 'PROCESSING_FAILED', _reason: `File size ${bytes.length} bytes is outside the supported size of 75 KB to 500 MB` };
  if (mp4.durationMs < 3_000 || mp4.durationMs > 1_800_000) return { _outcome: 'PROCESSING_FAILED', _reason: `Video duration ${mp4.durationMs} ms is outside the supported length of three seconds to 30 minutes` };
  return { _outcome: 'AVAILABLE', _duration: mp4.durationMs, _width: mp4.width, _height: mp4.height };
}

/** An image file's verdict: through the Images API, a JPG, GIF or PNG; through linkedin.com's share box, a WebP too, as
 *  LinkedIn Help's table of the files a person can post lists it. Where the documentation stops: the table's HEIF/HEIC
 *  is not taken here (the twin reads no HEIF's size). */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09 "Images with less than 36,152,320 pixels."
export function imageVerdict(bytes: Uint8Array, via: 'api' | 'share-box' = 'api'): Row {
  // source: https://www.linkedin.com/help/linkedin/answer/a564109 "WEBP"
  const image = sniffImage(bytes) ?? (via === 'share-box' ? sniffWebp(bytes) : undefined);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09 "JPG, GIF, and PNG formats"
  if (!image) return { _outcome: 'PROCESSING_FAILED', _reason: 'Unsupported file format: the uploaded file is not a JPG, GIF or PNG image' };
  if (image.width * image.height >= 36_152_320) return { _outcome: 'PROCESSING_FAILED', _reason: 'The image has more than 36,152,320 pixels' };
  return { _outcome: 'AVAILABLE', _width: image.width, _height: image.height, _content_type: image.type };
}

/** An image or video whose processing is due, settled by LinkedIn at the moment it fell due, and every post waiting on
 *  it published or failed with it. */
export async function settle(ctx: HandlerContext, resource: typeof IMAGE | typeof VIDEO, row: Row): Promise<void> {
  const due = Number(row._due_at);
  const then = await ctx.at(new Date(due).toISOString());
  const to = String(row._outcome);
  const refused = then.legal(resource, 'status', 'processing', 'PROCESSING', to, String(row.id), 'time');
  if (refused) return;
  const asset = String(row.id);
  const done: Row = { status: to };
  if (to === 'AVAILABLE') {
    const sides = aspect(Number(row._width ?? 0), Number(row._height ?? 0));
    Object.assign(done, sides ?? {}, { downloadUrl: resource === VIDEO ? videoDownloadUrl(asset, due) : imageDownloadUrl(asset, due), downloadUrlExpiresAt: due + DOWNLOAD_URL_LIFETIME_MS });
    // a cover only where its owner uploaded one: LinkedIn "may" add a system-generated one from the video's frames, which
    // the twin, decoding no video, cannot make, so it adds none and the player draws the video's own first frame
    // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "If the partner doesn't upload a thumbnail, a system generated thumbnail may be added to the video."
    if (resource === VIDEO) Object.assign(done, { duration: row._duration, ...(row._thumbnail_sha256 ? { thumbnail: videoThumbnailUrl(asset, due) } : {}) });
  } else if (resource === VIDEO) done.processingFailureReason = row._reason;
  await then.write(resource, asset, done, `${resource === VIDEO ? 'video' : 'image'}.processed`);
  const urn = assetUrn(resource === VIDEO ? 'video' : 'image', asset);
  for (const post of then.rowsRaw(POST).filter((p) => p.lifecycleState === 'PUBLISH_REQUESTED' && waitsOn(p, urn))) {
    const outcome = to === 'AVAILABLE' ? 'PUBLISHED' : 'PUBLISH_FAILED';
    if (then.legal(POST, 'lifecycleState', 'processing', 'PUBLISH_REQUESTED', outcome, String(post.id), 'vendor')) continue;
    const info = { ...((post.lifecycleStateInfo as Row) ?? {}) };
    if (outcome === 'PUBLISHED') delete info.contentStatus; else info.contentStatus = 'FAILED';
    await then.write(POST, String(post.id), { lifecycleState: outcome, lifecycleStateInfo: info, lastModifiedAt: due, ...(outcome === 'PUBLISHED' ? { publishedAt: due } : {}) }, 'post.published');
  }
}

/** Whether a post's content waits on a media URN. */
export function waitsOn(post: Row, urn: string): boolean {
  const content = (post.content ?? {}) as Row;
  return (content.media as Row | undefined)?.id === urn || (content.article as Row | undefined)?.thumbnail === urn;
}

// ── a post ───────────────────────────────────────────────────────────────────────────────────

const VISIBILITIES = ['PUBLIC', 'CONNECTIONS', 'LOGGED_IN', 'CONTAINER'];
const FEEDS = ['MAIN_FEED', 'NONE'];

/** Commentary as LinkedIn keeps it: an unescaped `#word` becomes its HashtagTemplate, `{hashtag|\#|word}`; escaped
 *  characters, mentions and templates already written are kept as they came. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "The commentary field hashtag data is returned with a template."
export function withHashtagTemplates(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length) { out += c + text[i + 1]!; i += 1; continue; }
    const word = c === '#' && (i === 0 || /\s/.test(text[i - 1]!)) ? /^[\p{L}\p{N}_]+/u.exec(text.slice(i + 1))?.[0] : undefined;
    if (word) { out += `{hashtag|\\#|${word}}`; i += word.length; continue; }
    out += c;
  }
  return out;
}

/** The longest commentary a post takes, in the characters a reader sees (a little-text escape's backslash is not
 *  one), so the share box's 3,000 typed characters and the API's commentary count the same text. Where the documentation
 *  stops: the Posts API page names the refusal, not the number; the number is its predecessor's, the UGC Post API's,
 *  for "the text of a UGC Post", which the twin reads as the text shown. */
// source: https://learn.microsoft.com/en-us/linkedin/compliance/integrations/shares/ugc-post-api "The maximum length of the text of a UGC Post is 3000 characters."
export const COMMENTARY_MAX = 3000;

/** Who may see a post, as the share box offers it for who it is posted as, with the share box's words: a member's
 *  post by anyone or by their connections; a page's by anyone. Where the documentation stops: the schema defines
 *  CONNECTIONS by an owner's network, which a page (followed, not connected) has none of; that the share box offers a
 *  page Anyone alone, and these words, are no page's: they are the twin's reading of that definition. */
// source: spec:/components/schemas/Post/properties/visibility "CONNECTIONS - Represents 1st degree network of owner."
export function audiencesFor(author: string): Array<[string, string]> {
  return author.startsWith('urn:li:organization:') ? [['PUBLIC', 'Anyone']] : [['PUBLIC', 'Anyone'], ['CONNECTIONS', 'Connections only']];
}

/** Text a person typed into a page's box, as a post keeps it: a browser sends a textarea's line breaks as CRLF (the
 *  HTML standard's form encoding); the post keeps LF, the line break the API's own callers write. Where the
 *  documentation stops: no LinkedIn page says how its share box keeps them. */
// source: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html "Replace every occurrence of U+000D (CR) not followed by U+000A (LF), and every occurrence of U+000A (LF) not preceded by U+000D (CR), in value, by a string consisting of U+000D (CR) and U+000A (LF)."
export const typedText = (sent: string): string => sent.replace(/\r\n?/g, '\n');

/** A commentary over the length a post takes, refused as the Posts API's error table has it. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "{field} length exceeds the allowed maximum. Reduce the length of the commentary or other text fields."
export function commentaryTooLong(): Response {
  return refuse(400, 'commentary length exceeds the allowed maximum.', 'FIELD_LENGTH_TOO_LONG');
}

/** A media or article thumbnail URN checked against what the author uploaded: the asset, whether it is still
 *  processing, or the refusal. */
function mediaFor(ctx: HandlerContext, field: string, urn: unknown, author: string, kinds: string[]): { waiting: boolean } | Response {
  const u = urnOf(urn);
  if (!u) return invalidUrnId(field, urn);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "Creating a post with an image requires uploading an image asset to obtain an Image URN (urn:li:image:{id}) for use in the post."
  if (!kinds.includes(u.type)) return wrongUrnType(field, urn, kinds.join(' or '));
  // a document is the Documents API's, which this World does not hold, so no document URN names one here
  const row = u.type === 'image' ? ctx.row(IMAGE, u.id) : u.type === 'video' ? ctx.row(VIDEO, u.id) : undefined;
  if (!row || row.owner !== author) return invalidUrnId(field, urn);
  if (row.status === 'AVAILABLE') return { waiting: false };
  if (row.status === 'PROCESSING') return { waiting: true };
  // a post naming media whose upload never finished, or whose processing failed, as the Videos API's error table
  // answers it; Where the documentation stops: the Images API's table names neither, and an image is answered the same
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "MEDIA_ASSET_WAITING_UPLOAD Media asset is waiting upload 400"
  if (row.status === 'WAITING_UPLOAD') return refuse(400, 'Media asset is waiting upload', 'MEDIA_ASSET_WAITING_UPLOAD');
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "MEDIA_ASSET_PROCESSING_FAILED Media asset failed processing 400"
  return refuse(400, 'Media asset failed processing', 'MEDIA_ASSET_PROCESSING_FAILED');
}

/** A post made by a caller (a token's member, or the member signed in at linkedin.com): its URN, or the refusal. The
 *  Posts API's create and the share box's Post button both make a post here. */
export async function createPostAs(ctx: HandlerContext, who: Caller, b: Row): Promise<string | Response> {
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "Ensure all required fields such as author, visibility, distribution, and lifecycleState are present."
  for (const field of ['author', 'commentary', 'visibility', 'distribution', 'lifecycleState']) if (b[field] === undefined || b[field] === null) return missingField(field);
  // the code is the Posts page's; its words, the Marketing error responses page's
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "{field} cannot be blank. Ensure required string fields are not empty."
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/error-responses?view=li-lms-2026-09 "{field} can't be blank"
  for (const field of ['author', 'visibility', 'lifecycleState']) if (typeof b[field] === 'string' && !String(b[field]).trim()) return refuse(400, `${field} can't be blank`, 'INVALID_VALUE_BLANK_FIELD');
  const author = String(b.author);
  const au = urnOf(author);
  if (!au) return invalidUrnId('author', author);
  // source: spec:/components/schemas/Post/properties/author "Author of the post (can be either posted as member or their company page)."
  if (au.type !== 'person' && au.type !== 'organization') return wrongUrnType('author', author, 'person or organization');
  if (typeof b.commentary !== 'string') return invalidValue('commentary', b.commentary);
  if (b.commentary.replace(/\\(.)/gs, '$1').length > COMMENTARY_MAX) return commentaryTooLong();
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "Verify that enum values for fields such as visibility, feedDistribution, and lifecycleState are valid."
  if (!VISIBILITIES.includes(String(b.visibility))) return invalidValue('visibility', b.visibility);
  const distribution = b.distribution as Row;
  if (typeof distribution !== 'object' || Array.isArray(distribution)) return invalidValue('distribution', JSON.stringify(distribution));
  if (!FEEDS.includes(String(distribution.feedDistribution))) return invalidValue('distribution.feedDistribution', distribution.feedDistribution);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "PUBLISHED is the only accepted field during creation."
  if (b.lifecycleState !== 'PUBLISHED') return invalidValue('lifecycleState', b.lifecycleState);
  // a targeted post's audience is counted among the page's followers, and the World's pages are followed by no one
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "The audience you target for your UGC Post must be greater than 300 members."
  if (Array.isArray(distribution.targetEntities) && distribution.targetEntities.length) return unprocessable('The audience you target for your post must be greater than 300 members of the page\'s followers');
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "Post, comment, and like posts on behalf of an organization. Restricted to organizations where the authenticated member has one of the following company page roles"
  if (!mayActAs(ctx, who, author, { organization: ['w_organization_social'], member: ['w_member_social'] }, POSTING_ROLES)) return accessDenied('POST /rest/posts');
  if (au.type === 'organization' && !ctx.row(ORGANIZATION, au.id)) return invalidUrnId('author', author);

  const content = (b.content ?? undefined) as Row | undefined;
  let waiting = false;
  if (content?.media !== undefined) {
    const media = content.media as Row;
    if (media?.id === undefined) return missingField('content.media.id');
    // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "Creating a post with a video requires uploading a video asset to obtain a Video URN (urn:li:video:{id}) for use in the post."
    const checked = mediaFor(ctx, 'content.media.id', media.id, author, ['image', 'video', 'document']);
    if (checked instanceof Response) return checked;
    waiting = checked.waiting;
  }
  if (content?.article !== undefined) {
    const article = content.article as Row;
    // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "API partners must set article fields such as thumbnail, title, and description within the post when creating an article post."
    if (typeof article?.source !== 'string' || !article.source) return missingField('content.article.source');
    if (article.thumbnail !== undefined) {
      const checked = mediaFor(ctx, 'content.article.thumbnail', article.thumbnail, author, ['image']);
      if (checked instanceof Response) return checked;
      waiting = waiting || checked.waiting;
    }
  }
  let reshare: Row | undefined;
  if (b.reshareContext !== undefined) {
    const parentUrn = String((b.reshareContext as Row)?.parent ?? '');
    // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "You must specify reshareContext.parent field as shown in the request for resharing that post."
    if (!parentUrn) return missingField('reshareContext.parent');
    if (!postKey(parentUrn)) return wrongUrnType('reshareContext.parent', parentUrn, 'share or ugcPost');
    const parent = postByUrn(ctx, parentUrn);
    if (!parent || parent.lifecycleState !== 'PUBLISHED') return invalidUrnId('reshareContext.parent', parentUrn);
    // source: spec:/components/schemas/Post/properties/isReshareDisabledByAuthor "Indicates whether resharing of the post has been disabled by the author."
    if (parent.isReshareDisabledByAuthor === true) return unprocessable(`reshareContext.parent value ${parentUrn} has resharing disabled by its author`);
    // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "reshareContext.root is the greatest ancestor of the post - can also be the parent."
    reshare = { parent: parentUrn, root: String(((parent.reshareContext as Row | undefined)?.root) ?? parentUrn) };
  }
  if (waiting) {
    const refused = ctx.legal(POST, 'lifecycleState', 'createPost', 'PUBLISHED', 'PUBLISH_REQUESTED');
    if (refused) return refuse(refused.status, refused.message, refused.code as string | undefined);
  }
  const key = ctx.mint(POST);
  // the URN's type: LinkedIn's own read of a video post names a UGC post, its read of an image or text post a share
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09 "You should get a 201 response and the response header x-restli-id contains the Post ID such as urn:li:share:6844785523593134080 or urn:li:ugcPost:68447855235931240."
  const isVideo = urnOf((content?.media as Row | undefined)?.id)?.type === 'video';
  const urn = `urn:li:${isVideo ? 'ugcPost' : 'share'}:${key}`;
  const now = nowMs(ctx);
  const optional: Row = {};
  for (const field of ['container', 'contentLandingPage', 'contentCallToActionLabel', 'adContext']) if (b[field] !== undefined) optional[field] = b[field];
  await ctx.write(POST, key, {
    id: urn, author, commentary: withHashtagTemplates(String(b.commentary)), visibility: b.visibility, distribution,
    ...(content ? { content } : {}),
    lifecycleState: waiting ? 'PUBLISH_REQUESTED' : 'PUBLISHED',
    lifecycleStateInfo: { isEditedByAuthor: false, ...(waiting ? { contentStatus: 'PROCESSING' } : {}) },
    isReshareDisabledByAuthor: b.isReshareDisabledByAuthor === true,
    ...(reshare ? { reshareContext: reshare } : {}),
    createdAt: now, lastModifiedAt: now, ...(waiting ? {} : { publishedAt: now }), ...optional,
  }, 'post.create');
  return urn;
}


// ── a video's upload ─────────────────────────────────────────────────────────────────────────

// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "The first entry is byte range: 0 - 4194303, the next one with 4194304 - 8388607 and so on."
export const PART_BYTES = 4_194_304;
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "Maximum allowed Videos size is 5GB."
export const MAX_VIDEO_BYTES = 5 * 1024 ** 3;

// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "Accessing this video resource is forbidden. Please check your permissions for this resource"
export const videoForbidden = (): Response => refuse(403, 'Accessing this video resource is forbidden. Please check your permissions for this resource');
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09 "Accessing this image resource is forbidden. Please check your permissions for this resource"
export const imageForbidden = (): Response => refuse(403, 'Accessing this image resource is forbidden. Please check your permissions for this resource');

/** Whether a caller may upload or read a video owned by `owner`. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "For videos with member URN owners, the caller needs to match the video owner."
export const mayUseVideo = (ctx: HandlerContext, who: Caller, owner: string): boolean =>
  mayActAs(ctx, who, owner, { organization: ['w_organization_social', 'rw_ads', 'r_ads'], member: ['w_member_social'] }, MEDIA_ROLES);

/** An asset's owner, checked: a person or an organization URN. */
function ownerOf(field: string, value: unknown): string | Response {
  if (value === undefined || value === null || value === '') return missingField(field);
  const u = urnOf(value);
  if (!u) return invalidUrnId(field, value);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "URN of the entity that owns this asset. Can be a person(urn:li:person:123), or organization(urn:li:organization:123) URN"
  return u.type === 'person' || u.type === 'organization' ? String(value) : wrongUrnType(field, value, 'person or organization');
}

/** A media library entry asked for at initialize: an ad account's library, on which the caller must hold a role. The
 *  World holds no ad account (Campaign Manager's), so no caller holds one, and the request is refused as LinkedIn refuses
 *  an entity the viewer has no permission on. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "Metadata for assets stored in the media library. Metadata is tied to a specific account which must be specified in queries / requests."
// source: https://learn.microsoft.com/en-us/linkedin/marketing/error-responses?view=li-lms-2026-09 "Viewer may not have permission {permission} on entity {entity}"
function libraryOf(field: string, value: unknown): undefined | Response {
  const account = value === undefined ? undefined : (value as Row | null)?.associatedAccount;
  return value === undefined ? undefined : typeof account !== 'string' ? missingField(`${field}.associatedAccount`) : refuse(403, `Viewer may not have permission ADD_TO_MEDIA_LIBRARY on entity ${account}`, 'NO_PERMISSION_ON_ENTITY');
}

/** initializeUpload for a video: the video registered, waiting for its parts, and the upload instructions. */
export async function startVideoUpload(ctx: HandlerContext, who: Caller, body: Row): Promise<Row | Response> {
  const r = body.initializeUploadRequest as Row | undefined;
  if (!r || typeof r !== 'object') return missingField('initializeUploadRequest');
  const owner = ownerOf('initializeUploadRequest.owner', r.owner);
  if (owner instanceof Response) return owner;
  if (r.fileSizeBytes === undefined) return missingField('initializeUploadRequest.fileSizeBytes');
  const size = r.fileSizeBytes;
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) return invalidValue('initializeUploadRequest.fileSizeBytes', size);
  if (size > MAX_VIDEO_BYTES) return refuse(400, `initializeUploadRequest.fileSizeBytes value ${size} can't be higher than ${MAX_VIDEO_BYTES}`, 'FIELD_VALUE_TOO_HIGH');
  const library = libraryOf('initializeUploadRequest.mediaLibraryMetadata', r.mediaLibraryMetadata);
  if (library instanceof Response) return library;
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "For videos with company URN owners, the caller needs to have ADMIN or DSC permissions for the company page."
  if (!mayUseVideo(ctx, who, owner)) return videoForbidden();
  const asset = ctx.mint(VIDEO);
  const now = nowMs(ctx);
  const instructions: Row[] = [];
  for (let first = 0, part = 0; first < size; first += PART_BYTES, part += 1) {
    const last = Math.min(size, first + PART_BYTES) - 1;
    const sau = await uploadToken(ctx, `video:${asset}:${part}`, { asset, kind: 'video-part', part, firstByte: first, lastByte: last });
    instructions.push({ uploadUrl: `https://www.linkedin.com/dms-uploads/${asset}/uploadedVideo?sau=${sau}`, lastByte: last, firstByte: first });
  }
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "URL for uploading captions. Present only if initializeUploadRequest.uploadCaptions was true."
  const captions = r.uploadCaptions === true ? `https://www.linkedin.com/dms-mpf-uploads/${asset}/userUploadedCustomCaptions/${asset}/0?sync=0&v=beta&ut=${await uploadToken(ctx, `captions:${asset}`, { asset, kind: 'video-captions' })}` : undefined;
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "This value is present only if initializeUploadRequest.uploadThumbnail is true."
  const thumbnail = r.uploadThumbnail === true ? `https://www.linkedin.com/dms-uploads/${asset}/ads-video-userUploadedThumbnail/0?ca=vector_ads&cn=uploads_secure&ccn=ambry-video&sync=0&v=beta&ut=${await uploadToken(ctx, `thumbnail:${asset}`, { asset, kind: 'video-thumbnail' })}` : undefined;
  const urn = assetUrn('video', asset);
  await ctx.write(VIDEO, asset, {
    id: urn, owner, status: 'WAITING_UPLOAD',
    _file_size: size, _parts: instructions.length, _upload_token: '',
    ...(typeof r.templateName === 'string' ? { _template_name: r.templateName } : {}), ...(typeof r.linkbackContext === 'string' ? { _linkback_context: r.linkbackContext } : {}),
  }, 'video.initializeUpload');
  // Where the documentation stops: every published answer's uploadToken is empty, so the twin's is too
  return {
    uploadUrlsExpireAt: now + UPLOAD_URL_LIFETIME_MS, video: urn, uploadInstructions: instructions, uploadToken: '',
    ...(captions ? { captionsUploadUrl: captions } : {}), ...(thumbnail ? { thumbnailUploadUrl: thumbnail } : {}),
  };
}

/** A part's bytes PUT to its upload URL: kept, and its ETag, the id finalizeUpload names it by. */
export async function putVideoPart(ctx: HandlerContext, asset: string, sau: string | null, bytes: Uint8Array): Promise<string | Response> {
  const upload = uploadOf(ctx, sau, asset, 'video-part');
  if (upload instanceof Response) return upload;
  const video = ctx.row(VIDEO, asset);
  if (!video || video.status !== 'WAITING_UPLOAD') return partAfterFinalize(asset);
  const expected = Number(upload.lastByte) - Number(upload.firstByte) + 1;
  // Where the documentation stops: a part of another length than its instruction's byte range is refused as the
  // documented 400; the words are the twin's
  if (bytes.length !== expected) return refuse(400, `The part is ${bytes.length} bytes; its upload instruction is for bytes ${String(upload.firstByte)}-${String(upload.lastByte)}`, 'INVALID_VALUE_FOR_FIELD');
  await ctx.blobs.put(`video-part/${asset}/${String(upload.part)}`, bytes);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "The headers in the response return an ETag as shown below. Ensure that you save eTag for future use."
  // its form, the page's own PUT answer's: "etag: /ambry-videoei/signedId/….bin"
  const etag = `/ambry-videoei/signedId/${ctx.crypto.digest('sha256', bytes, 'base64url')}.bin`;
  await ctx.record(UPLOAD, { etag, uploaded_at: nowMs(ctx) }, `upload:${ctx.crypto.sha256(sau!)}`);
  return etag;
}

/** A part sent after its video was finalized. */
function partAfterFinalize(asset: string): Response {
  return refuse(400, `Video urn:li:video:${asset} is no longer waiting for its upload`, 'INVALID_VALUE_FOR_FIELD');
}

/** finalizeUpload: the parts, named by their ETags in order, joined into the video's file, and the video processing. */
export async function finishVideoUpload(ctx: HandlerContext, who: Caller, body: Row): Promise<undefined | Response> {
  const f = body.finalizeUploadRequest as Row | undefined;
  if (!f || typeof f !== 'object') return missingField('finalizeUploadRequest');
  for (const field of ['video', 'uploadToken', 'uploadedPartIds']) if (f[field] === undefined || f[field] === null) return missingField(`finalizeUploadRequest.${field}`);
  const asset = assetOf('finalizeUploadRequest.video', f.video, 'video');
  if (asset instanceof Response) return asset;
  const video = ctx.row(VIDEO, asset);
  if (!video) return notFound(`Video ${String(f.video)}`);
  if (!mayUseVideo(ctx, who, String(video.owner))) return videoForbidden();
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "This is from the initialize video upload step. Partners shouldn't try to interpret it."
  if (f.uploadToken !== video._upload_token) return invalidValue('finalizeUploadRequest.uploadToken', f.uploadToken);
  const refused = ctx.legal(VIDEO, 'status', 'finalizeVideoUpload', video.status, 'PROCESSING', asset);
  if (refused) return refuse(refused.status, refused.message, refused.code as string | undefined);
  const parts = ctx.rowsRaw(UPLOAD).filter((u) => u.asset === asset && u.kind === 'video-part').sort((a, b) => Number(a.part) - Number(b.part));
  const ids = Array.isArray(f.uploadedPartIds) ? f.uploadedPartIds.map(String) : [];
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api?view=li-lms-2026-09 "The order needs to be the same as the order of parts in the upload instructions."
  if (parts.length !== ids.length || parts.some((p, i) => p.etag !== ids[i])) return invalidValue('finalizeUploadRequest.uploadedPartIds', JSON.stringify(ids));
  const chunks: Uint8Array[] = [];
  for (const p of parts) chunks.push((await ctx.blobs.get(`video-part/${asset}/${String(p.part)}`)) ?? new Uint8Array(0));
  const whole = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { whole.set(c, at); at += c.length; }
  const digest = await keep(ctx, whole);
  for (const p of parts) await ctx.blobs.remove(`video-part/${asset}/${String(p.part)}`);
  const now = nowMs(ctx);
  await ctx.write(VIDEO, asset, { status: 'PROCESSING', _sha256: digest, _finalized_at: now, _due_at: now + VIDEO_PROCESSING_MS, ...videoVerdict(whole) }, 'video.finalizeUpload');
  return undefined;
}

// ── an image's upload ────────────────────────────────────────────────────────────────────────

/** Whether a caller may upload an image owned by `owner`. */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api?view=li-lms-2026-09 "For images with company URN owners, the caller must have ADMIN or DSC permissions for the company page."
export const mayUploadImage = (ctx: HandlerContext, who: Caller, owner: string): boolean =>
  mayActAs(ctx, who, owner, { organization: ['w_organization_social', 'rw_ads', 'w_power_creators'], member: ['w_member_social', 'w_power_creators'] }, MEDIA_ROLES);

/** initializeUpload for an image: the image registered, waiting for its bytes, and its upload URL. */
export async function startImageUpload(ctx: HandlerContext, who: Caller, body: Row): Promise<Row | Response> {
  const r = body.initializeUploadRequest as Row | undefined;
  if (!r || typeof r !== 'object') return missingField('initializeUploadRequest');
  const owner = ownerOf('initializeUploadRequest.owner', r.owner);
  if (owner instanceof Response) return owner;
  const library = libraryOf('initializeUploadRequest.mediaLibraryMetadata', r.mediaLibraryMetadata);
  if (library instanceof Response) return library;
  if (!mayUploadImage(ctx, who, owner)) return imageForbidden();
  const asset = ctx.mint(IMAGE);
  const ut = await uploadToken(ctx, `image:${asset}`, { asset, kind: 'image' });
  const urn = assetUrn('image', asset);
  await ctx.write(IMAGE, asset, { id: urn, owner, status: 'WAITING_UPLOAD' }, 'image.initializeUpload');
  return { uploadUrlExpiresAt: nowMs(ctx) + UPLOAD_URL_LIFETIME_MS, uploadUrl: `https://www.linkedin.com/dms-uploads/${asset}/uploaded-image/0?ca=vector_ads&cn=uploads&sync=0&v=beta&ut=${ut}`, image: urn };
}

/** An image's bytes PUT to its upload URL: kept, and the image processing. */
export async function putImage(ctx: HandlerContext, asset: string, ut: string | null, bytes: Uint8Array, via: 'api' | 'share-box' = 'api'): Promise<undefined | Response> {
  const upload = uploadOf(ctx, ut, asset, 'image');
  if (upload instanceof Response) return upload;
  const image = ctx.row(IMAGE, asset)!;
  const refused = ctx.legal(IMAGE, 'status', 'uploadImage', image.status, 'PROCESSING', assetUrn('image', asset));
  if (refused) return refuse(refused.status, refused.message, refused.code as string | undefined);
  const digest = await keep(ctx, bytes);
  const now = nowMs(ctx);
  await ctx.write(IMAGE, asset, { status: 'PROCESSING', _sha256: digest, _due_at: now + IMAGE_PROCESSING_MS, ...imageVerdict(bytes, via) }, 'image.upload');
  return undefined;
}

// ── little text ──────────────────────────────────────────────────────────────────────────────

/** What a person types in the share box, as little text: every reserved character escaped with a backslash but the
 *  hashtag sign, so a `#word` they type stays a hashtag (HashtagElement). */
// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/little-text-format?view=li-lms-2026-09 "All reserved characters need to be escaped with a backslash, even if those characters are not used in one of the supported elements or templates."
export const littleText = (typed: string): string => typed.replace(/[|{}@[\]()<>\\*_~]/g, (c) => `\\${c}`);

