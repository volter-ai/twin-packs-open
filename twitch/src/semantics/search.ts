// The Search family: Search Categories, as the stream manager's category picker finds a category by part of its name.
import type { HandlerContext } from '@volter/world-core';
import { boxArtOf, categoriesMatching, pageOf, twitchError } from './shared.ts';

export async function searchCategories(ctx: HandlerContext): Promise<Response> {
  const query = new URL(ctx.call.request.url).searchParams.get('query') ?? '';
  // source: spec:/paths/~1search~1categories/get/responses/400/description "The query query parameter is required."
  if (!query.trim()) return twitchError(400, 'The query query parameter is required.');
  // source: spec:/components/schemas/SearchCategoriesResponseData/properties/box_art_url/description "A URL to an image of the game"
  return pageOf(ctx, categoriesMatching(query).map((c) => ({ box_art_url: boxArtOf(c.id), name: c.name, id: c.id })));
}
