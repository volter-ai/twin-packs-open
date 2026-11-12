// What every family of HyperDX's ingest shares: reading an OTLP export request in either encoding, keeping its items as
// records, and answering in the request's encoding (the OTLP specification 1.11.1, "OTLP/HTTP"; spec/SOURCE.md). The
// vendor's shared helpers (../../../src/semantics/shared.ts) are re-exported, as every lane's are.
import { protobuf, s3, type HandlerContext } from '@volter/world-core';
import { SCHEMA } from '../engine/schema.ts';
import { BadData, type Encoding, items, points, read, requestType, type Signal, validId } from '../engine/records.ts';
import { LOG_RECORD, METRIC_POINT, SPAN } from '../../../src/semantics/shared.ts';

export * from '../../../src/semantics/shared.ts';
export type Row = Record<string, unknown>;
export type { HandlerContext };

// source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "It is RECOMMENDED to use 64 MiB as the default limit."
const LIMIT = 64 * 1024 * 1024;

const RESPONSE: Record<Signal, { type: string; rejected: string }> = {
  traces: { type: 'opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse', rejected: 'rejectedSpans' },
  logs: { type: 'opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse', rejected: 'rejectedLogRecords' },
  metrics: { type: 'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceResponse', rejected: 'rejectedDataPoints' },
};

/** The encoding a request's Content-Type names, if it is one OTLP/HTTP has. */
function encodingOf(request: Request): Encoding | undefined {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "request and response headers when sending binary Protobuf encoded payload."
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "response headers when sending JSON Protobuf encoded payload."
  return type === 'application/x-protobuf' ? 'proto' : type === 'application/json' ? 'json' : undefined;
}

/** A request in neither encoding (an OTLP/gRPC exporter, whose Content-Type is application/grpc, pointed at the
 *  HTTP receiver): 415 with a JSON Status. Where the documentation stops: the specification names the two encodings
 *  and no answer for another; HTTP answers a content format the target does not take with 415. */
function unsupportedMediaType(request: Request): Response {
  // source: https://www.rfc-editor.org/rfc/rfc9110.html "The 415 (Unsupported Media Type) status code indicates that the origin server is refusing to service the request because the content is in a format not supported by this method on the target resource."
  return failure('json', 415, `unsupported content type: ${request.headers.get('content-type') ?? 'none'}; OTLP/HTTP takes application/x-protobuf or application/json`);
}

/** A body in the request's encoding: the message's binary form, or its JSON form. */
function answer(encoding: Encoding, status: number, type: string, message: Row): Response {
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "in the response as it"
  if (encoding === 'proto') return new Response(new Uint8Array(protobuf.encodeMessage(SCHEMA, type, message)), { status, headers: { 'content-type': 'application/x-protobuf' } });
  return Response.json(message, { status });
}

/** A failure: its status, and a google.rpc.Status naming the problem (Status.code left out, as the specification allows). */
function failure(encoding: Encoding, status: number, message: string): Response {
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "This specification does not use"
  return answer(encoding, status, 'google.rpc.Status', { message });
}

/** One OTLP/HTTP export: the request read in its encoding, its items kept, and the Export*ServiceResponse answered. */
export async function exportSignal(ctx: HandlerContext, signal: Signal, keep: (ctx: HandlerContext, item: Row) => Promise<string | undefined>): Promise<Response> {
  const request = ctx.call.request;
  const encoding = encodingOf(request);
  if (!encoding) return unsupportedMediaType(request);
  const bytes = s3.bytesOf(request);
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "If the limit is exceeded, the server MUST respond"
  if (bytes.length > LIMIT) return failure(encoding, 413, 'the request body exceeds 64 MiB');
  let decoded: Row;
  try {
    // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "cannot be decoded or is otherwise invalid and such failure is permanent, then the"
    // (bad data: a body that cannot be decoded, or holds a value its field cannot take, is answered 400)
    const value = encoding === 'proto' ? protobuf.decodeMessage(SCHEMA, requestType(signal), bytes) : bytes.length ? JSON.parse(new TextDecoder().decode(bytes)) : {};
    decoded = read(requestType(signal), value, encoding);
  } catch (e) {
    return failure(encoding, 400, e instanceof BadData ? e.message : `the ${signal} request cannot be decoded: ${e instanceof Error ? e.message : String(e)}`);
  }
  const rejected: string[] = [];
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "If the server receives an empty request (a request that does not carry"
  for (const item of items(signal, decoded)) {
    const refusal = await keep(ctx, item);
    if (refusal) rejected.push(refusal);
  }
  const response = RESPONSE[signal];
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "The server MUST leave the"
  if (!rejected.length) return answer(encoding, 200, response.type, {});
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/docs/specification.md "Additionally, the server MUST initialize the"
  return answer(encoding, 200, response.type, { partialSuccess: { [response.rejected]: String(rejected.length), errorMessage: [...new Set(rejected)].join('; ') } });
}

// ── the records each signal keeps ───────────────────────────────────────────────────────────────

/** A span, kept under its trace and span ids (a span an exporter sends again is the same record), with what its SDK
 *  declares of its sampling as it came: `flags` (its W3C trace flags, the sampled bit among them) and `trace_state`
 *  (where a probability sampler writes its threshold); no rate is inferred where neither declares one. A span whose
 *  trace or span id is invalid is rejected, and counted in the answer's partial success. */
export async function keepSpan(ctx: HandlerContext, span: Row): Promise<string | undefined> {
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/trace/v1/trace.proto "The ID is a 16-byte array. An ID with all zeroes OR"
  if (!validId(span.trace_id, 16)) return 'a span with an invalid trace_id (16 bytes, not all zero) is rejected';
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/trace/v1/trace.proto "is created. The ID is an 8-byte array. An ID with all zeroes OR of length"
  if (!validId(span.span_id, 8)) return 'a span with an invalid span_id (8 bytes, not all zero) is rejected';
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/trace/v1/trace.proto "Bits 0-7 (8 least significant bits) are the trace flags as defined in W3C Trace"
  const id = `${String(span.trace_id)}:${String(span.span_id)}`;
  await ctx.write(SPAN, id, span, ctx.row(SPAN, id) ? 'span.update' : 'span.create');
  return undefined;
}

/** A log record, kept as it came: its trace and span ids where it names them (an absent or invalid one says the
 *  record is of no trace), its body, severity and attributes, under its resource and scope. */
export async function keepLogRecord(ctx: HandlerContext, record: Row): Promise<string | undefined> {
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/logs/v1/logs.proto "The receivers SHOULD assume that the log record is not associated with a"
  await ctx.write(LOG_RECORD, ctx.mint(LOG_RECORD), record, 'log_record.create');
  return undefined;
}

/** A metric's data points, each kept as its own record with the metric it is of. */
export async function keepMetric(ctx: HandlerContext, metric: Row): Promise<string | undefined> {
  // source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/b3f75588eb23c5fca62264edd05d382de49beb1a/opentelemetry/proto/metrics/v1/metrics.proto "Defines a Metric which has one or more timeseries."
  for (const point of points(metric)) await ctx.write(METRIC_POINT, ctx.mint(METRIC_POINT), point, 'metric_point.create');
  return undefined;
}
