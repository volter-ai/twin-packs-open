// Upstash's manifest: Redis over Upstash's REST API (this unit, `https://<endpoint>.upstash.io`), with the Developer API
// and the console (the `api` lane, api.upstash.com and console.upstash.com) and QStash with Workflow (the `qstash` lane,
// qstash.upstash.io) as the vendor's other APIs (architecture, "Other wires: lanes").
//
// THE SURFACE is Redis's command table (./generated/surface.gen.json, from ../spec/commands by derive-pack), the
// commands Upstash's own reference lists. It names no HTTP operation: the REST envelope is Upstash's page's words
// (https://upstash.com/docs/redis/features/restapi), which the front (./semantics/around.ts) reads, running a request's
// commands with the kernel's Redis core under Upstash's dialect (./semantics/shared.ts). Architecture, "Other wires": a
// vendor that carries Redis over HTTP.
//
// SCOPE FROM THE DEMAND AND THE LIFE (../journeys/demand.json, ../journeys/customer-life.json): the commands Dub sends
// through @upstash/redis, its lock's script and @upstash/ratelimit, and those the life sends, are served
// (./semantics/shared.ts, SERVED); every other command of the table is the gap, refused as Upstash refuses a command it
// does not have. Each served command is decided in ../journeys/decisions.json.
//
// THE STATE. A database is the console's (the api lane's `database`, its REST endpoint and its two tokens); its keys and
// cached scripts are the kernel Redis library's subjects in the database's own scope (`db:<id>:key:<name>`,
// `db:<id>:script:<sha1>`). No command moves a declared state: a key's TTL is a deadline its reads compare with the World
// clock, and a key's kind is fixed by the command that makes it (WRONGTYPE otherwise). So no state machine is declared.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'upstash',
  service: 'upstash',
  discovery: {
    twinOf: 'Upstash: Redis over its REST API, with the Developer API and console (the `api` lane) and QStash with Workflow (the `qstash` lane)',
    stores: 'databases with their REST endpoints and tokens, each database\'s keys and scripts, and QStash\'s messages, schedules and workflow runs',
  },
  body: {},
  deleted: undefined,
  ids: { template: '{uuid}' },
  time: 'unix',
  // the REST API's refusal: `{ error }` with the Redis error text (restapi: "If command is rejected or fails, response
  // JSON will have a single error field")
  error: { error: '{message}' },
  // a World started read-only refuses a write as Upstash's REST API refuses a method it does not take
  readOnly: { status: 405, message: 'ERR twin: this World was started read-only' },
  notFound: { status: 400, message: 'ERR empty command' },
  resources: {},
  // a Redis command is answered by the kernel's Redis core over the database's keys; the derived adapters perform and
  // refresh HTTP operations, and the command table names none (architecture, "Other wires"): the QStash lane's are derived
  vendorBacked: { none: "a Redis command over Upstash's REST API is one turn over the database's keys: replayed alone (an INCR, a script) it does not repeat what it did, and the command table names no operation the derived adapters perform or read back, so the World's commands are never sent" },
  lanes: {
    routes: [
      { lane: 'api', host: '^(api|console)\\.upstash\\.com$' },
      { lane: 'qstash', host: '^qstash(-[a-z0-9-]+)?\\.upstash\\.io$' },
    ],
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-upstash',
    resources: ['database', 'key', 'script', 'message', 'queue', 'workflow_run'],
    specSource: "spec/commands (Redis's command table at 8.4.7, the commands Upstash's reference lists), qstash/spec (QStash's OpenAPI document) and api/spec (the Developer API's), provenance in each SOURCE.md",
    description: "Upstash twin — Redis over Upstash's REST API (a command in the path or the body, pipelines, transactions, base64 answers, Standard and Read Only tokens, Lua run by EVAL), databases made in the console, and QStash with Workflow (publish, batch, queues, signed deliveries retried on QStash's backoff, cancel by label, workflow runs).",
    adoption: {
      sdks: ['@upstash/redis', '@upstash/ratelimit', '@upstash/qstash', '@upstash/workflow'],
      envStems: ['UPSTASH', 'UPSTASH_REDIS', 'QSTASH', 'KV_REST_API'],
    },
    hosts: [{ suffix: '.upstash.io' }, { suffix: '-vector.upstash.io', exclude: true }, { host: 'console.upstash.com' }, { host: 'api.upstash.com' }],
    // a World's applications hold the database and QStash credentials the console made, never fixtures
    credentialDoor: {
      path: '/_twin/app-credentials', body: { owner: 'owner@world.test' },
      fill: { UPSTASH_REDIS_REST_URL: 'redis_url', UPSTASH_REDIS_REST_TOKEN: 'redis_token', KV_REST_API_URL: 'redis_url', KV_REST_API_TOKEN: 'redis_token', QSTASH_TOKEN: 'qstash_token', QSTASH_CURRENT_SIGNING_KEY: 'qstash_current_signing_key', QSTASH_NEXT_SIGNING_KEY: 'qstash_next_signing_key' },
    },
    // @upstash/qstash and @upstash/workflow read QSTASH_URL
    // source: https://upstash.com/docs/redis/howto/connect-with-upstash-redis "UPSTASH_REDIS_REST_URL"
    endpointEnv: { name: 'UPSTASH_TWIN_URL', templates: { QSTASH_URL: '${url}', UPSTASH_REDIS_REST_URL: '${url}', KV_REST_API_URL: '${url}' }, note: 'Redis reads its REST URL; QStash and Workflow read QSTASH_URL. Direct SDK transports use the twin endpoint and issued token; other clients also use host routing.' },
  },
};
