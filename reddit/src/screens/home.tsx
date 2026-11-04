// REDDIT'S FRONT PAGE — www.reddit.com/ (a workspace, twin-world's architecture, "Screens"): the page reddit.com's logo
// and an empty sign-in `dest` open (r2's VDestination: no dest is "/"). Signed in, the person's home feed: the posts of
// the communities they joined or moderate, Hot first; signed out, or with no community joined, every public community's
// posts (Reddit's front page shows a signed-out reader its popular posts). The World's console opens Reddit here.
// Where the documentation stops: Reddit documents no ranking for its front page; the twin orders it as a community's Hot.
import type { HandlerContext } from '@volter/world-core';
import { homeFeed } from '../semantics/shared.ts';
import { baseOf, notFoundPage, page, PostCard, viewerOf } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const viewer = await viewerOf(ctx);
  // the root alone: every other path no screen draws is a page Reddit does not have
  if (new URL(ctx.call.request.url).pathname.replace(/\/+$/, '') !== '') return notFoundPage(ctx, viewer, 'Page not found', 'The page you’re looking for doesn’t exist.');
  const base = baseOf(ctx);
  const { posts, personalized } = homeFeed(ctx, viewer ? String(viewer.account.id) : undefined);
  const main = (
    <>
      <div className="sr-head all-head"><h1>{personalized ? 'Home' : 'Popular'}</h1></div>
      {posts.length === 0 ? <section className="empty"><h2>No posts yet</h2></section>
        : posts.map((p) => <PostCard key={String(p.id)} ctx={ctx} post={p} base={base} mode="listing" viewer={viewer} />)}
    </>
  );
  return page(ctx, 'Reddit - Dive into anything', viewer, main);
}
