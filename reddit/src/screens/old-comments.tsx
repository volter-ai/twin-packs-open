// A post's comments page on old.reddit.com (a workspace, twin-world's architecture "Screens"): the post as r2's listing
// draws it, its comment box, and its comments as a tree, each with r2's arrows and its reply toggle (./shared.tsx
// OldComment), read as GET /r/{subreddit}/comments/{article} answers them. Volter Browsers' frontline presses a
// comment's reply toggle here (volter-ai/lucarne 83c544c packages/lucarne-sites/src/policy.ts:24-26).
import type { HandlerContext } from '@volter/world-core';
import { commentTree, LINK, linkView, type Row } from '../semantics/shared.ts';
import { OldComment, oldPage, OldReplyBox, OldThing, viewerOf } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const viewer = await viewerOf(ctx);
  const id = String(ctx.call.params.article ?? '');
  const row = ctx.row(LINK, id);
  const community = String(ctx.call.params.subreddit ?? '');
  if (!row || String(row.subreddit).toLowerCase() !== community.toLowerCase()) return oldPage(ctx, 'reddit.com: page not found', viewer, <p className="error">the page you requested does not exist</p>, 404);
  const me = viewer ? String(viewer.account.id) : undefined;
  const post = linkView(ctx, row, me);
  const tree = commentTree(ctx, `t3_${id}`, me, 'confidence', 10);
  const now = Math.floor(Date.parse(ctx.occurredAt) / 1000);
  return oldPage(ctx, `${String(post.title)} : ${String(post.subreddit)}`, viewer, (
    <>
      <div id="siteTable" className="sitetable linklisting"><OldThing post={post} now={now} /></div>
      {post.removed_by_category === 'deleted' ? null : <OldReplyBox thing={String(post.name)} />}
      <div className="commentarea">{tree.map((t) => <OldComment key={String((t.data as Row).id)} thing={t} now={now} />)}</div>
    </>
  ));
}
