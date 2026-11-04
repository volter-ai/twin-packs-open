// A POST'S OWN PAGE — www.linkedin.com/feed/update/{urn}/ (a workspace, docs/contributing/architecture.md, "Screens";
// the Posts API page: "When a UGC Post is published, an authorized member can view the post using the follow URL
// structure: https://www.linkedin.com/feed/update/urn:li:ugcPost:<id>/"): the post with its text, its image, its
// playable video or its link card, beside its author. A public post is shown to anyone, signed in or not; a visitor at
// one they may not see, or one that is gone, is sent to join LinkedIn (./shared.tsx toJoin); a member, told it cannot be
// displayed. Where the documentation stops: what linkedin.com shows a signed-in member there was not read (reading it
// needs an account), and the words are the twin's. While its media is processing, the page reloads itself
// (./shared.tsx whileProcessing).
//
// A member signed in acts on it from its social row (./shared.tsx Social): Comment opens the comment box here
// (`?commentBox=open`); Like, Repost, Send and the box's Comment post this page's form. None of them is an operation of
// the written spec (reactions and comments are LinkedIn's Community Management API, which no application in this
// pack's demand calls), so each answers the gap and the page shows that answer; a visitor is sent to sign in.
import type { HandlerContext } from '@volter/world-core';
import { mediaSigner, nowMs, postByUrn, urnOf } from '../semantics/shared.ts';
import { Avatar, authorOf, cannotDisplay, CommentBox, field, GlobalNav, memberOf, page, toJoin, toSignIn, Update, visibleTo, whileProcessing } from './shared.tsx';

const ACTS = new Set(['like', 'repost', 'send', 'comment']);

export async function screen(ctx: HandlerContext): Promise<Response> {
  const member = memberOf(ctx);
  const urn = String(ctx.call.params.urn ?? '');
  const post = urnOf(urn) ? postByUrn(ctx, urn) : undefined;
  if (ctx.call.request.method === 'POST' && !member) return toSignIn(ctx);
  if (!post || !visibleTo(ctx, post, member)) return member ? cannotDisplay(ctx, member, 'Post', 'This post cannot be displayed') : toJoin(ctx);
  let notice: string | undefined;
  if (ctx.call.request.method === 'POST') {
    if (!ACTS.has(field(ctx, 'intent'))) return cannotDisplay(ctx, member, 'Post', 'This post cannot be displayed');
    const answer = ctx.gap();
    const body = await answer.json().catch(() => ({})) as { message?: string };
    notice = body.message ?? `LinkedIn answered ${answer.status}`;
  }
  const commenting = new URL(ctx.call.request.url).searchParams.get('commentBox') === 'open' || field(ctx, 'intent') === 'comment';
  const who = authorOf(ctx, String(post.author));
  const sign = await mediaSigner(ctx);
  return page(ctx, `${who.name} on LinkedIn`, (
    <>
      <GlobalNav member={member} />
      <main className="layout layout-wide">
        <div>
          <Update ctx={ctx} post={post} member={member} now={nowMs(ctx)} sign={sign} />
          {member && commenting ? <CommentBox urn={String(ctx.own(post).id)} {...(notice ? { notice } : {})} /> : notice ? <div className="toast" role="status">{notice}</div> : null}
        </div>
        <aside>
          <section className="card" aria-label={`About ${who.name}`}>
            <div className="card-body">
              <Avatar name={who.name} kind={who.kind} size={56} />
              <div className="update__name" style={{ marginTop: 8 }}>{who.href ? <a href={who.href}>{who.name}</a> : who.name}</div>
              {who.subtitle ? <div className="muted small">{who.subtitle}</div> : null}
            </div>
          </section>
        </aside>
      </main>
    </>
  ), 200, [], whileProcessing([post]));
}
