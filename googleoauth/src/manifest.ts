// Google OAuth's manifest: the vendor facts its spec does not carry (architecture, "Protocol 3", in twin-world). The surface
// is generated from ../spec (Google's OAuth 2.0 and OpenID Connect endpoints, grouped by tag). Every served operation is a
// handler; the device flow is the gap.
import type { DerivedManifest } from '@volter/world-core';


export const manifest: DerivedManifest = {
  vendor: 'googleoauth',
  service: 'googleoauth',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'unix',
  // RFC 6749 section 5.2, as Google's token endpoint answers: `{ error, error_description }`
  error: { error: '{code}', error_description: '{message}' },
  readOnly: { status: 403, code: 'access_denied', message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, code: 'not_found', message: 'Not Found' },
  list: { style: 'envelope', envelope: { items: '{data}' }, limit: { param: 'maxResults', default: 100, max: 100 } },
  deleted: {},
  // Google's account chooser (screens/choose.ts): the page an authorization request opens, where a person picks the
  // account that signs in and consents to the scopes the application asks for
  screens: [{
    id: 'choose', kind: 'flow', host: 'accounts.google.com', path: '/o/oauth2/v2/auth',
    demand: 'every sign-in with Google chooses an account and consents here', status: 'done',
    controls: ['Choose an account', 'Continue'], source: 'https://developers.google.com/identity/protocols/oauth2/web-server',
  }],
  // the World's doors (./semantics/doors.ts): what Google's console and account sign-up do outside the API
  doors: [
    { id: 'clients', method: 'POST', path: '/_twin/clients', note: "an OAuth client (the console's)" },
    { id: 'accounts', method: 'POST', path: '/_twin/accounts', note: 'a Google account a person chooses' },
    { id: 'serviceAccounts', method: 'POST', path: '/_twin/service-accounts', note: "a service account (its JWT's iss)" },
    { id: 'worldCredentials', method: 'POST', path: '/_twin/credentials', note: "the World's credentials: the service account and its key file, the application's OAuth client, the World's person (the Google account who consents) and the project's API key (the credential door)" },
  ],
  // GET /twin: what the twin is of and what it keeps
  discovery: {
    twinOf: 'Google OAuth 2.0 and OpenID Connect (accounts.google.com, oauth2.googleapis.com, www.googleapis.com/oauth2, openidconnect.googleapis.com): the account chooser, tokens by code with PKCE, refresh and service-account assertions, revocation, tokeninfo, userinfo and keys',
    stores: "OAuth clients, the World's Google accounts and service accounts, codes and refresh tokens (by their SHA-256), access tokens and the project's API keys (by their SHA-256) as the Google API packs read them",
  },
  resources: {
    account: { idPrefix: '', unique: [{ fields: ['id'], refusal: { status: 409, code: 'ALREADY_EXISTS', message: 'Google account belongs to another email' } }] },
    _project: { idPrefix: '', unique: [{ fields: ['project_id'], refusal: { status: 409, code: 'ALREADY_EXISTS', message: 'Cloud project already exists' } }] },
    _service_account: { idPrefix: '', unique: [{ fields: ['client_email'], refusal: { status: 409, code: 'ALREADY_EXISTS', message: 'Service account already exists' } }] },
    _serial: { idPrefix: '', ids: '{n}' },
  },
  // the descriptor, as data (twin-world's architecture, "The descriptor"): the pack registers packOf(manifest)
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-googleoauth',
    resources: ['client', 'account', 'access_token', 'api_key'],
    specSource: 'spec/openapi.json: Google\'s OAuth 2.0 and OpenID Connect endpoints as its identity pages document them, and the oauth2 v2 Discovery document (spec/SOURCE.md)',
    description: 'Google OAuth twin — the account chooser, tokens by code (with PKCE), refresh token and service-account JWT assertion, revocation, tokeninfo, userinfo and signing keys; its access tokens are the rows the Google API packs read.',
    adoption: { sdks: ['google-auth-library', '@googleapis/oauth2'], envStems: ['GOOGLE_CLIENT', 'GOOGLE_OAUTH'] },
    // each path this pack serves, on its host. accounts.google.com is Google's whole sign-in property and
    // www.googleapis.com is shared with the Google API packs, so only the paths served there are claimed; a path the
    // twin answers 404 is not claimed, except `/device/code`, which the discovery document advertises (unclaimed, a
    // client following it would leave the World)
    hosts: [
      { host: 'accounts.google.com', pathPattern: '^/(o/oauth2/v2/auth(/oauthchooseaccount|/choose)?|o/oauth2/auth|o/oauth2/token|signin/oauth/error|\\.well-known/openid-configuration)/?$' },
      { host: 'accounts.google.com', pathPattern: '^/_twin/' },
      { host: 'oauth2.googleapis.com', pathPattern: '^/(token|oauth2/v4/token|revoke|tokeninfo|device/code)/?$' },
      { host: 'www.googleapis.com', pathPattern: '^/(oauth2/(v1/certs|v3/(certs|userinfo)|v2/userinfo)|userinfo/v2/me)/?$' },
      { host: 'openidconnect.googleapis.com' },
    ],
    endpointEnvNone: 'Google\'s OAuth libraries read no base-URL variable: the endpoints are the discovery document\'s, claimed by the host rules.',
    // the World's service account, whose key file Google's client libraries read (google-auth-library's application default
    // credentials), and the application's OAuth client with the World's person, who signs in on the account chooser and
    // consents to the scopes an application asks for (its installed-app loopback redirect registered), and the project's
    // API key, under the name the demanded application reads it by (Dub's YOUTUBE_API_KEY, apps/web/.env.example)
    credentialDoor: { account: { field: 'world_account', tenancy: 'Cloud project', source: 'https://cloud.google.com/iam/docs/keys-create-delete' },
      deployment: { field: 'world_deployment', object: 'OAuth client and service-account key', source: 'https://developers.google.com/identity/protocols/oauth2/web-server' },
      path: '/_twin/credentials',
      body: { client_email: 'world@world-project.iam.gserviceaccount.com', client: { redirect_uris: ['http://localhost:3000/oauth2callback'], name: 'World App' }, account: { sub: '100000000000000000001', email: 'person@world.example', name: 'World Person' }, api_key: { name: 'API key 1' } },
      fill: { GOOGLE_APPLICATION_CREDENTIALS: 'file:credentials', GOOGLE_CLIENT_ID: 'client_id', GOOGLE_CLIENT_SECRET: 'client_secret', YOUTUBE_API_KEY: 'api_key' },
    },
  },
};
