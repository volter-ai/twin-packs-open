// X's pages on the World's board (twin-world's architecture, "The board is the World's pages"): every account's profile,
// grouped under X, and each of its posts at its own page under that profile. A profile covers its account and the posts
// x.com's profile page shows, those that reply to no one (./shared.ts webProfile), deleted ones too since the page
// changed when they went (../screens/profile.tsx); a post's page covers the post (../screens/post.tsx).
// An account is the World's own (`ours`) when the World acts as it: it holds an access token or an OAuth 1.0a token, or
// a person of the World holds its password (the kernel's `_person`, which ../semantics/doors.ts records for a seeded
// account given one and which x.com's sign-in flow signs in to). An account seeded with no password and no token is
// the audience, someone outside the World, and its pages are listed all the same.
import type { BoardFrame, HandlerContext } from '@volter/world-core';
import { isReply } from './shared.ts';

type Row = Record<string, unknown>;

export function board(ctx: HandlerContext): BoardFrame[] {
  const live = (r: Row): boolean => r.deleted !== true && r.revoked !== true;
  const ours = new Set([
    ...ctx.rowsRaw('_access_token').filter(live).map((t) => String(t.sub ?? '')),
    ...ctx.rowsRaw('_oauth1_token').filter(live).map((t) => String(t.userId ?? '')),
    ...ctx.rowsRaw('_person').map((p) => String(p.account_id ?? '')),
  ].filter(Boolean));
  const section = { id: 'accounts', title: 'Accounts' };
  // every post, deleted ones too, by its author, in one pass
  const byAuthor = new Map<string, Row[]>();
  for (const p of ctx.rowsRaw('post', { withDeleted: true }).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    const l = byAuthor.get(String(p.author_id));
    if (l) l.push(p); else byAuthor.set(String(p.author_id), [p]);
  }
  return ctx.rowsRaw('account').filter((a) => a.deleted !== true)
    .sort((a, b) => String(a.username).localeCompare(String(b.username)))
    .flatMap((a): BoardFrame[] => {
      const profile = `profile:${String(a.id)}`;
      const own = ours.has(String(a.id));
      const theirs = byAuthor.get(String(a.id)) ?? [];
      return [
        {
          id: profile, kind: 'profile', title: `@${String(a.username)}`, section, url: `https://x.com/${String(a.username)}`,
          covers: [{ type: 'account', id: String(a.id) }, ...theirs.filter((p) => p.in_reply_to_user_id === undefined && !isReply(p)).map((p) => ({ type: 'post', id: String(p.id) }))],
          ...(own ? { ours: true } : {}),
        },
        ...theirs.filter((p) => p.deleted !== true).map((p): BoardFrame => ({
          id: `post:${String(p.id)}`, kind: 'post', title: String(p.text ?? '').split('\n')[0]!.slice(0, 60) || 'Post', section,
          url: `https://x.com/${String(a.username)}/status/${String(p.id)}`,
          covers: [{ type: 'post', id: String(p.id) }], parent: profile,
          ...(own ? { ours: true } : {}),
        })),
      ];
    });
}
