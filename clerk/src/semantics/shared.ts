// What every Clerk handler shares (docs/contributing/architecture.md, "What an author writes, and how": a family's shared
// helpers): the instant as Clerk writes it, its error body and list shapes; the instance's settings; the registry of
// organization permissions and roles and the views of organizations, memberships and invitations that several families
// answer; the webhooks Clerk sends, as the declaration the kernel delivers (`CLERK_EVENTS`) and how an event's `data`
// is rendered (`eventData`); the instance's key (its PEMs, the pack's data) and a password's digest, both computed with
// the kernel's signing.
//
import { equalSecrets, type EventsDecl, type EventWrite, type HandlerContext, jwks, type Jwks, jwtDecode, jwtSign, jwtVerify, sha256 as kernelSha256, type SigningKey, VendorUnreachableError, type WriteHookContext } from '@volter/world-core';

/** The instance's secret key a World is given without a visit to the API Keys page: the one `volter-world init` writes
 *  for `CLERK_SECRET_KEY` (packages/world-runtime/src/fixture-env.ts). Every other key the twin takes is one the API Keys
 *  page's door made (`POST /_twin/secret-keys`), checked by its stored hash (`auth.held`). */

type Row = Record<string, unknown>;

// The cited ResourceNotFound class supplies the envelope, not authenticated unknown-route behavior.
// Twin choice where documentation stops: use this class for authenticated unknown routes (journeys/decisions.json).
// source: https://clerk.com/docs/guides/development/errors/backend-api "ResourceNotFound"
export const BACKEND_GAP = { status: 404, code: 'resource_not_found', kind: 'not found', message: 'Resource not found' };

// ── the wire ──────────────────────────────────────────────────────────────────────────────────

/** Clerk writes every instant as Unix milliseconds (spec:/components/schemas/Organization/properties/created_at). */
export const ms = (ctx: WriteHookContext): number => Date.parse(ctx.occurredAt);

/** The trace id every answer carries, in the error body's `clerk_trace_id` and the `x-clerk-trace-id` header (the
 *  recordings, ../../spec/recordings), in Clerk's form: 32 lowercase hex digits. Clerk's is a fresh id per request; a
 *  World's answers are the same every run, so the twin's is one fixed id of that form (the manifests' `clerk_trace_id`
 *  and `x-clerk-trace-id` carry the same).
 *  source: recording:2026-09-28-unauthenticated.json "de1b36d5dd1a8c275a8b23e0d675a817" */
export const CLERK_TRACE_ID = 'f0e1d2c3b4a5968778695a4b3c2d1e0f';

/** Clerk's error body (spec:/components/schemas/ClerkErrors): one error, its code, its short message and its long one,
 *  each as https://clerk.com/docs/guides/development/errors/backend-api gives it. */
export function clerkError(status: number, code: string, message: string, longMessage = message, meta?: Row): Response {
  return Response.json({ errors: [{ message, long_message: longMessage, code, ...(meta ? { meta } : {}) }], clerk_trace_id: CLERK_TRACE_ID }, { status });
}

/** A path parameter's subject was not found: Clerk's `resource_not_found`. */
export const notFound = (longMessage = 'Resource not found'): Response => clerkError(404, 'resource_not_found', 'not found', longMessage);

/** A body field the operation requires is missing (Clerk's `form_param_missing`). */
export const missing = (param: string): Response => clerkError(422, 'form_param_missing', 'is missing', `${param} must be included.`, { param_name: param });

/** A body field holds a value the operation refuses (Clerk's `form_param_format_invalid`). */
export const invalid = (param: string, longMessage: string): Response => clerkError(422, 'form_param_format_invalid', 'is invalid', longMessage, { param_name: param });

/** An integer parameter held to the range its operation's spec declares (`minimum`, `maximum`): above it is Clerk's
 *  FormParameterValueTooLarge (422 `form_param_value_too_large`, "The value of <param> can't be greater than %d"),
 *  anything else outside it its FormValidationFailed (422 `form_param_value_invalid`, "<sanitizedField> is invalid"),
 *  https://clerk.com/docs/guides/development/errors/backend-api. */
export function outOfRange(param: string, value: unknown, min: number, max?: number): Response | undefined {
  if (value === undefined || value === null) return undefined;
  // source: https://clerk.com/docs/guides/development/errors/backend-api "The value of"
  if (typeof value === 'number' && Number.isInteger(value) && max !== undefined && value > max) return clerkError(422, 'form_param_value_too_large', 'Value too large', `The value of ${param} can't be greater than ${max}`, { param_name: param });
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) return clerkError(422, 'form_param_value_invalid', 'is invalid', `${param} is invalid`, { param_name: param });
  return undefined;
}

/** The API version the twin serves: its vendored spec's (spec/openapi.yaml.gz `info.version`). */
export const SERVED_API_VERSION = '2026-05-12';

/** Clerk's API versions ("## API versions": 2026-05-12, 2025-11-10, 2025-04-10, 2024-10-01 and the initial 2021-02-05,
 *  https://clerk.com/docs/guides/development/upgrading/versioning); any other is an invalid request. */
export const API_VERSIONS = ['2021-02-05', '2024-10-01', '2025-04-10', '2025-11-10', '2026-05-12'];

/** The version a request that names none is answered in: the initial one, 2021-02-05, which Clerk's own instance
 *  answered an unversioned request with (`clerk-api-version: 2021-02-05`,
 *  ../../fapi/spec/recordings/2026-09-28-clerk-clerk-com-signed-out.json; the recording is the Frontend API's, and no
 *  page says the Backend API's default: the twin reads it as the same). */
export const UNPINNED_API_VERSION = '2021-02-05';

/** The API version a request pins, by the `Clerk-API-Version` header or the `__clerk_api_version` query ("there are two
 *  options to specify the version"), else the unpinned one. Both at once, or a version Clerk does not have, is refused
 *  before any handler (../fetch.ts `versionRefusal`), so here it is one of API_VERSIONS. */
// source: https://clerk.com/docs/guides/development/upgrading/versioning "Using both the query parameter and the header simultaneously will lead to an invalid request."
export function pinnedApiVersion(ctx: WriteHookContext): string {
  return ctx.call.request.headers.get('clerk-api-version') ?? query(ctx).get('__clerk_api_version') ?? UNPINNED_API_VERSION;
}

/** Metadata on a general update, which "Version 2026-05-12 … removes" (PATCH /v1/users/{id}, PATCH
 *  /v1/organizations/{id}: "this field is rejected", spec 2025-04-10's UpdateUser; the upgrade guide). A request on an
 *  earlier version sets each bag given whole, as those versions did ("Metadata saved on the user"); one pinned to
 *  2026-05-12 is refused as an unknown parameter (FormUnknownParameter, 422 `form_param_unknown`,
 *  https://clerk.com/docs/guides/development/errors/backend-api). The documentation stops at "rejected": no page names
 *  the error a removed field draws, so the twin gives the errors page's refusal of a parameter the request does not take. */
// source: https://clerk.com/docs/guides/development/upgrading/upgrade-guides/2026-05-12 "PATCH /v1/users/{user_id} no longer accepts the following fields in the request body"
export function metadataOnUpdate(ctx: WriteHookContext, b: Row, keys: string[]): Row | Response {
  const given = keys.filter((k) => b[k] !== undefined);
  if (!given.length) return {};
  if (pinnedApiVersion(ctx) >= SERVED_API_VERSION) return clerkError(422, 'form_param_unknown', 'is unknown', `${given[0]} is not a valid parameter for this request.`, { param_name: given[0] });
  return Object.fromEntries(given.map((k) => [k, b[k] ?? {}]));
}

export const query = (ctx: WriteHookContext): URLSearchParams => new URL(ctx.call.request.url).searchParams;

/** The body as an object (Clerk takes JSON objects). */
export const body = (ctx: WriteHookContext): Row => (ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body) ? (ctx.body as Row) : {});

/** A page of a list: `limit` (default 10, at most 500) and `offset` (spec:/components/parameters/LimitParameter,
 *  OffsetParameter). */
