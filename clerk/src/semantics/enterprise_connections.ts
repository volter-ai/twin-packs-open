import { BACKEND_GAP } from './shared.ts';
// Enterprise connections, the `/enterprise_connections` family: what Clerk's SAML Connections API gave way to ("Deprecated:
// Use the Enterprise Connections API instead", spec: CreateSAMLConnection). A SAML enterprise connection keeps its SAML
// side as a SAML connection naming it (`enterprise_connection_id`, spec:/components/schemas/SAMLConnection), answered
// inside it as `saml_connection`; an OIDC one keeps its client's settings, answered as `oauth_config`. Clerk's refusals
// are those of https://clerk.com/docs/guides/development/errors/backend-api (ERRORS), by code.
import type { HandlerContext } from '@volter/world-core';
import { activationError, body, clerkError, createSamlConnection, fromIdpMetadata, invalid, missing, ms, notFound, organizationOf, own } from './shared.ts';

type Row = Record<string, unknown>;
const SAML_PROVIDERS = ['saml_custom', 'saml_okta', 'saml_google', 'saml_microsoft'];
const OIDC_PROVIDERS = ['oidc_custom', 'oidc_github_enterprise', 'oidc_gitlab'];
// spec: CreateEnterpriseConnection's and UpdateEnterpriseConnection's `saml` object, the settings it sets
const SAML_SETTABLE = ['idp_entity_id', 'idp_sso_url', 'idp_certificate', 'idp_metadata_url', 'idp_metadata', 'attribute_mapping', 'allow_subdomains', 'allow_idp_initiated', 'force_authn', 'login_hint'];
const SETTABLE = ['name', 'organization_id', 'allow_organization_account_linking', 'sync_user_attributes', 'disable_additional_identifications', 'custom_attributes'];

const connectionOfPath = (ctx: HandlerContext): Row | undefined => ctx.row('EnterpriseConnection', String(ctx.call.params.enterprise_connection_id));
const pick = (b: unknown, keys: string[]): Row => Object.fromEntries(keys.filter((k) => (b as Row | null | undefined)?.[k] !== undefined).map((k) => [k, (b as Row)[k]]));

/** "Domains associated with the enterprise connection (required; at least one). Values are normalized to lowercase.
 *  Each domain must be a valid fully qualified domain name." (spec: CreateEnterpriseConnection) */
function domainsOf(value: unknown): string[] | Response | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((d) => typeof d !== 'string' || !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(d))) return invalid('domains', 'Each domain must be a valid fully qualified domain name.');
  return value.map((d) => String(d).toLowerCase());
}

/** The connection as Clerk answers it (spec:/components/schemas/EnterpriseConnection): its SAML side from the SAML
 *  connection it keeps (never its certificate), its OIDC client without the secret. */
function view(ctx: HandlerContext, row: Row): Row {
  const saml = typeof row._saml_connection_id === 'string' ? ctx.row('SAMLConnection', row._saml_connection_id) : undefined;
  return {
    ...own(ctx, row), object: 'enterprise_connection',
    saml_connection: saml ? {
      id: saml.id, name: saml.name, idp_entity_id: saml.idp_entity_id ?? null, idp_sso_url: saml.idp_sso_url ?? null, idp_metadata_url: saml.idp_metadata_url ?? null,
      acs_url: saml.acs_url, sp_entity_id: saml.sp_entity_id, sp_metadata_url: saml.sp_metadata_url, active: saml.active === true,
      allow_idp_initiated: saml.allow_idp_initiated === true, allow_subdomains: saml.allow_subdomains === true, force_authn: saml.force_authn === true, login_hint: saml.login_hint ?? { mode: 'off' },
    } : null,
    oauth_config: null,
  };
}

/** An organization a call links the connection to must exist (ERRORS: OrganizationNotFound, 404), and hold no other
 *  connection (ERRORS: OrganizationAlreadyHasSSOConnection, 422 `organization_already_has_sso_connection`). */
// source: https://clerk.com/docs/guides/development/errors/backend-api "This organization already has an SSO connection."
function organizationError(ctx: HandlerContext, id: unknown, self?: unknown): Response | undefined {
  if (typeof id !== 'string' || !id) return undefined;
  const org = organizationOf(ctx, id);
  if (!org) return clerkError(404, 'resource_not_found', 'not found', 'Given organization not found.');
  const held = ctx.rowsRaw('EnterpriseConnection').some((c) => c.organization_id === org.id && c.id !== self);
  return held ? clerkError(422, 'organization_already_has_sso_connection', 'this organization already has an SSO connection', 'This organization already has an SSO connection.') : undefined;
}

/** `POST /enterprise_connections`: "Create a new enterprise connection." Its name, provider and domains are required; a
 *  SAML provider's `saml` object sets its IdP ("Use this to set IdP configuration … at creation time"), an OIDC
 *  provider's `oidc` object its client. `active` true "IdP metadata must be provided via the `saml` object"
 *  (SAMLConnectionCantBeActivated otherwise). */
