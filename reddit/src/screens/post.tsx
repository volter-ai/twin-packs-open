// A POST'S COMMENTS PAGE — www.reddit.com/r/{subreddit}/comments/{article}/{slug} (a workspace, twin-world's
// architecture, "Screens"): the post (its video playing, its image or link card, or its body) with its votes, comment
// count and Share, the comment box (Join the conversation, Comment: POST /api/comment), and its comments as a tree, each
// with its votes, Reply and, on one's own, More options › Delete. It reads the post and its tree as GET /r/{subreddit}/comments/{article} answers them.
import type { HandlerContext } from '@volter/world-core';
import { commentTree, LINK, linkView, subredditNamed, type Row } from '../semantics/shared.ts';
import { ago, Avatar, baseOf, CommunityRail, notFoundPage, page, PostCard, viewerOf, Votes, type Viewer } from './shared.tsx';

function Composer({ thing, label, hidden, id }: { thing: string; label: string; hidden?: boolean; id?: string }) {
  return (
    <form className="composer" data-comment={thing} hidden={hidden} id={id}>
      <textarea name="text" placeholder="Join the conversation" aria-label={label} />
      <p className="error" role="alert" />
      <div className="composer-row"><button type="submit" className="btn-blue">Comment</button></div>
    </form>
  );
}

/** A comment's overflow menu (More options), for its author: Delete, which asks before it deletes (POST /api/del).
 *  source: spec:POST_api_del "Delete a Link or Comment."
 *  Where the documentation stops: the menu and its confirmation are reddit.com's page, which Reddit documents nowhere;
 *  the twin draws the author's Delete there, and none of the menu's other items (Edit, Save, Report), which it does not model. */
function Overflow({ fullname }: { fullname: string }) {
  return (
    <span className="overflow">
      <button type="button" className="reply-btn" aria-label="More options" aria-haspopup="menu" data-menu={fullname}>•••</button>
      <span className="menu" role="menu" id={`menu-${fullname}`} hidden>
        <button type="button" role="menuitem" data-delete={fullname}>Delete</button>
      </span>
      <dialog className="confirm" id={`confirm-${fullname}`} aria-label="Delete comment">
        <h2>Delete comment?</h2>
        <p>Are you sure you want to delete your comment?</p>
        <div className="composer-row"><button type="button" className="btn-outline" data-keep={fullname}>Keep</button><button type="button" className="btn-blue" data-confirm-delete={fullname}>Delete</button></div>
      </dialog>
    </span>
  );
}

function Comment({ thing, now, viewer, op }: { thing: Row; now: number; viewer: Viewer; op: string }) {
  const c = thing.data as Row;
  const replies = c.replies;
  const kids = replies && typeof replies === 'object' ? (replies as { data?: { children?: Row[] } }).data?.children ?? [] : [];
  return (
    <div className="comment" id={`t1_${String(c.id)}`} aria-label={`${String(c.author)} comment`}>
      <div className="comment-meta">
        <Avatar size={24} />
        <span className="who">{String(c.author)}</span>
        {c.author === op ? <span className="op">OP</span> : null}
        <span>•</span>
        <time dateTime={new Date(Number(c.created_utc) * 1000).toISOString()}>{ago(now, Number(c.created_utc))}</time>
      </div>
      <div className="comment-body md-body" dangerouslySetInnerHTML={{ __html: String(c.body_html).replace(/<!-- SC_O(?:FF|N) -->/g, '') }} />
      <div className="comment-actions">
        <Votes fullname={String(c.name)} score={Number(c.score ?? 0)} likes={viewer ? c.likes : null} />
        <button type="button" className="reply-btn" data-reply-to={String(c.id)}>Reply</button>
        {viewer && c.author === viewer.account.name && c.body !== '[deleted]' ? <Overflow fullname={String(c.name)} /> : null}
      </div>
      <Composer thing={String(c.name)} label={`Reply to ${String(c.author)}`} hidden id={`reply-${String(c.id)}`} />
      {kids.map((k) => <Comment key={String((k.data as Row).id)} thing={k} now={now} viewer={viewer} op={op} />)}
    </div>
  );
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  const viewer = await viewerOf(ctx);
  const base = baseOf(ctx);
  const id = String(ctx.call.params.article ?? '');
  const row = ctx.row(LINK, id);
  const community = String(ctx.call.params.subreddit ?? '');
  if (!row || String(row.subreddit).toLowerCase() !== community.toLowerCase()) return notFoundPage(ctx, viewer, 'Page not found', 'The post you’re looking for doesn’t exist.');
  const me = viewer ? String(viewer.account.id) : undefined;
  const post = linkView(ctx, row, me);
  const tree = commentTree(ctx, `t3_${id}`, me, 'confidence', 10);
  const now = Math.floor(Date.parse(ctx.occurredAt) / 1000);
  const sr = subredditNamed(ctx, community);
  const main = (
    <>
      <PostCard ctx={ctx} post={post} base={base} mode="page" viewer={viewer} />
      {post.removed_by_category === 'deleted' ? null : <Composer thing={String(post.name)} label="Add a comment" />}
      <div className="sort-line">Sort by: Best</div>
      <section className="comments" aria-label="Comments">
        {tree.length === 0 ? <div className="empty"><h2>Be the first to comment</h2><p className="muted">Nobody's responded to this post yet. Add your thoughts and get the conversation going.</p></div>
          : tree.map((t) => <Comment key={String((t.data as Row).id)} thing={t} now={now} viewer={viewer} op={String(post.author)} />)}
      </section>
    </>
  );
  return page(ctx, `${String(post.title)} : r/${String(post.subreddit)}`, viewer, main, { create: `/r/${String(post.subreddit)}/submit`, ...(sr ? { rail: <CommunityRail ctx={ctx} sr={sr} /> } : {}) });
}
