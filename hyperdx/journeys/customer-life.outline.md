# HyperDX customer life: outline

Author: Contributor 96

## The customer

**Kestrel Labs** runs LibreChat (LibreChat-AI/LibreChat at `f10b1d91`) with its OpenTelemetry tracing and logs turned
on (`OTEL_TRACING_ENABLED`, `OTEL_LOGS_ENABLED`) and its browser RUM on (`RUM_ENABLED`, whose provider is HyperDX by
default), and Twenty (twentyhq/twenty at `1d561b8c`) with its OTLP metrics turned on (`METER_DRIVER=opentelemetry`), as
the World bench runs them (twin-world ADR 0036 §8; ../journeys/demand.json). All of it reports to HyperDX: the World
points `OTEL_EXPORTER_OTLP_ENDPOINT` (LibreChat's NodeSDK, whose exporters add `/v1/traces` and `/v1/logs`), `RUM_URL`
(LibreChat's `@hyperdx/browser`) and `OTLP_COLLECTOR_METRICS_ENDPOINT_URL` (`…/v1/metrics`, Twenty) at HyperDX's ingest,
and fills `RUM_PUBLIC_TOKEN` with the team's ingestion key. No SDK code is replaced.

When the chat fails, Kestrel's on-call engineer reads the incident where a developer finds it: in HyperDX, through its
External API v2 (`HYPERDX_API_URL`, `https://api.hyperdx.io`) with their personal API key (`HYPERDX_API_ACCESS_KEY`).

## People and programs

| who | holds | how |
|---|---|---|
| LibreChat's server | the ingest's endpoint | @opentelemetry/sdk-node 0.218.0, OTLP/HTTP protobuf (the default protocol) |
| LibreChat's browser | the ingest's URL and the ingestion key | @hyperdx/browser 0.24.0 (@hyperdx/otel-web 0.18.0), OTLP/HTTP JSON, the key in `authorization` |
| Twenty's server | the ingest's metrics URL | @opentelemetry/exporter-metrics-otlp-http 0.219.0, OTLP/HTTP JSON, delta temporality |
| the on-call engineer | the personal API key | HTTP to HyperDX's External API v2 |

## The arc

### 1. Kestrel signs up (Mon 5 Jan, 09:55)
The team is made with the Logs and Traces sources HyperDX sets a new team up with; its ingestion API key and the
engineer's personal API key are issued (both UUIDs), with the API's URL (`/_twin/app-credentials`, the account's
sign-up).

### 2. The page loads (09:59:59)
LibreChat's browser RUM exports the page's `GET /api/config` fetch span (32 ms, service `librechat-web`) as JSON to
`/v1/traces`, the ingestion key in its `authorization` header (`exportTraces`). The ingest answers an empty JSON
`ExportTraceServiceResponse`.

### 3. A chat request fails (10:00)
LibreChat's HTTP instrumentation records the `POST /api/*` server span (850 ms); the MongoDB instrumentation records its
`mongodb.insert` child (715 ms); the insert's connection closes, the server span records the exception (an `exception`
event with `exception.type`, `exception.message`, `exception.stacktrace`) and both end with status error. The batch span
processor exports both in one binary request to `/v1/traces` (`exportTraces`). The ingest answers 200 with an empty
`ExportTraceServiceResponse` in `application/x-protobuf` and keeps each span under `trace_id:span_id`.

### 4. The exporter retries the batch
The exporter did not see the answer in time and sends the same request again. The ingest answers as before, and the two
spans are the same records: a retried span is never a second span (act 6 reads two rows for the trace).

### 5. The error log and Twenty's minute of metrics (same minute)
LibreChat's Winston transport emits the error inside the server span; the log exporter sends it to `/v1/logs`
(`exportLogs`), naming the request's trace and server span. Twenty's periodic reader exports one minute's delta (the
`graphql-operation/500` counter and the `twenty_nodejs_eventloop_delay_seconds` histogram) as JSON to `/v1/metrics`
(`exportMetrics`); each data point is kept as its own record.

### 6. The engineer opens HyperDX (10:05)
Without a key the API answers 401 `Unauthorized` before it reads anything. With it, `GET /api/v2/sources`
(`listSources`) answers the team's two sources, Logs (`otel_logs`, default columns
`Timestamp,ServiceName,SeverityText,Body`) and Traces (`otel_traces`, searched by `SpanName` for a bare term); the
engineer keeps both ids. `GET /api/v2/sources/{id}` (`getSource`) reads the Traces source: its durations are in
nanoseconds (`durationPrecision` 9), and it names the Logs source; an id the team does not hold is 404
`Source not found`.

### 7. The failed request's trace (searchEvents)
The engineer's first search, typed by hand with a trailing comma, is not JSON: 400 `Invalid JSON payload`. Then
`POST /api/v2/search` on the Traces source, `where: TraceId:<the trace id>`, over 09:00–11:00, answers the trace's two
spans newest first (the MongoDB child, then the server span), each with its parent, kind, duration in nanoseconds,
`StatusCode: Error` and status message: the retry kept each span once. The server span's events hold the exception
(`Events.Name`, `Events.Attributes`).

### 8. LibreChat's slow spans
`Duration:>1s` is no number of nanoseconds, so ClickHouse cannot read it: 500 `Query execution failed`. Asked as
`ServiceName:librechat AND Duration:>800000000`, the search answers the one server span over 800 ms (the browser's 32 ms
span names `librechat-web`, which the unquoted value also matches, and is not slow). A field no column holds
(`http.method:GET`) is ClickHouse's `UNKNOWN_IDENTIFIER` (400). `ServiceName:LIBRECHAT` with `maxResults: 1`,
`offset: 2` pages to the third span, the browser's; a quoted value is equality, so `ServiceName:"librechat" AND NOT
StatusCode:Error` finds none. A search without a source is refused by the request's checks (400 `sourceId: Required`).

### 9. The error logs
`whereLanguage: Lucene` is not one of the two names the API takes (400). `SeverityText:error` on the Logs source answers
the Winston log with the source's default columns; a window that ends before it starts is refused (400). A bare search
`saveMessage closed` finds the log by the words of its body, and it names the request's trace and server span, its
severity number (17) and its `conversationId` attribute. A source the team does not hold is 404.

### 10. The last 15 minutes
With no window and no columns, the search reads the 15 minutes before now (09:50–10:05) with the Traces source's
default columns: three spans newest first, each duration in milliseconds (`round(Duration/1e6)`).

### 11. What the twin does not serve
The dashboards (`GET /api/v2/dashboards`) answer as HyperDX answers a route it does not have: 404, Express's
`Cannot GET /api/v2/dashboards` page.

## Refusals and the published examples

The OTLP specification's three JSON request examples, its empty-request rule (success), its bad-data rule (400 with a
`Status`) and the invalid-trace-id rule (the span rejected and counted in `partialSuccess.rejectedSpans`), and the
External API document's recent-errors search answer (read back from a log record sent through the ingest as the
example's row shows it) and unknown-source 404 are replayed in ../journeys/vendor-examples.json; its 401 examples are
not what the server sends (recorded there). A request in neither OTLP encoding (an OTLP/gRPC exporter pointed at the
HTTP port) is answered 415; no demanded exporter's default protocol sends one (../journeys/unreachable.json).
