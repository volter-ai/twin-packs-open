// An instance's organization roles, the `/organization_roles` family
// (https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions): the two system roles every instance
// has and the custom ones it makes, each holding its permissions by id. Clerk's refusals are those of
// https://clerk.com/docs/guides/development/errors/backend-api (ERRORS), by code.
import type { HandlerContext } from '@volter/world-core';
import {
  body, clerkError, creatorRole, domainDefaultRole, invalid, missing, ms, notFound, organizationSettings, organizationsOff, permissionById,
  type RoleRecord, roleMatches, roleRecords, roleView, saveRole, writeOrganizationSettings,
} from './shared.ts';

const MAX_CUSTOM_ROLES = 10;
const roleNow = (ctx: HandlerContext, id: string): RoleRecord => roleRecords(ctx).find((r) => r.id === id)!;
/** ERRORS: OrganizationRoleNotFound, 404 `resource_not_found`, "Organization role not found". */
const roleNotFound = (): Response => notFound('Organization role not found');
const roleOfPath = (ctx: HandlerContext): RoleRecord | undefined => roleRecords(ctx).find((r) => r.id === ctx.call.params.organization_role_id);

/** A role key "must start with `org:`" (spec: CreateOrganizationRole); Clerk's pages give no code of its own, so its
 *  class's. */
const keyError = (key: string): Response | undefined => (/^org:[a-z0-9_]+$/.test(key) ? undefined : invalid('key', 'The role key must start with org: followed by lowercase letters, digits or underscores.'));
/** A key the instance holds already: ERRORS' FormAlreadyExists, 422 `form_already_exists` ("signifies an error when given
 *  resource already exists"). The page gives it no message; the twin's states the rule. */
// source: https://clerk.com/docs/guides/development/errors/backend-api "FormAlreadyExists signifies an error when given resource already exists"
const duplicate = (): Response => clerkError(422, 'form_already_exists', 'A role with this key already exists.', 'A role with this key already exists.', { param_name: 'key' });

/** `permissions` on a role create or update: permission ids, every one of which must exist. */
function permissionIds(ctx: HandlerContext, value: unknown): string[] | Response {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return invalid('permissions', 'permissions must be an array of permission ids.');
  const ids = [...new Set(value as string[])];
  for (const pid of ids) if (!permissionById(ctx, pid)) return clerkError(404, 'resource_not_found', 'not found', `Permission ${pid} not found.`);
  return ids;
}

/** The creator role keeps what running an organization needs: "The creator role must contain the following permissions"
 *  (ERRORS, 422 organization_missing_creator_role_permissions). */
function creatorEligibility(ctx: HandlerContext, before: RoleRecord, after: RoleRecord): Response | undefined {
  if (!roleMatches(before, creatorRole(ctx)) || roleView(ctx, after).is_creator_eligible === true) return undefined;
  return clerkError(422, 'organization_missing_creator_role_permissions', 'missing permissions for creator role', 'The creator role must contain the following permissions: org:sys_memberships:manage, org:sys_profile:manage');
}

/** `POST /organization_roles`: a custom role with the permissions it is given by id, in the instance's initial role set
 *  when asked (`include_in_initial_role_set`). */
export async function CreateOrganizationRole(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const b = body(ctx);
  if (typeof b.name !== 'string' || !b.name) return missing('name');
  if (typeof b.key !== 'string' || !b.key) return missing('key');
  const bad = keyError(b.key);
  if (bad) return bad;
  if (roleRecords(ctx).some((r) => r.key === b.key)) return duplicate();
  // "You can create up to 10 custom Organization Roles per application instance"; the eleventh is ERRORS'
  // OrganizationInstanceRolesQuotaExceeded (403 `organization_instance_roles_quota_exceeded`)
  // source: https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions "You can create up to 10 custom Organization Roles per application instance"
  if (roleRecords(ctx).filter((r) => !r.system).length >= MAX_CUSTOM_ROLES) return clerkError(403, 'organization_instance_roles_quota_exceeded', 'organization roles for instance quota exceeded', `You have reached your limit of ${MAX_CUSTOM_ROLES} organization roles per instance.`);
  const ids = permissionIds(ctx, b.permissions);
  if (!Array.isArray(ids)) return ids;
  const id = ctx.mint('Role');
  const at = ms(ctx);
  await ctx.write('Role', id, {
    object: 'role', key: b.key, name: b.name, description: typeof b.description === 'string' ? b.description : null,
    include_in_initial_role_set: b.include_in_initial_role_set === true, _permission_ids: ids, created_at: at, updated_at: at,
  }, 'organization_role.create');
  return ctx.reply(roleView(ctx, roleNow(ctx, id)));
}

