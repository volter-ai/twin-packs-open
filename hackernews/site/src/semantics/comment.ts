// POST /comment: an item page's 'add comment' form and a reply page's 'reply' form (../../spec/openapi.json), and the
// login forms the site answers either with for a visitor nobody is signed in as.
import type { HandlerContext } from '@volter/world-core';
import { addCommentPage, commentAs, commentHmac, expiredLink, gotoOf, itemOf, loginPage, moveTo, noSuchItem, signedInAs, signIn } from './shared.ts';

export async function comment(ctx: HandlerContext): Promise<Response> {
  const parent = itemOf(ctx, ctx.params.parent);
  const goto = gotoOf(ctx.params.goto, parent ? `item?id=${String(parent.id)}` : 'news');
  const user = signedInAs(ctx);
  if (!parent) return noSuchItem(ctx, user);
  const text = String(ctx.params.text ?? '').trim();
  if (!user) {
    const signedOut = await commentHmac(ctx, '', String(parent.id));
    const carried = { parent: String(parent.id), goto, hmac: signedOut, text };
    // the login forms posted back here with the comment they carried: signed in, the add comment page answers with the
    // text kept in its box, and the comment is made when that form is posted
    // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(addcomment-page parent u whence text)"
    if (ctx.params.acct !== undefined && String(ctx.params.hmac ?? '') === signedOut) return signIn(ctx, goto, undefined, { carried, answer: (who) => addCommentPage(ctx, who, parent, goto, text) });
    // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "You have to be logged in to comment."
    return loginPage(ctx, 'You have to be logged in to comment.', 'comment', carried);
  }
  // a form not drawn for this person is no link the site made for them
  if (String(ctx.params.hmac ?? '') !== await commentHmac(ctx, user, String(parent.id))) return expiredLink(ctx, user);
  return (await commentAs(ctx, user, parent, text, goto)) ?? moveTo(ctx, goto);
}
