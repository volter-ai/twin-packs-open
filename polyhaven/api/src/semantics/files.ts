import type { HandlerContext } from '@volter/world-core';
import { ASSET, obj, phText } from './shared.ts';

// source: spec:get_files_id "This endpoint provides a tree containing all the available files organized by resolution and file type."
export async function get_files_id(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.call.params.id);
  const a = ctx.row(ASSET, id);
  // source: spec:get_files_id "No asset found with that ID"
  // Where the documentation stops: the words are the ones api.polyhaven.com answers
  if (!a || a.deleted === true) return phText(404, `No asset with id ${id}`);
  return Response.json(obj(a._files));
}

