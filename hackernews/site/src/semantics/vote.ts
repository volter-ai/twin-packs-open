// GET /vote: the upvote arrow beside a story or a comment (../../spec/openapi.json).
import type { HandlerContext } from '@volter/world-core';
import { cantVote, gotoOf, itemOf, loginPage, moveTo, noSuchItem, signedInAs, signIn, voteAuth, voteOnce } from './shared.ts';

export async function vote(ctx: HandlerContext): Promise<Response> {
  const goto = gotoOf(ctx.params.goto);
  const user = signedInAs(ctx);
  // source: https://news.ycombinator.com/vote?id=1&how=up&goto=news "You have to be logged in to vote."
  if (!user) return loginPage(ctx, 'You have to be logged in to vote.');
  const item = itemOf(ctx, ctx.params.id);
  if (!item) return noSuchItem(ctx, user);
  // source: spec:vote "The upvote arrow beside a story or comment is a link here."
  // the arrow is an upvote; another direction (an unvote, a downvote) is no vote this site makes here
  if (String(ctx.params.how ?? '') !== 'up') return cantVote(ctx, user);
  // Where the documentation stops: a link whose auth is not this person's for this item makes no vote
  if (String(ctx.params.auth ?? '') !== await voteAuth(ctx, user, String(item.id))) return cantVote(ctx, user);
  await voteOnce(ctx, user, item);
  return moveTo(ctx, goto);
}

/** POST /vote: the login forms the vote link answers a visitor nobody is signed in as post to the vote's own address;
 *  signed in, the vote is made and the person goes on to the goto page. */
export async function voteLogin(ctx: HandlerContext): Promise<Response> {
  // source: https://news.ycombinator.com/vote?id=1&how=up&goto=news "You have to be logged in to vote."
  const item = itemOf(ctx, ctx.params.id);
  return signIn(ctx, gotoOf(ctx.params.goto), async (user) => { if (item && String(ctx.params.how ?? '') === 'up') await voteOnce(ctx, user, item); });
}
