// An OTLP export request, read into the records a receiver keeps: one per span, per log record and per metric data
// point, each in OTLP's own field names (the .proto files' snake_case names) with the resource and instrumentation scope
// it came under. Pure computation over a request already decoded into the proto3 JSON form (a binary body by the
// kernel's codec, a JSON body as sent): nothing here takes a context, reads state or answers.
//
// The two encodings differ where the specification says they do (spec/SOURCE.md, "JSON Protobuf Encoding"): in JSON
// the trace and span ids are hex and enums are integers; the binary form's ids are bytes (base64 in the decoded form)
// and its enums decode to their names. Both are read into one record: ids as lowercase hex, enums as their numbers,
// 64-bit integers as decimal strings, a field the request leaves out at its proto3 default (an unset message as its
// fields' defaults: an unset span status is code 0, STATUS_CODE_UNSET), and an attribute list
// (`attributes`, a metric's `metadata`) as an object of its keys, each holding its AnyValue as the value's one set field.
import { SCHEMA } from './schema.ts';

type Row = Record<string, unknown>;
export type Encoding = 'json' | 'proto';

/** A request the receiver cannot read: answered as bad data. */
export class BadData extends Error {}

const INT64 = new Set(['int64', 'uint64', 'sint64', 'fixed64', 'sfixed64']);
const INT32 = new Set(['int32', 'uint32', 'sint32', 'fixed32', 'sfixed32']);
const IDS = new Set(['trace_id', 'span_id', 'parent_span_id']);
/** Fields with explicit presence (a member of a `oneof`, or `optional`): kept only when the sender set them. */
const PRESENCE = new Set([
  ...['string_value', 'bool_value', 'int_value', 'double_value', 'array_value', 'kvlist_value', 'bytes_value', 'string_value_strindex'].map((f) => `opentelemetry.proto.common.v1.AnyValue.${f}`),
  ...['gauge', 'sum', 'histogram', 'exponential_histogram', 'summary'].map((f) => `opentelemetry.proto.metrics.v1.Metric.${f}`),
  ...['as_double', 'as_int'].flatMap((f) => [`opentelemetry.proto.metrics.v1.NumberDataPoint.${f}`, `opentelemetry.proto.metrics.v1.Exemplar.${f}`]),
  ...['sum', 'min', 'max'].flatMap((f) => [`opentelemetry.proto.metrics.v1.HistogramDataPoint.${f}`, `opentelemetry.proto.metrics.v1.ExponentialHistogramDataPoint.${f}`]),
]);
const ENUM_NUMBERS: Record<string, number> = Object.assign({}, ...Object.values(SCHEMA.enums));

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function hexOfBase64(s: string): string {
  let bits = 0; let value = 0; let out = '';
  for (const c of s.replace(/=+$/, '')) {
    const v = B64.indexOf(c === '-' ? '+' : c === '_' ? '/' : c);
    if (v < 0) throw new BadData(`invalid base64 in an id: ${s}`);
    value = (value << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out += ((value >> bits) & 0xff).toString(16).padStart(2, '0'); }
  }
  return out;
}

function idOf(v: unknown, encoding: Encoding, field: string): string {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string') throw new BadData(`${field} must be a string`);
  if (encoding === 'proto') return hexOfBase64(v);
  if (!/^[0-9a-fA-F]*$/.test(v) || v.length % 2) throw new BadData(`invalid hex in ${field}: ${v}`);
  return v.toLowerCase();
}

/** A value of the wrong type for its field: bad data. */
function wrongType(field: string, what: string): never {
  throw new BadData(`${field} must be ${what}`);
}

const INTEGER = /^-?\d+$/;
const SPECIAL = ['NaN', 'Infinity', '-Infinity'];

/** A scalar in its record form, its proto3 default where it is left out. JSON takes a 64-bit integer as a number or a
 *  decimal string (kept as the string), and a double as a number or one of the special values' names. */
function scalar(type: string, v: unknown, field: string): unknown {
  if (INT64.has(type)) return v === undefined ? '0' : typeof v === 'number' && Number.isInteger(v) ? String(v) : typeof v === 'string' && INTEGER.test(v) ? v : wrongType(field, 'an integer');
  if (INT32.has(type)) return v === undefined ? 0 : typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && INTEGER.test(v) ? Number(v) : wrongType(field, 'an integer');
  if (type === 'double' || type === 'float') return v === undefined ? 0 : typeof v === 'number' ? v : typeof v === 'string' && SPECIAL.includes(v) ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : wrongType(field, 'a number');
  if (type === 'bool') return v === undefined ? false : typeof v === 'boolean' ? v : wrongType(field, 'a boolean');
  return v === undefined ? '' : typeof v === 'string' ? v : wrongType(field, 'a string');
}