export function pageOf<T>(ctx: WriteHookContext, items: T[]): T[] {
  const q = query(ctx);
  const limit = Math.min(Math.max(Number(q.get('limit') ?? 10) || 10, 1), 500);
  const offset = Math.max(Number(q.get('offset') ?? 0) || 0, 0);
  return items.slice(offset, offset + limit);
}

/** The paginated list shape most of the Backend API answers: `{ data, total_count }`. */
export const listed = <T>(ctx: WriteHookContext, items: T[]): Response => ctx.reply({ data: pageOf(ctx, items), total_count: items.length });

/** A stored row as the vendor's object, with the kernel's bookkeeping left out. */
export function own(ctx: WriteHookContext, row: Row): Row {
  // the id is the kernel's subject id, which the vendor's object carries as its own; a vendor field named `type` (a
  // permission's `user` or `system`) is stored as `_clerk_type`, since the kernel keeps a subject's type under that name
  const fields = Object.fromEntries(Object.entries(ctx.own(row)).filter(([k]) => !k.startsWith('_') && k !== 'id'));
  return { id: row.id, ...fields, ...(row._clerk_type !== undefined ? { type: row._clerk_type } : {}) };
}

/** Newest first, as Clerk orders its lists by default (`order_by=-created_at`). */
export const newestFirst = <T extends Row>(rows: T[]): T[] =>
  // two made at the same instant: the later-made first, as the tree keeps them in the order they were written
  rows.map((row, i) => ({ row, i })).sort((a, b) => Number(b.row.created_at ?? 0) - Number(a.row.created_at ?? 0) || b.i - a.i).map((x) => x.row);

/** `order_by` (`[+-]<field>`, the fields an operation names) and `query` (an exact id, or part of a name or key: "Uses
 *  exact match for … ID and partial match for name and key"). A field the operation does not order by is refused, never
 *  ignored. Equal values keep the list's own order. */
export function orderAndFilter<T extends Row>(ctx: WriteHookContext, items: T[], fallback: string, fields: string[], matched: string[] = ['name', 'key']): T[] | Response {
  const q = query(ctx);
  const needle = q.get('query');
  let out = items;
  if (needle) out = out.filter((i) => String(i.id) === needle || matched.some((f) => String(i[f] ?? '').toLowerCase().includes(needle.toLowerCase())));
  const orderBy = q.get('order_by') || fallback;
  const desc = orderBy.startsWith('-');
  const field = orderBy.replace(/^[+-]/, '');
  if (!fields.includes(field)) return invalid('order_by', `order_by must be one of ${fields.join(', ')}, each with an optional + or - prefix.`);
  const indexed = out.map((item, i) => ({ item, i }));
  indexed.sort((a, b) => {
    const x = a.item[field] as string | number; const y = b.item[field] as string | number;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
    return (desc ? -c : c) || (desc ? b.i - a.i : a.i - b.i);
  });
  return indexed.map((x) => x.item);
}

/** A list parameter whose ids may carry `+` (include) or `-` (exclude) (spec: "the `+` and `-` can be prepended to the
 *  ID"): whether a value, or any of several, passes. */
export function signedIds(values: string[]): ((value: string | string[]) => boolean) | undefined {
  const all = values.flatMap((v) => v.split(',')).filter(Boolean);
  if (!all.length) return undefined;
  const include = all.filter((v) => !v.startsWith('-')).map((v) => v.replace(/^\+/, ''));
  const exclude = all.filter((v) => v.startsWith('-')).map((v) => v.slice(1));
  return (value) => {
    const vs = Array.isArray(value) ? value : [value];
    if (vs.some((v) => exclude.includes(v))) return false;
    return !include.length || vs.some((v) => include.includes(v));
  };
}

/** Two setting bags deep-merged: a nested bag merges key by key, anything else replaces. */
export function deepMerge(base: Row, patch: Row): Row {
  const out: Row = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const prior = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && prior && typeof prior === 'object' && !Array.isArray(prior) ? deepMerge(prior as Row, v as Row) : v;
  }
  return out;
}

export const sha256 = kernelSha256;

// ── the instance ──────────────────────────────────────────────────────────────────────────────

/** The Dashboard door's private instance configuration (`_instance`), shared with the Frontend API's
 *  environment (../../fapi) and the dashboard pages' doors (../server.ts): the World's one instance, by its id in Clerk's
 *  form, `ins_` and 27 word characters (the same id every event names as its `instance_id`, CLERK_INSTANCE_ID).
 *  source: spec:createAdminPortalLinkToken "^ins_\w{27}$" */
export const INSTANCE_SUBJECT = 'ins_2VOLTERINSTANCE000000000001';
export const instanceRow = (ctx: WriteHookContext): Row | undefined => ctx.rowsRaw('_instance')[0] ?? ctx.rowsRaw('instance')[0];

/** A new instance's organization settings: off ("Organizations are disabled by default"), 5 members an organization
 *  ("each Organization allows a maximum of 5 members by default"), the Admin role as the creator's, slugs off
 *  ("Organization slugs are disabled by default for applications created after October 7, 2025", and a World's
 *  application is made on its clock, from 2026) (https://clerk.com/docs/guides/organizations/configure), the Member role
 *  for members a domain enrolls, no domains. */
export const DEFAULT_ORGANIZATION_SETTINGS: Row = {
  // source: https://clerk.com/docs/guides/organizations/configure "Organization slugs are disabled by default for applications created after October 7, 2025."
  enabled: false, max_allowed_memberships: 5, creator_role: 'org:admin', admin_delete_enabled: true, slug_disabled: true,
  domains: { enabled: false, enrollment_modes: [], default_role: 'org:member' },
};

/** The Backend API's OrganizationSettings singleton, stored in its published flat response shape.
 *  The legacy instance row is read only as compatibility input; new settings writes use this resource. */
export function organizationSettingsView(ctx: WriteHookContext): Row {
  const legacy = deepMerge(DEFAULT_ORGANIZATION_SETTINGS, (ctx.rowsRaw('instance')[0]?.organization_settings as Row | undefined) ?? {});
  const domains = legacy.domains as Row;
  const stored = ctx.rowsRaw('OrganizationSettings')[0] ?? {};
  const { id: _id, type: _type, updatedAt: _updatedAt, ...fields } = stored;
  return {
    object: 'organization_settings', enabled: legacy.enabled === true, max_allowed_memberships: legacy.max_allowed_memberships,
    // spec:/components/schemas/OrganizationSettings; default limits retain the pack's existing documented reading.
    max_allowed_roles: 10, max_role_sets_allowed: 1, max_allowed_domains: 10, max_allowed_permissions: 50,
    creator_role: legacy.creator_role, admin_delete_enabled: legacy.admin_delete_enabled !== false,
    domains_enabled: domains.enabled === true, slug_disabled: legacy.slug_disabled === true,
    domains_enrollment_modes: domains.enrollment_modes, domains_default_role: domains.default_role, initial_role_set_key: null,
    ...fields,
  };
}

/** The Frontend API's environment groups the Backend API's domain settings under `domains`. */
export function organizationSettings(ctx: WriteHookContext): Row {
  const s = organizationSettingsView(ctx);
  return {
    ...s, domains: { enabled: s.domains_enabled, enrollment_modes: s.domains_enrollment_modes, default_role: s.domains_default_role },
  };
}

/** Merge a settings change into the same vendor shape the GET and derived refresh observe. */
export async function writeOrganizationSettings(ctx: HandlerContext, patch: Row): Promise<void> {
  const { domains, ...fields } = patch;
  const flat: Row = { ...fields };
  if (domains && typeof domains === 'object') {
    for (const [from, to] of [['enabled', 'domains_enabled'], ['enrollment_modes', 'domains_enrollment_modes'], ['default_role', 'domains_default_role']] as const) {
      if ((domains as Row)[from] !== undefined) flat[to] = (domains as Row)[from];
    }
  }
  await ctx.write('OrganizationSettings', 'organization_settings', { ...organizationSettingsView(ctx), ...flat }, 'organization_settings.update');
}

