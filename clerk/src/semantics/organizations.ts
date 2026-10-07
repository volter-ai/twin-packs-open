import { BACKEND_GAP } from './shared.ts';
// Organizations, their memberships and their invitations: the `/organizations` family
// (https://clerk.com/docs/guides/organizations/overview). An organization is stored as Clerk answers it
// (spec:/components/schemas/Organization), its counts read when a call asks for them (`include_members_count`); a
// membership as a subject naming its organization and its user, answered with the organization, the member's public
// data and the role's permissions as they are now; an invitation as Clerk answers it, with its ticket kept (`_ticket`)
// for the Frontend API to read. Clerk's refusals are those of https://clerk.com/docs/guides/development/errors/backend-api
// (ERRORS), by code.
import type { HandlerContext } from '@volter/world-core';
import {
  addMember, body, clerkError, creatorRole, frontendApiHost, invalid, invitations, invitationView, listed, membershipView, memberships,
  membershipQuota, metadataOnUpdate, missing, ms, newestFirst, notFound, orderAndFilter, organizationOf, organizations, organizationSettings, organizationsOff, organizationView,
  outOfRange, pending, orderMemberships, query, roleParamError, runsOrganization, signedIds, signJwt, slugsOff,
  defaultImageUrl, initialsOf, organizationNameRefusal,
} from './shared.ts';

type Row = Record<string, unknown>;
// CONFIGURE: https://clerk.com/docs/guides/organizations/configure
/** An invitation lasts 30 days unless `expires_in_days` says otherwise (spec: CreateOrganizationInvitation). */
const INVITATION_DAYS = 30;
/** Clerk's slug from a name: lower case, runs of other characters one hyphen (`Oak & Ash` → `oak-ash`). */
const slugOf = (name: string): string => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const organizationOfPath = (ctx: HandlerContext): Row | undefined => organizationOf(ctx, ctx.call.params.organization_id);
const flag = (ctx: HandlerContext, name: string): boolean => query(ctx).get(name) === 'true';
/** ERRORS: OrganizationNotFound, 404 `resource_not_found`, "Given organization not found." */
const orgNotFound = (): Response => notFound('Given organization not found.');

// ── organizations ────────────────────────────────────────────────────────────────────────────

/** "Organization slugs must be unique for the instance" (spec: CreateOrganization); a slug taken, named or derived from
 *  the name, is Clerk's `form_identifier_exists`. */
const slugTaken = (): Response => clerkError(422, 'form_identifier_exists', 'That slug is taken. Please try another.', 'That slug is taken. Please try another.', { param_name: 'slug' });
const SLUG = /^[a-z0-9-]+$/;
const instantParam = (value: unknown): number | undefined => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : undefined);

/** `POST /organizations`: "Clerk automatically adds [the creator] as its first member and assigns them the Organization's
 *  designated Creator Role. By default, that Role is Admin." (CONFIGURE) */
export async function CreateOrganization(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const b = body(ctx);
  if (typeof b.name !== 'string' || !b.name.trim()) return missing('name');
  const invalidName = organizationNameRefusal(b.name);
  if (invalidName) return invalidName;
  // a slug is the instance's to give only while its slugs are on; off, Clerk derives none the caller names
  if (typeof b.slug === 'string' && b.slug) { const noSlugs = slugsOff(ctx); if (noSlugs) return noSlugs; }
  const overLimit = outOfRange('max_allowed_memberships', b.max_allowed_memberships, 0);
  if (overLimit) return overLimit;
  const named = typeof b.slug === 'string' && b.slug ? b.slug : undefined;
  const slug = named ?? slugOf(b.name);
  if (!SLUG.test(slug)) return invalid('slug', 'The organization slug can contain only lowercase alphanumeric characters (letters and digits) and the dash "-".');
  if (organizations(ctx).some((o) => o.slug === slug)) return organizationSettings(ctx).slug_disabled === true ? ctx.refuse(BACKEND_GAP) : slugTaken();
  const creator = typeof b.created_by === 'string' ? b.created_by : undefined;
  // ERRORS: organization_creator_not_found, 400
  if (creator && !ctx.get('User', creator)) return clerkError(400, 'organization_creator_not_found', 'creator not found', `No users found with id ${creator}.`);
  const id = ctx.mint('Organization');
  const at = instantParam(b.created_at) ?? ms(ctx);
  await ctx.write('Organization', id, {
    object: 'organization', name: b.name, slug, image_url: defaultImageUrl(id, initialsOf(b.name)), has_image: false,
    max_allowed_memberships: typeof b.max_allowed_memberships === 'number' ? b.max_allowed_memberships : Number(organizationSettings(ctx).max_allowed_memberships),
    admin_delete_enabled: true, public_metadata: (b.public_metadata as Row | undefined) ?? {}, private_metadata: (b.private_metadata as Row | undefined) ?? {},
    ...(creator ? { created_by: creator } : {}), created_at: at, updated_at: at,
  }, 'organization.create');
  if (creator) await addMember(ctx, id, creator, creatorRole(ctx));
  return ctx.reply(organizationView(ctx, ctx.get('Organization', id)!));
}


