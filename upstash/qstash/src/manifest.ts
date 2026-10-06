// QStash's manifest (the upstash pack's `qstash` lane; docs/contributing/architecture.md, "Other wires: lanes"): the
// vendor facts QStash's published OpenAPI documents (../spec/openapi: QStash's and Workflow's) do not carry. The surface is
// generated (./generated/surface.gen.json) at `https://qstash[-<region>].upstash.io`.
//
// SCOPE FROM THE DEMAND (../../journeys/demand.json): publish (delay, not-before, retries, deduplication, flow control,
// labels, callbacks), batch, enqueue and a queue's upsert, a message's read, cancel by filter, and a workflow run's end;
// the deliveries QStash makes, signed, retried on its backoff, into the DLQ when out of retries with the failure callback
// called (./semantics/clock.ts). Schedules, URL groups, the DLQ's API, events and waiters, flow control's own API and the
// logs are the gap: no application calls them.
//
// THE STATE is the vendor's (service `upstash`): an account's QStash (the console's `qstash_user`, its token and signing
// keys), messages (the Message schema, with bookkeeping for when each is next due and how it ended), queues, workflow
// runs, and each delivery QStash made (`_delivery`).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'upstash',
  service: 'upstash',
  body: {},
  deleted: undefined,
  // a message id is `msg_` and the minted digits (the handler puts the prefix; ./semantics/shared.ts)
  ids: { template: '{hex:40}' },
  // `createdAt`, `notBefore`: "The unix timestamp in milliseconds"
  time: 'unix-ms',
  // spec Error: `{ error }`
  error: { error: '{message}' },
  readOnly: { status: 403, message: 'the twin is read-only' },
  notFound: { status: 404, message: 'not found' },
  // a destination is a whole URL in the path (`/v2/publish/https://app.example.com/api/job`)
  spanning: ['destination', 'workflowUrl'],
  list: { style: 'envelope', envelope: { messages: '{data}' }, limit: { param: 'count', default: 100, max: 1000 } },
  // operations of the declared resources no application calls, which the core would otherwise answer unscoped: the gap
  unmodeled: ['get_v2_queues', 'get_v2_queues_queuename', 'delete_v2_queues_queuename', 'post_v2_queues_queuename_pause', 'post_v2_queues_queuename_resume', 'get_v2_workflows_logs'],
  doors: [
    { id: 'destinations', method: 'POST', path: '/_twin/destinations', note: "{ url, status, headers?, body?, takes?, when? }: how an application the World does not run answers QStash's requests to its URLs (the World's stand-in for its server)" },
    { id: 'deliveries', method: 'GET', path: '/_twin/deliveries', note: "?to=<url>[&run=<run id>][&message=<message id>]: every request QStash made to that URL (or under it), in order: its headers, body, attempt and the answer's status, or what was missed" },
  ],
  resources: {
    // QStash lists no messages, and holds one only while it is being delivered or retried
    // source: spec:get_v2_messages_messageid "Messages are removed from the database shortly after they"
    Message: { storedAs: 'message', idPrefix: '', idAs: 'messageId', refresh: { none: "QStash lists no messages and keeps one only while it is delivered or retried; its one read, get_v2_messages_messageid, the spec's reading takes for no resource's retrieve" } },
    Queue: { storedAs: 'queue', idPrefix: '', idAs: 'name', ...states.Queue, refresh: { none: 'get_v2_queues is not served by the twin (no demand or life reads a queue back); a queue is upserted by its name before each enqueue' } },
    WorkflowRun: { storedAs: 'workflow_run', idPrefix: '', idAs: 'workflowRunId', ...states.WorkflowRun, refresh: { none: "get_v2_workflows_logs is not served by the twin (no demand or life reads a run's logs); a run is made by its first invocation and ended by serve()" } },
    // a request QStash made to a destination, and an application's stand-in answer
    _delivery: { idPrefix: '' },
    _destination: { idPrefix: '' },
    // A key's delivery limits and current rate period, shared across destinations in its account.
    _flow: { idPrefix: '' },
    // a message in the DLQ, numbered in order
    _dlq: { idPrefix: '', ids: '{n}' },
  },
};
