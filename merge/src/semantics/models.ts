// Gateway's model catalogue (GET /v1/models), as Open Autonomy's /v1/catalog pages it: the twin's catalogue
// (./shared.ts, MODELS), filtered, paged by cursor, each model as the caller's organization may route to it.
import type { HandlerContext } from '@volter/world-core';
import { MODELS, mergeError, organizationOf, publicModel } from './shared.ts';

// source: spec:models_list "List all available public models."
export async function models_list(ctx: HandlerContext): Promise<Response> {
  const org = organizationOf(ctx);
  if (org instanceof Response) return org;
  const q = new URL(ctx.call.request.url).searchParams;
  // source: spec:models_list "A limit above 500 is rejected with 422"
  const raw = q.get('limit');
  const limit = raw === null ? 50 : Number(raw);
  // Where the documentation stops: the 422's detail is the spec's HTTPValidationError, its words the validator's
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    return Response.json({ detail: [{ type: 'less_than_equal', loc: ['query', 'limit'], msg: 'Input should be a whole number from 1 to 500', input: raw }] }, { status: 422 });
  }
  // source: spec:models_list "fetching a single model by query parameter with ?model=<provider/model-name>"
  const one = q.get('model');
  if (one !== null) {
    const m = MODELS.find((x) => x.id === one);
    // source: https://docs.merge.dev/merge-gateway/errors "Unknown model or alias."
    return m ? Response.json(publicModel(org, m)) : mergeError(404, 'not_found_error', `Model '${one}' is not supported. Check /v1/models for available models.`, { code: 'model_not_found', param: 'model', read: true });
  }
  // source: spec:models_list "Supports filtering by provider or vendor"
  const provider = q.get('provider');
  const vendor = q.get('vendor');
  // source: spec:/paths/~1v1~1models/get/parameters/3/description "When true, list only models with at least one ZDR vendor"
  const zdr = q.get('zero_data_retention');
  const listed = MODELS.filter((m) => (provider === null || m.id.split('/')[0] === provider) && (vendor === null || m.vendor === vendor) && zdr !== 'true')
    .sort((a, b) => a.id.localeCompare(b.id));
  // source: https://docs.merge.dev/merge-gateway/api-overview "an unknown or stale cursor restarts at the first page"
  const cursor = q.get('cursor');
  const at = cursor === null ? 0 : listed.findIndex((m) => m.id === cursor) + 1;
  const page = listed.slice(at, at + limit);
  const more = at + limit < listed.length;
  return Response.json({ object: 'list', data: page.map((m) => publicModel(org, m)), has_more: more, next_cursor: more ? page.at(-1)!.id : null });
}
