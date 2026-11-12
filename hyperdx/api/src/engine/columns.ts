// A kept OTLP record as the row HyperDX's tables hold it: the OpenTelemetry collector's ClickHouse exporter (the
// collector HyperDX ships, opentelemetry-collector-contrib v0.155.0) writes each span into otel_traces and each log
// record into otel_logs, and HyperDX's search answers those rows as ClickHouse's JSON output gives them (DateTime64 in
// ISO form, 64-bit integers as strings). Pure computation over a record already read: nothing here takes a context.
//
// The record's form is the ingest's (../../../ingest/src/engine/records.ts): ids as lowercase hex, enums as their
// numbers, 64-bit integers as decimal strings, attributes as an object of their keys each holding its AnyValue's one
// set field.

type Row = Record<string, unknown>;

/** A column's type, as HyperDX's search reads it: a string, a number, a date-time, a map of strings, or an array. */
export type ColumnType = 'string' | 'number' | 'datetime' | 'map' | 'array';

// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/docker/otel-collector/Dockerfile "ARG OTEL_COLLECTOR_VERSION=0.155.0"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/common-utils/src/clickhouse/index.ts "date_time_output_format: 'iso',"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/common-utils/src/clickhouse/index.ts "output_format_json_quote_64bit_integers: 1,"
// The tables' columns, as HyperDX's schema creates them (docker/otel-collector/schema/seed/00005_otel_traces.sql and
// 00002_otel_logs.sql at hyperdxio/hyperdx 049ec842): their names and the type each is read as.
export const TRACE_COLUMNS: Record<string, ColumnType> = {
  Timestamp: 'datetime', TraceId: 'string', SpanId: 'string', ParentSpanId: 'string', TraceState: 'string', SpanName: 'string',
  SpanKind: 'string', ServiceName: 'string', ResourceAttributes: 'map', ScopeName: 'string', ScopeVersion: 'string',
  SpanAttributes: 'map', Duration: 'number', StatusCode: 'string', StatusMessage: 'string', 'Events.Timestamp': 'array',
  'Events.Name': 'array', 'Events.Attributes': 'array', 'Links.TraceId': 'array', 'Links.SpanId': 'array',
  'Links.TraceState': 'array', 'Links.Attributes': 'array',
};
export const LOG_COLUMNS: Record<string, ColumnType> = {
  Timestamp: 'datetime', TraceId: 'string', SpanId: 'string', TraceFlags: 'number', SeverityText: 'string',
  SeverityNumber: 'number', ServiceName: 'string', Body: 'string', ResourceSchemaUrl: 'string', ResourceAttributes: 'map',
  ScopeSchemaUrl: 'string', ScopeName: 'string', ScopeVersion: 'string', ScopeAttributes: 'map', LogAttributes: 'map',
  EventName: 'string',
};

const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});

/** An instant in nanoseconds since the epoch (a decimal string) as ClickHouse writes a DateTime64(9) in ISO form. */
export function isoNanos(nanos: unknown): string {
  const n = BigInt(String(nanos ?? '0') || '0');
  const seconds = n / 1_000_000_000n;
  const rest = n % 1_000_000_000n;
  return `${new Date(Number(seconds) * 1000).toISOString().slice(0, 19)}.${rest.toString().padStart(9, '0')}Z`;
}

/** Nanoseconds since the epoch of an ISO instant (as a request's window gives it), to compare with a row's. */
export function nanosOf(iso: string): bigint {
  const m = /\.(\d+)/.exec(iso);
  const ms = Date.parse(iso);
  const whole = BigInt(Math.floor(ms / 1000)) * 1_000_000_000n;
  const frac = m ? BigInt(m[1]!.slice(0, 9).padEnd(9, '0')) : BigInt(ms % 1000) * 1_000_000n;
  return whole + frac;
}

/** An AnyValue's raw value (pcommon's AsRaw): a scalar as it is, an array or key-value list as JSON's. */
function raw(v: unknown): unknown {
  const a = obj(v);
  if ('string_value' in a) return a.string_value;
  if ('bool_value' in a) return a.bool_value;
  if ('int_value' in a) return Number(a.int_value);
  if ('double_value' in a) return a.double_value;
  if ('bytes_value' in a) return a.bytes_value;
  if ('array_value' in a) return ((obj(a.array_value).values ?? []) as unknown[]).map(raw);
  if ('kvlist_value' in a) return Object.fromEntries(((obj(a.kvlist_value).values ?? []) as Row[]).map((kv) => [String(kv.key), raw(kv.value)]));
  return null;
}

// source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/v0.155.0/exporter/clickhouseexporter/internal/util.go "return yield(k, v.AsString())"
// source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector/pdata/v1.61.0/pdata/pcommon/value.go "func (v Value) AsString() string {"
/** An AnyValue as the exporter writes it into a string column or map (pcommon Value.AsString): a string as it is, a
 *  number in its shortest form, a boolean as true or false, bytes in base64, a map or a list as JSON. */
