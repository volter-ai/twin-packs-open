// The instance's organization settings, the `/instance` family: off until the instance turns them on ("Organizations are
// disabled by default", https://clerk.com/docs/guides/organizations/configure), as a setup script does through the
// Backend API.
import type { HandlerContext } from '@volter/world-core';
import { body, invalid, organizationSettingsView, roleRecords, writeOrganizationSettings } from './shared.ts';

type Row = Record<string, unknown>;

/** `GET /instance/organization_settings`. */
export async function GetInstanceOrganizationSettings(ctx: HandlerContext): Promise<Response> {
  return ctx.reply(organizationSettingsView(ctx));
}

/** `PATCH /instance/organization_settings`: turn organizations on (or off) and set their defaults, deep-merged into what
 *  the instance holds (a setting the call does not name keeps its value); a creator or domain role is named by its id. */
export async function UpdateInstanceOrganizationSettings(ctx: HandlerContext): Promise<Response> {
  const b = body(ctx);
  const patch: Row = {};
  const domains: Row = {};
  for (const k of ['enabled', 'max_allowed_memberships', 'admin_delete_enabled', 'slug_disabled']) if (b[k] !== undefined && b[k] !== null) patch[k] = b[k];
  if (b.domains_enabled !== undefined && b.domains_enabled !== null) domains.enabled = b.domains_enabled;
  if (Array.isArray(b.domains_enrollment_modes)) domains.enrollment_modes = b.domains_enrollment_modes;
  for (const [param, into] of [['creator_role_id', patch], ['domains_default_role_id', domains]] as const) {
    if (typeof b[param] !== 'string') continue;
    const role = roleRecords(ctx).find((r) => r.id === b[param]);
    if (!role) return invalid(param, `${String(b[param])} is not a role of this instance.`);
    into[param === 'creator_role_id' ? 'creator_role' : 'default_role'] = role.key;
  }
  if (Object.keys(domains).length) patch.domains = domains;
  await writeOrganizationSettings(ctx, patch);
  return ctx.reply(organizationSettingsView(ctx));
}
