# @volter/twin-hyperdx

Protocol 3 twin of HyperDX, as two lanes over one store:

- **`ingest`**: HyperDX's OTLP/HTTP ingest (its OpenTelemetry collector's receiver; OTLP specification 1.11.1,
  opentelemetry-proto v1.11.1). It serves `POST /v1/traces`, `/v1/logs` and `/v1/metrics` in binary protobuf
  (`application/x-protobuf`) and JSON protobuf (`application/json`), gzip accepted, and answers each with its
  `Export*ServiceResponse` in the request's encoding: empty on full success, `partialSuccess` with the rejected count
  for a span whose trace or span id is invalid, 400 with a `google.rpc.Status` for data that cannot be decoded, 413 over
  64 MiB, 415 for another Content-Type.
- **`api`**: HyperDX's External API v2 (`api/spec/openapi.json`, hyperdxio/hyperdx `049ec842`), read with a personal API
  key (`Authorization: Bearer`): `GET /api/v2/sources` and `/api/v2/sources/{id}` (the team's Logs and Traces sources,
  as HyperDX sets a team up, their ids the same at every boot) and `POST /api/v2/search` (`searchEvents`). Every other
  operation answers the gap as HyperDX answers a route it does not have (404, Express's `Cannot <METHOD> <path>` page),
  after the key check its routers make.

**For whom:** LibreChat's server telemetry (its NodeSDK's traces and Winston logs) and its browser RUM, whose provider is
HyperDX (`@hyperdx/browser`), Twenty's OTLP metrics, and any OpenTelemetry SDK; and the engineer who reads the incident
through HyperDX's API. The World bench reads what they send as a run's evidence and gives a task's agent the API
(twin-world ADR 0036 §8). The applications export only when their operators turn it on (`journeys/demand.json`).

**Routing:** the ingest is `in-otel.hyperdx.io` (the browser SDK's default collector) and any host's `/v1/traces`,
`/v1/logs` and `/v1/metrics`; the API is `api.hyperdx.io` (the CLI's default) and every other path. The World also sets
`OTEL_EXPORTER_OTLP_ENDPOINT` to the twin (each SDK exporter appends `/v1/<signal>`), `OTLP_COLLECTOR_METRICS_ENDPOINT_URL`
to its `/v1/metrics` (Twenty) and `RUM_URL` to it (LibreChat's browser RUM).

**Door:** `POST /_twin/app-credentials` (the descriptor's credential door), the account's sign-up: the team, its
ingestion API key (`RUM_PUBLIC_TOKEN`), the first user's personal API key (`HYPERDX_API_ACCESS_KEY`,
`HYPERDX_SERVICE_KEY`) and the API URL (`HYPERDX_API_URL`), the same at every boot.

**What it keeps** (the World's history; field names are OTLP's proto names):

- `span`, keyed `<trace_id>:<span_id>`: `trace_id`, `span_id`, `parent_span_id` (lowercase hex, `''` for a root),
  `trace_state`, `flags`, `name`, `kind`, `start_time_unix_nano`, `end_time_unix_nano` (decimal strings), `attributes`,
  `dropped_attributes_count`, `events` (each `time_unix_nano`, `name`, `attributes`: an exception is the `exception`
  event's `exception.type`, `exception.message`, `exception.stacktrace`), `dropped_events_count`, `links` (`trace_id`,
  `span_id`, `trace_state`, `attributes`, `flags`), `dropped_links_count`, `status` (`code`, `message`), `resource`
  (`attributes`, `dropped_attributes_count`, `entity_refs`), `resource_schema_url`, `scope` (`name`, `version`,
  `attributes`, `dropped_attributes_count`), `scope_schema_url`.
- `log_record`: `time_unix_nano`, `observed_time_unix_nano`, `severity_number`, `severity_text`, `body`, `attributes`,
  `dropped_attributes_count`, `flags`, `trace_id`, `span_id`, `event_name`, and the resource and scope fields.
- `metric_point`, one per data point: the point's own fields, `metric` (`name`, `description`, `unit`, `metadata`),
  `type` (`gauge`, `sum`, `histogram`, `exponential_histogram`, `summary`), its data's `aggregation_temporality` and a
  sum's `is_monotonic`, and the resource and scope fields.

`attributes` is an object of the attribute keys, each holding its AnyValue's one set field (`string_value`,
`bool_value`, `int_value` as a decimal string, `double_value`, `array_value`, `kvlist_value`, `bytes_value`). Sampling
is kept as the SDK declares it and never inferred.

**How the search reads them:** a span is its `otel_traces` row and a log record its `otel_logs` row, as the collector's
ClickHouse exporter writes them (`Timestamp` in ISO nanoseconds, `TraceId`, `SpanId`, `ParentSpanId`, `SpanName`,
`SpanKind` and `StatusCode` by name, `ServiceName` from `service.name`, `Duration` in nanoseconds as a string, the
attribute maps as strings, `Events.*` and `Links.*` as arrays; `SeverityText`, `SeverityNumber`, `Body`, `LogAttributes`
for a log). `searchEvents` takes the window (`startTime`, `endTime`, 15 minutes back from now by default, both ends
held), the Lucene `where` (`field:value` a case-insensitive part of a string column or a number's equality,
`field:"value"` equality, `field:*`, `>`, `>=`, `<`, `<=`, `[a TO b]`, `AND`, `OR`, `NOT`, `-field:value`, groups, a bare
term searching the source's implicit column by its words, a map column's key as `SpanAttributes.<key>`), `select`
(columns, `Map['key']`, the default select's `round(Duration/1e6)`; the source's default when none), `orderBy`
(newest first by default), `offset` and `maxResults`, and answers `{ data, rows }`; its body checks, window refusals,
unknown-source 404 and ClickHouse's refusals (400 for an unknown identifier, 500 otherwise) are HyperDX's.

**Left out:** OTLP/gRPC (another transport), profiles, the SQL where language (`whereLanguage: sql`, the gap), the
Metrics and Sessions sources, the collector's log transform (severity inferred from a body, JSON bodies parsed into
attributes: a log record is read as the exporter sent it), the ingestion key's check at the ingest (it accepts any), and
every External API operation beside the three reads. The pack is not vendor-backed (`vendorBacked.none`): HyperDX's
search answers a projection of what it keeps, from which the records cannot be made again.

`ingest/spec/SOURCE.md` and `api/spec/SOURCE.md` name the files vendored under each lane's `spec/`.
