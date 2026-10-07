// An instance's organization permissions, the `/organization_permissions` family
// (https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions): the nine system permissions every
// instance has, and the custom ones it makes. Clerk's refusals are those of
// https://clerk.com/docs/guides/development/errors/backend-api (ERRORS), by code.
import type { HandlerContext } from '@volter/world-core';
import { body, clerkError, invalid, missing, ms, notFound, organizationsOff, permissionById, permissions, permissionView, roleRecords, saveRole } from './shared.ts';

/** The spec's rule for a permission key: it "must be in the format org:feature:action" and cannot take the `org:sys_`
 *  prefix the system permissions hold; Clerk's pages give no code of their own, so its class's (`form_param_format_invalid`). */
function keyError(key: string): Response | undefined {
  if (key.startsWith('org:sys_')) return invalid('key', 'The org:sys_ prefix is reserved for system permissions.');
  if (!/^org:[a-z0-9_]+:[a-z0-9_]+$/.test(key)) return invalid('key', 'The permission key must be in the format org:feature:action.');
  return undefined;
}
/** ERRORS: OrganizationPermissionNotFound, 404 `resource_not_found`, "Organization permission not found". */
const permissionNotFound = (): Response => notFound('Organization permission not found');
/** A key the instance holds already: ERRORS' FormAlreadyExists, 422 `form_already_exists` ("signifies an error when given
 *  resource already exists"). The page gives it no message; the twin's states the rule. */
// source: https://clerk.com/docs/guides/development/errors/backend-api "FormAlreadyExists signifies an error when given resource already exists"
const duplicate = (): Response => clerkError(422, 'form_already_exists', 'A permission with this key already exists.', 'A permission with this key already exists.', { param_name: 'key' });

/** `POST /organization_permissions`. */
export async function CreateOrganizationPermission(ctx: HandlerContext): Promise<Response> {
  const b = body(ctx);
  if (typeof b.name !== 'string' || !b.name) return missing('name');
  if (typeof b.key !== 'string' || !b.key) return missing('key');
  const bad = keyError(b.key);
  if (bad) return bad;
  if (permissions(ctx).some((p) => p.key === b.key)) return duplicate();
  const id = ctx.mint('Permission');
  const at = ms(ctx);
  await ctx.write('Permission', id, { object: 'permission', name: b.name, key: b.key, description: typeof b.description === 'string' ? b.description : '', _clerk_type: 'user', created_at: at, updated_at: at }, 'organization_permission.create');
  return ctx.reply(permissionView(ctx.row('Permission', id)!));
}

/** `GET /organization_permissions`: `query` (an exact id, or part of a name or key) and `order_by` (`created_at`, `name`,
 *  `key`; spec: ListOrganizationPermissions), oldest first when none is asked for. */
export async function ListOrganizationPermissions(ctx: HandlerContext): Promise<Response> {
  return ctx.list('Permission', permissions(ctx));
}

/** `GET /organization_permissions/{permission_id}`: a system or a custom permission, with its `type`. */
export async function GetOrganizationPermission(ctx: HandlerContext): Promise<Response> {
  const p = permissionById(ctx, ctx.call.params.permission_id);
  return p ? ctx.reply(p) : permissionNotFound();
}
