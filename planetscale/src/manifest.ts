// PlanetScale's manifest: psdb (this unit, `psdb.v1alpha1.Database`, the HTTP API PlanetScale's driver sends SQL to, at
// a password's host `<region>.connect.psdb.cloud`), with the dashboard and the management API as the `api` lane
// (app.planetscale.com, api.planetscale.com/v1; architecture, "Other wires: lanes").
//
// THE SURFACE is generated (./generated/surface.gen.json, from ../spec/proto): the Connect service's five RPCs, all
// actions. Execute is what the applications call (../journeys/demand.json: Dub's driver and Prisma's PlanetScale
// adapter, and Substrate's Prisma client in a tab), served by ./semantics/psdb.ts; CreateSession, StreamExecute, Prepare
// and CloseSession are the gap.
//
// THE STATE. A statement's semantics are MySQL's as PlanetScale's Vitess serves them (./engine, pure: its parser,
// values, collations and information schema); the tables and rows it writes are the tree's, one subject each
// (./semantics/shared.ts), in the database the password names. A session is bookkeeping (`_session`): its open
// transaction's writes, its variables. No declared state moves: a session is carried, not closed, by what the
// applications call.
//
// WHY NO `auth`. psdb reads `Authorization: Basic base64(username:password)`, a branch password the dashboard made, and
// answers a failure as 401 in its own `{ session, error }` envelope, which the kernel's gate cannot state; the handler
// reads the password (./semantics/shared.ts) and its role decides each statement.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'planetscale',
  service: 'planetscale',
  // the SQL wire sends nothing to the vendor: a statement replayed out of its session (a lone COMMIT) does not do again what
  // it did, so a deploy settles psdb's writes as the World's; the API lane's are performed (architecture, "Perform")
  vendorBacked: { none: "a SQL statement is one turn of a session over the database's own connection; replayed alone (a COMMIT without its transaction) it does not repeat what it did, so the World's SQL is never sent" },
  discovery: {
    twinOf: 'PlanetScale\'s database HTTP API (psdb, at a password\'s `<region>.connect.psdb.cloud`), with its management API and dashboard as the `api` lane',
    stores: 'organizations, databases, branches and passwords, and each database\'s tables and rows as PlanetScale\'s Vitess holds them',
  },
  // the driver always sends JSON (`Content-Type: application/json`, @planetscale/database's postJSON)
  body: { json: 'always' },
  ids: { template: '{hex:32}' },
  time: 'iso',
  // Connect's transport-level error body: a lowercase code and a message, no wrapper
  error: { code: '{code}', message: '{message}' },
  readOnly: { status: 403, code: 'permission_denied', message: 'the twin is read-only' },
  malformedBody: { status: 400, code: 'invalid_argument', message: 'malformed JSON request body' },
  notFound: { status: 404, code: 'not_found', message: 'not found' },
  // psdb has no list operation: an Execute's rows are its result. Required by the type; nothing reads it.
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: {},
  // the RPCs no application calls: the gap
  unmodeled: ['CreateSession', 'StreamExecute', 'Prepare', 'CloseSession'],
  lanes: {
    routes: [{ lane: 'api', host: '^(api|app)\\.planetscale\\.com$' }],
  },
  resources: {
    Session: { storedAs: '_session', idPrefix: '', refresh: { none: "a session is the client's own: psdb hands it back with each answer and holds no list of them to read" } },
    // psdb's surface has no list or get: a table and its rows are read only by running SQL (Execute), which is not a read
    // the derived refresh can make
    Table: { storedAs: 'table', idPrefix: '', refresh: { none: "psdb has no operation that lists a branch's tables; they are read by running SQL (Execute)" } },
    Row: { storedAs: 'row', idPrefix: '', refresh: { none: "psdb has no operation that lists a table's rows; they are read by running SQL (Execute)" } },
  },
  // The management API's documented allowance, on the vendor's one ledger (psdb's SQL is charged on it too, the dearer
  // reading: its own limits are a database's, not a request rate)
  // source: https://planetscale.com/docs/api/reference/rate-limits "The current rate limit on the PlanetScale API is 600 requests per minute"
  // source: https://planetscale.com/docs/api/reference/rate-limits "This rate limit is subject to change"
  rateBudget: {
    // the vendor's documented allowance this budget stays inside (cited above)
    allowance: { perMinute: 600, source: 'https://planetscale.com/docs/api/reference/rate-limits' },
    reason: 'PlanetScale documents its API rate limit as 600 requests per minute, subject to change, and answers past it with 429 (https://planetscale.com/docs/api/reference/rate-limits); the budget holds a minute to that 600 at one unit a call.',
    windowMs: 60_000, ceiling: 600, defaultWeight: 1, maxRetryAfterSeconds: 120,
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-planetscale',
    resources: ['database', 'password', 'service_token', 'backup', 'table', 'row'],
    specSource: "spec/proto (psdb.v1alpha1, PlanetScale's Connect service) and api/spec (the management API's Swagger document), provenance in each SOURCE.md",
    description: "PlanetScale twin — SQL over psdb (the HTTP API @planetscale/database and Prisma's PlanetScale adapter speak) and over MySQL's native wire (the connection string Prisma reads), both MySQL as PlanetScale's Vitess serves it over one database, transactions in the client's session, a branch password's role; the dashboard that makes databases, passwords and service tokens, and the management API's branch backups.",
    adoption: { sdks: ['@planetscale/database', '@prisma/adapter-planetscale'], envStems: ['PLANETSCALE'] },
    hosts: [{ suffix: '.psdb.cloud' }, { host: 'api.planetscale.com' }, { host: 'app.planetscale.com' }],
    // the applications' connection strings are a password the dashboard made (the credentialDoor), never a fixture
    // password psdb would refuse. PLANETSCALE_DATABASE_URL is the HTTP driver's, at the region's *.connect.psdb.cloud host
    // the injector routes to this twin: Dub's HTTP paths read it before DATABASE_URL (apps/web/lib/prisma/edge.ts:6,
    // lib/planetscale/connection.ts:4), and Substrate's Prisma stand-in reads it first
    // (packages/node/src/prisma-client-stand-in.ts:417). DATABASE_URL is the native MySQL wire's, at the twin's `mysql`
    // side port as the boot placed it (the `side:` fill): Dub's PrismaClient (apps/web/lib/prisma/index.ts) and its
    // jackson (lib/jackson.ts:25) connect over it.
    endpointEnv: { name: 'PLANETSCALE_TWIN_URL', note: 'the twin\'s own URL; applications reach it at <region>.connect.psdb.cloud, which the injector redirects, with the password the credentialDoor issued.' },
    credentialDoor: { account: { field: 'account', tenancy: 'Organization', source: 'https://planetscale.com/docs/vitess/connecting/connection-strings' }, deployment: { field: 'deployment', object: 'Database', source: 'https://planetscale.com/docs/vitess/schema-changes/branching' }, path: '/_twin/app-credentials', body: {}, fill: { PLANETSCALE_DATABASE_URL: 'http_url', DATABASE_URL: 'side:mysql:native_url' } },
    sidePorts: [{ name: 'mysql', option: 'wirePort', flag: '--wire-port', note: 'MySQL\'s native wire over the same database psdb serves (mysql_native_password, text and prepared statements)' }],
    prismaAdapter: { adapter: '@prisma/adapter-planetscale', export: 'PrismaPlanetScale', urlEnv: 'PLANETSCALE_DATABASE_URL' },
  },
};
