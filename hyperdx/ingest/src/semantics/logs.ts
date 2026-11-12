// OTLP/HTTP's logs export (spec: exportLogs): what an exporter sends to /v1/logs, each item kept (./shared.ts).
import { exportSignal, keepLogRecord, type HandlerContext } from './shared.ts';

// source: spec:exportLogs "The default URL path for requests that carry logs data."
export async function exportLogs(ctx: HandlerContext): Promise<Response> {
  return exportSignal(ctx, 'logs', keepLogRecord);
}
