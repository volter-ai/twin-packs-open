// HyperDX's sources (spec tag Sources): the team's sources, listed and read by id. Creating, updating and deleting a
// source answer the gap.
import type { HandlerContext } from '@volter/world-core';
import { isObjectId, message, sourcesOf, teamOf } from './shared.ts';

// source: spec:listSources "Retrieves a list of all sources for the authenticated team"
// source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/sources.ts "data: sources.map(formatExternalSource).filter(s => s !== undefined),"
export async function listSources(ctx: HandlerContext): Promise<Response> {
  const team = teamOf(ctx);
  // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/sources.ts "return res.status(403).json({ message: 'Forbidden' });"
  if (!team) return message(403, 'Forbidden');
  return Response.json({ data: sourcesOf(ctx, team) });
}

// source: spec:getSource "Retrieves a specific source by ID"
export async function getSource(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.call.params.id ?? '');
  // the id is validated before the handler runs, so a malformed one is refused before the team is read
  // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/utils/enhancedErrors.ts "errors.push("
  // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/utils/enhancedErrors.ts "Params validation failed: ${formatZodError(result.error)}"
  if (!isObjectId(id)) return message(400, 'Params validation failed: id: Invalid ObjectId');
  const team = teamOf(ctx);
  if (!team) return message(403, 'Forbidden');
  const source = sourcesOf(ctx, team).find((s) => s.id === id);
  // source: spec:getSource "Source not found"
  if (!source) return message(404, 'Source not found');
  // source: https://raw.githubusercontent.com/hyperdxio/hyperdx/049ec84245d4e0572a6301b2179265fbbbb344e3/packages/api/src/routers/external-api/v2/sources.ts "res.json({ data });"
  return Response.json({ data: source });
}
