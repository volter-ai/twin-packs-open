// Hacker News on the World's board (twin-world's architecture, "The board is the World's pages"): the front page, each
// item's page (news.ycombinator.com/item?id=, ../screens/item.tsx), a story under the front page and a comment under
// the item it replies to, and each user's page (../screens/user.tsx). What each covers is what the screen draws: the
// front page the thirty stories it ranks first at the World's instant (../../../src/semantics/shared.ts frontPage,
// ../screens/shared.tsx storyList), an item's page the item and the thread
// under it, a user's page the user (it shows their karma and about, never their submissions). A user is the World's own
// (`ours`) when a person of the World holds its password (the kernel's `_person`, which every account the site or the
// credential door makes records), and an item when such a user made it.
import type { BoardFrame, HandlerContext } from '@volter/world-core';
import { frontPage, ITEM, SITE, unixOf, USER, type Row } from './shared.ts';

export function board(ctx: HandlerContext): BoardFrame[] {
  const ours = new Set(ctx.rowsRaw('_person').map((p) => String(p.acct ?? '')).filter(Boolean));
  const flag = (yes: boolean): { ours?: true } => (yes ? { ours: true } : {});
  const items = ctx.rowsRaw(ITEM).sort((a, b) => Number(b.id) - Number(a.id));
  const under = new Map<string, Row[]>();
  for (const i of items) {
    if (i.parent === undefined) continue;
    const l = under.get(String(i.parent));
    if (l) l.push(i); else under.set(String(i.parent), [i]);
  }
  // each item's thread, built once and kept: its covers are itself and its replies' threads
  const threads = new Map<string, BoardFrame['covers']>();
  const thread = (i: Row): BoardFrame['covers'] => {
    const kept = threads.get(String(i.id));
    if (kept) return kept;
    const own: BoardFrame['covers'] = [{ type: ITEM, id: String(i.id) }];
    for (const r of under.get(String(i.id)) ?? []) for (const c of thread(r)) own.push(c);
    threads.set(String(i.id), own);
    return own;
  };
  const news = { id: 'news', title: 'Hacker News' };
  const front: BoardFrame = {
    id: 'front', kind: 'front page', title: 'Hacker News', section: news, url: `${SITE}/`,
    covers: frontPage(ctx, unixOf(ctx.occurredAt)).slice(0, 30).map((i) => ({ type: ITEM, id: String(i.id) })),
  };
  const pages = items.map((i): BoardFrame => ({
    id: `item:${String(i.id)}`, kind: String(i.type ?? 'item'), title: titleOf(i), section: news, url: `${SITE}/item?id=${String(i.id)}`,
    covers: thread(i),
    parent: i.parent !== undefined ? `item:${String(i.parent)}` : 'front',
    ...flag(ours.has(String(i.by))),
  }));
  const users = ctx.rowsRaw(USER).sort((a, b) => String(a.id).localeCompare(String(b.id))).map((u): BoardFrame => ({
    id: `user:${String(u.id)}`, kind: 'user', title: String(u.id), section: { id: 'users', title: 'Users' }, url: `${SITE}/user?id=${encodeURIComponent(String(u.id))}`,
    covers: [{ type: USER, id: String(u.id) }], ...flag(ours.has(String(u.id))),
  }));
  return [front, ...pages, ...users];
}

/** A story by its title; a comment by its first words (its text is the API's HTML), else whose it is. */
function titleOf(i: Row): string {
  if (i.title) return String(i.title);
  const text = String(i.text ?? '').replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return text.slice(0, 60) || `Comment by ${String(i.by)}`;
}
