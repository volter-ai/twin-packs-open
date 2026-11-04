// The README's Items: an item by its id (api/spec/api-readme.md, "Items").
import type { HandlerContext } from '@volter/world-core';
import { answer, itemAt, unixOf } from './shared.ts';

/** GET /v0/item/{id}.json — a story or comment as the site made it; nothing at an id no item has. */
export async function getItem(ctx: HandlerContext): Promise<Response> {
  // source: spec:getItem "Items"
  // Where the documentation stops: the README does not say what an id no item has answers. Firebase reads a location
  // that holds nothing as JSON null with 200, as it reads any location: the twin answers that.
  return answer(ctx, itemAt(ctx, ctx.call.params.id, unixOf(ctx.occurredAt)) ?? null);
}
