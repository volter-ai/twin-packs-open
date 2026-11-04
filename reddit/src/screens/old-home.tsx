// old.reddit.com's front page (a workspace, twin-world's architecture "Screens"): the same feed as www.reddit.com's front
// page (./home.tsx: signed in, the communities the person joined or moderates, Hot first; else every public community's
// posts), drawn as r2's listing (./shared.tsx OldThing). Volter Browsers' frontline opens it as Reddit's feed
// (volter-ai/lucarne 83c544c packages/lucarne-sites/src/policy.ts:44).
import type { HandlerContext } from '@volter/world-core';
import { linksOf, linkView, membership, sortLinks, SUBREDDIT } from '../semantics/shared.ts';
import { OldThing, oldPage, viewerOf } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const viewer = await viewerOf(ctx);
  // the root alone: every other path no page draws is a page Reddit does not have
  if (new URL(ctx.call.request.url).pathname.replace(/\/+$/, '') !== '') return oldPage(ctx, 'reddit.com: page not found', viewer, <p className="error">the page you requested does not exist</p>, 404);
  const me = viewer ? String(viewer.account.id) : undefined;
  const open = ctx.rowsRaw(SUBREDDIT).filter((sr) => sr._profile_of === undefined && sr.subreddit_type !== 'private');
  const joined = me ? open.filter((sr) => { const m = membership(ctx, String(sr.id), me); return m.subscriber || m.moderator; }) : [];
  const posts = sortLinks(ctx, (joined.length ? joined : open).flatMap((sr) => linksOf(ctx, String(sr.id))), 'hot').map((l) => linkView(ctx, l, me));
  const now = Math.floor(Date.parse(ctx.occurredAt) / 1000);
  return oldPage(ctx, 'reddit: the front page of the internet', viewer, (
    <div id="siteTable" className="sitetable linklisting">{posts.map((p) => <OldThing key={String(p.id)} post={p} now={now} />)}</div>
  ));
}