/** "Organizations are disabled by default" (https://clerk.com/docs/guides/organizations/configure); a call on an
 *  instance without them is Clerk's 403 `organization_not_enabled_in_instance`, "access denied"
 *  (https://clerk.com/docs/guides/development/errors/backend-api), on every organization, invitation, membership, role
 *  and permission operation whose spec declares a 403 (spec: ListOrganizations, CreateOrganization, GetOrganization,
 *  UpdateOrganization, the invitations' create, bulk, get and revoke, CreateOrganizationMembership, the roles' every
 *  operation, UpdateOrganizationPermission, DeleteOrganizationPermission, UsersGetOrganizationMemberships). */
export function organizationsOff(ctx: WriteHookContext): Response | undefined {
  if (organizationSettings(ctx).enabled === true) return undefined;
  // source: https://clerk.com/docs/guides/development/errors/backend-api "The organizations feature is not enabled for this instance."
  return clerkError(403, 'organization_not_enabled_in_instance', 'access denied', 'The organizations feature is not enabled for this instance. You can enable it at https://dashboard.clerk.com.');
}

/** A slug given on an instance whose organization slugs are off is Clerk's OrganizationSlugsDisabled (403
 *  `organization_slugs_disabled`, https://clerk.com/docs/guides/development/errors/backend-api). */
export function slugsOff(ctx: WriteHookContext): Response | undefined {
  if (organizationSettings(ctx).slug_disabled !== true) return undefined;
  // source: https://clerk.com/docs/guides/development/errors/backend-api "This instance does not have slugs enabled for organizations."
  return clerkError(403, 'organization_slugs_disabled', 'organization slugs not enabled', 'This instance does not have slugs enabled for organizations.');
}

/** A development instance's Frontend API host until its Domains page names another: the one the World's publishable key
 *  encodes (`pk_test_<base64 "twin.clerk.accounts.dev$">`, packages/world-runtime/src/fixture-env.ts), in Clerk's
 *  development family (`<slug>.clerk.accounts.dev`). */
export const DEFAULT_FRONTEND_API = 'twin.clerk.accounts.dev';

/** The host of the instance's Frontend API (its dashboard's Domains page, set through the twin's `/_twin/instance` door):
 *  where the links Clerk emails point, and every token's issuer. */
export function frontendApiHost(ctx: WriteHookContext): string {
  const auth = (instanceRow(ctx)?._auth as Row | undefined) ?? {};
  return typeof auth.frontend_api === 'string' && auth.frontend_api ? auth.frontend_api : DEFAULT_FRONTEND_API;
}

// source: https://clerk.com/docs/guides/development/clerk-environment-variables "It will be prefixed with pk_test_ in development instances and pk_live_ in production instances."
export const instanceEnvironment = (ctx: WriteHookContext): 'development' | 'production' =>
  instanceRow(ctx)?.environment_type === 'production' ? 'production' : 'development';
export const publishableKey = (ctx: WriteHookContext): string =>
  `pk_${instanceEnvironment(ctx) === 'production' ? 'live' : 'test'}_${Buffer.from(`${frontendApiHost(ctx)}$`).toString('base64')}`;

// ── organization permissions and roles (https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions)

/** "Clerk's System Permissions consist of the following": every instance has them, none can be changed or deleted, and
 *  none rides a session token. */
const SYSTEM_PERMISSION_DEFS: ReadonlyArray<readonly [key: string, name: string, description: string]> = [
  ['org:sys_profile:manage', 'Manage organization', 'Permission to manage an organization.'],
  ['org:sys_profile:delete', 'Delete organization', 'Permission to delete an organization.'],
  ['org:sys_memberships:read', 'Read members', 'Permission to read the members of an organization.'],
  ['org:sys_memberships:manage', 'Manage members', 'Permission to manage the members of an organization.'],
  ['org:sys_domains:read', 'Read domains', 'Permission to read the domains of an organization.'],
  ['org:sys_domains:manage', 'Manage domains', 'Permission to manage the domains of an organization.'],
  ['org:sys_billing:read', 'Read billing', 'Permission to read the billing of an organization.'],
  ['org:sys_billing:manage', 'Manage billing', 'Permission to manage the billing of an organization.'],
  ['org:sys_entconns:manage', 'Manage enterprise connections', 'Permission to manage the enterprise connections of an organization.'],
];
// A system permission's id: `perm_` and 27 word characters, the form of Clerk's ids (`^<prefix>_\w{27}$`, the spec's
// instances, organizations and users); where the documentation stops: Clerk publishes no system permission's id, so the
// twin's is fixed per key, the key's words after `2VOLTER`, padded with zeros.
// source: spec:createAdminPortalLinkToken "^org_\w{27}$"
const systemPermissionId = (key: string): string => `perm_${`2VOLTER${key.slice('org:sys_'.length).replace(/[:_]/g, '').toUpperCase()}`.padEnd(27, '0')}`;
/** Created a millisecond apart from the epoch, in the page's order: the list's `+created_at` default answers them so (its
 *  ties fall to the ids, which would sort them alphabetically). */
const SYSTEM_PERMISSIONS: ReadonlyArray<Row> = SYSTEM_PERMISSION_DEFS.map(([key, name, description], i) => ({
  object: 'permission', id: systemPermissionId(key), name, key, description, type: 'system', created_at: i, updated_at: i,
}));

/** A custom permission as Clerk answers it (its vendor `type` kept under `_clerk_type`, the kernel owning `type`). */
export function permissionView(r: Row): Row {
  return { object: 'permission', id: r.id, name: r.name, key: r.key, description: r.description ?? '', type: typeof r._clerk_type === 'string' ? r._clerk_type : 'user', created_at: r.created_at, updated_at: r.updated_at };
}
/** Every permission of the instance: the system ones, then the custom ones in creation order. */
export const permissions = (ctx: WriteHookContext): Row[] => [...SYSTEM_PERMISSIONS.map((p) => ({ ...p })), ...ctx.rowsRaw('Permission').map(permissionView)];
export const permissionById = (ctx: WriteHookContext, id: unknown): Row | undefined => permissions(ctx).find((p) => p.id === id);

export type RoleRecord = { id: string; key: string; name: string; description: string | null; permission_ids: string[]; system: boolean; legacyKey?: string; include_in_initial_role_set?: boolean; created_at: number; updated_at: number };

/** "Members with the admin Role have all of the System Permissions"; the member role "is limited to the 'Read members'
 *  and 'Read billing' Permissions only, by default". `legacyKey` is the key the role had before Clerk prefixed role keys
 *  with `org:` (`admin`, `basic_member`), which older applications still send. A system role is answered from these until
 *  a call changes it, when it is stored under the same id; a role keeps its permissions by id (`_permission_ids`). */
// Each system role's id is `role_` and 27 word characters, the form of Clerk's ids (`^<prefix>_\w{27}$`); where the
// documentation stops: Clerk publishes no system role's id, so the twin's are fixed, the Admin role's before the Member
// role's in a list's tie order.
// source: spec:createAdminPortalLinkToken "^org_\w{27}$"
const SYSTEM_ROLE_DEFS: ReadonlyArray<RoleRecord> = [
  { id: 'role_2VOLTERADMIN000000000000001', key: 'org:admin', legacyKey: 'admin', name: 'Admin', description: 'Offers full access to Organization resources', permission_ids: SYSTEM_PERMISSION_DEFS.map(([k]) => systemPermissionId(k)), system: true, created_at: 0, updated_at: 0 },
  { id: 'role_2VOLTERMEMBER00000000000001', key: 'org:member', legacyKey: 'basic_member', name: 'Member', description: 'Offers limited access to Organization resources', permission_ids: ['org:sys_memberships:read', 'org:sys_billing:read'].map(systemPermissionId), system: true, created_at: 0, updated_at: 0 },
];
export const MEMBER_ROLE_ID = 'role_2VOLTERMEMBER00000000000001';

