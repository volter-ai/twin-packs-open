// Organization Access Control
// (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role):
// which company pages a member holds a role on, and who holds roles on a page.
import type { HandlerContext } from '@volter/world-core';
import { accessDenied, ACL, callerOf, holds, missingField, queryOf, refuse, rolesOn, urnOf, view, wrongUrnType, invalidUrnId, type Row } from './shared.ts';

// source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-09 "Manage organizations pages and retrieve reporting data."
const ADMIN_SCOPES = ['rw_organization_admin', 'r_organization_admin'];

/** A page of access-control entries, filtered by the role and state asked for. */
function page(ctx: HandlerContext, rows: Row[]): Response {
  const role = queryOf(ctx, 'role');
  const state = queryOf(ctx, 'state');
  const start = Number(queryOf(ctx, 'start') ?? 0);
  const count = Number(queryOf(ctx, 'count') ?? 10);
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(count) || count < 0) return refuse(400, 'start and count must be whole numbers', 'INVALID_VALUE_FOR_FIELD');
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-09 "Limit results to specific roles, such as ADMINISTRATOR or DIRECT_SPONSORED_CONTENT_POSTER"
  const kept = rows.filter((a) => (!role || a.role === role) && (!state || a.state === state)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return Response.json({ paging: { count, start, links: [] }, elements: kept.slice(start, start + count).map((a) => view(ctx, a)) });
}

/** GET /rest/organizationAcls?q=roleAssignee: the caller's own roles. */
export async function findOrganizationAclsByRoleAssignee(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  if (!holds(who, ADMIN_SCOPES)) return accessDenied('GET /rest/organizationAcls?q=roleAssignee');
  return page(ctx, ctx.rowsRaw(ACL).filter((a) => a.roleAssignee === who.person));
}

/** GET /rest/organizationAcls?q=organization: a page's roles, for its administrators. */
export async function findOrganizationAclsByOrganization(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const organization = queryOf(ctx, 'organization');
  if (!organization) return missingField('organization');
  const u = urnOf(organization);
  if (!u) return invalidUrnId('organization', organization);
  if (u.type !== 'organization') return wrongUrnType('organization', organization, 'organization');
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-09 "You must be an authenticated member with role type ADMINISTRATOR for an organization to use many of the Organization APIs."
  if (!holds(who, ['rw_organization_admin']) || !rolesOn(ctx, who.person, organization).includes('ADMINISTRATOR')) return accessDenied('GET /rest/organizationAcls?q=organization');
  return page(ctx, ctx.rowsRaw(ACL).filter((a) => a.organization === organization));
}