export function asString(v: unknown): string {
  const a = obj(v);
  if ('string_value' in a) return String(a.string_value);
  if ('bool_value' in a) return a.bool_value ? 'true' : 'false';
  if ('int_value' in a) return String(a.int_value);
  if ('double_value' in a) return String(a.double_value);
  if ('bytes_value' in a) return String(a.bytes_value);
  if ('array_value' in a || 'kvlist_value' in a) return JSON.stringify(raw(a));
  return '';
}

/** Attributes as the exporter's map of strings. */
export const attributeMap = (attributes: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(obj(attributes)).map(([k, v]) => [k, asString(v)]));

// source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector/pdata/v1.61.0/pdata/ptrace/span_kind.go "String returns the string representation of the SpanKind."
// source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector/pdata/v1.61.0/pdata/ptrace/status_code.go "String returns the string representation of the StatusCode."
// pdata's names for the span kind and status code enums (ptrace SpanKind.String, StatusCode.String)
const SPAN_KINDS = ['Unspecified', 'Internal', 'Server', 'Client', 'Producer', 'Consumer'];
const STATUS_CODES = ['Unset', 'Ok', 'Error'];

const serviceName = (record: Row): string => {
  const v = obj(obj(record.resource).attributes)['service.name'];
  return v === undefined ? '' : asString(v);
};

// source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/v0.155.0/exporter/clickhouseexporter/exporter_traces.go "spanDurationNanos := span.EndTimestamp() - span.StartTimestamp()"
// source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/v0.155.0/exporter/clickhouseexporter/exporter_traces.go "span.Kind().String(),"
// source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/v0.155.0/exporter/clickhouseexporter/exporter_traces.go "spanStatus.Code().String(),"
/** A span as its otel_traces row. Duration is its end less its start in nanoseconds. */
export function traceRow(span: Row): Row {
  const status = obj(span.status);
  const events = (span.events ?? []) as Row[];
  const links = (span.links ?? []) as Row[];
  const start = BigInt(String(span.start_time_unix_nano ?? '0'));
  const end = BigInt(String(span.end_time_unix_nano ?? '0'));
  return {
    Timestamp: isoNanos(span.start_time_unix_nano),
    TraceId: String(span.trace_id ?? ''),
    SpanId: String(span.span_id ?? ''),
    ParentSpanId: String(span.parent_span_id ?? ''),
    TraceState: String(span.trace_state ?? ''),
    SpanName: String(span.name ?? ''),
    SpanKind: SPAN_KINDS[Number(span.kind ?? 0)] ?? '',
    ServiceName: serviceName(span),
    ResourceAttributes: attributeMap(obj(span.resource).attributes),
    ScopeName: String(obj(span.scope).name ?? ''),
    ScopeVersion: String(obj(span.scope).version ?? ''),
    SpanAttributes: attributeMap(span.attributes),
    Duration: String(end - start),
    StatusCode: STATUS_CODES[Number(status.code ?? 0)] ?? '',
    StatusMessage: String(status.message ?? ''),
    'Events.Timestamp': events.map((e) => isoNanos(e.time_unix_nano)),
    'Events.Name': events.map((e) => String(e.name ?? '')),
    'Events.Attributes': events.map((e) => attributeMap(e.attributes)),
    'Links.TraceId': links.map((l) => String(l.trace_id ?? '')),
    'Links.SpanId': links.map((l) => String(l.span_id ?? '')),
    'Links.TraceState': links.map((l) => String(l.trace_state ?? '')),
    'Links.Attributes': links.map((l) => attributeMap(l.attributes)),
  };
}

// source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/v0.155.0/exporter/clickhouseexporter/exporter_logs.go "timestamp = r.ObservedTimestamp()"
// source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/v0.155.0/exporter/clickhouseexporter/exporter_logs.go "uint8(r.SeverityNumber()),"
// source: https://raw.githubusercontent.com/open-telemetry/opentelemetry-collector-contrib/v0.155.0/exporter/clickhouseexporter/exporter_logs.go "r.Body().AsString(),"
/** A log record as its otel_logs row: its time, else the time it was observed. */
export function logRow(record: Row): Row {
  const time = String(record.time_unix_nano ?? '0') === '0' ? record.observed_time_unix_nano : record.time_unix_nano;
  return {
    Timestamp: isoNanos(time),
    TraceId: String(record.trace_id ?? ''),
    SpanId: String(record.span_id ?? ''),
    TraceFlags: Number(record.flags ?? 0) & 0xff,
    SeverityText: String(record.severity_text ?? ''),
    SeverityNumber: Number(record.severity_number ?? 0) & 0xff,
    ServiceName: serviceName(record),
    Body: record.body === undefined || record.body === null ? '' : asString(record.body),
    ResourceSchemaUrl: String(record.resource_schema_url ?? ''),
    ResourceAttributes: attributeMap(obj(record.resource).attributes),
    ScopeSchemaUrl: String(record.scope_schema_url ?? ''),
    ScopeName: String(obj(record.scope).name ?? ''),
    ScopeVersion: String(obj(record.scope).version ?? ''),
    ScopeAttributes: attributeMap(obj(record.scope).attributes),
    LogAttributes: attributeMap(record.attributes),
    EventName: String(record.event_name ?? ''),
  };
}
