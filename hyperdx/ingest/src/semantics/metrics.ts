// OTLP/HTTP's metrics export (spec: exportMetrics): what an exporter sends to /v1/metrics, each item kept (./shared.ts).
import { exportSignal, keepMetric, type HandlerContext } from './shared.ts';

// source: spec:exportMetrics "The default URL path for requests that carry metrics data."
export async function exportMetrics(ctx: HandlerContext): Promise<Response> {
  return exportSignal(ctx, 'metrics', keepMetric);
}
