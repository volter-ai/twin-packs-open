// Vercel's manifest: the vendor facts its published OpenAPI document (../spec/openapi.json.gz) does not carry
// (docs/contributing/architecture.md, "Protocol 3"). The surface is generated (./generated/surface.gen.json) at
// https://api.vercel.com.
//
// SCOPE FROM THE DEMAND (../journeys/demand.json, ../journeys/decisions.json): Dub's customer domains on a project (add,
// read, its configuration, verify, remove, the team domain's deletion and its nameservers made Vercel's) and Edge Config
// (items written through the API; read at edge-config.vercel.com, its own host, a content screen, by Dub and Cal.com).
// Handlers serve each (./semantics): the document types these answers inline and computes them (a domain's
// configuration from its DNS, a verification challenge from who holds the apex), so none is the core's. The lists a
// vendor-backed root refreshes from (projects, a project's domains, domains, teams, Edge Configs) are handlers too. The
// dashboard pages the applications' setup needs are screens (vercel.com: the email sign-in, Account Tokens, the team's
// Storage). Every other operation is the gap.
//
// THE STATE is the vendor's: teams, projects (made by the Git import, a door), project domains (one per project and
// name), team domains, Edge Configs and their items (one subject each), access tokens (kept by their SHA-256).
//
// NO `auth`: which token a request carries decides the team it acts in (a team-scoped token's, or `?teamId=`), and an
// invalid one is refused 403 with `invalidToken` (./semantics/shared.ts), which the kernel's gate cannot state.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'vercel',
  service: 'vercel',
  discovery: {
    twinOf: 'the Vercel REST API (api.vercel.com), its dashboard\'s sign-in and token pages, and Edge Config\'s read host',
    stores: 'teams, projects and their domains with each domain\'s configuration and verification, Edge Configs and their items, and tokens',
  },
  body: { json: 'always' },
  // Vercel's ids are a prefix and 24 characters (`prj_`, `team_`, `ecfg_`); the handlers put the prefix
  ids: { template: '{letters:24}' },
  // a documented option no application of the demand sends: a domain's update taking it off Vercel's DNS (Dub's
  // configureVercelNameservers sends zone: true alone, apps/web/lib/api/domains/configure-vercel-nameservers.ts:7)
  // source: spec:patchDomain "Update or move apex domain."
  variants: { patchDomain: ['zone=false'] },
  // Vercel's times are Unix milliseconds (`createdAt`)
  time: 'unix-ms',
  // vercel.com/docs/rest-api/errors: every failure is {"error":{"code","message"}}
  error: { error: { code: '{code}', message: '{message}' } },
  readOnly: { status: 405, code: 'method_not_allowed', message: 'twin is read-only' },
  malformedBody: { status: 400, code: 'bad_request', message: 'Invalid JSON' },
  notFound: { status: 404, code: 'not_found', message: 'Not Found' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 20, max: 100 } },
  deleted: {},
  doors: [
    { id: 'users', method: 'POST', path: '/_twin/users/{email}', note: "{ team }: a person's Vercel account and their Pro team (the World's stand-in for Vercel's sign-up)" },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: '{ team?, project? }: an application\'s Vercel credentials (a team token, the team and project ids, an Edge Config\'s connection string), as the runtime issues them' },
    { id: 'mailbox', method: 'GET', path: '/_twin/mailbox/{email}', note: 'the emails Vercel sent a person (their one-time passwords), newest first' },
    { id: 'projects', method: 'POST', path: '/_twin/projects', note: "{ team, name }: the project Vercel made when the team imported its Git repository" },
    { id: 'nameservers', method: 'POST', path: '/_twin/registrar/nameservers', note: "{ domain, nameservers }: the nameservers a domain's owner set at their registrar" },
    { id: 'dns', method: 'POST', path: '/_twin/dns', note: "{ name, type, value }: a record a domain's owner set at their own DNS host" },
    { id: 'claimed', method: 'POST', path: '/_twin/claimed', note: '{ domain }: an apex another Vercel account holds (a customer\'s old site elsewhere on Vercel)' },
  ],
  screens: [{
    id: 'login', kind: 'flow', host: 'vercel.com', path: '/login',
    demand: 'every dashboard page a person reaches asks who is signed in', status: 'done',
    controls: ['Email Address', 'Continue with Email', 'One-time password', 'Verify'], source: 'https://vercel.com/docs/accounts',
  }, {
    id: 'account-tokens', kind: 'workspace', host: 'vercel.com', path: '/account/tokens',
    demand: "the access token the applications call the API with (Dub's VERCEL_API_KEY) is made only here", status: 'done',
    controls: ['Token Name', 'Scope', 'Expiration', 'Create', 'Delete'], source: 'https://vercel.com/docs/accounts/access-tokens',
  }, {
    id: 'stores', kind: 'workspace', host: 'vercel.com', path: '/{team}/stores',
    demand: "an Edge Config and its connection string (the EDGE_CONFIG the SDK reads with) are made on the team's Storage page", status: 'done',
    controls: ['Create Edge Config', 'Name', 'Connect Project'], source: 'https://vercel.com/docs/edge-config/get-started',
  }, {
    id: 'edge-config', kind: 'content', host: 'edge-config.vercel.com', path: '/{edgeConfigId}',
    demand: "@vercel/edge-config reads an item at the connection string's host (Dub's reserved usernames, cal.com's proxy)", status: 'done',
    source: 'https://vercel.com/docs/edge-config/edge-config-sdk',
  }],
  resources: {
    // keyed by their stored names, not the document's schemas, so the core answers none of their operations (every one
    // the applications call is a handler; the rest are the gap)
    // a project domain is its project's and its name, read back per project
    project_domain: { idPrefix: '', ...states.project_domain, key: '{projectId}::{name}', parent: { resource: 'project', field: 'projectId', param: 'idOrName' }, refresh: { list: 'getProjectDomains', items: 'domains', next: 'pagination.next', cursor: 'until' } },
    domain: { idPrefix: '', ...states.domain, refresh: { list: 'getDomains', items: 'domains', next: 'pagination.next', cursor: 'until' } },
    project: { idPrefix: '', refresh: { list: 'getProjects', items: 'projects', next: 'pagination.next', cursor: 'from' } },
    team: { idPrefix: '', refresh: { list: 'getTeams', items: 'teams', next: 'pagination.next', cursor: 'until' } },
    // getEdgeConfigs answers every Edge Config in one unpaged list
    edge_config: { idPrefix: '', refresh: { list: 'getEdgeConfigs', items: '$body', unpaginated: true } },
    // an Edge Config's item, one subject each (`<ecfg>::<key>`), an access token, a mail sent, a record at a DNS host
    // outside Vercel, a registrar's nameservers, an apex another account holds
    edge_config_item: { idPrefix: '', key: '{edgeConfigId}::{key}', parent: { resource: 'edge_config', field: 'edgeConfigId', param: 'edgeConfigId' }, refresh: { list: 'getEdgeConfigItems', items: '$body', unpaginated: true } },
    _token: { idPrefix: '' },
    _user: { idPrefix: '' },
    _mail: { idPrefix: '' },
    _external_dns: { idPrefix: '' },
    _nameservers: { idPrefix: '' },
    _claimed: { idPrefix: '' },
  },
  // Vercel's webhooks, signed with the webhook's secret: x-vercel-signature is the hex HMAC-SHA1 of the body; the event
  // names its type and carries its subject under payload (a project domain's name beside its project's id)
  // source: https://vercel.com/docs/webhooks/webhooks-api "corresponds to the sha1 of the request body using your secret key"
  // source: https://vercel.com/docs/webhooks/webhooks-api "Occurs whenever a domain is added to a project."
  // source: https://vercel.com/docs/webhooks/webhooks-api "Occurs whenever a project domain is verified."
  ingest: {
    scheme: { kind: 'hmac', header: 'x-vercel-signature', encoding: 'hex', algorithm: 'sha1' },
    type: { body: 'type' }, object: 'payload.domain',
    types: {
      'project.domain.created': { resource: 'project_domain', parent: 'payload.project.id' },
      'project.domain.verified': { resource: 'project_domain', parent: 'payload.project.id', fields: { verified: true } },
      'project.domain.unverified': { resource: 'project_domain', parent: 'payload.project.id', fields: { verified: false } },
      'project.domain.deleted': { resource: 'project_domain', parent: 'payload.project.id', deleted: true },
      'project.created': { resource: 'project', object: 'payload.project' },
      'project.renamed': { resource: 'project', object: 'payload.project' },
      'project.removed': { resource: 'project', object: 'payload.project', deleted: true },
    },
  },
  // the fail-closed ceiling on live calls against Vercel (world-core rateBudget.ts, architecture D8): Vercel limits each
  // kind of call per minute; the tightest a served operation meets is a domain's update, 60 a minute, so the World
  // spends at most 50 calls a minute of any kind, under every documented limit of the calls it makes
  // source: https://vercel.com/docs/limits "Domains update per minute. api-domains-patch 60"
  // source: https://vercel.com/docs/limits "Project domain creation, update, or remove per minute."
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 60, source: 'https://vercel.com/docs/limits' },
    reason: "Vercel rate-limits its REST API per kind of call (https://vercel.com/docs/limits, Rate limits): a domain's update 60 a minute, a domain's deletion 100, a project domain's creation, update or removal 100, its verification 100, domains read 200, a domain's configuration 500, teams read 600; the World spends 50 calls a minute, under the tightest of them",
    windowMs: 60_000, ceiling: 50, defaultWeight: 1, maxRetryAfterSeconds: 300,
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-vercel',
    resources: ['team', 'project', 'project_domain', 'domain', 'edge_config', 'edge_config_item'],
    specSource: "spec: Vercel's published OpenAPI document, provenance in spec/SOURCE.md",
    description: "Vercel twin — a project's domains and their configuration as Vercel sees their DNS, a team domain's zone, Edge Config written through the API and read at edge-config.vercel.com, and the dashboard's sign-in, tokens and storage.",
    adoption: { sdks: ['@vercel/sdk', '@vercel/edge-config'], pypi: ['vercel'], envStems: ['VERCEL', 'EDGE_CONFIG'], configFiles: [{ file: 'vercel.json', usage: 'application', when: 'crons' }] },
    hosts: [{ host: 'api.vercel.com' }, { host: 'vercel.com' }, { host: 'edge-config.vercel.com' }],
    // a World's applications hold a token, a project and an Edge Config the dashboard made, never fixtures
    credentialDoor: { account: { field: 'account' }, path: '/_twin/app-credentials', body: { team: 'world', project: 'world' }, fill: { VERCEL_API_KEY: 'token', VERCEL_TOKEN: 'token', TEAM_ID_VERCEL: 'team_id', PROJECT_ID_VERCEL: 'project_id', VERCEL_PROJECT_ID: 'project_id', EDGE_CONFIG: 'edge_config', EDGE_CONFIG_ID: 'edge_config_id' } },
    endpointEnvNone: 'the applications reach api.vercel.com and the Edge Config connection string\'s host, which the World routes to the twin',
  },
};
