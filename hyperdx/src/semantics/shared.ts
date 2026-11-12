// What every lane of HyperDX shares (the ingest, the API): the records the ingest keeps, each an OTLP item in the
// .proto files' field names with the resource and scope it came under (../../ingest/src/engine/records.ts), and which
// the API's search reads as HyperDX's Logs and Traces sources answer them.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };

/** A span, keyed `<trace_id>:<span_id>`. */
export const SPAN = 'span';
/** A log record, keyed by a minted id. */
export const LOG_RECORD = 'log_record';
/** A metric data point, keyed by a minted id. */
export const METRIC_POINT = 'metric_point';