// source: spec:CreateEnterpriseConnection "When true, IdP metadata must be provided via the"
export async function CreateEnterpriseConnection(ctx: HandlerContext): Promise<Response> {
  const b = body(ctx);
  if (typeof b.name !== 'string' || !b.name) return missing('name');
  if (typeof b.provider !== 'string' || !b.provider) return missing('provider');
  // OIDC is a separate connection flow no demanded caller or life uses.
  if (OIDC_PROVIDERS.includes(b.provider)) return ctx.refuse(BACKEND_GAP);
  if (!SAML_PROVIDERS.includes(b.provider)) return clerkError(422, 'form_param_value_invalid', 'is invalid', `${b.provider} does not match one of the allowed values for parameter provider`, { param_name: 'provider' });
  const domains = domainsOf(b.domains);
  if (domains instanceof Response) return domains;
  if (!domains?.length) return missing('domains');
  const orgMissing = organizationError(ctx, b.organization_id);
  if (orgMissing) return orgMissing;
  const id = ctx.mint('EnterpriseConnection');
  const at = ms(ctx);
  const saml = SAML_PROVIDERS.includes(b.provider);
  const samlSettings = saml ? await fromIdpMetadata(ctx, pick(b.saml, SAML_SETTABLE)) : {};
  if (samlSettings instanceof Response) return samlSettings;
  if (saml && b.active === true) { const refused = activationError(samlSettings); if (refused) return refused; }
  const samlId = saml ? await createSamlConnection(ctx, { name: b.name, provider: b.provider, domains, settings: { ...samlSettings, ...(typeof b.organization_id === 'string' ? { organization_id: b.organization_id } : {}), active: b.active === true }, enterpriseConnectionId: id }) : undefined;
  await ctx.write('EnterpriseConnection', id, {
    object: 'enterprise_connection', name: b.name, provider: b.provider, logo_public_url: null, active: b.active === true, domains,
    organization_id: typeof b.organization_id === 'string' ? b.organization_id : null, sync_user_attributes: true, disable_additional_identifications: false,
    allow_organization_account_linking: b.allow_organization_account_linking === true, custom_attributes: Array.isArray(b.custom_attributes) ? b.custom_attributes : [],
    ...(samlId ? { _saml_connection_id: samlId } : {}), created_at: at, updated_at: at,
  }, 'enterprise_connection.create');
  // spec: CreateEnterpriseConnection answers 201
  return ctx.reply(view(ctx, ctx.row('EnterpriseConnection', id)!), 201);
}

/** `PATCH /enterprise_connections/{id}`: its settings, domains ("Empty array means ignored (no change); non-empty array
 *  means set domains to the given list"), its SAML side, and `active`, which a SAML connection takes only with
 *  its IdP's settings. */
// source: spec:UpdateEnterpriseConnection "Empty array means ignored (no change); non-empty array means set domains to the given list (replaces existing)."
export async function UpdateEnterpriseConnection(ctx: HandlerContext): Promise<Response> {
  const row = connectionOfPath(ctx);
  if (!row) return notFound();
  const b = body(ctx);
  const domains = domainsOf(b.domains);
  if (domains instanceof Response) return domains;
  const orgMissing = organizationError(ctx, b.organization_id, row.id);
  if (orgMissing) return orgMissing;
  const patch: Row = { ...pick(b, SETTABLE), ...(domains?.length ? { domains } : {}), updated_at: ms(ctx) };
  const samlId = typeof row._saml_connection_id === 'string' ? row._saml_connection_id : undefined;
  if (samlId) {
    const current = ctx.row('SAMLConnection', samlId) ?? {};
    const metadata = await fromIdpMetadata(ctx, pick(b.saml, SAML_SETTABLE));
    if (metadata instanceof Response) return metadata;
    const samlPatch: Row = { ...metadata, ...(typeof (b.saml as Row | undefined)?.name === 'string' ? { name: (b.saml as Row).name } : {}), ...(domains?.length ? { domains, domain: domains[0] } : {}), ...pick(b, ['organization_id', 'sync_user_attributes', 'disable_additional_identifications', 'allow_organization_account_linking']) };
    if (typeof b.active === 'boolean') {
      if (b.active) { const refused = activationError({ ...current, ...samlPatch }); if (refused) return refused; }
      samlPatch.active = b.active;
    }
    await ctx.write('SAMLConnection', samlId, { ...samlPatch, updated_at: ms(ctx) }, 'saml_connection.update');
  }
  if (typeof b.active === 'boolean') patch.active = b.active;
  await ctx.write('EnterpriseConnection', String(row.id), patch, 'enterprise_connection.update');
  return ctx.reply(view(ctx, ctx.row('EnterpriseConnection', String(row.id))!));
}

export async function GetEnterpriseConnection(ctx: HandlerContext): Promise<Response> {
  const row = connectionOfPath(ctx);
  return row ? ctx.reply(view(ctx, row)) : notFound();
}
