import { BACKEND_GAP } from './shared.ts';
// Users, the `/users` family: made through the Backend API (or the Frontend API's sign-up, ../../fapi), updated, their
// metadata merged, listed and deleted; stored in Clerk's `User` shape (spec:/components/schemas/User), a password only as
// a digest (`_password_digest`). Clerk's refusals are those of https://clerk.com/docs/guides/development/errors/backend-api
// (ERRORS), by code.
import type { HandlerContext } from '@volter/world-core';
import {
  body, clerkError, emailAddress, identificationId, instanceRow, invalid, listed, memberships, membershipView, membershipsOf, missing, ms, newestFirst,
  metadataOnUpdate, notFound, organizationsOff, pageOf, passwordDigest, query, signedIds,
  defaultImageUrl, initialsOf,
} from './shared.ts';

type Row = Record<string, unknown>;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** "Passwords must be 8 characters or more." (Clerk's default policy, the Frontend API's environment) */
const PASSWORD_MIN_LENGTH = 8;
// Pinned clerk-js 5.127.2 UserSettings.fromJSON caps max_length at 72; its validation requires password.length < max_length.
// source: archive:https://registry.npmjs.org/@clerk/clerk-js/-/clerk-js-5.127.2.tgz#sha256=1ba0ec232f0f1eecdf351f2ca82a6ede1fae20455b680a460536b6290c72eddd!/package/dist/clerk.browser.js "max_length:e.password_settings?.max_length===0?72:Math.min(e.password_settings?.max_length??72,72)"
const PASSWORD_MAX_LENGTH = 72;
const MATCHES_IDENTIFIER = 'Password cannot match your email address, phone number or username. For account safety, please use a different password.';
const userOfPath = (ctx: HandlerContext): Row | undefined => ctx.row('User', String(ctx.call.params.user_id));
const answer = (ctx: HandlerContext, id: string): Response => ctx.reply(ctx.get('User', id)!);
/** A taken identifier: Clerk's `form_identifier_exists`. */
const taken = (param: string, what: string): Response => clerkError(422, 'form_identifier_exists', `That ${what} is taken. Please try another.`, `That ${what} is taken. Please try another.`, { param_name: param });
const instant = (value: unknown): number | undefined => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : undefined);
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : []);
const lower = (xs: unknown): string[] => ((xs as Row[] | undefined) ?? []).map((e) => String(e.email_address ?? e.phone_number ?? e.web3_wallet ?? '').toLowerCase());

/** A username "in canonical E.164 phone-number format" is refused "regardless of the configured username character set"
 *  (ERRORS: FormUsernameCannotBePhoneNumber, 422 `form_username_cannot_be_phone_number`). */
// source: https://clerk.com/docs/guides/development/errors/backend-api "is in canonical E.164 phone-number format. This is rejected regardless of"
const usernameRefusal = (username: string): Response | undefined => (/^\+[1-9]\d{1,14}$/.test(username)
  ? clerkError(422, 'form_username_cannot_be_phone_number', 'username cannot be a phone number.', 'username cannot be a phone number. Please choose a different username.', { param_name: 'username' })
  : undefined);

/** A password identical to one of the account's identifiers (ERRORS: FormPasswordMatchesIdentifier, 422
 *  `form_password_matches_identifier`). The page does not say whether case counts; where the documentation stops the
 *  comparison ignores it, as Clerk compares the email addresses themselves (`userByEmail`). */
// source: https://clerk.com/docs/guides/development/errors/backend-api "is identical to one of the account's identifiers (email address, phone"
function matchesIdentifier(password: string, identifiers: string[]): Response | undefined {
  const p = password.toLowerCase();
  return identifiers.some((i) => i !== '' && i.toLowerCase() === p) ? clerkError(422, 'form_password_matches_identifier', MATCHES_IDENTIFIER, MATCHES_IDENTIFIER, { param_name: 'password' }) : undefined;
}

/** The form each hasher's digest takes ("Each of the supported hashers expects the incoming digest to be in a particular
 *  format", spec:/components/schemas/PasswordHasher), as reference/backend/user/create-user gives it. `md5_phpass` and
 *  `ldap_ssha` are named there with no form, so where the documentation stops their digests are taken as given. */
