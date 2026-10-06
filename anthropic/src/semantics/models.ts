// The Models API: the models the organization can use, newest first (./shared.ts, CATALOG), as LibreChat reads them
// at startup (GET /v1/models). A lookup of the vendor's catalog: nothing is stored.
import type { HandlerContext } from '@volter/world-core';
import { catalogAt, CATALOG, invalid, modelInfo, requestId } from './shared.ts';

/** GET /v1/models */
// source: spec:models_list "The Models API response can be used to determine which models are available for use in the API."
export async function models_list(ctx: HandlerContext): Promise<Response> {
  const q = new URL(ctx.call.request.url).searchParams;
  const raw = q.get('limit');
  const limit = raw === null ? 20 : Number(raw);
  // source: spec:models_list "Number of items to return per page."
  // where the documentation stops: the refusal's words, as the API's validation answers a query out of range
  if (!Number.isInteger(limit) || limit < 1) return invalid(ctx, 'limit: Input should be greater than or equal to 1');
  if (limit > 1000) return invalid(ctx, 'limit: Input should be less than or equal to 1000');
  const catalog = catalogAt(ctx.occurredAt);
  const ids = catalog.map((m) => m.id);
  const after = q.get('after_id');
  const before = q.get('before_id');
  // where the documentation stops: a cursor naming no model answers an empty page
  // source: spec:models_list "When provided, returns the page of results immediately before this object."
  // source: spec:models_list "When provided, returns the page of results immediately after this object."
  const start = after === null ? 0 : ids.includes(after) ? ids.indexOf(after) + 1 : catalog.length;
  const { page, more } = before !== null ? preceding(catalog, before, limit) : { page: catalog.slice(start, start + limit), more: start + limit < catalog.length };
  const data = page.map(modelInfo);
  // source: spec:/components/schemas/ListResponse_ModelInfo_ "Indicates if there are more results in the requested page direction."
  return Response.json(
    { data, has_more: more, first_id: page[0]?.id ?? null, last_id: page[page.length - 1]?.id ?? null },
    { headers: { 'request-id': requestId(ctx) } },
  );
}

/** The documented before_id direction, unused by this customer's forward catalog paging. */
function preceding(catalog: typeof CATALOG, before: string, limit: number): { page: typeof CATALOG; more: boolean } {
  const end = Math.max(0, catalog.findIndex(model => model.id === before));
  return { page: catalog.slice(Math.max(0, end - limit), end), more: end - limit > 0 };
}
