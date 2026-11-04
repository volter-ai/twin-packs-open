// R/ALL — www.reddit.com/r/all (a workspace, twin-world's architecture, "Screens"): every public community's posts in
// one listing, Hot (the default) or New, each card naming its community. It is the page the World's console opens for
// Reddit (a workspace whose path names no parameter), and the way across the World's communities.
import type { HandlerContext } from '@volter/world-core';
import { linksOf, linkView, sortLinks, SUBREDDIT } from '../semantics/shared.ts';
import { baseOf, notFoundPage, page, PostCard, viewerOf } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const viewer = await viewerOf(ctx);
  const rest = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '').split('/').slice(3);
  const sort = rest.length === 0 || rest[0] === 'hot' ? 'hot' : rest[0] === 'new' ? 'new' : undefined;
  if (!sort || rest.length > 1) return notFoundPage(ctx, viewer, 'Page not found', 'The page you’re looking for doesn’t exist.');
  const base = baseOf(ctx);
  const me = viewer ? String(viewer.account.id) : undefined;
  // the public communities' posts; a profile's (u_<name>) and a private community's are not in r/all
  const open = ctx.rowsRaw(SUBREDDIT).filter((sr) => sr._profile_of === undefined && sr.subreddit_type !== 'private');
  const posts = sortLinks(ctx, open.flatMap((sr) => linksOf(ctx, String(sr.id))), sort).map((l) => linkView(ctx, l, me));
  const main = (
    <>
      <div className="sr-head all-head"><h1>r/all</h1></div>
      <nav className="sorts" aria-label="Sort by">
        <a href={`${base ?? ''}/r/all/hot/`} aria-current={sort === 'hot' ? 'page' : undefined}>Hot</a>
        <a href={`${base ?? ''}/r/all/new/`} aria-current={sort === 'new' ? 'page' : undefined}>New</a>
      </nav>
      {posts.length === 0 ? <section className="empty"><h2>No posts yet</h2></section>
        : posts.map((p) => <PostCard key={String(p.id)} ctx={ctx} post={p} base={base} mode="listing" viewer={viewer} />)}
    </>
  );
  return page(ctx, 'r/all', viewer, main);
}