// source: https://clerk.com/docs/references/backend/user/create-user "When set, password_digest must be in the format of"
// source: https://clerk.com/docs/references/backend/user/create-user "When set, password_digest must be a 64-length hex string."
const BCRYPT = '\\$2[abxy]?\\$\\d{2}\\$[./A-Za-z0-9]{53}';
const DIGESTS: Record<string, RegExp> = {
  awscognito: /^awscognito#[^#]+#[^#]+#[^#]+$/,
  bcrypt: new RegExp(`^${BCRYPT}$`),
  bcrypt_sha256_django: new RegExp(`^bcrypt_sha256\\$${BCRYPT}$`),
  bcrypt_peppered: new RegExp(`^${BCRYPT}\\$.+$`),
  md5: /^[0-9a-f]{32}$/i,
  md5_salted: /^[^$]+\$[0-9a-f]{32}$/i,
  pbkdf2_sha1: /^pbkdf2_sha1\$\d+\$[^$]+\$[0-9a-f]+(\$\d+)?$/i,
  pbkdf2_sha256: /^pbkdf2_sha256\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/,
  pbkdf2_sha512: /^pbkdf2_sha512\$\d+\$[^$]+\$[0-9a-f]+$/i,
  pbkdf2_sha512_hex: /^pbkdf2_sha512_hex\$\d+\$[0-9a-f]+\$[0-9a-f]+$/i,
  pbkdf2_sha256_django: /^pbkdf2_sha256\$\d+\$[^$]+\$[A-Za-z0-9+/=]+$/,
  // "$P$<rounds><salt><encoded-checksum>": one character, eight, and twenty-two, from [./0-9A-Za-z]
  phpass: /^\$P\$[./0-9A-Za-z]{31}$/,
  scrypt_firebase: /^[^$]+\$[^$]+\$[^$]+\$[^$]+\$\d+\$\d+$/,
  // the page's `$<algorithm args>$<salt>$<hash>`, and the method Werkzeug itself writes ahead of the salt (its default
  // `scrypt:32768:8:1`, the page Clerk's spec links for this hasher), where the page's leading `$` stops matching an export
  // source: https://werkzeug.palletsprojects.com/en/3.0.x/utils/ "is scrypt:32768:8:1"
  scrypt_werkzeug: /^(?:\$[^$]+|scrypt:\d+:\d+:\d+)\$[^$]+\$[^$]+$/,
  sha256: /^[0-9a-f]{64}$/i,
  sha256_salted: /^[^$]+\$[0-9a-f]{64}$/i,
  argon2i: /^\$argon2i\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
  argon2id: /^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/,
  sha512_symfony: /^sha512_symfony\$[1-9]\d*\$[^$]+\$[A-Za-z0-9+/=]+$/,
};
/** A digest not in its hasher's form: ERRORS' FormPasswordDigestInvalid, 422 `form_password_digest_invalid_code`. */
// source: https://clerk.com/docs/guides/development/errors/backend-api "FormPasswordDigestInvalid signifies an error when the provided password_digest is not valid for the provided password_hasher"
function digestRefusal(digest: string, hasher: unknown): Response | undefined {
  const form = typeof hasher === 'string' ? DIGESTS[hasher] : undefined;
  if (!form || form.test(digest)) return undefined;
  const message = `The provided password_digest is not a valid ${String(hasher)} password hash.`;
  return clerkError(422, 'form_password_digest_invalid_code', message, message, { param_name: 'password_digest' });
}

/** "Development instances are capped at 100 users" (a World's instance is one: its keys are `sk_test_`), ERRORS'
 *  UserQuotaExceeded, 403 `user_quota_exceeded`, "You have reached your limit of <maxAllowed> users. <resolution>": the
 *  page does not say what `<resolution>` reads, so where the documentation stops the sentence ends at the limit. */
// source: https://clerk.com/docs/guides/development/managing-environments "Development instances are capped at 100 users"
const DEVELOPMENT_USERS = 100;
function quotaRefusal(ctx: HandlerContext): Response | undefined {
  if (instanceRow(ctx)?.environment_type === 'production' || ctx.rows('User').length < DEVELOPMENT_USERS) return undefined;
  return clerkError(403, 'user_quota_exceeded', 'user quota exceeded', `You have reached your limit of ${DEVELOPMENT_USERS} users.`);
}

