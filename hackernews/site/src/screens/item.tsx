// news.ycombinator.com/item?id=: a story (its title, site, points, who, when, its text) and its thread, ranked, with the
// add comment form (parent, goto, hmac, text, posted to POST /comment) while the thread is open; a comment's own page
// the same, under it. An id no item has answers "No such item." (news.ycombinator.com/item, read 2026-10-02).
import type { HandlerContext } from '@volter/world-core';
import { commentHmac, itemAt, storyOf, threadOpen } from '../semantics/shared.ts';
import { Arrow, commentsUnder, noSuchItemPage, nowOf, page, query, Subtext, Thread, Title, voteLinks, who } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const now = nowOf(ctx);
  // an item and every comment under it with its kids in ranked display order as they stand now
  const item = itemAt(ctx, query(ctx, 'id'), now);
  if (!item) return noSuchItemPage();
  const user = who(ctx);
  const story = storyOf(ctx, item) ?? item;
  const goto = `item?id=${String(item.id)}`;
  const read = (id: unknown) => itemAt(ctx, id, now);
  const comments = commentsUnder(item, read);
  const links = await voteLinks(ctx, user, [item, ...comments]);
  const hmac = await commentHmac(ctx, user ?? '', String(item.id));
  const title = item.type === 'story' ? `${String(item.title ?? '')} | Hacker News` : `${String(item.by)} comment | Hacker News`;
  return page(ctx, title, (
    <>
      <table>
        <tbody>
          <tr id={String(item.id)}>
            <td className="hn-arrow"><Arrow post={item} user={user} links={links} goto={goto} /></td>
            <td>{item.type === 'story' ? <Title story={item} /> : <span className="hn-sub"><a href={`user?id=${String(item.by)}`}>{String(item.by)}</a> | on: <a href={`item?id=${String(story.id)}`}>{String(story.title ?? '')}</a></span>}</td>
          </tr>
          {item.type === 'story' ? <tr><td /><td><Subtext story={item} now={now} /></td></tr> : null}
          {item.text ? <tr><td /><td><div className="hn-text" dangerouslySetInnerHTML={{ __html: String(item.text) }} /></td></tr> : null}
          {threadOpen(story, now) ? (
            <tr><td /><td>
              <br />
              <form method="post" action="comment">
                <input type="hidden" name="parent" value={String(item.id)} />
                <input type="hidden" name="goto" value={goto} />
                <input type="hidden" name="hmac" value={hmac} />
                <textarea name="text" rows={8} cols={80} aria-label="comment" /><br /><br />
                <input type="submit" value="add comment" />
              </form>
            </td></tr>
          ) : null}
        </tbody>
      </table>
      <br />
      {((item.kids as number[] | undefined) ?? []).map((k) => read(k)).filter((k) => Boolean(k)).map((k) => (
        <Thread key={String(k!.id)} comment={k!} depth={0} story={story} user={user} links={links} now={now} read={read} />
      ))}
    </>
  ));
}
