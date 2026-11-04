// The team's Edge Configs (the document's Global Configs), listed.
import type { HandlerContext } from '@volter/world-core';
import { EDGE_CONFIG, EDGE_CONFIG_ITEM, fail, scopeOf, updateEdgeConfigItems, view } from './shared.ts';

/** `GET /v1/global-config`: every Edge Config of the team, unpaged (../../spec/patches.json: the answer is a list). */
// source: spec:getEdgeConfigs "Returns all Global Configs."
export async function getEdgeConfigs(ctx: HandlerContext): Promise<Response> {
  const s = scopeOf(ctx);
  if (s instanceof Response) return s;
  return Response.json(ctx.rowsRaw(EDGE_CONFIG).filter((e) => e.ownerId === s.team.id && (!s.project || e._project === s.project.name)).map((e) => view(ctx, e, true)));
}


/** Refresh observes the same item shape the mutation stores, one subject per key. */
// source: spec:getEdgeConfigItems "Returns all items of a Global Config."
export async function getEdgeConfigItems(ctx: HandlerContext): Promise<Response> {
  const scoped = scopeOf(ctx);
  if (scoped instanceof Response) return scoped;
  const id = String(ctx.call.params.edgeConfigId);
  if (!ctx.rowsRaw(EDGE_CONFIG).some((e) => e.id === id && e.ownerId === scoped.team.id && (!scoped.project || e._project === scoped.project.name))) return fail(404, 'not_found', 'Could not find the Edge Config');
  return Response.json(ctx.rowsRaw(EDGE_CONFIG_ITEM).filter((item) => item.edgeConfigId === id).map((item) => view(ctx, item)));
}


// source: spec:patchEdgeConfigItems "items"
export async function patchEdgeConfigItems(ctx: HandlerContext): Promise<Response> {
  return updateEdgeConfigItems(ctx);
}