/** Whether the instance takes passwords (the dashboard's User & authentication page, the twin's `/_twin/instance` door). */
const passwordOn = (ctx: HandlerContext): boolean => ((instanceRow(ctx)?._auth as Row | undefined)?.password ?? 'on') !== 'off';

/** `POST /users`: "By default, any email address and phone number created using this method is marked as verified"; with
 *  `email_address_identification_status` an address may be made `reserved` instead. The instance's requirements hold
 *  (an email address, a password while the instance takes them) unless the call skips them. */
export async function CreateUser(ctx: HandlerContext): Promise<Response> {
  const b = body(ctx);
  const emails = texts(b.email_address).map((e) => e.toLowerCase());
  const phones = texts(b.phone_number);
  const wallets = texts(b.web3_wallet);
  const statuses = texts(b.email_address_identification_status);
  if (!emails.length && b.skip_user_requirement !== true) return missing('email_address');
  for (const e of emails) if (!EMAIL.test(e)) return invalid('email_address', 'email_address must be a valid email address.');
  // source: https://clerk.com/docs/guides/development/errors/backend-api "must contain exactly one item for each item in"
  if (statuses.length && statuses.length !== emails.length) return clerkError(422, 'form_param_array_length_mismatch', 'length mismatch', 'email_address_identification_status must contain exactly one item for each item in email_address.', { param_name: 'email_address_identification_status' });
  if (emails.some((e) => ctx.rows('User').some((u) => lower(u.email_addresses).includes(e)))) return taken('email_address', 'email address');
  if (typeof b.username === 'string' && b.username) { const phone = usernameRefusal(b.username); if (phone) return phone; }
  if (typeof b.username === 'string' && b.username && ctx.rows('User').some((u) => u.username === b.username)) return taken('username', 'username');
  const password = typeof b.password === 'string' ? b.password : undefined;
  const digest = typeof b.password_digest === 'string' ? b.password_digest : undefined;
  if (password === undefined && digest === undefined && passwordOn(ctx) && b.skip_password_requirement !== true) return missing('password');
  if (password !== undefined && b.skip_password_checks !== true && password.length >= PASSWORD_MAX_LENGTH) return clerkError(422, 'form_password_length_too_long', `Passwords must be less than ${PASSWORD_MAX_LENGTH} characters.`, `Passwords must be less than ${PASSWORD_MAX_LENGTH} characters.`, { param_name: 'password' });
  if (password !== undefined && b.skip_password_checks !== true && password.length < PASSWORD_MIN_LENGTH) return clerkError(422, 'form_password_length_too_short', `Passwords must be ${PASSWORD_MIN_LENGTH} characters or more.`, `Passwords must be ${PASSWORD_MIN_LENGTH} characters or more.`, { param_name: 'password' });
  const identifiers = [...emails, ...phones, ...(typeof b.username === 'string' && b.username ? [b.username] : [])];
  if (password !== undefined && b.skip_password_checks !== true) { const same = matchesIdentifier(password, identifiers); if (same) return same; }
  if (password === undefined && digest !== undefined) { const bad = digestRefusal(digest, b.password_hasher); if (bad) return bad; }
  const quota = quotaRefusal(ctx);
  if (quota) return quota;
  const id = ctx.mint('User');
  const at = instant(b.created_at) ?? ms(ctx);
  const verification = (status: string): Row => ({ status: status === 'reserved' ? 'unverified' : 'verified', strategy: 'admin', attempts: null, expire_at: null });
  const emailRows: Row[] = emails.map((e, i) => ({ ...emailAddress(id, e, at, verification(statuses[i] ?? 'verified')), reserved: statuses[i] === 'reserved' }));
  const phoneRows = phones.map((p) => ({ id: identificationId(id, p), object: 'phone_number', phone_number: p, reserved_for_second_factor: false, default_second_factor: false, reserved: false, verification: verification('verified'), linked_to: [], backup_codes: null, created_at: at, updated_at: at }));
  const walletRows = wallets.map((w) => ({ id: identificationId(id, w.toLowerCase()), object: 'web3_wallet', web3_wallet: w, verification: { status: 'verified', strategy: 'admin', attempts: null, expire_at: null }, created_at: at, updated_at: at }));
  await ctx.write('User', id, {
    object: 'user', external_id: (b.external_id as string | undefined) ?? null, primary_email_address_id: emailRows[0]?.id ?? null,
    primary_phone_number_id: phoneRows[0]?.id ?? null, primary_web3_wallet_id: walletRows[0]?.id ?? null, username: (b.username as string | undefined) || null,
    first_name: (b.first_name as string | undefined) ?? null, last_name: (b.last_name as string | undefined) ?? null, locale: (b.locale as string | undefined) ?? null,
    image_url: defaultImageUrl(id, initialsOf(b.first_name, b.last_name)), profile_image_url: defaultImageUrl(id, initialsOf(b.first_name, b.last_name)), has_image: false,
    public_metadata: (b.public_metadata as Row | undefined) ?? {}, private_metadata: (b.private_metadata as Row | undefined) ?? {}, unsafe_metadata: (b.unsafe_metadata as Row | undefined) ?? {},
    email_addresses: emailRows, phone_numbers: phoneRows, web3_wallets: walletRows, passkeys: [], external_accounts: [], saml_accounts: [], enterprise_accounts: [],
    password_enabled: password !== undefined || digest !== undefined, two_factor_enabled: false, totp_enabled: false, backup_code_enabled: false,
    mfa_enabled_at: null, mfa_disabled_at: null, password_last_updated_at: password !== undefined || digest !== undefined ? at : null,
    last_sign_in_at: null, banned: b.banned === true, locked: b.locked === true, lockout_expires_in_seconds: null, verification_attempts_remaining: null,
    delete_self_enabled: b.delete_self_enabled === true, create_organization_enabled: b.create_organization_enabled !== false,
    ...(typeof b.create_organizations_limit === 'number' ? { create_organizations_limit: b.create_organizations_limit } : {}),
    last_active_at: null, legal_accepted_at: instant(b.legal_accepted_at) ?? null, created_at: at, updated_at: at,
    ...(password !== undefined ? { _password_digest: passwordDigest(password, `user:${id}`) } : digest !== undefined ? { _password_digest: digest, _password_hasher: b.password_hasher ?? null } : {}),
  }, 'user.create');
  return answer(ctx, id);
}