/** `GET /organization_roles`: `query` (an exact id, or part of a name or key) and `order_by` (`created_at`, `name`,
 *  `key`), newest first when none is asked for (spec: ListOrganizationRoles). */
export async function ListOrganizationRoles(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  return ctx.list('Role', roleRecords(ctx).map((r) => roleView(ctx, r)));
}

export async function GetOrganizationRole(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const rec = roleOfPath(ctx);
  return rec ? ctx.reply(roleView(ctx, rec)) : roleNotFound();
}

/** `PATCH /organization_roles/{id}`: its name, key and description, and its permissions REPLACED by the ids given. A key
 *  changed reaches what names it: "If the role is used as a creator role or domain default role, updating the key will
 *  cascade the update to the organization settings" (spec: UpdateOrganizationRole), and the memberships and pending
 *  invitations holding it hold the new key. */
export async function UpdateOrganizationRole(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const rec = roleOfPath(ctx);
  if (!rec) return roleNotFound();
  const b = body(ctx);
  const next: RoleRecord = { ...rec };
  if (typeof b.name === 'string') next.name = b.name;
  if (typeof b.description === 'string' || b.description === null) next.description = b.description as string | null;
  if (b.permissions !== undefined && b.permissions !== null) {
    const ids = permissionIds(ctx, b.permissions);
    if (!Array.isArray(ids)) return ids;
    next.permission_ids = ids;
  }
  if (typeof b.key === 'string' && b.key !== rec.key) {
    const bad = keyError(b.key);
    if (bad) return bad;
    if (roleRecords(ctx).some((r) => r.key === b.key)) return duplicate();
    next.key = b.key;
  }
  const ineligible = creatorEligibility(ctx, rec, next);
  if (ineligible) return ineligible;
  await saveRole(ctx, next, 'organization_role.update');
  if (next.key !== rec.key) {
    const settings = organizationSettings(ctx);
    const patch: Record<string, unknown> = {};
    if (settings.creator_role === rec.key) patch.creator_role = next.key;
    if (domainDefaultRole(ctx) === rec.key) patch.domains = { default_role: next.key };
    if (Object.keys(patch).length) await writeOrganizationSettings(ctx, patch);
    const at = ms(ctx);
    for (const m of ctx.rows('OrganizationMembership')) if (m.role === rec.key) await ctx.write('OrganizationMembership', String(m.id), { role: next.key, updated_at: at }, 'organization_membership.update');
    for (const i of ctx.rows('OrganizationInvitation')) if (i.role === rec.key && (i.status ?? 'pending') === 'pending') await ctx.write('OrganizationInvitation', String(i.id), { role: next.key, updated_at: at }, 'organization_invitation.update');
  }
  return ctx.reply(roleView(ctx, roleNow(ctx, rec.id)));
}

/** `POST /organization_roles/{role}/permissions/{permission}`: the role gains the permission; one it holds already is
 *  ERRORS' 409 `organization_role_permission_association_exists`. A system role is stored from then on, under its id. */
export async function AssignPermissionToOrganizationRole(ctx: HandlerContext): Promise<Response> {
  const off = organizationsOff(ctx);
  if (off) return off;
  const rec = roleOfPath(ctx);
  const permission = permissionById(ctx, ctx.call.params.permission_id);
  if (!rec) return roleNotFound();
  if (!permission) return notFound('Organization permission not found');
  const pid = String(permission.id);
  if (rec.permission_ids.includes(pid)) return clerkError(409, 'organization_role_permission_association_exists', 'permission already assigned to role', 'This organization permission is already associated to this organization role.');
  await saveRole(ctx, { ...rec, permission_ids: [...rec.permission_ids, pid] }, 'organization_role.update');
  return ctx.reply(roleView(ctx, roleNow(ctx, rec.id)));
}
