# upstash/qstash spec — provenance

Upstash publishes QStash's API and Workflow's API as two OpenAPI documents, both with the one server
`https://qstash-{region}.upstash.io` (regions `us-east-1`, `eu-central-1`), one key set (`bearerAuth`, and `bearerAuthQuery`
as `qstash_token`) and shared endpoints (`/v2/flowControl` and its actions, `/v2/globalParallelism`, `/v2/keys`,
`/v2/keys/rotate`, `POST /v2/messages/{messageId}/retry`). They are one API published twice
(docs/contributing/architecture.md, "Other wires"), so the upstash pack's `qstash` lane vendors each as published and reads
their union (`scripts/spec-documents.ts`).

- **Files:** `openapi/qstash.yaml.gz` and `openapi/workflow.yaml.gz`, gzip (`gzip -9 -n`) of the documents as published.
- **Upstream:** https://github.com/upstash/docs at commit `3165edff5b5edf4ba74508a4d3583b257297b9e4`: `qstash/openapi.yaml`
  (rendered at https://upstash.com/docs/qstash/api-reference) and `workflow/openapi.yaml` (rendered at
  https://upstash.com/docs/workflow/api-reference). Fetched 2026-09-27.
- **Version:** OpenAPI 3.1.0; both documents say `info.version` 2.0.0. qstash: 35 paths, 43 operations; workflow: 28 paths,
  32 operations; their union: 52 paths, 64 operations.
- **SHA-256 of the uncompressed documents:** qstash `a41c323ee5021b340604e0b95e7ce18ca3e6f6c15da75bc0803c7339674ac6c0`,
  workflow `4c95aad186896f579af1576ac0618a89ee5b587deb77e7b88990410b3ea6c7c7` (the same bytes as
  `raw.githubusercontent.com` answers for each path at that commit, checked 2026-09-27).
- **Operation ids:** neither document names any, so each is the `method_path` slug the IR mints (`post_v2_publish_destination`).
  The union and the patches below: 67 operations.
- **Corrections** (`patches.json`, RFC 6902, applied to the documents before their union):
  - `FlowControlKey`: the two documents contradict each other (qstash's schema has eleven fields and `waitListSize`,
    workflow's two and `waitlistSize`). qstash's holds, because the vendor's own client decodes it: @upstash/qstash 2.11.3's
    `type FlowControlInfo` (https://unpkg.com/@upstash/qstash@2.11.3/client-CsnfJpnA.d.ts, read from `npm pack
    @upstash/qstash@2.11.3`) names `flowControlKey`, `waitListSize`, `parallelismMax`, `parallelismCount`, `rateMax`,
    `rateCount`, `ratePeriod`, `ratePeriodStart`, `isPaused`, `isPinnedParallelism` and `isPinnedRate`. Workflow's schema is
    replaced with qstash's.
  - `POST /v2/messages/{messageId}/retry`: the two differ only in workflow's listing a 500, which is not a behaviour a twin
    decides; it is removed, so the union answers qstash's 200, 400 and 404. (The documents also file the endpoint under
    different tags, `Messages` and `Runs`; the union reader reads a tag as words, not substance.)
- **Kept as published, though odd:** workflow's document gives `GET /v2/keys/rotate` the description, parameter and answer of
  "Get Flow Control Key" (a `flowControlKey` path parameter the path does not have; rendered at
  https://upstash.com/docs/workflow/api-reference/flow-control/get-flow-control-key-1). Nothing shows the server answers or
  refuses it, so it stays in the count, answered as an operation the twin does not model.
  - Patched in from the vendor's own clients, as the lane models them (each citing the installed client's source on unpkg):
    the `cancel` query parameter of `DELETE /v2/workflows/runs/{workflowRunId}` (@upstash/workflow 1.3.0's
    `triggerWorkflowDelete`); the `source` query parameter of `GET /v2/dlq`, and its answer being QStash's failed messages
    or the Workflow DLQ's (the same client's `client.dlq.list`); `POST /v2/wait/{eventId}` (its `LazyWaitEventStep`); and
    the `dlqId` of QStash's DLQMessage (@upstash/qstash 2.11.0's `type DlqMessage`); and `PATCH` beside the documents'
    `POST` for `/v2/schedules/{scheduleId}/pause` and `/resume`, the method both clients send (@upstash/qstash 2.11.3's
    `schedules.pause`, https://unpkg.com/@upstash/qstash@2.11.3/chunk-JYPXGFWX.mjs, and qstash-py 3.4.0's `schedule.pause`).
- **Read by:** `bun scripts/derive-pack.ts upstash/qstash`, which writes `../src/generated/`.

## What the vendor's clients call that the documents omit

The APIs below are called by Upstash's own clients and are in neither document. They are outside the count until the lane
models them, when each is patched in with its client's source as the evidence (those modelled are the patches above). Read
from `npm pack @upstash/qstash@2.11.3` and from the `@upstash/workflow@1.3.0` Dub installs:

- `GET /v2/workflows/events` (with `groupBy=workflowRunId`) — @upstash/workflow's `client.logs`; the document names the
  workflow run logs `GET /v2/workflows/logs`.
- `GET /v2/events` — @upstash/qstash's `client.events`, the older name of the logs (`GET /v2/logs`).
- `GET /v2/workflows/runs/{workflowRunId}` — @upstash/workflow's `getSteps`, which a delivery with an empty body makes
  (a run's steps too large to carry).

The `Upstash-Workflow-*` headers a workflow's messages carry (a step's run id, its URL, whether it starts the run, its call
type, the `Upstash-Failure-Callback-*` family) travel in `POST /v2/batch` entries, whose `headers` the qstash document types
as any string map; the lane reads them there (semantics/workflows.ts, citing the client's source).

## Dub's calls (runs/dub/demand-ops.json)

Dub calls `POST /v2/publish/<url>`, `POST /v2/batch` and `POST /v2/enqueue/<queue>/<url>` into its job and cron routes,
and, through @upstash/workflow, `POST /v2/batch` (a trigger of several runs) and `DELETE /v2/workflows/runs/{id}` (a run
finished). Every one is an operation of the union.

## The World's doors (../src/doors.ts)

Not QStash's API; each answers only at its own path. `POST /v2/_twin/drain` runs the lane's catch-up (what the World clock
has made due: deliveries, retries, schedules, timed-out waits) and answers what it delivered; a served World's runner calls
it about once a second, and every request the lane answers runs the same catch-up first. `GET /_twin/deliveries?to=<url>`
reads what a customer's endpoint received from QStash, and `POST /_twin/destinations` states how the endpoints under a URL
answer: the customer's servers are outside Upstash.

## The published examples (spec/doc-examples.json)

Neither document carries an example request, so `doc-examples.json` transcribes the requests Upstash's QStash and Workflow
pages publish (read from each page's markdown, `https://upstash.com/docs/<page>.md`, 2026-09-27): every curl and every
@upstash/qstash, qstash-py and @upstash/workflow call that sends one request to an operation of the union, each with its
page's URL. A client call is written as the request the installed client sends (@upstash/qstash 2.11.3, qstash-py 3.4.0,
@upstash/workflow 1.3.0): the method and path it builds, its JSON body as it serialises it, a batch's entries with the
headers the client puts on them, and a workflow trigger as the `POST /v2/batch` entry `client.trigger` sends. The telemetry
headers a client adds by default (`Upstash-Telemetry-*`) are left out: no page shows them. A call whose run id the client
makes (`wfr_` + nanoid) carries the placeholder `<WORKFLOW_RUN_ID>`.

Left out of the file, as no request of the union: calls with elided arguments that name no operation's request
(qstash-py's getting-started `publish_json(...)`), and the SDK calls of APIs outside the documents (`client.events`,
`client.logs`, above). A curl the page prints with neither `-X` nor a body is written as the GET curl sends
(qstash/api/authentication's two). 402 examples: 309 on operations the lane serves, replayed or recorded in
`../journeys/vendor-examples.json`, and 93 on operations it does not, counted as breadth's gap.

Workflow trigger requests express the SDK-generated run id as `<WORKFLOW_RUN_ID>` in `doc-examples.json`.
It is a placeholder for a fresh id per invocation, including failure-callback headers; it is not a fixed value
published by the server. The [client.trigger reference](https://upstash.com/docs/workflow/basics/client/trigger)
says “If omitted, a run ID will be generated automatically.” The pinned SDK's
[src/client/index.ts](https://raw.githubusercontent.com/upstash/workflow-js/v1.3.0/src/client/index.ts)
calls `getWorkflowRunId` for each invocation. The replay assigns distinct ids and checks the published payload.

## Delivery options

Publish, batch and enqueue serve [retry-delay expressions](https://upstash.com/docs/qstash/features/retry)
in milliseconds with `retried` starting at zero, and [keyed flow control](https://upstash.com/docs/qstash/features/flowcontrol)
(rate, period defaulting to one second, and active-call parallelism shared across URLs). The World clock stamps
each dispatch and retry at its due instant. The Flow Control management API remains outside the demand.
The [Workflow configuration example](https://upstash.com/docs/workflow/howto/configure) uses the variable `retries`;
QStash documents `retried`. Its request is replayed unchanged and refused, with the discrepancy recorded.
