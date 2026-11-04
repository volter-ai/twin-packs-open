// LinkedIn on the World's board (twin-world's architecture, "The board is the World's pages"): each company page at its
// Posts tab, covering the page and its posts, since the tab shows them (../screens/company.tsx; a deleted post leaves
// the tab, so the tab covers it still), and each published post
// at its own page (../screens/post.tsx): a page's post under the page, a member's post on its own under the member. A
// company page is the World's own (`ours`) when a member of the World holds an approved role on it (the
// `organization_acl` a page's creator is given as its administrator, ./shared.ts ensureOrganization); a member is the
// World's when a person of the World signs in as them (the kernel's `_person`, which every sign-up records) or a token
// was issued to them. A member's profile (linkedin.com/in/…) is not listed: no screen of the pack draws one, and no
// member keeps the vanity name its URL is made of.
import type { BoardFrame, HandlerContext } from '@volter/world-core';
import { ACL, MEMBER, ORGANIZATION, POST, TOKEN, type Row } from './shared.ts';

export function board(ctx: HandlerContext): BoardFrame[] {
  const worlds = new Set([
    ...ctx.rowsRaw('_person').map((p) => String(p.sub ?? '')),
    ...ctx.rowsRaw(TOKEN).filter((t) => t.invalidated !== true).map((t) => String(t.member ?? '')),
  ].filter(Boolean).map((sub) => `urn:li:person:${sub}`));
  // every post, deleted ones too, by its author, in one pass
  const byAuthor = new Map<string, Row[]>();
  for (const p of ctx.rowsRaw(POST, { withDeleted: true }).sort((a, b) => Number(b.createdAt) - Number(a.createdAt))) {
    const l = byAuthor.get(String(p.author));
    if (l) l.push(p); else byAuthor.set(String(p.author), [p]);
  }
  const shown = (p: Row): boolean => p.deleted !== true && p.lifecycleState === 'PUBLISHED';
  const approved = new Set(ctx.rowsRaw(ACL).filter((a) => a.state === 'APPROVED' && worlds.has(String(a.roleAssignee))).map((a) => String(a.organization)));
  const postPage = (p: Row, section: BoardFrame['section'], ours: boolean, parent?: string): BoardFrame => ({
    id: `post:${String(p.id)}`, kind: 'post', title: String(p.commentary ?? '').replace(/\\(.)/g, '$1').split('\n')[0]!.slice(0, 60) || 'Post', section,
    url: `https://www.linkedin.com/feed/update/${String(ctx.own(p).id)}/`,
    covers: [{ type: 'post', id: String(p.id) }],
    ...(parent ? { parent } : {}), ...(ours ? { ours: true } : {}),
  });
  const companies = ctx.rowsRaw(ORGANIZATION).sort((a, b) => Number(a.id) - Number(b.id)).flatMap((o): BoardFrame[] => {
    const urn = `urn:li:organization:${String(o.id)}`;
    const section = { id: `organization:${String(o.id)}`, title: String(o.localizedName) };
    const ours = approved.has(urn);
    const own = byAuthor.get(urn) ?? [];
    const id = `company:${String(o.id)}`;
    return [
      {
        id, kind: 'company page', title: `${String(o.localizedName)} · Posts`, section,
        url: `https://www.linkedin.com/company/${String(o.vanityName)}/posts/`,
        // the posts the tab has shown: published ones, deleted or not (a draft or a failed publish never reached it)
        covers: [{ type: 'organization', id: String(o.id) }, ...own.filter((p) => p.lifecycleState === 'PUBLISHED').map((p) => ({ type: 'post', id: String(p.id) }))],
        ...(ours ? { ours: true } : {}),
      },
      ...own.filter(shown).map((p) => postPage(p, section, ours, id)),
    ];
  });
  const members = ctx.rowsRaw(MEMBER).sort((a, b) => Number(a.sub) - Number(b.sub)).flatMap((m): BoardFrame[] => {
    const urn = `urn:li:person:${String(m.sub)}`;
    const section = { id: `member:${String(m.sub)}`, title: String(m.name) };
    return (byAuthor.get(urn) ?? []).filter(shown).map((p) => postPage(p, section, worlds.has(urn)));
  });
  return [...companies, ...members];
}