export async function GetOrganization(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const org = organizationOfPath(ctx);
  return org ? ctx.reply(organizationView(ctx, org, { counts: flag(ctx, 'include_members_count'), elevated: flag(ctx, 'include_missing_member_with_elevated_permissions') })) : orgNotFound();
}

/** `GET /organizations`: `query` (an exact id, or part of the name or slug), `user_id` and `organization_id` (each id with
 *  an optional `+`/`-`), `order_by` (`name`, `created_at`, `members_count`), newest first by default. */
export async function ListOrganizations(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const q = query(ctx);
  const counts = flag(ctx, 'include_members_count');
  const byUser = signedIds(q.getAll('user_id'));
  const byOrg = signedIds(q.getAll('organization_id'));
  const rows = organizations(ctx).filter((o) => (!byOrg || byOrg(String(o.id))) && (!byUser || byUser(memberships(ctx).filter((m) => m.organization_id === o.id).map((m) => String(m.user_id)))));
  const views = newestFirst(rows).reverse().map((o) => ({ ...organizationView(ctx, o, { counts: true, elevated: flag(ctx, 'include_missing_member_with_elevated_permissions') }) }));
  const ordered = orderAndFilter(ctx, views, '-created_at', ['name', 'created_at', 'members_count'], ['name', 'slug']);
  if (ordered instanceof Response) return ordered;
  // the counts are answered only when asked for
  return listed(ctx, counts ? ordered : ordered.map(({ members_count: _m, pending_invitations_count: _p, ...o }) => o));
}

/** `PATCH /organizations/{id}`: its name, slug, membership limit and settings. */
export async function UpdateOrganization(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const org = organizationOfPath(ctx);
  if (!org) return orgNotFound();
  const b = body(ctx);
  if (typeof b.name === 'string') { const invalidName = organizationNameRefusal(b.name); if (invalidName) return invalidName; }
  if (typeof b.slug === 'string' && b.slug) { const noSlugs = slugsOff(ctx); if (noSlugs) return noSlugs; }
  const overLimit = outOfRange('max_allowed_memberships', b.max_allowed_memberships, 0);
  if (overLimit) return overLimit;
  const metadata = metadataOnUpdate(ctx, b, ['public_metadata', 'private_metadata']);
  if (metadata instanceof Response) return metadata;
  const patch: Row = { ...metadata };
  for (const k of ['name', 'slug', 'max_allowed_memberships', 'admin_delete_enabled', 'self_serve_sso_enabled', 'role_set_key']) if (b[k] !== undefined) patch[k] = b[k];
  if (instantParam(b.created_at) !== undefined) patch.created_at = instantParam(b.created_at);
  if (typeof patch.slug === 'string') {
    if (!SLUG.test(patch.slug)) return invalid('slug', 'The organization slug can contain only lowercase alphanumeric characters (letters and digits) and the dash "-".');
    if (organizations(ctx).some((o) => o.slug === patch.slug && o.id !== org.id)) return slugTaken();
  }
  await ctx.write('Organization', String(org.id), { ...patch, updated_at: ms(ctx) }, 'organization.update');
  return ctx.reply(organizationView(ctx, ctx.get('Organization', String(org.id))!));
}

