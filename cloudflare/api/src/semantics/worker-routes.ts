// Worker Routes (Cloudflare's "Worker Routes" API): a zone's routes binding URL patterns to Workers, as wrangler deploy
// lists them to warn of a pattern another Worker holds. The twin keeps the routes a deploy made; a Worker's Custom Domains
// are its own (domains.ts), never a route.
import type { HandlerContext } from '@volter/world-core';
import { fail, ok } from './shared.ts';

// source: spec:worker-routes-list-routes "Returns Worker routes for a zone."
export async function worker_routes_list_routes(ctx: HandlerContext): Promise<Response> {
  const zoneId = String(ctx.call.params.zone_id);
  const zone = ctx.rowsRaw('zone').find((z) => String(z.id) === zoneId && z.deleted !== true);
  if (!zone) return fail(404, 7003, `Could not route to /zones/${zoneId}/workers/routes, perhaps your object identifier is invalid?`);
  return ok(ctx.rowsRaw('worker_route').filter((r) => String(r.zone_id) === zoneId && r.deleted !== true).map((r) => ({ id: r.id, pattern: r.pattern, script: r.script ?? null })));
}
