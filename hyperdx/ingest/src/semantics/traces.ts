// OTLP/HTTP's traces export (spec: exportTraces): what an exporter sends to /v1/traces, each item kept (./shared.ts).
import { exportSignal, keepSpan, type HandlerContext } from './shared.ts';

// source: spec:exportTraces "The default URL path for requests that carry trace data."
export async function exportTraces(ctx: HandlerContext): Promise<Response> {
  return exportSignal(ctx, 'traces', keepSpan);
}
