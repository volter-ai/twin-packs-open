// news.ycombinator.com/show: the Show HNs past the points threshold, ranked (showhn.html: "Once it clears a small
// points threshold, it will appear on the show page in the top bar."), under the note the page always draws, linking the
// rules, the tips and the newest Show HNs (news.ycombinator.com/show, read 2026-10-03: "Please read the Show HN rules and
// tips before posting. You can browse the newest Show HNs here.").
//
// The rules (showhn.html) and the tips (a thread, item 22336638) are Hacker News's own static public pages, which no
// World holds and this twin does not republish: their links are a deliberate departure from the World's base, as a
// story's title link is, opening the real public page in a tab of its own. The newest Show HNs stay on the base.
import type { HandlerContext } from '@volter/world-core';
import { showPage } from '../semantics/shared.ts';
import { nowOf, storyList } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const note = (
    <>Please read the Show HN <a href="https://news.ycombinator.com/showhn.html" target="_blank" rel="noopener noreferrer"><u>rules</u></a> and <a href="https://news.ycombinator.com/item?id=22336638" target="_blank" rel="noopener noreferrer"><u>tips</u></a> before posting. You can browse the newest Show HNs <a href="shownew"><u>here</u></a>.</>
  );
  return storyList(ctx, 'Show | Hacker News', showPage(ctx, nowOf(ctx)), 'show', note);
}
