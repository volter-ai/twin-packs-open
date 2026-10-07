// Clerk's manifest: the vendor facts its published spec does not carry (docs/contributing/architecture.md, "What an author
// writes, and how"). The surface is generated (./generated/surface.gen.json, from ../spec by scripts/derive-pack.ts): the
// Backend API's OpenAPI document, 252 operations under https://api.clerk.com/v1. The Frontend API (what clerk-js calls on
// an instance's own host) is the lane ../fapi, over the same state. The state machines are ./semantics/states.ts.
//
// WHAT IS MODELLED is what the customer life asks for (../journeys/customer-life.outline.md) and what applications call
// (../journeys/demand.json): users (made, updated, their metadata, deleted), an instance's organization settings,
// permissions and roles, organizations with their memberships and invitations, sessions and their tokens, JWT templates,
// SAML and enterprise connections, sign-in tokens and the instance's public keys. Every other operation answers the gap: an operation of
// a declared resource listed in `unmodeled`, and every operation of a resource the manifest does not declare.
//
// THE STATE, stored in Clerk's own response shapes: users (`User`, a password only as its digest), sessions (`Session`),
// organizations (`Organization`), memberships (`OrganizationMembership`: a subject per organization and user, naming
// both), invitations (`OrganizationInvitation`, its ticket kept as `_ticket`), custom permissions and roles (`Permission`,
// `Role`: a role keeps its permissions by id, `_permission_ids`), JWT templates (`JWTTemplate`, a template's own signing
// key kept as `_signing_key`), SAML connections (`SAMLConnection`) and organization settings (`OrganizationSettings`); bookkeeping
// under `_` types: the Dashboard instance configuration (`_instance`), the instance's secret keys (`_secret_key`, by SHA-256), the emails Clerk sends (`_email`) and the
// webhook messages Svix delivered (`_webhook_message`).
//
// EVENTS: the writes Clerk reports to the instance's webhook endpoints (`events`: ./semantics/shared.ts `CLERK_EVENTS`,
// rendered by ./semantics/events.ts), which the kernel signs (Svix) and delivers.
import type { DerivedManifest } from '@volter/world-core';
import { data } from './semantics/events.ts';
import { BACKEND_GAP, CLERK_EVENTS } from './semantics/shared.ts';
import { states } from './semantics/states.ts';

// a list ordered by a field it does not take (https://clerk.com/docs/guides/development/errors/backend-api, 422
// form_param_format_invalid)
const ORDER_BY_INVALID = { status: 422, code: 'form_param_format_invalid', kind: 'is invalid', param: 'order_by', message: 'order_by must be one of {fields}, each with an optional + or - prefix.' };

