// Cohere's error body and model catalogue.
import type { HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
// source: spec:/components/responses/BadRequest "This error is returned when the request is not well formed."
/** Cohere's error body: `{id, message}`. */
export const cohereError = (ctx: Pick<HandlerContext, 'crypto' | 'occurredAt'>, status: number, message: string): Response =>
  Response.json({ id: ctx.crypto.uuidFrom(`cohere-error:${ctx.occurredAt}:${message}`), message }, { status });

// The vendor's currently documented rerank catalogue; release dates are vendor facts. No unknown prefix is accepted.
// source: https://docs.cohere.com/changelog/advanced-retrieval-launch "April 9, 2024"
// source: https://docs.cohere.com/changelog/rerank-v3.5 "December 2, 2024"
// source: https://docs.cohere.com/changelog/rerank-v4.0 "December 11, 2025"
// source: https://docs.cohere.com/docs/rerank "rerank-english-v3.0"
// source: https://docs.cohere.com/docs/rerank "rerank-multilingual-v3.0"
const MODEL_RELEASES: Record<string, string> = {
  'rerank-english-v3.0': '2024-04-09T00:00:00.000Z',
  'rerank-multilingual-v3.0': '2024-04-09T00:00:00.000Z',
  'rerank-v3.5': '2024-12-02T00:00:00.000Z',
  'rerank-v4.0-pro': '2025-12-11T00:00:00.000Z',
  'rerank-v4.0-fast': '2025-12-11T00:00:00.000Z',
};

// source: https://raw.githubusercontent.com/cohere-ai/cohere-developer-experience/35f6d97b834974daa7dde160f7ad942a8b0c2b12/fern/pages/changelog/2024-09-26-api-v2.mdx "Thurs Sept 26 2024"
// The sources give release dates, not per-region rollout instants: the World uses UTC start-of-day.
export function modelAvailable(model: string, at: string): boolean {
  const released = MODEL_RELEASES[model];
  return released !== undefined && at >= released;
}
