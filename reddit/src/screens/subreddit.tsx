// A COMMUNITY — www.reddit.com/r/{subreddit} (a workspace, twin-world's architecture, "Screens"): its banner and name,
// Create Post and Join, its posts in the order asked (Hot, the default, or New: the same listings GET
// /r/{subreddit}/hot and /new answer), each a card with its votes, comments and Share, and its About panel. Its Create
// Post page is /r/{subreddit}/submit (./submit.tsx).
import type { HandlerContext } from '@volter/world-core';
import { linksOf, linkView, membership, noSuchCommunity, sortLinks, subredditNamed } from '../semantics/shared.ts';
import { baseOf, seeOther, CommunityIcon, CommunityRail, notFoundPage, page, PostCard, submitPage, viewerOf } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const name = String(ctx.call.params.subreddit ?? '');
  const rest = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '').split('/').slice(3);
  const viewer = await viewerOf(ctx);
  const sr = subredditNamed(ctx, name);
  // a person's profile community (u_<name>) is their page
  if (sr && sr._profile_of !== undefined) return seeOther(baseOf(ctx), `/user/${name.replace(/^u_/i, '')}/`);
  // every page under /r/<name>, its Create Post too, is sent to the search when Reddit has no such community
  if (!sr) return noSuchCommunity(ctx, name, () => notFoundPage(ctx, viewer, 'Page not found', 'The page you’re looking for doesn’t exist.'));
  if (rest[0] === 'submit' && rest.length === 1) return submitPage(ctx, name);
  const sort = rest.length === 0 || rest[0] === 'hot' ? 'hot' : rest[0] === 'new' ? 'new' : undefined;
  if (!sort || rest.length > 1) return notFoundPage(ctx, viewer, 'Page not found', 'The page you’re looking for doesn’t exist.');
  const base = baseOf(ctx);
  const me = viewer ? String(viewer.account.id) : undefined;
  const joined = membership(ctx, String(sr.id), me).subscriber;
  const posts = sortLinks(ctx, linksOf(ctx, String(sr.id)), sort).map((l) => linkView(ctx, l, me));
  const display = String(sr.display_name);
  const main = (
    <>
      <div className="banner" aria-hidden="true" />
      <div className="sr-head">
        <CommunityIcon size={88} />
        <h1>r/{display}</h1>
        <div className="sr-actions">
          <a className="btn-outline" href={viewer ? `${base ?? ''}/r/${display}/submit` : `${base ?? ''}/login/?dest=${encodeURIComponent(`/r/${display}/submit`)}`}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="1.8" fill="none" /></svg>
            Create Post
          </a>
          <button type="button" className={joined ? 'btn-outline' : 'btn-blue'} data-join={display} data-joined={joined ? '1' : '0'}>{joined ? 'Joined' : 'Join'}</button>
        </div>
      </div>
      <nav className="sorts" aria-label="Sort by">
        <a href={`${base ?? ''}/r/${display}/hot/`} aria-current={sort === 'hot' ? 'page' : undefined}>Hot</a>
        <a href={`${base ?? ''}/r/${display}/new/`} aria-current={sort === 'new' ? 'page' : undefined}>New</a>
      </nav>
      {posts.length === 0 ? (
        <section className="empty"><h2>This community doesn’t have any posts yet</h2><p className="muted">Make one and get this feed started.</p></section>
      ) : posts.map((p) => <PostCard key={String(p.id)} ctx={ctx} post={p} base={base} mode="listing" viewer={viewer} />)}
    </>
  );
  return page(ctx, `r/${display}`, viewer, main, { create: `/r/${display}/submit`, rail: <CommunityRail ctx={ctx} sr={sr} /> });
}
