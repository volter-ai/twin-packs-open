// The OTLP messages' fields, by number, for the kernel's protobuf codec (`protobuf.decodeMessage`/`encodeMessage`):
// data read from the vendored .proto files (../../spec/proto, opentelemetry-proto v1.11.1, googleapis' google/rpc/status.proto
// and protobuf's google/protobuf/any.proto) by the installed standard's proto reader (`readProtoFiles` and
// `protoSchema` of @volter/twin-standard's spec-ir-proto.ts), the reader `twin-standard derive` uses for a proto unit;
// spec/SOURCE.md names the command. Pure data: nothing here runs.
type Field = { name: string; json: string; number: number; type: string; kind: 'scalar' | 'message' | 'enum'; repeated?: true };

export const SCHEMA: { messages: Record<string, Field[]>; enums: Record<string, Record<string, number>>; rpcs: Record<string, never> } = {
  messages: {
    "google.protobuf.Any": [
      {"name": "type_url", "json": "typeUrl", "number": 1, "type": "string", "kind": "scalar"},
      {"name": "value", "json": "value", "number": 2, "type": "bytes", "kind": "scalar"},
    ],
    "google.rpc.Status": [
      {"name": "code", "json": "code", "number": 1, "type": "int32", "kind": "scalar"},
      {"name": "message", "json": "message", "number": 2, "type": "string", "kind": "scalar"},
      {"name": "details", "json": "details", "number": 3, "type": "google.protobuf.Any", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest": [
      {"name": "resource_logs", "json": "resourceLogs", "number": 1, "type": "opentelemetry.proto.logs.v1.ResourceLogs", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse": [
      {"name": "partial_success", "json": "partialSuccess", "number": 1, "type": "opentelemetry.proto.collector.logs.v1.ExportLogsPartialSuccess", "kind": "message"},
    ],
    "opentelemetry.proto.collector.logs.v1.ExportLogsPartialSuccess": [
      {"name": "rejected_log_records", "json": "rejectedLogRecords", "number": 1, "type": "int64", "kind": "scalar"},
      {"name": "error_message", "json": "errorMessage", "number": 2, "type": "string", "kind": "scalar"},
    ],
    "opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest": [
      {"name": "resource_metrics", "json": "resourceMetrics", "number": 1, "type": "opentelemetry.proto.metrics.v1.ResourceMetrics", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceResponse": [
      {"name": "partial_success", "json": "partialSuccess", "number": 1, "type": "opentelemetry.proto.collector.metrics.v1.ExportMetricsPartialSuccess", "kind": "message"},
    ],
    "opentelemetry.proto.collector.metrics.v1.ExportMetricsPartialSuccess": [
      {"name": "rejected_data_points", "json": "rejectedDataPoints", "number": 1, "type": "int64", "kind": "scalar"},
      {"name": "error_message", "json": "errorMessage", "number": 2, "type": "string", "kind": "scalar"},
    ],
    "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest": [
      {"name": "resource_spans", "json": "resourceSpans", "number": 1, "type": "opentelemetry.proto.trace.v1.ResourceSpans", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse": [
      {"name": "partial_success", "json": "partialSuccess", "number": 1, "type": "opentelemetry.proto.collector.trace.v1.ExportTracePartialSuccess", "kind": "message"},
    ],
    "opentelemetry.proto.collector.trace.v1.ExportTracePartialSuccess": [
      {"name": "rejected_spans", "json": "rejectedSpans", "number": 1, "type": "int64", "kind": "scalar"},
      {"name": "error_message", "json": "errorMessage", "number": 2, "type": "string", "kind": "scalar"},
    ],
    "opentelemetry.proto.common.v1.AnyValue": [
      {"name": "string_value", "json": "stringValue", "number": 1, "type": "string", "kind": "scalar"},
      {"name": "bool_value", "json": "boolValue", "number": 2, "type": "bool", "kind": "scalar"},
      {"name": "int_value", "json": "intValue", "number": 3, "type": "int64", "kind": "scalar"},
      {"name": "double_value", "json": "doubleValue", "number": 4, "type": "double", "kind": "scalar"},
      {"name": "array_value", "json": "arrayValue", "number": 5, "type": "opentelemetry.proto.common.v1.ArrayValue", "kind": "message"},
      {"name": "kvlist_value", "json": "kvlistValue", "number": 6, "type": "opentelemetry.proto.common.v1.KeyValueList", "kind": "message"},
      {"name": "bytes_value", "json": "bytesValue", "number": 7, "type": "bytes", "kind": "scalar"},
      {"name": "string_value_strindex", "json": "stringValueStrindex", "number": 8, "type": "int32", "kind": "scalar"},
    ],
    "opentelemetry.proto.common.v1.ArrayValue": [
      {"name": "values", "json": "values", "number": 1, "type": "opentelemetry.proto.common.v1.AnyValue", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.common.v1.KeyValueList": [
      {"name": "values", "json": "values", "number": 1, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.common.v1.KeyValue": [
      {"name": "key", "json": "key", "number": 1, "type": "string", "kind": "scalar"},
      {"name": "value", "json": "value", "number": 2, "type": "opentelemetry.proto.common.v1.AnyValue", "kind": "message"},
      {"name": "key_strindex", "json": "keyStrindex", "number": 3, "type": "int32", "kind": "scalar"},
    ],
    "opentelemetry.proto.common.v1.InstrumentationScope": [
      {"name": "name", "json": "name", "number": 1, "type": "string", "kind": "scalar"},
      {"name": "version", "json": "version", "number": 2, "type": "string", "kind": "scalar"},
      {"name": "attributes", "json": "attributes", "number": 3, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
      {"name": "dropped_attributes_count", "json": "droppedAttributesCount", "number": 4, "type": "uint32", "kind": "scalar"},
    ],
    "opentelemetry.proto.common.v1.EntityRef": [
      {"name": "schema_url", "json": "schemaUrl", "number": 1, "type": "string", "kind": "scalar"},
      {"name": "type", "json": "type", "number": 2, "type": "string", "kind": "scalar"},
      {"name": "id_keys", "json": "idKeys", "number": 3, "type": "string", "kind": "scalar", "repeated": true},
      {"name": "description_keys", "json": "descriptionKeys", "number": 4, "type": "string", "kind": "scalar", "repeated": true},
    ],
    "opentelemetry.proto.logs.v1.LogsData": [
      {"name": "resource_logs", "json": "resourceLogs", "number": 1, "type": "opentelemetry.proto.logs.v1.ResourceLogs", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.logs.v1.ResourceLogs": [
      {"name": "resource", "json": "resource", "number": 1, "type": "opentelemetry.proto.resource.v1.Resource", "kind": "message"},
      {"name": "scope_logs", "json": "scopeLogs", "number": 2, "type": "opentelemetry.proto.logs.v1.ScopeLogs", "kind": "message", "repeated": true},
      {"name": "schema_url", "json": "schemaUrl", "number": 3, "type": "string", "kind": "scalar"},
    ],
    "opentelemetry.proto.logs.v1.ScopeLogs": [
      {"name": "scope", "json": "scope", "number": 1, "type": "opentelemetry.proto.common.v1.InstrumentationScope", "kind": "message"},
      {"name": "log_records", "json": "logRecords", "number": 2, "type": "opentelemetry.proto.logs.v1.LogRecord", "kind": "message", "repeated": true},
      {"name": "schema_url", "json": "schemaUrl", "number": 3, "type": "string", "kind": "scalar"},
    ],
    "opentelemetry.proto.logs.v1.LogRecord": [
      {"name": "time_unix_nano", "json": "timeUnixNano", "number": 1, "type": "fixed64", "kind": "scalar"},
      {"name": "observed_time_unix_nano", "json": "observedTimeUnixNano", "number": 11, "type": "fixed64", "kind": "scalar"},
      {"name": "severity_number", "json": "severityNumber", "number": 2, "type": "opentelemetry.proto.logs.v1.SeverityNumber", "kind": "enum"},
      {"name": "severity_text", "json": "severityText", "number": 3, "type": "string", "kind": "scalar"},
      {"name": "body", "json": "body", "number": 5, "type": "opentelemetry.proto.common.v1.AnyValue", "kind": "message"},
      {"name": "attributes", "json": "attributes", "number": 6, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
      {"name": "dropped_attributes_count", "json": "droppedAttributesCount", "number": 7, "type": "uint32", "kind": "scalar"},
      {"name": "flags", "json": "flags", "number": 8, "type": "fixed32", "kind": "scalar"},
      {"name": "trace_id", "json": "traceId", "number": 9, "type": "bytes", "kind": "scalar"},
      {"name": "span_id", "json": "spanId", "number": 10, "type": "bytes", "kind": "scalar"},
      {"name": "event_name", "json": "eventName", "number": 12, "type": "string", "kind": "scalar"},
    ],
    "opentelemetry.proto.metrics.v1.MetricsData": [
      {"name": "resource_metrics", "json": "resourceMetrics", "number": 1, "type": "opentelemetry.proto.metrics.v1.ResourceMetrics", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.metrics.v1.ResourceMetrics": [
      {"name": "resource", "json": "resource", "number": 1, "type": "opentelemetry.proto.resource.v1.Resource", "kind": "message"},
      {"name": "scope_metrics", "json": "scopeMetrics", "number": 2, "type": "opentelemetry.proto.metrics.v1.ScopeMetrics", "kind": "message", "repeated": true},
      {"name": "schema_url", "json": "schemaUrl", "number": 3, "type": "string", "kind": "scalar"},
    ],
    "opentelemetry.proto.metrics.v1.ScopeMetrics": [
      {"name": "scope", "json": "scope", "number": 1, "type": "opentelemetry.proto.common.v1.InstrumentationScope", "kind": "message"},
      {"name": "metrics", "json": "metrics", "number": 2, "type": "opentelemetry.proto.metrics.v1.Metric", "kind": "message", "repeated": true},
      {"name": "schema_url", "json": "schemaUrl", "number": 3, "type": "string", "kind": "scalar"},
    ],
    "opentelemetry.proto.metrics.v1.Metric": [
      {"name": "name", "json": "name", "number": 1, "type": "string", "kind": "scalar"},
      {"name": "description", "json": "description", "number": 2, "type": "string", "kind": "scalar"},
      {"name": "unit", "json": "unit", "number": 3, "type": "string", "kind": "scalar"},
      {"name": "gauge", "json": "gauge", "number": 5, "type": "opentelemetry.proto.metrics.v1.Gauge", "kind": "message"},
      {"name": "sum", "json": "sum", "number": 7, "type": "opentelemetry.proto.metrics.v1.Sum", "kind": "message"},
      {"name": "histogram", "json": "histogram", "number": 9, "type": "opentelemetry.proto.metrics.v1.Histogram", "kind": "message"},
      {"name": "exponential_histogram", "json": "exponentialHistogram", "number": 10, "type": "opentelemetry.proto.metrics.v1.ExponentialHistogram", "kind": "message"},
      {"name": "summary", "json": "summary", "number": 11, "type": "opentelemetry.proto.metrics.v1.Summary", "kind": "message"},
      {"name": "metadata", "json": "metadata", "number": 12, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.metrics.v1.Gauge": [
      {"name": "data_points", "json": "dataPoints", "number": 1, "type": "opentelemetry.proto.metrics.v1.NumberDataPoint", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.metrics.v1.Sum": [
      {"name": "data_points", "json": "dataPoints", "number": 1, "type": "opentelemetry.proto.metrics.v1.NumberDataPoint", "kind": "message", "repeated": true},
      {"name": "aggregation_temporality", "json": "aggregationTemporality", "number": 2, "type": "opentelemetry.proto.metrics.v1.AggregationTemporality", "kind": "enum"},
      {"name": "is_monotonic", "json": "isMonotonic", "number": 3, "type": "bool", "kind": "scalar"},
    ],
    "opentelemetry.proto.metrics.v1.Histogram": [
      {"name": "data_points", "json": "dataPoints", "number": 1, "type": "opentelemetry.proto.metrics.v1.HistogramDataPoint", "kind": "message", "repeated": true},
      {"name": "aggregation_temporality", "json": "aggregationTemporality", "number": 2, "type": "opentelemetry.proto.metrics.v1.AggregationTemporality", "kind": "enum"},
    ],
    "opentelemetry.proto.metrics.v1.ExponentialHistogram": [
      {"name": "data_points", "json": "dataPoints", "number": 1, "type": "opentelemetry.proto.metrics.v1.ExponentialHistogramDataPoint", "kind": "message", "repeated": true},
      {"name": "aggregation_temporality", "json": "aggregationTemporality", "number": 2, "type": "opentelemetry.proto.metrics.v1.AggregationTemporality", "kind": "enum"},
    ],
    "opentelemetry.proto.metrics.v1.Summary": [
      {"name": "data_points", "json": "dataPoints", "number": 1, "type": "opentelemetry.proto.metrics.v1.SummaryDataPoint", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.metrics.v1.NumberDataPoint": [
      {"name": "attributes", "json": "attributes", "number": 7, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
      {"name": "start_time_unix_nano", "json": "startTimeUnixNano", "number": 2, "type": "fixed64", "kind": "scalar"},
      {"name": "time_unix_nano", "json": "timeUnixNano", "number": 3, "type": "fixed64", "kind": "scalar"},
      {"name": "as_double", "json": "asDouble", "number": 4, "type": "double", "kind": "scalar"},
      {"name": "as_int", "json": "asInt", "number": 6, "type": "sfixed64", "kind": "scalar"},
      {"name": "exemplars", "json": "exemplars", "number": 5, "type": "opentelemetry.proto.metrics.v1.Exemplar", "kind": "message", "repeated": true},
      {"name": "flags", "json": "flags", "number": 8, "type": "uint32", "kind": "scalar"},
    ],
    "opentelemetry.proto.metrics.v1.HistogramDataPoint": [
      {"name": "attributes", "json": "attributes", "number": 9, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
      {"name": "start_time_unix_nano", "json": "startTimeUnixNano", "number": 2, "type": "fixed64", "kind": "scalar"},
      {"name": "time_unix_nano", "json": "timeUnixNano", "number": 3, "type": "fixed64", "kind": "scalar"},
      {"name": "count", "json": "count", "number": 4, "type": "fixed64", "kind": "scalar"},
      {"name": "sum", "json": "sum", "number": 5, "type": "double", "kind": "scalar"},
      {"name": "bucket_counts", "json": "bucketCounts", "number": 6, "type": "fixed64", "kind": "scalar", "repeated": true},
      {"name": "explicit_bounds", "json": "explicitBounds", "number": 7, "type": "double", "kind": "scalar", "repeated": true},
      {"name": "exemplars", "json": "exemplars", "number": 8, "type": "opentelemetry.proto.metrics.v1.Exemplar", "kind": "message", "repeated": true},
      {"name": "flags", "json": "flags", "number": 10, "type": "uint32", "kind": "scalar"},
      {"name": "min", "json": "min", "number": 11, "type": "double", "kind": "scalar"},
      {"name": "max", "json": "max", "number": 12, "type": "double", "kind": "scalar"},
    ],
    "opentelemetry.proto.metrics.v1.ExponentialHistogramDataPoint.Buckets": [
      {"name": "offset", "json": "offset", "number": 1, "type": "sint32", "kind": "scalar"},
      {"name": "bucket_counts", "json": "bucketCounts", "number": 2, "type": "uint64", "kind": "scalar", "repeated": true},
    ],
    "opentelemetry.proto.metrics.v1.ExponentialHistogramDataPoint": [
      {"name": "attributes", "json": "attributes", "number": 1, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
      {"name": "start_time_unix_nano", "json": "startTimeUnixNano", "number": 2, "type": "fixed64", "kind": "scalar"},
      {"name": "time_unix_nano", "json": "timeUnixNano", "number": 3, "type": "fixed64", "kind": "scalar"},
      {"name": "count", "json": "count", "number": 4, "type": "fixed64", "kind": "scalar"},
      {"name": "sum", "json": "sum", "number": 5, "type": "double", "kind": "scalar"},
      {"name": "scale", "json": "scale", "number": 6, "type": "sint32", "kind": "scalar"},
      {"name": "zero_count", "json": "zeroCount", "number": 7, "type": "fixed64", "kind": "scalar"},
      {"name": "positive", "json": "positive", "number": 8, "type": "opentelemetry.proto.metrics.v1.ExponentialHistogramDataPoint.Buckets", "kind": "message"},
      {"name": "negative", "json": "negative", "number": 9, "type": "opentelemetry.proto.metrics.v1.ExponentialHistogramDataPoint.Buckets", "kind": "message"},
      {"name": "flags", "json": "flags", "number": 10, "type": "uint32", "kind": "scalar"},
      {"name": "exemplars", "json": "exemplars", "number": 11, "type": "opentelemetry.proto.metrics.v1.Exemplar", "kind": "message", "repeated": true},
      {"name": "min", "json": "min", "number": 12, "type": "double", "kind": "scalar"},
      {"name": "max", "json": "max", "number": 13, "type": "double", "kind": "scalar"},
      {"name": "zero_threshold", "json": "zeroThreshold", "number": 14, "type": "double", "kind": "scalar"},
    ],
    "opentelemetry.proto.metrics.v1.SummaryDataPoint.ValueAtQuantile": [
      {"name": "quantile", "json": "quantile", "number": 1, "type": "double", "kind": "scalar"},
      {"name": "value", "json": "value", "number": 2, "type": "double", "kind": "scalar"},
    ],
    "opentelemetry.proto.metrics.v1.SummaryDataPoint": [
      {"name": "attributes", "json": "attributes", "number": 7, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
      {"name": "start_time_unix_nano", "json": "startTimeUnixNano", "number": 2, "type": "fixed64", "kind": "scalar"},
      {"name": "time_unix_nano", "json": "timeUnixNano", "number": 3, "type": "fixed64", "kind": "scalar"},
      {"name": "count", "json": "count", "number": 4, "type": "fixed64", "kind": "scalar"},
      {"name": "sum", "json": "sum", "number": 5, "type": "double", "kind": "scalar"},
      {"name": "quantile_values", "json": "quantileValues", "number": 6, "type": "opentelemetry.proto.metrics.v1.SummaryDataPoint.ValueAtQuantile", "kind": "message", "repeated": true},
      {"name": "flags", "json": "flags", "number": 8, "type": "uint32", "kind": "scalar"},
    ],
    "opentelemetry.proto.metrics.v1.Exemplar": [
      {"name": "filtered_attributes", "json": "filteredAttributes", "number": 7, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
      {"name": "time_unix_nano", "json": "timeUnixNano", "number": 2, "type": "fixed64", "kind": "scalar"},
      {"name": "as_double", "json": "asDouble", "number": 3, "type": "double", "kind": "scalar"},
      {"name": "as_int", "json": "asInt", "number": 6, "type": "sfixed64", "kind": "scalar"},
      {"name": "span_id", "json": "spanId", "number": 4, "type": "bytes", "kind": "scalar"},
      {"name": "trace_id", "json": "traceId", "number": 5, "type": "bytes", "kind": "scalar"},
    ],
    "opentelemetry.proto.resource.v1.Resource": [
      {"name": "attributes", "json": "attributes", "number": 1, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
      {"name": "dropped_attributes_count", "json": "droppedAttributesCount", "number": 2, "type": "uint32", "kind": "scalar"},
      {"name": "entity_refs", "json": "entityRefs", "number": 3, "type": "opentelemetry.proto.common.v1.EntityRef", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.trace.v1.TracesData": [
      {"name": "resource_spans", "json": "resourceSpans", "number": 1, "type": "opentelemetry.proto.trace.v1.ResourceSpans", "kind": "message", "repeated": true},
    ],
    "opentelemetry.proto.trace.v1.ResourceSpans": [
      {"name": "resource", "json": "resource", "number": 1, "type": "opentelemetry.proto.resource.v1.Resource", "kind": "message"},
      {"name": "scope_spans", "json": "scopeSpans", "number": 2, "type": "opentelemetry.proto.trace.v1.ScopeSpans", "kind": "message", "repeated": true},
      {"name": "schema_url", "json": "schemaUrl", "number": 3, "type": "string", "kind": "scalar"},
    ],
    "opentelemetry.proto.trace.v1.ScopeSpans": [
      {"name": "scope", "json": "scope", "number": 1, "type": "opentelemetry.proto.common.v1.InstrumentationScope", "kind": "message"},
      {"name": "spans", "json": "spans", "number": 2, "type": "opentelemetry.proto.trace.v1.Span", "kind": "message", "repeated": true},
      {"name": "schema_url", "json": "schemaUrl", "number": 3, "type": "string", "kind": "scalar"},
    ],
    "opentelemetry.proto.trace.v1.Span.Event": [
      {"name": "time_unix_nano", "json": "timeUnixNano", "number": 1, "type": "fixed64", "kind": "scalar"},
      {"name": "name", "json": "name", "number": 2, "type": "string", "kind": "scalar"},
      {"name": "attributes", "json": "attributes", "number": 3, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
      {"name": "dropped_attributes_count", "json": "droppedAttributesCount", "number": 4, "type": "uint32", "kind": "scalar"},
    ],
    "opentelemetry.proto.trace.v1.Span.Link": [
      {"name": "trace_id", "json": "traceId", "number": 1, "type": "bytes", "kind": "scalar"},
      {"name": "span_id", "json": "spanId", "number": 2, "type": "bytes", "kind": "scalar"},
      {"name": "trace_state", "json": "traceState", "number": 3, "type": "string", "kind": "scalar"},
      {"name": "attributes", "json": "attributes", "number": 4, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
      {"name": "dropped_attributes_count", "json": "droppedAttributesCount", "number": 5, "type": "uint32", "kind": "scalar"},
      {"name": "flags", "json": "flags", "number": 6, "type": "fixed32", "kind": "scalar"},
    ],
    "opentelemetry.proto.trace.v1.Span": [
      {"name": "trace_id", "json": "traceId", "number": 1, "type": "bytes", "kind": "scalar"},
      {"name": "span_id", "json": "spanId", "number": 2, "type": "bytes", "kind": "scalar"},
      {"name": "trace_state", "json": "traceState", "number": 3, "type": "string", "kind": "scalar"},
      {"name": "parent_span_id", "json": "parentSpanId", "number": 4, "type": "bytes", "kind": "scalar"},
      {"name": "flags", "json": "flags", "number": 16, "type": "fixed32", "kind": "scalar"},
      {"name": "name", "json": "name", "number": 5, "type": "string", "kind": "scalar"},
      {"name": "kind", "json": "kind", "number": 6, "type": "opentelemetry.proto.trace.v1.Span.SpanKind", "kind": "enum"},
      {"name": "start_time_unix_nano", "json": "startTimeUnixNano", "number": 7, "type": "fixed64", "kind": "scalar"},
      {"name": "end_time_unix_nano", "json": "endTimeUnixNano", "number": 8, "type": "fixed64", "kind": "scalar"},
      {"name": "attributes", "json": "attributes", "number": 9, "type": "opentelemetry.proto.common.v1.KeyValue", "kind": "message", "repeated": true},
      {"name": "dropped_attributes_count", "json": "droppedAttributesCount", "number": 10, "type": "uint32", "kind": "scalar"},
      {"name": "events", "json": "events", "number": 11, "type": "opentelemetry.proto.trace.v1.Span.Event", "kind": "message", "repeated": true},
      {"name": "dropped_events_count", "json": "droppedEventsCount", "number": 12, "type": "uint32", "kind": "scalar"},
      {"name": "links", "json": "links", "number": 13, "type": "opentelemetry.proto.trace.v1.Span.Link", "kind": "message", "repeated": true},
      {"name": "dropped_links_count", "json": "droppedLinksCount", "number": 14, "type": "uint32", "kind": "scalar"},
      {"name": "status", "json": "status", "number": 15, "type": "opentelemetry.proto.trace.v1.Status", "kind": "message"},
    ],
    "opentelemetry.proto.trace.v1.Status": [
      {"name": "message", "json": "message", "number": 2, "type": "string", "kind": "scalar"},
      {"name": "code", "json": "code", "number": 3, "type": "opentelemetry.proto.trace.v1.Status.StatusCode", "kind": "enum"},
    ],
  },
  enums: {
    "opentelemetry.proto.logs.v1.SeverityNumber": {"SEVERITY_NUMBER_UNSPECIFIED": 0, "SEVERITY_NUMBER_TRACE": 1, "SEVERITY_NUMBER_TRACE2": 2, "SEVERITY_NUMBER_TRACE3": 3, "SEVERITY_NUMBER_TRACE4": 4, "SEVERITY_NUMBER_DEBUG": 5, "SEVERITY_NUMBER_DEBUG2": 6, "SEVERITY_NUMBER_DEBUG3": 7, "SEVERITY_NUMBER_DEBUG4": 8, "SEVERITY_NUMBER_INFO": 9, "SEVERITY_NUMBER_INFO2": 10, "SEVERITY_NUMBER_INFO3": 11, "SEVERITY_NUMBER_INFO4": 12, "SEVERITY_NUMBER_WARN": 13, "SEVERITY_NUMBER_WARN2": 14, "SEVERITY_NUMBER_WARN3": 15, "SEVERITY_NUMBER_WARN4": 16, "SEVERITY_NUMBER_ERROR": 17, "SEVERITY_NUMBER_ERROR2": 18, "SEVERITY_NUMBER_ERROR3": 19, "SEVERITY_NUMBER_ERROR4": 20, "SEVERITY_NUMBER_FATAL": 21, "SEVERITY_NUMBER_FATAL2": 22, "SEVERITY_NUMBER_FATAL3": 23, "SEVERITY_NUMBER_FATAL4": 24},
    "opentelemetry.proto.logs.v1.LogRecordFlags": {"LOG_RECORD_FLAGS_DO_NOT_USE": 0, "LOG_RECORD_FLAGS_TRACE_FLAGS_MASK": 255},
    "opentelemetry.proto.metrics.v1.AggregationTemporality": {"AGGREGATION_TEMPORALITY_UNSPECIFIED": 0, "AGGREGATION_TEMPORALITY_DELTA": 1, "AGGREGATION_TEMPORALITY_CUMULATIVE": 2},
    "opentelemetry.proto.metrics.v1.DataPointFlags": {"DATA_POINT_FLAGS_DO_NOT_USE": 0, "DATA_POINT_FLAGS_NO_RECORDED_VALUE_MASK": 1},
    "opentelemetry.proto.trace.v1.Span.SpanKind": {"SPAN_KIND_UNSPECIFIED": 0, "SPAN_KIND_INTERNAL": 1, "SPAN_KIND_SERVER": 2, "SPAN_KIND_CLIENT": 3, "SPAN_KIND_PRODUCER": 4, "SPAN_KIND_CONSUMER": 5},
    "opentelemetry.proto.trace.v1.Status.StatusCode": {"STATUS_CODE_UNSET": 0, "STATUS_CODE_OK": 1, "STATUS_CODE_ERROR": 2},
    "opentelemetry.proto.trace.v1.SpanFlags": {"SPAN_FLAGS_DO_NOT_USE": 0, "SPAN_FLAGS_TRACE_FLAGS_MASK": 255, "SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE_MASK": 256, "SPAN_FLAGS_CONTEXT_IS_REMOTE_MASK": 512},
  },
  rpcs: {},
};