/** `PATCH /organizations/{id}/metadata`: merged key by key, a key given as null removed. */
export async function MergeOrganizationMetadata(ctx: HandlerContext): Promise<Response> {
  const org = organizationOfPath(ctx);
  if (!org) return orgNotFound();
  const b = body(ctx);
  await ctx.write('Organization', String(org.id), {
    ...(b.public_metadata !== undefined ? { public_metadata: ctx.merge('Organization', org.public_metadata ?? {}, b.public_metadata ?? {}) } : {}),
    ...(b.private_metadata !== undefined ? { private_metadata: ctx.merge('Organization', org.private_metadata ?? {}, b.private_metadata ?? {}) } : {}),
    updated_at: ms(ctx),
  }, 'organization.update');
  return ctx.reply(organizationView(ctx, ctx.get('Organization', String(org.id))!));
}

/** `PUT /organizations/{id}/metadata`: "replaces the supplied metadata fields entirely … Fields omitted from the request
 *  are left unchanged". */
export async function ReplaceOrganizationMetadata(ctx: HandlerContext): Promise<Response> {
  const org = organizationOfPath(ctx);
  if (!org) return orgNotFound();
  const b = body(ctx);
  await ctx.write('Organization', String(org.id), {
    // "Send `{}` to clear a field, or `null` to store a JSON `null` value." (the 2026-05-12 upgrade guide)
    ...(b.public_metadata !== undefined ? { public_metadata: b.public_metadata } : {}),
    ...(b.private_metadata !== undefined ? { private_metadata: b.private_metadata } : {}),
    updated_at: ms(ctx),
  }, 'organization.update');
  const row = ctx.get('Organization', String(org.id))!;
  return ctx.reply(organizationView(ctx, row));
}

/** `DELETE /organizations/{id}`: the organization goes, and with it its memberships and invitations. */
export async function DeleteOrganization(ctx: HandlerContext): Promise<Response> {
  const org = organizationOfPath(ctx);
  if (!org) return orgNotFound();
  await ctx.remove('Organization', String(org.id));
  return ctx.reply({ object: 'organization', id: org.id, slug: org.slug, deleted: true });
}

// ── memberships ─────────────────────────────────────────────────────────────────────────────

const membershipOf = (ctx: HandlerContext, orgId: unknown, userId: unknown): Row | undefined =>
  memberships(ctx).find((m) => m.organization_id === orgId && m.user_id === userId);

/** Filters a list of memberships by their members (spec: ListOrganizationMemberships): `user_id` (with `+`/`-`),
 *  `email_address`, `phone_number`, `username`, `web3_wallet` and `role` (any of those given), `query` (any identifier, the
 *  user's id or a name, in part), the `*_query` parts, and the member's creation and last activity. */
function memberFilter(ctx: HandlerContext): (m: Row) => boolean {
  const q = query(ctx);
  const all = (k: string): string[] => q.getAll(k).flatMap((v) => v.split(','));
  const byUser = signedIds(all('user_id'));
  const lists = { email_address: all('email_address').map((e) => e.toLowerCase()), phone_number: all('phone_number'), username: all('username'), web3_wallet: all('web3_wallet'), role: all('role') };
  const part = (k: string): string | undefined => q.get(k)?.toLowerCase() || undefined;
  const num = (k: string): number | undefined => (q.get(k) ? Number(q.get(k)) : undefined);
  return (m) => {
    const u = ctx.get('User', String(m.user_id)) ?? {};
    const emails = ((u.email_addresses as Row[] | undefined) ?? []).map((e) => String(e.email_address).toLowerCase());
    const phones = ((u.phone_numbers as Row[] | undefined) ?? []).map((p) => String(p.phone_number));
    const wallets = ((u.web3_wallets as Row[] | undefined) ?? []).map((w) => String(w.web3_wallet));
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').toLowerCase();
    const username = String(u.username ?? '').toLowerCase();
    const text = [String(m.user_id), ...emails, ...phones, ...wallets, username, name].join(' ').toLowerCase();
    if (byUser && !byUser(String(m.user_id))) return false;
    if (lists.email_address.length && !emails.some((e) => lists.email_address.includes(e))) return false;
    if (lists.phone_number.length && !phones.some((p) => lists.phone_number.includes(p))) return false;
    if (lists.username.length && !lists.username.includes(String(u.username ?? ''))) return false;
    if (lists.web3_wallet.length && !wallets.some((w) => lists.web3_wallet.includes(w))) return false;
    if (lists.role.length && !lists.role.includes(String(m.role))) return false;
    if (part('query') && !text.includes(part('query')!)) return false;
    if (part('email_address_query') && !emails.some((e) => e.includes(part('email_address_query')!))) return false;
    if (part('phone_number_query') && !phones.some((p) => p.includes(part('phone_number_query')!))) return false;
    if (part('username_query') && !username.includes(part('username_query')!)) return false;
    if (part('name_query') && !name.includes(part('name_query')!)) return false;
    const created = Number(u.created_at ?? 0); const active = Number(u.last_active_at ?? 0);
    if (num('created_at_before') !== undefined && !(created < num('created_at_before')!)) return false;
    if (num('created_at_after') !== undefined && !(created > num('created_at_after')!)) return false;
    if (num('last_active_at_before') !== undefined && !(active < num('last_active_at_before')!)) return false;
    if (num('last_active_at_after') !== undefined && !(active > num('last_active_at_after')!)) return false;
    return true;
  };
}