export const manifest: DerivedManifest = {
  vendor: 'clerk',
  service: 'clerk',
  body: {},
  // Clerk's ids are a type prefix and an opaque suffix (`user_…`, `org_…`, `orginv_…`: the spec's examples)
  // Clerk's ids are a type prefix and a KSUID (`user_2…`, 27 characters: the spec's ^ins_\w{27}$)
  ids: { template: '{prefix}_{ksuid}' },
  time: 'unix-ms',
  // Clerk's error body (spec:/components/schemas/ClerkErrors): a short `message`, a `long_message` and a `code`, and the
  // request's trace id beside them (../spec/recordings/2026-09-28-unauthenticated.json). The short message rides the
  // template's `{kind}`, the long one its `{message}`: Clerk's two differ ("Invalid Authorization header format" and
  // "Invalid Authorization header format. Must be 'Bearer <YOUR_API_KEY>'"). The trace id is Clerk's form, 32 lowercase hex
  // digits (fresh per request at Clerk; one fixed id in a World, ./semantics/shared.ts CLERK_TRACE_ID).
  // source: recording:2026-09-28-unauthenticated.json "de1b36d5dd1a8c275a8b23e0d675a817"
  error: { errors: [{ message: '{kind}', long_message: '{message}', code: '{code}', meta: { param_name: '{param}' } }], clerk_trace_id: 'f0e1d2c3b4a5968778695a4b3c2d1e0f' },
  // an error names the parameter it refuses (`meta.param_name`), and names none when it refuses none
  errorOmitsAbsent: true,
  // the short message of Clerk's parameter refusals (form_param_*: "is invalid",
  // https://clerk.com/docs/guides/development/errors/backend-api)
  defaultKind: 'is invalid',
  readOnly: { status: 403, code: 'read_only', kind: 'read only', message: 'This twin was started read-only; writes are refused.' },
  // https://clerk.com/docs/guides/development/errors/backend-api: InvalidJSONRequestBody, 400 request_body_invalid,
  // "Request body invalid" both short and long
  malformedBody: { status: 400, code: 'request_body_invalid', kind: 'Request body invalid', message: 'Request body invalid' },
  // https://clerk.com/docs/guides/development/errors/backend-api: ResourceNotFound, 404 resource_not_found, "not found",
  // "Resource not found"
  notFound: { status: 404, code: 'resource_not_found', kind: 'not found', message: 'Resource not found' },
  // Authenticated unknown routes use the ResourceNotFound envelope as a twin choice where documentation stops;
  // journeys/decisions.json records that choice. The retained unauthenticated route answers 401 before this gap.
  gap: BACKEND_GAP,
  // every JSON answer labelled exactly `application/json`, as Clerk labels it: @clerk/backend reads a body as JSON only on
  // that exact value (dist/index.js, `res.headers.get(ContentType) === ContentTypes.Json`)
  jsonContentType: 'application/json',
  // every answer carries its trace id (the recordings' `x-clerk-trace-id`)
  answerHeaders: { 'x-clerk-trace-id': 'f0e1d2c3b4a5968778695a4b3c2d1e0f' },
  // a browser's: the origin echoed with its credentials, and the Authorization header a native client reads its client
  // token from exposed
  cors: { origin: 'echo', credentials: true, methods: 'GET, POST, PUT, PATCH, DELETE, OPTIONS', headers: 'authorization, content-type', expose: 'authorization' },
  discovery: {
    twinOf: 'the Clerk Backend API (api.clerk.com) and an instance\'s Frontend API, with the clerk-js bundle the instance serves and Clerk\'s image host',
    stores: 'users, sessions, organizations with their roles, permissions and invitations, JWT templates, SAML and enterprise connections, the instance\'s settings and keys, and every email and webhook message sent',
    identity: 'Send `Authorization: Bearer <secret key>` to the Backend API: the application\'s, issued by POST /_twin/app-credentials, or one a POST /_twin/secret-keys made; the Frontend API is reached with the browser\'s client, as clerk-js reaches it.',
  },
  // the World's doors (./semantics/doors.ts), standing in for the Dashboard's pages and for the inboxes of the people Clerk
  // writes to
  doors: [
    { id: 'emails', method: 'GET', path: '/_twin/emails', note: 'what Clerk emailed an address (?to=), oldest first' },
    { id: 'webhookMessages', method: 'GET', path: '/_twin/webhook-messages', note: 'what Svix delivered (?type=), oldest first' },
    { id: 'secretKeys', method: 'POST', path: '/_twin/secret-keys', note: 'a secret key, as the API Keys page shows it once' },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: 'the keys the World\'s application holds (secret, publishable, JWT verification key, webhook secret), as the runtime issues them at every boot' },
    { id: 'webhookEndpoints', method: 'POST', path: '/_twin/webhook-endpoints', note: 'an endpoint and the signing secret the Webhooks page shows' },
    { id: 'nativeApplications', method: 'POST', path: '/_twin/native-applications', note: 'an app on the Native applications page' },
    { id: 'instance', method: 'POST', path: '/_twin/instance', note: "the instance's settings (User & authentication, Domains, Organizations Settings, SSO connections, Native API)" },
  ],
  // the Frontend API (../fapi): an instance's own host, and on the twin's own address a request that brings no Backend API
  // secret key, but a path only the Backend API has (which refuses it for want of a key) and the image host
  lanes: {
    routes: [
      { lane: 'fapi', host: '\\.clerk\\.accounts\\.dev$' },
      // source: https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi "must be forwarded to https://frontend-api.clerk.dev/* with the body and all headers intact."
      { lane: 'fapi', host: '^frontend-api\\.clerk\\.dev$' },
      // source: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth "for a production environment."
      { lane: 'fapi', host: '^clerk\\.(?:[a-z0-9-]+\\.)+[a-z0-9-]+$' },
      { lane: 'fapi', exceptHosts: ['api.clerk.com', 'img.clerk.com'], header: { name: 'authorization', prefix: 'Bearer sk_', absent: true }, unlessOnlyRoot: true },
    ],
  },
  // offset paging (spec:/components/parameters/LimitParameter, OffsetParameter): `limit` 1–500, default 10
  list: { style: 'envelope', envelope: { data: '{data}', total_count: '{total_count}' }, limit: { param: 'limit', default: 10, max: 500 }, offset: { param: 'offset' } },
  deleted: { object: '{object}', id: '{id}', deleted: true },
  // recorded 2026-09-28 (../spec/recordings/2026-09-28-unauthenticated.json): the live API answers these before any path.
  // Every request needs a key: none is `authorization_header_format_invalid`, and a key the instance does not hold is
  // `clerk_key_invalid`, whatever its shape, so ../src/fetch.ts runs this gate before dispatch. The instance holds the
  // World's key and the keys its API Keys page made, each kept by its SHA-256.
  auth: {
    header: 'authorization',
    scheme: 'Bearer',
    gateWhenAbsent: true,
    missing: { status: 401, code: 'authorization_header_format_invalid', kind: 'Invalid Authorization header format', message: "Invalid Authorization header format. Must be 'Bearer <YOUR_API_KEY>'" },
    invalidKeys: [],
    keyFormat: '^sk_(test|live)_',
    invalid: { status: 401, code: 'clerk_key_invalid', kind: 'The provided Clerk Secret Key is invalid. Make sure that your Clerk Secret Key is correct.', message: 'The provided Clerk Secret Key is invalid. Make sure that your Clerk Secret Key is correct.' },
    held: { storedAs: '_secret_key', hashField: 'sha256', standing: [] },
    // the key is checked before anything, a path the API does not have included
    beforeRouting: true,
  },
  // "Clerk-API-Version header: Include a `Clerk-API-Version` header"; an invalid one is "an invalid request"
  // (https://clerk.com/docs/guides/development/upgrading/versioning): InvalidAPIVersion, 400 `api_version_invalid`,
  // "Invalid Clerk API version: <reason>" (https://clerk.com/docs/guides/development/errors/backend-api)
  // (the versions Clerk has, the versioning page's "## API versions"; the query form and both at once: ../src/fetch.ts)
  version: { header: 'clerk-api-version', pattern: '^(2021-02-05|2024-10-01|2025-04-10|2025-11-10|2026-05-12)$', error: { status: 400, code: 'api_version_invalid', kind: 'invalid API version', message: 'Invalid Clerk API version: {value}' } },
  // Clerk reports its writes to the instance's webhook endpoints, Svix-signed
  events: { ...CLERK_EVENTS, render: data },
  // The same Svix-signed user.deleted envelope the instance delivers; the deleted object's id is data.id.
  // This declares that event only, not unimplemented user lifecycle events.
  ingest: {
    scheme: { kind: 'webhook-id', prefix: 'svix', secretPrefix: 'whsec_' },
    type: { body: 'type' }, object: 'data',
    types: { 'user.deleted': { resource: 'User', deleted: true } },
  },
  unmodeled: ['CreateSAMLConnection', 'ListSAMLConnections', 'DeleteSAMLConnection', 'DeleteOrganizationPermission', 'DeleteOrganizationRole', 'RemovePermissionFromOrganizationRole', 'UpdateOrganizationPermission', 'UpdateSAMLConnection', 
    'RevokeInvitation', 'CreateBulkInvitations',
    // users: no application measured calls these
    'DeleteBackupCode', 'BanUser', 'ReplaceUserEmailAddress', 'LockUser', 'DisableMFA', 'SetUserPasswordCompromised',
    'UnsetUserPasswordCompromised', 'ReplaceUserPhoneNumber', 'SetUserProfileImage', 'DeleteUserProfileImage', 'RemoveUserPassword', 'DeleteTOTP',
    'UnbanUser', 'UnlockUser', 'VerifyPassword', 'VerifyTOTP', 'UsersBan', 'UsersUnban',
    // sessions: a session is refreshed by a browser's expired token, which no application measured sends
    'RefreshSession',
    // organizations: a logo is an upload no application measured makes, and no application measured reads every
    // membership of the instance or the pending invitations' own path
    'UploadOrganizationLogo', 'DeleteOrganizationLogo', 'InstanceGetOrganizationMemberships', 'ListPendingOrganizationInvitations',
    // JWT templates: no application measured lists or deletes one
    'ListJWTTemplates', 'DeleteJWTTemplate',
    // enterprise connections: a test run is the IdP's own flow, which no World reaches; no application measured lists or
    // deletes one
    'CreateEnterpriseConnectionTestRun', 'ListEnterpriseConnections', 'DeleteEnterpriseConnection',
    // the instance: only its organization settings are modelled
    'GetInstance', 'ChangeProductionInstanceDomain', 'UpdateInstanceRestrictions',
    'ListOAuthApplications', 'UpdateOAuthApplication', 'DeleteOAuthApplication', 'RotateOAuthApplicationSecret',
  ],
  accountSetup: [{ operation: 'CreateOAuthApplication', why: 'Register the OAuth client before the worker can authorize its customers.' }],
  screens: [{
    // img.clerk.com: the avatar Clerk shows for a user or organization with no uploaded image (./screens/images.ts)
    id: 'images', kind: 'content', host: 'img.clerk.com', path: '/', status: 'done',
    demand: "clerk-js and an application draw a user's or an organization's image_url, which names img.clerk.com when it has none of its own",
    source: 'https://clerk.com/docs/references/javascript/user (hasImage)',
  }],
  resources: {
    _secret_key: { idPrefix: '_sk_', ids: '{prefix}{n}' },
    _native_application: { idPrefix: '_native_app_', ids: '{prefix}{n}' },
    // a webhook endpoint is Svix's (Clerk sends its webhooks through Svix), its id `ep_` and 27 letters and digits
    // source: https://raw.githubusercontent.com/svix/svix-webhooks/v2.6.1/javascript/src/mockttp.test.ts "ep_1srOrx2ZWZBpBUvZwXKQmoEYga2"
    webhook_endpoint: { idPrefix: 'ep_', ids: '{prefix}{letters:27}', refresh: { none: "The endpoint is a Svix Dashboard resource, not a Clerk Backend API resource. Clerk's Backend API surface provides no list or retrieval operation for webhook destinations; the World's door records the configured destination." } },
    // `query`: "Uses exact match for … ID and partial match for name and key"; `order_by` over the fields each list names
    // (spec: ListOrganizationPermissions, ListOrganizationRoles, ListOrganizationInvitations)
    Permission: { storedAs: 'organization_permission', idPrefix: 'perm', refresh: { list: 'ListOrganizationPermissions', items: 'data' }, search: { param: 'query', exact: ['id'], partial: ['name', 'key'] }, orderBy: { param: 'order_by', fields: ['created_at', 'name', 'key'], default: '+created_at', invalid: ORDER_BY_INVALID } },
    Role: { storedAs: 'organization_role', idPrefix: 'role', refresh: { list: 'ListOrganizationRoles', items: 'data' }, search: { param: 'query', exact: ['id'], partial: ['name', 'key'] }, orderBy: { param: 'order_by', fields: ['created_at', 'name', 'key'], default: '-created_at', invalid: ORDER_BY_INVALID }, ...states.Role },
    // each not-found as https://clerk.com/docs/guides/development/errors/backend-api gives it (JWTTemplateNotFound,
    // OrganizationNotFound, UserNotFound, SessionNotFound)
    // one template per name: FormAlreadyExists, 422 (https://clerk.com/docs/guides/development/errors/backend-api,
    // "FormAlreadyExists signifies an error when given resource already exists"; the page gives it no message, the twin's
    // states the rule)
    JWTTemplate: { storedAs: 'jwt_template', idPrefix: 'jtmpl', refresh: { get: 'GetJWTTemplate', known: true }, unique: [{ fields: ['name'], refusal: { status: 422, code: 'form_already_exists', kind: 'A JWT template with this name already exists.', message: 'A JWT template with this name already exists.', param: 'name' } }], order: { field: 'created_at', direction: 'desc' }, notFound: { message: 'No JWT template exists with id: {id}', code: 'resource_not_found' } },
    // metadata: "a deep merge will be performed … remove metadata keys at any level by setting their value to null"
    // (spec: UpdateUserMetadata, MergeOrganizationMetadata, UpdateOrganizationMembershipMetadata)
    // an organization is named by its id or its slug (spec: GetOrganization, "The ID or slug of the organization")
    Organization: { storedAs: 'organization', idPrefix: 'org', refresh: { list: 'ListOrganizations', items: 'data' }, update: 'deep', alternateKeys: ['slug'],
      // source: spec:DeleteOrganization "Please note that deleting an organization will also delete all memberships and invitations."
      cascade: [{ resource: 'OrganizationMembership', field: 'organization_id' }, { resource: 'OrganizationInvitation', field: 'organization_id' }], notFound: { message: 'Given organization not found.', code: 'resource_not_found' } },
    OrganizationMembership: { storedAs: 'organization_membership', idPrefix: 'orgmem', update: 'deep', parent: { resource: 'Organization', param: 'organization_id', field: 'organization_id' }, refresh: { list: 'ListOrganizationMemberships', items: 'data' } },
    // source: spec:ListInvitations "Returns all non-revoked invitations for your application, sorted by creation date"
    Invitation: { storedAs: 'invitation', idPrefix: 'inv', refresh: { list: 'ListInvitations', items: '$body' }, ...states.Invitation },
    OrganizationInvitation: { storedAs: 'organization_invitation', idPrefix: 'orginv', parent: { resource: 'Organization', param: 'organization_id', field: 'organization_id' }, refresh: { list: 'ListOrganizationInvitations', items: 'data' }, orderBy: { param: 'order_by', fields: ['created_at', 'email_address'], default: '-created_at', invalid: ORDER_BY_INVALID }, ...states.OrganizationInvitation },
    User: { storedAs: 'user', idPrefix: 'user', refresh: { list: 'GetUserList', items: '$body' }, update: 'deep', cascade: [{ resource: 'OrganizationMembership', field: 'public_user_data.user_id' }, { resource: 'OrganizationMembership', field: 'user_id' }], notFound: { message: 'No user was found with id {id}', code: 'resource_not_found' }, ...states.User },
    Session: { storedAs: 'session', idPrefix: 'sess', refresh: { list: 'GetSessionList', items: '$body' }, notFound: { message: 'No session was found with id {id}', code: 'resource_not_found' }, ...states.Session },
    // a sign-in token (spec:/components/schemas/SignInToken), its ticket's expiry and organization kept as bookkeeping
    SignInToken: { storedAs: 'sign_in_token', idPrefix: 'sit', refresh: { none: "The Backend API exposes CreateSignInToken and RevokeSignInToken but no list or retrieval of a sign-in token. A ticket is consumed through its customer's sign-in flow." }, ...states.SignInToken },
    // The life creates this child through CreateEnterpriseConnection (enterprise_connections.ts:77);
    // UpdateEnterpriseConnection writes it and GetEnterpriseConnection renders it. GetSAMLConnection reads the known child for refresh; standalone mutations and enumeration remain the gap.
    // source: spec:/components/schemas/EnterpriseConnection/properties/saml_connection "Present when the enterprise connection uses SAML"
    SAMLConnection: { storedAs: 'saml_connection', idPrefix: 'samlc', refresh: { get: 'GetSAMLConnection', known: true }, ...states.SAMLConnection },
    // an enterprise connection (spec:/components/schemas/EnterpriseConnection), its SAML side a SAMLConnection naming it;
    // the spec gives no example id, so the prefix is the twin's reading
    EnterpriseConnection: { storedAs: 'enterprise_connection', idPrefix: 'entconn', refresh: { get: 'GetEnterpriseConnection', known: true }, ...states.EnterpriseConnection },
    // source: spec:CreateOAuthApplication "Creates a new OAuth application"
    OAuthApplication: { storedAs: 'oauth_application', idPrefix: 'oa', refresh: { get: 'GetOAuthApplication', known: true } },
    // GET /instance/organization_settings returns this singleton's fields, not the deployment metadata GET /instance returns.
    OrganizationSettings: { storedAs: 'organization_settings', idPrefix: '', key: 'organization_settings', refresh: { get: 'GetInstanceOrganizationSettings' } },
    // The Dashboard door's private sign-in configuration has no Backend API resource representation.
    _instance: { idPrefix: 'ins' },
  },
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest)
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    // R20 — the published clerk-js bundle (vendor/clerk-js) the loader path serves byte-for-byte, through the pack-asset seam.
    assets: ['vendor/clerk-js/dist'],
    bin: 'world-clerk',
    resources: ['invitation', 'user', 'session', 'organization', 'organization_membership', 'organization_invitation', 'organization_role', 'organization_permission', 'jwt_template', 'saml_connection', 'client', 'sign_in', 'sign_up', 'oauth_application', 'organization_settings'],
    specSource: 'spec/openapi.yaml.gz (Clerk Backend API) and fapi/spec/openapi.yaml.gz (Clerk Frontend API), clerk/openapi-specs',
    description: 'Clerk twin — the Backend and Frontend APIs from Clerk\'s specs: users, sign-up and sign-in, sessions, organizations with roles, permissions and invitations, real RS256 JWTs + JWKS, Svix webhooks.',
    // Adoption + interception, moved off the central maps unchanged (descriptor-first back-migration, adding-a-twin.md §3,
    // 2026-08-31). Every first-party framework client of the same backend API, plus
    // the whole `@clerk/` scope so an unlisted sibling still detects.
    adoption: {
      // Clerk's official Python backend SDK (clerk/clerk-sdk-python), the counterpart of `@clerk/backend`.
      pypi: ['clerk-backend-api'],
      sdks: ['@clerk/backend', '@clerk/clerk-sdk-node', '@clerk/nextjs', '@clerk/fastify', '@clerk/express'],
      scopes: ['@clerk/'],
      envStems: ['CLERK'],
    },
    // Clerk's BROWSER SDK addresses the instance's frontend-API host encoded in the publishable key
    // (`pk_test_<base64 host$>`), not api.clerk.com — and app CSPs allowlist THAT host. The
    // dev-instance family is claimed by suffix so a world-issued pk can name a CSP-legal host.
    // (Peak drive 2026-08-26.)
    // img.clerk.com: the avatars and provider logos Clerk's URLs name (./screens/images.ts)
    // the application's keys, issued once the twin is up (./semantics/doors.ts appCredentials), under the names Clerk's
    // SDKs read (runhuman's among them: CLERK_SECRET_KEY, CLERK_JWT_KEY, CLERK_WEBHOOK_SIGNING_SECRET and the framework
    // prefixes of the publishable key)
    credentialDoor: { path: '/_twin/app-credentials', body: {}, fill: {
      CLERK_SECRET_KEY: 'secret_key', CLERK_API_KEY: 'secret_key',
      CLERK_PUBLISHABLE_KEY: 'publishable_key', NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'publishable_key', VITE_CLERK_PUBLISHABLE_KEY: 'publishable_key',
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'publishable_key', PUBLIC_CLERK_PUBLISHABLE_KEY: 'publishable_key',
      CLERK_JWT_KEY: 'jwt_key', CLERK_WEBHOOK_SECRET: 'webhook_secret', CLERK_WEBHOOK_SIGNING_SECRET: 'webhook_secret',
    } },
    // source: https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi "must be forwarded to https://frontend-api.clerk.dev/* with the body and all headers intact."
    // source: https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth "https://clerk.<INSERT_YOUR_APP_DOMAIN>.com/.well-known/oauth-authorization-server"
    hosts: [{ host: 'api.clerk.com' }, { suffix: '.clerk.accounts.dev' }, { host: 'frontend-api.clerk.dev' }, { hostPattern: '^clerk\\.(?:[a-z0-9-]+\\.)+[a-z0-9-]+$' }, { host: 'img.clerk.com' }],
    // The Clerk frontend SDK calls api.clerk.com; the dev proxy forwards that host to the
    // twin so calls come back same-origin, and /.well-known/jwks.json is served by the twin.
    browserRouting: { apiPathPrefix: '/v1/', loaderHost: 'https://api.clerk.com' },
  },
};
