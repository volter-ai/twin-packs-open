// The auth lane's manifest: Atlassian's OAuth 2.0 (3LO) as its spec (../spec, written from the 3LO page) serves it —
// the token URL and accessible-resources — and the authorize page (a screen). Atlassian's sign-up of a site and its
// people, and its developer console, are the World's doors. It shares the vendor's store with the platform lane.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'jira',
  service: 'jira',
  body: { json: 'always' },
  ids: { template: '{uuid}' },
  time: 'iso',
  // RFC 6749's error body, as the 3LO page shows it ("error": "invalid_grant")
  error: { error: '{code}', error_description: '{message}' },
  readOnly: { status: 403, code: 'access_denied', message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, code: 'not_found', message: 'Not found' },
  gap: { status: 404, code: 'not_found', message: 'Not found' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 50, max: 50 } },
  deleted: {},
  resources: {
    _site: { idPrefix: '', unique: [{ fields: ['name'], refusal: { status: 409, message: 'that site name is taken' } }] },
    _person: { idPrefix: '', ids: '{hex:24}', unique: [{ fields: ['email'], refusal: { status: 409, message: 'that email already has an account' } }] },
    _app: { idPrefix: '' },
    _code: { idPrefix: 'code_', ids: '{prefix}{n}' },
    _access_token: { idPrefix: 'at_', ids: '{prefix}{n}' },
    _refresh_token: { idPrefix: 'rt_', ids: '{prefix}{n}' },
    _api_token: { idPrefix: 'api_', ids: '{prefix}{n}' },
  },
  screens: [{
    id: 'authorize', kind: 'flow', host: 'auth.atlassian.com', path: '/authorize',
    demand: 'The retained issue-tracking integration connects a Jira site (audience api.atlassian.com, scopes, prompt consent)', status: 'done',
    controls: ['Log in', 'Choose a site', 'Accept', 'Cancel'], source: 'https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/',
  }],
  vendorBacked: { none: 'Atlassian account and OAuth credential state has no account-wide read-back or replayable credential API; it is World setup.' },
  doors: [
    { id: 'apiToken', method: 'POST', path: '/_twin/api-token', note: '{ site, email, password }: an API token made in the Atlassian account console, acting as that person; answers apiToken and authorization' },
    { id: 'sites', method: 'POST', path: '/_twin/sites', note: '{ name, admin: { name, email, password } }: a Jira Cloud site signed up for (its cloudid, URL), its first person its admin' },
    { id: 'people', method: 'POST', path: '/_twin/sites/{name}/people', note: '{ name, email, password }: a person given access to the site' },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: '{ name?, callback_urls? }: an OAuth 2.0 (3LO) app made in the developer console' },
  ],
  discovery: {
    twinOf: "Atlassian's OAuth 2.0 (3LO): the authorize page, the token URL (rotating refresh tokens) and accessible-resources",
    stores: 'sites and their people, OAuth apps, codes and tokens (by their SHA-256)',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-jira-auth',
    resources: [],
    specSource: "Atlassian's 3LO endpoints written from its docs (spec/SOURCE.md)",
    description: "Jira's auth lane — Atlassian's OAuth 2.0 (3LO).",
    adoption: { sdks: [], envStems: [] },
    hosts: [{ host: 'auth.atlassian.com' }, { host: 'api.atlassian.com', pathPattern: '^/oauth/' }],
    endpointEnvNone: 'the vendor lane',
  },
};