export async function ListOrganizationMemberships(ctx: HandlerContext): Promise<Response> {
  const org = organizationOfPath(ctx);
  if (!org) return orgNotFound();
  const ordered = orderMemberships(ctx, memberships(ctx).filter((m) => m.organization_id === org.id).filter(memberFilter(ctx)));
  return ordered instanceof Response ? ordered : listed(ctx, ordered.map((m) => membershipView(ctx, m)));
}



/** `POST /organizations/{id}/memberships`: "Adds a user as a member to the given organization. Only users in the same
 *  instance as the organization can be added as members." A member already is ERRORS' 400 `already_a_member_in_organization`. */
export async function CreateOrganizationMembership(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const org = organizationOfPath(ctx);
  if (!org) return orgNotFound();
  const b = body(ctx);
  if (typeof b.user_id !== 'string' || !b.user_id) return missing('user_id');
  if (typeof b.role !== 'string' || !b.role) return missing('role');
  const unknownRole = roleParamError(ctx, b.role);
  if (unknownRole) return unknownRole;
  if (!ctx.get('User', b.user_id)) return clerkError(404, 'resource_not_found', 'not found', `User ${b.user_id} not found.`);
  if (membershipOf(ctx, org.id, b.user_id)) return clerkError(400, 'already_a_member_in_organization', 'already a member', `${b.user_id} is already a member of the organization.`);
  const full = membershipQuota(ctx, org);
  if (full) return full;
  const m = await addMember(ctx, String(org.id), b.user_id, b.role, { public_metadata: b.public_metadata, private_metadata: b.private_metadata });
  return ctx.reply(membershipView(ctx, m));
}

/** A change that would leave the organization with no member able to run it: Clerk's OrganizationMinimumPermissionsNeeded
 *  (400 `organization_minimum_permissions_needed`, "There has to be at least one organization member with the minimum
 *  required permissions", https://clerk.com/docs/guides/development/errors/backend-api). `leaving` is the membership that
 *  goes or changes, `nextRole` its role after (none when it goes). */
function lastWhoRuns(ctx: HandlerContext, org: Row, leaving: Row, nextRole?: string): Response | undefined {
  if (!runsOrganization(ctx, leaving.role) || (nextRole !== undefined && runsOrganization(ctx, nextRole))) return undefined;
  const others = memberships(ctx).filter((m) => m.organization_id === org.id && m.id !== leaving.id && runsOrganization(ctx, m.role));
  // source: https://clerk.com/docs/guides/development/errors/backend-api "There has to be at least one organization member with the minimum required permissions"
  return others.length ? undefined : clerkError(400, 'organization_minimum_permissions_needed', 'minimum organization permissions needed', 'There has to be at least one organization member with the minimum required permissions');
}

/** `PATCH /organizations/{id}/memberships/{user_id}`: the member's role. */
export async function UpdateOrganizationMembership(ctx: HandlerContext): Promise<Response> {
  const org = organizationOfPath(ctx);
  const m = org && membershipOf(ctx, org.id, ctx.call.params.user_id);
  if (!m) return notFound();
  const role = body(ctx).role;
  if (typeof role !== 'string' || !role) return missing('role');
  const unknownRole = roleParamError(ctx, role);
  if (unknownRole) return unknownRole;
  const last = lastWhoRuns(ctx, org!, m, role);
  if (last) return last;
  await ctx.write('OrganizationMembership', String(m.id), { role, updated_at: ms(ctx) }, 'organization_membership.update');
  return ctx.reply(membershipView(ctx, ctx.get('OrganizationMembership', String(m.id))!));
}