function enumNumber(v: unknown, field: string): number {
  if (v === undefined) return 0;
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && v in ENUM_NUMBERS) return ENUM_NUMBERS[v]!;
  throw new BadData(`${field} is not a value of its enum`);
}

/** A message of the schema, read into its record form. */
export function read(type: string, value: unknown, encoding: Encoding): Row {
  if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) throw new BadData(`${type.split('.').pop()} must be an object`);
  const v = (value ?? {}) as Row;
  const fields = SCHEMA.messages[type];
  if (!fields) throw new BadData(`${type} is not a message of the schema`);
  const out: Row = {};
  for (const f of fields) {
    const given = v[f.json];
    if (given === undefined && PRESENCE.has(`${type}.${f.name}`)) continue;
    const one = (x: unknown): unknown => f.kind === 'message' ? read(f.type, x, encoding) : f.kind === 'enum' ? enumNumber(x, f.name) : IDS.has(f.name) && f.type === 'bytes' ? idOf(x, encoding, f.name) : scalar(f.type, x, f.name);
    if (f.repeated) {
      if (given !== undefined && !Array.isArray(given)) throw new BadData(`${f.json} must be a list`);
      const list = ((given ?? []) as unknown[]).map(one);
      out[f.name] = f.type === 'opentelemetry.proto.common.v1.KeyValue' && f.name !== 'values' ? keyed(list as Row[]) : list;
    } else out[f.name] = one(given);
  }
  return out;
}

/** A KeyValue list as an object of its keys (the attributes' keys are unique within a list). */
function keyed(list: Row[]): Row {
  return Object.fromEntries(list.map((kv) => [String(kv.key), kv.value ?? null]));
}

const SIGNALS = {
  traces: { request: 'opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest', resources: 'resource_spans', scopes: 'scope_spans', items: 'spans' },
  logs: { request: 'opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest', resources: 'resource_logs', scopes: 'scope_logs', items: 'log_records' },
  metrics: { request: 'opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest', resources: 'resource_metrics', scopes: 'scope_metrics', items: 'metrics' },
} as const;
export type Signal = keyof typeof SIGNALS;
export const requestType = (signal: Signal): string => SIGNALS[signal].request;

/** Each item of a read request with the resource and scope it came under: a span, a log record, or a metric. */
export function items(signal: Signal, request: Row): Row[] {
  const s = SIGNALS[signal];
  const out: Row[] = [];
  for (const r of (request[s.resources] ?? []) as Row[]) {
    for (const sc of (r[s.scopes] ?? []) as Row[]) {
      for (const item of (sc[s.items] ?? []) as Row[]) {
        out.push({ ...item, resource: r.resource, resource_schema_url: r.schema_url ?? '', scope: sc.scope, scope_schema_url: sc.schema_url ?? '' });
      }
    }
  }
  return out;
}

const DATA_KINDS = ['gauge', 'sum', 'histogram', 'exponential_histogram', 'summary'] as const;

/** A metric's data points, each its own record: the point's fields, the metric it is of (`metric`: name, description,
 *  unit, metadata), its data's kind (`type`) and that data's own fields (`aggregation_temporality`, and a sum's
 *  `is_monotonic`), under the metric's resource and scope. A metric with no data is no point. */
export function points(metric: Row): Row[] {
  const kind = DATA_KINDS.find((k) => metric[k] !== undefined);
  if (!kind) return [];
  const data = metric[kind] as Row;
  const { data_points, ...own } = data;
  const { resource, resource_schema_url, scope, scope_schema_url, name, description, unit, metadata } = metric;
  return ((data_points ?? []) as Row[]).map((p) => ({ ...p, metric: { name, description, unit, metadata }, type: kind, ...own, resource, resource_schema_url, scope, scope_schema_url }));
}

/** Whether an id is valid: of its length in bytes and not all zeroes (trace.proto, Span.trace_id and Span.span_id). */
export const validId = (hex: unknown, bytes: number): boolean => typeof hex === 'string' && hex.length === bytes * 2 && !/^0+$/.test(hex);
