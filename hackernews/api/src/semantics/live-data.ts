// The README's Live Data: the largest item id, the story lists and the changes (api/spec/api-readme.md, "Live Data").
// Each list is the site's own, read from the one store as it stands at the World's instant.
import type { HandlerContext } from '@volter/world-core';
import { allItems, answer, askNew, best, frontPage, ids, newest, showNew, unixOf, wire } from './shared.ts';

/** GET /v0/maxitem.json */
export async function getMaxItem(ctx: HandlerContext): Promise<Response> {
  // source: https://raw.githubusercontent.com/HackerNews/API/8a0528f538bca407c2ceeeefc9bee48bdb99c1c8/README.md "The current largest item id is at"
  const max = allItems(ctx).reduce((m, i) => Math.max(m, Number(i.id)), 0);
  // Where the documentation stops: a site with no items has no largest id; Firebase answers null for it
  return answer(ctx, max || null);
}

/** GET /v0/topstories.json — the front page's stories, in its order. */
export async function getTopStories(ctx: HandlerContext): Promise<Response> {
  // source: https://raw.githubusercontent.com/HackerNews/API/8a0528f538bca407c2ceeeefc9bee48bdb99c1c8/README.md "Up to 500 top and new stories are at"
  return answer(ctx, ids(frontPage(ctx, unixOf(ctx.occurredAt)), 500));
}

/** GET /v0/newstories.json — newest first. */
export async function getNewStories(ctx: HandlerContext): Promise<Response> {
  // source: https://raw.githubusercontent.com/HackerNews/API/8a0528f538bca407c2ceeeefc9bee48bdb99c1c8/README.md "The newest page? Starts at item maxid and walks backward, keeping only the top level stories."
  return answer(ctx, ids(newest(ctx), 500));
}

/** GET /v0/beststories.json */
export async function getBestStories(ctx: HandlerContext): Promise<Response> {
  // source: https://raw.githubusercontent.com/HackerNews/API/8a0528f538bca407c2ceeeefc9bee48bdb99c1c8/README.md "Best stories are at"
  return answer(ctx, ids(best(ctx), 500));
}

/** GET /v0/askstories.json */
export async function getAskStories(ctx: HandlerContext): Promise<Response> {
  // source: https://raw.githubusercontent.com/HackerNews/API/8a0528f538bca407c2ceeeefc9bee48bdb99c1c8/README.md "Up to 200 of the latest Ask HN, Show HN, and Job stories are at"
  return answer(ctx, ids(askNew(ctx), 200));
}

/** GET /v0/showstories.json */
export async function getShowStories(ctx: HandlerContext): Promise<Response> {
  // source: https://raw.githubusercontent.com/HackerNews/API/8a0528f538bca407c2ceeeefc9bee48bdb99c1c8/README.md "Up to 200 of the latest Ask HN, Show HN, and Job stories are at"
  return answer(ctx, ids(showNew(ctx), 200));
}

/** GET /v0/updates.json — the items and profiles changed most recently. */
export async function getUpdates(ctx: HandlerContext): Promise<Response> {
  // source: https://raw.githubusercontent.com/HackerNews/API/8a0528f538bca407c2ceeeefc9bee48bdb99c1c8/README.md "The item and profile changes are at"
  // Where the documentation stops: how far back the changes reach is not stated (the README's example holds 29 items
  // and 32 profiles); the twin answers the 30 last changed of each, most recent first.
  const recent = (type: string): Array<Record<string, unknown>> => ctx.rowsRaw(type).slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.id).localeCompare(String(a.id))).slice(0, 30);
  return answer(ctx, { items: recent('item').map((r) => Number(wire(ctx, r).id)), profiles: recent('user').filter((r) => Array.isArray(r.submitted) && r.submitted.length > 0).map((r) => String(wire(ctx, r).id)) });
}