/** `DELETE /organizations/{id}/memberships/{user_id}`: the member leaves; the answer is the membership removed. */
export async function DeleteOrganizationMembership(ctx: HandlerContext): Promise<Response> {
  const org = organizationOfPath(ctx);
  const m = org && membershipOf(ctx, org.id, ctx.call.params.user_id);
  if (!m) return notFound();
  const last = lastWhoRuns(ctx, org!, m);
  if (last) return last;
  const view = membershipView(ctx, m);
  await ctx.write('OrganizationMembership', String(m.id), { deleted: true }, 'organization_membership.delete');
  return ctx.reply(view);
}

// ── invitations ─────────────────────────────────────────────────────────────────────────────

/** One invitation made: an email address, a role and where the invitee lands. Clerk emails the invitee a link carrying
 *  the invitation's ticket, which the Frontend API takes to sign them up or in (../../fapi); the email is kept in the
 *  instance's outbox (`_email`), where a World reads what Clerk sent. */
async function invite(ctx: HandlerContext, org: Row, b: Row): Promise<Row | Response> {
  if (typeof b.email_address !== 'string' || !b.email_address) return missing('email_address');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email_address)) return invalid('email_address', 'email_address must be a valid email address.');
  const role = typeof b.role === 'string' && b.role ? b.role : undefined;
  if (!role) return missing('role');
  const unknownRole = roleParamError(ctx, role);
  if (unknownRole) return unknownRole;
  const email = b.email_address.toLowerCase();
  // ERRORS: organization_invitation_not_unique, "Organizations cannot have duplicate pending invitations for an email address."
  if (invitations(ctx).some((i) => i.organization_id === org.id && i.email_address === email && pending(i))) {
    return clerkError(400, 'organization_invitation_not_unique', 'organization invitation not unique', 'Organizations cannot have duplicate pending invitations for an email address.');
  }
  const inviter = typeof b.inviter_user_id === 'string' ? b.inviter_user_id : undefined;
  if (inviter && !ctx.get('User', inviter)) return clerkError(404, 'resource_not_found', 'not found', `No user was found with id ${inviter}`);
  // spec: `expires_in_days`, "minimum: 1", "maximum: 365"
  const badDays = outOfRange('expires_in_days', b.expires_in_days, 1, 365);
  if (badDays) return badDays;
  const full = membershipQuota(ctx, org);
  if (full) return full;
  const id = ctx.mint('OrganizationInvitation');
  const at = ms(ctx);
  const days = typeof b.expires_in_days === 'number' ? b.expires_in_days : INVITATION_DAYS;
  // the ticket: signed with the instance's key, naming the invitation and its organization (what the Frontend API reads)
  const ticket = signJwt(ctx, { st: 'organization_invitation', oid: org.id, sid: id, iid: id }, { now: Math.floor(at / 1000), expiresInSeconds: days * 86_400 });
  const redirect = typeof b.redirect_url === 'string' && b.redirect_url ? b.redirect_url : undefined;
  // the link the email carries: the instance's Frontend API accepts the ticket and sends the invitee on to `redirect_url`
  // with it (spec: GET /v1/tickets/accept, "redirect to a new location with the ticket in the query string")
  const url = `https://${frontendApiHost(ctx)}/v1/tickets/accept?ticket=${ticket}`;
  await ctx.write('OrganizationInvitation', id, {
    object: 'organization_invitation', email_address: email, role, organization_id: org.id, inviter_id: inviter ?? null, status: 'pending',
    public_metadata: (b.public_metadata as Row | undefined) ?? {}, private_metadata: (b.private_metadata as Row | undefined) ?? {},
    url, expires_at: at + days * 86_400_000, created_at: at, updated_at: at, _ticket: ticket, _redirect_url: redirect ?? null,
  }, 'organization_invitation.create');
  if (b.notify !== false) {
    await ctx.record('_email', { to: email, template: 'organization_invitation', subject: `You've been invited to join ${String(org.name)}`, link: url, organization_id: org.id, invitation_id: id, sent_at: at });
  }
  return ctx.get('OrganizationInvitation', id)!;
}