function roleRecordOf(r: Row, base?: RoleRecord): RoleRecord {
  return {
    id: base?.id ?? String(r.id), key: String(r.key ?? base?.key), name: String(r.name ?? base?.name),
    description: r.description === undefined ? (base?.description ?? null) : (r.description as string | null),
    permission_ids: Array.isArray(r._permission_ids) ? (r._permission_ids as string[]) : (base?.permission_ids ?? []),
    system: base !== undefined, ...(base?.legacyKey ? { legacyKey: base.legacyKey } : {}),
    include_in_initial_role_set: r.include_in_initial_role_set === true,
    created_at: typeof r.created_at === 'number' && base === undefined ? r.created_at : (base?.created_at ?? 0),
    updated_at: typeof r.updated_at === 'number' ? r.updated_at : (base?.updated_at ?? 0),
  };
}

/** Every role of the instance: the system roles as a person left them, then the custom roles. */
export function roleRecords(ctx: WriteHookContext): RoleRecord[] {
  const stored = ctx.rowsRaw('Role');
  const system = SYSTEM_ROLE_DEFS.map((def) => { const row = stored.find((r) => r.id === def.id); return row ? roleRecordOf(row, def) : { ...def, permission_ids: [...def.permission_ids] }; });
  return [...system, ...stored.filter((r) => !SYSTEM_ROLE_DEFS.some((d) => d.id === r.id)).map((r) => roleRecordOf(r))];
}

/** The role a membership's role string names: its key, or a system role's pre-`org:` key. */
export function roleByKey(ctx: WriteHookContext, key: string): RoleRecord | undefined {
  const all = roleRecords(ctx);
  return all.find((r) => r.key === key) ?? all.find((r) => r.legacyKey === key);
}
export const roleMatches = (rec: RoleRecord, key: unknown): boolean => typeof key === 'string' && (key === rec.key || (rec.legacyKey !== undefined && key === rec.legacyKey));

/** The permission keys a role grants (system and custom), read now: a change to the role reaches every member. */
export function permissionKeysOf(ctx: WriteHookContext, roleKey: string): string[] {
  const rec = roleByKey(ctx, roleKey);
  if (!rec) return [];
  const all = permissions(ctx);
  return rec.permission_ids.map((pid) => all.find((p) => p.id === pid)?.key).filter((k): k is string => typeof k === 'string');
}

/** The role an organization's creator gets (the instance's `creator_role`), and the one a domain enrolls members with. */
export const creatorRole = (ctx: WriteHookContext): string => String(organizationSettings(ctx).creator_role ?? 'org:admin');
export const domainDefaultRole = (ctx: WriteHookContext): string => String((organizationSettings(ctx).domains as Row).default_role ?? 'org:member');

/** Clerk's Role: the permissions it holds as Permission objects; eligible to be the creator role when it can run the
 *  organization it makes (it manages members and the profile). */
export function roleView(ctx: WriteHookContext, rec: RoleRecord): Row {
  const all = permissions(ctx);
  const held = rec.permission_ids.map((pid) => all.find((p) => p.id === pid)).filter((p): p is Row => p !== undefined);
  return {
    object: 'role', id: rec.id, name: rec.name, key: rec.key, description: rec.description,
    is_creator_eligible: held.some((p) => p.key === 'org:sys_memberships:manage') && held.some((p) => p.key === 'org:sys_profile:manage'),
    permissions: held, created_at: rec.created_at, updated_at: rec.updated_at,
  };
}

/** A role written back, whole (a system role's first change stores it under its id). */
export async function saveRole(ctx: HandlerContext, rec: RoleRecord, operation: string): Promise<void> {
  await ctx.write('Role', rec.id, {
    object: 'role', key: rec.key, name: rec.name, description: rec.description, _permission_ids: rec.permission_ids,
    include_in_initial_role_set: rec.include_in_initial_role_set === true, updated_at: ms(ctx), created_at: rec.created_at,
  }, operation);
}

/** A role key a membership or invitation names must be a role of the instance. */
export function roleParamError(ctx: WriteHookContext, role: string): Response | undefined {
  return roleByKey(ctx, role) ? undefined : invalid('role', `${role} is not a role of this instance.`);
}

// ── organizations, memberships, invitations ─────────────────────────────────────────────────────

export const organizations = (ctx: WriteHookContext): Row[] => ctx.rows('Organization');

/** An organization named by its id or its slug, as `GET /organizations/{organization_id}` takes either. */
export const organizationOf = (ctx: WriteHookContext, idOrSlug: unknown): Row | undefined =>
  typeof idOrSlug === 'string' ? ctx.find('Organization', idOrSlug) : undefined;

// The Backend API returns this user reference inside public_user_data. Legacy rows may still name it at top level.
export const membershipUserId = (m: Row): string => String((m.public_user_data as Row | undefined)?.user_id ?? m.user_id ?? '');
export const memberships = (ctx: WriteHookContext): Row[] => ctx.rows('OrganizationMembership').map((m) => ({ ...m, user_id: membershipUserId(m) }));
export const invitations = (ctx: WriteHookContext): Row[] => ctx.rows('OrganizationInvitation');
export const pending = (i: Row): boolean => (i.status ?? 'pending') === 'pending';

/** A user's memberships, newest first, of organizations that still exist. */
export const membershipsOf = (ctx: WriteHookContext, userId: string): Row[] =>
  newestFirst(memberships(ctx).filter((m) => m.user_id === userId && ctx.get('Organization', String(m.organization_id))));

/** An organization as Clerk answers it, with its counts when the call asks for them (`include_members_count`) and
 *  whether it lacks a member who can run it (`include_missing_member_with_elevated_permissions`). */
export function organizationView(ctx: WriteHookContext, org: Row, opts: { counts?: boolean; elevated?: boolean } = {}): Row {
  const members = memberships(ctx).filter((m) => m.organization_id === org.id);
  const runs = (role: unknown): boolean => runsOrganization(ctx, role);
  return {
    ...own(ctx, org),
    ...(opts.counts ? { members_count: members.length, pending_invitations_count: invitations(ctx).filter((i) => i.organization_id === org.id && pending(i)).length } : {}),
    ...(opts.elevated ? { missing_member_with_elevated_permissions: !members.some((m) => runs(m.role)) } : {}),
  };
}

/** The part of a user every member of an organization may see (spec:/components/schemas/OrganizationMembershipPublicUserData). */
export function publicUserData(ctx: WriteHookContext, userId: string): Row {
  const user = ctx.get('User', userId) ?? {};
  const emails = (user.email_addresses as Row[] | undefined) ?? [];
  const primary = emails.find((e) => e.id === user.primary_email_address_id) ?? emails[0];
  return {
    user_id: userId, first_name: user.first_name ?? null, last_name: user.last_name ?? null,
    profile_image_url: user.profile_image_url ?? user.image_url ?? null, image_url: user.image_url ?? '', has_image: user.has_image === true,
    identifier: primary?.email_address ?? null, username: user.username ?? null, banned: user.banned === true, deprovisioned: false,
  };
}

/** A membership as Clerk answers it: the organization inside it, its role's name and permissions, and the member. */
export function membershipView(ctx: WriteHookContext, m: Row): Row {
  const org = ctx.get('Organization', String(m.organization_id));
  const role = String(m.role);
  const { organization_id: _o, user_id: _u, ...fields } = own(ctx, m);
  return {
    ...fields, object: 'organization_membership', role, role_name: String(roleByKey(ctx, role)?.name ?? role),
    permissions: permissionKeysOf(ctx, role),
    organization: org ? organizationView(ctx, org) : null,
    public_user_data: publicUserData(ctx, membershipUserId(m)),
  };
}

/** Memberships ordered by `order_by` (spec: "phone_number, email_address, created_at, first_name, last_name or username",
 *  `+`/`-`), newest first when none is asked for. */
export function orderMemberships(ctx: WriteHookContext, rows: Row[]): Row[] | Response {
  const orderBy = query(ctx).get('order_by');
  if (!orderBy) return newestFirst(rows);
  const field = orderBy.replace(/^[+-]/, '');
  const fields = ['phone_number', 'email_address', 'created_at', 'first_name', 'last_name', 'username'];
  if (!fields.includes(field)) return invalid('order_by', `order_by must be one of ${fields.join(', ')}, each with an optional + or - prefix.`);
  const key = (m: Row): string | number => {
    if (field === 'created_at') return Number(m.created_at ?? 0);
    const u = ctx.get('User', String(m.user_id)) ?? {};
    if (field === 'email_address') return String(((u.email_addresses as Row[] | undefined) ?? [])[0]?.email_address ?? '');
    if (field === 'phone_number') return String(((u.phone_numbers as Row[] | undefined) ?? [])[0]?.phone_number ?? '');
    return String(u[field] ?? '');
  };
  const desc = orderBy.startsWith('-');
  return [...rows].sort((a, b) => { const x = key(a), y = key(b); const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)); return desc ? -c : c; });
}

