// E2B's manifest: a vendor of two APIs, each a lane (architecture, "Other wires: lanes"): its REST API (`api`,
// api.e2b.app: sandboxes and templates) and each sandbox's own process door (`envd`, `49983-<sandboxID>.e2b.app`, the
// Connect protocol over HTTP). RH2 calls both (../journeys/demand.json).
import type { VendorManifest } from '@volter/world-core';

export const manifest: VendorManifest = {
  vendor: 'e2b',
  discovery: {
    twinOf: "E2B's sandboxes as RH2 runs Task machines in them: a sandbox started from a template (its image on the World's machine pool), a process started in it through envd, the sandbox killed; sandboxes and templates listed; light-pool SDK command execution beyond node with a folder-owned JS entry is unserved and answers the declared gap",
    stores: 'teams and their API keys (by their SHA-256), templates, sandboxes with their states',
  },
  lanes: {
    routes: [
      // The SDK's sandboxUrl override uses the same sandbox id/port headers at the World's endpoint.
      { lane: 'envd', host: '^', header: { name: 'e2b-sandbox-port', prefix: '49983' } },
      { lane: 'jupyter', host: '^49999-[a-z0-9]+\\.e2b\\.(app|dev)$' },
      { lane: 'envd', host: '^49983-[a-z0-9]+\\.e2b\\.(app|dev)$' },
      { lane: 'api', host: '^api\\.e2b\\.(app|dev)$' },
    ],
    default: 'api',
  },
  // E2B's documented limits, per project, on its Hobby plan (the least a root's account has): a sandbox created a second,
  // and its lists ten requests a second, each endpoint apart; past one, 429 with Retry-After. The ledger holds every call
  // to the creation rate, 60 a minute, which no list nears. envd (each sandbox's own door) documents no request limit.
  // source: https://docs.e2b.dev/billing "1/s"
  // source: https://docs.e2b.dev/billing "The following default limits are in requests per second, per project, per endpoint"
  // source: https://docs.e2b.dev/billing "If you exceed a limit, you receive an HTTP 429 Too Many Requests response with a Retry-After header."
  rateBudget: {
    reason: "E2B's Billing & limits page (https://docs.e2b.dev/billing) documents, per project on the Hobby plan, a sandbox creation rate of 1 a second and 10 requests a second for each list endpoint (GET /v2/sandboxes, GET /v2/templates), each endpoint apart, answered 429 with Retry-After past it. Every call is held to the creation rate, 60 a minute, the tightest documented allowance.",
    windowMs: 60_000, ceiling: 60, defaultWeight: 1, maxRetryAfterSeconds: 60,
    allowance: { perMinute: 60, source: 'https://docs.e2b.dev/billing' },
  },
  // a vendor-backed World's root: the project's sandbox lifecycle webhooks sent to the World's ingest door, signed in
  // `e2b-signature` with the SHA-256 of the signature secret followed by the body, base64 with its trailing = removed;
  // the event names its type at `type` and its sandbox at `sandbox_id`. A killed sandbox is gone. The other types carry
  // no sandbox object (created, updated: its timeout in event_data.set_timeout; paused, resumed, checkpointed): the
  // event's body would be folded as the sandbox's fields, so they are acknowledged and fold nothing, and the sandbox's
  // state is read back by the refresh (get_v2_sandboxes).
  // source: https://docs.e2b.dev/sandbox/lifecycle-events-webhooks "each request includes a signature in the e2b-signature header"
  // source: https://docs.e2b.dev/sandbox/lifecycle-events-webhooks "You can verify the signature using the signature secret you provided when registering the webhook"
  // source: https://docs.e2b.dev/sandbox/lifecycle-events-webhooks "they are used as the type field in the payload"
  // source: https://docs.e2b.dev/sandbox/lifecycle-events-webhooks "sandbox.lifecycle.killed - Sandbox termination"
  ingest: {
    scheme: { kind: 'hash', header: 'e2b-signature', signed: '{secret}{body}', encoding: 'base64-unpadded' },
    type: { body: 'type' },
    object: '$body',
    types: { 'sandbox.lifecycle.killed': { resource: 'sandbox', id: 'sandbox_id', deleted: true } },
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-e2b',
    resources: ['sandbox', 'template'],
    specSource: "E2B's REST document (api/spec/SOURCE.md) and envd's process proto (envd/spec/SOURCE.md)",
    description: "E2B twin — sandboxes started from templates on the World's machine pool, processes started in them through envd, and their end, as RH2 runs Task machines; light-pool SDK command execution beyond node with a folder-owned JS entry is unserved and answers the declared gap",
    adoption: { sdks: ['e2b', '@e2b/code-interpreter'], envStems: ['E2B'] },
    clientCasesNone: 'The one application the demand measures, RH2, starts, drives and kills its sandboxes with fetch and its x-api-key (bots/runhuman-model/machine.ts, 34fdc937), using neither e2b nor @e2b/code-interpreter; no official SDK behavior is relied on.',
    hosts: [{ host: 'api.e2b.app' }, { suffix: '.e2b.app' }, { host: 'api.e2b.dev' }, { suffix: '.e2b.dev' }],
    // ConnectionConfig._api_url reads the override at line 186; __init__ applies it at lines 259–263.
    // source: archive:https://files.pythonhosted.org/packages/b9/83/25fe5f56d75acff5c6978f29f88f4f89848d5396f6ff383c95a37b6ede91/e2b-2.45.0-py3-none-any.whl#sha256=fc69c9ba72dea63e4bc927655d379c4967b15ce3af7b442d17e131cf2dae6699!/e2b/connection_config.py "E2B_API_URL"
    // JS e2b@2.45.0: package/dist/index.js line 1300 reads the sandbox URL; lines 5281–5282 send the routing headers.
    // source: archive:https://registry.npmjs.org/e2b/-/e2b-2.45.0.tgz#sha256=2939ae9488cef2da193cc928bbd03769490732c7435cfb1781183c31f7b70905!/package/dist/index.js "E2B_SANDBOX_URL"
    // source: archive:https://registry.npmjs.org/e2b/-/e2b-2.45.0.tgz#sha256=2939ae9488cef2da193cc928bbd03769490732c7435cfb1781183c31f7b70905!/package/dist/index.js "E2b-Sandbox-Id"
    // source: archive:https://registry.npmjs.org/e2b/-/e2b-2.45.0.tgz#sha256=2939ae9488cef2da193cc928bbd03769490732c7435cfb1781183c31f7b70905!/package/dist/index.js "E2b-Sandbox-Port"
    endpointEnv: { name: 'E2B_API_URL', templates: { E2B_API_URL: '${url}', E2B_SANDBOX_URL: '${url}' }, note: 'Python e2b 2.45.0 and the JS SDK read E2B_API_URL; the JS SDK reads E2B_SANDBOX_URL and sends sandbox id/port headers; vendor hosts route through the World proxy' },
    credentialDoor: { account: { field: 'account' }, path: '/_twin/teams', body: { name: 'World team' }, fill: { E2B_API_KEY: 'api_key' } },
  },
};
