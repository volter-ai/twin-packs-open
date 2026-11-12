// Volter Identity's manifest: the vendor facts its spec does not carry (architecture, "Protocol 3", in twin-world). The
// surface is generated (./generated/surface.gen.json) from ../spec: better-auth 1.7.5's schema for identity's plugins,
// its product API and its discovery routes, grouped by tag.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';


export const manifest: DerivedManifest = {
  vendor: 'volteridentity',
  service: 'volteridentity',
  // source: spec:adminCreateClient "A product registered by the operator"
  // source: spec:adminLinkClientResource "A registered product linked to the resource its access tokens are for (RFC 8707)"
  // source: spec:adminCreateResource "A product's API that access tokens may name as their audience (RFC 8707)"
  accountSetup: [
    { operation: 'adminCreateClient', why: 'The signed-in identity-service operator registers a product client on the vendor admin console; this sets up the account the product uses.' },
    { operation: 'adminLinkClientResource', why: 'The signed-in identity-service operator links a registered product to its resource on the vendor admin console; this configures the account before product use.' },
    { operation: 'adminCreateResource', why: 'The signed-in identity-service operator registers an API resource on the vendor admin console; this is an operator setting, not a product mutation to deploy.' },
  ],
  body: { json: 'always' },
  gap: { status: 404, message: 'not found' },
  unmodeled: [
  "authorizationServerMetadata",
  "get_api_auth_account_info",
  "post_api_auth_callback_id",
  "changeEmail",
  "changePassword",
  "deleteUser",
  "get_api_auth_delete_user_callback",
  "post_api_auth_device_deny",
  "post_api_auth_device_token",
  "changeEmailWithEmailOTP",
  "verifyEmailWithOTP",
  "requestEmailChangeWithEmailOTP",
  "requestPasswordResetWithEmailOTP",
  "resetPasswordWithEmailOTP",
  "sendEmailVerificationOTP",
  "post_api_auth_email_otp_verify_email",
  "get_api_auth_error",
  "forgetPasswordWithEmailOTP",
  "post_api_auth_get_access_token",
  "getSession",
  "getSessionPost",
  "linkSocialAccount",
  "listUserAccounts",
  "listUserSessions",
  "post_api_auth_oauth2_authorize",
  "post_api_auth_oauth2_client_rotate_secret",
  "post_api_auth_oauth2_consent",
  "post_api_auth_oauth2_continue",
  "post_api_auth_oauth2_create_client",
  "post_api_auth_oauth2_delete_client",
  "post_api_auth_oauth2_delete_consent",
  "get_api_auth_oauth2_end_session",
  "post_api_auth_oauth2_end_session",
  "post_api_auth_oauth2_end_session_confirm",
  "get_api_auth_oauth2_get_client",
  "get_api_auth_oauth2_get_clients",
  "get_api_auth_oauth2_get_consent",
  "get_api_auth_oauth2_get_consents",
  "post_api_auth_oauth2_introspect",
  "get_api_auth_oauth2_public_client",
  "post_api_auth_oauth2_public_client_prelogin",
  "post_api_auth_oauth2_register",
  "post_api_auth_oauth2_revoke",
  "post_api_auth_oauth2_update_client",
  "post_api_auth_oauth2_update_consent",
  "post_api_auth_oauth2_userinfo",
  "get_api_auth_ok",
  "post_api_auth_organization_accept_invitation",
  "post_api_auth_organization_cancel_invitation",
  "post_api_auth_organization_check_slug",
  "post_api_auth_organization_create",
  "post_api_auth_organization_delete",
  "get_api_auth_organization_get_active_member",
  "get_api_auth_organization_get_active_member_role",
  "getFullOrganization",
  "get_api_auth_organization_get_invitation",
  "getOrganization",
  "post_api_auth_organization_has_permission",
  "createOrganizationInvitation",
  "post_api_auth_organization_leave",
  "get_api_auth_organization_list",
  "get_api_auth_organization_list_invitations",
  "get_api_auth_organization_list_members",
  "get_api_auth_organization_list_user_invitations",
  "post_api_auth_organization_reject_invitation",
  "post_api_auth_organization_remove_member",
  "setActiveOrganization",
  "post_api_auth_organization_update",
  "updateOrganizationMemberRole",
  "post_api_auth_passkey_delete_passkey",
  "passkeyGenerateAuthenticateOptions",
  "generatePasskeyRegistrationOptions",
  "get_api_auth_passkey_list_user_passkeys",
  "post_api_auth_passkey_update_passkey",
  "passkeyVerifyAuthentication",
  "passkeyVerifyRegistration",
  "post_api_auth_refresh_token",
  "requestPasswordReset",
  "resetPassword",
  "resetPasswordCallback",
  "post_api_auth_revoke_other_sessions",
  "post_api_auth_revoke_session",
  "post_api_auth_revoke_sessions",
  "sendVerificationEmail",
  "signInEmail",
  "signInWithEmailOTP",
  "signOut",
  "signUpWithEmailAndPassword",
  "getJSONWebToken",
  "post_api_auth_unlink_account",
  "updateSession",
  "updateUser",
  "get_api_auth_verify_email",
  "verifyPassword"
],
  ids: { template: '{uuid}' },
  time: 'iso',
  // worker/src/product.ts: `refused(status, message)` answers `{ error: message }`; Better Auth answers its errors alike
  error: { error: '{message}' },
  readOnly: { status: 403, message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, message: 'not found' },
  // required by the type; nothing the service answers is paged
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 20, max: 100 } },
  deleted: {},
  // every served operation is a handler (journeys/decisions.json): the provider's routes, the device grant and its
  // approval, the social sign-in, the product API and discovery; Better Auth's session, email-code, passkey and
  // organization-plugin routes are the gap (the sign-in page stands in)
  // Volter Identity's hosted pages (screens/login.ts): the log-in a sign-in opens (with its social sign-in), and the page
  // where a device's code is entered
  screens: [{
    id: 'login', kind: 'flow', host: 'id.volter.ai', path: '/login',
    demand: 'every sign-in to a product that uses Volter Identity passes this page', status: 'done',
    controls: ['Continue with GitHub', 'Continue with Google', 'Continue as'], source: 'https://id.volter.ai/login',
  }, {
    id: 'device', kind: 'flow', host: 'id.volter.ai', path: '/device',
    demand: 'a command line signs in by a code a person enters here', status: 'done',
    controls: ['Code', 'Continue'], source: 'https://id.volter.ai/device',
  }, {
    id: 'error', kind: 'flow', host: 'id.volter.ai', path: '/error',
    demand: 'a sign-in that fails (a provider naming no verified email, a refused grant) lands here, saying why', status: 'done',
    source: 'https://id.volter.ai/error',
  }],
  // the World's doors (./semantics/doors.ts): what the service's operators and sign-up do outside its API
  doors: [
    // source: recording:auth-source.txt "baseURL: issuer,"
    { id: 'settings', method: 'POST', path: '/_twin/settings', note: "the service's permanent ISSUER binding, configured before OAuth account setup; defaults to its declared id.volter.ai host" },
    { id: 'users', method: 'POST', path: '/_twin/users', note: 'an existing emailed-code or passkey identity; social identities use the provider callback' },
    { id: 'sharedClient', method: 'POST', path: '/_twin/shared-client', note: "@volter/identity's shared public client under the id the package publishes (SHARED_CLIENTS); the operator's API (/admin/clients) mints a client's id" },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the service's admin token (IDENTITY_ADMIN_TOKEN), the operator's setting that no API reads, as the World holds it at every boot" },
    { id: 'social', method: 'POST', path: '/_twin/social', note: "the service's OAuth app at the provider (GITHUB_CLIENT_ID, GOOGLE_CLIENT_ID and their secrets), or the iOS apps Apple signs in (APPLE_APP_IDS)" },
  ],
  // GET /twin: what the twin is of and what it keeps
  discovery: {
    twinOf: "Volter Identity (id.volter.ai): the operator's product registration (/admin/clients, resources and their links), its OpenID Connect provider (discovery, authorize with the sign-in page, tokens by code with PKCE, refresh, client credentials and the device code, userinfo, JWKS), the device code's claim and approval, Sign in with Apple by its ID token, the sign-in and device pages, and a product's organizations API, as Volter's products call them (journeys/demand.json)",
    stores: "the World's people, registered product clients, sessions, codes and refresh tokens (by their SHA-256), organizations, members and invitations",
  },
  resources: {
    // source: spec:productPersonById "A Volter identity by its id"
    user: { idPrefix: '', ids: '{letters:32}', refresh: { get: 'productPersonById', known: true } },
    account: { idPrefix: '', ids: '{letters:32}', refresh: { none: 'The product API exposes linked-account claims, never lists the underlying provider accounts.' } },
    oauth_client: { idAs: 'client_id', idPrefix: '', ids: '{letters:32}', refresh: { none: 'The served operator API creates and links clients; it supplies no client list or get.' } },
    _device_code: { ...states._device_code, idPrefix: '' },
    _refresh_token: { ...states._refresh_token, idPrefix: '' },
    _serial: { idPrefix: '', ids: '{n}' },
    // The product has no global enumeration: read known organizations, then lists under the observed parents.
    // source: spec:productGetOrganization "An organization of this product by id or slug"
    organization: { idPrefix: '', ids: '{hex:32}', refresh: { get: 'productGetOrganization', known: true } },
    // source: recording:product-source.txt "return json(rows.results);"
    member: { ...states.member, idPrefix: '', ids: '{hex:32}',
      parent: { resource: 'organization', field: 'organizationId', param: 'ref' },
      refresh: { list: 'productListMembers', unpaginated: true, items: '$body' } },
    // The vendor's invitation list excludes expired and accepted invitations; absence cannot prove deletion.
    // source: recording:product-source.txt "status = 'pending' and expiresAt > ?"
    invitation: { ...states.invitation, idPrefix: '', ids: '{hex:32}',
      parent: { resource: 'organization', field: 'organizationId', param: 'ref' },
      refresh: { list: 'productListInvitations', unpaginated: true, items: '$body', complete: false } },
  },
  // identity sets no rateLimit of its own (worker/src/auth.ts), so Better Auth's production default holds on /api/auth/*
  // source: https://www.better-auth.com/docs/concepts/rate-limit "By default, in production mode, the rate limiter is set to"
  // source: https://www.better-auth.com/docs/concepts/rate-limit "Window: 10 seconds"
  // source: https://www.better-auth.com/docs/concepts/rate-limit "Max Requests: 100 requests"
  rateBudget: {
    reason: 'Conservative fallback: Better Auth documents a route-specific 100 requests per ten seconds; the pack uses 30 requests per minute across the service.',
    windowMs: 60_000, ceiling: 30, defaultWeight: 1, maxRetryAfterSeconds: 60,
  },
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest)
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-volteridentity',
    resources: ['user', 'account', 'oauth_client', 'organization', 'member', 'invitation'],
    specSource: 'spec/openapi.json: better-auth 1.7.5\'s generated schema for identity\'s plugins, the product API and discovery routes of volter-ai/identity daa98e9 (spec/SOURCE.md)',
    description: 'Volter Identity twin — the OpenID Connect provider of id.volter.ai (authorize with its sign-in page, tokens by code with PKCE, refresh, client credentials and the device code, userinfo, JWKS), the device page, and a product\'s organizations API, as Volter\'s products call them.',
    adoption: { sdks: ['@volter/identity'], envStems: ['VOLTER_ISSUER', 'VOLTER_CLIENT'] },
    hosts: [{ host: 'id.volter.ai' }],
    // Account setup obtains the operator setting through its declared door. The root credential is the product's
    // organizations client-credentials token; the operator admin token is not the descriptor's root credential door.
    endpointEnv: { name: 'VOLTER_ISSUER', note: 'A product names its identity service by VOLTER_ISSUER (twin-world apps/platform/src/identity.ts).' },
  },
};