/** Whether a role can run an organization: it manages its members and its profile (the permissions Clerk's creator role
 *  "must contain", ERRORS' organization_missing_creator_role_permissions). */
export function runsOrganization(ctx: WriteHookContext, role: unknown): boolean {
  const keys = permissionKeysOf(ctx, String(role));
  return keys.includes('org:sys_memberships:manage') && keys.includes('org:sys_profile:manage');
}

/** An organization's membership limit, counting its members and its pending invitations: Clerk's
 *  OrganizationMembershipQuotaExceeded (403 `organization_membership_quota_exceeded`, "You have reached your limit of %d
 *  organization memberships, including outstanding invitations.",
 *  https://clerk.com/docs/guides/development/errors/backend-api) when `adding` more would pass it. Clerk's pages give no
 *  meaning to a limit of 0 (the spec's minimum); the twin reads it as no limit, as a limit of 0 would refuse the creator. */
export function membershipQuota(ctx: WriteHookContext, org: Row, adding = 1): Response | undefined {
  const limit = Number(org.max_allowed_memberships ?? 0);
  if (!(limit > 0)) return undefined;
  const held = memberships(ctx).filter((m) => m.organization_id === org.id).length + invitations(ctx).filter((i) => i.organization_id === org.id && pending(i)).length;
  if (held + adding <= limit) return undefined;
  // source: https://clerk.com/docs/guides/development/errors/backend-api "organization memberships, including outstanding invitations."
  return clerkError(403, 'organization_membership_quota_exceeded', 'organization membership quota exceeded', `You have reached your limit of ${limit} organization memberships, including outstanding invitations.`);
}

/** Write a membership: one per organization and user, naming both. */
export async function addMember(ctx: HandlerContext, orgId: string, userId: string, role: string, metadata: { public_metadata?: unknown; private_metadata?: unknown } = {}): Promise<Row> {
  const at = ms(ctx);
  const id = ctx.mint('OrganizationMembership');
  await ctx.write('OrganizationMembership', id, {
    object: 'organization_membership', organization_id: orgId, public_user_data: publicUserData(ctx, userId), role,
    public_metadata: (metadata.public_metadata as Row | undefined) ?? {}, private_metadata: (metadata.private_metadata as Row | undefined) ?? {}, created_at: at, updated_at: at,
  }, 'organization_membership.create');
  return ctx.get('OrganizationMembership', id)!;
}

/** An invitation as Clerk answers it: its status, its role's name and who sent it. */
export function invitationView(ctx: WriteHookContext, i: Row): Row {
  const role = String(i.role);
  const inviter = typeof i.inviter_id === 'string' ? publicUserData(ctx, i.inviter_id) : null;
  return { ...own(ctx, i), status: i.status ?? 'pending', role_name: String(roleByKey(ctx, role)?.name ?? role), public_inviter_data: inviter };
}

// ── SAML connections (the deprecated SAML Connections API's, and the SAML side of an enterprise connection) ────────

/** The IdP settings a SAML connection needs before it can be active: "You have to provide the <fields> before you are
 *  able to activate this connection" (https://clerk.com/docs/guides/development/errors/backend-api,
 *  SAMLConnectionCantBeActivated, 422 `saml_connection_cant_be_activated`). IdP metadata, given as its document or its
 *  URL, is read into these fields when it is set (`fromIdpMetadata`), so a connection passes only on what was read. */
export const activationError = (row: Row): Response | undefined => {
  const lacking = ['idp_entity_id', 'idp_sso_url', 'idp_certificate'].filter((f) => !row[f]);
  return lacking.length ? clerkError(422, 'saml_connection_cant_be_activated', "SAML Connection can't be activated", `You have to provide the ${lacking.join(', ')} before you are able to activate this connection.`) : undefined;
};

/** An XML attribute's value, quoted either way. */
const attribute = (tag: string, name: string, xml: string): string | undefined =>
  new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*?\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(xml)?.slice(1).find((v) => v !== undefined);

/** A SAML side's settings with its IdP's metadata read: "If present, it takes priority over the corresponding individual
 *  properties" (spec: CreateSAMLConnection's `idp_metadata` and `idp_metadata_url`), so the metadata's entity ID, single
 *  sign-on location and signing certificate stand for `idp_entity_id`, `idp_sso_url` and `idp_certificate`. A URL is
 *  fetched as Clerk fetches it, through the World (`ctx.vendorFetch`): the World's twin of that IdP answers, and an IdP
 *  the World runs no twin of, or one that answers no document, is ERRORS' SAMLFailedToFetchIDPMetadata (400
 *  `saml_failed_to_fetch_idp_metadata`). Metadata with no entity descriptor is its SAMLFailedToParseIDPMetadata (422
 *  `saml_failed_to_parse_idp_metadata`); one lacking any of the three, its SAMLMetadataMissingFields (422
 *  `saml_metadata_missing_fields`), which names no fields' spelling, so where the documentation stops they are named as
 *  the settings they stand for. */
// source: spec:CreateSAMLConnection "If present, it takes priority over the corresponding individual properties"
// source: https://clerk.com/docs/guides/development/errors/backend-api "We failed to fetch the IdP metadata. If the error persists, please provide the IdP configuration data explicitly."
// source: https://clerk.com/docs/guides/development/errors/backend-api "We failed to parse the IdP metadata. If the error persists, please provide the IdP configuration data explicitly."
// source: https://clerk.com/docs/guides/development/errors/backend-api "The IdP metadata is missing the following required fields:"
export async function fromIdpMetadata(ctx: HandlerContext, settings: Row): Promise<Row | Response> {
  let xml = settings.idp_metadata;
  if (typeof settings.idp_metadata_url === 'string' && settings.idp_metadata_url.trim() !== '') {
    const failed = clerkError(400, 'saml_failed_to_fetch_idp_metadata', 'Failed to fetch IdP metadata', 'We failed to fetch the IdP metadata. If the error persists, please provide the IdP configuration data explicitly.');
    // a URL nothing can fetch is a fetch that failed
    if (!URL.canParse(settings.idp_metadata_url)) return failed;
    let answer: Response;
    try {
      answer = await ctx.vendorFetch(settings.idp_metadata_url, { headers: { accept: 'application/samlmetadata+xml, application/xml, text/xml' } });
    } catch (e) {
      // an IdP the World runs no twin of, or a twin no connection reaches or that does not answer in time; anything else
      // (a defect here or in the twin that answered) is thrown, never Clerk's 400
      if (e instanceof VendorUnreachableError) return failed;
      throw e;
    }
    if (!answer.ok) return failed;
    xml = await answer.text();
  }
  if (typeof xml !== 'string' || xml.trim() === '') return settings;
  const entity = attribute('EntityDescriptor', 'entityID', xml);
  if (entity === undefined) return clerkError(422, 'saml_failed_to_parse_idp_metadata', 'Failed to parse IdP metadata', 'We failed to parse the IdP metadata. If the error persists, please provide the IdP configuration data explicitly.');
  const read: Row = {
    idp_entity_id: entity || null,
    idp_sso_url: attribute('SingleSignOnService', 'Location', xml) || null,
    idp_certificate: /<(?:[\w-]+:)?X509Certificate>\s*([^<]+?)\s*</.exec(xml)?.[1]?.replace(/\s+/g, '') ?? null,
  };
  const lacking = Object.keys(read).filter((f) => !read[f]);
  if (lacking.length) return clerkError(422, 'saml_metadata_missing_fields', 'IdP metadata is missing required fields', `The IdP metadata is missing the following required fields: ${lacking.join(', ')}`, { missing_fields: lacking });
  return { ...settings, ...read };
}

