// POST /reply: the reply page drawn for a visitor nobody is signed in as carries the login forms, posting to the reply
// page's own address (../../spec/openapi.json); signed in, the site answers the add comment page itself.
import type { HandlerContext } from '@volter/world-core';
import { addCommentPage, gotoOf, itemOf, noSuchItem, signIn } from './shared.ts';

export async function replyLogin(ctx: HandlerContext): Promise<Response> {
  const parent = itemOf(ctx, ctx.params.id);
  if (!parent) return noSuchItem(ctx, undefined);
  const goto = gotoOf(ctx.params.goto, `item?id=${String(parent.id)}`);
  // source: https://news.ycombinator.com/reply?id=49940915&goto=item%3Fid%3D49940219%2349940915 "You have to be logged in to reply."
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(newslog ip u 'comment-login) (addcomment-page i u whence))))"
  return signIn(ctx, goto, undefined, { answer: (user) => addCommentPage(ctx, user, parent, goto, '') });
}
