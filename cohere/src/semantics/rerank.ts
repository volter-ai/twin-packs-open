// Rerank is a stateless compute API. The labeled stand-in compares Unicode words, not semantic relevance;
// its token budget counts those words, not Cohere tokenizer tokens. No inference, queue or load is simulated.
import type { HandlerContext } from '@volter/world-core';
import { cohereError, modelAvailable, type Row } from './shared.ts';

// source: https://docs.cohere.com/v2/reference/rerank "An ordered list of ranked documents"
export async function rerankv2(ctx: HandlerContext): Promise<Response> {
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  // source: https://raw.githubusercontent.com/cohere-ai/cohere-developer-experience/35f6d97b834974daa7dde160f7ad942a8b0c2b12/fern/pages/changelog/2024-09-26-api-v2.mdx "Thurs Sept 26 2024"
  if (ctx.occurredAt < '2024-09-26T00:00:00.000Z') return cohereError(ctx, 404, '404 page not found');
  // source: https://docs.cohere.com/v2/reference/rerank "model string Required"
  // Where the error text is unspecified, use Cohere's documented 400 class.
  if (typeof b.model !== 'string' || !b.model) return cohereError(ctx, 400, 'a model parameter is required for this endpoint.');
  // source: https://docs.cohere.com/v2/reference/errors "404 responses are sent when the requested resource is not found."
  if (!modelAvailable(b.model, ctx.occurredAt)) return cohereError(ctx, 404, `model '${b.model}' not found, make sure the correct model ID was used and that you have access to the model.`);
  // source: https://docs.cohere.com/v2/reference/errors "invalid request: query must not be empty or be only whitespace"
  if (typeof b.query !== 'string' || !b.query.trim()) return cohereError(ctx, 400, 'invalid request: query must not be empty or be only whitespace');
  // source: https://docs.cohere.com/v2/reference/errors "invalid request: list of documents must not be empty"
  if (!Array.isArray(b.documents) || b.documents.length === 0) return cohereError(ctx, 400, 'invalid request: list of documents must not be empty');
  // source: https://docs.cohere.com/docs/reranking-best-practices "the endpoint will throw an error if the user attempts to pass more than 10,000 documents at a time."
  if (b.documents.length > 10000) return cohereError(ctx, 400, 'invalid request: number of total max chunks (number of documents * max chunks per doc) must be less than 10000');
  // source: https://docs.cohere.com/changelog/rerank-v3.5 "support for passing a list of objects for the documents parameter has been removed"
  // source: https://docs.cohere.com/docs/rerank-overview "formatting them as YAML strings"
  // Where the documentation stops: it gives the 400 class, not an exact non-string element message.
  if (b.documents.some((d) => typeof d !== 'string')) return cohereError(ctx, 400, 'invalid request: documents must be a list of strings');
  // source: https://docs.cohere.com/v2/reference/errors "invalid request: document at index 0 cannot be empty"
  const empty = b.documents.findIndex((d) => !d.trim());
  if (empty >= 0) return cohereError(ctx, 400, `invalid request: document at index ${empty} cannot be empty`);
  // source: https://docs.cohere.com/v2/reference/rerank "If not passed, all the rerank results will be returned."
  const topN = b.top_n === undefined ? b.documents.length : b.top_n;
  // source: https://docs.cohere.com/v2/reference/rerank "top_n integer Optional >=1"
  if (typeof topN !== 'number' || !Number.isInteger(topN) || topN < 1) return cohereError(ctx, 400, 'invalid request: top_n must be a positive integer');
  // source: https://docs.cohere.com/v2/reference/rerank "Defaults to 4096"
  const maxTokens = b.max_tokens_per_doc === undefined ? 4096 : b.max_tokens_per_doc;
  // source: https://docs.cohere.com/docs/reranking-best-practices "Number of Tokens per Document 1"
  // Where the exact validation message is unspecified, use Cohere's 400 class for an invalid token budget.
  if (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens < 1) return cohereError(ctx, 400, 'invalid request: max_tokens_per_doc must be a positive integer');
  // source: https://docs.cohere.com/v2/reference/rerank "priority integer Optional 0-999 Defaults to 0"
  // Priority only changes scheduling under load. This immediate deterministic stand-in has no queue or load.
  const priority = b.priority === undefined ? 0 : b.priority;
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0 || priority > 999) return cohereError(ctx, 400, 'invalid request: priority must be an integer between 0 and 999');
  // source: https://docs.cohere.com/docs/reranking-best-practices "it will be truncated to the first 2048 tokens"
  // source: https://docs.cohere.com/docs/reranking-best-practices "it will be truncated to the first 16,384 tokens"
  const queryLimit = b.model.startsWith('rerank-v4.0-') ? 16384 : 2048;
  const q = new Set((b.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, queryLimit));
  // source: https://docs.cohere.com/v2/reference/rerank "Long documents will be automatically truncated to the specified number of tokens."
  const scored = (b.documents as string[]).map((d, index) => {
    const w = new Set((d.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, maxTokens));
    const overlap = q.size ? [...q].filter((x) => w.has(x)).length / q.size : 0;
    // source: https://docs.cohere.com/docs/reranking-best-practices "Relevance scores are normalized to be in the range [0, 1]"
    return { index, relevance_score: Math.round((0.01 + 0.98 * overlap) * 1e6) / 1e6 };
  }).sort((x, y) => y.relevance_score - x.relevance_score || x.index - y.index);
  return Response.json({
    id: ctx.crypto.uuidFrom(`cohere-rerank:${ctx.occurredAt}:${JSON.stringify(b)}`), results: scored.slice(0, topN),
    // source: spec:/components/schemas/ApiMeta/properties/billed_units/properties/search_units "The number of billed search units."
    meta: { api_version: { version: '2', is_experimental: false }, billed_units: { search_units: 1 }, warnings: ['twin: relevance is lexical overlap with the query; no rerank model runs; token budgets count Unicode words'] },
  });
}
