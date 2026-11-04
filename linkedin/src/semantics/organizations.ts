// The Organization Lookup API
// (https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api):
// a company page by its id, for a member who administers it.
import type { HandlerContext } from '@volter/world-core';
import { callerOf, holds, notFound, ORGANIZATION, refuse, rolesOn, view } from './shared.ts';

/** GET /rest/organizations/{id}: the page, every field, for its administrator. */
export async function getOrganization(ctx: HandlerContext): Promise<Response> {
  const who = callerOf(ctx);
  if (who instanceof Response) return who;
  const id = String(ctx.call.params.organizationId ?? '');
  const organization = /^\d+$/.test(id) ? ctx.row(ORGANIZATION, id) : undefined;
  if (!organization) return notFound(`Organization ${id}`);
  // source: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api?view=li-lms-2026-09 "API calls with insufficient permissions return 403 Forbidden."
  if (!holds(who, ['rw_organization_admin']) || !rolesOn(ctx, who.person, `urn:li:organization:${id}`).includes('ADMINISTRATOR')) {
    return refuse(403, `Viewer don't have permission to the ADMIN_ONLY VisibilityReduction for urn:li:organization:${id}`);
  }
  return Response.json(view(ctx, organization));
}