/** A SAML connection written (spec:/components/schemas/SAMLConnection), inactive, with the service provider's URLs Clerk
 *  assigns: the Frontend API's assertion consumer service (`/v1/saml/acs/{id}`) and metadata
 *  (`/v1/saml/metadata/{id}.xml`), both paths of the Frontend API's spec; `enterprise_connection_id` names the
 *  enterprise connection it is the SAML side of (the schema's own field). */
export async function createSamlConnection(ctx: HandlerContext, c: { name: string; provider: string; domains: string[]; settings: Row; enterpriseConnectionId?: string }): Promise<string> {
  const id = ctx.mint('SAMLConnection');
  const at = ms(ctx);
  const fapi = `https://${frontendApiHost(ctx)}`;
  await ctx.write('SAMLConnection', id, {
    object: 'saml_connection', name: c.name, domain: c.domains[0], domains: c.domains, provider: c.provider,
    idp_entity_id: null, idp_sso_url: null, idp_certificate: null, idp_certificate_issued_at: null, idp_certificate_expires_at: null, idp_metadata_url: null, idp_metadata: null,
    acs_url: `${fapi}/v1/saml/acs/${id}`, sp_entity_id: `${fapi}/saml/${id}`, sp_metadata_url: `${fapi}/v1/saml/metadata/${id}.xml`,
    organization_id: null, attribute_mapping: { user_id: '', email_address: '', first_name: '', last_name: '' },
    active: false, user_count: 0, sync_user_attributes: true, allow_subdomains: false, allow_idp_initiated: false, disable_additional_identifications: false,
    allow_organization_account_linking: false, force_authn: false, login_hint: { mode: 'off' }, enterprise_connection_id: c.enterpriseConnectionId ?? null,
    ...c.settings, created_at: at, updated_at: at,
  }, 'saml_connection.create');
  return id;
}

// ── users ─────────────────────────────────────────────────────────────────────────────────────

const emailsOf = (user: Row): Row[] => (Array.isArray(user.email_addresses) ? (user.email_addresses as Row[]) : []);

/** The user an email address belongs to (Clerk compares addresses without case). */
export function userByEmail(ctx: WriteHookContext, email: string): Row | undefined {
  const wanted = email.trim().toLowerCase();
  return ctx.rows('User').find((u) => emailsOf(u).some((e) => String(e.email_address).toLowerCase() === wanted));
}
export const primaryEmail = (user: Row): Row | undefined => emailsOf(user).find((e) => e.id === user.primary_email_address_id) ?? emailsOf(user)[0];

/** An identifier's id (an email address inside a user), derived from its user and its value, in Clerk's form: `idn_` and
 *  27 word characters.
 *  source: https://clerk.com/docs/webhooks/overview "idn_29w83yL7CwVlJXylYLxcslromF1" */
export const identificationId = (userId: string, value: string): string => `idn_${sha256(`${userId}:${value}`).slice(0, 27)}`;

/** A password is kept only as a digest (`_password_digest`, `sha256$<salt>$<hash>`, a thousand rounds of SHA-256 over
 *  the salt and the password), its salt derived from the subject it belongs to, never drawn, so a World hashes alike every
 *  run. The digest is bookkeeping and never answered; a twin's password protects nothing real, and the hash is only what
 *  the kernel's SHA-256. */
function stretch(password: string, salt: string): string {
  let h = `${salt}:${password}`;
  for (let i = 0; i < 1000; i += 1) h = kernelSha256(h);
  return h;
}
export function passwordDigest(password: string, saltSeed: string): string {
  const salt = sha256(`salt:${saltSeed}`).slice(0, 32);
  return `sha256$${salt}$${stretch(password, salt)}`;
}
export function passwordMatches(password: string, digest: unknown): boolean {
  if (typeof digest !== 'string') return false;
  const parts = digest.split('$');
  if (parts.length !== 3 || parts[0] !== 'sha256') return false;
  return equalSecrets(stretch(password, parts[1]!), parts[2]!);
}

/** An email address as a user holds it (spec:/components/schemas/EmailAddress), verified as the call says. */
export function emailAddress(userId: string, email: string, at: number, verification: Row): Row {
  return { id: identificationId(userId, email.toLowerCase()), object: 'email_address', email_address: email.toLowerCase(), reserved: false, verification, linked_to: [], created_at: at, updated_at: at };
}

/** The avatar Clerk shows for a user or an organization with no image of its own: "Returns `false` if Clerk is
 *  displaying an avatar for the user" (https://clerk.com/docs/reference/backend/types/backend-user.md, `hasImage`), at
 *  Clerk's image host, its path the avatar's description (the subject and its initials) as base64url JSON. */
// source: https://clerk.com/docs/reference/backend/types/backend-user.md "Returns `false` if Clerk is displaying an avatar for the user."
export function defaultImageUrl(subject: string, initials: string): string {
  return `https://img.clerk.com/${Buffer.from(JSON.stringify({ type: 'default', iid: INSTANCE_SUBJECT, rid: subject, initials })).toString('base64url')}`;
}
/** A name's initials, as an avatar shows them. */
export const initialsOf = (...names: unknown[]): string => names.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim()[0]!.toUpperCase()).join('');

/** A new user's fields in Clerk's `User` shape (spec:/components/schemas/User). */
export function newUserFields(id: string, at: number, u: { emails: Row[]; firstName?: unknown; lastName?: unknown; username?: unknown; externalId?: unknown; passwordDigest?: string; publicMetadata?: unknown; privateMetadata?: unknown; unsafeMetadata?: unknown; legalAcceptedAt?: number | null; createOrganizationEnabled?: boolean; deleteSelfEnabled?: boolean }): Row {
  return {
    object: 'user', external_id: (u.externalId as string | undefined) ?? null, primary_email_address_id: (u.emails[0]?.id as string | undefined) ?? null,
    primary_phone_number_id: null, primary_web3_wallet_id: null, username: (u.username as string | undefined) ?? null,
    first_name: (u.firstName as string | undefined) ?? null, last_name: (u.lastName as string | undefined) ?? null,
    image_url: defaultImageUrl(id, initialsOf(u.firstName, u.lastName)), profile_image_url: defaultImageUrl(id, initialsOf(u.firstName, u.lastName)), has_image: false,
    public_metadata: (u.publicMetadata as Row | undefined) ?? {}, private_metadata: (u.privateMetadata as Row | undefined) ?? {}, unsafe_metadata: (u.unsafeMetadata as Row | undefined) ?? {},
    email_addresses: u.emails, phone_numbers: [], web3_wallets: [], passkeys: [], external_accounts: [], saml_accounts: [], enterprise_accounts: [],
    password_enabled: u.passwordDigest !== undefined, two_factor_enabled: false, totp_enabled: false, backup_code_enabled: false,
    mfa_enabled_at: null, mfa_disabled_at: null, password_last_updated_at: u.passwordDigest !== undefined ? at : null,
    last_sign_in_at: null, banned: false, locked: false, lockout_expires_in_seconds: null, verification_attempts_remaining: null,
    delete_self_enabled: u.deleteSelfEnabled ?? false, create_organization_enabled: u.createOrganizationEnabled ?? true, last_active_at: null,
    legal_accepted_at: u.legalAcceptedAt ?? null, created_at: at, updated_at: at,
    ...(u.passwordDigest !== undefined ? { _password_digest: u.passwordDigest } : {}),
  };
}

// ── signing: the instance's key, the pack's data; the kernel signs and verifies with it ─────────────

/** The instance's issuer: the `iss` of every token it signs, "The Frontend API URL of your instance"
 *  (https://clerk.com/docs/guides/sessions/session-tokens), which follows its Domains page. */
export const issuerOf = (ctx: WriteHookContext): string => `https://${frontendApiHost(ctx)}`;

export type { Jwk, Jwks } from '@volter/world-core';
/** The instance's signing key: the World's, made once at random (ctx.signingKey), signed with and verified by the
 *  kernel, so every token verifies against this World's JWKS and no one forges one from the pack. Both APIs' fronts make
 *  it before anything is answered (`ensureInstanceKey`), so the signing below, which a cookie's every read reaches,
 *  need not wait for it. */