/** `POST /organizations/{id}/invitations`. */
export async function CreateOrganizationInvitation(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const org = organizationOfPath(ctx);
  if (!org) return orgNotFound();
  const made = await invite(ctx, org, body(ctx));
  return made instanceof Response ? made : ctx.reply(invitationView(ctx, made));
}

/** `POST /organizations/{id}/invitations/bulk`: "limited to a maximum of 10 invitations per API call"; every one is
 *  checked before any is made, so a refused batch leaves none behind. */
export async function CreateOrganizationInvitationBulk(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const org = organizationOfPath(ctx);
  if (!org) return orgNotFound();
  const list = Array.isArray(ctx.body) ? (ctx.body as unknown[]) : [];
  if (!list.length) return missing('invitations');
  if (list.length > 10) return invalid('invitations', 'This endpoint is limited to a maximum of 10 invitations per API call.');
  const items = list.map((x) => (x && typeof x === 'object' ? (x as Row) : {}));
  const emails = items.map((i) => String(i.email_address ?? '').toLowerCase());
  const repeated = emails.filter((e, n) => emails.indexOf(e) !== n);
  const standing = emails.filter((e) => invitations(ctx).some((i) => i.organization_id === org.id && i.email_address === e && pending(i)));
  // ERRORS: duplicate_record, "There are already pending invitations for the following email addresses: <emails>"
  if (repeated.length || standing.length) return clerkError(400, 'duplicate_record', '', `There are already pending invitations for the following email addresses: ${[...new Set([...standing, ...repeated])].join(', ')}`, { email_addresses: [...new Set([...standing, ...repeated])] });
  for (const item of items) {
    if (typeof item.email_address !== 'string' || !item.email_address) return missing('email_address');
    if (typeof item.role !== 'string' || !item.role) return missing('role');
    const unknownRole = roleParamError(ctx, item.role);
    if (unknownRole) return unknownRole;
    const badDays = outOfRange('expires_in_days', item.expires_in_days, 1, 365);
    if (badDays) return badDays;
  }
  // the batch is held to the limit whole, before any is made
  const full = membershipQuota(ctx, org, items.length);
  if (full) return full;
  const made: Row[] = [];
  for (const item of items) {
    const one = await invite(ctx, org, item);
    if (one instanceof Response) return one;
    made.push(invitationView(ctx, one));
  }
  return ctx.reply({ data: made, total_count: made.length });
}

/** `GET /organizations/{id}/invitations`: `status` and `email_address`, ordered by `created_at` or `email_address`
 *  (`+`/`-`), newest first by default. */
export async function ListOrganizationInvitations(ctx: HandlerContext): Promise<Response> {
  const org = organizationOfPath(ctx);
  if (!org) return orgNotFound();
  const q = query(ctx);
  const statuses = q.getAll('status');
  const emails = q.getAll('email_address').map((e) => e.toLowerCase());
  const rows = invitations(ctx).filter((i) => i.organization_id === org.id && (!statuses.length || statuses.includes(String(i.status ?? 'pending'))) && (!emails.length || emails.includes(String(i.email_address))));
  return ctx.list('OrganizationInvitation', rows.map((i) => invitationView(ctx, i)));
}

export async function GetOrganizationInvitation(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const org = organizationOfPath(ctx);
  const i = org && invitations(ctx).find((x) => x.id === ctx.call.params.invitation_id && x.organization_id === org.id);
  return i ? ctx.reply(invitationView(ctx, i)) : notFound();
}

/** `POST /organizations/{id}/invitations/{id}/revoke`: "Only organization invitations with 'pending' status can be
 *  revoked" (the machine: ./states.ts). */
export async function RevokeOrganizationInvitation(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const org = organizationOfPath(ctx);
  const i = org && invitations(ctx).find((x) => x.id === ctx.call.params.invitation_id && x.organization_id === org.id);
  if (!i) return notFound();
  const refused = ctx.legal('OrganizationInvitation', 'status', 'RevokeOrganizationInvitation', i.status ?? 'pending', 'revoked', String(i.id));
  if (refused) return clerkError(refused.status, String(refused.code ?? 'organization_invitation_not_pending'), 'not pending', refused.message);
  await ctx.write('OrganizationInvitation', String(i.id), { status: 'revoked', updated_at: ms(ctx) }, 'organization_invitation.revoke');
  return ctx.reply(invitationView(ctx, ctx.get('OrganizationInvitation', String(i.id))!));
}


