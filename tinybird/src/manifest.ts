// Tinybird's manifest: the vendor facts its own client does not carry (docs/contributing/architecture.md, "Protocol
// 3"). The surface is generated (./generated/surface.gen.json, from ../spec/client-ops.json by derive-pack): the
// requests Tinybird's Python client (tinybird-cli 6.5.5, class TinyB) makes, read as operations, each `action`, since a
// client says nothing of what an answer holds and so names no resource. The derived core therefore claims no operation:
// the ones the demand, the life and a refresh read reach are served by semantics handlers (semantics/, over
// semantics/shared.ts and the kernel's ClickHouse engine under ../engine/), every other answers the gap
// (journeys/decisions.json). The console's pages at cloud.tinybird.co stand in front (screens/console.tsx).
//
// WHY NO `auth`. Tinybird reads its token from `Authorization: Bearer <token>` or from the `token` query parameter, and
// a token's grant is its scopes, some of them per resource (`PIPES:READ:<pipe>`). The kernel's `auth` reads one header
// and grants all or nothing, so it can state neither; the twin's own gate keeps both (semantics/shared.ts,
// `requestToken` and `hasScope`).
// source: https://www.tinybird.co/docs/api-reference "There are two ways to authenticate your requests in the Tinybird API: using an authorization header, or using a URL parameter."
//
// THE STATE. One Workspace's resources, each stored as the API answers it (semantics/shared.ts, its header): a Workspace
// under its id, and its Data Sources, Pipes, tokens, tags and jobs under `<workspace id>/<kind>:<name or id>` with the
// Workspace's id in `ws` (each resource's `parent` and `key`), so a refresh's observations land where the handlers read
// them. Each row of a Data Source is an `event`; a row of tinybird.pipe_stats_rt, which Tinybird writes as it answers a
// read, is the World's `_event`. Times are ClickHouse's naive `YYYY-MM-DD HH:MM:SS.mmm`.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'tinybird',
  service: 'tinybird',
  // the client sends forms (`name=…&sql=…`), JSON (tags) and NDJSON (events) each labelled; nothing is read as JSON
  // whatever its label
  body: {},
  // the core mints no id (it owns no operation); a Workspace's, a job's and an Organization's are minted uuids (their
  // resources' `ids`), a Data Source's, Pipe's and tag's `t_<hex>` derived from its Workspace and name
  ids: { template: '{prefix}_{n}' },
  time: 'iso',
  // source: https://www.tinybird.co/docs/api-reference "In case of errors, responses include additional information in JSON format."
  // where the page stops: it prints no error body; `{error, documentation}` is the body @chronark/zod-bird reads an
  // error's message from (`error.error`, dist/index.mjs)
  error: { error: '{message}', documentation: 'https://www.tinybird.co/docs/api-reference' },
  readOnly: { status: 405, message: 'twin is read-only; omit readOnly to accept writes' },
  malformedBody: { status: 400, message: 'malformed request body' },
  notFound: { status: 404, message: 'not found' },
  // What the twin answers a request it has no operation for, in Tinybird's error body: a path the surface serves under
  // other methods is 405, any other 404. Where the documentation stops: the reference pages print no answer for an
  // unknown path or method; these are the statuses and body the twin has always answered.
  gap: { status: 404, message: 'Not found: {method} {path}' },
  wrongMethod: { status: 405, message: 'Method not allowed: {method} {path}' },
  // source: https://www.tinybird.co/docs/api-reference/events-api "You can compress JSON events with Gzip or Zstandard and send the compressed payload to the Events API."
  // source: https://www.tinybird.co/docs/api-reference "To compress API responses, add Accept-Encoding: gzip to your requests."
  // The refusal of a body that does not decode is the twin's.
  encodings: {
    request: ['gzip', 'zstd'],
    response: ['gzip'],
    undecodable: { status: 400, message: 'The body does not decode as its Content-Encoding says' },
  },
  discovery: {
    twinOf: 'the Tinybird real-time analytics API',
    stores: "Workspaces, their Data Sources and rows (quarantine included), Pipes and Endpoints, tokens, tags and jobs",
  },
  // the World's doors (./semantics/doors.ts)
  doors: [
    { id: 'mailbox', method: 'GET', path: '/_twin/mailbox/{email}', note: "the World's stand-in for a person's inbox, where the console's one-time code arrives" },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: "the admin token the World's application holds, as the runtime issues it at every boot" },
  ],
  // Tinybird's lists are arrays under the resource's plural (`{"tokens": [...]}`, `{"datasources": [...]}`), unpaged;
  // each is answered by a handler. Required by the type; the core lists nothing.
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: {},
  // Tinybird's console (screens/console.tsx): where a Workspace and its first tokens are made, and a plan is canceled
  screens: [{
    id: 'signup', kind: 'flow', host: 'cloud.tinybird.co', path: '/signup',
    demand: 'a Tinybird account, before any Workspace or token exists', status: 'done',
    controls: ['Email', 'Password', 'Sign up'], source: 'https://www.tinybird.co/docs/classic/get-started/quick-start',
  }, {
    id: 'login', kind: 'flow', host: 'cloud.tinybird.co', path: '/login',
    demand: 'every console page asks who is signed in', status: 'done',
    controls: ['Email', 'Password', 'Log in', 'One-time code', 'Continue'], source: 'https://www.tinybird.co/docs/changelog/2025-09-05-september-week-one',
  }, {
    id: 'organization', kind: 'flow', host: 'cloud.tinybird.co', path: '/organizations/new',
    demand: '"Workspaces are always created inside Organizations"', status: 'done',
    controls: ['Organization name', 'Region', 'Create Organization'], source: 'https://www.tinybird.co/docs/classic/administration/workspaces',
  }, {
    id: 'workspace', kind: 'flow', host: 'cloud.tinybird.co', path: '/workspaces/new',
    demand: 'a Workspace, created with its default tokens', status: 'done',
    controls: ['Workspace name', 'Organization', 'Tinybird version', 'Create Workspace'], source: 'https://www.tinybird.co/docs/classic/administration/workspaces',
  }, {
    id: 'tokens', kind: 'flow', host: 'cloud.tinybird.co', path: '/{provider}/{region}/{workspace}/tokens',
    demand: "the API's first token is read here", status: 'done',
    source: 'https://www.tinybird.co/docs/classic/administration/auth-tokens',
  }, {
    id: 'billing', kind: 'flow', host: 'cloud.tinybird.co', path: '/organizations/{organization}/billing',
    demand: 'billing details added, a Developer plan chosen, and canceled with its final invoice charged', status: 'done',
    controls: ['Cardholder name', 'Card number', 'Expiry (MM/YY)', 'CVC', 'Country', 'Save billing details', 'Plan size', 'Upgrade', 'Cancel plan'],
    source: 'https://www.tinybird.co/docs/classic/pricing/developer',
  }, {
    // every page of the console's host, the ones above among them
    id: 'console', kind: 'workspace', host: 'cloud.tinybird.co', path: '/',
    demand: "a Workspace and its first tokens are made only on the console", status: 'done',
    source: 'https://www.tinybird.co/docs/classic/administration/auth-tokens',
  }],
  resources: {
    _identity: { idPrefix: '', ids: '{uuid}' },
    _seq_login_code: { idPrefix: '', ids: '{n}' },
    _organization: { idPrefix: '', ids: '{uuid}' },
    // A Workspace, read back by the one the root's token belongs to.
    // source: https://www.tinybird.co/docs/api-reference "A workspace belongs to a region."
    Workspace: { storedAs: 'workspace', idPrefix: '', ids: '{uuid}', unique: [{ fields: ['name'], refusal: { status: 422, message: 'A Workspace with that name already exists.' } }], refresh: { get: 'workspace_info' } },
    // Each list below is one answer (its page names no page or limit parameter) of the Workspace the token belongs to,
    // read once per Workspace observed (`parent`, no path parameter: the token names it).
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "Get a list of the Data Sources in your account."
    // source: https://www.tinybird.co/docs/api-reference/datasource-api "only those accessible with the token you are using will be returned in the response."
    Datasource: {
      storedAs: 'datasource', idPrefix: 't', parent: { resource: 'Workspace', field: 'ws' }, key: '{ws}/datasource:{name}', adoptBy: ['name'],
      refresh: { list: 'datasources', items: 'datasources', unpaginated: true },
    },
    // source: https://www.tinybird.co/docs/api-reference/pipe-api "Get a list of pipes in your account."
    Pipe: {
      storedAs: 'pipe', idPrefix: 't', parent: { resource: 'Workspace', field: 'ws' }, key: '{ws}/pipe:{name}', adoptBy: ['name'], ...states.Pipe,
      refresh: { list: 'pipes', items: 'pipes', unpaginated: true },
    },
    // source: https://www.tinybird.co/docs/api-reference/token-api "Retrieves all workspace Static Tokens."
    Token: {
      storedAs: 'token', idPrefix: 'p', parent: { resource: 'Workspace', field: 'ws' }, key: '{ws}/token:{name}', adoptBy: ['name'],
      // the Token API's list answers each token's secret value; a World's tree never holds the account's live credentials
      // (credential custody, architecture "Refresh"), so a token is not read back
      refresh: { none: "the Token API's read answers each token's live secret value, which credential custody keeps out of a World's tree" },
    },
    // the tags tinybird-cli reads back (`get_all_tags`: no page documents the Tags API; the CLI's own request)
    Tag: {
      storedAs: 'tag', idPrefix: 't', parent: { resource: 'Workspace', field: 'ws' }, key: '{ws}/tag:{name}', adoptBy: ['name'],
      refresh: { list: 'get_all_tags', items: 'tags', unpaginated: true },
    },
    // A job's `status` (waiting, working, done, error) is the vendor's move as its work runs, not the twin's: the twin runs
    // a delete or an import at once and stores its job already `done`, so it declares no move of it. The list is the last
    // 100 jobs of the last 48 hours, not every job.
    // source: https://www.tinybird.co/docs/api-reference/jobs-api "We can get a list of the last 100 jobs in the last 48 hours"
    Job: {
      storedAs: 'job', idPrefix: '', ids: '{uuid}', parent: { resource: 'Workspace', field: 'ws' }, key: '{ws}/job:{id}',
      refresh: { list: 'jobs', items: 'jobs', unpaginated: true, complete: false },
    },
    // A row of a Data Source. Tinybird gives a row no id: its reads (the Query API, an Endpoint) answer a query's result,
    // never a row by an id, so no refresh can tell a row the World holds from one it lacks, or one deleted from one never
    // sent. A row is sent by the request that wrote it (an append, a delete by condition, a truncate), and is read only
    // through the World's own rows.
    // source: https://www.tinybird.co/docs/api-reference/events-api "The Events API isn't idempotent. Sending the same data more than once inserts it multiple times."
    Event: {
      storedAs: 'event', idPrefix: 'event', parent: { resource: 'Workspace', field: 'ws' },
      refresh: { none: "a Data Source's rows have no id at Tinybird: its Query API and Endpoints answer a query's result, never a row by an id, so no read tells a row held from one lacking (the Events API inserts the same data twice when sent twice)" },
    },
  },
  // The fail-closed ceiling on live calls against Tinybird (world-core rateBudget.ts, architecture D8), inside its
  // documented ingestion limits: a Data Sources API post (a create from a schema, an append of a file) is priced at 12
  // of the 60 a minute, so at most five a minute go, the documented shared quota; the Events API's allowance is 100
  // requests a second.
  // source: https://www.tinybird.co/docs/classic/pricing/limits "Append data to Data Source using POST /v0/events 100 times per second"
  // source: https://www.tinybird.co/docs/classic/pricing/limits "You can do at most a grand total of 5 requests of those types combined."
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 6000, source: 'https://www.tinybird.co/docs/classic/pricing/limits' },
    windowMs: 60_000,
    ceiling: 60,
    defaultWeight: 1,
    maxRetryAfterSeconds: 300,
    rules: [
      { match: '^POST /v0/datasources$', weight: 12 },
    ],
    reason:
      "Tinybird's Classic limits page (read 2026-10-02): the Events API takes 100 requests a second; creating, appending to or " +
      'replacing a Data Source through POST /v0/datasources shares one quota of 5 a minute (25 a minute for a create from a ' +
      'schema); over a limit, 429 with X-RateLimit headers. 60 weighted units a minute is 1% of the Events API allowance; a ' +
      'POST /v0/datasources costs 12, so at most 5 a minute.',
  },
  descriptor: {
    protocol: '3',
    // The hosts: every Workspace's region has its own API host, `api.<region>.tinybird.co` or the bare api.tinybird.co,
    // each serving the same `/v0/` paths, and regions are added over time, so one pattern takes the family; and the
    // console, cloud.tinybird.co, whose pages the manifest's `screens` answer. Not claimed: www.tinybird.co (the site and
    // its docs), the ClickHouse interface's and the MCP server's hosts (other protocols the twin does not serve, left to
    // fail closed).
    // source: https://www.tinybird.co/docs/api-reference "The API for each region has a specific API base URL that you use to make API requests."
    hosts: [
      { host: 'api.tinybird.co' },
      { hostPattern: '^api\\.[a-z0-9.-]+\\.tinybird\\.co$' },
      { host: 'cloud.tinybird.co' },
    ],
    // the application's TINYBIRD_API_KEY (Dub's name), issued once the twin is up (./semantics/doors.ts appCredentials)
    credentialDoor: {
      account: { field: 'account', tenancy: 'organization', source: 'https://www.tinybird.co/docs/classic/administration/workspaces' },
      deployment: { field: 'deployment', object: 'workspace', source: 'https://www.tinybird.co/docs/classic/administration/workspaces' },
      path: '/_twin/app-credentials', body: {}, fill: { TINYBIRD_API_KEY: 'token', TINYBIRD_TOKEN: 'token' },
    },
    // Tinybird's clients take the API host as configuration (@chronark/zod-bird's `baseUrl`, which Dub fills from its own
    // TINYBIRD_API_URL; tinybird-cli's `--host`), defaulting to https://api.tinybird.co, which the World's injector
    // routes by host: no SDK reads a base-URL variable of its own.
    endpointEnvNone: "Tinybird's clients take the API host as configuration (@chronark/zod-bird's baseUrl, tinybird-cli's --host), defaulting to https://api.tinybird.co, which the World routes by host; no SDK reads a base-URL variable of its own",
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-tinybird',
    resources: ['workspace', 'datasource', 'pipe', 'event', 'token', 'job', 'tag'],
    specSource: "Tinybird's client operations (spec/client-ops.json, provenance in spec/SOURCE.md)",
    description: "Tinybird Classic twin: the Events API with quarantine, Data Sources made from a schema and appended to, Pipes from SQL with Materialized Views and published JSON Endpoints run by the kernel's ClickHouse engine, the Query API, Static Tokens with their scopes, tags, jobs and Workspace deletion, and the console's sign-up, Workspace, Tokens and billing pages.",
    // every region serves the same `/v0/` paths; api.tinybird.co is the default host the docs and @chronark/zod-bird
    // fall back to when no region is configured
    browserRouting: { apiPathPrefix: '/v0/', loaderHost: 'https://api.tinybird.co' },
    // source: https://raw.githubusercontent.com/chronark/zod-bird/3f35518bdbb6b4eda6cc88d19c538729246e0f6f/package.json "\"author\": \"Andreas Thomas\""
    clientCasesNone: "@chronark/zod-bird is a third-party client; no demanded application uses Tinybird's official @tinybirdco/sdk. adoption.sdks names only @chronark/zod-bird.",
    adoption: {
      // Tinybird's own Python SDK and its CLI (both published by tinybird.co)
      pypi: ['tinybird-python-sdk', 'tinybird-cli'],
      sdks: ['@chronark/zod-bird'], scopes: ['@chronark/zod-bird'], envStems: ['TINYBIRD'],
    },
  },
};