/** `PATCH /users/{user_id}`: its names, username ("to null or the blank string" removes it), external id, primary
 *  address ("It must be verified, and present on the current user"), password, and settings. The metadata is not taken
 *  here on the served version ("this endpoint no longer accepts `public_metadata`…"), and is on a request pinned to an
 *  older one (`metadataOnUpdate`). */
export async function UpdateUser(ctx: HandlerContext): Promise<Response> {
  const user = userOfPath(ctx);
  if (!user) return notFound(`No user was found with id ${String(ctx.call.params.user_id)}`);
  const b = body(ctx);
  if (typeof b.password_digest === 'string') return ctx.refuse(BACKEND_GAP);
  const id = String(user.id);
  const metadata = metadataOnUpdate(ctx, b, ['public_metadata', 'private_metadata', 'unsafe_metadata']);
  if (metadata instanceof Response) return metadata;
  const patch: Row = { ...metadata, updated_at: ms(ctx) };
  for (const k of ['first_name', 'last_name', 'external_id', 'locale', 'delete_self_enabled', 'create_organization_enabled', 'create_organizations_limit']) if (b[k] !== undefined) patch[k] = b[k];
  if (b.username !== undefined) {
    const username = typeof b.username === 'string' && b.username ? b.username : null;
    if (username) { const phone = usernameRefusal(username); if (phone) return phone; }
    if (username && ctx.rows('User').some((u) => u.username === username && u.id !== id)) return taken('username', 'username');
    patch.username = username;
  }
  if (typeof b.primary_email_address_id === 'string') {
    const email = ((user.email_addresses as Row[] | undefined) ?? []).find((e) => e.id === b.primary_email_address_id);
    if (!email || (email.verification as Row | undefined)?.status !== 'verified') return invalid('primary_email_address_id', 'The primary email address must be verified, and present on the current user.');
    patch.primary_email_address_id = email.id;
  }
  if (instant(b.legal_accepted_at) !== undefined) patch.legal_accepted_at = instant(b.legal_accepted_at);
  if (instant(b.created_at) !== undefined) patch.created_at = instant(b.created_at);
  const password = typeof b.password === 'string' ? b.password : undefined;
  if (password !== undefined) {
    if (password !== undefined && b.skip_password_checks !== true && password.length >= PASSWORD_MAX_LENGTH) return clerkError(422, 'form_password_length_too_long', `Passwords must be less than ${PASSWORD_MAX_LENGTH} characters.`, `Passwords must be less than ${PASSWORD_MAX_LENGTH} characters.`, { param_name: 'password' });
    if (b.skip_password_checks !== true && password.length < PASSWORD_MIN_LENGTH) return clerkError(422, 'form_password_length_too_short', `Passwords must be ${PASSWORD_MIN_LENGTH} characters or more.`, `Passwords must be ${PASSWORD_MIN_LENGTH} characters or more.`, { param_name: 'password' });
    if (b.skip_password_checks !== true) {
      const same = matchesIdentifier(password, [...lower(user.email_addresses), ...lower(user.phone_numbers), String(patch.username ?? user.username ?? '')]);
      if (same) return same;
    }
    Object.assign(patch, { _password_digest: passwordDigest(password, `user:${id}:${ctx.occurredAt}`), password_enabled: true, password_last_updated_at: ms(ctx) });
  }
  await ctx.write('User', id, patch, 'user.update');
  // "sign out the user from all their active sessions once their password is updated"
  if (password !== undefined && b.sign_out_of_other_sessions === true) {
    for (const s of ctx.rows('Session').filter((x) => x.user_id === id && (x.status ?? 'active') === 'active')) {
      ctx.legal('Session', 'status', 'UpdateUser', 'active', 'revoked', String(s.id));
      await ctx.write('Session', String(s.id), { status: 'revoked', updated_at: ms(ctx) }, 'session.revoke');
    }
  }
  return answer(ctx, id);
}

