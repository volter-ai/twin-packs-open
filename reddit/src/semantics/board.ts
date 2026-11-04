// Reddit on the World's board (twin-world's architecture, "The board is the World's pages"): the front page, each
// community at its page with each of its posts' comments pages under it, and each account's page, u/<name>, with the
// posts made in its profile community (u_<name>, whose /r/ page is the account's: ../screens/subreddit.tsx) under it.
// What each covers is what the screen draws, with the votes and comments its scores, Hot order and comment counts
// are made of: the front page the posts of every public community (../screens/home.tsx, as a signed-out reader sees
// it), a community its posts (../screens/subreddit.tsx), a post its comments (../screens/post.tsx), an account's page
// the posts it made anywhere (../screens/user.tsx). A deleted post leaves the pages that listed it, so they cover it
// still; it has no page of its own. A comment has no page the twin draws apart from its post's, and is not listed. An
// account is the World's own (`ours`) when a person of the World holds its password (the kernel's `_person`, which the
// accounts door records for each sign-up) or a token was issued to it; a community when an account of the World
// moderates it; a post when an account of the World made it.
import type { BoardFrame, HandlerContext } from '@volter/world-core';
import { ACCOUNT, COMMENT, LINK, MEMBERSHIP, SUBREDDIT, TOKEN, VOTE, type Row } from './shared.ts';

const SITE = 'https://www.reddit.com';

export function board(ctx: HandlerContext): BoardFrame[] {
  const accounts = ctx.rowsRaw(ACCOUNT).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const held = new Set(ctx.rowsRaw('_person').map((p) => String(p.username ?? '')));
  const ours = new Set([
    ...accounts.filter((a) => held.has(String(a.name))).map((a) => String(a.id)),
    ...ctx.rowsRaw(TOKEN).map((t) => String(t.account ?? '')),
  ].filter(Boolean));
  const ourNames = new Set(accounts.filter((a) => ours.has(String(a.id))).map((a) => String(a.name)));
  // every post, deleted ones too (a listing that showed one changed when it went), each indexed once
  const all = ctx.rowsRaw(LINK).sort((a, b) => Number(b.created_utc) - Number(a.created_utc));
  const group = (rows: Row[], key: (r: Row) => string): Map<string, Row[]> => {
    const m = new Map<string, Row[]>();
    for (const r of rows) { const k = key(r); const l = m.get(k); if (l) l.push(r); else m.set(k, [r]); }
    return m;
  };
  const bySubreddit = group(all, (l) => String(l.subreddit_id));
  const byAuthor = group(all, (l) => String(l.author));
  const comments = group(ctx.rowsRaw(COMMENT), (c) => String(c.link_id));
  const votes = group(ctx.rowsRaw(VOTE, { withDeleted: true }), (v) => String(v.thing));
  const moderators = group(ctx.rowsRaw(MEMBERSHIP).filter((m) => m.moderator === true), (m) => String(m.subreddit));
  const communities = ctx.rowsRaw(SUBREDDIT).filter((sr) => sr._profile_of === undefined).sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));
  const profiles = new Map(ctx.rowsRaw(SUBREDDIT).filter((sr) => sr._profile_of !== undefined).map((sr) => [`t5_${String(sr.id)}`, String(sr._profile_of)]));
  const flag = (yes: boolean): { ours?: true } => (yes ? { ours: true } : {});
  const live = (l: Row): boolean => l.removed_by_category !== 'deleted' && l.removed_by_category !== 'moderator';
  const votesOn = (thing: string): BoardFrame['covers'] => (votes.get(thing) ?? []).map((v) => ({ type: VOTE, id: String(v.id) }));
  // a post as a listing shows it: the post, its votes (its score, its place in Hot) and its comments (their count)
  const listed = (l: Row): BoardFrame['covers'] => [
    { type: LINK, id: String(l.id) }, ...votesOn(`t3_${String(l.id)}`),
    ...(comments.get(`t3_${String(l.id)}`) ?? []).map((c) => ({ type: COMMENT, id: String(c.id) })),
  ];
  const covered = (ls: Row[]): BoardFrame['covers'] => ls.flatMap(listed);
  // a post's page: the post as listed, and each comment's votes
  const postPage = (l: Row, section: BoardFrame['section'], parent: string): BoardFrame => ({
    id: `post:${String(l.id)}`, kind: 'post', title: String(l.title ?? '') || 'Post', section, url: `${SITE}${String(l.permalink)}`,
    covers: [...listed(l), ...(comments.get(`t3_${String(l.id)}`) ?? []).flatMap((c) => votesOn(`t1_${String(c.id)}`))],
    parent, ...flag(ourNames.has(String(l.author))),
  });

  const front: BoardFrame = {
    id: 'front', kind: 'front page', title: 'Reddit', section: { id: 'reddit', title: 'Reddit' }, url: `${SITE}/`,
    covers: covered(communities.filter((sr) => sr.subreddit_type !== 'private').flatMap((sr) => bySubreddit.get(`t5_${String(sr.id)}`) ?? [])),
  };
  const section = { id: 'communities', title: 'Communities' };
  const community = communities.flatMap((sr): BoardFrame[] => {
    const id = `subreddit:${String(sr.id)}`;
    const its = bySubreddit.get(`t5_${String(sr.id)}`) ?? [];
    const moderated = (moderators.get(String(sr.id)) ?? []).some((m) => ours.has(String(m.user)));
    return [
      { id, kind: 'community', title: `r/${String(sr.display_name)}`, section, url: `${SITE}/r/${String(sr.display_name)}/`, covers: [{ type: SUBREDDIT, id: String(sr.id) }, ...covered(its)], ...flag(moderated) },
      ...its.filter(live).map((l) => postPage(l, section, id)),
    ];
  });
  const users = { id: 'users', title: 'Users' };
  const people = accounts.flatMap((a): BoardFrame[] => {
    const id = `user:${String(a.id)}`;
    const made = byAuthor.get(String(a.name)) ?? [];
    return [
      { id, kind: 'profile', title: `u/${String(a.name)}`, section: users, url: `${SITE}/user/${String(a.name)}/`, covers: [{ type: ACCOUNT, id: String(a.id) }, ...covered(made)], ...flag(ours.has(String(a.id))) },
      ...made.filter((l) => live(l) && profiles.get(String(l.subreddit_id)) === String(a.id)).map((l) => postPage(l, users, id)),
    ];
  });
  return [front, ...community, ...people];
}
