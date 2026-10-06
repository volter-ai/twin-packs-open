// Upstash's console and Developer API (the upstash pack's `api` lane; docs/contributing/architecture.md, "Other wires:
// lanes"): console.upstash.com, where a person makes a Redis database and reads its endpoint and tokens, and opens QStash
// and reads its token and signing keys; and api.upstash.com/v2, the Developer API, from its published OpenAPI document
// (../spec/openapi.yaml; the surface ./generated/surface.gen.json).
//
// SCOPE FROM THE DEMAND (../../journeys/demand.json): no application calls the Developer API; each takes its database's
// REST URL and token, and QStash's token and keys, from the console. So the console's pages are served (./screens) and
// every Developer API operation is the gap: its resources are declared for what the console stores, in the API's
// shapes, and their operations are `unmodeled`.
//
// THE STATE is the vendor's (service `upstash`), shared with the pack's Redis front and the qstash lane: a database
// (the Database schema, with its password and its two REST tokens, which the console shows whenever it is opened), and
// an account's QStash (the QStashUser schema, its token; the signing keys beside it, which QStash's own API answers).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'upstash',
  service: 'upstash',
  body: { json: 'always' },
  // database and QStash ids are UUIDs (the schemas' examples)
  ids: { template: '{uuid}' },
  // `creation_time`: "Creation time of the database as Unix time"
  time: 'unix',
  // the document declares no error response; the twin answers in its own `Error` schema ({code, message})
  error: { code: '{code}', message: '{message}' },
  readOnly: { status: 403, code: 'forbidden', message: 'The twin is read-only' },
  malformedBody: { status: 400, code: 'bad_request', message: 'The request body is not valid JSON' },
  notFound: { status: 404, code: 'not_found', message: 'not found' },
  list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 100, max: 100 } },
  deleted: 'OK',
  // the Developer API, which no application calls: the gap
  unmodeled: ['createDatabase', 'getDatabase', 'deleteDatabase', 'listDatabases', 'enableTls', 'renameDatabase', 'resetPassword', 'resetQStashToken', 'getQStashUser', 'listQStashUsers'],
  doors: [
    { id: 'users', method: 'POST', path: '/_twin/users/{email}', note: "{ password }: a person who can sign in to the console (the World's stand-in for Upstash's sign-up)" },
    { id: 'appCredentials', method: 'POST', path: '/_twin/app-credentials', note: '{ owner? }: an application\'s Upstash credentials (a Redis database and the account\'s QStash), as the runtime issues them' },
  ],
  screens: [{
    id: 'sign-in', kind: 'flow', host: 'console.upstash.com', path: '/login',
    demand: 'every console page a person reaches asks who is signed in', status: 'done',
    controls: ['Email', 'Password', 'Sign in'], source: 'https://upstash.com/docs/redis/overall/getstarted',
  }, {
    id: 'redis', kind: 'workspace', host: 'console.upstash.com', path: '/redis',
    demand: "a database's REST URL and token (UPSTASH_REDIS_REST_URL and _TOKEN, the applications' only Redis credentials) are made and shown only here",
    status: 'done', controls: ['Create Database', 'Name', 'Primary Region', 'Create', 'Read-Only Token', 'Delete'],
    source: 'https://upstash.com/docs/redis/overall/getstarted',
  }, {
    id: 'qstash', kind: 'workspace', host: 'console.upstash.com', path: '/qstash',
    demand: "QStash's token and signing keys (QSTASH_TOKEN and the two signing keys the applications verify with) are shown, the token reset and the keys rolled, only here",
    status: 'done', controls: ['Region', 'Reset token', 'Roll keys'], source: 'https://upstash.com/docs/qstash/howto/reset-token',
  }],
  resources: {
    // a Redis database: made on the console's Redis page. Not state the twin moves: `state` is active from its create;
    // its plan, regions and limits are set when it is made
    Database: { storedAs: 'database', idPrefix: '', idAs: 'database_id', ...states.Database, refresh: { none: 'listDatabases is not served by the twin (no demand or life calls the Developer API); a database is made on the console\'s Redis page' } },
    // an account's QStash, made when its owner first opens the QStash page in a region (its region fixed then; active from
    // its making: no served operation moves either)
    QStashUser: { storedAs: 'qstash_user', idPrefix: '', ...states.QStashUser, refresh: { none: "getQStashUser is not served by the twin (no demand or life calls the Developer API); an account's QStash is opened on the console's QStash page" } },
  },
};