/** `PATCH /users/{user_id}/metadata`: "a deep merge will be performed … You can remove metadata keys at any level by
 *  setting their value to `null`." */
export async function UpdateUserMetadata(ctx: HandlerContext): Promise<Response> {
  const user = userOfPath(ctx);
  if (!user) return notFound(`No user was found with id ${String(ctx.call.params.user_id)}`);
  const b = body(ctx);
  const patch: Row = { updated_at: ms(ctx) };
  for (const k of ['public_metadata', 'private_metadata', 'unsafe_metadata']) {
    if (b[k] === undefined) continue;
    // metadata is an object (spec: UpdateUserMetadata, "type: object"), as the replace refuses anything else
    if (b[k] !== null && (typeof b[k] !== 'object' || Array.isArray(b[k]))) return invalid(k, `${k} must be an object.`);
    patch[k] = ctx.merge('User', user[k] ?? {}, b[k] ?? {});
  }
  await ctx.write('User', String(user.id), patch, 'user.update');
  return answer(ctx, String(user.id));
}

/** `GET /users/count`: "Returns a total count of all users that match the given filtering criteria", the same filters
 *  the list takes (spec:/components/schemas/TotalCount: `{ object: 'total_count', total_count }`). `@clerk/backend`'s
 *  `users.getUserList` asks for it beside every page, for its `totalCount`. */
// source: spec:GetUsersCount "Returns a total count of all users that match the given filtering criteria."
export async function GetUsersCount(ctx: HandlerContext): Promise<Response> {
  const matched = matchingUsers(ctx);
  return matched instanceof Response ? matched : ctx.reply({ object: 'total_count', total_count: matched.length });
}

/** `PUT /users/{user_id}/metadata`: "replaces the supplied metadata fields entirely — the prior contents of each
 *  supplied field are discarded. Fields omitted from the request body are left unchanged." (spec: ReplaceUserMetadata) */