export const INSTANCE_KEY = 'clerk-instance';
export const ensureInstanceKey = async (ctx: Pick<HandlerContext, 'signingKey'>): Promise<void> => { await ctx.signingKey(INSTANCE_KEY); };
export const instanceKey = (ctx: Pick<HandlerContext, 'heldSigningKey'>) => {
  const key = ctx.heldSigningKey(INSTANCE_KEY);
  if (!key) throw new Error('clerk: the instance key is made by the fronts before anything is answered');
  return { alg: 'RS256' as const, ...key };
};

/** A JWT signed RS256 with the instance's key: `iat` and `nbf` are `now` (seconds, the World's), `exp` `now` plus the
 *  lifetime, unless the claims name their own. */
export const signJwt = (ctx: Pick<HandlerContext, 'heldSigningKey'>, claims: Row, opts: { now: number; expiresInSeconds?: number; typ?: string }): string => jwtSign(claims, instanceKey(ctx), opts);
/** The decoded parts of a JWT (no verification). */
export const decodeJwt = jwtDecode;
/** A token's RS256 signature checked against a JWKS, and its `exp`/`nbf` at `now` (seconds). */
export const verifyJwtWithJwks = (token: string, set: Jwks, opts: { now: number }) => jwtVerify(token, set, opts);
/** The JWKS the Backend API serves (`GET /jwks`): the instance's public key, which verifies every token it signs. */
export const buildJwks = (ctx: Pick<HandlerContext, 'heldSigningKey'>): Jwks => jwks(instanceKey(ctx).publicPem);

// ── sessions ──────────────────────────────────────────────────────────────────────────────────

/** "By default, this setting is enabled with a default value of 7 days for all newly created instances."
 *  (https://clerk.com/docs/guides/secure/session-options, Maximum lifetime) */
export const SESSION_LIFETIME_MS = 7 * 86_400_000;

// ── session tokens and JWT-template tokens ───────────────────────────────────────────────────────

/** A session token lives 60 seconds and allows 5 seconds of clock skew: the defaults of the Dashboard's token settings
 *  ("Default is 60 seconds", "Default is 5 seconds": https://clerk.com/docs/guides/sessions/jwt-templates, which the
 *  session-tokens page names for `exp` and `nbf`). */
const DEFAULT_LIFETIME = 60;
const DEFAULT_SKEW = 5;
const jti = (seed: string): string => sha256(`jti:${seed}`).slice(0, 20);

/** The organization a session is active in, when its user belongs to it. */
function activeOrganization(ctx: WriteHookContext, session: Row, orgId: string | null): { org: Row; membership: Row } | undefined {
  if (!orgId) return undefined;
  const org = ctx.get('Organization', orgId);
  const membership = membershipsOf(ctx, String(session.user_id)).find((m) => m.organization_id === orgId);
  return org && membership ? { org, membership } : undefined;
}

/** The v2 organization claim (https://clerk.com/docs/guides/sessions/session-tokens, "Organization claim"): `o` = { id,
 *  slg, rol (the role without `org:`), per, fpm }, with `fea` naming the organization's features (`o:<feature>`). Only
 *  custom permissions ride the token ("System Permissions are not included in the session token"); `per` lists their
 *  distinct actions, and `fpm[i]` is a bitmask over `per` of the actions feature i grants, "read from right to left". */
function organizationClaims(ctx: WriteHookContext, session: Row, orgId: string | null): Row {
  const active = activeOrganization(ctx, session, orgId);
  if (!active) return {};
  const role = String(active.membership.role);
  const custom = permissionKeysOf(ctx, role).filter((k) => !k.startsWith('org:sys_')).map((k) => k.split(':') as [string, string, string]);
  const features: string[] = [];
  const actions: string[] = [];
  for (const [, feature, action] of custom) {
    if (!features.includes(feature)) features.push(feature);
    if (!actions.includes(action)) actions.push(action);
  }
  const fpm = features.map((feature) => custom.reduce((bits, [, f, a]) => (f === feature ? bits | (1n << BigInt(actions.indexOf(a))) : bits), 0n).toString());
  const o: Row = { id: active.org.id, rol: role.replace(/^org:/, ''), slg: active.org.slug };
  if (custom.length) { o.per = actions.join(','); o.fpm = fpm.join(','); }
  return { o, ...(features.length ? { fea: features.map((f) => `o:${f}`).join(',') } : {}) };
}

/** The organization a token is for: the call's `organization_id` when it sends one ("If present but empty, the personal
 *  account"), else the session's active organization ("If absent, the previous active organization for the session will
 *  be used": the Frontend API's createSessionToken). */
export function tokenOrganization(session: Row, requested: unknown): string | null {
  if (typeof requested === 'string') return requested === '' ? null : requested;
  return typeof session.last_active_organization_id === 'string' && session.last_active_organization_id ? session.last_active_organization_id : null;
}

/** A session's default token, version 2 (the session-tokens page, "Default claims", Version 2: `azp`, `exp`, `fva`,
 *  `iat`, `iss`, `jti`, `nbf`, `sid`, `sub`, `v`, and `o`/`fea` while an organization is active). Version 1's `org_id`,
 *  `org_role` and `org_permissions` are the deprecated shape ("Version 1 was deprecated on April 14, 2025"). `azp` is "the
 *  `Origin` header that was included in the original Frontend API request" (none from the Backend API). */
export function sessionToken(ctx: WriteHookContext, session: Row, opts: { orgId: string | null; origin?: string; lifetime?: number }): string {
  const iat = Math.floor(ms(ctx) / 1000);
  // "the minutes that have passed since the last time a first factor or second factor, respectively, was verified": the
  // first factor was verified when the session was made; no second factor is enabled
  const fva = [Math.max(0, Math.floor((ms(ctx) - Number(session.created_at ?? ms(ctx))) / 60_000)), -1];
  const claims: Row = {
    ...(opts.origin ? { azp: opts.origin } : {}),
    fva, iss: issuerOf(ctx), jti: jti(`${String(session.id)}:${ctx.occurredAt}:${opts.orgId ?? ''}`), nbf: iat - DEFAULT_SKEW,
    sid: String(session.id), sub: String(session.user_id), v: 2,
    ...organizationClaims(ctx, session, opts.orgId),
  };
  return signJwt(ctx, claims, { now: iat, expiresInSeconds: opts.lifetime ?? DEFAULT_LIFETIME });
}

/** What a template's shortcodes read: `user.*` (the jwt-templates page, "Shortcodes"), and the session's active
 *  organization as `org.*` and `org_membership.*` (the session-tokens page names `org.public_metadata` and
 *  `org_membership.public_metadata` among the claims a custom token may carry). */
function shortcodeScope(ctx: WriteHookContext, session: Row): Row {
  const user = ctx.get('User', String(session.user_id)) ?? {};
  const email = primaryEmail(user);
  const phones = Array.isArray(user.phone_numbers) ? (user.phone_numbers as Row[]) : [];
  const phone = phones.find((p) => p.id === user.primary_phone_number_id) ?? phones[0];
  const verified = (x: Row | undefined): boolean => (x?.verification as Row | undefined)?.status === 'verified';
  const first = user.first_name ?? null;
  const last = user.last_name ?? null;
  const scope: Row = {
    user: {
      id: user.id ?? session.user_id, external_id: user.external_id ?? null, first_name: first, last_name: last,
      full_name: first === null && last === null ? null : [first, last].filter((x) => x !== null).join(' '),
      username: user.username ?? null, image_url: user.image_url ?? null, profile_image_url: user.profile_image_url ?? user.image_url ?? null,
      has_image: user.has_image === true, primary_email_address: email?.email_address ?? null, email_verified: verified(email),
      primary_phone_address: phone?.phone_number ?? null, phone_number_verified: verified(phone),
      two_factor_enabled: user.two_factor_enabled === true,
      // the page's complete example answers `{{user.created_at}}` in seconds ("registration_date": 1227618844)
      created_at: typeof user.created_at === 'number' ? Math.floor(user.created_at / 1000) : null,
      updated_at: typeof user.updated_at === 'number' ? Math.floor(user.updated_at / 1000) : null,
      public_metadata: user.public_metadata ?? {}, unsafe_metadata: user.unsafe_metadata ?? {},
      organizations: Object.fromEntries(membershipsOf(ctx, String(session.user_id)).map((m) => [String(m.organization_id), m.role])),
    },
  };
  const active = activeOrganization(ctx, session, tokenOrganization(session, undefined));
  if (active) {
    scope.org = { id: active.org.id, name: active.org.name, slug: active.org.slug, image_url: active.org.image_url ?? null, public_metadata: active.org.public_metadata ?? {}, role: active.membership.role };
    scope.org_membership = { public_metadata: active.membership.public_metadata ?? {} };
  }
  return scope;
}

