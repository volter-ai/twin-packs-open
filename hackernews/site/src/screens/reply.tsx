// news.ycombinator.com/reply?id=&goto=: the comment replied to and the reply form (parent, goto, hmac, text, posted to
// POST /comment).
import type { HandlerContext } from '@volter/world-core';
import { commentHmac, gotoOf, itemOf } from '../semantics/shared.ts';
import { age, loginForms, noSuchItemPage, nowOf, page, query, who } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const parent = itemOf(ctx, query(ctx, 'id'));
  if (!parent) return noSuchItemPage();
  const user = who(ctx);
  const goto = gotoOf(query(ctx, 'goto'), `item?id=${String(parent.id)}`);
  // signed out, the page asks the visitor to log in, its forms posting to this page's own address (POST /reply,
  // ../semantics/reply.ts; news.ycombinator.com/reply, read 2026-10-03: "You have to be logged in to reply.")
  if (!user) return loginForms(ctx, 'Add Comment | Hacker News', 'You have to be logged in to reply.');
  const hmac = await commentHmac(ctx, user, String(parent.id));
  return page(ctx, 'Add Comment | Hacker News', (
    <>
      <div className="hn-comment">
        <span className="hn-sub"><a href={`user?id=${String(parent.by)}`}>{String(parent.by)}</a> <a href={`item?id=${String(parent.id)}`}>{age(parent.time, nowOf(ctx))}</a></span>
        {/* a story's title is text, drawn escaped; a comment's text is the site's formatted HTML (../semantics/shared.ts
            formatText), drawn as it is */}
        {parent.type === 'comment'
          ? <div className="hn-text" dangerouslySetInnerHTML={{ __html: String(parent.text ?? '') }} />
          : <div className="hn-text">{String(parent.title ?? '')}</div>}
      </div>
      <form method="post" action="comment">
        <input type="hidden" name="parent" value={String(parent.id)} />
        <input type="hidden" name="goto" value={goto} />
        <input type="hidden" name="hmac" value={hmac} />
        <textarea name="text" rows={8} cols={80} aria-label="reply" autoFocus /><br /><br />
        {/* news.arc: (submit (if (acomment parent) "reply" "add comment")) */}
        <input type="submit" value={parent.type === 'comment' ? 'reply' : 'add comment'} />
      </form>
    </>
  ));
}