// source: spec:ReplaceUserMetadata "Fields omitted from the request body are left unchanged."
export async function ReplaceUserMetadata(ctx: HandlerContext): Promise<Response> {
  const user = userOfPath(ctx);
  if (!user) return notFound(`No user was found with id ${String(ctx.call.params.user_id)}`);
  const b = body(ctx);
  const replaced: Row = {};
  // "Send `{}` to clear a field, or `null` to store a JSON `null` value."
  // (https://clerk.com/docs/guides/development/upgrading/upgrade-guides/2026-05-12)
  for (const k of ['public_metadata', 'private_metadata', 'unsafe_metadata']) {
    if (b[k] === undefined) continue;
    if (b[k] !== null && (typeof b[k] !== 'object' || Array.isArray(b[k]))) return invalid(k, `${k} must be an object.`);
    replaced[k] = b[k];
  }
  // a write replaces each field it names whole (a merge is `UpdateUserMetadata`'s, the resource's `update: 'deep'`)
  await ctx.write('User', String(user.id), { ...replaced, updated_at: ms(ctx) }, 'user.update');
  return answer(ctx, String(user.id));
}

/** `DELETE /users/{user_id}`: the user goes, with their memberships; Clerk reports `user.deleted` (the manifest's
 *  events). */
export async function DeleteUser(ctx: HandlerContext): Promise<Response> {
  const user = userOfPath(ctx);
  if (!user) return notFound(`No user was found with id ${String(ctx.call.params.user_id)}`);
  // the user's memberships go with them (the manifest's `cascade`)
  await ctx.remove('User', String(user.id));
  return ctx.reply({ object: 'user', id: user.id, deleted: true });
}

/** `GET /users/{user_id}/organization_memberships`: every organization the user belongs to, with their role's
 *  permissions (what an application reads to decide what a member may do). */
export async function UsersGetOrganizationMemberships(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  if (!userOfPath(ctx)) return notFound(`No user was found with id ${String(ctx.call.params.user_id)}`);
  return listed(ctx, membershipsOf(ctx, String(ctx.call.params.user_id)).map((m) => membershipView(ctx, m)));
}

/** The fields `order_by` may name (spec: GetUserList), each read off a user. */
const ORDERS: Record<string, (u: Row) => string | number> = {
  created_at: (u) => Number(u.created_at ?? 0), updated_at: (u) => Number(u.updated_at ?? 0), last_active_at: (u) => Number(u.last_active_at ?? 0),
  last_sign_in_at: (u) => Number(u.last_sign_in_at ?? 0), first_name: (u) => String(u.first_name ?? ''), last_name: (u) => String(u.last_name ?? ''),
  username: (u) => String(u.username ?? ''), email_address: (u) => lower(u.email_addresses)[0] ?? '', phone_number: (u) => lower(u.phone_numbers)[0] ?? '',
  web3wallet: (u) => lower(u.web3_wallets)[0] ?? '',
};

/** The users a list or a count names: every filter the spec gives both `GET /users` and `GET /users/count` (the
 *  identifier lists, `user_id`/`organization_id`/`external_id` with `+`/`-`, the queries in part, `banned`, the creation,
 *  activity and sign-in instants, a provider's user ids). */
