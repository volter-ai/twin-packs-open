// The Frontend API lane of the clerk pack (docs/contributing/architecture.md, "Other wires: lanes"): what the unmodified
// `@clerk/clerk-js` calls on an instance's own host (`<slug>.clerk.accounts.dev`, `clerk.<domain>`). The surface is
// generated (./generated/surface.gen.json, from ../spec by scripts/derive-pack.ts): Clerk's Frontend API OpenAPI
// document, 210 operations. The Backend API is the pack's root (../../src), over the same state. The state machines are
// ./semantics/states.ts.
//
// WHAT IS MODELLED is what clerk-js needs to boot and what the applications measured drive through it
// (../../journeys/demand.json): the environment, the dev browser, the client, sign-up by email and password (the address
// verified by an emailed code) and by an invitation's ticket, sign-in by password, by an emailed code and by ticket,
// sessions (read, touched and their tokens), client-wide sign-out, Google OAuth callback and an invitation's link.
// UserProfile, user.reload and targeted session management answer the gap.
//
// THE STATE THIS LANE SHARES WITH THE ROOT. Users (`user`), sessions (`session`), organizations, their memberships and
// invitations, roles and JWT templates are the root's stored types, in the Backend API's shapes; the lane reads and writes
// users, organizations, memberships and invitations through the root's manifest (../../src/manifest.ts), so the root's
// machines rule them (an invitation's acceptance is the root's `external` move). A session's lifecycle as a browser
// drives it is declared here, on the lane's view of it.
//
// THE STATE THIS LANE KEEPS. The browser's client (`client`, what the `__client` cookie names) with the sign-in and the
// sign-up it is part-way through; those attempts (`sign_in`, `sign_up`), each in the Frontend API's own shape; and, as
// bookkeeping, the emails Clerk sends (`_email`, shared with the root, which writes invitations there).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'clerk',
  service: 'clerk',
  // "This is a Form Based API and all the data must be sent and formatted according to the
  // `application/x-www-form-urlencoded` content type." (spec:/info/description)
  body: { form: { coerce: true } },
  // Clerk's ids are a type prefix and a KSUID (`user_2…`, 27 characters: the spec's ^ins_\w{27}$)
  ids: { template: '{prefix}_{ksuid}' },
  time: 'unix-ms',
  // spec:/components/schemas/ClerkErrors: the short message rides `{kind}`, the long one `{message}` (Clerk's differ:
  // "Signed out" and "You are signed out", ../spec/recordings/2026-09-28-clerk-clerk-com-signed-out.json)
  // the trace id beside them is Clerk's form, 32 lowercase hex digits (fresh per request at Clerk; one fixed id in a World,
  // the Backend API's CLERK_TRACE_ID)
  // source: recording:2026-09-28-clerk-clerk-com-signed-out.json "59e9be06d1438c9e532b90aad9299701"
  error: { errors: [{ message: '{kind}', long_message: '{message}', code: '{code}' }], clerk_trace_id: 'f0e1d2c3b4a5968778695a4b3c2d1e0f' },
  // the short message of Clerk's parameter refusals (form_param_*: "is invalid",
  // https://clerk.com/docs/guides/development/errors/frontend-api)
  defaultKind: 'is invalid',
  readOnly: { status: 403, code: 'read_only', kind: 'read only', message: 'This twin was started read-only; writes are refused.' },
  // https://clerk.com/docs/guides/development/errors/frontend-api: InvalidJSONRequestBody, 400 request_body_invalid
  malformedBody: { status: 400, code: 'request_body_invalid', kind: 'Request body invalid', message: 'Request body invalid' },
  notFound: { status: 404, code: 'resource_not_found', kind: 'not found', message: 'Resource not found' },
  // what the Frontend API does not serve is answered by ./semantics/gap.ts (the request decides: Go's plain 404 or
  // `signed_out`)
  // every JSON answer labelled exactly `application/json`, and every answer carrying its trace id, as the Backend API's
  jsonContentType: 'application/json',
  answerHeaders: { 'x-clerk-trace-id': 'f0e1d2c3b4a5968778695a4b3c2d1e0f' },
  screens: [
    { id: 'oauth-sign-in', kind: 'flow', host: '<instance>', path: '/sign-in', status: 'done', demand: 'OAuth authorization requires a signed-in person', source: 'https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth' },
    { id: 'oauth-consent', kind: 'flow', host: '<instance>', path: '/oauth/consent', status: 'done', demand: 'the worker OAuth flow asks for consent before issuing a code', source: 'https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth' },
    {
    // the loader path an instance serves the clerk-js bundle at, which a page's <script> names on the Frontend API's host
    id: 'clerk-js', kind: 'content', host: '<instance>', path: '/npm/@clerk', status: 'done',
    demand: 'every Clerk-authenticated page loads clerk-js from its instance\'s Frontend API',
    source: 'https://clerk.com/docs/references/javascript/overview',
  }],
  list: { style: 'envelope', envelope: { data: '{data}', total_count: '{total_count}' }, limit: { param: 'limit', default: 10, max: 500 }, offset: { param: 'offset' } },
  deleted: { object: '{object}', id: '{id}', deleted: true },
  // No Frontend webhook delivery is in scope: the scanned applications have no Clerk webhook receiver.
  // Session writes use this manifest; shared Backend writes use its declared events (user.deleted only).
  // the generic core would claim these reads of the declared resources; no application measured calls them
  unmodeled: ['getOrganizationMemberships', 'getUsersOrganizationInvitations', 'getOrganizationSuggestions', 'acceptOrganizationInvitation', 'changePassword', 'deleteClientSessions', 'endSession', 'getSessions', 'getUser', 'patchUser', 'removeSession', 'requestOAuthAuthorizePOST', 'revokeSession', 'getUsersSessions', 'getOrganizationCreationDefaults'],
  // a PATCH of the environment writes nothing (clerk-js reports its origin there in development)
  reads: ['updateEnvironment'],
  resources: {
    // source: spec:getOAuthToken "Authorization code**: 10 minutes"
    _oauth_code: { idPrefix: 'clk_code', ...states._oauth_code },
    // source: spec:/components/schemas/OAuth.Token "The access token issued by the authorization server."
    _oauth_access: { idPrefix: 'oat' },
    // source: spec:getOAuthToken "Refresh token**: 10 years"
    _oauth_refresh: { idPrefix: 'clk_refresh' },
    // the browser's client: `sessions`, `sign_in`, `sign_up` and `last_active_session_id` are read from the state at
    // every answer, never stored on it
    'Client.Client': { storedAs: 'client', idPrefix: 'client', refresh: { none: "getClient is bound to the caller's browser cookie, not an account-wide client list. The Frontend API cannot enumerate the instance's clients with the backend root's secret key." } },
    'Client.SignUp': { storedAs: 'sign_up', idPrefix: 'sua', refresh: { none: "getSignUps requires the sign-up to belong to the current browser client. The Frontend API offers no account-wide sign-up enumeration or backend-secret-key readback." }, ...states['Client.SignUp'] },
    'Client.SignIn': { storedAs: 'sign_in', idPrefix: 'sia', refresh: { none: "getSignIn requires the sign-in to belong to the current browser client. The Frontend API offers no account-wide sign-in enumeration or backend-secret-key readback." }, ...states['Client.SignIn'] },
    'Client.Session-2': { storedAs: 'session', idPrefix: 'sess', refresh: { none: "Frontend getSession is bound to the current browser client. Account-wide session observation is the Backend API manifest's Session resource and GetSessionList, over this same session store; there is no independent Frontend account enumeration." }, ...states['Client.Session-2'] },
  },
};
