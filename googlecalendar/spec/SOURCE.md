# Google Calendar API v3 — the vendored spec

**File:** `discovery.json` — the Calendar API's Google API Discovery document, the vendor's machine-readable
description of the API and the document Google's own generated clients (`googleapis`, `@googleapis/calendar`) are built
from. Google publishes no OpenAPI document for this API.

**Upstream:** `https://calendar-json.googleapis.com/$discovery/rest?version=v3` (fetched 2026-09-27, HTTP 200), the
service's own discovery endpoint (https://developers.google.com/discovery/v1/reference/apis).

**Version:** `v3`, `revision` `20260826`; `rootUrl` `https://www.googleapis.com/`, `servicePath` `calendar/v3/`,
`batchPath` `batch/calendar/v3`. 38 methods over 8 resources (acl, calendarList, calendars, channels, colors, events,
freebusy, settings) and 39 schemas.

**sha256 of the vendor's bytes:** `02caac246bca4436df9dc6775823519e37cfe71f44862290b194000b74c83a79` (169,810 bytes).

**How it is read:** `packages/twin-standard/src/spec-ir-discovery.ts` reads the Discovery format into the OpenAPI 3 shape
the spec IR reads (each method an operation named by its `id`, `calendar.events.list`; its `path` and `query` parameters,
the document's standard parameters on every operation, `request`/`response` schemas, a method with no `response`
answering 204, `scopes` as the operation's security). `scripts/derive-pack.ts googlecalendar` writes `src/generated/`.

**Corrections:** none. The spec publishes no examples; the vendor's documentation pages' examples are in
`doc-examples.json` with their URLs. Outside the count: the errors page's "409: Conflict" ("A batched item inside an
events.batch operation can't be executed…"), which belongs to batch requests (the document's `batchPath`,
`batch/calendar/v3`), an endpoint the spec's operations do not include.

**Demand:** the offline scan lists Cal.com only, as opt-in. Its shipped Google credentials are empty;
the pinned configuration gates and evidence are recorded under `optional` in `journeys/demand.json`.
No operation, resource, screen, credential door or refresh is served.

**Read by:** Codex.