function matchingUsers(ctx: HandlerContext): Row[] | Response {
  const q = query(ctx);
  const all = (k: string): string[] => q.getAll(k).flatMap((v) => v.split(',')).filter(Boolean);
  const byId = signedIds(all('user_id'));
  const byOrg = signedIds(all('organization_id'));
  const byExternal = signedIds(all('external_id'));
  const emails = all('email_address').map((e) => e.toLowerCase());
  const phones = all('phone_number');
  const usernames = all('username');
  const wallets = all('web3_wallet').map((w) => w.toLowerCase());
  const part = (k: string): string | undefined => q.get(k)?.toLowerCase() || undefined;
  const num = (k: string): number | undefined => (q.get(k) ? Number(q.get(k)) : undefined);
  const provider = q.get('provider');
  const providerIds = all('provider_user_id');
  if ((provider && !providerIds.length) || (!provider && providerIds.length)) return invalid(provider ? 'provider_user_id' : 'provider', 'provider and provider_user_id must be used together.');
  const orgsOf = (id: string): string[] => memberships(ctx).filter((m) => m.user_id === id).map((m) => String(m.organization_id));
  return ctx.rows('User').filter((u) => {
    const id = String(u.id);
    const ems = lower(u.email_addresses); const phs = ((u.phone_numbers as Row[] | undefined) ?? []).map((p) => String(p.phone_number)); const ws = lower(u.web3_wallets);
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').toLowerCase();
    const username = String(u.username ?? '').toLowerCase();
    if (byId && !byId(id)) return false;
    if (byOrg && !byOrg(orgsOf(id))) return false;
    if (byExternal && !byExternal(String(u.external_id ?? ''))) return false;
    if (emails.length && !ems.some((e) => emails.includes(e))) return false;
    if (phones.length && !phs.some((p) => phones.includes(p))) return false;
    if (usernames.length && !usernames.includes(String(u.username ?? ''))) return false;
    if (wallets.length && !ws.some((w) => wallets.includes(w))) return false;
    if (part('query') && ![id.toLowerCase(), ...ems, ...phs, ...ws, username, name].join(' ').includes(part('query')!)) return false;
    if (part('email_address_query') && !ems.some((e) => e.includes(part('email_address_query')!))) return false;
    if (part('phone_number_query') && !phs.some((p) => p.includes(part('phone_number_query')!))) return false;
    if (part('username_query') && !username.includes(part('username_query')!)) return false;
    if (part('name_query') && !name.includes(part('name_query')!)) return false;
    if (q.get('banned') !== null && (u.banned === true) !== (q.get('banned') === 'true')) return false;
    const n = (k: string): number => Number(u[k] ?? 0);
    if (num('created_at_before') !== undefined && !(n('created_at') < num('created_at_before')!)) return false;
    if (num('created_at_after') !== undefined && !(n('created_at') > num('created_at_after')!)) return false;
    if (num('last_active_at_before') !== undefined && !(n('last_active_at') < num('last_active_at_before')!)) return false;
    for (const k of ['last_active_at_after', 'last_active_at_since']) if (num(k) !== undefined && !(n('last_active_at') >= num(k)!)) return false;
    if (num('last_sign_in_at_before') !== undefined && !(n('last_sign_in_at') < num('last_sign_in_at_before')!)) return false;
    if (num('last_sign_in_at_after') !== undefined && !(n('last_sign_in_at') > num('last_sign_in_at_after')!)) return false;
    if (provider && !((u.external_accounts as Row[] | undefined) ?? []).some((a) => (a.provider === provider || `oauth_${String(a.provider)}` === provider) && providerIds.includes(String(a.provider_user_id)))) return false;
    return true;
  });
}

/** `GET /users`: the users the filters name (`matchingUsers`), ordered by `order_by` (newest first by default), paged
 *  by `limit`/`offset` or after `starting_after`, and answered as a bare array (spec:/components/responses/User.List). */
export async function GetUserList(ctx: HandlerContext): Promise<Response> {
  const q = query(ctx);
  const matched = matchingUsers(ctx);
  if (matched instanceof Response) return matched;
  let rows = matched;
  const orderBy = q.get('order_by') || '-created_at';
  const field = orderBy.replace(/^[+-]/, '');
  const key = ORDERS[field];
  if (!key) return invalid('order_by', `order_by must be one of ${Object.keys(ORDERS).join(', ')}, each with an optional + or - prefix.`);
  const desc = orderBy.startsWith('-');
  rows = newestFirst(rows).reverse().map((u, i) => ({ u, i })).sort((a, b) => {
    const x = key(a.u), y = key(b.u);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return (desc ? -c : c) || (desc ? b.i - a.i : a.i - b.i);
  }).map((x) => x.u);
  const after = q.get('starting_after');
  if (after) {
    // "Requires ordering by `created_at`"
    if (field !== 'created_at') return invalid('starting_after', 'starting_after requires ordering by created_at.');
    const at = rows.findIndex((u) => u.id === after);
    rows = at === -1 ? [] : rows.slice(at + 1);
    return ctx.reply(rows.slice(0, Math.min(Math.max(Number(q.get('limit') ?? 10) || 10, 1), 500)));
  }
  return ctx.reply(pageOf(ctx, rows));
}
