// A PERSON'S PAGE — www.reddit.com/user/{username}/submitted (a workspace, twin-world's architecture, "Screens"): u/{name}
// and the posts they made, newest first, each a card with its votes, comments and Share, as
// GET /user/{username}/submitted answers them. It is the page a media post's submit answers (`user_submitted_page`), where
// Create Post takes a person once their image or video is posted; /user/{username}/ draws the same posts.
import type { HandlerContext } from '@volter/world-core';
import { accountNamed, LINK, linkView, sortLinks } from '../semantics/shared.ts';
import { Avatar, baseOf, notFoundPage, page, PostCard, viewerOf } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const viewer = await viewerOf(ctx);
  const account = accountNamed(ctx, String(ctx.call.params.username ?? ''));
  if (!account) return notFoundPage(ctx, viewer);
  const rest = new URL(ctx.call.request.url).pathname.replace(/\/+$/, '').split('/').slice(3);
  if (rest.length > 1 || (rest.length === 1 && rest[0] !== 'submitted')) return notFoundPage(ctx, viewer, 'Page not found', 'The page you’re looking for doesn’t exist.');
  const base = baseOf(ctx);
  const me = viewer ? String(viewer.account.id) : undefined;
  const name = String(account.name);
  const posts = sortLinks(ctx, ctx.rowsRaw(LINK).filter((l) => l.author === name && l.removed_by_category !== 'deleted'), 'new').map((l) => linkView(ctx, l, me));
  const main = (
    <>
      <div className="banner" aria-hidden="true" />
      <div className="sr-head"><Avatar size={64} /><h1>u/{name}</h1></div>
      <nav className="sorts" aria-label="Profile"><a href={`${base ?? ''}/user/${name}/submitted/`} aria-current="page">Posts</a></nav>
      {posts.length === 0 ? <section className="empty"><h2>u/{name} hasn’t posted yet</h2></section>
        : posts.map((p) => <PostCard key={String(p.id)} ctx={ctx} post={p} base={base} mode="listing" viewer={viewer} />)}
    </>
  );
  return page(ctx, `${name} (u/${name}) - Reddit`, viewer, main);
}
