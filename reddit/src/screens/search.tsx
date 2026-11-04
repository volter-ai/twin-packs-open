// COMMUNITY SEARCH — www.reddit.com/subreddits/search?q={name} (a flow, twin-world's architecture, "Screens"): where
// Reddit sends a reader who names a community it does not have (semantics/shared.ts, noSuchCommunity). It lists the
// World's public communities whose name holds the words asked, each a link to its page, or says there are none.
import type { HandlerContext } from '@volter/world-core';
import { SUBREDDIT } from '../semantics/shared.ts';
import { baseOf, page, viewerOf } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const viewer = await viewerOf(ctx);
  const base = baseOf(ctx);
  const q = (new URL(ctx.call.request.url).searchParams.get('q') ?? '').trim();
  const words = q.toLowerCase();
  const found = words === '' ? [] : ctx.rowsRaw(SUBREDDIT)
    .filter((sr) => sr._profile_of === undefined && sr.subreddit_type !== 'private' && String(sr.display_name).toLowerCase().includes(words));
  const main = (
    <>
      <div className="sr-head all-head"><h1>Communities for “{q}”</h1></div>
      {found.length === 0
        // source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/templates/listing.html "there doesn't seem to be anything here"
        ? <section className="empty"><p id="noresults" className="muted">there doesn't seem to be anything here</p></section>
        : <ul className="sr-results">{found.map((sr) => <li key={String(sr.id)}><a href={`${base ?? ''}/r/${String(sr.display_name)}/`}>r/{String(sr.display_name)}</a> <span className="muted">{String(sr.public_description ?? sr.title ?? '')}</span></li>)}</ul>}
    </>
  );
  return page(ctx, `reddit.com: search results - ${q}`, viewer, main);
}