/** One operand of a shortcode: a path into the scope, or a literal ("Only strings, booleans and numbers are permitted as
 *  literal operands"; "String literals should use single quotes"). A path the scope does not hold is null. */
function operand(scope: Row, raw: string): unknown {
  const t = raw.trim();
  if (/^'.*'$/.test(t)) return t.slice(1, -1);
  if (t === 'true' || t === 'false') return t === 'true';
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  let node: unknown = scope;
  for (const key of t.split('.')) {
    if (!node || typeof node !== 'object' || Array.isArray(node) || !(key in (node as Row))) return null;
    node = (node as Row)[key];
  }
  return node === undefined ? null : node;
}

/** A shortcode's value: the first operand that is not null or false, else the last ("Conditional expressions"). */
function evaluate(scope: Row, expression: string): unknown {
  const operands = expression.split('||');
  for (const [i, o] of operands.entries()) {
    const v = operand(scope, o);
    if ((v !== null && v !== false) || i === operands.length - 1) return v;
  }
}

/** A template's claims with its shortcodes filled: a claim that is one shortcode takes its value's own type; shortcodes
 *  inside a longer string are interpolated as text ("Interpolated shortcodes will always result to string values"). */
export function fillClaims(value: unknown, scope: Row): unknown {
  if (typeof value === 'string') {
    const whole = /^\{\{([^{}]*)\}\}$/.exec(value.trim());
    if (whole) return evaluate(scope, whole[1]!);
    return value.includes('{{') ? value.replace(/\{\{([^{}]*)\}\}/g, (_m, e: string) => { const v = evaluate(scope, e); return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v); }) : value;
  }
  if (Array.isArray(value)) return value.map((v) => fillClaims(v, scope));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Row).map(([k, v]) => [k, fillClaims(v, scope)]));
  return value;
}

/** A token from a JWT template (a raw row: its own signing key is bookkeeping): its claims filled, then the default claims
 *  of a custom JWT, which "cannot be overridden by templates" (`azp`, `exp`, `iat`, `iss`, `jti`, `nbf`, `sub`) and not
 *  `sid` ("session-tied claims like `sid`, `v`, `pla`, or `fea` cannot be included in custom JWTs"). `exp` is now plus the
 *  template's lifetime (or the call's `expires_in_seconds`), `nbf` now less its allowed clock skew. */
export function templateToken(ctx: WriteHookContext, session: Row, template: Row, opts: { origin?: string; lifetime?: number } = {}): string {
  const iat = Math.floor(ms(ctx) / 1000);
  const lifetime = opts.lifetime ?? (typeof template.lifetime === 'number' ? template.lifetime : DEFAULT_LIFETIME);
  const skew = typeof template.allowed_clock_skew === 'number' ? template.allowed_clock_skew : DEFAULT_SKEW;
  const filled = fillClaims(template.claims ?? {}, shortcodeScope(ctx, session)) as Row;
  const { sid: _sid, v: _v, pla: _pla, fea: _fea, ...custom } = filled;
  const claims: Row = {
    ...custom, ...(opts.origin ? { azp: opts.origin } : {}),
    iss: issuerOf(ctx), jti: jti(`${String(session.id)}:${ctx.occurredAt}:${String(template.name)}`), nbf: iat - skew, sub: String(session.user_id),
  };
  // a template with its own key signs with it, in its own algorithm ("The custom signing private key to use when minting
  // JWTs", spec: CreateJWTTemplate); settings() admits only the algorithms the twin signs
  if (template.custom_signing_key === true && typeof template._signing_key === 'string') {
    const alg = String(template.signing_algorithm) as SigningKey['alg'];
    const key: SigningKey = alg.startsWith('HS') ? { alg: alg as 'HS256', secret: template._signing_key } : { alg: alg as 'RS256', privatePem: template._signing_key };
    return jwtSign(claims, key, { now: iat, expiresInSeconds: lifetime });
  }
  return signJwt(ctx, claims, { now: iat, expiresInSeconds: lifetime });
}

// ── webhooks: the events Clerk reports, declared for the kernel, which signs (Svix) and delivers them ──


/** The instance's id, as every event names it (`instance_id`): the World's one instance (INSTANCE_SUBJECT). */
export const CLERK_INSTANCE_ID = INSTANCE_SUBJECT;


/** The webhooks Clerk sends for its writes, as the kernel delivers them (the manifest's `events`): each write's event
 *  type as @clerk/backend's `WebhookEventType` names it (dist/api/resources/Webhooks.d.ts; a write Clerk reports with
 *  no event, a sign-in's bookkeeping or a client, is not named), the event as Clerk sends it (`timestamp` in
 *  milliseconds, `instance_id`, `event_attributes.http_request`), Svix-signed, to the endpoints the Webhooks page's door
 *  keeps, each delivery kept as `_webhook_message`.
 *  source: https://clerk.com/docs/webhooks/overview "Clerk uses Svix to send our webhooks" */
export const CLERK_EVENTS: EventsDecl = {
  // Svix's headers (`svix-id`, `svix-timestamp`, `svix-signature`) and its `whsec_` secrets
  scheme: { kind: 'webhook-id', prefix: 'svix', secretPrefix: 'whsec_' },
  types: { 'user.delete': 'user.deleted' },
  envelope: {
    data: '$data', event_attributes: { http_request: { client_ip: '$request.client_ip', user_agent: '$request.user_agent' } },
    instance_id: CLERK_INSTANCE_ID, object: 'event', timestamp: '$time.ms', type: '$type',
  },
  endpoints: { storedAs: 'webhook_endpoint', url: 'url', secret: 'signing_secret', filter: 'filter_types', disabled: 'disabled' },
  record: '_webhook_message',
};

/** An event's `data`, as @clerk/backend types each event (dist/api/resources/Webhooks.d.ts): a deleted user or
 *  organization is a `DeletedObjectJSON` (`{ object, id, slug?, deleted }`); every other event, a membership's, a role's
 *  and a permission's deletions included, carries the object as its operation answers it: a membership with its
 *  `organization`, `permissions` and `public_user_data` (`OrganizationMembershipJSON`), an invitation with its role's
 *  name, a role with its `permissions` (`RoleJSON`), a permission with its `type`. The views read the tree as the write
 *  left it (`ctx`, the root's context over the write). */
export function eventData(_ctx: WriteHookContext, write: EventWrite): Row {
  const body = write.body;
  return { object: 'user', id: body.id, deleted: true, ...(typeof body.external_id === 'string' ? { external_id: body.external_id } : {}) };
}

/** CreateOrganization and UpdateOrganization: a name may not contain URLs or HTML, and is at most 256 characters. */
// source: spec:CreateOrganization "May not contain URLs or HTML."
// source: spec:CreateOrganization "Max length: 256"
// source: https://clerk.com/docs/guides/development/errors/backend-api "invalid organization name"
export function organizationNameRefusal(name: string): Response | undefined {
  const reason = name.length > 256 ? 'Max length: 256' : /(?:https?:\/\/|www\.|<[^>]*>)/i.test(name) ? 'May not contain URLs or HTML.' : undefined;
  return reason ? clerkError(422, 'form_param_value_invalid', 'invalid organization name', `The organization name ${JSON.stringify(name)} is invalid: ${reason}`, { param_name: 'name' }) : undefined;
}
