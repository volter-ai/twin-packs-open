// HyperDX's ingest lane: the OTLP/HTTP endpoint its OpenTelemetry collector receives on, which HyperDX's own SDKs
// (@hyperdx/browser, @hyperdx/node-opentelemetry) and any OpenTelemetry exporter send to. Its spec (../spec) is written
// from the OTLP specification 1.11.1 and its .proto files. Each span, log record and metric data point is kept as its own
// record (./semantics/shared.ts) in the vendor's one store, which the api lane's search reads.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'hyperdx',
  service: 'hyperdx',
  // a request is a binary or JSON protobuf payload: its bytes are kept (./semantics/around.ts) and read by the handler
  body: {},
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "The client MAY gzip the content and in that case MUST include"
  // Where the documentation stops: a body that does not gunzip is data that cannot be decoded, answered as bad data.
  encodings: { request: ['gzip'], undecodable: { status: 400, message: 'the request body cannot be decompressed' } },
  ids: { template: '{uuid}' },
  time: 'iso',
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "The response body for all"
  // source: https://raw.githubusercontent.com/googleapis/googleapis/d14bf59a446c14ef16e9931ebfc8e63ab549bf07/google/rpc/status.proto "A developer-facing error message, which should be in English."
  // the kernel's own answers (a path no operation has, a read-only World) take the Status message's JSON form
  error: { message: '{message}' },
  readOnly: { status: 503, message: 'This twin was started read-only; telemetry is refused.' },
  malformedBody: { status: 400, message: 'the request body cannot be decoded' },
  notFound: { status: 404, message: 'Not Found' },
  gap: { status: 404, message: 'Not Found' },
  deleted: {},
  // a browser exporter (a RUM SDK) posts cross-origin. Where the documentation stops: the specification states no CORS;
  // the headers allowed are the ones the exporters send (Content-Type, Content-Encoding, and an Authorization or
  // other configured header such as a public token)
  cors: { origin: '*', methods: 'POST, OPTIONS', headers: 'content-type, content-encoding, authorization, x-requested-with', maxAge: 3600 },
  resources: {
    // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/trace/v1/trace.proto "A Span represents a single operation performed by a single component of the system."
    // keyed by its trace and span ids (lowercase hex), so a span an exporter sends again is the same record
    span: { idPrefix: '' },
    // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/logs/v1/logs.proto "A log record according to OpenTelemetry Log Data Model:"
    log_record: { idPrefix: '' },
    // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/metrics/v1/metrics.proto "NumberDataPoint is a single data point in a timeseries that describes the"
    metric_point: { idPrefix: '' },
  },
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "OTLP/HTTP uses HTTP POST requests to send telemetry data from clients to"
  vendorBacked: { none: 'Ingest is telemetry an exporter sends, never deployed as account changes: OTLP defines no read operation, and what HyperDX reads back (the api lane\'s search) is a projection into its ClickHouse columns, not the records the exporters sent.' },
  discovery: {
    twinOf: "HyperDX's OTLP/HTTP ingest (the OpenTelemetry Protocol: /v1/traces, /v1/logs, /v1/metrics, binary and JSON protobuf)",
    stores: 'each exported span, log record and metric data point, with its resource and instrumentation scope, in OTLP field names (the api lane searches them)',
  },
};
